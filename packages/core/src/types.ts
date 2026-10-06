// Browser-safe type exports (no Node-only imports)
// Used by the demo site (Phase 3) which runs in the browser

export interface FileEvent {
  id?: number;
  path: string;
  event_type: 'create' | 'modify' | 'delete' | 'rename';
  timestamp: number;
  diff?: string;
  size_before?: number;
  size_after?: number;
  hash_before?: string;
  hash_after?: string;
  project_id: number;
  // Added by rescan
  detected_on_rescan?: boolean;
}

export interface Project {
  id?: number;
  name: string;
  root_path: string;
  created_at: number;
  is_active: number;
}

export interface QueryResult {
  events: FileEvent[];
  total: number;
}

export interface ParsedQuery {
  since?: number;
  until?: number;
  path?: string;
  eventType?: 'create' | 'modify' | 'delete' | 'rename';
  limit?: number;
  projectName?: string;
}

// Re-export query parser functions (implementation in query.ts, no Node deps)
export { parseNaturalQuery } from './query.js';
export type { ParsedQuery as ParsedQueryType } from './query.js';