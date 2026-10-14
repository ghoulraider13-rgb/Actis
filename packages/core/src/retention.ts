// Browser-safe retention policy types and core logic
// This module has NO Node imports and is safe for browser demo use

export interface RetentionPolicy {
  keepDays: number;               // default 365
  keepDiffsDays: number;          // default 90
  maxDiffsPerFile?: number;       // optional
}

export interface RetentionResult {
  eventsDeleted: number;
  diffsNulledByAge: number;
  diffsNulledByCap: number;
}

// Duck-typed DB interface (works with better-sqlite3 and sql.js)
export interface RetentionDb {
  prepare(sql: string): { run(...params: any[]): { changes: number }; all(...params: any[]): any[] };
  exec(sql: string): void;
  transaction<T>(fn: () => T): () => T;
}

export function applyRetention(db: RetentionDb, projectId: number, policy: RetentionPolicy): RetentionResult {
  const now = Date.now();
  const eventCutoff = now - policy.keepDays * 86400000;
  const diffCutoff = now - policy.keepDiffsDays * 86400000;

  let eventsDeleted = 0;
  let diffsNulledByAge = 0;
  let diffsNulledByCap = 0;

  const tx = db.transaction(() => {
    // Step 1: Delete events older than keepDays
    const deleteStmt = db.prepare(
      'DELETE FROM file_events WHERE project_id = ? AND timestamp < ?'
    );
    const deleteResult = deleteStmt.run(projectId, eventCutoff);
    eventsDeleted = deleteResult.changes;

    // Step 2: Null diffs older than keepDiffsDays but within keepDays
    // Only for events that still exist (timestamp >= eventCutoff)
    const nullAgeStmt = db.prepare(
      `UPDATE file_events 
       SET diff = NULL 
       WHERE project_id = ? 
         AND timestamp < ? 
         AND timestamp >= ? 
         AND diff IS NOT NULL`
    );
    const nullAgeResult = nullAgeStmt.run(projectId, diffCutoff, eventCutoff);
    diffsNulledByAge = nullAgeResult.changes;

    // Step 3: If maxDiffsPerFile is set, keep only latest N diffs per file
    if (policy.maxDiffsPerFile && policy.maxDiffsPerFile > 0) {
      // Use CTE to find rowids to null per file path
      // We need to null diffs for events beyond maxDiffsPerFile per path, ordered by timestamp DESC
      const nullCapStmt = db.prepare(
        `UPDATE file_events SET diff = NULL WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY path ORDER BY timestamp DESC) as rn FROM file_events WHERE project_id = ? AND diff IS NOT NULL) WHERE rn > ?)`
      );
      const nullCapResult = nullCapStmt.run(projectId, policy.maxDiffsPerFile);
      diffsNulledByCap = nullCapResult.changes;
    }

    return { eventsDeleted, diffsNulledByAge, diffsNulledByCap };
  });

  return tx();
}

// Preview retention without making changes (for dry-run)
export function previewRetention(db: RetentionDb, projectId: number, policy: RetentionPolicy): RetentionResult {
  const now = Date.now();
  const eventCutoff = now - policy.keepDays * 86400000;
  const diffCutoff = now - policy.keepDiffsDays * 86400000;

  // Count events to delete
  const deleteCountStmt = db.prepare(
    'SELECT COUNT(*) as count FROM file_events WHERE project_id = ? AND timestamp < ?'
  );
  const eventsDeleted = (deleteCountStmt.all(projectId, eventCutoff)[0] as { count: number }).count;

  // Count diffs to null by age
  const nullAgeCountStmt = db.prepare(
    `SELECT COUNT(*) as count FROM file_events 
     WHERE project_id = ? 
       AND timestamp < ? 
       AND timestamp >= ? 
       AND diff IS NOT NULL`
  );
  const diffsNulledByAge = (nullAgeCountStmt.all(projectId, diffCutoff, eventCutoff)[0] as { count: number }).count;

  // Count diffs to null by cap
  let diffsNulledByCap = 0;
  if (policy.maxDiffsPerFile && policy.maxDiffsPerFile > 0) {
    const nullCapCountStmt = db.prepare(
      `SELECT COUNT(*) as count FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY path ORDER BY timestamp DESC) as rn
        FROM file_events
        WHERE project_id = ? AND diff IS NOT NULL
      ) WHERE rn > ?`
    );
    diffsNulledByCap = (nullCapCountStmt.all(projectId, policy.maxDiffsPerFile)[0] as { count: number }).count;
  }

  return { eventsDeleted, diffsNulledByAge, diffsNulledByCap };
}