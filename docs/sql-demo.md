# SQL Demo Walkthrough

The SQL demo is the fastest way to understand SidClaw Guard.

## Scenario

An AI agent has MCP access to a PostgreSQL database. Without guardrails, it could run any SQL — including `DROP TABLE`.

SidClaw Guard wraps the database MCP server and enforces three rules:

| Rule | Matches | Action |
|------|---------|--------|
| `allow-reads` | `SELECT ...` | Allow |
| `approve-mutations` | `DELETE`, `UPDATE`, `INSERT` | Require approval |
| `deny-destructive` | `DROP`, `TRUNCATE`, `ALTER` | Deny |

## Run the demo

```bash
npx sidclaw-mcp-guard demo
```

No database needed — the demo simulates the tool calls locally.

### What you'll see

**Test 1: `SELECT * FROM users`**
```
✔ ALLOWED  Rule: allow-reads
→ Forwarded to upstream PostgreSQL
→ Result: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]
```

**Test 2: `DELETE FROM users WHERE id = 42`**
```
⏳ APPROVAL REQUIRED  Rule: approve-mutations
  The agent is paused, waiting for a human decision.
  [Auto-approving in 3s for demo...]
✔ APPROVED → Forwarded to upstream
→ Result: 1 row affected
```

**Test 3: `DROP TABLE users`**
```
✘ DENIED  Rule: deny-destructive
  Reason: Destructive schema operations are blocked by policy
  → The agent receives an error. The query never reaches the database.
```

## Interactive mode

For a more realistic demo where you manually approve/deny:

```bash
npx sidclaw-mcp-guard demo --interactive
```

At the approval step, you'll be prompted to approve or deny.

## Try with a real database

### 1. Start PostgreSQL

```bash
docker run -d --name demo-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=demo \
  -e POSTGRES_DB=demo \
  postgres:16-alpine
```

### 2. Create test data

```bash
docker exec -i demo-pg psql -U postgres demo <<SQL
CREATE TABLE users (id serial, name text, email text);
INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com'), ('Bob', 'bob@example.com');
SQL
```

### 3. Start the guard

Add to your MCP client config:

```json
{
  "mcpServers": {
    "guarded-postgres": {
      "command": "npx",
      "args": [
        "sidclaw-mcp-guard@latest",
        "--config", "sidclaw.config.yaml",
        "--upstream", "npx",
        "--upstream-args", "-y,@modelcontextprotocol/server-postgres,postgresql://postgres:demo@localhost/demo"
      ]
    }
  }
}
```

### 4. Approve in another terminal

When the agent tries to DELETE or UPDATE, you'll see the approval prompt in the guard's stderr output. In another terminal:

```bash
npx sidclaw-mcp-guard list      # See pending
npx sidclaw-mcp-guard approve <id>
```

## Audit trail

After the demo, check `.sidclaw/audit.jsonl`:

```bash
cat .sidclaw/audit.jsonl | jq .
```

Each line is one decision with timestamp, tool, args, rule, and outcome.
