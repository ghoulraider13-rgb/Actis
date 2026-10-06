// watcher.ts: debounce, diff generation, event persistence, polling decision
// Events are driven through the public handleChange/flushPending seam; the
// ledger is isolated per-test via ACTIS_HOME (resetLedger).
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ActisWatcher, resolvePolling } from '../src/watcher.js';
import { createProject, getProjectByPath, queryEvents, closeDb } from '../src/db.js';
import { resetLedger } from './setup.js';

let projectDir: string;

async function makeWatcher(debounceMs = 500): Promise<ActisWatcher> {
  const project = await getProjectByPath(projectDir);
  const w = new ActisWatcher({ projectRoot: projectDir, debounceMs });
  await w.initialize();
  return w;
}

beforeEach(async () => {
  await resetLedger();
  projectDir = mkdtempSync(join(tmpdir(), 'actis-proj-'));
  await createProject('test-project', projectDir);
});

afterAll(() => {
  closeDb();
});

describe('resolvePolling', () => {
  it('forces polling on linux /mnt paths', () => {
    expect(resolvePolling('/mnt/c/Dev/x', 'linux', undefined)).toBe(true);
  });

  it('does not poll for native linux paths', () => {
    expect(resolvePolling('/home/ash/Dev/x', 'linux', undefined)).toBe(false);
  });

  it('explicit config always wins', () => {
    expect(resolvePolling('/home/ash/Dev/x', 'linux', true)).toBe(true);
    expect(resolvePolling('/mnt/c/Dev/x', 'linux', false)).toBe(false);
  });
});

describe('watcher debounce and events', () => {
  it('records a create event with content hash', async () => {
    writeFileSync(join(projectDir, 'a.txt'), 'hello\n');
    const w = await makeWatcher();
    w.handleChange(join(projectDir, 'a.txt'), 'create');
    await w.flushPending();

    const { events } = await queryEvents((await getProjectByPath(projectDir))!.id!, {});
    const create = events.find((e) => e.path === 'a.txt' && e.event_type === 'create');
    expect(create).toBeDefined();
    expect(create!.hash_after).toMatch(/^[0-9a-f]{16}$/);
    expect(create!.size_after).toBe(6);
  });

  it('collapses create+modify inside the debounce window into one create', async () => {
    writeFileSync(join(projectDir, 'b.txt'), 'v1\n');
    const w = await makeWatcher();
    w.handleChange(join(projectDir, 'b.txt'), 'create');
    w.handleChange(join(projectDir, 'b.txt'), 'modify'); // no-op double-fire, identical content
    writeFileSync(join(projectDir, 'b.txt'), 'v2\n');
    w.handleChange(join(projectDir, 'b.txt'), 'modify'); // real change, still pending
    await w.flushPending();

    const { events } = await queryEvents((await getProjectByPath(projectDir))!.id!, {});
    const creates = events.filter((e) => e.path === 'b.txt' && e.event_type === 'create');
    expect(creates).toHaveLength(1);
    // The collapsed create carries a diff from the creation snapshot to the final content.
    expect(creates[0].diff).toContain('+v2');
    expect(creates[0].hash_after).not.toBe(creates[0].hash_before);
  });

  it('records a modify with a real diff against the last-seen content', async () => {
    writeFileSync(join(projectDir, 'c.txt'), 'line1\n');
    const w = await makeWatcher();
    w.handleChange(join(projectDir, 'c.txt'), 'create');
    await w.flushPending(); // lastSeenContent now holds "line1\n"

    writeFileSync(join(projectDir, 'c.txt'), 'line1\nline2\n');
    w.handleChange(join(projectDir, 'c.txt'), 'modify');
    await w.flushPending();

    const { events } = await queryEvents((await getProjectByPath(projectDir))!.id!, {});
    const modify = events.find((e) => e.path === 'c.txt' && e.event_type === 'modify');
    expect(modify).toBeDefined();
    expect(modify!.diff).toContain('+line2');
    expect(modify!.size_before).toBe(6);
    expect(modify!.size_after).toBe(12);
  });

  it('records a delete with metadata but no content', async () => {
    writeFileSync(join(projectDir, 'd.txt'), 'gone soon\n');
    const w = await makeWatcher();
    w.handleChange(join(projectDir, 'd.txt'), 'create');
    await w.flushPending();

    rmSync(join(projectDir, 'd.txt'));
    w.handleChange(join(projectDir, 'd.txt'), 'delete');
    await w.flushPending();

    const { events } = await queryEvents((await getProjectByPath(projectDir))!.id!, {});
    const del = events.find((e) => e.path === 'd.txt' && e.event_type === 'delete');
    expect(del).toBeDefined();
    expect(del!.hash_before).toMatch(/^[0-9a-f]{16}$/);
    expect(del!.size_before).toBe(10);
    expect(del!.diff).toBeUndefined();
    expect(del!.hash_after).toBeUndefined();
  });

  it('persists events to the SQLite file on flush', async () => {
    writeFileSync(join(projectDir, 'e.txt'), 'persist me\n');
    const w = await makeWatcher();
    w.handleChange(join(projectDir, 'e.txt'), 'create');
    await w.flushPending();
    closeDb(); // force a re-read from disk on next getDb

    const { total } = await queryEvents((await getProjectByPath(projectDir))!.id!, {});
    expect(total).toBe(1);
  });

  it('ignores changes to files outside the project root', async () => {
    const w = await makeWatcher();
    w.handleChange('/somewhere/else/f.txt', 'create');
    await w.flushPending();

    const { total } = await queryEvents((await getProjectByPath(projectDir))!.id!, {});
    expect(total).toBe(0);
  });
});
