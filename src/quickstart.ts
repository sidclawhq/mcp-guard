/**
 * Quickstart command — gets a real guarded MCP setup running in one command.
 *
 * Starts: mock database MCP server → guard proxy → approval dashboard.
 * Prints MCP client config to connect from Claude Code, Cursor, etc.
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { startUIServer } from './ui.js';
import { ApprovalQueue } from './approval.js';

const QUICKSTART_CONFIG = `# SidClaw Guard — Quickstart config
# This file was created by "sidclaw-mcp-guard quickstart"

rules:
  - name: allow-reads
    description: Read-only queries are safe
    match:
      pattern: sql-read
    action: allow

  - name: approve-writes
    description: Data changes need approval
    match:
      pattern: sql-write
    action: approve

  - name: deny-destructive
    description: Schema changes are never allowed
    match:
      pattern: sql-destructive
    action: deny
    reason: "Destructive schema operations are blocked by policy"

default: deny
`;

export async function runQuickstart(options: { uiPort?: number } = {}): Promise<void> {
  const w = process.stderr.write.bind(process.stderr);
  const uiPort = options.uiPort ?? 9091;

  w('\n');
  w('\x1b[1m🛡️  SidClaw Guard — Quickstart\x1b[0m\n');
  w('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  w('\n');

  // 1. Create config if needed
  const configPath = resolve('sidclaw.config.yaml');
  if (!existsSync(configPath)) {
    writeFileSync(configPath, QUICKSTART_CONFIG);
    w('  \x1b[32m✔\x1b[0m Created sidclaw.config.yaml\n');
  } else {
    w('  \x1b[32m✔\x1b[0m Using existing sidclaw.config.yaml\n');
  }

  // 2. Ensure .sidclaw directory
  mkdirSync('.sidclaw/pending', { recursive: true });
  w('  \x1b[32m✔\x1b[0m Created .sidclaw/ directory\n');

  // 3. Clean up stale approvals
  const queue = new ApprovalQueue('.sidclaw/pending');
  const cleaned = queue.cleanup();
  if (cleaned > 0) {
    w(`  \x1b[32m✔\x1b[0m Cleaned ${cleaned} stale approval(s)\n`);
  }

  // 4. Start the approval dashboard
  let dashboardUrl = '';
  try {
    const { port } = await startUIServer({
      port: uiPort,
      approvalDir: '.sidclaw/pending',
      auditPath: '.sidclaw/audit.jsonl',
    });
    dashboardUrl = `http://localhost:${port}`;
    w(`  \x1b[32m✔\x1b[0m Dashboard running at \x1b[1m${dashboardUrl}\x1b[0m\n`);
  } catch (err) {
    w(`  \x1b[33m!\x1b[0m Dashboard failed to start on port ${uiPort}: ${(err as Error).message}\n`);
  }

  w('\n');
  w('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  w('\n');

  // 5. Resolve the path to the mock server entry
  const cliPath = new URL(import.meta.url).pathname;
  const distDir = dirname(cliPath);
  const mockServerPath = resolve(distDir, 'mock-server.js');

  // 6. Print the MCP config for the user to add
  w('  \x1b[1mAdd this to your MCP client config:\x1b[0m\n');
  w('\n');

  const mcpConfig = {
    mcpServers: {
      'guarded-database': {
        command: 'npx',
        args: [
          'sidclaw-mcp-guard',
          '--config', configPath,
          '--upstream', 'node',
          '--upstream-args', mockServerPath,
        ],
      },
    },
  };
  w(`  \x1b[2m${JSON.stringify(mcpConfig, null, 2).split('\n').join('\n  ')}\x1b[0m\n`);
  w('\n');
  w('  \x1b[2mFor Claude Code: add to ~/.claude/mcp.json\x1b[0m\n');
  w('  \x1b[2mFor Cursor:      add to MCP server settings\x1b[0m\n');
  w('\n');
  w('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  w('\n');
  w('  \x1b[1mWhat happens next:\x1b[0m\n');
  w('\n');
  w('  Your AI agent will see a "query" tool. When it calls it:\n');
  w('\n');
  w('    \x1b[32mSELECT\x1b[0m queries       →  \x1b[32m✔ Allowed\x1b[0m    (forwarded to database)\n');
  w('    \x1b[33mDELETE/UPDATE\x1b[0m queries →  \x1b[33m⏳ Held\x1b[0m       (waiting for your approval)\n');
  w('    \x1b[31mDROP TABLE\x1b[0m queries    →  \x1b[31m✘ Blocked\x1b[0m    (never reaches database)\n');
  w('\n');
  if (dashboardUrl) {
    w(`  Open \x1b[1m${dashboardUrl}\x1b[0m to approve or deny requests.\n`);
  }
  w('  Or use the CLI: npx sidclaw-mcp-guard approve <id>\n');
  w('\n');
  w('  \x1b[2mConfig:    sidclaw.config.yaml\x1b[0m\n');
  w('  \x1b[2mAudit log: .sidclaw/audit.jsonl\x1b[0m\n');
  w('  \x1b[2mPending:   .sidclaw/pending/\x1b[0m\n');
  w('\n');
  w('  Press Ctrl+C to stop the dashboard.\n');
  w('\n');
}
