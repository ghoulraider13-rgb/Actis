// Query engine with natural language parsing
import { queryEvents, getProjectByPath, getActiveProjects, FileEvent, Project } from './db.js';
import { format } from 'date-fns';
import { parse, differenceInDays, startOfDay, endOfDay } from 'date-fns';

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
  }

  // "until Friday", "before yesterday"
  const untilMatch = lower.match(/(?:until|before)\s+(.+?)(?:\s+(?:since|after|in|on|for|$)|$)/);
  if (untilMatch) {
    const timeStr = untilMatch[1].trim();
    result.until = parseTimeExpression(timeStr, true);
  }

  // "in src/", "in the config folder"
  const pathMatch = lower.match(/(?:in|under|inside)\s+([\w\/\-\.]+)/);
  if (pathMatch) {
    result.path = pathMatch[1];
  }

  // Event type filters
  if (/\b(new|created|added)\b/.test(lower)) result.eventType = 'create';
  else if (/\b(modified|changed|edited|updated)\b/.test(lower)) result.eventType = 'modify';
  else if (/\b(deleted|removed)\b/.test(lower)) result.eventType = 'delete';
  else if (/\b(renamed|moved)\b/.test(lower)) result.eventType = 'rename';

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

export async function executeQuery(parsed: ParsedQuery, projectRoot?: string): Promise<{ events: FileEvent[]; total: number; project: Project | undefined }> {
  let project: Project | undefined;

  if (projectRoot) {
    const proj = await getProjectByPath(projectRoot);
    if (proj) project = proj;
  }

  if (!project) {
    // Default to first active project
    const projects = await getActiveProjects();
    project = projects[0];
  }

  if (!project) {
    return { events: [], total: 0, project: undefined };
  }

  const result = await queryEvents(project.id!, {
    since: parsed.since,
    until: parsed.until,
    path: parsed.path,
    eventType: parsed.eventType,
    limit: parsed.limit || 100,
  });

  return { ...result, project };
}

export function formatEvent(event: FileEvent, projectRoot: string): string {
  const time = format(new Date(event.timestamp), 'yyyy-MM-dd HH:mm:ss');
  const typeIcon = {
    create: '🟢',
    modify: '🟡',
    delete: '🔴',
    rename: '🔵',
  }[event.event_type] || '⚪';

  let line = `${typeIcon} [${time}] ${event.path}`;
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
