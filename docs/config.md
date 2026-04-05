# Configuration Reference

SidClaw Guard is configured via a YAML file. Default path: `sidclaw.config.yaml`.

## Full example

```yaml
rules:
  - name: allow-reads
    description: Allow SELECT queries
    match:
      tool: query
      args:
        sql: "^\\s*SELECT"
    action: allow

  - name: approve-mutations
    description: Require approval for data changes
    match:
      tool: query
      args:
        sql: "^\\s*(DELETE|UPDATE|INSERT)"
    action: approve

  - name: deny-destructive
    description: Block destructive schema operations
    match:
      tool: query
      args:
        sql: "^\\s*(DROP|TRUNCATE|ALTER)"
    action: deny
    reason: "Schema changes are blocked by policy"

default: deny

upstream:
  command: npx
  args:
    - "-y"
    - "@modelcontextprotocol/server-postgres"
    - "postgresql://localhost/mydb"

audit:
  path: .sidclaw/audit.jsonl

approval:
  dir: .sidclaw/pending
  timeout: 300000
```

## Rules

Each rule has:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier for the rule |
| `description` | No | Human-readable explanation |
| `match.tool` | Yes | Tool name or glob pattern |
| `match.args.<key>` | No | Regex pattern matched against argument value |
| `action` | Yes | `allow`, `deny`, or `approve` |
| `reason` | No | Message shown to agent on deny |

### Tool matching

Exact name:
```yaml
match:
  tool: query
```

Glob patterns:
```yaml
match:
  tool: "db_*"        # Matches db_query, db_insert, etc.
  tool: "*_dangerous"  # Matches anything ending in _dangerous
  tool: "*"            # Matches all tools
```

### Argument matching

Regex patterns (case-insensitive):
```yaml
match:
  tool: query
  args:
    sql: "^\\s*SELECT"     # SQL starting with SELECT
    database: "production"  # Database name contains "production"
```

All argument patterns must match for the rule to apply.

## Default action

What happens when no rule matches:

```yaml
default: deny     # Block by default (recommended)
default: allow    # Allow by default
default: approve  # Require approval by default
```

## Upstream

The MCP server to wrap:

```yaml
upstream:
  command: npx
  args:
    - "-y"
    - "@modelcontextprotocol/server-postgres"
    - "postgresql://localhost/mydb"
  env:
    PGPASSWORD: "secret"
```

Can also be set via CLI flags:
```bash
sidclaw-mcp-guard --upstream npx --upstream-args "-y,@modelcontextprotocol/server-postgres,postgresql://localhost/mydb"
```

CLI flags override config file values.

## Audit

```yaml
audit:
  path: .sidclaw/audit.jsonl   # Log file path (default)
  disabled: false               # Set true to disable audit logging
```

## Approval

```yaml
approval:
  dir: .sidclaw/pending    # Pending approval directory (default)
  timeout: 300000          # Timeout in ms (default: 5 minutes)
```

## CLI override precedence

1. CLI flags (highest priority)
2. Config file values
3. Defaults (lowest priority)

## More examples

### Guard a filesystem MCP server

```yaml
rules:
  - name: allow-reads
    match:
      tool: read_file
    action: allow

  - name: approve-writes
    match:
      tool: write_file
    action: approve

  - name: deny-delete
    match:
      tool: "delete_*"
    action: deny
    reason: "File deletion is not allowed"

default: deny
```

### Guard a GitHub MCP server

```yaml
rules:
  - name: allow-read-ops
    match:
      tool: "get_*"
    action: allow

  - name: allow-list-ops
    match:
      tool: "list_*"
    action: allow

  - name: approve-create
    match:
      tool: "create_*"
    action: approve

  - name: deny-delete
    match:
      tool: "delete_*"
    action: deny

default: approve
```
