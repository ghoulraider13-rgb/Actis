import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { createProject, logEvent, resetDbForTesting } from '@actis/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { apply_diff, get_history, list_projects, query_ledger } from '../src/mcp/tools.js';

let tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function resetTestLedger(): string {
  resetDbForTesting();
  const actisHome = makeTempDir('actis-mcp-home-');
  process.env.ACTIS_HOME = actisHome;
  return actisHome;
}

beforeEach(() => {
  resetTestLedger();
});

afterEach(() => {
  resetDbForTesting();
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
  tempDirs = [];
});

describe('MCP tools unit tests', () => {
  it('list_projects returns empty array when no projects exist', async () => {
    const res = await list_projects();
    expect(res).toEqual({ projects: [] });
  });

  it('list_projects returns created projects', async () => {
    const projDir = makeTempDir('actis-proj-');
    const created = createProject('demo-app', projDir);

    const res = await list_projects();
    expect(res.projects).toHaveLength(1);
    expect(res.projects[0]).toMatchObject({
      id: created.id,
      name: 'demo-app',
      root_path: projDir,
    });
  });

  it('query_ledger parses natural language and returns matching events', async () => {
    const projDir = makeTempDir('actis-proj-');
    const project = createProject('query-proj', projDir);
    const now = Date.now();

    logEvent({
      project_id: project.id!,
      path: 'src/index.ts',
      event_type: 'create',
      timestamp: now - 1000,
      diff: '+export const x = 1;',
    });
    logEvent({
      project_id: project.id!,
      path: 'README.md',
      event_type: 'modify',
      timestamp: now - 500,
      diff: '+updated',
    });

    const res = await query_ledger({
      question: 'new files in src/ today',
      project_path: projDir,
      limit: 10,
    });

    expect(res.question).toBe('new files in src/ today');
    expect(res.parsed.eventType).toBe('create');
    expect(res.parsed.path).toBe('src');
    expect(res.project).toMatchObject({
      id: project.id,
      name: 'query-proj',
      root_path: projDir,
    });
    expect(res.total).toBe(1);
    expect(res.events).toHaveLength(1);
    expect(res.events[0].path).toBe('src/index.ts');
  });

  it('query_ledger returns null project when no projects exist', async () => {
    const res = await query_ledger({ question: 'what changed today' });
    expect(res.project).toBeNull();
    expect(res.events).toEqual([]);
    expect(res.total).toBe(0);
  });

  it('get_history filters by since, until, path, event_types, and limit', async () => {
    const projDir = makeTempDir('actis-proj-');
    const project = createProject('history-proj', projDir);
    const base = 1_700_000_000_000;

    logEvent({
      project_id: project.id!,
      path: 'src/a.ts',
      event_type: 'create',
      timestamp: base + 1000,
    });
    logEvent({
      project_id: project.id!,
      path: 'src/a.ts',
      event_type: 'modify',
      timestamp: base + 2000,
    });
    logEvent({
      project_id: project.id!,
      path: 'src/b.ts',
      event_type: 'delete',
      timestamp: base + 3000,
    });

    const res = await get_history({
      project_path: projDir,
      since: base + 1500,
      until: base + 3500,
      event_types: ['modify', 'delete'],
      limit: 5,
    });

    expect(res.total).toBe(2);
    expect(res.events.map((e) => e.event_type)).toEqual(['delete', 'modify']);

    const pathFiltered = await get_history({
      project_path: projDir,
      path: 'a.ts',
    });
    expect(pathFiltered.total).toBe(2);
  });

  it('apply_diff modifies a file and runs pnpm test', async () => {
    const projDir = makeTempDir('actis-apply-');
    writeFileSync(
      join(projDir, 'package.json'),
      JSON.stringify({
        name: 'temp-test-proj',
        version: '1.0.0',
        scripts: {
          test: 'node -e "const fs=require(\'fs\'); if(!fs.readFileSync(\'hello.txt\',\'utf8\').includes(\'world\')) process.exit(1);"',
        },
      }),
    );
    writeFileSync(join(projDir, 'hello.txt'), 'hello\n', 'utf-8');

    const diff = [
      '--- a/hello.txt',
      '+++ b/hello.txt',
      '@@ -1,1 +1,1 @@',
      '-hello',
      '+hello world',
      '',
    ].join('\n');

    const res = await apply_diff({
      diff,
      project_path: projDir,
    });

    expect(res.success).toBe(true);
    expect(res.test_passed).toBe(true);
    expect(res.files_changed).toEqual(['hello.txt']);
    expect(readFileSync(join(projDir, 'hello.txt'), 'utf-8')).toBe('hello world\n');
  });

  it('apply_diff supports file creation and deletion', async () => {
    const projDir = makeTempDir('actis-create-del-');
    writeFileSync(
      join(projDir, 'package.json'),
      JSON.stringify({
        name: 'temp-create-del',
        version: '1.0.0',
        scripts: { test: 'node -e "process.exit(0)"' },
      }),
    );
    writeFileSync(join(projDir, 'old.txt'), 'remove me\n', 'utf-8');

    const diff = [
      '--- /dev/null',
      '+++ b/nested/new.txt',
      '@@ -0,0 +1,2 @@',
      '+line 1',
      '+line 2',
      '--- a/old.txt',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-remove me',
      '',
    ].join('\n');

    const res = await apply_diff({ diff, project_path: projDir });
    expect(res.success).toBe(true);
    expect(res.test_passed).toBe(true);
    expect(res.files_changed).toEqual(['nested/new.txt', 'old.txt']);
    expect(readFileSync(join(projDir, 'nested/new.txt'), 'utf-8')).toBe('line 1\nline 2\n');
    expect(existsSync(join(projDir, 'old.txt'))).toBe(false);
  });

  it('apply_diff dry_run validates without modifying files or running tests', async () => {
    const projDir = makeTempDir('actis-dry-');
    writeFileSync(
      join(projDir, 'package.json'),
      JSON.stringify({
        name: 'temp-dry',
        version: '1.0.0',
        scripts: { test: 'node -e "process.exit(1)"' },
      }),
    );
    writeFileSync(join(projDir, 'a.txt'), 'alpha\n', 'utf-8');

    const diff = [
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,1 +1,1 @@',
      '-alpha',
      '+beta',
      '',
    ].join('\n');

    const res = await apply_diff({ diff, project_path: projDir, dry_run: true });
    expect(res.success).toBe(true);
    expect(res.test_passed).toBe(true);
    expect(res.files_changed).toEqual(['a.txt']);
    expect(readFileSync(join(projDir, 'a.txt'), 'utf-8')).toBe('alpha\n');
  });

  it('apply_diff aborts atomically when any hunk fails to apply', async () => {
    const projDir = makeTempDir('actis-atomic-');
    writeFileSync(join(projDir, 'good.txt'), 'one\n', 'utf-8');
    writeFileSync(join(projDir, 'bad.txt'), 'actual content\n', 'utf-8');

    const diff = [
      '--- a/good.txt',
      '+++ b/good.txt',
      '@@ -1,1 +1,1 @@',
      '-one',
      '+two',
      '--- a/bad.txt',
      '+++ b/bad.txt',
      '@@ -1,1 +1,1 @@',
      '-nonexistent line',
      '+replacement',
      '',
    ].join('\n');

    const res = await apply_diff({ diff, project_path: projDir });
    expect(res.success).toBe(false);
    expect(res.test_passed).toBe(false);
    expect(res.files_changed).toEqual([]);
    expect(res.output).toContain('Failed to apply hunk cleanly to bad.txt');
    // good.txt must remain untouched
    expect(readFileSync(join(projDir, 'good.txt'), 'utf-8')).toBe('one\n');
  });

  it('apply_diff blocks path traversal outside project_path', async () => {
    const projDir = makeTempDir('actis-trav-');
    const diff = [
      '--- a/../escape.txt',
      '+++ b/../escape.txt',
      '@@ -0,0 +1,1 @@',
      '+pwned',
      '',
    ].join('\n');

    const res = await apply_diff({ diff, project_path: projDir });
    expect(res.success).toBe(false);
    expect(res.output).toContain('Path traversal blocked');
    expect(res.files_changed).toEqual([]);
  });
});

describe('MCP stdio client-server integration', () => {
  it('spawns actis mcp over stdio, lists tools, calls tools, and handles errors', async () => {
    const actisHome = resetTestLedger();
    const projDir = makeTempDir('actis-stdio-proj-');
    const project = createProject('stdio-proj', projDir);
    logEvent({
      project_id: project.id!,
      path: 'src/app.ts',
      event_type: 'create',
      timestamp: Date.now(),
      diff: '+console.log("hi");',
    });
    resetDbForTesting();

    const cliDistPath = resolve(__dirname, '../dist/cli.js');
    const transport = new StdioClientTransport({
      command: 'node',
      args: [cliDistPath, 'mcp'],
      env: {
        ...process.env,
        ACTIS_HOME: actisHome,
      },
    });

    const client = new Client(
      { name: 'actis-test-client', version: '1.0.0' },
      { capabilities: {} },
    );

    await client.connect(transport);

    try {
      const toolsResult = await client.listTools();
      const toolNames = toolsResult.tools.map((t) => t.name).sort();
      expect(toolNames).toEqual(['apply_diff', 'get_history', 'list_projects', 'query_ledger']);

      const listRes = await client.callTool({ name: 'list_projects', arguments: {} });
      expect(listRes.isError).toBeFalsy();
      const listData = JSON.parse((listRes.content[0] as { text: string }).text);
      expect(listData.projects).toHaveLength(1);
      expect(listData.projects[0].name).toBe('stdio-proj');

      const queryRes = await client.callTool({
        name: 'query_ledger',
        arguments: { question: 'what changed today', project_path: projDir },
      });
      expect(queryRes.isError).toBeFalsy();
      const queryData = JSON.parse((queryRes.content[0] as { text: string }).text);
      expect(queryData.total).toBe(1);
      expect(queryData.events[0].path).toBe('src/app.ts');

      const historyRes = await client.callTool({
        name: 'get_history',
        arguments: { project_path: projDir, event_types: ['create'] },
      });
      expect(historyRes.isError).toBeFalsy();
      const historyData = JSON.parse((historyRes.content[0] as { text: string }).text);
      expect(historyData.total).toBe(1);

      const errRes = await client.callTool({
        name: 'nonexistent_tool',
        arguments: {},
      });
      expect(errRes.isError).toBe(true);
      const errData = JSON.parse((errRes.content[0] as { text: string }).text);
      expect(errData.error).toContain('Unknown tool');
    } finally {
      await client.close();
    }
  });
});
