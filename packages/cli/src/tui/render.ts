import type { FileEvent } from '@actis/core';
import type { TuiState } from './state.js';

// Sleepy Vim palette (soft TokyoNight/Kanagawa-inspired twilight tones)
const fg = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
const bg = (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`;

export const PALETTE = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  text: fg(192, 202, 245), // #c0caf5 soft lavender-white
  subtext: fg(139, 148, 184), // #8b94b8 muted slate
  muted: fg(86, 95, 137), // #565f89 sleepy comment grey-blue
  border: fg(59, 66, 97), // #3b4261 subtle border
  borderActive: fg(122, 162, 247), // #7aa2f7 calm blue
  accent: fg(187, 154, 247), // #bb9af7 soft violet
  blue: fg(122, 162, 247), // #7aa2f7
  green: fg(158, 206, 106), // #9ece6a sage green
  amber: fg(224, 175, 104), // #e0af68 warm amber
  rose: fg(247, 118, 142), // #f7768e muted rose
  cyan: fg(125, 207, 255), // #7dcfff soft sky
  bgBar: bg(31, 35, 53), // #1f2335 deep twilight bar
  bgSelect: bg(41, 46, 66), // #292e42 soft selection highlight
  bgPillNormal: bg(122, 162, 247) + fg(26, 27, 38),
  bgPillSearch: bg(224, 175, 104) + fg(26, 27, 38),
  bgPillOverlay: bg(187, 154, 247) + fg(26, 27, 38),
};

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, '');
}

export function visibleLength(str: string): number {
  return stripAnsi(str).length;
}

export function padRight(str: string, width: number): string {
  const len = visibleLength(str);
  if (len >= width) return str;
  return str + ' '.repeat(width - len);
}

export function truncatePlain(str: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (str.length <= maxWidth) return str;
  if (maxWidth === 1) return '…';
  return str.slice(0, maxWidth - 1) + '…';
}

export function formatShortTime(ts: number, now = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((now - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

function eventGlyph(type: FileEvent['event_type']): { icon: string; color: string } {
  switch (type) {
    case 'create':
      return { icon: '+', color: PALETTE.green };
    case 'modify':
      return { icon: '~', color: PALETTE.amber };
    case 'delete':
      return { icon: '-', color: PALETTE.rose };
    case 'rename':
      return { icon: '→', color: PALETTE.accent };
    default:
      return { icon: '·', color: PALETTE.subtext };
  }
}

export function buildDiffLines(event: FileEvent | undefined): string[] {
  if (!event) {
    return [
      '',
      '  No event selected.',
      '',
      '  Edit files in a watched project or press `r` to refresh.',
    ];
  }

  const lines: string[] = [];
  const when = new Date(event.timestamp).toLocaleString();
  lines.push(`File:      ${event.path}`);
  lines.push(`Event:     ${event.event_type.toUpperCase()}${event.detected_on_rescan ? ' (rescan)' : ''}`);
  lines.push(`Timestamp: ${when}`);

  if (event.size_before !== undefined || event.size_after !== undefined) {
    const before = event.size_before ?? 0;
    const after = event.size_after ?? 0;
    const delta = after - before;
    const sign = delta >= 0 ? '+' : '';
    lines.push(`Size:      ${before} B → ${after} B (${sign}${delta} B)`);
  }

  if (event.hash_before || event.hash_after) {
    lines.push(`Hash:      ${event.hash_before ?? '∅'} → ${event.hash_after ?? '∅'}`);
  }

  lines.push('────────────────────────────────────────');

  if (!event.diff) {
    lines.push('(no diff recorded for this event)');
    return lines;
  }

  for (const rawLine of event.diff.split('\n')) {
    lines.push(rawLine);
  }
  return lines;
}

function colorizeDiffLine(line: string, maxWidth: number): string {
  const clipped = truncatePlain(line, maxWidth);
  if (clipped.startsWith('+++') || clipped.startsWith('---')) {
    return `${PALETTE.bold}${PALETTE.blue}${clipped}${PALETTE.reset}`;
  }
  if (clipped.startsWith('@@')) {
    return `${PALETTE.cyan}${clipped}${PALETTE.reset}`;
  }
  if (clipped.startsWith('+')) {
    return `${PALETTE.green}${clipped}${PALETTE.reset}`;
  }
  if (clipped.startsWith('-')) {
    return `${PALETTE.rose}${clipped}${PALETTE.reset}`;
  }
  if (
    clipped.startsWith('File:') ||
    clipped.startsWith('Event:') ||
    clipped.startsWith('Timestamp:') ||
    clipped.startsWith('Size:') ||
    clipped.startsWith('Hash:')
  ) {
    const colonIdx = clipped.indexOf(':');
    const label = clipped.slice(0, colonIdx + 1);
    const val = clipped.slice(colonIdx + 1);
    return `${PALETTE.muted}${label}${PALETTE.text}${val}${PALETTE.reset}`;
  }
  if (clipped.startsWith('────')) {
    return `${PALETTE.border}${clipped}${PALETTE.reset}`;
  }
  return `${PALETTE.subtext}${clipped}${PALETTE.reset}`;
}

function renderBoxRow(
  leftContent: string,
  leftInnerWidth: number,
  leftBorderColor: string,
  rightContent: string,
  rightInnerWidth: number,
  rightBorderColor: string,
): string {
  const l = padRight(leftContent, leftInnerWidth);
  const r = padRight(rightContent, rightInnerWidth);
  return (
    `${leftBorderColor}│${PALETTE.reset}${l}${leftBorderColor}│${PALETTE.reset}` +
    `${rightBorderColor}│${PALETTE.reset}${r}${rightBorderColor}│${PALETTE.reset}`
  );
}

export function renderTuiFrame(
  state: TuiState,
  cols = 100,
  rows = 28,
): string {
  const width = Math.max(60, cols);
  const height = Math.max(14, rows);

  const activeProject = state.projects[state.activeProjectIndex];
  const projectLabel = activeProject
    ? `${activeProject.name} (${activeProject.root_path})`
    : 'no project';

  // Top header bar (1 row)
  const titleLeft = ` ${PALETTE.bold}${PALETTE.accent}actis${PALETTE.reset}${PALETTE.muted} · sleepy ledger${PALETTE.reset}`;
  const filterBadge =
    state.typeFilter !== 'all' ? ` ${PALETTE.amber}[${state.typeFilter}]${PALETTE.reset}` : '';
  const countBadge = `${PALETTE.subtext}${state.filteredEvents.length}/${state.allEvents.length} events${PALETTE.reset}`;
  const headerRight = `${PALETTE.blue}${truncatePlain(projectLabel, Math.max(16, Math.floor(width * 0.45)))}${PALETTE.reset}${filterBadge}  ${countBadge} `;
  const gap = Math.max(1, width - visibleLength(titleLeft) - visibleLength(headerRight));
  const headerLine = `${PALETTE.bgBar}${titleLeft}${' '.repeat(gap)}${headerRight}${PALETTE.reset}`;

  // Body dimensions: height - 1 (header) - 2 (status + hint) - 2 (top/bottom box borders)
  const bodyRows = Math.max(4, height - 5);
  const leftWidth = Math.max(28, Math.floor(width * 0.42));
  const rightWidth = width - leftWidth;
  const leftInner = leftWidth - 2;
  const rightInner = rightWidth - 2;

  const leftBorder = state.activePane === 'events' ? PALETTE.borderActive : PALETTE.border;
  const rightBorder = state.activePane === 'diff' ? PALETTE.borderActive : PALETTE.border;

  const leftTitle = ` Events `;
  const rightTitle = ` Inspector `;
  const topLeftBorder =
    `${leftBorder}╭─${PALETTE.bold}${leftBorder}${leftTitle}${PALETTE.reset}${leftBorder}${'─'.repeat(Math.max(0, leftInner - leftTitle.length - 1))}╮${PALETTE.reset}`;
  const topRightBorder =
    `${rightBorder}╭─${PALETTE.bold}${rightBorder}${rightTitle}${PALETTE.reset}${rightBorder}${'─'.repeat(Math.max(0, rightInner - rightTitle.length - 1))}╮${PALETTE.reset}`;
  const topBorderRow = topLeftBorder + topRightBorder;

  const bottomBorderRow =
    `${leftBorder}╰${'─'.repeat(leftInner)}╯${PALETTE.reset}` +
    `${rightBorder}╰${'─'.repeat(rightInner)}╯${PALETTE.reset}`;

  const selectedEvent = state.filteredEvents[state.selectedEventIndex];
  const diffLines = buildDiffLines(selectedEvent);

  const lines: string[] = [headerLine, topBorderRow];

  if (state.mode === 'help') {
    const helpLines = [
      '',
      `  ${PALETTE.bold}${PALETTE.accent}sleepy vim keybindings${PALETTE.reset}`,
      '',
      `  ${PALETTE.blue}j / k${PALETTE.reset}        move down / up`,
      `  ${PALETTE.blue}g / G${PALETTE.reset}        jump to top / bottom`,
      `  ${PALETTE.blue}Ctrl+d / u${PALETTE.reset}   half-page down / up`,
      `  ${PALETTE.blue}Tab / h / l${PALETTE.reset}  switch pane (Events ↔ Inspector)`,
      `  ${PALETTE.blue}/${PALETTE.reset}            search path or diff (Esc clears)`,
      `  ${PALETTE.blue}0..4${PALETTE.reset}         filter: 0=all 1=create 2=modify 3=delete 4=rename`,
      `  ${PALETTE.blue}p${PALETTE.reset}            switch project`,
      `  ${PALETTE.blue}r${PALETTE.reset}            refresh from ledger`,
      `  ${PALETTE.blue}?${PALETTE.reset}            toggle help`,
      `  ${PALETTE.blue}q${PALETTE.reset}            quit`,
    ];

    for (let row = 0; row < bodyRows; row++) {
      const text = helpLines[row] ?? '';
      const fullLine = padRight(text, width - 2);
      lines.push(`${PALETTE.borderActive}│${PALETTE.reset}${fullLine}${PALETTE.borderActive}│${PALETTE.reset}`);
    }
    // Replace top/bottom border for full-width overlay
    const helpTitle = ' Help ';
    lines[1] = `${PALETTE.borderActive}╭─${PALETTE.bold}${helpTitle}${PALETTE.reset}${PALETTE.borderActive}${'─'.repeat(Math.max(0, width - helpTitle.length - 3))}╮${PALETTE.reset}`;
    lines.push(`${PALETTE.borderActive}╰${'─'.repeat(width - 2)}╯${PALETTE.reset}`);
  } else if (state.mode === 'projects') {
    const projTitle = ' Projects ';
    lines[1] = `${PALETTE.borderActive}╭─${PALETTE.bold}${projTitle}${PALETTE.reset}${PALETTE.borderActive}${'─'.repeat(Math.max(0, width - projTitle.length - 3))}╮${PALETTE.reset}`;
    for (let row = 0; row < bodyRows; row++) {
      let cell = '';
      if (row === 0 && state.projects.length === 0) {
        cell = `  ${PALETTE.muted}No projects tracked. Run: actis init <name> [path]${PALETTE.reset}`;
      } else if (row < state.projects.length) {
        const p = state.projects[row];
        const isCursor = row === state.projectCursor;
        const isActive = row === state.activeProjectIndex;
        const marker = isCursor ? '▸' : ' ';
        const activeTag = isActive ? ` ${PALETTE.green}(active)${PALETTE.reset}` : '';
        const text = ` ${marker} ${p.name}  ${PALETTE.muted}${p.root_path}${PALETTE.reset}${activeTag}`;
        cell = isCursor ? `${PALETTE.bgSelect}${padRight(text, width - 2)}${PALETTE.reset}` : text;
      }
      lines.push(
        `${PALETTE.borderActive}│${PALETTE.reset}${padRight(cell, width - 2)}${PALETTE.borderActive}│${PALETTE.reset}`,
      );
    }
    lines.push(`${PALETTE.borderActive}╰${'─'.repeat(width - 2)}╯${PALETTE.reset}`);
  } else {
    for (let row = 0; row < bodyRows; row++) {
      // Left cell: event list
      const evIdx = state.eventScrollOffset + row;
      let leftCell = '';
      if (state.filteredEvents.length === 0 && row === 1) {
        leftCell = ` ${PALETTE.muted}No matching events.${PALETTE.reset}`;
      } else if (evIdx < state.filteredEvents.length) {
        const ev = state.filteredEvents[evIdx];
        const isSelected = evIdx === state.selectedEventIndex;
        const { icon, color } = eventGlyph(ev.event_type);
        const age = formatShortTime(ev.timestamp);
        const ageWidth = 5;
        const pathBudget = Math.max(8, leftInner - 4 - ageWidth);
        const pathStr = truncatePlain(ev.path, pathBudget);
        const rowContent = ` ${color}${icon}${PALETTE.reset} ${PALETTE.text}${padRight(pathStr, pathBudget)}${PALETTE.reset} ${PALETTE.muted}${age.padStart(ageWidth - 1)}${PALETTE.reset}`;
        leftCell = isSelected
          ? `${PALETTE.bgSelect}${padRight(rowContent, leftInner)}${PALETTE.reset}`
          : rowContent;
      }

      // Right cell: diff inspector
      const diffIdx = state.diffScrollOffset + row;
      let rightCell = '';
      if (diffIdx < diffLines.length) {
        rightCell = ' ' + colorizeDiffLine(diffLines[diffIdx], Math.max(1, rightInner - 2));
      }

      lines.push(
        renderBoxRow(leftCell, leftInner, leftBorder, rightCell, rightInner, rightBorder),
      );
    }
    lines.push(bottomBorderRow);
  }

  // Bottom Vim Status Bar (2 lines)
  const modePill =
    state.mode === 'search'
      ? `${PALETTE.bgPillSearch}${PALETTE.bold} SEARCH ${PALETTE.reset}`
      : state.mode === 'projects'
        ? `${PALETTE.bgPillOverlay}${PALETTE.bold} PROJECTS ${PALETTE.reset}`
        : state.mode === 'help'
          ? `${PALETTE.bgPillOverlay}${PALETTE.bold} HELP ${PALETTE.reset}`
          : `${PALETTE.bgPillNormal}${PALETTE.bold} NORMAL ${PALETTE.reset}`;

  const paneTag = ` ${PALETTE.muted}[${state.activePane}]${PALETTE.reset}`;
  const searchTag = state.searchQuery
    ? ` ${PALETTE.amber}/${state.searchQuery}${PALETTE.reset}`
    : '';
  const msgTag = state.statusMessage ? ` ${PALETTE.subtext}${state.statusMessage}${PALETTE.reset}` : '';
  const posTag =
    state.filteredEvents.length > 0
      ? `${PALETTE.subtext}${state.selectedEventIndex + 1}/${state.filteredEvents.length} ${PALETTE.reset}`
      : `${PALETTE.muted}0/0 ${PALETTE.reset}`;

  const statusLeft = `${modePill}${paneTag}${searchTag}${msgTag}`;
  const statusGap = Math.max(1, width - visibleLength(statusLeft) - visibleLength(posTag));
  const statusLine = `${PALETTE.bgBar}${statusLeft}${' '.repeat(statusGap)}${posTag}${PALETTE.reset}`;

  const commandLine =
    state.mode === 'search'
      ? `${PALETTE.amber}/${PALETTE.text}${state.searchQuery}█${PALETTE.reset}`
      : `${PALETTE.muted} j/k:nav  Tab:pane  /:search  0-4:type  p:projects  r:refresh  ?:help  q:quit${PALETTE.reset}`;

  lines.push(statusLine);
  lines.push(padRight(commandLine, width));

  return lines.join('\n');
}
