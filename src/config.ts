/**
 * Configuration loader — reads YAML config files.
 */

import { readFileSync, existsSync } from 'node:fs';
import { load } from 'js-yaml';
import type { GuardConfig, PolicyRule, Action, GuardMode, SemanticPattern } from './types.js';

const VALID_ACTIONS: Action[] = ['allow', 'deny', 'approve'];
const VALID_PATTERNS: SemanticPattern[] = [
  'sql-read', 'sql-write', 'sql-destructive',
  'file-read', 'file-write', 'file-delete',
];

/**
 * Load guard config from a YAML file.
 */
export function loadConfig(path: string): GuardConfig {
  if (!existsSync(path)) {
    throw new Error(`Config file not found: ${path}`);
  }

  const raw = readFileSync(path, 'utf-8');
  const parsed = load(raw) as Record<string, unknown>;

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid config file: ${path}`);
  }

  const rules = parseRules(parsed['rules']);
  const defaultAction = parseAction(parsed['default'], 'deny');
  const mode = parseMode(parsed['mode']);

  return {
    rules,
    default: defaultAction,
    mode,
    upstream: parseUpstream(parsed['upstream']),
    audit: parseAudit(parsed['audit']),
    approval: parseApproval(parsed['approval']),
  };
}

function parseRules(raw: unknown): PolicyRule[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((r: Record<string, unknown>, i: number) => {
    if (!r || typeof r !== 'object') {
      throw new Error(`Rule ${i} must be an object`);
    }
    if (!r['name'] || typeof r['name'] !== 'string') {
      throw new Error(`Rule ${i} must have a string 'name'`);
    }

    const match = r['match'] as Record<string, unknown> | undefined;
    if (!match || typeof match !== 'object') {
      throw new Error(`Rule '${r['name']}' must have a 'match' object`);
    }

    const action = parseAction(r['action'], undefined);
    if (!action) {
      throw new Error(`Rule '${r['name']}' must have a valid 'action' (allow, deny, approve)`);
    }

    // Parse semantic pattern
    const patternRaw = match['pattern'] as string | undefined;
    let pattern: SemanticPattern | undefined;
    if (patternRaw) {
      if (VALID_PATTERNS.includes(patternRaw as SemanticPattern)) {
        pattern = patternRaw as SemanticPattern;
      } else {
        throw new Error(
          `Rule '${r['name']}' has invalid pattern '${patternRaw}'. ` +
          `Valid patterns: ${VALID_PATTERNS.join(', ')}`,
        );
      }
    }

    return {
      name: r['name'] as string,
      description: r['description'] as string | undefined,
      match: {
        tool: (match['tool'] as string) || '*',
        pattern,
        args: match['args'] as Record<string, string> | undefined,
      },
      action,
      reason: r['reason'] as string | undefined,
    };
  });
}

function parseAction(raw: unknown, fallback: Action): Action;
function parseAction(raw: unknown, fallback: undefined): Action | undefined;
function parseAction(raw: unknown, fallback: Action | undefined): Action | undefined {
  if (typeof raw === 'string' && VALID_ACTIONS.includes(raw as Action)) {
    return raw as Action;
  }
  return fallback;
}

function parseUpstream(raw: unknown): GuardConfig['upstream'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  if (!obj['command'] || typeof obj['command'] !== 'string') return undefined;

  return {
    command: obj['command'] as string,
    args: Array.isArray(obj['args'])
      ? obj['args'].map(String)
      : typeof obj['args'] === 'string'
        ? obj['args'].split(',').map((a: string) => a.trim())
        : undefined,
    env: obj['env'] as Record<string, string> | undefined,
  };
}

function parseAudit(raw: unknown): GuardConfig['audit'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  return {
    path: obj['path'] as string | undefined,
    disabled: obj['disabled'] === true,
  };
}

function parseMode(raw: unknown): GuardMode | undefined {
  if (raw === 'observe') return 'observe';
  if (raw === 'enforce') return 'enforce';
  return undefined;
}

function parseApproval(raw: unknown): GuardConfig['approval'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  return {
    dir: obj['dir'] as string | undefined,
    timeout: typeof obj['timeout'] === 'number' ? obj['timeout'] : undefined,
  };
}

/**
 * Create a minimal default config (deny everything).
 */
export function defaultConfig(): GuardConfig {
  return {
    rules: [],
    default: 'deny',
  };
}
