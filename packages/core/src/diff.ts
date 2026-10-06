// Diff utilities for computing file changes
import { diffLines, diffChars } from 'diff';
import { createHash } from 'crypto';

export function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export function computeDiff(oldContent: string, newContent: string): string {
  // Use line-based diff for readability. Prefix EVERY line of a part, not just
  // the first — a part like "+c\nd\n" would otherwise hide "d" from
  // summarizeDiff and look like an unchanged line.
  const parts = diffLines(oldContent, newContent);
  return parts
    .map(part => {
      const prefix = part.added ? '+' : part.removed ? '-' : ' ';
      return part.value
        .replace(/\n$/, '')
        .split('\n')
        .map(line => prefix + line)
        .join('\n');
    })
    .join('\n')
    .trim();
}

export function computeCharDiff(oldContent: string, newContent: string): string {
  const parts = diffChars(oldContent, newContent);
  return parts
    .map(part => {
      if (part.added) return `{+${part.value}+}`;
      if (part.removed) return `[-${part.value}-]`;
      return part.value;
    })
    .join('');
}

export function summarizeDiff(diff: string): { additions: number; deletions: number } {
  const lines = diff.split('\n');
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  return { additions, deletions };
}

export function formatDiffForDisplay(diff: string, maxLines = 50): string {
  const lines = diff.split('\n');
  if (lines.length <= maxLines) return diff;
  return lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} more lines)`;
}