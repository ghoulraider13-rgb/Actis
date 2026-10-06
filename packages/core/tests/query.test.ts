// query.ts: natural-language parsing rules
import { describe, it, expect } from 'vitest';
import { parseNaturalQuery } from '../src/query.js';

describe('parseNaturalQuery: time bounds', () => {
  it('"since Tuesday" sets a lower bound', () => {
    const r = parseNaturalQuery('what changed since Tuesday');
    expect(r.since).toBeDefined();
  });

  it('"since last week" sets a lower bound', () => {
    const r = parseNaturalQuery('since last week');
    expect(r.since).toBeDefined();
  });

  it('"3 days ago" sets a lower bound', () => {
    const r = parseNaturalQuery('3 days ago');
    const r2 = parseNaturalQuery('since 3 days ago');
    expect(r.since).toBeDefined();
    // Allow 1ms difference due to Date.now() being called at different times
    expect(Math.abs(r.since! - r2.since!)).toBeLessThanOrEqual(1);
  });

  it('"yesterday" without "since" still sets a lower bound', () => {
    const r = parseNaturalQuery('new files yesterday');
    expect(r.since).toBeDefined();
    expect(r.eventType).toBe('create');
  });

  it('"deleted files last week" sets a delete filter AND a lower bound', () => {
    const r = parseNaturalQuery('deleted files last week');
    expect(r.eventType).toBe('delete');
    expect(r.since).toBeDefined();
  });

  it('"since 2026-09-01" parses as a date', () => {
    const r = parseNaturalQuery('since 2026-09-01');
    expect(r.since).toBeLessThanOrEqual(Date.now());
    expect(r.since).toBeGreaterThan(Date.now() - 100 * 86400000);
  });

  it('"until Friday" sets an upper bound', () => {
    const r = parseNaturalQuery('before Friday');
    expect(r.until).toBeDefined();
  });
});

describe('parseNaturalQuery: paths', () => {
  it('"in src" extracts the path', () => {
    expect(parseNaturalQuery('new files in src').path).toBe('src');
  });

  it('"inside src/" extracts the path without the slash', () => {
    expect(parseNaturalQuery('changes inside src/').path).toBe('src');
  });

  it('"in the config folder" extracts the folder name', () => {
    expect(parseNaturalQuery('modified config files in the config folder').path).toBe('config');
  });

  it('"in my project" is NOT treated as a path', () => {
    expect(parseNaturalQuery('what changed in my project since Tuesday').path).toBeUndefined();
  });
});

describe('parseNaturalQuery: event types', () => {
  it('"new files" maps to create', () => {
    expect(parseNaturalQuery('show me new files in src').eventType).toBe('create');
  });

  it('"modified config files" maps to modify', () => {
    expect(parseNaturalQuery('modified config files since Monday').eventType).toBe('modify');
  });

  it('"deleted files" maps to delete', () => {
    expect(parseNaturalQuery('deleted files last week').eventType).toBe('delete');
  });

  it('"what changed" means everything (no type filter)', () => {
    expect(parseNaturalQuery('what changed since Tuesday').eventType).toBeUndefined();
  });
});

describe('parseNaturalQuery: limits', () => {
  it('"latest 10 changes" parses the limit', () => {
    expect(parseNaturalQuery('latest 10 changes').limit).toBe(10);
  });

  it('"top 5" parses the limit', () => {
    expect(parseNaturalQuery('top 5').limit).toBe(5);
  });
});
