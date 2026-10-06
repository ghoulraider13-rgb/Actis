// Ignore pattern handling for actis watcher
// Supports .gitignore, .actisignore, and secret-safe defaults

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
}

export function parseIgnoreFile(filePath: string): string[] {
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const patterns: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Handle negation (!) - we'll ignore negated patterns for simplicity
    if (trimmed.startsWith('!')) continue;
    patterns.push(trimmed);
  }

  return patterns;
}

export function buildIgnoreMatcher(
  projectRoot: string,
  customPatterns: string[] = []
): (relPath: string) => boolean {
  const allPatterns = [
    ...DEFAULT_IGNORE_PATTERNS,
    ...SECRET_PATTERNS,
    ...customPatterns,
  ];

  // Add .gitignore
  const gitignorePath = resolve(projectRoot, '.gitignore');
  if (existsSync(gitignorePath)) {
    allPatterns.push(...parseIgnoreFile(gitignorePath));
  }

  // Add .actisignore
  const actisignorePath = resolve(projectRoot, '.actisignore');
  if (existsSync(actisignorePath)) {
    allPatterns.push(...parseIgnoreFile(actisignorePath));
  }

  // Convert glob patterns to regex
  const regexes = allPatterns.map(pattern => {
    // Escape regex special chars except * and ?
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]');
    return new RegExp(`^${escaped}$`);
  });

  return (relPath: string) => regexes.some(re => re.test(relPath));
}

export function shouldDiffFile(relPath: string): boolean {
  // Check if file matches any no-diff pattern
  for (const pattern of NO_DIFF_PATTERNS) {
    const regex = new RegExp(
      '^' + pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]') + '$'
    );
    if (regex.test(relPath)) return false;
  }
  return true;
}