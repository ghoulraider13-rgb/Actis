// Database schema and operations for actis (using sql.js - pure JS SQLite)
import initSqlJs, { Database } from 'sql.js';
import { createRequire } from 'module';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

export interface FileEvent {
  id?: number;
  path: string;
  event_type: 'create' | 'modify' | 'delete' | 'rename';
  timestamp: number;
  diff?: string;
  size_before?: number;
  size_after?: number;
  hash_before?: string;
  hash_after?: string;
  project_id: number;
}

export interface Project {
  id?: number;
  name: string;
  root_path: string;
  created_at: number;
  is_active: number;
}

export interface QueryResult {
  events: FileEvent[];
  total: number;
}

const DB_PATH = join(homedir(), '.actis', 'ledger.db');

// Resolve modules relative to THIS file so the compiled dist/ works from anywhere.
const nodeRequire = createRequire(import.meta.url);

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!db) {
    const dir = join(homedir(), '.actis');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Resolve the sql.js WASM binary LOCALLY - no network fetch, ever (offline guarantee).
    const wasmPath = nodeRequire.resolve('sql.js/dist/sql-wasm.wasm');
    const SQL = await initSqlJs({ locateFile: () => wasmPath });

    // Load existing database or create new
    let dbData: Uint8Array | undefined;
    if (existsSync(DB_PATH)) {
      dbData = new Uint8Array(readFileSync(DB_PATH));
    }

    db = new SQL.Database(dbData);
    initDb(db);
  }
  return db;
}

function initDb(database: Database) {
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
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE INDEX IF NOT EXISTS idx_events_project_time
      ON file_events(project_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_events_path
      ON file_events(project_id, path);
  `);
}

export function saveDb() {
  if (db) {
    const data = db.export();
    writeFileSync(DB_PATH, data);
  }
}

// sql.js read helpers: getAsObject() THROWS "column index out of range" when
// no row matches, and get() without a prior step() returns []. These wrappers
// always step() first and return null on no match.
type Row = Record<string, unknown>;

function queryOne(database: Database, sql: string, params: (number | string)[] = []): Row | null {
  const stmt = database.prepare(sql);
  if (params.length) stmt.bind(params);
  let row: Row | null = null;
  while (stmt.step()) {
    row = stmt.getAsObject() as Row;
    break;
  }
  stmt.free();
  return row;
}

function queryRows(database: Database, sql: string, params: (number | string)[] = []): Row[] {
  const stmt = database.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows: Row[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as Row);
  }
  stmt.free();
  return rows;
}

export async function createProject(name: string, rootPath: string): Promise<Project> {
  const database = await getDb();
  const existing = getProjectByPathSync(database, rootPath);
  if (existing) return existing;

  database.prepare(`
    INSERT INTO projects (name, root_path, created_at, is_active)
    VALUES (?, ?, ?, 1)
  `).run([name, rootPath, Date.now()]);

  const idRow = queryOne(database, 'SELECT last_insert_rowid() AS id');
  const id = Number(idRow?.id ?? 0);

  saveDb();
  return { id, name, root_path: rootPath, created_at: Date.now(), is_active: 1 };
}

function getProjectByPathSync(database: Database, rootPath: string): Project | undefined {
  const row = queryOne(database, 'SELECT * FROM projects WHERE root_path = ?', [rootPath]);
  if (!row) return undefined;
  return {
    id: Number(row.id),
    name: String(row.name),
    root_path: String(row.root_path),
    created_at: Number(row.created_at),
    is_active: Number(row.is_active),
  };
}

export async function getProjectByPath(rootPath: string): Promise<Project | undefined> {
  const database = await getDb();
  return getProjectByPathSync(database, rootPath);
}

export async function getActiveProjects(): Promise<Project[]> {
  const database = await getDb();
  return queryRows(database, 'SELECT * FROM projects WHERE is_active = 1 ORDER BY created_at DESC').map(row => ({
    id: Number(row.id),
    name: String(row.name),
    root_path: String(row.root_path),
    created_at: Number(row.created_at),
    is_active: Number(row.is_active),
  }));
}

export async function logEvent(
  event: Omit<FileEvent, 'id'>,
  options: { persist?: boolean } = {},
): Promise<number> {
  const database = await getDb();
  database.prepare(`
    INSERT INTO file_events (project_id, path, event_type, timestamp, diff, size_before, size_after, hash_before, hash_after)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run([
    event.project_id,
    event.path,
    event.event_type,
    event.timestamp,
    event.diff || null,
    event.size_before ?? null,
    event.size_after ?? null,
    event.hash_before ?? null,
    event.hash_after ?? null,
  ]);

  const idRow = queryOne(database, 'SELECT last_insert_rowid() AS id');
  const id = Number(idRow?.id ?? 0);

  // persist:false lets the watcher batch a flush and save once; default true
  // saves immediately so every event is crash-safe on disk.
  if (options.persist !== false) saveDb();
  return id;
}

export async function queryEvents(projectId: number, options: {
  since?: number;
  until?: number;
  path?: string;
  eventType?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<QueryResult> {
  const database = await getDb();
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

  const events = queryRows(database, sql, params).map(row => ({
    id: Number(row.id),
    project_id: Number(row.project_id),
    path: String(row.path),
    event_type: String(row.event_type) as FileEvent['event_type'],
    timestamp: Number(row.timestamp),
    diff: row.diff === null || row.diff === undefined ? undefined : String(row.diff),
    size_before: row.size_before === null || row.size_before === undefined ? undefined : Number(row.size_before),
    size_after: row.size_after === null || row.size_after === undefined ? undefined : Number(row.size_after),
    hash_before: row.hash_before === null || row.hash_before === undefined ? undefined : String(row.hash_before),
    hash_after: row.hash_after === null || row.hash_after === undefined ? undefined : String(row.hash_after),
  }));

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

  const countRow = queryOne(database, countSql, countParams);
  const total = Number(countRow?.count ?? 0);

  return { events, total };
}

export async function getEventById(id: number): Promise<FileEvent | undefined> {
  const database = await getDb();
  const row = queryOne(database, 'SELECT * FROM file_events WHERE id = ?', [id]);
  if (!row) return undefined;
  return {
    id: Number(row.id),
    project_id: Number(row.project_id),
    path: String(row.path),
    event_type: String(row.event_type) as FileEvent['event_type'],
    timestamp: Number(row.timestamp),
    diff: row.diff === null || row.diff === undefined ? undefined : String(row.diff),
    size_before: row.size_before === null || row.size_before === undefined ? undefined : Number(row.size_before),
    size_after: row.size_after === null || row.size_after === undefined ? undefined : Number(row.size_after),
    hash_before: row.hash_before === null || row.hash_before === undefined ? undefined : String(row.hash_before),
    hash_after: row.hash_after === null || row.hash_after === undefined ? undefined : String(row.hash_after),
  };
}

export function closeDb() {
  if (db) {
    saveDb();
    db.close();
    db = null;
  }
}
