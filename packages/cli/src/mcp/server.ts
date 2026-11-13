import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { closeDb } from '@actis/core';
import {
  MCP_TOOLS,
  apply_diff,
  doctor,
  export_ledger,
  get_history,
  list_projects,
  query_ledger,
  watch_project,
  type ApplyDiffInput,
  type ExportLedgerInput,
  type GetHistoryInput,
  type QueryLedgerInput,
  type WatchProjectInput,
} from './tools.js';

export function createMcpServer(): Server {
  const server = new Server(
    {
      name: 'actis',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [...MCP_TOOLS],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: unknown;

      switch (name) {
        case 'query_ledger':
          result = await query_ledger((args ?? {}) as unknown as QueryLedgerInput);
          break;
        case 'get_history':
          result = await get_history((args ?? {}) as unknown as GetHistoryInput);
          break;
        case 'list_projects':
          result = await list_projects();
          break;
        case 'apply_diff':
          result = await apply_diff((args ?? {}) as unknown as ApplyDiffInput);
          break;
        case 'watch_project':
          result = await watch_project((args ?? {}) as unknown as WatchProjectInput);
          break;
        case 'export_ledger':
          result = await export_ledger((args ?? {}) as unknown as ExportLedgerInput);
          break;
        case 'doctor':
          result = await doctor();
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

export async function startMcpServer(): Promise<void> {
  // Guardrail: Zero stdout pollution in stdio mode.
  // MCP over stdio uses process.stdout exclusively for JSON-RPC messages.
  console.log = (...args: unknown[]) => console.error(...args);
  console.info = (...args: unknown[]) => console.error(...args);
  console.warn = (...args: unknown[]) => console.error(...args);

  const server = createMcpServer();
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    try {
      await server.close();
    } catch {
      // ignore close errors during shutdown
    }
    closeDb();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(transport);
}
