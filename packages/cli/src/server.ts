// Web dashboard server for actis — plain Node HTTP, zero extra dependencies.
// The tracking stays fully offline; this server only reads the local ledger
// and exposes it as JSON + a dashboard UI on localhost.
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getDb, queryEvents, getActiveProjects, closeDb } from '@actis/core';
import { parseNaturalQuery } from '@actis/core';
import { executeQuery as executeQueryCore } from '@actis/core';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
let port = 7420;
let projectArg: string | undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--project' && args[i + 1]) {
    projectArg = resolve(args[i + 1]);
    i++;
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function json(res: import('http').ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

// CLI-specific executeQuery that uses the actual database
async function executeQuery(parsed: any, projectRoot?: string): Promise<{ events: any[]; total: number; project: any | undefined }> {
  let project: any | undefined;

  if (projectRoot) {
    const proj = await getActiveProjects();
    const match = proj.find((p) => p.root_path === projectRoot);
    if (match) project = match;
  }

  if (!project) {
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

async function handleApi(
  res: import('http').ServerResponse,
  url: URL,
): Promise<void> {
  const pathname = url.pathname;

  if (pathname === '/api/projects') {
    const projects = await getActiveProjects();
    return json(res, 200, { projects });
  }

  if (pathname === '/api/events') {
    const q = url.searchParams;
    // Explicit project override, else the --project arg, else first active.
    let projectId: number | undefined;
    if (q.get('project')) {
      const projects = await getActiveProjects();
      const match = projects.find(
        (p) => String(p.id) === q.get('project') || p.name === q.get('project'),
      );
      if (match) projectId = match.id;
    }
    if (projectId === undefined && projectArg) {
      const projects = await getActiveProjects();
      const match = projects.find((p) => p.root_path === projectArg);
      if (match) projectId = match.id;
    }
    if (projectId === undefined) {
      const projects = await getActiveProjects();
      projectId = projects[0]?.id;
    }
    if (projectId === undefined) {
      return json(res, 200, { events: [], total: 0 });
    }

    const result = await queryEvents(projectId, {
      since: q.get('since') ? Number(q.get('since')) : undefined,
      until: q.get('until') ? Number(q.get('until')) : undefined,
      path: q.get('path') || undefined,
      eventType: q.get('type') || undefined,
      limit: q.get('limit') ? Math.min(Number(q.get('limit')), 500) : 100,
    });
    return json(res, 200, result);
  }

  if (pathname === '/api/stats') {
    const db = await getDb();
    const projects = await getActiveProjects();
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const sinceMs = dayStart.getTime();

    const stats: Record<string, unknown> = {
      projects: projects.length,
      totalEvents: 0,
      today: 0,
      byType: { create: 0, modify: 0, delete: 0, rename: 0 },
    };

    for (const p of projects) {
      const all = await queryEvents(p.id!, { limit: 1 });
      stats.totalEvents = (stats.totalEvents as number) + all.total;
      const today = await queryEvents(p.id!, { since: sinceMs, limit: 1 });
      stats.today = (stats.today as number) + today.total;
      for (const t of ['create', 'modify', 'delete', 'rename'] as const) {
        const r = await queryEvents(p.id!, { eventType: t, limit: 1 });
        (stats.byType as Record<string, number>)[t] += r.total;
      }
    }
    void db;
    return json(res, 200, stats);
  }

  if (pathname === '/api/query') {
    const question = url.searchParams.get('q') || '';
    if (!question.trim()) {
      return json(res, 400, { error: 'Missing q parameter' });
    }
    const root = projectArg || process.cwd();
    const parsed = parseNaturalQuery(question, root);
    const limitParam = url.searchParams.get('limit');
    if (limitParam) parsed.limit = Math.min(Number(limitParam), 500);

    const result = await executeQuery(parsed, root);
    // Inspectability: return exactly how the NL query was parsed.
    return json(res, 200, {
      question,
      parsed,
      events: result.events,
      total: result.total,
      project: result.project
        ? { id: result.project.id, name: result.project.name, root_path: result.project.root_path }
        : undefined,
    });
  }

  return json(res, 404, { error: `Unknown API route: ${pathname}` });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${port}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(res, url);
      return;
    }

    // Static files from public/, defaulting to the dashboard.
    let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
    filePath = filePath.split('?')[0];
    const fullPath = join(__dirname, '..', 'public', filePath);

    // Path traversal guard
    if (!fullPath.startsWith(join(__dirname, '..', 'public'))) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (existsSync(fullPath)) {
      const ext = fullPath.slice(fullPath.lastIndexOf('.'));
      const body = readFileSync(fullPath);
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': body.length,
      });
      res.end(body);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  } catch (error) {
    console.error('[actis-web] error:', error);
    if (!res.headersSent) {
      json(res, 500, { error: String(error) });
    } else {
      res.end();
    }
  }
});

async function main() {
  await getDb(); // warm the ledger before accepting requests
  server.listen(port, '127.0.0.1', () => {
    console.log(`[actis-web] Dashboard:  http://127.0.0.1:${port}`);
    console.log('[actis-web] Local-only. The ledger stays on this machine.');
  });
}

main().catch((e) => {
  console.error('[actis-web] failed to start:', e);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n[actis-web] Shutting down...');
  closeDb();
  server.close();
  process.exit(0);
});