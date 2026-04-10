/**
 * SidClaw MCP Guard — CLI
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, defaultConfig } from './config.js';
import { MCPGuard } from './guard.js';
import { ApprovalQueue } from './approval.js';
import { runDemo } from './demo.js';
import { runQuickstart } from './quickstart.js';
import { startUIServer } from './ui.js';
import type { GuardConfig } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgJson = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));
const VERSION: string = pkgJson.version;

function printHelp(): void {
  const w = process.stderr.write.bind(process.stderr);
  w(`
\x1b[1msidclaw-mcp-guard\x1b[0m v${VERSION}
Stop AI agents from doing dangerous things through MCP.

\x1b[1mGET STARTED\x1b[0m
  sidclaw-mcp-guard quickstart               Set up a real guarded MCP server
  sidclaw-mcp-guard demo                     Quick showcase of policy decisions
  sidclaw-mcp-guard demo -i                  Interactive — try your own SQL

\x1b[1mRUN\x1b[0m
  sidclaw-mcp-guard [options]                Start the guard proxy
  sidclaw-mcp-guard ui                       Open the approval dashboard

\x1b[1mAPPROVALS\x1b[0m
  sidclaw-mcp-guard approve <id>             Approve a pending request
  sidclaw-mcp-guard deny <id>                Deny a pending request
  sidclaw-mcp-guard list                     List pending approvals
  sidclaw-mcp-guard clean                    Remove stale approval files

\x1b[1mOPTIONS\x1b[0m
  --config, -c <path>     Config file (default: sidclaw.config.yaml)
  --upstream <cmd>        Upstream MCP server command
  --upstream-args <args>  Comma-separated args for upstream
  --observe               Observe mode: log decisions but forward all calls
  --ui                    Start the approval dashboard alongside the proxy
  --ui-port <port>        Dashboard port (default: 9091)
  --help, -h              Show this help
  --version, -v           Show version

\x1b[1mEXAMPLES\x1b[0m
  npx sidclaw-mcp-guard quickstart
  npx sidclaw-mcp-guard demo -i
  npx sidclaw-mcp-guard --ui --upstream npx --upstream-args "-y,@modelcontextprotocol/server-postgres,postgresql://localhost/mydb"

\x1b[1mDOCS\x1b[0m
  https://github.com/sidclawhq/mcp-guard
`);
}

type Command = 'proxy' | 'quickstart' | 'demo' | 'ui' | 'approve' | 'deny' | 'list' | 'clean' | 'help' | 'version';

interface ParsedArgs {
  command: Command;
  configPath: string;
  upstream?: string;
  upstreamArgs?: string[];
  approvalDir?: string;
  interactive: boolean;
  approvalId?: string;
  observe: boolean;
  ui: boolean;
  uiPort?: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: 'proxy',
    configPath: 'sidclaw.config.yaml',
    interactive: false,
    observe: false,
    ui: false,
  };

  const args = argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    switch (arg) {
      case 'quickstart':
        result.command = 'quickstart';
        break;
      case 'demo':
        result.command = 'demo';
        break;
      case 'ui':
        if (result.command === 'proxy') result.command = 'ui';
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
      case 'clean':
        result.command = 'clean';
        break;
      case '--help': case '-h':
        result.command = 'help';
        break;
      case '--version': case '-v':
        result.command = 'version';
        break;
      case '--config': case '-c':
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
      case '--interactive': case '-i':
        result.interactive = true;
        break;
      case '--observe':
        result.observe = true;
        break;
      case '--ui':
        result.ui = true;
        break;
      case '--ui-port': case '--port':
        result.uiPort = parseInt(args[++i] ?? '9091', 10);
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

    case 'quickstart':
      await runQuickstart({ uiPort: parsed.uiPort });
      return;

    case 'demo':
      await runDemo(parsed.interactive);
      return;

    case 'ui': {
      const uiPort = parsed.uiPort ?? 9091;
      const approvalDir = parsed.approvalDir ?? '.sidclaw/pending';
      const auditPath = getAuditPath(parsed);

      const { port } = await startUIServer({ port: uiPort, approvalDir, auditPath });

      process.stderr.write(`\n\x1b[1m🛡️  SidClaw Guard — Approval Dashboard\x1b[0m\n`);
      process.stderr.write(`   http://localhost:${port}\n\n`);
      process.stderr.write(`   Approve or deny pending requests from your browser.\n`);
      process.stderr.write(`   Press Ctrl+C to stop.\n\n`);
      return;
    }

    case 'approve':
    case 'deny': {
      if (!parsed.approvalId) {
        process.stderr.write(`Error: ${parsed.command} requires an approval ID\n`);
        process.stderr.write(`Usage: sidclaw-mcp-guard ${parsed.command} <id>\n`);
        process.exit(1);
      }
      const queue = new ApprovalQueue(parsed.approvalDir ?? '.sidclaw/pending');
      try {
        const decision = parsed.command === 'approve' ? 'approved' : 'denied';
        const result = queue.decide(parsed.approvalId, decision);
        const icon = decision === 'approved' ? '\x1b[32m✔\x1b[0m' : '\x1b[31m✘\x1b[0m';
        process.stderr.write(`${icon} ${decision}: ${result.tool}(${summarize(result.args)})\n`);
      } catch (err) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exit(1);
      }
      return;
    }

    case 'list': {
      const queue = new ApprovalQueue(parsed.approvalDir ?? '.sidclaw/pending');
      const pending = queue.list();
      if (pending.length === 0) {
        process.stderr.write('No pending approvals.\n');
        return;
      }
      process.stderr.write(`\n\x1b[1m${pending.length} pending approval(s):\x1b[0m\n\n`);
      for (const p of pending) {
        const age = Math.round((Date.now() - new Date(p.timestamp).getTime()) / 1000);
        const ageStr = age < 60 ? `${age}s ago` : `${Math.round(age / 60)}m ago`;
        process.stderr.write(
          `  \x1b[33m⏳\x1b[0m \x1b[1m${p.id}\x1b[0m  ${p.tool}(${summarize(p.args)})\n` +
          (p.explanation ? `     ${p.explanation}\n` : '') +
          `     Rule: ${p.rule}  ${ageStr}\n\n`,
        );
      }
      process.stderr.write(
        `  Approve: npx sidclaw-mcp-guard approve <id>\n` +
        `  Deny:    npx sidclaw-mcp-guard deny <id>\n` +
        `  Or open: npx sidclaw-mcp-guard ui\n\n`,
      );
      return;
    }

    case 'clean': {
      const queue = new ApprovalQueue(parsed.approvalDir ?? '.sidclaw/pending');
      const removed = queue.cleanup();
      process.stderr.write(removed > 0
        ? `\x1b[32m✔\x1b[0m Cleaned ${removed} stale approval file(s).\n`
        : 'Nothing to clean.\n',
      );
      return;
    }

    case 'proxy': {
      let config: GuardConfig;
      const configPath = resolve(parsed.configPath);

      if (existsSync(configPath)) {
        config = loadConfig(configPath);
      } else if (parsed.upstream) {
        config = defaultConfig();
      } else {
        process.stderr.write(
          `Config file not found: ${parsed.configPath}\n\n` +
          `Get started:\n` +
          `  npx sidclaw-mcp-guard quickstart    Set up a real guarded MCP server\n` +
          `  npx sidclaw-mcp-guard demo          Quick policy showcase\n\n`,
        );
        process.exit(1);
      }

      // CLI overrides
      if (parsed.upstream) {
        config.upstream = { command: parsed.upstream, args: parsed.upstreamArgs };
      }
      if (parsed.observe) config.mode = 'observe';
      if (parsed.approvalDir) config.approval = { ...config.approval, dir: parsed.approvalDir };

      const guard = new MCPGuard(config);
      try {
        await guard.start();
      } catch (err) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exit(1);
      }

      // Start UI alongside proxy if requested
      if (parsed.ui) {
        const uiPort = parsed.uiPort ?? 9091;
        const approvalDir = config.approval?.dir ?? '.sidclaw/pending';
        const auditPath = config.audit?.path ?? '.sidclaw/audit.jsonl';
        try {
          const { port } = await startUIServer({ port: uiPort, approvalDir, auditPath });
          process.stderr.write(`[sidclaw]    Dashboard: http://localhost:${port}\n`);
        } catch (err) {
          process.stderr.write(`[sidclaw] Warning: dashboard failed on port ${uiPort}: ${(err as Error).message}\n`);
        }
      }
      return;
    }
  }
}

function getAuditPath(parsed: ParsedArgs): string {
  if (existsSync(resolve(parsed.configPath))) {
    try {
      return loadConfig(resolve(parsed.configPath)).audit?.path ?? '.sidclaw/audit.jsonl';
    } catch { /* ignore */ }
  }
  return '.sidclaw/audit.jsonl';
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
