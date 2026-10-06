// Database schema and operations for actis (using better-sqlite3 - Node only)
// This file is NOT browser-safe; use packages/core/types.ts for shared types

import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync } from 'fs';
import type { FileEvent, Project, QueryResult } from './types.js';

// Re-export types for internal use
export type { FileEvent, Project, QueryResult } from './types.js';

const DB_DIR = join(homedir(), '.actis');
const DB_PATH = join(DB_DIR, 'ledger.db');

// For testing: allow override via ACTIS_HOME
function getDbDir(): string {
  return process.env.ACTIS_HOME || join(homedir(), '.actis');
}

function getDbPath(): string {
  return join(getDbDir(), 'ledger.db');
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dir = getDbDir();
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    db = new Database(getDbPath());
    // Enable WAL mode for concurrent read/write (daemon + CLI queries)
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initDb(db);
  }
  return db;
}

function initDb(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      root_path TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS file_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      path TEXT NOT NULL,
      event_type TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      diff TEXT,
      size_before INTEGER,
      size_after INTEGER,
      hash_before TEXT,
      hash_after TEXT,
      detected_on_rescan INTEGER DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE INDEX IF NOT EXISTS idx_events_project_time
      ON file_events(project_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_events_path
      ON file_events(project_id, path);
  `);
}

export function saveDb() {
  // better-sqlite3 is synchronous and auto-commits; no explicit save needed
  // Kept for API compatibility with existing code
}

function rowToProject(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    root_path: row.root_path,
    created_at: row.created_at,
    is_active: row.is_active,
  };
}

function rowToEvent(row: any): FileEvent {
  return {
    id: row.id,
    project_id: row.project_id,
    path: row.path,
    event_type: row.event_type,
    timestamp: row.timestamp,
    diff: row.diff ?? undefined,
    size_before: row.size_before ?? undefined,
    size_after: row.size_after ?? undefined,
    hash_before: row.hash_before ?? undefined,
    hash_after: row.hash_after ?? undefined,
    detected_on_rescan: Boolean(row.detected_on_rescan),
  };
}

export function createProject(name: string, rootPath: string): Project {
  const database = getDb();
  const existing = getProjectByPathSync(database, rootPath);
  if (existing) return existing;

  const stmt = database.prepare(`
    INSERT INTO projects (name, root_path, created_at, is_active)
    VALUES (?, ?, ?, 1)
  `);
  const result = stmt.run(name, rootPath, Date.now());
  const id = Number(result.lastInsertRowid);

  return { id, name, root_path: rootPath, created_at: Date.now(), is_active: 1 };
}

function getProjectByPathSync(database: Database.Database, rootPath: string): Project | undefined {
  const row = database.prepare('SELECT * FROM projects WHERE root_path = ?').get(rootPath);
  return row ? rowToProject(row) : undefined;
}

export function getProjectByPath(rootPath: string): Project | undefined {
  const database = getDb();
  return getProjectByPathSync(database, rootPath);
}

export function getActiveProjects(): Project[] {
  const database = getDb();
  const rows = database.prepare('SELECT * FROM projects WHERE is_active = 1 ORDER BY created_at DESC').all();
  return rows.map(rowToProject);
}

export function logEvent(
  event: Omit<FileEvent, 'id'>,
  options: { persist?: boolean } = {},
): number {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO file_events (project_id, path, event_type, timestamp, diff, size_before, size_after, hash_before, hash_after, detected_on_rescan)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    event.project_id,
    event.path,
    event.event_type,
    event.timestamp,
    event.diff ?? null,
    event.size_before ?? null,
    event.size_after ?? null,
    event.hash_before ?? null,
    event.hash_after ?? null,
    event.detected_on_rescan ? 1 : 0,
  );
  return Number(result.lastInsertRowid);
}

export function queryEvents(projectId: number, options: {
  since?: number;
  until?: number;
  path?: string;
  eventType?: string;
  limit?: number;
  offset?: number;
} = {}): QueryResult {
  const database = getDb();
  let sql = 'SELECT * FROM file_events WHERE project_id = ?';
  const params: (number | string)[] = [projectId];

  if (options.since) {
    sql += ' AND timestamp >= ?';
    params.push(options.since);
  }
  if (options.until) {
    sql += ' AND timestamp <= ?';
    params.push(options.until);
  }
  if (options.path) {
    sql += ' AND path LIKE ?';
    params.push(`%${options.path}%`);
  }
  if (options.eventType) {
    sql += ' AND event_type = ?';
    params.push(options.eventType);
  }

  sql += ' ORDER BY timestamp DESC';

  if (options.limit) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }
  if (options.offset) {
    sql += ' OFFSET ?';
    params.push(options.offset);
  }

  const events = database.prepare(sql).all(...params).map(rowToEvent);

  // Get total count
  let countSql = 'SELECT COUNT(*) as count FROM file_events WHERE project_id = ?';
  const countParams: (number | string)[] = [projectId];
  if (options.since) {
    countSql += ' AND timestamp >= ?';
    countParams.push(options.since);
  }
  if (options.until) {
    countSql += ' AND timestamp <= ?';
    countParams.push(options.until);
  }
  if (options.path) {
    countSql += ' AND path LIKE ?';
    countParams.push(`%${options.path}%`);
  }
  if (options.eventType) {
    countSql += ' AND event_type = ?';
    countParams.push(options.eventType);
  }

  const countRow = database.prepare(countSql).get(...countParams) as { count: number } | undefined;
  const total = countRow?.count ?? 0;

  return { events, total };
}

export function getEventById(id: number): FileEvent | undefined {
  const database = getDb();
  const row = database.prepare('SELECT * FROM file_events WHERE id = ?').get(id);
  return row ? rowToEvent(row) : undefined;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

// For testing: force reinitialize with new ACTIS_HOME
export function resetDbForTesting() {
  closeDb();
}