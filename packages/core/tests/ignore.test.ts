import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildIgnoreMatcher } from '../src/ignore.js';

const dirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'actis-ignore-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe('ignore: gitignore & actisignore semantics', () => {
  it('supports negation (!pattern), directory-only (dir/), and anchored (/root) rules', () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, '.gitignore'),
      [
        '*.generated.ts',
        '!keep.generated.ts',
        'cache/',
        '/root-only.txt',
      ].join('\n'),
    );

    const isIgnored = buildIgnoreMatcher(dir);

    expect(isIgnored('src/foo.generated.ts')).toBe(true);
    expect(isIgnored('keep.generated.ts')).toBe(false);
    expect(isIgnored('cache/data.json')).toBe(true);
    expect(isIgnored('src/cache/data.json')).toBe(true);
    expect(isIgnored('root-only.txt')).toBe(true);
    expect(isIgnored('nested/root-only.txt')).toBe(false);
  });

  it('always ignores default patterns like node_modules and .git', () => {
    const dir = makeDir();
    const isIgnored = buildIgnoreMatcher(dir);

    expect(isIgnored('node_modules/pkg/index.js')).toBe(true);
    expect(isIgnored('.git/HEAD')).toBe(true);
    expect(isIgnored('src/index.ts')).toBe(false);
  });
});
