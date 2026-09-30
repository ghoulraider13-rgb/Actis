// Filesystem watcher for actis
import chokidar, { FSWatcher } from 'chokidar';
import { relative, resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { getProjectByPath, logEvent, saveDb, FileEvent } from './db.js';
import { computeHash, computeDiff } from './diff.js';

export interface WatcherConfig {
  projectRoot: string;
  ignorePatterns?: string[];
  debounceMs?: number;
}

interface PendingChange {
  path: string;
  type: 'create' | 'modify' | 'delete';
  timestamp: number;
  content?: string;
  previousContent?: string;
}

export class ActisWatcher {
  private watcher: FSWatcher | null = null;
  private projectRoot: string;
  private projectId: number | undefined;
  private pendingChanges: Map<string, PendingChange> = new Map();
  // Last-seen content survives flushes — every later modify can then carry a
  // real diff, not just edits landing within one debounce window.
  private lastSeenContent: Map<string, string> = new Map();
  private debounceMs: number;
  private ignorePatterns: string[];
  private isProcessing = false;
  private initialized = false;

  constructor(config: WatcherConfig) {
    this.projectRoot = resolve(config.projectRoot);
    this.debounceMs = config.debounceMs || 500;
    this.ignorePatterns = config.ignorePatterns || [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/.actis/**',
      '**/*.log',
      '**/*.tmp',
      '**/.DS_Store',
      '**/Thumbs.db',
    ];
  }

  async initialize(): Promise<void> {
    const project = await getProjectByPath(this.projectRoot);
    if (!project) {
      throw new Error(`Project not found for path: ${this.projectRoot}`);
    }
    this.projectId = project.id!;
    this.initialized = true;
  }

  start(): void {
    if (this.watcher || !this.initialized) return;

    this.watcher = chokidar.watch(this.projectRoot, {
      ignored: this.ignorePatterns,
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
      depth: 10,
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

    console.log(`[actis] Watching ${this.projectRoot}`);
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      console.log('[actis] Stopped watching');
    }
    // Flush whatever is pending, then persist the batch to disk.
    await this.flushPending();
    saveDb();
  }

  private handleChange(filePath: string, type: 'create' | 'modify' | 'delete'): void {
    const relPath = relative(this.projectRoot, filePath);
    const now = Date.now();

    const existing = this.pendingChanges.get(relPath);
    const fileExists = existsSync(filePath);

    let content: string | undefined;
    if (type !== 'delete' && fileExists) {
      try {
        content = readFileSync(filePath, 'utf-8');
      } catch {
        // File might be binary or unreadable — no content snapshot.
      }
    }

    // The "before" state is whatever we LAST saw for this file:
    // - delete: the content captured by the earlier create/modify event
    // - modify of a file seen earlier: that previous snapshot (a real diff)
    // - modify of an unseen file: chokidar fires after the write settles, so
    //   pre-change content is unknowable — no diff recorded (honest).
    let previousContent: string | undefined;
    if (type === 'delete') {
      previousContent = this.lastSeenContent.get(relPath) ?? existing?.content;
    } else if (this.lastSeenContent.has(relPath)) {
      previousContent = this.lastSeenContent.get(relPath);
    } else if (existing?.content !== undefined) {
      previousContent = existing.content;
    }

    // Skip no-op double-fires: chokidar often emits add + change for the same
    // untouched content — a create followed by an identical modify.
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

    // A create followed by modifies within the debounce window collapses into
    // one create event carrying the final content + diff since creation.
    const effectiveType: PendingChange['type'] =
      existing && existing.type === 'create' && type !== 'delete' ? 'create' : type;

    this.pendingChanges.set(relPath, {
      path: relPath,
      type: effectiveType,
      timestamp: now,
      content,
      previousContent,
    });

    // Debounce: flush after a quiet period (multiple timers are fine —
    // flushPending is guarded by isProcessing and clears the map).
    setTimeout(() => this.flushPending(), this.debounceMs);
  }

  private async flushPending(): Promise<void> {
    if (this.isProcessing || this.pendingChanges.size === 0) return;
    this.isProcessing = true;

    const changes = Array.from(this.pendingChanges.values());
    this.pendingChanges.clear();

    for (const change of changes) {
      try {
        await this.persistChange(change);
        // Persist the "after" state as the next event's "before".
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
    // Batch semantics: one disk save per flush, not one per event.
    saveDb();
  }

  private async persistChange(change: PendingChange): Promise<void> {
    let sizeBefore: number | undefined;
    let sizeAfter: number | undefined;
    let hashBefore: string | undefined;
    let hashAfter: string | undefined;
    let diff: string | undefined;

    if (change.type === 'create') {
      if (change.content !== undefined) {
        sizeAfter = Buffer.byteLength(change.content, 'utf-8');
        hashAfter = computeHash(change.content);
      }
      // Collapsed create+modify: record what changed since the creation snapshot.
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

    // persist:false — the flush saves the whole batch once at the end.
    await logEvent(event, { persist: false });
  }
}

export async function createWatcher(config: WatcherConfig): Promise<ActisWatcher> {
  const watcher = new ActisWatcher(config);
  await watcher.initialize();
  return watcher;
}
