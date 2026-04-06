<p align="center">
  <img src="https://img.shields.io/badge/MCP-guardrails-blue" alt="MCP guardrails" />
  <img src="https://img.shields.io/badge/license-Apache%202.0-green" alt="License" />
  <img src="https://img.shields.io/badge/local--first-no%20signup-orange" alt="Local-first" />
</p>

# sidclaw-mcp-guard

### Stop AI agents from doing dangerous things through MCP.

SidClaw Guard sits in front of any MCP server and lets you **allow** safe tool calls, **block** dangerous ones, and **hold** the rest for human approval.

```
Agent asks: SELECT * FROM users         →  ✅ Allowed
Agent asks: DELETE FROM users WHERE ...  →  ⏳ Held for approval
Agent asks: DROP TABLE users             →  🚫 Denied
```

---

## Try it now

```bash
npx sidclaw-mcp-guard@latest demo
```

<!-- TODO: terminal recording GIF -->

---

## What it does

SidClaw Guard is a lightweight proxy that wraps any MCP server. It intercepts every tool call and checks it against your policy rules before it reaches the real server.

- **Safe calls pass through** — `SELECT` queries, read operations, harmless tools
- **Dangerous calls are blocked** — `DROP TABLE`, destructive operations, risky tools
- **Risky calls wait for approval** — `DELETE`, mutations that need a human check

No signup. No API keys. No hosted dependency. Rules live in a YAML file next to your code.

---

## Quick Start

### 1. Add to your MCP client config

**Claude Code** (`~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "guarded-postgres": {
      "command": "npx",
      "args": [
        "sidclaw-mcp-guard@latest",
        "--config", "/path/to/sidclaw.config.yaml",
        "--upstream", "npx",
        "--upstream-args", "-y,@modelcontextprotocol/server-postgres,postgresql://localhost/mydb"
      ]
    }
  }
}
```

**Cursor**, **Windsurf**, **Claude Desktop** — same pattern, just add to your MCP server list.

### 2. Create a policy file

```yaml
# sidclaw.config.yaml

rules:
  - name: allow-reads
    match:
      tool: query
      args:
        sql: "^\\s*SELECT"
    action: allow

  - name: approve-mutations
    match:
      tool: query
      args:
        sql: "^\\s*(DELETE|UPDATE|INSERT)"
    action: approve

  - name: deny-destructive
    match:
      tool: query
      args:
        sql: "^\\s*(DROP|TRUNCATE|ALTER)"
    action: deny
    reason: "Destructive schema operations are blocked"

default: deny
```

### 3. That's it

The guard intercepts every tool call. Safe ones pass through. Dangerous ones are blocked. Risky ones wait for you.

---

## Approve or deny

When a tool call requires approval, you have two options:

### Option A: Local dashboard

Start the approval UI alongside the proxy:

```bash
sidclaw-mcp-guard --ui --upstream npx --upstream-args "..."
```

Open `http://localhost:9091` — approve or deny with one click.

<!-- TODO: screenshot of approval dashboard -->

Or run it standalone: `npx sidclaw-mcp-guard ui`

### Option B: Terminal

```
[sidclaw] ⏳ APPROVAL REQUIRED  query  DELETE FROM users WHERE id = 42
[sidclaw]   Approve: npx sidclaw-mcp-guard approve a1b2c3d4
[sidclaw]   Deny:    npx sidclaw-mcp-guard deny a1b2c3d4
```

```bash
npx sidclaw-mcp-guard list            # See pending approvals
npx sidclaw-mcp-guard approve a1b2c3  # Approve
npx sidclaw-mcp-guard deny a1b2c3     # Deny
```

---

## How it works

```
  Claude Code / Cursor / Any MCP Client
           │
           │  stdio
           ▼
    ┌──────────────────┐
    │  SidClaw Guard   │  ← intercepts tools/call
    │                  │  ← evaluates against rules
    │  allow / deny /  │  ← decides in microseconds
    │  hold            │
    └────────┬─────────┘
             │  stdio
             ▼
    ┌──────────────────┐
    │  Your MCP Server │  ← only receives allowed calls
    └──────────────────┘
```

1. Agent makes a tool call via MCP
2. Guard intercepts the `tools/call` request
3. Evaluates it against your YAML rules (top-to-bottom, first match wins)
4. **Allow** → forwards to upstream server, returns result
5. **Deny** → returns error to agent, call never reaches server
6. **Approve** → blocks until you approve/deny via CLI

Everything else (`tools/list`, `resources/*`, `prompts/*`) passes through transparently.

---

## Policy rules

Rules are YAML. First match wins. Supports glob patterns and regex.

| Field | Description | Example |
|-------|-------------|---------|
| `name` | Rule name | `allow-reads` |
| `match.tool` | Tool name (glob ok) | `query`, `db_*`, `*` |
| `match.args.<key>` | Regex on arg value | `"^\\s*SELECT"` |
| `action` | Decision | `allow`, `deny`, `approve` |
| `reason` | Shown on deny | `"Schema changes blocked"` |
| `default` | When no rule matches | `deny` (recommended) |

See [docs/config.md](docs/config.md) for full reference.

---

## Audit trail

Every decision is logged to `.sidclaw/audit.jsonl`:

```jsonl
{"timestamp":"2026-04-05T10:30:00Z","tool":"query","args":{"sql":"SELECT * FROM users"},"decision":"allow","rule":"allow-reads","duration_ms":2}
{"timestamp":"2026-04-05T10:30:05Z","tool":"query","args":{"sql":"DELETE FROM users WHERE id=42"},"decision":"approve","rule":"approve-mutations","approval_id":"a1b2c3d4","status":"approved","duration_ms":12450}
{"timestamp":"2026-04-05T10:30:20Z","tool":"query","args":{"sql":"DROP TABLE users"},"decision":"deny","rule":"deny-destructive","reason":"Destructive schema operations are blocked"}
```

---

## Observe mode

Not ready to enforce yet? Run in **observe** mode — the guard logs what it *would* do but forwards all calls:

```bash
sidclaw-mcp-guard --observe --upstream npx --upstream-args "..."
```

```
[sidclaw] ✘ DENIED  query  DROP TABLE users  [observe]
[sidclaw] ⏳ WOULD REQUIRE APPROVAL  query  DELETE FROM users  [observe]
[sidclaw] ✔ ALLOWED  query  SELECT * FROM users  [observe]
```

Observe mode lets you test your policies before enforcing them. Every decision is still logged to the audit trail (marked with `observe: true`).

Switch to enforce mode when ready by removing `--observe` or setting `mode: enforce` in config.

---

## Works with any MCP server

Guard any stdio MCP server — just point `--upstream` at it:

| Server | What you're guarding | Example config |
|--------|---------------------|----------------|
| `@modelcontextprotocol/server-postgres` | SQL queries | [examples/sql-demo](examples/sql-demo/) |
| `@modelcontextprotocol/server-filesystem` | File operations | [examples/filesystem-demo](examples/filesystem-demo/) |
| `@modelcontextprotocol/server-github` | Repo operations | |
| `@modelcontextprotocol/server-slack` | Slack messages | |
| Any custom MCP server | Any tool calls | |

---

## CLI

```bash
sidclaw-mcp-guard                          # Start the guard proxy
sidclaw-mcp-guard --observe                # Observe mode (log only)
sidclaw-mcp-guard --ui                     # Start proxy + approval dashboard
sidclaw-mcp-guard demo                     # Run the SQL demo
sidclaw-mcp-guard demo --interactive       # Interactive demo (manual approval)
sidclaw-mcp-guard ui                       # Standalone approval dashboard
sidclaw-mcp-guard approve <id>             # Approve a pending request
sidclaw-mcp-guard deny <id>                # Deny a pending request
sidclaw-mcp-guard list                     # List pending approvals
sidclaw-mcp-guard --help                   # Show help
```

---

## Full Platform

SidClaw Guard is the local-first entry point to the [SidClaw](https://sidclaw.com) platform. When you need more:

| Need | SidClaw Guard (this) | SidClaw Platform |
|------|---------------------|------------------|
| Policy rules | YAML file | Visual policy editor |
| Approvals | Terminal CLI | Dashboard + Slack + Teams + Telegram |
| Audit trail | Local JSONL | Hash-chained, exportable, compliance-ready |
| Team workflows | Single user | Multi-reviewer, role-based access |
| Integrations | MCP servers | 15+ SDKs (LangChain, Vercel AI, CrewAI...) |

[Learn more at sidclaw.com →](https://sidclaw.com)

---

## Docs

- [Quick Start](docs/quickstart.md) — get running in 2 minutes
- [SQL Demo](docs/sql-demo.md) — detailed walkthrough
- [Config Reference](docs/config.md) — all rule options
- [How It Works](docs/how-it-works.md) — architecture
- [FAQ](docs/faq.md) — common questions

---

## License

Apache 2.0 — use it however you want.
