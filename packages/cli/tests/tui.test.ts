import { describe, expect, it } from 'vitest';
import type { FileEvent, Project } from '@actis/core';
import { applyTuiKey, createTuiState } from '../src/tui/state.js';
import { renderTuiFrame, stripAnsi } from '../src/tui/render.js';

const sampleProjects: Project[] = [
  { id: 1, name: 'actis', root_path: '/tmp/actis', created_at: 1000, is_active: 1 },
  { id: 2, name: 'portfolio', root_path: '/tmp/portfolio', created_at: 2000, is_active: 1 },
];

const sampleEvents: FileEvent[] = [
  {
    id: 1,
    project_id: 1,
    path: 'src/cli.ts',
    event_type: 'modify',
    timestamp: Date.now() - 10_000,
    diff: '--- a/src/cli.ts\n+++ b/src/cli.ts\n@@ -1,1 +1,2 @@\n-old\n+new\n+line2',
    size_before: 100,
    size_after: 120,
  },
  {
    id: 2,
    project_id: 1,
    path: 'src/tui/render.ts',
    event_type: 'create',
    timestamp: Date.now() - 5_000,
    diff: '+export const theme = "sleepy";',
    size_before: 0,
    size_after: 30,
  },
  {
    id: 3,
    project_id: 1,
    path: 'tmp/old.log',
    event_type: 'delete',
    timestamp: Date.now() - 1_000,
  },
];

describe('sleepy-vim TUI state & keybindings', () => {
  it('navigates events with j, k, g, G', () => {
    let state = createTuiState(sampleProjects, sampleEvents);
    expect(state.selectedEventIndex).toBe(0);

    state = applyTuiKey(state, 'j').state;
    expect(state.selectedEventIndex).toBe(1);

    state = applyTuiKey(state, 'G').state;
    expect(state.selectedEventIndex).toBe(2);

    state = applyTuiKey(state, 'k').state;
    expect(state.selectedEventIndex).toBe(1);

    state = applyTuiKey(state, 'g').state;
    expect(state.selectedEventIndex).toBe(0);
  });

  it('switches panes with Tab, h, and l', () => {
    let state = createTuiState(sampleProjects, sampleEvents);
    expect(state.activePane).toBe('events');

    state = applyTuiKey(state, '\t').state;
    expect(state.activePane).toBe('diff');

    state = applyTuiKey(state, 'h').state;
    expect(state.activePane).toBe('events');

    state = applyTuiKey(state, 'l').state;
    expect(state.activePane).toBe('diff');
  });

  it('filters events in search mode (/) and clears on Esc', () => {
    let state = createTuiState(sampleProjects, sampleEvents);
    state = applyTuiKey(state, '/').state;
    expect(state.mode).toBe('search');

    for (const ch of 'tui') {
      state = applyTuiKey(state, ch).state;
    }
    expect(state.searchQuery).toBe('tui');
    expect(state.filteredEvents).toHaveLength(1);
    expect(state.filteredEvents[0].path).toBe('src/tui/render.ts');

    state = applyTuiKey(state, '\r').state;
    expect(state.mode).toBe('normal');
    expect(state.filteredEvents).toHaveLength(1);

    // Re-open search and Esc clears filter
    state = applyTuiKey(state, '/').state;
    state = applyTuiKey(state, '\x1b').state;
    expect(state.mode).toBe('normal');
    expect(state.searchQuery).toBe('');
    expect(state.filteredEvents).toHaveLength(3);
  });

  it('filters by event type using 0..4', () => {
    let state = createTuiState(sampleProjects, sampleEvents);
    state = applyTuiKey(state, '1').state;
    expect(state.typeFilter).toBe('create');
    expect(state.filteredEvents).toHaveLength(1);

    state = applyTuiKey(state, '0').state;
    expect(state.typeFilter).toBe('all');
    expect(state.filteredEvents).toHaveLength(3);
  });

  it('opens project switcher (p) and emits switch_project action', () => {
    let state = createTuiState(sampleProjects, sampleEvents);
    state = applyTuiKey(state, 'p').state;
    expect(state.mode).toBe('projects');

    state = applyTuiKey(state, 'j').state;
    expect(state.projectCursor).toBe(1);

    const res = applyTuiKey(state, '\r');
    expect(res.action).toEqual({ type: 'switch_project', projectIndex: 1 });
    expect(res.state.mode).toBe('normal');
    expect(res.state.activeProjectIndex).toBe(1);
  });

  it('toggles help overlay (?) and quits on q', () => {
    let state = createTuiState(sampleProjects, sampleEvents);
    state = applyTuiKey(state, '?').state;
    expect(state.mode).toBe('help');

    state = applyTuiKey(state, '?').state;
    expect(state.mode).toBe('normal');

    const quitRes = applyTuiKey(state, 'q');
    expect(quitRes.action).toEqual({ type: 'quit' });
  });

  it('renders clean sleepy-vim frame with exact line count', () => {
    const state = createTuiState(sampleProjects, sampleEvents);
    const frame = renderTuiFrame(state, 100, 24);
    const plainLines = stripAnsi(frame).split('\n');

    expect(plainLines).toHaveLength(24);
    expect(plainLines[0]).toContain('actis · sleepy ledger');
    expect(plainLines[0]).toContain('3/3 events');
    expect(plainLines[1]).toContain('Events');
    expect(plainLines[1]).toContain('Inspector');
    expect(plainLines[22]).toContain('NORMAL');
    expect(plainLines[23]).toContain('j/k:nav');
  });
});
