// Ignore pattern handling for actis watcher
// Supports .gitignore, .actisignore, negation (!), directory-only (dir/), and secret-safe defaults

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Default ignore patterns (always applied)
export const DEFAULT_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.actis/**',
  '**/*.log',
  '**/*.tmp',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/coverage/**',
  '**/.nyc_output/**',
  '**/.vercel/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/*.tsbuildinfo',
];

// Secret-safe patterns: recorded as events but never diffed
export const SECRET_PATTERNS = [
  '**/.env*',
  '**/*.pem',
  '**/id_*',
  '**/*.key',
  '**/*.crt',
  '**/*.cer',
  '**/secrets/**',
  '**/*.secret',
  '**/credentials/**',
  '**/.aws/**',
  '**/.docker/**',
  '**/kubeconfig',
];

// Patterns that should never be diffed (binary, secrets, large files)
export const NO_DIFF_PATTERNS = [
  ...SECRET_PATTERNS,
  '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.bmp', '**/*.ico', '**/*.webp',
  '**/*.pdf', '**/*.zip', '**/*.tar', '**/*.gz', '**/*.rar', '**/*.7z',
  '**/*.exe', '**/*.dll', '**/*.so', '**/*.dylib',
  '**/*.ttf', '**/*.woff', '**/*.woff2', '**/*.eot',
  '**/*.mp3', '**/*.mp4', '**/*.mov', '**/*.avi', '**/*.mkv',
  '**/*.db', '**/*.sqlite', '**/*.sqlite3',
];

export interface ParsedIgnoreRule {
  pattern: string;
  negated: boolean;
  directoryOnly: boolean;
  anchored: boolean;
}

function globToRegexSource(glob: string): string {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(/\*\*\/|\*\*|\*|\?/g, (token) => {
    if (token === '**/') return '(?:.+/)?';
    if (token === '**') return '.*';
    if (token === '*') return '[^/]*';
    return '[^/]';
  });
}

export function parseIgnoreRule(rawLine: string): ParsedIgnoreRule | null {
  const trimmed = rawLine.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  let pattern = trimmed;
  let negated = false;
  if (pattern.startsWith('!')) {
    negated = true;
    pattern = pattern.slice(1).trim();
  }
  if (!pattern) return null;

  let directoryOnly = false;
  if (pattern.endsWith('/')) {
    directoryOnly = true;
    pattern = pattern.slice(0, -1);
  }

  let anchored = false;
  if (pattern.startsWith('/')) {
    anchored = true;
    pattern = pattern.slice(1);
  } else if (pattern.includes('/')) {
    // Gitignore spec: a pattern containing a slash (other than trailing) is anchored to root
    // unless it starts with **/
    if (!pattern.startsWith('**/')) {
      anchored = true;
    }
  }

  if (!pattern) return null;
  return { pattern, negated, directoryOnly, anchored };
}

export function parseIgnoreRules(filePath: string): ParsedIgnoreRule[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf-8');
  const rules: ParsedIgnoreRule[] = [];
  for (const line of content.split('\n')) {
    const parsed = parseIgnoreRule(line);
    if (parsed) rules.push(parsed);
  }
  return rules;
}

export function parseIgnoreFile(filePath: string): string[] {
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const patterns: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('!')) continue;
    patterns.push(trimmed);
  }

  return patterns;
}

function compileRule(rule: ParsedIgnoreRule): { negated: boolean; regex: RegExp } {
  const src = globToRegexSource(rule.pattern);
  const prefix = rule.anchored ? '^' : '^(?:.*/)?';
  const suffix = rule.directoryOnly ? '(?:/.*)?$' : '(?:/.*)?$';
  return {
    negated: rule.negated,
    regex: new RegExp(`${prefix}${src}${suffix}`),
  };
}

export function buildIgnoreMatcher(
  projectRoot: string,
  customPatterns: string[] = [],
): (relPath: string) => boolean {
  const rules: ParsedIgnoreRule[] = [];

  for (const p of [...DEFAULT_IGNORE_PATTERNS, ...SECRET_PATTERNS, ...customPatterns]) {
    const parsed = parseIgnoreRule(p);
    if (parsed) rules.push(parsed);
  }

  const gitignorePath = resolve(projectRoot, '.gitignore');
  if (existsSync(gitignorePath)) {
    rules.push(...parseIgnoreRules(gitignorePath));
  }

  const actisignorePath = resolve(projectRoot, '.actisignore');
  if (existsSync(actisignorePath)) {
    rules.push(...parseIgnoreRules(actisignorePath));
  }

  const compiled = rules.map(compileRule);

  return (relPath: string) => {
    const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized) return false;
    let ignored = false;
    for (const rule of compiled) {
      if (rule.regex.test(normalized)) {
        ignored = !rule.negated;
      }
    }
    return ignored;
  };
}

export function shouldDiffFile(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  for (const pattern of NO_DIFF_PATTERNS) {
    const regex = new RegExp(`^${globToRegexSource(pattern)}$`);
    if (regex.test(normalized)) return false;
  }
  return true;
}