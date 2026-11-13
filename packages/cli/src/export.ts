import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { getActiveProjects, getProjectByPath, queryEvents, type FileEvent, type Project } from '@actis/core';

export type ExportFormat = 'json' | 'csv' | 'md';

export interface ExportOptions {
  projectPath?: string;
  format: ExportFormat;
  since?: number;
  until?: number;
  limit?: number;
  outFile?: string;
}

function csvEscape(val: unknown): string {
  if (val === undefined || val === null) return '';
  const str = String(val);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function formatEventsExport(
  events: FileEvent[],
  project: Project,
  format: ExportFormat,
): string {
  if (format === 'json') {
    return JSON.stringify(
      {
        project: {
          id: project.id,
          name: project.name,
          root_path: project.root_path,
        },
        exported_at: new Date().toISOString(),
        total: events.length,
        events,
      },
      null,
      2,
    );
  }

  if (format === 'csv') {
    const header = [
      'id',
      'timestamp',
      'iso_time',
      'event_type',
      'path',
      'size_before',
      'size_after',
      'hash_before',
      'hash_after',
    ].join(',');
    const rows = events.map((ev) =>
      [
        ev.id ?? '',
        ev.timestamp,
        new Date(ev.timestamp).toISOString(),
        ev.event_type,
        ev.path,
        ev.size_before ?? '',
        ev.size_after ?? '',
        ev.hash_before ?? '',
        ev.hash_after ?? '',
      ]
        .map(csvEscape)
        .join(','),
    );
    return [header, ...rows].join('\n');
  }

  // Markdown
  const lines: string[] = [
    `# Actis Activity Export: ${project.name}`,
    '',
    `- **Root:** \`${project.root_path}\``,
    `- **Exported:** ${new Date().toISOString()}`,
    `- **Events:** ${events.length}`,
    '',
    '| Time | Type | Path | Size Δ |',
    '|------|------|------|--------|',
  ];

  for (const ev of events) {
    const iso = new Date(ev.timestamp).toISOString();
    const delta =
      ev.size_before !== undefined && ev.size_after !== undefined
        ? `${ev.size_after - ev.size_before >= 0 ? '+' : ''}${ev.size_after - ev.size_before} B`
        : '—';
    lines.push(`| ${iso} | ${ev.event_type} | \`${ev.path}\` | ${delta} |`);
  }

  return lines.join('\n');
}

export async function exportCommand(options: ExportOptions): Promise<void> {
  let project: Project | undefined;
  if (options.projectPath) {
    project = getProjectByPath(resolve(options.projectPath));
  } else {
    project = getActiveProjects()[0];
  }

  if (!project) {
    console.error('No tracked project found. Run "actis init <name> [path]" first.');
    process.exit(1);
  }

  const { events } = queryEvents(project.id!, {
    since: options.since,
    until: options.until,
    limit: options.limit ?? 1000,
  });

  const output = formatEventsExport(events, project, options.format);

  if (options.outFile) {
    const outPath = resolve(options.outFile);
    writeFileSync(outPath, output, 'utf-8');
    console.log(`Exported ${events.length} event(s) to ${outPath}`);
  } else {
    console.log(output);
  }
}
