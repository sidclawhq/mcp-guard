# SQL Demo

Guard a PostgreSQL MCP server so agents can read data but can't destroy it.

## What happens

| Query | Decision | Why |
|-------|----------|-----|
| `SELECT * FROM users` | Allowed | Read-only, safe |
| `DELETE FROM users WHERE id = 42` | Approval required | Data mutation, needs human check |
| `DROP TABLE users` | Denied | Destructive, always blocked |

## Try it

### Quick demo (no database needed)

```bash
npx sidclaw-mcp-guard demo
```

### With a real PostgreSQL MCP server

```bash
npx sidclaw-mcp-guard \
  --config examples/sql-demo/sidclaw.config.yaml \
  --upstream npx \
  --upstream-args "-y,@modelcontextprotocol/server-postgres,postgresql://localhost/mydb"
```

Then in another terminal, approve or deny pending requests:

```bash
npx sidclaw-mcp-guard list
npx sidclaw-mcp-guard approve <id>
```

## Policy file

See [sidclaw.config.yaml](./sidclaw.config.yaml) in this directory.
