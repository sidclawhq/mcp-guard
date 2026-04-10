/**
 * SQL demo — showcases allow / approve / deny decisions.
 *
 * The policy engine and audit log are real. The upstream database
 * is simplified for speed — no real database needed.
 */

import { writeFileSync } from 'node:fs';
import { evaluate } from './policy.js';
import { AuditLog } from './audit.js';
import { SID_BANNER, fmtAllow, fmtHold, fmtBlock } from './banner.js';
import type { PolicyRule } from './types.js';

const SQL_RULES: PolicyRule[] = [
  {
    name: 'allow-reads',
    description: 'Read-only queries are safe',
    match: { tool: 'query', pattern: 'sql-read' },
    action: 'allow',
  },
  {
    name: 'approve-writes',
    description: 'Data changes need approval',
    match: { tool: 'query', pattern: 'sql-write' },
    action: 'approve',
  },
  {
    name: 'deny-destructive',
    description: 'Schema changes are never allowed',
    match: { tool: 'query', pattern: 'sql-destructive' },
    action: 'deny',
    reason: 'Destructive schema operations are blocked by policy',
  },
];

const SHELL_RULES: PolicyRule[] = [
  {
    name: 'allow-safe-shell',
    description: 'Safe shell commands are allowed',
    match: { tool: 'execute', pattern: 'shell-safe' },
    action: 'allow',
  },
  {
    name: 'approve-risky-shell',
    description: 'Risky shell commands need approval',
    match: { tool: 'execute', pattern: 'shell-risky' },
    action: 'approve',
  },
  {
    name: 'deny-destructive-shell',
    description: 'Destructive shell commands are never allowed',
    match: { tool: 'execute', pattern: 'shell-destructive' },
    action: 'deny',
    reason: 'Destructive shell commands are blocked by policy',
  },
];

const DEMO_RULES: PolicyRule[] = [...SQL_RULES, ...SHELL_RULES];

interface DemoCase {
  tool: string;
  args: Record<string, unknown>;
  label: string;
  mockResult?: string;
}

const SQL_SHOWCASE: DemoCase[] = [
  { tool: 'query', args: { sql: 'SELECT * FROM users' }, label: 'SELECT * FROM users', mockResult: '3 rows returned' },
  { tool: 'query', args: { sql: 'DELETE FROM users WHERE id = 42' }, label: 'DELETE FROM users WHERE id = 42', mockResult: '1 row deleted' },
  { tool: 'query', args: { sql: 'DROP TABLE users' }, label: 'DROP TABLE users' },
];

const SHELL_SHOWCASE: DemoCase[] = [
  { tool: 'execute', args: { command: 'ls /home/user/projects' }, label: 'ls /home/user/projects', mockResult: 'list directory contents' },
  { tool: 'execute', args: { command: 'curl https://api.stripe.com/charges -X POST' }, label: 'curl https://api.stripe.com/charges -X POST', mockResult: 'network request' },
  { tool: 'execute', args: { command: 'rm -rf /' }, label: 'rm -rf /' },
];

export async function runDemo(interactive: boolean = false): Promise<void> {
  const w = process.stderr.write.bind(process.stderr);

  // Clean audit log
  try { writeFileSync('.sidclaw/audit.jsonl', ''); } catch { /* ignore */ }
  const audit = new AuditLog('.sidclaw/audit.jsonl');

  w(SID_BANNER);
  w('  \x1b[2mPolicy engine is real · upstream is simulated\x1b[0m\n\n');
  w('  \x1b[2mAgent  →  \x1b[0m\x1b[34mGuard\x1b[0m\x1b[2m  →  Upstream\x1b[0m\n');
  w('  \x1b[2m          ↓ allow / hold / block\x1b[0m\n\n');
  w('  \x1b[2m───────────────────────────────────────────────\x1b[0m\n\n');

  if (interactive) {
    await interactiveMode(w, audit);
  } else {
    await showcaseMode(w, audit);
  }

  // Show audit trail
  w('  \x1b[2m───────────────────────────────────────────────\x1b[0m\n');
  const entries = audit.read();
  w(`  \x1b[2mAudit log → .sidclaw/audit.jsonl (${entries.length} entries written)\x1b[0m\n\n`);

  w('  \x1b[1mNext:\x1b[0m\n');
  w('    npx sidclaw-mcp-guard quickstart   \x1b[2mSet up a real guarded MCP server\x1b[0m\n');
  w('    npx sidclaw-mcp-guard demo -i      \x1b[2mTry your own SQL queries\x1b[0m\n');
  w('\n');
}

async function showcaseMode(
  w: (s: string) => boolean,
  audit: AuditLog,
): Promise<void> {
  w('  \x1b[1mSQL queries:\x1b[0m\n\n');
  for (const test of SQL_SHOWCASE) {
    evaluateAndPrint(w, audit, test.tool, test.args, test.label, test.mockResult);
  }

  w('  \x1b[1mShell commands:\x1b[0m\n\n');
  for (const test of SHELL_SHOWCASE) {
    evaluateAndPrint(w, audit, test.tool, test.args, test.label, test.mockResult);
  }
}

async function interactiveMode(
  w: (s: string) => boolean,
  audit: AuditLog,
): Promise<void> {
  const readline = await import('node:readline');

  // Show all showcase queries first
  w('  \x1b[1mSQL queries:\x1b[0m\n\n');
  for (const test of SQL_SHOWCASE) {
    evaluateAndPrint(w, audit, test.tool, test.args, test.label, test.mockResult);
  }

  w('  \x1b[1mShell commands:\x1b[0m\n\n');
  for (const test of SHELL_SHOWCASE) {
    evaluateAndPrint(w, audit, test.tool, test.args, test.label, test.mockResult);
  }

  // Then let the user try their own
  w('  \x1b[2m─────────────────────────────────────────────────\x1b[0m\n\n');
  w('  Type a SQL query to see how the guard evaluates it.\n');
  w('  Press Ctrl+C or type "exit" to quit.\n\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr, prompt: '  \x1b[1msql>\x1b[0m ' });
  rl.prompt();

  await new Promise<void>((resolve) => {
    rl.on('line', (line: string) => {
      const sql = line.trim();
      if (!sql || sql === 'exit' || sql === 'quit') { rl.close(); resolve(); return; }
      evaluateAndPrint(w, audit, 'query', { sql }, sql);
      rl.prompt();
    });
    rl.on('close', resolve);
  });

  w('\n');
}

function evaluateAndPrint(
  w: (s: string) => boolean,
  audit: AuditLog,
  tool: string,
  args: Record<string, unknown>,
  label: string,
  mockResult?: string,
): void {
  const result = evaluate(tool, args, DEMO_RULES, 'deny');

  if (result.action === 'allow') {
    w(fmtAllow(label, result.explanation ?? '', mockResult));
  } else if (result.action === 'approve') {
    w(fmtHold(label, result.explanation ?? '', mockResult));
  } else {
    w(fmtBlock(label, result.explanation ?? ''));
  }

  w('\n');

  audit.write({
    timestamp: new Date().toISOString(),
    tool,
    args,
    decision: result.action,
    rule: result.rule?.name,
    reason: result.reason,
    explanation: result.explanation,
    duration_ms: 0,
  });
}
