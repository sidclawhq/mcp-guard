/**
 * SQL demo — showcases allow / approve / deny decisions.
 *
 * The policy engine and audit log are real. The upstream database
 * is simplified for speed — no real database needed.
 */

import { writeFileSync } from 'node:fs';
import { evaluate } from './policy.js';
import { AuditLog } from './audit.js';
import { SHIELD, flowAllow, flowHold, flowBlock } from './banner.js';
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

  w(SHIELD);
  w('\n');
  w('  \x1b[2mThe policy engine and audit trail are real.\x1b[0m\n');
  w('  \x1b[2mThe database is simulated so you don\'t need one.\x1b[0m\n');
  w('\n');

  if (interactive) {
    await interactiveMode(w, audit);
  } else {
    await showcaseMode(w, audit);
  }

  // Show audit trail
  w('  \x1b[2m─── Audit log (.sidclaw/audit.jsonl) ───\x1b[0m\n\n');
  for (const entry of audit.read()) {
    const icon = entry.decision === 'allow' ? '\x1b[32m✔\x1b[0m'
      : entry.decision === 'deny' ? '\x1b[31m✘\x1b[0m' : '\x1b[33m⏳\x1b[0m';
    const sql = (entry.args['sql'] as string) ?? '';
    const short = sql.length > 45 ? sql.substring(0, 42) + '...' : sql;
    w(`    ${icon} ${entry.decision.padEnd(7)} ${short}\n`);
    if (entry.explanation) {
      w(`      \x1b[2m${entry.explanation}\x1b[0m\n`);
    }
  }

  w('\n');
  w('  \x1b[1mNext:\x1b[0m\n');
  w('    npx sidclaw-mcp-guard quickstart   Set up a real guarded MCP server\n');
  w('    npx sidclaw-mcp-guard demo -i      Try your own SQL queries\n');
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
    w(flowAllow('query', sql));
    w(`    ${result.explanation}\n`);
    if (mockResult) w(`    \x1b[2m→ ${mockResult}\x1b[0m\n`);
  } else if (result.action === 'approve') {
    w(flowHold('query', sql));
    w(`    ${result.explanation}\n`);
    if (mockResult) w(`    \x1b[2m→ Would forward after approval: ${mockResult}\x1b[0m\n`);
  } else {
    w(flowBlock('query', sql));
    w(`    ${result.explanation}\n`);
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
