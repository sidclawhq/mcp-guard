/**
 * SidClaw MCP Guard — CLI
 *
 * Usage:
 *   sidclaw-mcp-guard                          Start the guard proxy
 *   sidclaw-mcp-guard demo [--interactive]     Run the SQL demo
 *   sidclaw-mcp-guard approve <id>             Approve a pending request
 *   sidclaw-mcp-guard deny <id>                Deny a pending request
 *   sidclaw-mcp-guard list                     List pending approvals
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, defaultConfig } from './config.js';
import { MCPGuard } from './guard.js';
import { ApprovalQueue } from './approval.js';
import { runDemo } from './demo.js';
import type { GuardConfig } from './types.js';

const VERSION = '0.1.0';

function printHelp(): void {
  const w = process.stderr.write.bind(process.stderr);
  w(`
\x1b[1msidclaw-mcp-guard\x1b[0m v${VERSION}
Stop AI agents from doing dangerous things through MCP.

\x1b[1mUSAGE\x1b[0m
  sidclaw-mcp-guard [options]                Start the guard proxy
  sidclaw-mcp-guard demo [--interactive]     Run the SQL demo
  sidclaw-mcp-guard approve <id>             Approve a pending request
  sidclaw-mcp-guard deny <id>                Deny a pending request
  sidclaw-mcp-guard list                     List pending approvals

\x1b[1mOPTIONS\x1b[0m
  --config, -c <path>     Config file (default: sidclaw.config.yaml)
  --upstream <cmd>        Upstream MCP server command
  --upstream-args <args>  Comma-separated args for upstream
  --approval-dir <dir>    Approval queue directory (default: .sidclaw/pending)
  --help, -h              Show this help
  --version, -v           Show version

\x1b[1mEXAMPLES\x1b[0m
  npx sidclaw-mcp-guard demo
  npx sidclaw-mcp-guard --upstream npx --upstream-args "-y,@modelcontextprotocol/server-postgres,postgresql://localhost/mydb"
  npx sidclaw-mcp-guard approve a1b2c3d4

\x1b[1mDOCS\x1b[0m
  https://github.com/sidclawhq/mcp-guard
`);
}

function parseArgs(argv: string[]): {
  command: 'proxy' | 'demo' | 'approve' | 'deny' | 'list' | 'help' | 'version';
  configPath: string;
  upstream?: string;
  upstreamArgs?: string[];
  approvalDir?: string;
  interactive: boolean;
  approvalId?: string;
} {
  type Command = 'proxy' | 'demo' | 'approve' | 'deny' | 'list' | 'help' | 'version';
  const result: {
    command: Command;
    configPath: string;
    interactive: boolean;
    upstream: string | undefined;
    upstreamArgs: string[] | undefined;
    approvalDir: string | undefined;
    approvalId: string | undefined;
  } = {
    command: 'proxy',
    configPath: 'sidclaw.config.yaml',
    interactive: false,
    upstream: undefined as string | undefined,
    upstreamArgs: undefined as string[] | undefined,
    approvalDir: undefined as string | undefined,
    approvalId: undefined as string | undefined,
  };

  const args = argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    switch (arg) {
      case 'demo':
        result.command = 'demo';
        break;
      case 'approve':
        result.command = 'approve';
        result.approvalId = args[++i];
        break;
      case 'deny':
        result.command = 'deny';
        result.approvalId = args[++i];
        break;
      case 'list':
        result.command = 'list';
        break;
      case '--help':
      case '-h':
        result.command = 'help';
        break;
      case '--version':
      case '-v':
        result.command = 'version';
        break;
      case '--config':
      case '-c':
        result.configPath = args[++i] ?? result.configPath;
        break;
      case '--upstream':
        result.upstream = args[++i];
        break;
      case '--upstream-args':
        result.upstreamArgs = (args[++i] ?? '').split(',').map((a) => a.trim());
        break;
      case '--approval-dir':
        result.approvalDir = args[++i];
        break;
      case '--interactive':
        result.interactive = true;
        break;
    }
  }

  return result;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  switch (parsed.command) {
    case 'help':
      printHelp();
      return;

    case 'version':
      process.stderr.write(`sidclaw-mcp-guard v${VERSION}\n`);
      return;

    case 'demo':
      await runDemo(parsed.interactive);
      return;

    case 'approve':
    case 'deny': {
      if (!parsed.approvalId) {
        process.stderr.write(`Error: ${parsed.command} requires an approval ID\n`);
        process.stderr.write(`Usage: sidclaw-mcp-guard ${parsed.command} <id>\n`);
        process.exit(1);
      }

      const dir = parsed.approvalDir ?? '.sidclaw/pending';
      const queue = new ApprovalQueue(dir);

      try {
        const decision = parsed.command === 'approve' ? 'approved' : 'denied';
        const result = queue.decide(parsed.approvalId, decision);
        const icon = decision === 'approved' ? '\x1b[32m✔\x1b[0m' : '\x1b[31m✘\x1b[0m';
        process.stderr.write(
          `${icon} ${decision}: ${result.tool}(${summarize(result.args)})\n`,
        );
      } catch (err) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exit(1);
      }
      return;
    }

    case 'list': {
      const dir = parsed.approvalDir ?? '.sidclaw/pending';
      const queue = new ApprovalQueue(dir);
      const pending = queue.list();

      if (pending.length === 0) {
        process.stderr.write('No pending approvals.\n');
        return;
      }

      process.stderr.write(`\n\x1b[1m${pending.length} pending approval(s):\x1b[0m\n\n`);
      for (const p of pending) {
        process.stderr.write(
          `  \x1b[33m⏳\x1b[0m \x1b[1m${p.id}\x1b[0m  ${p.tool}(${summarize(p.args)})\n` +
          `     Rule: ${p.rule}  Time: ${p.timestamp}\n\n`,
        );
      }
      process.stderr.write(
        `Approve: npx sidclaw-mcp-guard approve <id>\n` +
        `Deny:    npx sidclaw-mcp-guard deny <id>\n\n`,
      );
      return;
    }

    case 'proxy': {
      // Load config
      let config: GuardConfig;
      const configPath = resolve(parsed.configPath);

      if (existsSync(configPath)) {
        config = loadConfig(configPath);
      } else if (parsed.upstream) {
        config = defaultConfig();
      } else {
        process.stderr.write(
          `Error: Config file not found: ${parsed.configPath}\n` +
          `Create a sidclaw.config.yaml or use --upstream flag.\n\n` +
          `Quick start:\n` +
          `  npx sidclaw-mcp-guard demo\n\n`,
        );
        process.exit(1);
      }

      // CLI overrides
      if (parsed.upstream) {
        config.upstream = {
          command: parsed.upstream,
          args: parsed.upstreamArgs,
        };
      }
      if (parsed.approvalDir) {
        config.approval = { ...config.approval, dir: parsed.approvalDir };
      }

      const guard = new MCPGuard(config);

      try {
        await guard.start();
      } catch (err) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exit(1);
      }
      return;
    }
  }
}

function summarize(args: Record<string, unknown>): string {
  const sql = args['sql'] ?? args['query'];
  if (sql) {
    const s = String(sql).trim();
    return s.length > 60 ? s.substring(0, 57) + '...' : s;
  }
  const j = JSON.stringify(args);
  return j.length > 60 ? j.substring(0, 57) + '...' : j;
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
