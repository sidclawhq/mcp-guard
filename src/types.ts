/**
 * Core types for SidClaw MCP Guard.
 */

/** Policy decision for a tool call. */
export type Action = 'allow' | 'deny' | 'approve';

/** Guard operating mode. */
export type GuardMode = 'enforce' | 'observe';

/**
 * Built-in semantic patterns for common matching scenarios.
 * Users write `pattern: sql-read` instead of raw regex.
 */
export type SemanticPattern =
  | 'sql-read'
  | 'sql-write'
  | 'sql-destructive'
  | 'file-read'
  | 'file-write'
  | 'file-delete'
  | 'shell-safe'
  | 'shell-risky'
  | 'shell-destructive';

/** A single policy rule. */
export interface PolicyRule {
  /** Unique rule name. */
  name: string;
  /** Human-readable description. */
  description?: string;
  /** Matching criteria. */
  match: {
    /** Tool name — exact string or glob pattern (e.g. "query", "db_*"). */
    tool: string;
    /** Semantic pattern — high-level shorthand (e.g. "sql-read"). Expands to args internally. */
    pattern?: SemanticPattern;
    /** Argument matchers — key is arg name, value is a regex pattern. Overrides pattern if both set. */
    args?: Record<string, string>;
  };
  /** What to do when matched. */
  action: Action;
  /** Reason shown to the agent on deny. */
  reason?: string;
}

/** Guard configuration loaded from YAML. */
export interface GuardConfig {
  /** Ordered list of policy rules (first match wins). */
  rules: PolicyRule[];
  /** Default action when no rule matches. */
  default: Action;
  /** Operating mode: enforce (block/hold) or observe (log only, forward all). */
  mode?: GuardMode;
  /** Upstream MCP server to wrap. */
  upstream?: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  };
  /** Audit log settings. */
  audit?: {
    /** Path to audit JSONL file. Default: .sidclaw/audit.jsonl */
    path?: string;
    /** Disable audit logging. */
    disabled?: boolean;
  };
  /** Approval settings. */
  approval?: {
    /** Directory for pending approval files. Default: .sidclaw/pending */
    dir?: string;
    /** Timeout in milliseconds. Default: 300000 (5 min). */
    timeout?: number;
  };
}

/** Result of policy evaluation. */
export interface PolicyResult {
  action: Action;
  rule?: PolicyRule;
  reason?: string;
  /** Plain-English explanation of the decision. */
  explanation: string;
}

/** An entry in the audit log. */
export interface AuditEntry {
  timestamp: string;
  tool: string;
  args: Record<string, unknown>;
  decision: Action;
  rule?: string;
  reason?: string;
  /** Plain-English explanation. */
  explanation?: string;
  approval_id?: string;
  status?: 'pending' | 'approved' | 'denied' | 'expired';
  duration_ms?: number;
  /** Present only in observe mode. */
  observe?: boolean;
}

/** A pending approval request. */
export interface PendingApproval {
  id: string;
  timestamp: string;
  tool: string;
  args: Record<string, unknown>;
  rule: string;
  reason?: string;
  /** Plain-English explanation of why approval is needed. */
  explanation?: string;
  decision?: 'approved' | 'denied' | 'expired';
  decided_at?: string;
}
