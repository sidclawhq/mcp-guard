/**
 * SidClaw MCP Guard — Programmatic API
 */

export { MCPGuard } from './guard.js';
export { evaluate, semanticPatterns } from './policy.js';
export { AuditLog } from './audit.js';
export { ApprovalQueue } from './approval.js';
export { loadConfig, defaultConfig } from './config.js';
export { startUIServer } from './ui.js';
export { startMockServer } from './mock-server.js';

export type {
  Action,
  GuardMode,
  SemanticPattern,
  PolicyRule,
  GuardConfig,
  PolicyResult,
  AuditEntry,
  PendingApproval,
} from './types.js';
export type { UIServerOptions } from './ui.js';
