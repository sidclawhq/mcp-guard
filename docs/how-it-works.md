# How It Works

SidClaw Guard is an MCP proxy. It sits between the MCP client (your AI agent) and the upstream MCP server (the real tool).

## Architecture

```
  AI Agent (Claude Code, Cursor, etc.)
           │
           │  MCP protocol (stdio)
           ▼
    ┌──────────────────┐
    │  SidClaw Guard   │
    │                  │
    │  1. Intercept    │  ← catches every tools/call request
    │  2. Evaluate     │  ← checks against your policy rules
    │  3. Decide       │  ← allow / deny / hold for approval
    │                  │
    └────────┬─────────┘
             │
             │  MCP protocol (stdio)
             ▼
    ┌──────────────────┐
    │  Upstream MCP    │  ← only receives allowed calls
    │  Server          │
    └──────────────────┘
```

## What gets intercepted

Only `tools/call` requests are evaluated against your policy.

Everything else passes through transparently:
- `tools/list` — proxied as-is (the agent sees all available tools)
- `resources/*` — proxied as-is
- `prompts/*` — proxied as-is

## Policy evaluation

Rules are evaluated top-to-bottom. First match wins.

For each `tools/call` request:

1. **Match tool name** — exact string or glob pattern (`query`, `db_*`)
2. **Match arguments** — regex patterns on argument values (`sql: "^SELECT"`)
3. **Return action** — `allow`, `deny`, or `approve`
4. **If no match** — use the `default` action (usually `deny`)

## Decisions

### Allow

The tool call is forwarded to the upstream MCP server. The agent receives the real result.

### Deny

The tool call is blocked. The agent receives an error message explaining why and which rule denied it. The call never reaches the upstream server.

### Approve (hold for human approval)

1. Guard creates a pending approval file in `.sidclaw/pending/`
2. Guard logs the approval command to stderr
3. Guard blocks, polling the file for a decision
4. A human runs `sidclaw-mcp-guard approve <id>` or `deny <id>`
5. Guard picks up the decision:
   - If approved → forwards to upstream, returns result
   - If denied → returns error to agent
   - If timeout (5 min default) → returns timeout error

## Audit trail

Every decision is recorded in `.sidclaw/audit.jsonl` as a single JSON line:

```json
{
  "timestamp": "2026-04-05T10:30:00.000Z",
  "tool": "query",
  "args": { "sql": "SELECT * FROM users" },
  "decision": "allow",
  "rule": "allow-reads",
  "duration_ms": 2
}
```

For approvals, two entries are written:
1. When the approval is created (status: "pending")
2. When the decision is made (status: "approved" or "denied")

## Transport

SidClaw Guard currently supports **stdio** transport — the standard for local MCP servers used by Claude Code, Cursor, and similar tools.

The guard spawns the upstream server as a child process and communicates via stdin/stdout.
