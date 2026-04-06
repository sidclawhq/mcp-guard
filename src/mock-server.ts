/**
 * Built-in mock PostgreSQL MCP server.
 *
 * Provides a `query` tool that accepts SQL and returns mock results.
 * Used by the quickstart command so users get a real MCP experience
 * without needing an actual database.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const MOCK_DATA: Record<string, unknown[]> = {
  users: [
    { id: 1, name: 'Alice Chen', email: 'alice@acme.com', role: 'admin' },
    { id: 2, name: 'Bob Martinez', email: 'bob@acme.com', role: 'user' },
    { id: 3, name: 'Carol Smith', email: 'carol@acme.com', role: 'user' },
  ],
  orders: [
    { id: 101, user_id: 1, total: 299.99, status: 'shipped' },
    { id: 102, user_id: 2, total: 49.50, status: 'pending' },
    { id: 103, user_id: 3, total: 1250.00, status: 'delivered' },
  ],
  sessions: [
    { id: 's1', user_id: 1, ip: '10.0.0.1', created_at: '2026-04-06T10:00:00Z' },
    { id: 's2', user_id: 2, ip: '10.0.0.2', created_at: '2026-04-06T11:30:00Z' },
  ],
};

function handleQuery(sql: string): { text: string; isError?: boolean } {
  const s = sql.trim();
  const upper = s.toUpperCase();

  // SELECT
  if (upper.startsWith('SELECT')) {
    const tableMatch = s.match(/FROM\s+(\w+)/i);
    const table = tableMatch?.[1]?.toLowerCase();
    const data = table && MOCK_DATA[table];
    if (data) {
      return { text: JSON.stringify(data, null, 2) };
    }
    return { text: JSON.stringify([{ result: 'ok', rows: 0 }]) };
  }

  // INSERT
  if (upper.startsWith('INSERT')) {
    return { text: '1 row inserted' };
  }

  // UPDATE
  if (upper.startsWith('UPDATE')) {
    return { text: '1 row updated' };
  }

  // DELETE
  if (upper.startsWith('DELETE')) {
    return { text: '1 row deleted' };
  }

  // DDL
  if (upper.startsWith('DROP') || upper.startsWith('TRUNCATE') || upper.startsWith('ALTER') || upper.startsWith('CREATE')) {
    return { text: 'DDL executed' };
  }

  // EXPLAIN
  if (upper.startsWith('EXPLAIN')) {
    return { text: 'Seq Scan on users  (cost=0.00..1.03 rows=3 width=64)' };
  }

  return { text: `Query executed: ${s}` };
}

export async function startMockServer(): Promise<void> {
  const server = new Server(
    { name: 'mock-postgres', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
      name: 'query',
      description: 'Execute a SQL query against the database',
      inputSchema: {
        type: 'object' as const,
        properties: {
          sql: { type: 'string', description: 'SQL query to execute' },
        },
        required: ['sql'],
      },
    }],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const sql = String(request.params.arguments?.['sql'] ?? '');
    const result = handleQuery(sql);
    return {
      content: [{ type: 'text' as const, text: result.text }],
      isError: result.isError,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// If run directly, start the server
const isDirectRun = process.argv[1]?.endsWith('mock-server.js') ||
                    process.argv[1]?.endsWith('mock-server.ts');
if (isDirectRun) {
  startMockServer().catch((err) => {
    process.stderr.write(`Mock server error: ${err}\n`);
    process.exit(1);
  });
}
