import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { basename, dirname, join, resolve, sep } from 'path';
import { homedir } from 'os';
import { spawnSync } from 'child_process';
import { applyPatch, parsePatch } from 'diff';
import {
  createProject,
  getActiveProjects,
  getProjectByPath,
  parseNaturalQuery,
  queryEvents,
  type FileEvent,
  type ParsedQuery,
  type Project,
} from '@actis/core';
import { getDaemonStatus, startDaemon, stopDaemon, type DaemonStatus } from '../daemon.js';
import { formatEventsExport, type ExportFormat } from '../export.js';

export interface ProjectSummary {
  id: number | string;
  name: string;
  root_path: string;
}

export interface QueryLedgerInput {
  question: string;
  project_path?: string;
  limit?: number;
}

export interface QueryLedgerOutput {
  question: string;
  parsed: ParsedQuery;
  events: FileEvent[];
  total: number;
  project: ProjectSummary | null;
  grouped?: Record<string, number>;
}

export interface GetHistoryInput {
  project_path?: string;
  since?: number;
  until?: number;
  path?: string;
  event_types?: ('create' | 'modify' | 'delete' | 'rename')[];
  limit?: number;
}

export interface GetHistoryOutput {
  events: FileEvent[];
  total: number;
  project: ProjectSummary | null;
}

export interface ListProjectsOutput {
  projects: Array<{
    id: number | string;
    name: string;
    root_path: string;
    created_at?: number | string;
  }>;
}

export interface ApplyDiffInput {
  diff: string;
  project_path: string;
  dry_run?: boolean;
}

export interface ApplyDiffOutput {
  success: boolean;
  output: string;
  test_passed: boolean;
  files_changed: string[];
}

export interface WatchProjectInput {
  project_path?: string;
  action: 'start' | 'stop' | 'status';
  debounce_ms?: number;
  rescan?: boolean;
}

export interface WatchProjectOutput {
  action: 'start' | 'stop' | 'status';
  success: boolean;
  pid?: number;
  project_path?: string;
  project_name?: string;
  running?: boolean;
  uptime_ms?: number;
  error?: string;
}

export interface ExportLedgerInput {
  project_path?: string;
  format?: ExportFormat;
  since?: number;
  until?: number;
  limit?: number;
  out_file?: string;
}

export interface ExportLedgerOutput {
  project: ProjectSummary | null;
  format: ExportFormat;
  total: number;
  content: string;
  out_file?: string;
}

export interface DoctorOutput {
  node_version: string;
  node_ok: boolean;
  actis_home: string;
  db_path: string;
  db_exists: boolean;
  db_size_bytes: number;
  platform: string;
  arch: string;
  is_wsl_mount: boolean;
  projects: ProjectSummary[];
  daemon: DaemonStatus;
}

export const MCP_TOOLS = [
  {
    name: 'query_ledger',
    description:
      'Query the actis filesystem activity ledger using natural language (e.g., "what changed since Tuesday").',
    inputSchema: {
      type: 'object' as const,
      properties: {
        question: {
          type: 'string',
          description: 'Natural language query about filesystem activity',
        },
        project_path: {
          type: 'string',
          description: 'Optional target project root path',
        },
        limit: {
          type: 'number',
          description: 'Optional maximum number of events to return (default 50, max 200)',
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'get_history',
    description: 'Retrieve raw file events and diffs from the ledger with explicit filters.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_path: {
          type: 'string',
          description: 'Optional target project root path',
        },
        since: {
          type: 'number',
          description: 'Start timestamp in milliseconds since epoch',
        },
        until: {
          type: 'number',
          description: 'End timestamp in milliseconds since epoch',
        },
        path: {
          type: 'string',
          description: 'Substring filter for file paths',
        },
        event_types: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['create', 'modify', 'delete', 'rename'],
          },
          description: 'Filter by event types',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of events to return (default 100, max 500)',
        },
      },
    },
  },
  {
    name: 'list_projects',
    description: 'List all tracked projects in the actis ledger.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'apply_diff',
    description: 'Apply a unified diff patch to a project workspace and run pnpm test to verify changes.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        diff: {
          type: 'string',
          description: 'Unified diff format (--- +++ @@)',
        },
        project_path: {
          type: 'string',
          description: 'Target project root path',
        },
        dry_run: {
          type: 'boolean',
          description: 'Validate patch without modifying files or running tests (default false)',
        },
      },
      required: ['diff', 'project_path'],
    },
  },
  {
    name: 'watch_project',
    description: 'Control the actis background watcher daemon (start, stop, or check status).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_path: {
          type: 'string',
          description: 'Target project root path (required when action is "start")',
        },
        action: {
          type: 'string',
          enum: ['start', 'stop', 'status'],
          description: 'Daemon control action',
        },
        debounce_ms: {
          type: 'number',
          description: 'Optional debounce interval in ms when starting (default 500)',
        },
        rescan: {
          type: 'boolean',
          description: 'Optional rescan on start (default false)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'export_ledger',
    description: 'Export ledger events to JSON, CSV, or Markdown format.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_path: {
          type: 'string',
          description: 'Optional target project root path',
        },
        format: {
          type: 'string',
          enum: ['json', 'csv', 'md'],
          description: 'Export format (default "json")',
        },
        since: {
          type: 'number',
          description: 'Start timestamp in milliseconds since epoch',
        },
        until: {
          type: 'number',
          description: 'End timestamp in milliseconds since epoch',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of events to export (default 1000, max 5000)',
        },
        out_file: {
          type: 'string',
          description: 'Optional file path to write the exported output',
        },
      },
    },
  },
  {
    name: 'doctor',
    description: 'Run diagnostics on the actis environment, database, tracked projects, and daemon.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
] as const;

function resolveProject(projectPath?: string): Project | undefined {
  if (projectPath) {
    const resolved = resolve(projectPath);
    return getProjectByPath(resolved);
  }
  const projects = getActiveProjects();
  return projects[0];
}

function toProjectSummary(project: Project): ProjectSummary {
  return {
    id: project.id!,
    name: project.name,
    root_path: project.root_path,
  };
}

function clampLimit(value: unknown, defaultVal: number, maxVal: number): number {
  if (value === undefined || value === null) return defaultVal;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 1) {
    throw new Error(`Invalid limit: ${String(value)}`);
  }
  return Math.min(Math.floor(num), maxVal);
}

export async function query_ledger(input: QueryLedgerInput): Promise<QueryLedgerOutput> {
  if (!input || typeof input.question !== 'string' || !input.question.trim()) {
    throw new Error('Missing or empty required parameter: question');
  }

  const resolvedPath = input.project_path ? resolve(input.project_path) : undefined;
  const parsed = parseNaturalQuery(input.question, resolvedPath);
  const limit = clampLimit(input.limit ?? parsed.limit, 50, 200);

  const project = resolveProject(input.project_path);
  if (!project) {
    return {
      question: input.question,
      parsed,
      events: [],
      total: 0,
      project: null,
    };
  }

  const result = queryEvents(project.id!, {
    since: parsed.since,
    until: parsed.until,
    path: parsed.path,
    eventType: parsed.eventType,
    limit,
  });

  return {
    question: input.question,
    parsed,
    events: result.events,
    total: result.total,
    project: toProjectSummary(project),
  };
}

export async function get_history(input: GetHistoryInput = {}): Promise<GetHistoryOutput> {
  const limit = clampLimit(input.limit, 100, 500);
  const project = resolveProject(input.project_path);
  if (!project) {
    return {
      events: [],
      total: 0,
      project: null,
    };
  }

  if (input.event_types !== undefined) {
    if (!Array.isArray(input.event_types)) {
      throw new Error('event_types must be an array');
    }
    const valid = new Set(['create', 'modify', 'delete', 'rename']);
    for (const t of input.event_types) {
      if (!valid.has(t)) {
        throw new Error(`Invalid event_type: ${String(t)}`);
      }
    }
  }

  const result = queryEvents(project.id!, {
    since: input.since,
    until: input.until,
    path: input.path,
    eventTypes: input.event_types,
    limit,
  });

  return {
    events: result.events,
    total: result.total,
    project: toProjectSummary(project),
  };
}

export async function list_projects(): Promise<ListProjectsOutput> {
  const projects = getActiveProjects();
  return {
    projects: projects.map((p) => ({
      id: p.id!,
      name: p.name,
      root_path: p.root_path,
      created_at: p.created_at,
    })),
  };
}

function stripGitPrefix(fileName: string | undefined): string | undefined {
  if (!fileName) return undefined;
  if (fileName === '/dev/null') return '/dev/null';
  return fileName.replace(/^[ab]\//, '');
}

interface StagedPatchOp {
  targetPath: string;
  relPath: string;
  action: 'write' | 'delete';
  content: string;
}

export async function apply_diff(input: ApplyDiffInput): Promise<ApplyDiffOutput> {
  if (!input || typeof input.diff !== 'string' || !input.diff.trim()) {
    throw new Error('Missing or empty required parameter: diff');
  }
  if (typeof input.project_path !== 'string' || !input.project_path.trim()) {
    throw new Error('Missing or empty required parameter: project_path');
  }

  const projectRoot = resolve(input.project_path);
  if (!existsSync(projectRoot)) {
    return {
      success: false,
      output: `Project path does not exist: ${projectRoot}`,
      test_passed: false,
      files_changed: [],
    };
  }

  const dryRun = Boolean(input.dry_run);
  const patches = parsePatch(input.diff);
  if (patches.length === 0) {
    return {
      success: false,
      output: 'No valid patch hunks found in diff',
      test_passed: false,
      files_changed: [],
    };
  }

  const rootPrefix = projectRoot.endsWith(sep) ? projectRoot : projectRoot + sep;
  const staged: StagedPatchOp[] = [];

  for (const patch of patches) {
    const oldName = stripGitPrefix(patch.oldFileName);
    const newName = stripGitPrefix(patch.newFileName);

    const isDeletion = newName === '/dev/null';
    const relPath = isDeletion
      ? oldName
      : newName && newName !== '/dev/null'
        ? newName
        : oldName;

    if (!relPath || relPath === '/dev/null') {
      return {
        success: false,
        output: 'Unable to determine target file path from patch header',
        test_passed: false,
        files_changed: [],
      };
    }

    const targetPath = resolve(projectRoot, relPath);
    if (!targetPath.startsWith(rootPrefix)) {
      return {
        success: false,
        output: `Path traversal blocked: ${relPath} resolves outside ${projectRoot}`,
        test_passed: false,
        files_changed: [],
      };
    }

    const fileExists = existsSync(targetPath);
    const originalContent = fileExists ? readFileSync(targetPath, 'utf-8') : '';
    const patchedContent = applyPatch(originalContent, patch);

    if (patchedContent === false) {
      return {
        success: false,
        output: `Failed to apply hunk cleanly to ${relPath}`,
        test_passed: false,
        files_changed: [],
      };
    }

    staged.push({
      targetPath,
      relPath,
      action: isDeletion ? 'delete' : 'write',
      content: patchedContent,
    });
  }

  const filesChanged = staged.map((op) => op.relPath);

  if (dryRun) {
    return {
      success: true,
      output: `Dry run succeeded for ${filesChanged.length} file(s): ${filesChanged.join(', ')}`,
      test_passed: true,
      files_changed: filesChanged,
    };
  }

  for (const op of staged) {
    if (op.action === 'delete') {
      if (existsSync(op.targetPath)) {
        unlinkSync(op.targetPath);
      }
    } else {
      mkdirSync(dirname(op.targetPath), { recursive: true });
      writeFileSync(op.targetPath, op.content, 'utf-8');
    }
  }

  const testResult = spawnSync('pnpm', ['test'], {
    cwd: projectRoot,
    encoding: 'utf-8',
    timeout: 60_000,
  });

  const combinedOutput = [testResult.stdout, testResult.stderr, testResult.error?.message]
    .filter(Boolean)
    .join('\n')
    .trim();

  const testPassed = testResult.status === 0;

  return {
    success: testPassed,
    output: combinedOutput || (testPassed ? 'Tests passed' : `pnpm test exited with status ${testResult.status}`),
    test_passed: testPassed,
    files_changed: filesChanged,
  };
}

export async function watch_project(input: WatchProjectInput): Promise<WatchProjectOutput> {
  if (!input || !input.action || !['start', 'stop', 'status'].includes(input.action)) {
    throw new Error('Invalid or missing action. Expected "start", "stop", or "status".');
  }

  if (input.action === 'status') {
    const status = getDaemonStatus();
    return {
      action: 'status',
      success: true,
      running: status.running,
      pid: status.pid,
      project_path: status.projectPath,
      project_name: status.projectName,
      uptime_ms: status.uptimeMs,
    };
  }

  if (input.action === 'stop') {
    const res = await stopDaemon();
    return {
      action: 'stop',
      success: res.success,
      pid: res.pid,
      running: false,
      error: res.error,
    };
  }

  // action === 'start'
  if (typeof input.project_path !== 'string' || !input.project_path.trim()) {
    throw new Error('Missing required parameter: project_path when action is "start"');
  }

  const projectPath = resolve(input.project_path);
  if (!existsSync(projectPath)) {
    return {
      action: 'start',
      success: false,
      project_path: projectPath,
      error: `Project path does not exist: ${projectPath}`,
    };
  }

  let project = getProjectByPath(projectPath);
  if (!project) {
    project = createProject(basename(projectPath) || 'project', projectPath);
  }

  const started = await startDaemon({
    projectPath,
    projectName: project.name,
    debounceMs: input.debounce_ms ?? 500,
    pollingIntervalMs: 1000,
    rescanOnStart: input.rescan ?? false,
  });

  return {
    action: 'start',
    success: true,
    pid: started.pid,
    project_path: started.projectPath,
    project_name: project.name,
    running: true,
  };
}

export async function export_ledger(input: ExportLedgerInput = {}): Promise<ExportLedgerOutput> {
  const format: ExportFormat = input.format ?? 'json';
  if (!['json', 'csv', 'md'].includes(format)) {
    throw new Error(`Invalid format "${String(format)}". Expected "json", "csv", or "md".`);
  }

  const limit = clampLimit(input.limit, 1000, 5000);
  const project = resolveProject(input.project_path);
  if (!project) {
    return {
      project: null,
      format,
      total: 0,
      content: '',
    };
  }

  const { events } = queryEvents(project.id!, {
    since: input.since,
    until: input.until,
    limit,
  });

  const content = formatEventsExport(events, project, format);
  let outFile: string | undefined;
  if (input.out_file) {
    outFile = resolve(input.out_file);
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, content, 'utf-8');
  }

  return {
    project: toProjectSummary(project),
    format,
    total: events.length,
    content,
    ...(outFile ? { out_file: outFile } : {}),
  };
}

export async function doctor(): Promise<DoctorOutput> {
  const actisHome = process.env.ACTIS_HOME || join(homedir(), '.actis');
  const dbPath = join(actisHome, 'ledger.db');
  const dbExists = existsSync(dbPath);
  const dbSizeBytes = dbExists ? statSync(dbPath).size : 0;
  const nodeMajor = parseInt(process.version.slice(1).split('.')[0], 10);
  const projects = getActiveProjects().map(toProjectSummary);
  const daemon = getDaemonStatus();

  return {
    node_version: process.version,
    node_ok: Number.isFinite(nodeMajor) && nodeMajor >= 22,
    actis_home: actisHome,
    db_path: dbPath,
    db_exists: dbExists,
    db_size_bytes: dbSizeBytes,
    platform: process.platform,
    arch: process.arch,
    is_wsl_mount: process.platform === 'linux' && process.cwd().startsWith('/mnt/'),
    projects,
    daemon,
  };
}

