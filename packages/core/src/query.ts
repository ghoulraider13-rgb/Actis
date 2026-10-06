// Query engine with natural language parsing
// Browser-safe: no Node-only imports
import type { FileEvent, Project } from './types.js';
import { format } from 'date-fns';
import { parse, startOfDay, endOfDay } from 'date-fns';

export interface ParsedQuery {
  since?: number;
  until?: number;
  path?: string;
  eventType?: 'create' | 'modify' | 'delete' | 'rename';
  limit?: number;
  projectName?: string;
}

export function parseNaturalQuery(query: string, projectRoot?: string): ParsedQuery {
  const lower = query.toLowerCase().trim();
  const result: ParsedQuery = {};

  // Time patterns
  const now = Date.now();
  const todayStart = startOfDay(new Date()).getTime();
  const yesterdayStart = todayStart - 86400000;

  // "since Tuesday", "since last week", "since 2 days ago"
  const sinceMatch = lower.match(/since\s+(.+?)(?:\s+(?:until|before|after|in|on|for|$)|$)/);
  if (sinceMatch) {
    const timeStr = sinceMatch[1].trim();
    result.since = parseTimeExpression(timeStr);
  } else {
    // Bare "last week" / "last 3 days" / "yesterday" without the word "since"
    // still means a lower time bound ("deleted files last week").
    const bare = lower.match(
      /(?:^|\s)(last\s+(?:\d+\s+)?(?:day|week|month)s?|yesterday|today|\d+\s*(?:day|week|month|hour)s?\s+ago)(?:\s|$)/,
    );
    if (bare) {
      result.since = parseTimeExpression(bare[1]);
    }
  }

  // "until Friday", "before yesterday"
  const untilMatch = lower.match(/(?:until|before)\s+(.+?)(?:\s+(?:since|after|in|on|for|$)|$)/);
  if (untilMatch) {
    const timeStr = untilMatch[1].trim();
    result.until = parseTimeExpression(timeStr, true);
  }

  // "in src/", "in the src folder" — but "in my project" is not a path.
  const pathMatch = lower.match(
    /(?:in|under|inside)\s+(?:the\s+)?(?!my\b|this\b|project\b)([\w\-\.\/]+?)(?:\s+folder\b)?(?:\s|$)/,
  );
  if (pathMatch) {
    result.path = pathMatch[1].replace(/\/+$/, '');
  }

  // Event type filters — "what changed" means everything, not just modify.
  if (!/\bwhat\s+(?:was\s+|has\s+)?changed\b/.test(lower)) {
    if (/\b(new|created|added)\b/.test(lower)) result.eventType = 'create';
    else if (/\b(modified|edited|updated)\b/.test(lower)) result.eventType = 'modify';
    else if (/\b(deleted|removed)\b/.test(lower)) result.eventType = 'delete';
    else if (/\b(renamed|moved)\b/.test(lower)) result.eventType = 'rename';
  }

  // Limit
  const limitMatch = lower.match(/(?:top|first|last|latest)\s+(\d+)/);
  if (limitMatch) {
    result.limit = parseInt(limitMatch[1], 10);
  }

  return result;
}

function parseTimeExpression(expr: string, isEnd = false): number {
  const lower = expr.toLowerCase().trim();
  const now = new Date();
  const todayStart = startOfDay(now).getTime();

  // Relative days
  if (lower === 'today') return todayStart;
  if (lower === 'yesterday') return todayStart - 86400000;
  if (lower === 'this week') return startOfDay(new Date(now.setDate(now.getDate() - now.getDay()))).getTime();
  if (lower === 'last week') {
    const lastWeekStart = new Date(now);
    lastWeekStart.setDate(now.getDate() - now.getDay() - 7);
    return startOfDay(lastWeekStart).getTime();
  }
  if (lower === 'this month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (lower === 'last month') return new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();

  // "N days ago", "N hours ago"
  const agoMatch = lower.match(/(\d+)\s*(day|hour|week|month)s?\s+ago/);
  if (agoMatch) {
    const num = parseInt(agoMatch[1], 10);
    const unit = agoMatch[2];
    const ms = unit === 'hour' ? 3600000 : unit === 'day' ? 86400000 : unit === 'week' ? 604800000 : 2592000000;
    return now.getTime() - num * ms;
  }

  // Weekday names
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const weekdayIdx = weekdays.indexOf(lower);
  if (weekdayIdx !== -1) {
    const target = new Date(now);
    const currentDay = now.getDay();
    let diff = weekdayIdx - currentDay;
    if (isEnd) diff += diff <= 0 ? 7 : 0;
    else diff -= diff > 0 ? 7 : 0;
    target.setDate(now.getDate() + diff);
    return isEnd ? endOfDay(target).getTime() : startOfDay(target).getTime();
  }

  // "last N days"
  const lastMatch = lower.match(/last\s+(\d+)\s*(day|week|month)s?/);
  if (lastMatch) {
    const num = parseInt(lastMatch[1], 10);
    const unit = lastMatch[2];
    const ms = unit === 'day' ? 86400000 : unit === 'week' ? 604800000 : 2592000000;
    return now.getTime() - num * ms;
  }

  // Try parsing as date
  try {
    const parsed = parse(expr, 'yyyy-MM-dd', new Date());
    return isEnd ? endOfDay(parsed).getTime() : startOfDay(parsed).getTime();
  } catch {
    // Fallback: return now
    return now.getTime();
  }
}

// This function is not browser-safe (uses @actis/core/db) - only used by CLI
// The browser demo imports the types and parseNaturalQuery only
export async function executeQuery(
  parsed: ParsedQuery,
  projectRoot?: string
): Promise<{ events: FileEvent[]; total: number; project: Project | undefined }> {
  // This is a placeholder - the CLI version will override this
  // The actual implementation is in packages/cli/src/query-cli.ts
  return { events: [], total: 0, project: undefined };
}

export function formatEvent(event: FileEvent, projectRoot: string): string {
  const time = format(new Date(event.timestamp), 'yyyy-MM-dd HH:mm:ss');
  const typeIcon: Record<string, string> = {
    create: '🟢',
    modify: '🟡',
    delete: '🔴',
    rename: '🔵',
  };

  let line = `${typeIcon[event.event_type] || '⚪'} [${time}] ${event.path}`;
  if (event.size_before !== undefined && event.size_after !== undefined) {
    const diff = event.size_after - event.size_before;
    const sign = diff >= 0 ? '+' : '';
    line += ` (${sign}${diff} bytes)`;
  }
  return line;
}

export function formatEventsForDisplay(events: FileEvent[], projectRoot: string): string {
  if (events.length === 0) return 'No events found.';

  return events.map(e => formatEvent(e, projectRoot)).join('\n');
}