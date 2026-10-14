import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyRetention, type RetentionDb, type RetentionPolicy } from '../src/retention.js';

// Mock database that tracks SQL operations
function createMockDb() {
  const tables: Record<string, any[]> = {
    file_events: [],
  };

  let transactionDepth = 0;

  const db: RetentionDb = {
    prepare(sql: string) {
      return {
        run(...params: any[]) {
          if (sql.startsWith('DELETE')) {
            const [projectId, timestamp] = params;
            const before = tables.file_events.length;
            tables.file_events = tables.file_events.filter(
              (e) => !(e.project_id === projectId && e.timestamp < timestamp)
            );
            return { changes: before - tables.file_events.length };
          }
          if (sql.startsWith('UPDATE') && sql.includes('SET diff = NULL')) {
            if (sql.includes('ROW_NUMBER') || sql.includes('PARTITION BY path')) {
              // maxDiffsPerFile case - use CTE to find and null
              const [projectId, maxDiffs] = params;
              const events = tables.file_events
                .filter((e) => e.project_id === projectId && e.diff !== null)
                .sort((a, b) => b.timestamp - a.timestamp);
              
              const byPath = new Map<string, typeof events>();
              for (const e of events) {
                if (!byPath.has(e.path)) byPath.set(e.path, []);
                byPath.get(e.path)!.push(e);
              }
              
              let changes = 0;
              for (const [, pathEvents] of byPath) {
                for (let i = maxDiffs; i < pathEvents.length; i++) {
                  pathEvents[i].diff = null;
                  changes++;
                }
              }
              return { changes };
            }
            const [projectId, diffCutoff, eventCutoff] = params;
            let changes = 0;
            for (const e of tables.file_events) {
              if (
                e.project_id === projectId &&
                e.timestamp < diffCutoff &&
                e.timestamp >= eventCutoff &&
                e.diff !== null
              ) {
                e.diff = null;
                changes++;
              }
            }
            return { changes };
          }
          return { changes: 0 };
        },
        all(...params: any[]) {
          if (sql.startsWith('SELECT COUNT') && sql.includes('file_events')) {
            if (sql.includes('WHERE project_id = ? AND timestamp < ?')) {
              // delete count
              const [projectId, timestamp] = params;
              const count = tables.file_events.filter(
                (e) => e.project_id === projectId && e.timestamp < timestamp
              ).length;
              return [{ count }];
            }
            if (sql.includes('timestamp < ? AND timestamp >= ? AND diff IS NOT NULL')) {
              // null age count
              const [projectId, diffCutoff, eventCutoff] = params;
              const count = tables.file_events.filter(
                (e) => e.project_id === projectId &&
                  e.timestamp < diffCutoff &&
                  e.timestamp >= eventCutoff &&
                  e.diff !== null
              ).length;
              return [{ count }];
            }
            if (sql.includes('ROW_NUMBER') && sql.includes('PARTITION BY path')) {
              // maxDiffsPerFile count
              const [projectId, maxDiffs] = params;
              const events = tables.file_events
                .filter((e) => e.project_id === projectId && e.diff !== null)
                .sort((a, b) => b.timestamp - a.timestamp);
              
              const byPath = new Map<string, typeof events>();
              for (const e of events) {
                if (!byPath.has(e.path)) byPath.set(e.path, []);
                byPath.get(e.path)!.push(e);
              }
              
              let count = 0;
              for (const [, pathEvents] of byPath) {
                count += Math.max(0, pathEvents.length - maxDiffs);
              }
              return [{ count }];
            }
          }
          return [{ count: 0 }];
        },
      };
    },
    exec(_sql: string) {
      // No-op for mock
    },
    transaction<T>(fn: () => T): () => T {
      transactionDepth++;
      return () => {
        try {
          return fn();
        } finally {
          transactionDepth--;
        }
      };
    },
  };

  return { db, tables };
}

describe('applyRetention', () => {
  let mock: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mock = createMockDb();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('deletes events older than keepDays', () => {
    const now = Date.now();
    mock.tables.file_events = [
      { id: 1, project_id: 1, path: 'a.txt', event_type: 'create', timestamp: now - 400 * 86400000, diff: 'diff1' }, // 400 days old - deleted
      { id: 2, project_id: 1, path: 'b.txt', event_type: 'modify', timestamp: now - 200 * 86400000, diff: 'diff2' }, // 200 days old - within keepDays, diff nulled (200 > 90)
      { id: 3, project_id: 1, path: 'c.txt', event_type: 'create', timestamp: now - 10 * 86400000, diff: 'diff3' },  // 10 days old - kept fully
    ];

    const policy: RetentionPolicy = { keepDays: 365, keepDiffsDays: 90 };
    const result = applyRetention(mock.db, 1, policy);

    expect(result.eventsDeleted).toBe(1);
    expect(result.diffsNulledByAge).toBe(1); // 200-day event has diff nulled (between 90-365 days)
    expect(result.diffsNulledByCap).toBe(0);
    expect(mock.tables.file_events.length).toBe(2);
    expect(mock.tables.file_events.map((e) => e.id)).toEqual([2, 3]);
    expect(mock.tables.file_events.find((e) => e.id === 2)?.diff).toBeNull();
    expect(mock.tables.file_events.find((e) => e.id === 3)?.diff).toBe('diff3');
  });

  it('nulls diffs older than keepDiffsDays but within keepDays', () => {
    const now = Date.now();
    mock.tables.file_events = [
      { id: 1, project_id: 1, path: 'a.txt', event_type: 'modify', timestamp: now - 200 * 86400000, diff: 'diff1' }, // 200 days old, diff should be nulled
      { id: 2, project_id: 1, path: 'b.txt', event_type: 'modify', timestamp: now - 50 * 86400000, diff: 'diff2' },  // 50 days old, diff kept
    ];

    const policy: RetentionPolicy = { keepDays: 365, keepDiffsDays: 90 };
    const result = applyRetention(mock.db, 1, policy);

    expect(result.eventsDeleted).toBe(0);
    expect(result.diffsNulledByAge).toBe(1);
    expect(result.diffsNulledByCap).toBe(0);
    expect(mock.tables.file_events[0].diff).toBeNull();
    expect(mock.tables.file_events[1].diff).toBe('diff2');
  });

  it('keeps recent events fully intact', () => {
    const now = Date.now();
    mock.tables.file_events = [
      { id: 1, project_id: 1, path: 'a.txt', event_type: 'modify', timestamp: now - 10 * 86400000, diff: 'diff1' },
      { id: 2, project_id: 1, path: 'b.txt', event_type: 'modify', timestamp: now - 5 * 86400000, diff: 'diff2' },
    ];

    const policy: RetentionPolicy = { keepDays: 365, keepDiffsDays: 90 };
    const result = applyRetention(mock.db, 1, policy);

    expect(result.eventsDeleted).toBe(0);
    expect(result.diffsNulledByAge).toBe(0);
    expect(result.diffsNulledByCap).toBe(0);
    expect(mock.tables.file_events[0].diff).toBe('diff1');
    expect(mock.tables.file_events[1].diff).toBe('diff2');
  });

  it('applies maxDiffsPerFile to keep only latest N diffs per file', () => {
    const now = Date.now();
    mock.tables.file_events = [
      { id: 1, project_id: 1, path: 'a.txt', event_type: 'modify', timestamp: now - 50 * 86400000, diff: 'diff1' },  // oldest
      { id: 2, project_id: 1, path: 'a.txt', event_type: 'modify', timestamp: now - 40 * 86400000, diff: 'diff2' },
      { id: 3, project_id: 1, path: 'a.txt', event_type: 'modify', timestamp: now - 30 * 86400000, diff: 'diff3' },
      { id: 4, project_id: 1, path: 'a.txt', event_type: 'modify', timestamp: now - 20 * 86400000, diff: 'diff4' },
      { id: 5, project_id: 1, path: 'a.txt', event_type: 'modify', timestamp: now - 10 * 86400000, diff: 'diff5' },   // newest
      { id: 6, project_id: 1, path: 'b.txt', event_type: 'modify', timestamp: now - 15 * 86400000, diff: 'diff6' }, // only one diff
    ];

    const policy: RetentionPolicy = { keepDays: 365, keepDiffsDays: 90, maxDiffsPerFile: 3 };
    const result = applyRetention(mock.db, 1, policy);

    expect(result.eventsDeleted).toBe(0);
    expect(result.diffsNulledByAge).toBe(0);
    expect(result.diffsNulledByCap).toBe(2); // 5 - 3 = 2 diffs nulled for a.txt
    
    // a.txt should have only 3 latest diffs (ids 3, 4, 5)
    const aEvents = mock.tables.file_events.filter((e) => e.path === 'a.txt');
    const aDiffs = aEvents.map((e) => e.diff);
    expect(aDiffs.filter((d) => d === null).length).toBe(2);
    expect(aDiffs.filter((d) => d !== null).length).toBe(3);
    
    // b.txt should be unchanged (only 1 diff, max is 3)
    const bEvents = mock.tables.file_events.filter((e) => e.path === 'b.txt');
    expect(bEvents[0].diff).toBe('diff6');
  });

  it('runs all operations in a single transaction (atomicity)', () => {
    const now = Date.now();
    mock.tables.file_events = [
      { id: 1, project_id: 1, path: 'a.txt', event_type: 'create', timestamp: now - 400 * 86400000, diff: 'diff1' },
      { id: 2, project_id: 1, path: 'b.txt', event_type: 'modify', timestamp: now - 50 * 86400000, diff: 'diff2' }, // 50 days - within keepDiffsDays, kept fully
    ];

    const policy: RetentionPolicy = { keepDays: 365, keepDiffsDays: 90 };
    
    const result = applyRetention(mock.db, 1, policy);

    expect(result.eventsDeleted).toBe(1);
    expect(result.diffsNulledByAge).toBe(0); // 50-day event is within keepDiffsDays
    // Both operations should complete together
    expect(mock.tables.file_events.length).toBe(1);
  });

  it('handles empty database gracefully', () => {
    const policy: RetentionPolicy = { keepDays: 365, keepDiffsDays: 90 };
    const result = applyRetention(mock.db, 1, policy);

    expect(result.eventsDeleted).toBe(0);
    expect(result.diffsNulledByAge).toBe(0);
    expect(result.diffsNulledByCap).toBe(0);
  });

  it('respects project_id isolation', () => {
    const now = Date.now();
    mock.tables.file_events = [
      { id: 1, project_id: 1, path: 'a.txt', event_type: 'create', timestamp: now - 400 * 86400000, diff: 'diff1' },
      { id: 2, project_id: 2, path: 'a.txt', event_type: 'create', timestamp: now - 400 * 86400000, diff: 'diff2' },
    ];

    const policy: RetentionPolicy = { keepDays: 365, keepDiffsDays: 90 };
    const result = applyRetention(mock.db, 1, policy);

    expect(result.eventsDeleted).toBe(1);
    expect(mock.tables.file_events.length).toBe(1);
    expect(mock.tables.file_events[0].project_id).toBe(2);
  });
});