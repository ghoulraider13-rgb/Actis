import type { FileEvent, Project } from '@actis/core';

export type TuiMode = 'normal' | 'search' | 'projects' | 'help';
export type TuiPane = 'events' | 'diff';
export type EventTypeFilter = 'all' | 'create' | 'modify' | 'delete' | 'rename';

export interface TuiState {
  projects: Project[];
  activeProjectIndex: number;
  allEvents: FileEvent[];
  filteredEvents: FileEvent[];
  selectedEventIndex: number;
  eventScrollOffset: number;
  diffScrollOffset: number;
  activePane: TuiPane;
  mode: TuiMode;
  searchQuery: string;
  typeFilter: EventTypeFilter;
  projectCursor: number;
  statusMessage: string;
}

export function filterEvents(
  events: FileEvent[],
  searchQuery: string,
  typeFilter: EventTypeFilter,
): FileEvent[] {
  const q = searchQuery.trim().toLowerCase();
  return events.filter((ev) => {
    if (typeFilter !== 'all' && ev.event_type !== typeFilter) return false;
    if (!q) return true;
    return (
      ev.path.toLowerCase().includes(q) ||
      ev.event_type.toLowerCase().includes(q) ||
      (ev.diff ? ev.diff.toLowerCase().includes(q) : false)
    );
  });
}

export function createTuiState(
  projects: Project[],
  events: FileEvent[],
  initialProjectIndex = 0,
): TuiState {
  const idx = projects.length > 0 ? Math.min(Math.max(0, initialProjectIndex), projects.length - 1) : 0;
  return {
    projects,
    activeProjectIndex: idx,
    allEvents: events,
    filteredEvents: events,
    selectedEventIndex: 0,
    eventScrollOffset: 0,
    diffScrollOffset: 0,
    activePane: 'events',
    mode: 'normal',
    searchQuery: '',
    typeFilter: 'all',
    projectCursor: idx,
    statusMessage: events.length === 0 ? 'No events recorded yet' : '',
  };
}

export function withEvents(state: TuiState, events: FileEvent[]): TuiState {
  const filtered = filterEvents(events, state.searchQuery, state.typeFilter);
  const selectedEventIndex =
    filtered.length === 0 ? 0 : Math.min(state.selectedEventIndex, filtered.length - 1);
  return {
    ...state,
    allEvents: events,
    filteredEvents: filtered,
    selectedEventIndex,
    diffScrollOffset: 0,
  };
}

export type TuiAction =
  | { type: 'quit' }
  | { type: 'refresh' }
  | { type: 'switch_project'; projectIndex: number }
  | { type: 'none' };

export function applyTuiKey(
  state: TuiState,
  key: string,
  viewportEventRows = 20,
  diffLineCount = 0,
  viewportDiffRows = 20,
): { state: TuiState; action: TuiAction } {
  // Ctrl+C always quits
  if (key === '\x03') {
    return { state, action: { type: 'quit' } };
  }

  if (state.mode === 'help') {
    if (key === '?' || key === '\x1b' || key === 'q' || key === '\r' || key === '\n') {
      return { state: { ...state, mode: 'normal' }, action: { type: 'none' } };
    }
    return { state, action: { type: 'none' } };
  }

  if (state.mode === 'projects') {
    if (key === '\x1b' || key === 'q' || key === 'p') {
      return { state: { ...state, mode: 'normal' }, action: { type: 'none' } };
    }
    if (key === 'j' || key === '\x1b[B') {
      const next = Math.min(state.projectCursor + 1, Math.max(0, state.projects.length - 1));
      return { state: { ...state, projectCursor: next }, action: { type: 'none' } };
    }
    if (key === 'k' || key === '\x1b[A') {
      const prev = Math.max(state.projectCursor - 1, 0);
      return { state: { ...state, projectCursor: prev }, action: { type: 'none' } };
    }
    if (key === '\r' || key === '\n') {
      if (state.projects.length === 0) {
        return { state: { ...state, mode: 'normal' }, action: { type: 'none' } };
      }
      return {
        state: {
          ...state,
          mode: 'normal',
          activeProjectIndex: state.projectCursor,
          selectedEventIndex: 0,
          eventScrollOffset: 0,
          diffScrollOffset: 0,
        },
        action: { type: 'switch_project', projectIndex: state.projectCursor },
      };
    }
    return { state, action: { type: 'none' } };
  }

  if (state.mode === 'search') {
    if (key === '\x1b') {
      const filtered = filterEvents(state.allEvents, '', state.typeFilter);
      return {
        state: {
          ...state,
          mode: 'normal',
          searchQuery: '',
          filteredEvents: filtered,
          selectedEventIndex: 0,
          eventScrollOffset: 0,
          diffScrollOffset: 0,
        },
        action: { type: 'none' },
      };
    }
    if (key === '\r' || key === '\n') {
      return { state: { ...state, mode: 'normal' }, action: { type: 'none' } };
    }
    if (key === '\x7f' || key === '\b') {
      const nextQuery = state.searchQuery.slice(0, -1);
      const filtered = filterEvents(state.allEvents, nextQuery, state.typeFilter);
      return {
        state: {
          ...state,
          searchQuery: nextQuery,
          filteredEvents: filtered,
          selectedEventIndex: 0,
          eventScrollOffset: 0,
          diffScrollOffset: 0,
        },
        action: { type: 'none' },
      };
    }
    if (key.length === 1 && key >= ' ' && key <= '~') {
      const nextQuery = state.searchQuery + key;
      const filtered = filterEvents(state.allEvents, nextQuery, state.typeFilter);
      return {
        state: {
          ...state,
          searchQuery: nextQuery,
          filteredEvents: filtered,
          selectedEventIndex: 0,
          eventScrollOffset: 0,
          diffScrollOffset: 0,
        },
        action: { type: 'none' },
      };
    }
    return { state, action: { type: 'none' } };
  }

  // Normal mode
  if (key === 'q') {
    return { state, action: { type: 'quit' } };
  }
  if (key === '?') {
    return { state: { ...state, mode: 'help' }, action: { type: 'none' } };
  }
  if (key === '/') {
    return { state: { ...state, mode: 'search' }, action: { type: 'none' } };
  }
  if (key === 'p') {
    return {
      state: { ...state, mode: 'projects', projectCursor: state.activeProjectIndex },
      action: { type: 'none' },
    };
  }
  if (key === 'r') {
    return {
      state: { ...state, statusMessage: 'Refreshed' },
      action: { type: 'refresh' },
    };
  }
  if (key === '\t') {
    return {
      state: { ...state, activePane: state.activePane === 'events' ? 'diff' : 'events' },
      action: { type: 'none' },
    };
  }
  if (key === 'h' || key === '\x1b[D') {
    return { state: { ...state, activePane: 'events' }, action: { type: 'none' } };
  }
  if (key === 'l' || key === '\x1b[C') {
    return { state: { ...state, activePane: 'diff' }, action: { type: 'none' } };
  }

  // Quick type filters: 0=all, 1=create, 2=modify, 3=delete, 4=rename
  const filterMap: Record<string, EventTypeFilter> = {
    '0': 'all',
    '1': 'create',
    '2': 'modify',
    '3': 'delete',
    '4': 'rename',
  };
  if (key in filterMap) {
    const typeFilter = filterMap[key];
    const filtered = filterEvents(state.allEvents, state.searchQuery, typeFilter);
    return {
      state: {
        ...state,
        typeFilter,
        filteredEvents: filtered,
        selectedEventIndex: 0,
        eventScrollOffset: 0,
        diffScrollOffset: 0,
        statusMessage: `Filter: ${typeFilter}`,
      },
      action: { type: 'none' },
    };
  }

  // Navigation
  const isDown = key === 'j' || key === '\x1b[B';
  const isUp = key === 'k' || key === '\x1b[A';
  const isHalfDown = key === '\x04'; // Ctrl+D
  const isHalfUp = key === '\x15'; // Ctrl+U
  const isTop = key === 'g';
  const isBottom = key === 'G';

  if (state.activePane === 'diff') {
    const maxOffset = Math.max(0, diffLineCount - viewportDiffRows);
    let nextOffset = state.diffScrollOffset;
    if (isDown) nextOffset = Math.min(maxOffset, nextOffset + 1);
    else if (isUp) nextOffset = Math.max(0, nextOffset - 1);
    else if (isHalfDown) nextOffset = Math.min(maxOffset, nextOffset + Math.max(1, Math.floor(viewportDiffRows / 2)));
    else if (isHalfUp) nextOffset = Math.max(0, nextOffset - Math.max(1, Math.floor(viewportDiffRows / 2)));
    else if (isTop) nextOffset = 0;
    else if (isBottom) nextOffset = maxOffset;
    return { state: { ...state, diffScrollOffset: nextOffset }, action: { type: 'none' } };
  }

  // Events pane navigation
  const count = state.filteredEvents.length;
  if (count === 0) {
    return { state, action: { type: 'none' } };
  }

  let nextIdx = state.selectedEventIndex;
  if (isDown) nextIdx = Math.min(count - 1, nextIdx + 1);
  else if (isUp) nextIdx = Math.max(0, nextIdx - 1);
  else if (isHalfDown) nextIdx = Math.min(count - 1, nextIdx + Math.max(1, Math.floor(viewportEventRows / 2)));
  else if (isHalfUp) nextIdx = Math.max(0, nextIdx - Math.max(1, Math.floor(viewportEventRows / 2)));
  else if (isTop) nextIdx = 0;
  else if (isBottom) nextIdx = count - 1;
  else return { state, action: { type: 'none' } };

  let nextScroll = state.eventScrollOffset;
  if (nextIdx < nextScroll) {
    nextScroll = nextIdx;
  } else if (nextIdx >= nextScroll + viewportEventRows) {
    nextScroll = nextIdx - viewportEventRows + 1;
  }

  return {
    state: {
      ...state,
      selectedEventIndex: nextIdx,
      eventScrollOffset: nextScroll,
      diffScrollOffset: nextIdx !== state.selectedEventIndex ? 0 : state.diffScrollOffset,
      statusMessage: '',
    },
    action: { type: 'none' },
  };
}
