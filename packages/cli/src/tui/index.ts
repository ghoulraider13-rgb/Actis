import { resolve } from 'path';
import { closeDb, getActiveProjects, queryEvents, type FileEvent, type Project } from '@actis/core';
import { applyTuiKey, createTuiState, withEvents, type TuiState } from './state.js';
import { buildDiffLines, renderTuiFrame } from './render.js';

export { createTuiState, applyTuiKey, withEvents, filterEvents } from './state.js';
export { renderTuiFrame, buildDiffLines, formatShortTime, stripAnsi } from './render.js';

function loadProjectEvents(project: Project | undefined, limit = 300): FileEvent[] {
  if (!project?.id) return [];
  return queryEvents(project.id, { limit }).events;
}

export async function startTui(projectPathArg?: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('actis tui requires an interactive TTY terminal.');
    process.exit(1);
  }

  const projects = getActiveProjects();
  let initialIdx = 0;
  if (projectPathArg) {
    const target = resolve(projectPathArg);
    const found = projects.findIndex((p) => p.root_path === target);
    if (found !== -1) initialIdx = found;
  }

  let state: TuiState = createTuiState(
    projects,
    loadProjectEvents(projects[initialIdx]),
    initialIdx,
  );

  const enterAltScreen = '\x1b[?1049h\x1b[?25l';
  const exitAltScreen = '\x1b[?25h\x1b[?1049l';

  const draw = () => {
    const cols = process.stdout.columns || 100;
    const rows = process.stdout.rows || 28;
    const frame = renderTuiFrame(state, cols, rows);
    process.stdout.write('\x1b[H' + frame);
  };

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      process.stdin.setRawMode(false);
    } catch {
      // ignore if already restored
    }
    process.stdin.pause();
    process.stdout.write(exitAltScreen);
    closeDb();
  };

  process.stdout.write(enterAltScreen);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  draw();

  await new Promise<void>((resolvePromise) => {
    const pollTimer = setInterval(() => {
      if (!state.liveMode || state.mode !== 'normal') return;
      const refreshedProjects = getActiveProjects();
      const activeProj = refreshedProjects[state.activeProjectIndex];
      const latestEvents = loadProjectEvents(activeProj);
      const prevTopId = state.allEvents[0]?.id;
      const nextTopId = latestEvents[0]?.id;
      if (latestEvents.length !== state.allEvents.length || prevTopId !== nextTopId) {
        state = {
          ...withEvents(state, latestEvents),
          projects: refreshedProjects,
        };
        draw();
      }
    }, 1500);

    const onResize = () => draw();
    const onSigint = () => {
      clearInterval(pollTimer);
      cleanup();
      process.off('SIGWINCH', onResize);
      resolvePromise();
    };

    const onData = (chunk: string) => {
      const rows = process.stdout.rows || 28;
      const bodyRows = Math.max(4, rows - 5);
      const selected = state.filteredEvents[state.selectedEventIndex];
      const diffLen = buildDiffLines(selected).length;

      const { state: nextState, action } = applyTuiKey(state, chunk, bodyRows, diffLen, bodyRows);
      state = nextState;

      if (action.type === 'quit') {
        clearInterval(pollTimer);
        process.stdin.off('data', onData);
        process.off('SIGWINCH', onResize);
        process.off('SIGINT', onSigint);
        process.off('SIGTERM', onSigint);
        cleanup();
        resolvePromise();
        return;
      }

      if (action.type === 'refresh') {
        const refreshedProjects = getActiveProjects();
        const activeProj = refreshedProjects[state.activeProjectIndex];
        state = {
          ...withEvents(state, loadProjectEvents(activeProj)),
          projects: refreshedProjects,
          statusMessage: 'Refreshed',
        };
      } else if (action.type === 'switch_project') {
        const nextProj = state.projects[action.projectIndex];
        state = {
          ...withEvents(state, loadProjectEvents(nextProj)),
          statusMessage: nextProj ? `Switched to ${nextProj.name}` : '',
        };
      }

      draw();
    };

    process.stdin.on('data', onData);
    process.on('SIGWINCH', onResize);
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigint);
  });
}
