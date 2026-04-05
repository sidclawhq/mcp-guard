/**
 * SidClaw MCP Guard — Programmatic API
 *
 * Use this to integrate the guard into your own code.
 */

export { MCPGuard } from './guard.js';
export { evaluate } from './policy.js';
export { AuditLog } from './audit.js';
export { ApprovalQueue } from './approval.js';
export { loadConfig, defaultConfig } from './config.js';

export type {
  Action,
  PolicyRule,
  GuardConfig,
  PolicyResult,
  AuditEntry,
  PendingApproval,
} from './types.js';
