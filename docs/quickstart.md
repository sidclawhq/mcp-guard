# Quick Start

Get SidClaw Guard running in under 2 minutes.

## 1. Run the demo

No setup required:

```bash
npx sidclaw-mcp-guard@latest demo
```

You'll see three SQL queries evaluated against the guard:
- `SELECT` — allowed (ALLOW)
- `DELETE` — held for approval (HOLD)
- `DROP TABLE` — denied (BLOCK)

## 2. Guard a real MCP server

### Option A: Add to your MCP client config

For Claude Code, add to `.mcp.json` in your project root:

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

### Option B: Use config file for everything

Create `sidclaw.config.yaml`:

```yaml
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
    reason: "Schema changes are blocked"

default: deny

upstream:
  command: npx
  args:
    - "-y"
    - "@modelcontextprotocol/server-postgres"
    - "postgresql://localhost/mydb"
```

Then start:

```bash
npx sidclaw-mcp-guard@latest
```

## 3. Handle approvals

When a tool call requires approval, the guard logs to stderr:

```
⏳ HOLD    DELETE FROM users WHERE id = 42
  Held for approval: delete from users. Data changes need approval.
  Approve: npx sidclaw-mcp-guard approve a1b2c3d4
  Deny:    npx sidclaw-mcp-guard deny a1b2c3d4
```

In another terminal:

```bash
# See what's pending
npx sidclaw-mcp-guard list

# Approve
npx sidclaw-mcp-guard approve a1b2c3d4

# Or deny
npx sidclaw-mcp-guard deny a1b2c3d4
```

## 4. Check the audit trail

Every decision is logged to `.sidclaw/audit.jsonl`:

```bash
cat .sidclaw/audit.jsonl | jq .
```

## Next

- [Config reference](./config.md) — all rule options
- [SQL demo](./sql-demo.md) — detailed walkthrough
- [How it works](./how-it-works.md) — architecture
- [FAQ](./faq.md) — common questions
