/**
 * Local policy engine — evaluates tool calls against rules.
 *
 * Rules are evaluated top-to-bottom. First match wins.
 * If no rule matches, the default action applies.
 */

import type { PolicyRule, Action, PolicyResult } from './types.js';

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
      };
    }
  }

  return {
    action: defaultAction,
    reason: `No rule matched — default action: ${defaultAction}`,
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
  // Match tool name (exact or glob)
  if (!matchGlob(rule.match.tool, toolName)) {
    return false;
  }

  // Match args (regex patterns)
  if (rule.match.args) {
    if (!matchArgs(rule.match.args, args)) {
      return false;
    }
  }

  return true;
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
