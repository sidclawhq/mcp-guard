# FAQ

## General

### What is SidClaw Guard?

A lightweight proxy that wraps any MCP server and enforces rules on tool calls. Safe calls pass through, dangerous calls are blocked, and risky calls wait for human approval.

### Do I need an account or API key?

No. SidClaw Guard runs entirely locally. No signup, no API keys, no hosted dependencies.

### What MCP servers does it work with?

Any MCP server that uses stdio transport. This includes:
- `@modelcontextprotocol/server-postgres`
- `@modelcontextprotocol/server-filesystem`
- `@modelcontextprotocol/server-github`
- Any custom MCP server

### Which MCP clients work?

Any client that supports stdio MCP servers:
- Claude Code
- Claude Desktop
- Cursor
- Windsurf
- Continue
- Any MCP-compatible client

## Policies

### How are rules evaluated?

Top-to-bottom, first match wins. If no rule matches, the `default` action applies.

### Can I match on tool arguments?

Yes. Use regex patterns:

```yaml
match:
  tool: query
  args:
    sql: "^\\s*SELECT"  # Only matches queries starting with SELECT
```

### Can I use glob patterns for tool names?

Yes:

```yaml
match:
  tool: "db_*"  # Matches db_query, db_insert, etc.
```

### What happens if no rule matches?

The `default` action applies. We recommend `default: deny` (block everything not explicitly allowed).

## Approvals

### How does the approval flow work?

1. Guard creates a pending approval file
2. Guard blocks the tool call and logs instructions to stderr
3. You approve via the local dashboard (`npx sidclaw-mcp-guard ui`) or CLI (`npx sidclaw-mcp-guard approve <id>`)
4. Guard picks up the decision and forwards (or blocks) the call

### What's the timeout?

5 minutes by default. Configurable:

```yaml
approval:
  timeout: 600000  # 10 minutes
```

### Can I approve from a phone or web UI?

Yes! Run `npx sidclaw-mcp-guard ui` to open a local approval dashboard at `http://localhost:9091`. Or add `--ui` when starting the proxy to run both together. For team workflows and chat integrations (Slack, Teams, Telegram), see the [full SidClaw platform](https://sidclaw.com).

### Can I test policies without blocking calls?

Yes — use **observe mode**:

```bash
sidclaw-mcp-guard --observe --upstream ...
```

The guard evaluates every call and logs the decision, but forwards all calls regardless. Useful for testing your rules before enforcing them.

## Audit

### Where are audit logs?

`.sidclaw/audit.jsonl` by default. Each line is a JSON entry:

```json
{"timestamp":"...","tool":"query","args":{"sql":"SELECT ..."},"decision":"allow","rule":"allow-reads","duration_ms":2}
```

### Can I send audit logs somewhere?

In this version, logs are local JSONL. For cloud-based tamper-evident audit trails with hash chains, export, and compliance features, see the [full SidClaw platform](https://sidclaw.com).

## Full Platform

### What more does the full SidClaw platform offer?

- **Dashboard** — visual approval queue, agent registry, policy editor
- **Team workflows** — multi-reviewer approvals, role-based access
- **Chat integrations** — approve from Slack, Teams, or Telegram
- **Tamper-evident audit** — hash-chained, exportable, compliance-ready
- **15+ SDK integrations** — LangChain, Vercel AI, OpenAI Agents, CrewAI, and more
- **Enterprise features** — SSO, RBAC, billing, multi-tenant

Learn more at [sidclaw.com](https://sidclaw.com).
