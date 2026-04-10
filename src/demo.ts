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

const DEMO_RULES: PolicyRule[] = [
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

interface DemoCase {
  sql: string;
  mockResult?: string;
}

const SHOWCASE: DemoCase[] = [
  { sql: 'SELECT * FROM users', mockResult: '3 rows returned' },
  { sql: 'DELETE FROM users WHERE id = 42', mockResult: '1 row deleted' },
  { sql: 'DROP TABLE users' },
];

export async function runDemo(interactive: boolean = false): Promise<void> {
  const w = process.stderr.write.bind(process.stderr);

  // Clean audit log
  try { writeFileSync('.sidclaw/audit.jsonl', ''); } catch { /* ignore */ }
  const audit = new AuditLog('.sidclaw/audit.jsonl');

  w(SID_BANNER);
  w('  \x1b[2mPolicy engine is real · database is simulated\x1b[0m\n\n');
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
  for (const test of SHOWCASE) {
    evaluateAndPrint(w, audit, test.sql, test.mockResult);
  }
}

async function interactiveMode(
  w: (s: string) => boolean,
  audit: AuditLog,
): Promise<void> {
  const readline = await import('node:readline');

  // Show the three showcase queries first
  for (const test of SHOWCASE) {
    evaluateAndPrint(w, audit, test.sql, test.mockResult);
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
      evaluateAndPrint(w, audit, sql);
      rl.prompt();
    });
    rl.on('close', resolve);
  });

  w('\n');
}

function evaluateAndPrint(
  w: (s: string) => boolean,
  audit: AuditLog,
  sql: string,
  mockResult?: string,
): void {
  const result = evaluate('query', { sql }, DEMO_RULES, 'deny');

  if (result.action === 'allow') {
    w(fmtAllow(sql, result.explanation ?? '', mockResult));
  } else if (result.action === 'approve') {
    w(fmtHold(sql, result.explanation ?? '', mockResult));
  } else {
    w(fmtBlock(sql, result.explanation ?? ''));
  }

  w('\n');

  audit.write({
    timestamp: new Date().toISOString(),
    tool: 'query',
    args: { sql },
    decision: result.action,
    rule: result.rule?.name,
    reason: result.reason,
    explanation: result.explanation,
    duration_ms: 0,
  });
}
