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
};

/**
 * Evaluate a tool call against a list of rules.
 */
export function evaluate(
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
