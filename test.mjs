/**
 * Comprehensive stress tests for sidclaw-mcp-guard.
 */

import { evaluate, AuditLog, ApprovalQueue, loadConfig, defaultConfig } from './dist/index.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => {
        passed++;
        results.push(`  \x1b[32m✓\x1b[0m ${name}`);
      }).catch((e) => {
        failed++;
        results.push(`  \x1b[31m✗\x1b[0m ${name}: ${e.message}`);
      });
    }
    passed++;
    results.push(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failed++;
    results.push(`  \x1b[31m✗\x1b[0m ${name}: ${e.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// Clean up
if (existsSync('.sidclaw')) rmSync('.sidclaw', { recursive: true });

const rules = [
  { name: 'allow-reads', match: { tool: 'query', args: { sql: '^\\s*SELECT' } }, action: 'allow' },
  { name: 'approve-muts', match: { tool: 'query', args: { sql: '^\\s*(DELETE|UPDATE|INSERT)' } }, action: 'approve' },
  { name: 'deny-ddl', match: { tool: 'query', args: { sql: '^\\s*(DROP|TRUNCATE)' } }, action: 'deny', reason: 'DDL blocked' },
  { name: 'allow-all-reads', match: { tool: 'read_*' }, action: 'allow' },
  { name: 'deny-wildcard', match: { tool: '*_dangerous' }, action: 'deny', reason: 'dangerous tool' },
];

console.log('\n=== POLICY ENGINE STRESS TESTS ===\n');

test('SELECT → allow', () => {
  const r = evaluate('query', { sql: 'SELECT * FROM users' }, rules, 'deny');
  assert(r.action === 'allow', `got ${r.action}`);
});

test('DELETE → approve', () => {
  const r = evaluate('query', { sql: 'DELETE FROM users WHERE id=1' }, rules, 'deny');
  assert(r.action === 'approve', `got ${r.action}`);
});

test('DROP → deny', () => {
  const r = evaluate('query', { sql: 'DROP TABLE users' }, rules, 'deny');
  assert(r.action === 'deny', `got ${r.action}`);
});

test('INSERT → approve', () => {
  const r = evaluate('query', { sql: 'INSERT INTO users VALUES(1)' }, rules, 'deny');
  assert(r.action === 'approve');
});

test('UPDATE → approve', () => {
  const r = evaluate('query', { sql: 'UPDATE users SET name=x' }, rules, 'deny');
  assert(r.action === 'approve');
});

test('TRUNCATE → deny', () => {
  const r = evaluate('query', { sql: 'TRUNCATE users' }, rules, 'deny');
  assert(r.action === 'deny');
});

test('Unknown tool → default deny', () => {
  const r = evaluate('unknown_tool', {}, rules, 'deny');
  assert(r.action === 'deny');
});

test('Default allow works', () => {
  const r = evaluate('unknown_tool', {}, rules, 'allow');
  assert(r.action === 'allow');
});

test('Default approve works', () => {
  const r = evaluate('unknown_tool', {}, rules, 'approve');
  assert(r.action === 'approve');
});

// Glob matching
test('Glob: read_file matches read_*', () => {
  const r = evaluate('read_file', {}, rules, 'deny');
  assert(r.action === 'allow');
});

test('Glob: read_resource matches read_*', () => {
  const r = evaluate('read_resource', {}, rules, 'deny');
  assert(r.action === 'allow');
});

test('Glob: exec_dangerous matches *_dangerous', () => {
  const r = evaluate('exec_dangerous', {}, rules, 'deny');
  assert(r.action === 'deny');
});

test('Glob: read_dangerous → read_* wins (first match)', () => {
  const r = evaluate('read_dangerous', {}, rules, 'deny');
  assert(r.action === 'allow', 'first match wins');
});

test('Glob: exact match over glob', () => {
  const r = evaluate('query', { sql: 'SELECT 1' }, rules, 'deny');
  assert(r.action === 'allow');
  assert(r.rule.name === 'allow-reads');
});

// Edge cases
test('Empty rules → default', () => {
  const r = evaluate('anything', {}, [], 'deny');
  assert(r.action === 'deny');
});

test('Empty args → no match on arg-based rule', () => {
  const r = evaluate('query', {}, rules, 'deny');
  assert(r.action === 'deny');
});

test('Null arg value → no match', () => {
  const r = evaluate('query', { sql: null }, rules, 'deny');
  assert(r.action === 'deny');
});

test('Undefined arg value → no match', () => {
  const r = evaluate('query', { sql: undefined }, rules, 'deny');
  assert(r.action === 'deny');
});

test('Leading whitespace in SQL', () => {
  const r = evaluate('query', { sql: '   SELECT 1' }, rules, 'deny');
  assert(r.action === 'allow');
});

test('Case insensitive: select', () => {
  const r = evaluate('query', { sql: 'select * from users' }, rules, 'deny');
  assert(r.action === 'allow');
});

test('Case insensitive: DeLeTe', () => {
  const r = evaluate('query', { sql: 'DeLeTe FROM users' }, rules, 'deny');
  assert(r.action === 'approve');
});

test('Very long SQL string', () => {
  const r = evaluate('query', { sql: 'SELECT ' + 'x'.repeat(100000) }, rules, 'deny');
  assert(r.action === 'allow');
});

test('Empty tool name → default', () => {
  const r = evaluate('', {}, rules, 'deny');
  assert(r.action === 'deny');
});

test('Numeric arg value', () => {
  const r = evaluate('query', { sql: 42 }, rules, 'deny');
  assert(r.action === 'deny');
});

test('Boolean arg value', () => {
  const r = evaluate('query', { sql: true }, rules, 'deny');
  assert(r.action === 'deny');
});

test('Array arg value (stringified: "SELECT,1" matches SELECT)', () => {
  const r = evaluate('query', { sql: ['SELECT', '1'] }, rules, 'deny');
  assert(r.action === 'allow', 'String(["SELECT","1"]) = "SELECT,1" matches ^SELECT');
});

test('Object arg value', () => {
  const r = evaluate('query', { sql: { text: 'SELECT 1' } }, rules, 'deny');
  assert(r.action === 'deny');
});

test('Rule with no args matcher (matches tool name only)', () => {
  const simpleRules = [{ name: 'r1', match: { tool: 'query' }, action: 'allow' }];
  const r = evaluate('query', { anything: 'goes' }, simpleRules, 'deny');
  assert(r.action === 'allow');
});

test('Multiple arg matchers (AND logic)', () => {
  const multiRules = [{
    name: 'r1',
    match: { tool: 'query', args: { sql: '^SELECT', database: 'production' } },
    action: 'deny'
  }];
  // Both match
  const r1 = evaluate('query', { sql: 'SELECT 1', database: 'production' }, multiRules, 'allow');
  assert(r1.action === 'deny');
  // Only sql matches
  const r2 = evaluate('query', { sql: 'SELECT 1', database: 'staging' }, multiRules, 'allow');
  assert(r2.action === 'allow', 'should fall through to default');
});

test('Invalid regex in rule falls back to literal match', () => {
  const badRules = [{ name: 'bad', match: { tool: 'x', args: { sql: '[invalid' } }, action: 'allow' }];
  const r = evaluate('x', { sql: '[invalid' }, badRules, 'deny');
  assert(r.action === 'allow');
});

test('Wildcard glob * matches everything', () => {
  const catchAll = [{ name: 'all', match: { tool: '*' }, action: 'approve' }];
  const r = evaluate('anything_at_all', {}, catchAll, 'deny');
  assert(r.action === 'approve');
});

test('Reason is returned on deny', () => {
  const r = evaluate('query', { sql: 'DROP TABLE' }, rules, 'deny');
  assert(r.reason === 'DDL blocked');
});

test('Rule reference is returned on match', () => {
  const r = evaluate('query', { sql: 'SELECT 1' }, rules, 'deny');
  assert(r.rule?.name === 'allow-reads');
});

test('No rule reference on default', () => {
  const r = evaluate('nomatch', {}, rules, 'deny');
  assert(r.rule === undefined);
});

console.log('\n=== AUDIT LOG STRESS TESTS ===\n');

test('Write and read entries', () => {
  const audit = new AuditLog('.sidclaw/test-audit.jsonl');
  audit.write({ timestamp: 'T1', tool: 'a', args: {}, decision: 'allow' });
  audit.write({ timestamp: 'T2', tool: 'b', args: { x: 1 }, decision: 'deny' });
  const entries = audit.read();
  assert(entries.length === 2, `got ${entries.length}`);
  assert(entries[0].tool === 'a');
  assert(entries[1].decision === 'deny');
});

test('Read empty file', () => {
  writeFileSync('.sidclaw/empty.jsonl', '');
  const audit = new AuditLog('.sidclaw/empty.jsonl');
  assert(audit.read().length === 0);
});

test('Read nonexistent file', () => {
  const audit = new AuditLog('.sidclaw/nope.jsonl');
  assert(audit.read().length === 0);
});

test('Disabled audit', () => {
  const audit = new AuditLog('.sidclaw/disabled.jsonl', true);
  audit.write({ timestamp: 'T', tool: 'x', args: {}, decision: 'allow' });
  assert(!existsSync('.sidclaw/disabled.jsonl'));
});

test('Large entry', () => {
  const audit = new AuditLog('.sidclaw/large.jsonl');
  audit.write({ timestamp: 'T', tool: 'x', args: { data: 'x'.repeat(10000) }, decision: 'allow' });
  assert(audit.read()[0].args.data.length === 10000);
});

test('Special characters preserved', () => {
  const audit = new AuditLog('.sidclaw/special.jsonl');
  const sql = "it's a \"test\" with \\n newlines\ttabs";
  audit.write({ timestamp: 'T', tool: 'x', args: { sql }, decision: 'allow' });
  assert(audit.read()[0].args.sql === sql);
});

test('Multiple newlines in file (resilience)', () => {
  writeFileSync('.sidclaw/messy.jsonl', '{"tool":"a","decision":"allow"}\n\n\n{"tool":"b","decision":"deny"}\n\n');
  const audit = new AuditLog('.sidclaw/messy.jsonl');
  const entries = audit.read();
  assert(entries.length === 2, `got ${entries.length}`);
});

console.log('\n=== APPROVAL QUEUE STRESS TESTS ===\n');

test('Create and list pending', () => {
  const q = new ApprovalQueue('.sidclaw/q1', 5000);
  q.create('tool1', { a: 1 }, 'rule1');
  q.create('tool2', { b: 2 }, 'rule2');
  assert(q.list().length === 2);
});

test('Approve removes from pending', () => {
  const q = new ApprovalQueue('.sidclaw/q2', 5000);
  const p = q.create('tool', {}, 'rule');
  q.decide(p.id, 'approved');
  assert(q.list().length === 0);
});

test('Deny removes from pending', () => {
  const q = new ApprovalQueue('.sidclaw/q3', 5000);
  const p = q.create('tool', {}, 'rule');
  q.decide(p.id, 'denied');
  assert(q.list().length === 0);
});

test('Double decide throws', () => {
  const q = new ApprovalQueue('.sidclaw/q4', 5000);
  const p = q.create('tool', {}, 'rule');
  q.decide(p.id, 'approved');
  try { q.decide(p.id, 'denied'); assert(false); } catch (e) {
    assert(e.message.includes('already decided'));
  }
});

test('Unknown ID throws', () => {
  const q = new ApprovalQueue('.sidclaw/q5', 5000);
  try { q.decide('fake', 'approved'); assert(false); } catch (e) {
    assert(e.message.includes('No pending approval'));
  }
});

const asyncTests = [];

asyncTests.push(test('Timeout returns expired', async () => {
  const q = new ApprovalQueue('.sidclaw/q6', 1500);
  const p = q.create('tool', {}, 'rule');
  const result = await q.waitForDecision(p.id);
  assert(result === 'expired', `got ${result}`);
}));

asyncTests.push(test('Fast approve resolves', async () => {
  const q = new ApprovalQueue('.sidclaw/q7', 30000);
  const p = q.create('tool', {}, 'rule');
  setTimeout(() => q.decide(p.id, 'approved'), 600);
  const result = await q.waitForDecision(p.id);
  assert(result === 'approved', `got ${result}`);
}));

asyncTests.push(test('Fast deny resolves', async () => {
  const q = new ApprovalQueue('.sidclaw/q8', 30000);
  const p = q.create('tool', {}, 'rule');
  setTimeout(() => q.decide(p.id, 'denied'), 600);
  const result = await q.waitForDecision(p.id);
  assert(result === 'denied', `got ${result}`);
}));

test('Multiple concurrent pending', () => {
  const q = new ApprovalQueue('.sidclaw/q9', 5000);
  const p1 = q.create('tool1', {}, 'r1');
  const p2 = q.create('tool2', {}, 'r2');
  const p3 = q.create('tool3', {}, 'r3');
  assert(q.list().length === 3);
  q.decide(p2.id, 'approved');
  assert(q.list().length === 2);
  q.decide(p1.id, 'denied');
  assert(q.list().length === 1);
});

test('Sorted by timestamp', () => {
  const q = new ApprovalQueue('.sidclaw/q10', 5000);
  q.create('tool1', {}, 'r1');
  q.create('tool2', {}, 'r2');
  const list = q.list();
  assert(list[0].timestamp <= list[1].timestamp);
});

console.log('\n=== CONFIG LOADER STRESS TESTS ===\n');

test('Load valid config', () => {
  const c = loadConfig('sidclaw.config.yaml');
  assert(c.rules.length === 3);
  assert(c.default === 'deny');
});

test('Load demo config', () => {
  const c = loadConfig('examples/sql-demo/sidclaw.config.yaml');
  assert(c.rules.length === 5);
});

test('Missing file throws', () => {
  try { loadConfig('nope.yaml'); assert(false); } catch (e) {
    assert(e.message.includes('not found'));
  }
});

test('Default config', () => {
  const c = defaultConfig();
  assert(c.rules.length === 0);
  assert(c.default === 'deny');
});

test('Config with upstream', () => {
  mkdirSync('.sidclaw', { recursive: true });
  writeFileSync('.sidclaw/upstream.yaml', [
    'rules:',
    '  - name: r1',
    '    match:',
    '      tool: query',
    '    action: allow',
    'default: deny',
    'upstream:',
    '  command: npx',
    '  args:',
    '    - "-y"',
    '    - "some-server"',
  ].join('\n'));
  const c = loadConfig('.sidclaw/upstream.yaml');
  assert(c.upstream?.command === 'npx');
  assert(c.upstream?.args?.length === 2);
});

test('Config with no rules key', () => {
  writeFileSync('.sidclaw/norules.yaml', 'default: allow\n');
  const c = loadConfig('.sidclaw/norules.yaml');
  assert(c.rules.length === 0);
  assert(c.default === 'allow');
});

test('Invalid rule (missing name) throws', () => {
  writeFileSync('.sidclaw/badrule.yaml', [
    'rules:',
    '  - match:',
    '      tool: x',
    '    action: allow',
  ].join('\n'));
  try { loadConfig('.sidclaw/badrule.yaml'); assert(false); } catch (e) {
    assert(e.message.includes('name'));
  }
});

test('Invalid action throws', () => {
  writeFileSync('.sidclaw/badaction.yaml', [
    'rules:',
    '  - name: r1',
    '    match:',
    '      tool: x',
    '    action: yolo',
  ].join('\n'));
  try { loadConfig('.sidclaw/badaction.yaml'); assert(false); } catch (e) {
    assert(e.message.includes('action'));
  }
});

test('Config with comma-separated upstream args string', () => {
  writeFileSync('.sidclaw/commaargs.yaml', [
    'rules: []',
    'default: deny',
    'upstream:',
    '  command: npx',
    '  args: "-y,some-server,arg"',
  ].join('\n'));
  const c = loadConfig('.sidclaw/commaargs.yaml');
  assert(c.upstream?.args?.length === 3);
  assert(c.upstream?.args?.[1] === 'some-server');
});

console.log('\n=== OBSERVE MODE TESTS ===\n');

test('Config with mode: observe', () => {
  writeFileSync('.sidclaw/observe.yaml', [
    'rules:',
    '  - name: r1',
    '    match:',
    '      tool: query',
    '    action: allow',
    'default: deny',
    'mode: observe',
  ].join('\n'));
  const c = loadConfig('.sidclaw/observe.yaml');
  assert(c.mode === 'observe', `got ${c.mode}`);
});

test('Config with mode: enforce', () => {
  writeFileSync('.sidclaw/enforce.yaml', [
    'rules: []',
    'default: deny',
    'mode: enforce',
  ].join('\n'));
  const c = loadConfig('.sidclaw/enforce.yaml');
  assert(c.mode === 'enforce');
});

test('Config with no mode defaults to undefined', () => {
  const c = loadConfig('sidclaw.config.yaml');
  assert(c.mode === undefined, `got ${c.mode}`);
});

test('Config with invalid mode defaults to undefined', () => {
  writeFileSync('.sidclaw/badmode.yaml', [
    'rules: []',
    'default: deny',
    'mode: banana',
  ].join('\n'));
  const c = loadConfig('.sidclaw/badmode.yaml');
  assert(c.mode === undefined);
});

console.log('\n=== UI SERVER TESTS ===\n');

import { startUIServer } from './dist/index.js';

asyncTests.push(test('UI serves HTML page', async () => {
  const { port, close } = await startUIServer({ port: 19091 });
  try {
    const res = await fetch(`http://localhost:${port}/`);
    assert(res.status === 200);
    const html = await res.text();
    assert(html.includes('SidClaw Guard'));
    assert(html.includes('Pending Approvals'));
    assert(html.includes('Audit Trail'));
  } finally { close(); }
}));

asyncTests.push(test('UI returns pending list', async () => {
  const q = new ApprovalQueue('.sidclaw/ui-test', 5000);
  q.create('test_tool', { sql: 'DELETE' }, 'test-rule');
  const { port, close } = await startUIServer({ port: 19092, approvalDir: '.sidclaw/ui-test' });
  try {
    const res = await fetch(`http://localhost:${port}/api/pending`);
    const data = await res.json();
    assert(data.length === 1, `got ${data.length}`);
    assert(data[0].tool === 'test_tool');
  } finally { close(); }
}));

asyncTests.push(test('UI approve endpoint works', async () => {
  const q = new ApprovalQueue('.sidclaw/ui-test2', 5000);
  const p = q.create('tool', {}, 'rule');
  const { port, close } = await startUIServer({ port: 19093, approvalDir: '.sidclaw/ui-test2' });
  try {
    const res = await fetch(`http://localhost:${port}/api/approve/${p.id}`, { method: 'POST' });
    const data = await res.json();
    assert(data.ok === true);
    assert(data.decision === 'approved');
    // Verify removed from pending
    const listRes = await fetch(`http://localhost:${port}/api/pending`);
    const list = await listRes.json();
    assert(list.length === 0);
  } finally { close(); }
}));

asyncTests.push(test('UI deny endpoint works', async () => {
  const q = new ApprovalQueue('.sidclaw/ui-test3', 5000);
  const p = q.create('tool', {}, 'rule');
  const { port, close } = await startUIServer({ port: 19094, approvalDir: '.sidclaw/ui-test3' });
  try {
    const res = await fetch(`http://localhost:${port}/api/deny/${p.id}`, { method: 'POST' });
    const data = await res.json();
    assert(data.ok === true);
    assert(data.decision === 'denied');
  } finally { close(); }
}));

asyncTests.push(test('UI 404 for unknown routes', async () => {
  const { port, close } = await startUIServer({ port: 19095 });
  try {
    const res = await fetch(`http://localhost:${port}/nope`);
    assert(res.status === 404);
  } finally { close(); }
}));

asyncTests.push(test('UI returns audit entries', async () => {
  const { port, close } = await startUIServer({ port: 19096, auditPath: '.sidclaw/audit.jsonl' });
  try {
    const res = await fetch(`http://localhost:${port}/api/audit`);
    const data = await res.json();
    assert(Array.isArray(data));
  } finally { close(); }
}));

// Wait for async tests
await Promise.all(asyncTests.filter(Boolean));

// Print results
console.log('\n=== RESULTS ===\n');
results.forEach((r) => console.log(r));
console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests\n`);

// Cleanup
rmSync('.sidclaw', { recursive: true, force: true });

if (failed > 0) process.exit(1);
