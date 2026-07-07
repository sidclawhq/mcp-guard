/**
 * Local policy engine — evaluates tool calls against rules.
 *
 * Rules are evaluated top-to-bottom. First match wins.
 * If no rule matches, the default action applies.
 *
 * Supports both:
 *   - Semantic patterns: `pattern: sql-read` (human-friendly)
 *   - Regex matching: `args: { sql: "^SELECT" }` (power users)
 */

import type { PolicyRule, Action, PolicyResult, SemanticPattern } from './types.js';

/**
 * Action severity ranking — higher number is more restrictive.
 * Used to pick the most restrictive action across compound statements.
 */
const ACTION_SEVERITY: Record<Action, number> = {
  allow: 0,
  approve: 1,
  deny: 2,
};

/**
 * Any of these characters means a command is more than a bare "verb args …" and
 * must be decomposed before it can be trusted: control operators, command and
 * process substitution, grouping, redirections, expansions, and newlines.
 * Deliberately broad — a fully-safe command still resolves to allow after
 * decomposition, so over-triggering only costs a linear scan.
 */
const SHELL_METACHAR = /[\n;&|<>`(){}$]/;

/** Upper bounds so a hostile command can't turn the inline guard into a CPU sink. */
const MAX_SHELL_LENGTH = 100_000;
const MAX_SHELL_DEPTH = 50;

/**
 * Built-in semantic patterns.
 * Each maps to a tool name pattern and argument matchers.
 */
const SEMANTIC_PATTERNS: Record<SemanticPattern, { tool: string; args: Record<string, string> }> = {
  'sql-read': {
    tool: 'query',
    args: { sql: '^\\s*(SELECT|EXPLAIN|SHOW|DESCRIBE|WITH)\\b' },
  },
  'sql-write': {
    tool: 'query',
    args: { sql: '^\\s*(INSERT|UPDATE|DELETE|MERGE|UPSERT)\\b' },
  },
  'sql-destructive': {
    tool: 'query',
    args: { sql: '^\\s*(DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\\b' },
  },
  'file-read': {
    tool: '{read_file,list_directory,search_files,get_file_info,list_allowed_directories}',
    args: {},
  },
  'file-write': {
    tool: '{write_file,edit_file,move_file,create_directory}',
    args: {},
  },
  'file-delete': {
    tool: '{delete_file,remove_directory}',
    args: {},
  },
  'shell-safe': {
    tool: '{execute,run_command,shell,exec,run}',
    args: { command: '^\\s*(ls|pwd|whoami|echo|cat|head|tail|wc|date|uname)\\b' },
  },
  'shell-risky': {
    tool: '{execute,run_command,shell,exec,run}',
    args: { command: '^\\s*(mv|cp|mkdir|chmod|chown|curl|wget|npm|pip)\\b' },
  },
  'shell-destructive': {
    tool: '{execute,run_command,shell,exec,run}',
    args: { command: '^\\s*(rm|rmdir|kill|killall|shutdown|reboot|mkfs|dd|sudo)\\b' },
  },
};

/**
 * Evaluate a tool call against a list of rules.
 *
 * For SQL args containing semicolons (compound statements like "SELECT 1; DROP TABLE x"),
 * each sub-statement is evaluated independently and the most restrictive action wins.
 *
 * For shell commands containing compound operators (;, &&, ||, |),
 * each sub-command is evaluated independently and the most restrictive action wins.
 */
export function evaluate(
  toolName: string,
  args: Record<string, unknown>,
  rules: PolicyRule[],
  defaultAction: Action,
): PolicyResult {
  // Check for compound SQL statements (semicolon-separated)
  const sqlValue = args?.['sql'] ?? args?.['query'];
  if (typeof sqlValue === 'string' && sqlValue.includes(';')) {
    const statements = sqlValue.split(';').map(s => s.trim()).filter(s => s.length > 0);
    if (statements.length > 1) {
      return evaluateCompound(toolName, args, 'sql', statements, rules, defaultAction);
    }
  }

  // Check for compound / obfuscated shell commands.
  // A blocked command can be hidden behind a control operator (; && || | &), a
  // newline, a command substitution ($(...) or backticks), a process substitution
  // (<(...) / >(...)), or a subshell group — none of which the safe-verb prefix
  // match catches on its own. Decompose the string (quote-aware) into the simple
  // commands it would actually run and evaluate each; most-restrictive wins.
  const cmdValue = args?.['command'] ?? args?.['cmd'];
  if (typeof cmdValue === 'string' && SHELL_METACHAR.test(cmdValue)) {
    const scan = decomposeShell(cmdValue);

    // Fail closed HARD: an execution construct we could not fully break down
    // (unbalanced substitution, here-doc, oversized/over-nested input) means a
    // command may run that we never got to classify — deny rather than guess.
    if (scan.unparseable) {
      return {
        action: 'deny',
        reason: 'Command contains a shell construct that could not be safely parsed',
        explanation: `Blocked: ${describeToolCall(toolName, args)}. The command contains a shell ` +
          `construct that could not be verified as safe (unbalanced or unsupported), so it is denied.`,
      };
    }

    const parts = scan.parts.length > 0 ? scan.parts : [cmdValue];
    const result = evaluateCompound(toolName, args, 'command', parts, rules, defaultAction);

    // A redirection (> >> <) is file I/O whose target we don't model. When every
    // command part is otherwise safe, never leave it at allow — surface it for a
    // human so an overwrite of a sensitive file isn't waved through silently.
    if (scan.sawRedirection && result.action === 'allow') {
      return {
        ...result,
        action: 'approve',
        explanation: result.explanation +
          ' (contains a shell redirection — downgraded to approval; output target not verified)',
      };
    }
    return result;
  }

  return evaluateSingle(toolName, args, rules, defaultAction);
}

/**
 * Evaluate a single (non-compound) tool call against rules.
 */
function evaluateSingle(
  toolName: string,
  args: Record<string, unknown>,
  rules: PolicyRule[],
  defaultAction: Action,
): PolicyResult {
  for (const rule of rules) {
    if (matchesRule(rule, toolName, args)) {
      return {
        action: rule.action,
        rule,
        reason: rule.reason,
        explanation: explainMatch(rule, toolName, args),
      };
    }
  }

  return {
    action: defaultAction,
    reason: `No rule matched — default action: ${defaultAction}`,
    explanation: explainDefault(toolName, args, defaultAction),
  };
}

/**
 * Evaluate compound statements by splitting on separator, evaluating each
 * sub-statement independently, and returning the most restrictive result.
 */
function evaluateCompound(
  toolName: string,
  args: Record<string, unknown>,
  argKey: string,
  statements: string[],
  rules: PolicyRule[],
  defaultAction: Action,
): PolicyResult {
  let worstResult: PolicyResult | null = null;
  let worstSeverity = -1;

  for (const stmt of statements) {
    const subArgs = { ...args, [argKey]: stmt };
    const result = evaluateSingle(toolName, subArgs, rules, defaultAction);
    const severity = ACTION_SEVERITY[result.action];
    if (severity > worstSeverity) {
      worstSeverity = severity;
      worstResult = result;
    }
  }

  // Annotate explanation to mention compound evaluation
  if (worstResult && statements.length > 1) {
    const original = args[argKey] as string;
    worstResult.explanation = worstResult.explanation +
      ` (compound statement: ${statements.length} sub-statements evaluated, most restrictive applied)`;
    // Override the explanation's tool call description to show the full original
    worstResult.reason = worstResult.reason;
  }

  return worstResult!;
}

/**
 * Result of decomposing a shell command string.
 *   parts          — the simple commands (verb + args) it would run, each of
 *                    which is classified independently by the caller.
 *   sawRedirection — an unquoted redirection (> >> <) was present; file I/O whose
 *                    target the policy does not model.
 *   unparseable    — an execution construct could not be fully extracted
 *                    (unbalanced substitution, here-doc, unterminated quote, or
 *                    input past the size/depth caps); the caller fails closed.
 */
interface ShellScan {
  parts: string[];
  sawRedirection: boolean;
  unparseable: boolean;
}

/**
 * Decompose a shell command into the simple commands it would actually run.
 *
 * Single-pass and quote-aware: operators inside quotes are literal, but command
 * substitution still fires inside double quotes (as the shell does). Command and
 * process substitutions ($(...), `...`, <(...), >(...)) are extracted and
 * recursively decomposed so a destructive command hidden inside one is surfaced
 * as its own part. Control operators (; && || | &) and newlines split the stream;
 * subshell parens are split points too. Anything that can't be fully reduced sets
 * `unparseable` so the caller can deny rather than trust a partial parse.
 */
function decomposeShell(cmd: string, depth = 0): ShellScan {
  const scan: ShellScan = { parts: [], sawRedirection: false, unparseable: false };
  if (depth > MAX_SHELL_DEPTH || cmd.length > MAX_SHELL_LENGTH) {
    scan.unparseable = true;
    return scan;
  }

  let segment = '';
  const flush = () => {
    const s = segment.trim();
    if (s) scan.parts.push(s);
    segment = '';
  };
  const absorb = (inner: string) => {
    const sub = decomposeShell(inner, depth + 1);
    scan.parts.push(...sub.parts);
    if (sub.sawRedirection) scan.sawRedirection = true;
    if (sub.unparseable) scan.unparseable = true;
  };
  // Extract a substitution body opened by '(' at `open`; recurse into it. Returns
  // the index just past the matching ')', or the string end (marking unparseable).
  const peelParen = (open: number): number => {
    const close = findMatchingParen(cmd, open);
    if (close === -1) { scan.unparseable = true; return cmd.length; }
    absorb(cmd.slice(open + 1, close));
    return close + 1;
  };

  let i = 0;
  const n = cmd.length;
  while (i < n) {
    const c = cmd[i]!;
    const c2 = cmd[i + 1];

    // Single-quoted span: fully literal.
    if (c === "'") {
      const end = cmd.indexOf("'", i + 1);
      if (end === -1) { scan.unparseable = true; break; }
      segment += cmd.slice(i, end + 1);
      i = end + 1;
      continue;
    }

    // Double-quoted span: literal except $(...) and `...`, which still execute.
    if (c === '"') {
      segment += '"';
      i++;
      let closed = false;
      while (i < n) {
        if (cmd[i] === '"') { closed = true; break; }
        if (cmd[i] === '$' && cmd[i + 1] === '(') {
          i = peelParen(i + 1);
          segment += ' ';
        } else if (cmd[i] === '`') {
          const close = cmd.indexOf('`', i + 1);
          if (close === -1) { scan.unparseable = true; i = n; break; }
          absorb(cmd.slice(i + 1, close));
          segment += ' ';
          i = close + 1;
        } else {
          segment += cmd[i];
          i++;
        }
      }
      if (!closed) { scan.unparseable = true; break; }
      segment += '"';
      i++;
      continue;
    }

    // Command substitution $(...)
    if (c === '$' && c2 === '(') { i = peelParen(i + 1); segment += ' '; continue; }
    // Backtick substitution `...`
    if (c === '`') {
      const close = cmd.indexOf('`', i + 1);
      if (close === -1) { scan.unparseable = true; break; }
      absorb(cmd.slice(i + 1, close));
      segment += ' ';
      i = close + 1;
      continue;
    }
    // Process substitution <(...) / >(...)
    if ((c === '<' || c === '>') && c2 === '(') { i = peelParen(i + 1); segment += ' '; continue; }
    // Here-doc / here-string: body is opaque and may run commands — fail closed.
    if (c === '<' && c2 === '<') { scan.unparseable = true; break; }
    // Redirections: >, >>, <, >&, <&, &>, &>>. File I/O — keep the verb, flag it.
    if (c === '&' && c2 === '>') {
      scan.sawRedirection = true;
      segment += ' ';
      i += cmd[i + 2] === '>' ? 3 : 2;
      continue;
    }
    if (c === '>' || c === '<') {
      scan.sawRedirection = true;
      segment += ' ';
      i += (c2 === '>' || c2 === '&') ? 2 : 1;
      continue;
    }
    // Control operators split the command stream.
    if (c === '\n' || c === ';') { flush(); i++; continue; }
    if (c === '&' && c2 === '&') { flush(); i += 2; continue; }
    if (c === '|' && c2 === '|') { flush(); i += 2; continue; }
    if (c === '&' || c === '|') { flush(); i++; continue; }
    // Subshell grouping: a group boundary starts a new simple command.
    if (c === '(' || c === ')') { flush(); i++; continue; }

    segment += c;
    i++;
  }
  flush();
  return scan;
}

/**
 * Given the index of an opening '(', return the index of its matching ')',
 * accounting for nesting and skipping quoted spans (where a paren is literal).
 * Returns -1 if no match is found.
 */
function findMatchingParen(cmd: string, openIdx: number): number {
  let depth = 1;
  let i = openIdx + 1;
  const n = cmd.length;
  while (i < n) {
    const c = cmd[i];
    if (c === "'") { const e = cmd.indexOf("'", i + 1); if (e === -1) return -1; i = e + 1; continue; }
    if (c === '"') { const e = cmd.indexOf('"', i + 1); if (e === -1) return -1; i = e + 1; continue; }
    if (c === '`') { const e = cmd.indexOf('`', i + 1); if (e === -1) return -1; i = e + 1; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

/**
 * Check if a tool call matches a single rule.
 */
function matchesRule(
  rule: PolicyRule,
  toolName: string,
  args: Record<string, unknown>,
): boolean {
  // If rule uses a semantic pattern, expand it
  const pattern = rule.match.pattern ? SEMANTIC_PATTERNS[rule.match.pattern] : null;

  // Tool name matching: use expanded pattern tool if no explicit tool, or the rule's tool
  const toolPattern = pattern && rule.match.tool === '*' ? pattern.tool : rule.match.tool;
  if (!matchToolName(toolPattern, toolName)) {
    return false;
  }

  // Args matching: explicit args override pattern args
  const argPatterns = rule.match.args ?? (pattern?.args && Object.keys(pattern.args).length > 0 ? pattern.args : undefined);
  if (argPatterns) {
    if (!matchArgs(argPatterns, args)) {
      return false;
    }
  }

  return true;
}

/**
 * Match a tool name against a pattern.
 * Supports: exact, glob ("db_*"), multi ("{read_file,write_file}").
 */
function matchToolName(pattern: string, value: string): boolean {
  if (pattern === '*') return true;

  // Multi-match: {a,b,c}
  if (pattern.startsWith('{') && pattern.endsWith('}')) {
    const options = pattern.slice(1, -1).split(',').map(s => s.trim());
    return options.some(opt => matchGlob(opt, value));
  }

  return matchGlob(pattern, value);
}

/**
 * Match a string against a glob pattern.
 * Supports: exact match, "*" (match all), "db_*", "*_query".
 */
function matchGlob(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return pattern === value;

  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
  return regex.test(value);
}

/**
 * Match argument values against regex patterns.
 * All patterns must match for the rule to apply.
 */
function matchArgs(
  patterns: Record<string, string>,
  args: Record<string, unknown>,
): boolean {
  if (!args || typeof args !== 'object') return false;
  for (const [key, pattern] of Object.entries(patterns)) {
    const value = args[key];
    if (value === undefined || value === null) return false;

    try {
      const regex = new RegExp(pattern, 'i');
      if (!regex.test(String(value))) return false;
    } catch {
      // Invalid regex — treat as literal match
      if (String(value) !== pattern) return false;
    }
  }

  return true;
}

/**
 * Generate a plain-English explanation for a matched rule.
 */
function explainMatch(rule: PolicyRule, toolName: string, args: Record<string, unknown>): string {
  const actionVerb = rule.action === 'allow'
    ? 'Allowed'
    : rule.action === 'deny'
      ? 'Blocked'
      : 'Held for approval';

  const what = describeToolCall(toolName, args);
  const why = rule.description ?? rule.reason ?? `matched rule "${rule.name}"`;

  return `${actionVerb}: ${what}. ${why}.`;
}

/**
 * Generate a plain-English explanation for a default action.
 */
function explainDefault(toolName: string, args: Record<string, unknown>, action: Action): string {
  const actionVerb = action === 'allow'
    ? 'Allowed'
    : action === 'deny'
      ? 'Blocked'
      : 'Held for approval';
  const what = describeToolCall(toolName, args);
  return `${actionVerb}: ${what}. No matching rule — default policy applied.`;
}

/**
 * Describe a tool call in plain language.
 */
function describeToolCall(toolName: string, args: Record<string, unknown>): string {
  if (!args || typeof args !== 'object') return `tool call: ${toolName}`;

  const sql = args['sql'] ?? args['query'];
  if (sql) {
    const s = String(sql).trim();
    const verb = s.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (verb === 'SELECT') return `read query on ${extractTarget(s)}`;
    if (verb === 'INSERT') return `insert into ${extractTarget(s)}`;
    if (verb === 'UPDATE') return `update on ${extractTarget(s)}`;
    if (verb === 'DELETE') return `delete from ${extractTarget(s)}`;
    if (verb === 'DROP') return `drop ${extractTarget(s)}`;
    if (verb === 'TRUNCATE') return `truncate ${extractTarget(s)}`;
    if (verb === 'ALTER') return `alter ${extractTarget(s)}`;
    if (verb === 'CREATE') return `create ${extractTarget(s)}`;
    return `SQL: ${s.length > 50 ? s.substring(0, 47) + '...' : s}`;
  }

  const cmd = args['command'] ?? args['cmd'];
  if (cmd) {
    const s = String(cmd).trim();
    const firstToken = s.split(/\s+/)[0] ?? '';
    return `${firstToken} command: ${s.length > 50 ? s.substring(0, 47) + '...' : s}`;
  }

  const path = args['path'] ?? args['file'] ?? args['uri'];
  if (path) return `${toolName} on ${String(path)}`;

  return `tool call: ${toolName}`;
}

/**
 * Extract target table/object from SQL.
 */
function extractTarget(sql: string): string {
  // Try to find FROM/INTO/TABLE/ON target
  const m = sql.match(/(?:FROM|INTO|TABLE|ON|UPDATE)\s+([^\s(,;]+)/i);
  if (m) return m[1]!;
  // Fallback: just take first few words
  const words = sql.split(/\s+/).slice(0, 4).join(' ');
  return words.length > 40 ? words.substring(0, 37) + '...' : words;
}

/**
 * Export semantic patterns for external use (e.g., config validation).
 */
export const semanticPatterns = SEMANTIC_PATTERNS;
