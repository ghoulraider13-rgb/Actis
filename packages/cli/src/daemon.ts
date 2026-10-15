// Daemon lifecycle management for `actis watch --daemon`.
//
// The parent (CLI) spawns a fully detached worker subprocess that re-invokes
// this CLI binary with the `daemon-worker` argument. The worker runs the
// filesystem watcher, installs a SIGTERM handler that flushes pending events
// and closes the database, and removes its PID file on exit. The CLI exposes
// `start` / `stop` / `status` (and the `--daemon` flag on `watch`) backed by
// the helpers below. No third-party dependencies are required.
import { spawn } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from 'fs';
import { fileURLToPath } from 'url';
import { createWatcher, closeDb } from '@actis/core';
import type { ActisWatcher } from '@actis/core';

export interface DaemonConfig {
  projectPath: string;
  projectName: string;
  debounceMs: number;
  usePolling?: boolean;
  pollingIntervalMs: number;
  rescanOnStart: boolean;
}

export interface DaemonResult {
  pid: number;
  projectPath: string;
}

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  projectPath?: string;
  projectName?: string;
  startedAt?: number;
  uptimeMs?: number;
}

export interface StopResult {
  success: boolean;
  pid?: number;
  error?: string;
}

interface PidFileData {
  pid: number;
  projectPath: string;
  projectName: string;
  startedAt: number;
}

// --- Path helpers (reuses core/db.ts convention: ACTIS_HOME || ~/.actis) ---
function getActisDir(): string {
  return process.env.ACTIS_HOME || join(homedir(), '.actis');
}

function getPidFilePath(): string {
  return join(getActisDir(), 'actis.pid');
}

function getLogFilePath(): string {
  return join(getActisDir(), 'daemon.log');
}

function ensureActisDir(): void {
  const dir = getActisDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// --- PID file helpers ---
function writePidFile(data: PidFileData): void {
  ensureActisDir();
  writeFileSync(getPidFilePath(), JSON.stringify(data), { mode: 0o600 });
}

function readPidFile(): PidFileData | null {
  const pidFile = getPidFilePath();
  if (!existsSync(pidFile)) return null;
  try {
    return JSON.parse(readFileSync(pidFile, 'utf-8')) as PidFileData;
  } catch {
    return null;
  }
}

function removePidFile(): void {
  const pidFile = getPidFilePath();
  try {
    if (existsSync(pidFile)) {
      unlinkSync(pidFile);
    }
  } catch {
    // Best-effort cleanup; a missing/unreadable file shouldn't abort shutdown.
  }
}

// --- Process health ---
function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 is the POSIX "does this process exist?" probe.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Worker entry point. Invoked as a detached subprocess by `startDaemon`.
 *
 * Runs the filesystem watcher with a SIGTERM handler that flushes the pending
 * debounce batch, saves/closes the database, removes the PID file, and exits 0.
 */
export async function runDaemonWorker(): Promise<void> {
  // Args after `daemon-worker`: projectPath, projectName, debounceMs,
  // usePolling ('true'|'false'|'auto'), pollingIntervalMs, rescanOnStart.
  const args = process.argv.slice(3);
  if (args.length < 6) {
    console.error('[actis daemon] Invalid worker arguments; expected projectPath projectName debounceMs usePolling pollingIntervalMs rescanOnStart');
    process.exit(1);
  }

  const [projectPath, projectName, debounceMsStr, usePollingStr, pollingIntervalMsStr, rescanOnStartStr] = args;
  const debounceMs = parseInt(debounceMsStr, 10);
  const usePolling =
    usePollingStr === 'true' ? true : usePollingStr === 'false' ? false : undefined;
  const pollingIntervalMs = parseInt(pollingIntervalMsStr, 10);
  const rescanOnStart = rescanOnStartStr === 'true';

  let watcher: ActisWatcher | null = null;
  let shuttingDown = false;

  // Install signal handlers early — even a SIGTERM arriving during init
  // must trigger a clean shutdown and PID file removal.
  const handleShutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('[actis daemon] SIGTERM received, shutting down gracefully...');
    try {
      // flushPending() is invoked inside watcher.stop() — persists the
      // in-flight debounce batch and saves the DB.
      if (watcher) {
        await watcher.stop();
      }
      closeDb();
      removePidFile();
      console.log('[actis daemon] Shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('[actis daemon] Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', handleShutdown);
  process.on('SIGINT', handleShutdown);

  try {
    watcher = await createWatcher({
      projectRoot: projectPath,
      debounceMs,
      usePolling,
      pollingIntervalMs,
      rescanOnStart,
    });
    watcher.start();
    await watcher.whenReady();

    console.log(`[actis daemon] Started watching "${projectName}" at ${projectPath}`);
  } catch (error) {
    console.error('[actis daemon] Worker initialization failed:', error);
    removePidFile();
    process.exit(1);
  }

  // Keep the event loop alive. chokidar's persistent watchers also pin the
  // process, but the never-resolving promise is a safe backstop so the worker
  // doesn't exit if the watcher has no pending fs handles at a given instant.
  await new Promise(() => {});
}

/**
 * Start the daemon: spawn a detached worker, write the PID file, verify the
 * worker is alive, and return its PID.
 */
export async function startDaemon(config: DaemonConfig): Promise<DaemonResult> {
  // Refuse to start if a live daemon is already running.
  const existing = readPidFile();
  if (existing && isProcessAlive(existing.pid)) {
    throw new Error(
      `Daemon already running (PID ${existing.pid}) watching "${existing.projectName}" at ${existing.projectPath}`,
    );
  }
  // Stale PID file from a crashed process — clean it up.
  if (existing) {
    removePidFile();
  }

  // Prepare a fresh log file (truncate = rotate on restart).
  ensureActisDir();
  const logFd = openSync(getLogFilePath(), 'w');

  // Re-invoke this CLI binary as the daemon worker (works from compiled dist).
  const workerScript = fileURLToPath(import.meta.url);

  const child = spawn(
    process.execPath,
    [
      workerScript,
      'daemon-worker',
      config.projectPath,
      config.projectName,
      String(config.debounceMs),
      config.usePolling === undefined ? 'auto' : String(config.usePolling),
      String(config.pollingIntervalMs ?? 1000),
      String(config.rescanOnStart),
    ],
    {
      detached: true, // become session leader -> survives parent exit
      stdio: ['ignore', logFd, logFd], // stdout/stderr -> daemon.log
    },
  );

  // The child inherited a duplicate of the log fd at fork time; release the
  // parent's copy now. (Closing it here does NOT affect the child's copy.)
  closeSync(logFd);

  // Detach so this CLI process can exit without taking the worker with it.
  child.unref();

  if (!child.pid) {
    removePidFile();
    throw new Error('Daemon failed to start (could not obtain child PID)');
  }

  // Write the PID file from the parent immediately so `status` works right
  // away. The child.pid is the worker process PID.
  const pidData: PidFileData = {
    pid: child.pid,
    projectPath: config.projectPath,
    projectName: config.projectName,
    startedAt: Date.now(),
  };
  writePidFile(pidData);

  // Give the worker a moment to initialize; fail fast if it exits immediately
  // (e.g. bad config, project missing, init error).
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (!isProcessAlive(child.pid)) {
    removePidFile();
    throw new Error('Daemon failed to start (see log: ' + getLogFilePath() + ')');
  }

  return { pid: child.pid, projectPath: config.projectPath };
}

/**
 * Stop a running daemon: send SIGTERM, wait up to 5s for graceful shutdown,
 * then remove the PID file.
 */
export async function stopDaemon(): Promise<StopResult> {
  const pidData = readPidFile();
  if (!pidData) {
    return { success: false, error: 'No daemon running (PID file not found)' };
  }

  const pid = pidData.pid;
  if (!isProcessAlive(pid)) {
    // Process already dead — clean up the stale PID file.
    removePidFile();
    return { success: false, error: `Daemon not running (stale PID ${pid})` };
  }

  // Send SIGTERM for graceful shutdown (worker flushes + saves DB + exits 0).
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    return { success: false, error: `Failed to send SIGTERM to PID ${pid}: ${error}` };
  }

  // Poll for exit (max 5 seconds).
  const maxWaitMs = 5000;
  const pollIntervalMs = 100;
  let waitedMs = 0;

  while (waitedMs < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    waitedMs += pollIntervalMs;
    if (!isProcessAlive(pid)) {
      // Process exited gracefully; remove the PID file.
      removePidFile();
      return { success: true, pid };
    }
  }

  // The worker did not honor SIGTERM within the grace window.
  return { success: false, error: `Daemon (PID ${pid}) did not stop within 5 seconds` };
}

/**
 * Report daemon status: read the PID file, check if the process is alive.
 */
export function getDaemonStatus(): DaemonStatus {
  const pidData = readPidFile();
  if (!pidData) {
    return { running: false };
  }

  const alive = isProcessAlive(pidData.pid);
  if (!alive) {
    // Stale PID file — the process died without removing it.
    return { running: false };
  }

  return {
    running: true,
    pid: pidData.pid,
    projectPath: pidData.projectPath,
    projectName: pidData.projectName,
    startedAt: pidData.startedAt,
    uptimeMs: Date.now() - pidData.startedAt,
  };
}

// When this module was spawned with the `daemon-worker` sentinel argument,
// run the worker loop instead of exposing the CLI. The CLI guards its own
// `program.parse()` so commander never sees the unknown sentinel command.
const isWorker = process.argv[2] === 'daemon-worker';
if (isWorker) {
  runDaemonWorker().catch((error) => {
    console.error('[actis daemon] Worker fatal error:', error);
    process.exit(1);
  });
}
