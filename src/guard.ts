/**
 * MCP Guard Proxy
 *
 * Sits between an MCP client (Claude Code, Cursor, etc.) and an upstream
 * MCP server. Intercepts tool calls and evaluates them against policy rules.
 *
 * Safe calls pass through. Dangerous calls are blocked. Risky calls wait
 * for human approval.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { GuardConfig } from './types.js';
import { evaluate } from './policy.js';
import { AuditLog } from './audit.js';
import { ApprovalQueue } from './approval.js';
import { SHIELD_MINI } from './banner.js';

export class MCPGuard {
  private server: Server;
  private upstream: Client;
  private audit: AuditLog;
  private approvals: ApprovalQueue;
  private config: GuardConfig;

  constructor(config: GuardConfig) {
    this.config = config;

    this.server = new Server(
      { name: 'sidclaw-mcp-guard', version: '0.1.0' },
      { capabilities: { tools: {}, resources: {}, prompts: {} } },
    );

    this.upstream = new Client(
      { name: 'sidclaw-guard-client', version: '0.1.0' },
      {},
    );

    const auditPath = config.audit?.path ?? '.sidclaw/audit.jsonl';
    const auditDisabled = config.audit?.disabled ?? false;
    this.audit = new AuditLog(auditPath, auditDisabled);

    const approvalDir = config.approval?.dir ?? '.sidclaw/pending';
    const approvalTimeout = config.approval?.timeout ?? 300_000;
    this.approvals = new ApprovalQueue(approvalDir, approvalTimeout);

    this.registerHandlers();
  }

  private registerHandlers(): void {
    // --- Tools: LIST (pass-through) ---
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return await this.upstream.listTools();
    });

    // --- Tools: CALL (guarded) ---
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const args = (request.params.arguments ?? {}) as Record<string, unknown>;
      const startTime = Date.now();
      const observing = this.config.mode === 'observe';
      const modeTag = observing ? ' \x1b[2m[observe]\x1b[0m' : '';

      const result = evaluate(toolName, args, this.config.rules, this.config.default);

      // ---- DENY ----
      if (result.action === 'deny') {
        const reason = result.reason ?? `Denied by policy${result.rule ? `: ${result.rule.name}` : ''}`;
        this.log(`\x1b[31m✘ DENIED\x1b[0m  ${toolName}  ${this.summarize(args)}${modeTag}`);
        this.log(`  ${result.explanation}`);

        this.audit.write({
          timestamp: new Date().toISOString(),
          tool: toolName,
          args,
          decision: 'deny',
          rule: result.rule?.name,
          reason,
          explanation: result.explanation,
          duration_ms: Date.now() - startTime,
          ...(observing ? { observe: true } : {}),
        });

        if (observing) {
          return await this.upstream.callTool({ name: toolName, arguments: args });
        }

        return {
          content: [{
            type: 'text' as const,
            text: `DENIED by SidClaw Guard: ${reason}\n\n${result.explanation}\n\nTool: ${toolName}\nRule: ${result.rule?.name ?? 'default policy'}`,
          }],
          isError: true,
        };
      }

      // ---- APPROVE ----
      if (result.action === 'approve') {
        if (observing) {
          this.log(`\x1b[33m⏳ WOULD REQUIRE APPROVAL\x1b[0m  ${toolName}  ${this.summarize(args)}${modeTag}`);
          this.log(`  ${result.explanation}`);

          this.audit.write({
            timestamp: new Date().toISOString(),
            tool: toolName,
            args,
            decision: 'approve',
            rule: result.rule?.name,
            explanation: result.explanation,
            status: 'approved',
            duration_ms: Date.now() - startTime,
            observe: true,
          });

          return await this.upstream.callTool({ name: toolName, arguments: args });
        }

        // Enforce mode: create pending approval and block
        const pending = this.approvals.create(
          toolName,
          args,
          result.rule?.name ?? 'default',
          result.reason,
          result.explanation,
        );

        this.log(`\x1b[33m⏳ APPROVAL REQUIRED\x1b[0m  ${toolName}  ${this.summarize(args)}`);
        this.log(`  ${result.explanation}`);
        this.log(`  Approve: npx sidclaw-mcp-guard approve ${pending.id}`);
        this.log(`  Deny:    npx sidclaw-mcp-guard deny ${pending.id}`);
        this.log(`  Dashboard: http://localhost:9091`);

        this.audit.write({
          timestamp: new Date().toISOString(),
          tool: toolName,
          args,
          decision: 'approve',
          rule: result.rule?.name,
          explanation: result.explanation,
          approval_id: pending.id,
          status: 'pending',
        });

        const decision = await this.approvals.waitForDecision(pending.id);

        if (decision === 'approved') {
          this.log(`\x1b[32m✔ APPROVED\x1b[0m  ${toolName}  (${pending.id})`);
          this.audit.write({
            timestamp: new Date().toISOString(),
            tool: toolName,
            args,
            decision: 'approve',
            rule: result.rule?.name,
            approval_id: pending.id,
            status: 'approved',
            duration_ms: Date.now() - startTime,
          });
          return await this.upstream.callTool({ name: toolName, arguments: args });
        }

        const status = decision === 'expired' ? 'expired' : 'denied';
        const reason = decision === 'expired' ? 'Approval timed out' : 'Denied by reviewer';
        this.log(`\x1b[31m✘ ${reason.toUpperCase()}\x1b[0m  ${toolName}  (${pending.id})`);

        this.audit.write({
          timestamp: new Date().toISOString(),
          tool: toolName,
          args,
          decision: 'approve',
          rule: result.rule?.name,
          approval_id: pending.id,
          status,
          duration_ms: Date.now() - startTime,
        });

        return {
          content: [{
            type: 'text' as const,
            text: `${reason}: ${toolName}\n\nApproval ID: ${pending.id}\nThis action required human approval and was ${status}.`,
          }],
          isError: true,
        };
      }

      // ---- ALLOW ----
      this.log(`\x1b[32m✔ ALLOWED\x1b[0m  ${toolName}  ${this.summarize(args)}${modeTag}`);
      if (result.rule) {
        this.log(`  ${result.explanation}`);
      }

      this.audit.write({
        timestamp: new Date().toISOString(),
        tool: toolName,
        args,
        decision: 'allow',
        rule: result.rule?.name,
        explanation: result.explanation,
        duration_ms: Date.now() - startTime,
        ...(observing ? { observe: true } : {}),
      });

      return await this.upstream.callTool({ name: toolName, arguments: args });
    });

    // --- Resources: pass-through ---
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      try { return await this.upstream.listResources(); } catch { return { resources: [] }; }
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      return await this.upstream.readResource({ uri: request.params.uri });
    });

    // --- Prompts: pass-through ---
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      try { return await this.upstream.listPrompts(); } catch { return { prompts: [] }; }
    });

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      return await this.upstream.getPrompt({
        name: request.params.name,
        arguments: request.params.arguments,
      });
    });
  }

  /**
   * Start the guard proxy.
   */
  async start(): Promise<void> {
    const upstream = this.config.upstream;
    if (!upstream?.command) {
      throw new Error(
        'No upstream MCP server configured.\n' +
        'Set upstream.command in sidclaw.config.yaml or use --upstream flag.',
      );
    }

    // Clean up stale approvals from previous sessions
    const cleaned = this.approvals.cleanup();
    if (cleaned > 0) {
      this.log(`Cleaned ${cleaned} stale approval(s) from previous session`);
    }

    // Connect to upstream MCP server
    const upstreamTransport = new StdioClientTransport({
      command: upstream.command,
      args: upstream.args ?? [],
      env: upstream.env
        ? { ...process.env, ...upstream.env } as Record<string, string>
        : undefined,
    });
    await this.upstream.connect(upstreamTransport);

    // Start accepting connections from MCP client
    const serverTransport = new StdioServerTransport();
    await this.server.connect(serverTransport);

    const mode = this.config.mode ?? 'enforce';
    process.stderr.write('\n' + SHIELD_MINI + '\n\n');
    this.log(`   Mode:     ${mode}${mode === 'observe' ? ' (log only, all calls forwarded)' : ''}`);
    this.log(`   Rules:    ${this.config.rules.length} loaded`);
    this.log(`   Default:  ${this.config.default}`);
    this.log(`   Upstream: ${upstream.command} ${(upstream.args ?? []).join(' ')}`);
    this.log(`   Audit:    ${this.audit.getPath()}`);
    this.log('');

    // Graceful shutdown
    const shutdown = async () => {
      this.log('Shutting down...');
      try { await this.upstream.close(); } catch { /* ignore */ }
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  /** Log to stderr (stdout is MCP protocol). */
  private log(msg: string): void {
    process.stderr.write(`[sidclaw] ${msg}\n`);
  }

  /** Summarize args for log display. */
  private summarize(args: Record<string, unknown>): string {
    const sql = args['sql'] ?? args['query'];
    if (sql) {
      const s = String(sql).trim();
      return s.length > 80 ? s.substring(0, 77) + '...' : s;
    }
    const j = JSON.stringify(args);
    return j.length > 80 ? j.substring(0, 77) + '...' : j;
  }
}
