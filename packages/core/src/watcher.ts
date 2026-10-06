// Filesystem watcher for actis
import chokidar, { FSWatcher } from 'chokidar';
import { relative, resolve } from 'path';
import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { getDb, logEvent, saveDb, FileEvent } from './db.js';
import { computeHash, computeDiff } from './diff.js';
import { parseIgnoreFile, DEFAULT_IGNORE_PATTERNS, SECRET_PATTERNS, shouldDiffFile } from './ignore.js';

export interface WatcherConfig {
  projectRoot: string;
  ignorePatterns?: string[];
  debounceMs?: number;
  usePolling?: boolean;
  pollingIntervalMs?: number;
  // New options for Phase 1
  rescanOnStart?: boolean;
  maxFileSize?: number; // bytes, default 1MB
  binaryExtensions?: string[];
}

// Polling decision: inotify events do not cross the WSL 9p mount, so a Linux
// path under /mnt/ needs chokidar's usePolling. Explicit config always wins.
export function resolvePolling(
  projectRoot: string,
  platform: string,
  usePolling?: boolean,
): boolean {
  if (usePolling !== undefined) return usePolling;
  return platform === 'linux' && resolve(projectRoot).startsWith('/mnt/');
}

interface PendingChange {
  path: string;
  type: 'create' | 'modify' | 'delete' | 'rename';
  timestamp: number;
  content?: string;
  previousContent?: string;
  fromPath?: string; // for rename detection
}

export class ActisWatcher {
  private watcher: FSWatcher | null = null;
  private projectRoot: string;
  private projectId: number | undefined;
  private pendingChanges: Map<string, PendingChange> = new Map();
  // Last-seen content survives flushes — every later modify can then carry a
  // real diff, not just edits landing within one debounce window.
  private lastSeenContent: Map<string, string> = new Map();
  // For rename detection: track recent deletes by hash
  private recentDeletes: Map<string, { hash: string; path: string; timestamp: number }> = new Map();
  private debounceMs: number;
  private ignorePatterns: string[] = [];
  private usePolling: boolean | undefined;
  private pollingIntervalMs: number | undefined;
  private readyPromise: Promise<void> | null = null;
  private isProcessing = false;
  private initialized = false;
  // Phase 1 options
  private rescanOnStart: boolean;
  private maxFileSize: number;
  private binaryExtensions: Set<string>;
  private ignoreMatcher: (path: string) => boolean;

  constructor(config: WatcherConfig) {
    this.projectRoot = resolve(config.projectRoot);
    this.debounceMs = config.debounceMs || 500;
    this.usePolling = config.usePolling;
    this.pollingIntervalMs = config.pollingIntervalMs;
    this.rescanOnStart = config.rescanOnStart ?? false;
    this.maxFileSize = config.maxFileSize ?? 1024 * 1024; // 1MB default
    this.binaryExtensions = new Set(config.binaryExtensions || [
      '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp',
      '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z',
      '.exe', '.dll', '.so', '.dylib',
      '.ttf', '.woff', '.woff2', '.eot',
      '.mp3', '.mp4', '.mov', '.avi', '.mkv',
      '.db', '.sqlite', '.sqlite3',
    ]);

    // Build ignore matcher from .gitignore + .actisignore + defaults + secret patterns
    this.ignoreMatcher = this.buildIgnoreMatcher();
  }

  private buildIgnoreMatcher(): (path: string) => boolean {
    const patterns: string[] = [
      ...DEFAULT_IGNORE_PATTERNS,
      ...SECRET_PATTERNS,
    ];

    // Add .gitignore patterns
    const gitignorePath = resolve(this.projectRoot, '.gitignore');
    if (existsSync(gitignorePath)) {
      patterns.push(...parseIgnoreFile(gitignorePath));
    }

    // Add .actisignore patterns
    const actisignorePath = resolve(this.projectRoot, '.actisignore');
    if (existsSync(actisignorePath)) {
      patterns.push(...parseIgnoreFile(actisignorePath));
    }

    // Convert glob patterns to regex
    const regexes = patterns.map(pattern => {
      // Escape regex special chars except * and ?
      const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]');
      return new RegExp(`^${escaped}$`);
    });

    return (path: string) => regexes.some(re => re.test(path));
  }

  async initialize(): Promise<void> {
    const database = getDb();
    const project = database.prepare('SELECT * FROM projects WHERE root_path = ?').get(this.projectRoot) as
      | { id: number; name: string; root_path: string; created_at: number; is_active: number }
      | undefined;
    if (!project) {
      throw new Error(`Project not found for path: ${this.projectRoot}`);
    }
    this.projectId = project.id;
    this.initialized = true;

    if (this.rescanOnStart) {
      await this.rescan();
    }
  }

  // Rescan the project tree and compare against DB
  // Emits create/modify/delete events based on hash comparison
  // Uses mtime as timestamp, marks events as "detected on rescan"
  async rescan(): Promise<void> {
    console.log(`[actis] Starting rescan of ${this.projectRoot}`);

    const database = getDb();
    // Get all tracked files from DB
    const dbEvents = database.prepare(
      'SELECT path, hash_after FROM file_events WHERE project_id = ? AND event_type != ? ORDER BY timestamp DESC'
    ).all(this.projectId, 'delete') as { path: string; hash_after: string | null }[];

    // Build map of latest known hash per file
    const dbFileHashes = new Map<string, string>();
    for (const event of dbEvents) {
      if (event.hash_after && !dbFileHashes.has(event.path)) {
        dbFileHashes.set(event.path, event.hash_after);
      }
    }

    // Walk the filesystem
    const fsFiles = new Map<string, { hash: string; mtime: number; size: number }>();
    this.walkDir(this.projectRoot, fsFiles);

    // Compare: files in FS but not in DB -> create
    // Files in both but hash differs -> modify
    // Files in DB but not in FS -> delete
    const now = Date.now();
    let creates = 0, modifies = 0, deletes = 0;

    // Check for creates and modifies
    for (const [relPath, info] of fsFiles) {
      const dbHash = dbFileHashes.get(relPath);
      if (!dbHash) {
        // New file
        await this.emitRescanEvent(relPath, 'create', info.mtime, info.hash, info.size);
        creates++;
      } else if (dbHash !== info.hash) {
        // Modified file
        await this.emitRescanEvent(relPath, 'modify', info.mtime, info.hash, info.size, dbHash);
        modifies++;
      }
      dbFileHashes.delete(relPath);
    }

    // Remaining in dbFileHashes are deleted files
    for (const [relPath, hash] of dbFileHashes) {
      await this.emitRescanEvent(relPath, 'delete', now, hash, 0);
      deletes++;
    }

    console.log(`[actis] Rescan complete: ${creates} creates, ${modifies} modifies, ${deletes} deletes`);
    saveDb();
  }

  private walkDir(dir: string, files: Map<string, { hash: string; mtime: number; size: number }>, base = ''): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      const relPath = base ? `${base}/${entry.name}` : entry.name;

      // Check ignore patterns
      if (this.ignoreMatcher(relPath)) continue;

      if (entry.isDirectory()) {
        this.walkDir(fullPath, files, relPath);
      } else if (entry.isFile()) {
        try {
          const stat = statSync(fullPath);
          // Skip binary/large files for content hashing (but still record event)
          let hash = '';
          if (stat.size <= this.maxFileSize && !this.isBinaryExtension(entry.name)) {
            const content = readFileSync(fullPath, 'utf-8');
            hash = computeHash(content);
          } else {
            // For binary/large files, use size+mtime as a weak hash
            hash = `size:${stat.size}:mtime:${stat.mtimeMs}`;
          }
          files.set(relPath, { hash, mtime: stat.mtimeMs, size: stat.size });
        } catch {
          // Unreadable file, skip
        }
      }
    }
  }

  private isBinaryExtension(filename: string): boolean {
    const ext = '.' + filename.split('.').pop()?.toLowerCase();
    return this.binaryExtensions.has(ext);
  }

  private async emitRescanEvent(
    relPath: string,
    type: 'create' | 'modify' | 'delete',
    mtime: number,
    hashAfter: string,
    sizeAfter: number,
    hashBefore?: string
  ): Promise<void> {
    let diff: string | undefined;
    let sizeBefore: number | undefined;
    let hashBeforeFinal: string | undefined = hashBefore;

    if (type === 'modify' && hashBefore) {
      // For rescan modifies, we don't have the before content to diff
      // unless we stored snapshots. For now, no diff on rescan modifies.
      // Could be enhanced with a snapshot store.
    } else if (type === 'delete' && hashBefore) {
      // For delete, we have the hash but not content
    }

    const event: Omit<FileEvent, 'id'> = {
      project_id: this.projectId as number,
      path: relPath,
      event_type: type,
      timestamp: mtime,
      diff,
      size_before: sizeBefore,
      size_after: sizeAfter,
      hash_before: hashBeforeFinal,
      hash_after: type !== 'delete' ? hashAfter : undefined,
      detected_on_rescan: true,
    };

    await logEvent(event, { persist: false });
  }

  start(): void {
    if (this.watcher || !this.initialized) return;

    this.watcher = chokidar.watch(this.projectRoot, {
      ignored: (path: string) => {
        const relPath = relative(this.projectRoot, path);
        return this.ignoreMatcher(relPath);
      },
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
      depth: 10,
      usePolling: resolvePolling(this.projectRoot, process.platform, this.usePolling),
      interval: this.pollingIntervalMs ?? 1000,
      binaryInterval: this.pollingIntervalMs ?? 1000,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher
      .on('add', (path) => this.handleChange(path, 'create'))
      .on('change', (path) => this.handleChange(path, 'modify'))
      .on('unlink', (path) => this.handleChange(path, 'delete'))
      .on('error', (error) => console.error('Watcher error:', error));

    // Resolves when chokidar's initial scan finishes
    this.readyPromise = new Promise<void>((res) => this.watcher!.once('ready', () => res()));

    console.log(`[actis] Watching ${this.projectRoot}`);
  }

  public async whenReady(): Promise<void> {
    if (this.readyPromise) await this.readyPromise;
  }

  public async stop(): Promise<void> {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      console.log('[actis] Stopped watching');
    }
    await this.flushPending();
    saveDb();
  }

  public handleChange(filePath: string, type: 'create' | 'modify' | 'delete'): void {
    const absPath = resolve(filePath);
    const relPath = relative(this.projectRoot, absPath);
    if (relPath.startsWith('..') || relPath === '') return;

    // Check ignore patterns
    if (this.ignoreMatcher(relPath)) return;

    const now = Date.now();
    const existing = this.pendingChanges.get(relPath);
    const fileExists = existsSync(filePath);

    let content: string | undefined;
    let isBinary = false;
    let fileSize = 0;

    if (type !== 'delete' && fileExists) {
      try {
        const stat = statSync(filePath);
        fileSize = stat.size;
        // Check if binary or too large
        if (stat.size > this.maxFileSize || this.isBinaryExtension(filePath)) {
          isBinary = true;
        } else {
          content = readFileSync(filePath, 'utf-8');
        }
      } catch {
        // File might be binary or unreadable
        isBinary = true;
      }
    }

    // The "before" state
    let previousContent: string | undefined;
    let previousHash: string | undefined;

    if (type === 'delete') {
      previousContent = this.lastSeenContent.get(relPath) ?? existing?.content;
      previousHash = this.lastSeenContent.has(relPath) ? computeHash(this.lastSeenContent.get(relPath)!) : undefined;
    } else if (this.lastSeenContent.has(relPath)) {
      previousContent = this.lastSeenContent.get(relPath);
      if (previousContent !== undefined) {
        previousHash = computeHash(previousContent);
      }
    } else if (existing?.content !== undefined) {
      previousContent = existing.content;
      previousHash = computeHash(previousContent);
    }

    // Skip no-op double-fires
    if (
      existing &&
      existing.type === 'create' &&
      type === 'modify' &&
      content !== undefined &&
      existing.content !== undefined &&
      content === existing.content
    ) {
      return;
    }

    // Rename detection: if we have a recent delete with same hash, it's a rename
    let effectiveType: PendingChange['type'] = type;
    let fromPath: string | undefined;

    if (type === 'create' && content !== undefined) {
      const newHash = computeHash(content);
      for (const [delPath, delInfo] of this.recentDeletes) {
        if (delInfo.hash === newHash && (now - delInfo.timestamp) < this.debounceMs * 2) {
          // It's a rename!
          effectiveType = 'rename';
          fromPath = delPath;
          this.recentDeletes.delete(delPath);
          break;
        }
      }
    }

    // Track recent deletes for rename detection
    if (type === 'delete' && previousHash) {
      this.recentDeletes.set(relPath, { hash: previousHash, path: relPath, timestamp: now });
      // Clean old entries
      const cutoff = now - this.debounceMs * 4;
      for (const [p, info] of this.recentDeletes) {
        if (info.timestamp < cutoff) this.recentDeletes.delete(p);
      }
    }

    // A create followed by modifies within the debounce window collapses into
    // one create event carrying the final content + diff since creation.
    if (existing && existing.type === 'create' && type !== 'delete' && effectiveType !== 'rename') {
      effectiveType = 'create';
    }

    this.pendingChanges.set(relPath, {
      path: relPath,
      type: effectiveType,
      timestamp: now,
      content,
      previousContent,
      fromPath,
    });

    // Debounce
    setTimeout(() => this.flushPending(), this.debounceMs);
  }

  public async flushPending(): Promise<void> {
    if (this.isProcessing || this.pendingChanges.size === 0) return;
    this.isProcessing = true;

    const changes = Array.from(this.pendingChanges.values());
    this.pendingChanges.clear();

    for (const change of changes) {
      try {
        await this.persistChange(change);
        if (change.content !== undefined) {
          this.lastSeenContent.set(change.path, change.content);
        } else {
          this.lastSeenContent.delete(change.path);
        }
      } catch (error) {
        console.error(`[actis] Failed to persist change for ${change.path}:`, error);
      }
    }

    this.isProcessing = false;
    saveDb();
  }

  private async persistChange(change: PendingChange): Promise<void> {
    let sizeBefore: number | undefined;
    let sizeAfter: number | undefined;
    let hashBefore: string | undefined;
    let hashAfter: string | undefined;
    let diff: string | undefined;

    if (change.type === 'create' || change.type === 'rename') {
      if (change.content !== undefined) {
        sizeAfter = Buffer.byteLength(change.content, 'utf-8');
        hashAfter = computeHash(change.content);
      }
      if (
        change.previousContent !== undefined &&
        change.content !== undefined &&
        change.previousContent !== change.content
      ) {
        sizeBefore = Buffer.byteLength(change.previousContent, 'utf-8');
        hashBefore = computeHash(change.previousContent);
        diff = computeDiff(change.previousContent, change.content);
      }
    } else if (change.type === 'modify') {
      if (change.previousContent !== undefined) {
        sizeBefore = Buffer.byteLength(change.previousContent, 'utf-8');
        hashBefore = computeHash(change.previousContent);
      }
      if (change.content !== undefined) {
        sizeAfter = Buffer.byteLength(change.content, 'utf-8');
        hashAfter = computeHash(change.content);
      }
      if (change.previousContent !== undefined && change.content !== undefined) {
        diff = computeDiff(change.previousContent, change.content);
      }
    } else if (change.type === 'delete') {
      if (change.previousContent !== undefined) {
        sizeBefore = Buffer.byteLength(change.previousContent, 'utf-8');
        hashBefore = computeHash(change.previousContent);
      }
    }

    const event: Omit<FileEvent, 'id'> = {
      project_id: this.projectId as number,
      path: change.path,
      event_type: change.type,
      timestamp: change.timestamp,
      diff,
      size_before: sizeBefore,
      size_after: sizeAfter,
      hash_before: hashBefore,
      hash_after: hashAfter,
    };

    await logEvent(event, { persist: false });
  }
}

export async function createWatcher(config: WatcherConfig): Promise<ActisWatcher> {
  const watcher = new ActisWatcher(config);
  await watcher.initialize();
  return watcher;
}