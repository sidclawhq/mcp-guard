/**
 * Self-contained SQL demo.
 *
 * Demonstrates allow / approve / deny on SQL tool calls
 * without needing a real MCP server or database.
 */

import { writeFileSync } from 'node:fs';
import { evaluate } from './policy.js';
import { AuditLog } from './audit.js';
import type { PolicyRule } from './types.js';

const DEMO_RULES: PolicyRule[] = [
  {
    name: 'allow-reads',
    description: 'Allow SELECT queries',
    match: { tool: 'query', args: { sql: '^\\s*SELECT' } },
    action: 'allow',
  },
  {
    name: 'approve-mutations',
    description: 'Require approval for data changes',
    match: { tool: 'query', args: { sql: '^\\s*(DELETE|UPDATE|INSERT)' } },
    action: 'approve',
  },
  {
    name: 'deny-destructive',
    description: 'Block destructive schema operations',
    match: { tool: 'query', args: { sql: '^\\s*(DROP|TRUNCATE|ALTER)' } },
    action: 'deny',
    reason: 'Destructive schema operations are blocked by policy',
  },
];

interface DemoTestCase {
  label: string;
  sql: string;
  expected: 'allow' | 'approve' | 'deny';
  mockResult?: string;
}

const TEST_CASES: DemoTestCase[] = [
  {
    label: 'Read user data',
    sql: 'SELECT * FROM users',
    expected: 'allow',
    mockResult: '[\n  { "id": 1, "name": "Alice", "email": "alice@acme.com" },\n  { "id": 2, "name": "Bob", "email": "bob@acme.com" }\n]',
  },
  {
    label: 'Delete a user',
    sql: 'DELETE FROM users WHERE id = 42',
    expected: 'approve',
    mockResult: '1 row affected',
  },
  {
    label: 'Drop the users table',
    sql: 'DROP TABLE users',
    expected: 'deny',
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runDemo(interactive: boolean = false): Promise<void> {
  const w = process.stderr.write.bind(process.stderr);

  w('\n');
  w('\x1b[1m🛡️  SidClaw Guard — SQL Demo\x1b[0m\n');
  w('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  w('\n');
  w('  Scenario: An AI agent has MCP access to a PostgreSQL database.\n');
  w('  SidClaw Guard sits in front and enforces these rules:\n');
  w('\n');
  w('  \x1b[2m1.\x1b[0m allow-reads       → SELECT queries \x1b[32mpass through\x1b[0m\n');
  w('  \x1b[2m2.\x1b[0m approve-mutations → DELETE/UPDATE  \x1b[33mheld for approval\x1b[0m\n');
  w('  \x1b[2m3.\x1b[0m deny-destructive  → DROP/TRUNCATE  \x1b[31mblocked\x1b[0m\n');
  w('  \x1b[2m   default: deny\x1b[0m\n');
  w('\n');

  // Clean audit log for a fresh demo run
  try { writeFileSync('.sidclaw/audit.jsonl', ''); } catch { /* ignore */ }
  const audit = new AuditLog('.sidclaw/audit.jsonl');

  for (let i = 0; i < TEST_CASES.length; i++) {
    const test = TEST_CASES[i]!;
    const num = i + 1;

    w(`━━━ Test ${num}/${TEST_CASES.length}: ${test.label} ${'━'.repeat(Math.max(0, 40 - test.label.length))}\n`);
    w('\n');
    w(`  \x1b[2mAgent calls:\x1b[0m  query("${test.sql}")\n`);
    w('\n');

    await sleep(500); // Dramatic pause for demo

    const result = evaluate('query', { sql: test.sql }, DEMO_RULES, 'deny');

    const startTime = Date.now();

    if (result.action === 'allow') {
      w(`  \x1b[32m✔ ALLOWED\x1b[0m  Rule: ${result.rule?.name}\n`);
      w(`  → Forwarded to upstream PostgreSQL\n`);
      if (test.mockResult) {
        w(`  → Result: ${test.mockResult}\n`);
      }
      audit.write({
        timestamp: new Date().toISOString(),
        tool: 'query',
        args: { sql: test.sql },
        decision: 'allow',
        rule: result.rule?.name,
        duration_ms: Date.now() - startTime,
      });
    } else if (result.action === 'approve') {
      w(`  \x1b[33m⏳ APPROVAL REQUIRED\x1b[0m  Rule: ${result.rule?.name}\n`);
      w('\n');

      if (interactive) {
        w('  The agent is paused. In a real setup, you would run:\n');
        w('  \x1b[1m  npx sidclaw-mcp-guard approve <id>\x1b[0m\n');
        w('\n');

        const approved = await askApproval();
        if (approved) {
          w(`\n  \x1b[32m✔ APPROVED\x1b[0m → Forwarded to upstream\n`);
          if (test.mockResult) {
            w(`  → Result: ${test.mockResult}\n`);
          }
          audit.write({
            timestamp: new Date().toISOString(),
            tool: 'query',
            args: { sql: test.sql },
            decision: 'approve',
            rule: result.rule?.name,
            approval_id: 'demo',
            status: 'approved',
            duration_ms: Date.now() - startTime,
          });
        } else {
          w(`\n  \x1b[31m✘ DENIED BY REVIEWER\x1b[0m\n`);
          audit.write({
            timestamp: new Date().toISOString(),
            tool: 'query',
            args: { sql: test.sql },
            decision: 'approve',
            rule: result.rule?.name,
            approval_id: 'demo',
            status: 'denied',
            duration_ms: Date.now() - startTime,
          });
        }
      } else {
        w('  The agent is paused, waiting for a human decision.\n');
        w('  \x1b[2m[Auto-approving in 3s for demo...]\x1b[0m\n');

        await sleep(3000);

        w(`  \x1b[32m✔ APPROVED\x1b[0m → Forwarded to upstream\n`);
        if (test.mockResult) {
          w(`  → Result: ${test.mockResult}\n`);
        }
        audit.write({
          timestamp: new Date().toISOString(),
          tool: 'query',
          args: { sql: test.sql },
          decision: 'approve',
          rule: result.rule?.name,
          approval_id: 'demo',
          status: 'approved',
          duration_ms: Date.now() - startTime,
        });
      }
    } else {
      w(`  \x1b[31m✘ DENIED\x1b[0m  Rule: ${result.rule?.name}\n`);
      w(`  Reason: ${result.reason}\n`);
      w(`  → The agent receives an error. The query never reaches the database.\n`);
      audit.write({
        timestamp: new Date().toISOString(),
        tool: 'query',
        args: { sql: test.sql },
        decision: 'deny',
        rule: result.rule?.name,
        reason: result.reason,
        duration_ms: Date.now() - startTime,
      });
    }

    w('\n');
  }

  // Show audit log
  w('━━━ Audit Trail ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  w('\n');
  w(`  \x1b[2mFile: ${audit.getPath()}\x1b[0m\n\n`);

  const entries = audit.read();
  for (const entry of entries) {
    const icon =
      entry.decision === 'allow'
        ? '\x1b[32m✔\x1b[0m'
        : entry.decision === 'deny'
          ? '\x1b[31m✘\x1b[0m'
          : '\x1b[33m⏳\x1b[0m';
    const sql = (entry.args['sql'] as string) ?? '';
    const short = sql.length > 40 ? sql.substring(0, 37) + '...' : sql;
    w(`  ${icon} ${entry.decision.padEnd(7)} ${short}\n`);
  }

  w('\n');
  w('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  w('\n');
  w('  \x1b[1mNext steps:\x1b[0m\n');
  w('  1. Guard your own MCP server → docs/quickstart.md\n');
  w('  2. Customize policies        → docs/config.md\n');
  w('  3. Full platform features    → https://sidclaw.com\n');
  w('\n');
}

async function askApproval(): Promise<boolean> {
  const readline = await import('node:readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  return new Promise((resolve) => {
    rl.question('  Approve this action? [Y/n] ', (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === '' || a === 'y' || a === 'yes');
    });
  });
}
