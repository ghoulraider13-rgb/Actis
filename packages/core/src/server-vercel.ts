// Vercel-compatible entrypoint using Web Standard fetch API
// The tracking stays fully offline; this server only reads the local ledger
// and exposes it as JSON + a dashboard UI.

import { readFileSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { getDb, queryEvents, getActiveProjects, closeDb } from "./db.js";
import { parseNaturalQuery, executeQuery } from "./query.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function json(data: unknown, status = 200) {
  const body = JSON.stringify(data);
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body)),
      "Cache-Control": "no-store",
    },
  });
}

async function handleApi(request: Request, url: URL): Promise<Response> {
  const pathname = url.pathname;

  if (pathname === "/api/projects") {
    const projects = await getActiveProjects();
    return json({ projects });
  }

  if (pathname === "/api/events") {
    const q = url.searchParams;
    let projectId: number | undefined;

    if (q.get("project")) {
      const projects = await getActiveProjects();
      const match = projects.find(
        (p) => String(p.id) === q.get("project") || p.name === q.get("project")
      );
      if (match) projectId = match.id;
    }

    if (projectId === undefined) {
      const projects = await getActiveProjects();
      projectId = projects[0]?.id;
    }

    if (projectId === undefined) {
      return json({ events: [], total: 0 });
    }

    const result = await queryEvents(projectId, {
      since: q.get("since") ? Number(q.get("since")) : undefined,
      until: q.get("until") ? Number(q.get("until")) : undefined,
      path: q.get("path") || undefined,
      eventType: q.get("type") || undefined,
      limit: q.get("limit") ? Math.min(Number(q.get("limit")), 500) : 100,
    });
    return json(result);
  }

  if (pathname === "/api/stats") {
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
      for (const t of ["create", "modify", "delete", "rename"] as const) {
        const r = await queryEvents(p.id!, { eventType: t, limit: 1 });
        (stats.byType as Record<string, number>)[t] += r.total;
      }
    }
    void db;
    return json(stats);
  }

  if (pathname === "/api/query") {
    const question = url.searchParams.get("q") || "";
    if (!question.trim()) {
      return json({ error: "Missing q parameter" }, 400);
    }

    // Vercel doesn't have projectArg, so we use the first active project
    const projects = await getActiveProjects();
    const root = projects[0]?.root_path || process.cwd();

    const parsed = parseNaturalQuery(question, root);
    const limitParam = url.searchParams.get("limit");
    if (limitParam) parsed.limit = Math.min(Number(limitParam), 500);

    const result = await executeQuery(parsed, root);

    return json({
      question,
      parsed,
      events: result.events,
      total: result.total,
      project: result.project
        ? {
            id: result.project.id,
            name: result.project.name,
            root_path: result.project.root_path,
          }
        : undefined,
    });
  }

  return json({ error: `Unknown API route: ${pathname}` }, 404);
}

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);

  try {
    if (url.pathname.startsWith("/api/")) {
      await getDb(); // warm the ledger before accepting requests
      return handleApi(request, url);
    }

    // Static files from public/, defaulting to the dashboard
    let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    filePath = filePath.split("?")[0];

    // Path traversal guard
    const publicDir = join(__dirname, "..", "public");
    const fullPath = join(publicDir, filePath);

    if (!fullPath.startsWith(publicDir)) {
      return new Response("Forbidden", { status: 403 });
    }

    if (existsSync(fullPath)) {
      const ext = fullPath.slice(fullPath.lastIndexOf("."));
      const body = readFileSync(fullPath);
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": MIME[ext] || "application/octet-stream",
          "Content-Length": String(body.length),
        },
      });
    } else {
      return new Response("Not found", {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      });
    }
  } catch (error) {
    console.error("[actis-web] error:", error);
    return json({ error: String(error) }, 500);
  }
}

