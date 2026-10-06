// diff.ts: hashing, diff generation, summary counts, display truncation
import { describe, it, expect } from 'vitest';
import { computeHash, computeDiff, summarizeDiff, formatDiffForDisplay } from '../src/diff.js';

describe('computeHash', () => {
  it('returns a deterministic 16-char hex hash', () => {
    const h1 = computeHash('hello world\n');
    const h2 = computeHash('hello world\n');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
  });

  it('differs for different content', () => {
    expect(computeHash('a\n')).not.toBe(computeHash('b\n'));
  });
});

describe('computeDiff', () => {
  it('marks added and removed lines', () => {
    const diff = computeDiff('a\nb\n', 'a\nc\n');
    expect(diff).toContain('-b');
    expect(diff).toContain('+c');
  });

  it('keeps unchanged lines without add or remove markers', () => {
    const diff = computeDiff('keep\n', 'keep\n');
    expect(diff).toBe('keep'); // trailing newline trimmed by design
    expect(diff).not.toContain('+');
    expect(diff).not.toContain('-');
  });
});

describe('summarizeDiff', () => {
  it('counts additions and deletions', () => {
    const diff = computeDiff('a\nb\n', 'a\nc\nd\n');
    expect(summarizeDiff(diff)).toEqual({ additions: 2, deletions: 1 });
  });

  it('reports zero for unchanged content', () => {
    const diff = computeDiff('same\n', 'same\n');
    expect(summarizeDiff(diff)).toEqual({ additions: 0, deletions: 0 });
  });
});

describe('formatDiffForDisplay', () => {
  it('truncates long diffs with a trailing count', () => {
    const long = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n');
    const shown = formatDiffForDisplay(long, 50);
    expect(shown.split('\n').length).toBe(51); // 50 lines + "... (10 more lines)"
    expect(shown).toContain('... (10 more lines)');
  });

  it('returns short diffs untouched', () => {
    expect(formatDiffForDisplay('a\nb\n', 50)).toBe('a\nb\n');
  });
});
