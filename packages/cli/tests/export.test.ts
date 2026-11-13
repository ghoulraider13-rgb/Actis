import { describe, expect, it } from 'vitest';
import type { FileEvent, Project } from '@actis/core';
import { formatEventsExport } from '../src/export.js';

const project: Project = {
  id: 1,
  name: 'actis-demo',
  root_path: '/tmp/actis-demo',
  created_at: 1_700_000_000_000,
  is_active: 1,
};

const events: FileEvent[] = [
  {
    id: 1,
    project_id: 1,
    path: 'src/app.ts',
    event_type: 'modify',
    timestamp: 1_700_000_005_000,
    size_before: 100,
    size_after: 125,
    hash_before: 'aaa',
    hash_after: 'bbb',
  },
];

describe('actis export formatting', () => {
  it('formats events as JSON', () => {
    const out = formatEventsExport(events, project, 'json');
    const parsed = JSON.parse(out);
    expect(parsed.project.name).toBe('actis-demo');
    expect(parsed.total).toBe(1);
    expect(parsed.events[0].path).toBe('src/app.ts');
  });

  it('formats events as CSV', () => {
    const out = formatEventsExport(events, project, 'csv');
    const lines = out.split('\n');
    expect(lines[0]).toContain('id,timestamp,iso_time,event_type,path');
    expect(lines[1]).toContain('modify,src/app.ts,100,125,aaa,bbb');
  });

  it('formats events as Markdown', () => {
    const out = formatEventsExport(events, project, 'md');
    expect(out).toContain('# Actis Activity Export: actis-demo');
    expect(out).toContain('| modify | `src/app.ts` | +25 B |');
  });
});
