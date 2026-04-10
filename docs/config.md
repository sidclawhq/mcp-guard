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

> **Terminology:** The `approve` action in config means "hold for human approval." In output, it displays as `HOLD` (describing the state of the call while waiting). The config value stays `approve` because that's what the reviewer does.

## Semantic patterns

Built-in patterns for common tool categories:

| Pattern | Matches | Use case |
|---------|---------|----------|
| `sql-read` | SELECT, EXPLAIN, SHOW, DESCRIBE, WITH | Database read queries |
| `sql-write` | INSERT, UPDATE, DELETE, MERGE, UPSERT | Database data changes |
| `sql-destructive` | DROP, TRUNCATE, ALTER, CREATE, GRANT, REVOKE | Database schema/permission changes |
| `file-read` | read_file, list_directory, search_files, get_file_info | File read operations |
| `file-write` | write_file, edit_file, move_file, create_directory | File write operations |
| `file-delete` | delete_file, remove_directory | File deletion |
| `shell-safe` | ls, pwd, whoami, echo, cat, head, tail, wc, date, uname | Safe shell commands |
| `shell-risky` | mv, cp, mkdir, chmod, chown, curl, wget, npm, pip | Risky shell commands |
| `shell-destructive` | rm, rmdir, kill, killall, shutdown, reboot, mkfs, dd, sudo | Destructive shell commands |

Shell patterns match against the `command` argument of tools named `execute`, `run_command`, `shell`, `exec`, or `run`. For compound commands (using `;`, `&&`, `||`, `|`), each sub-command is evaluated and the most restrictive action wins.

SQL patterns similarly handle compound statements: `SELECT 1; DROP TABLE users` is classified as `sql-destructive` because `DROP` is more restrictive than `SELECT`.

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

## Mode

```yaml
mode: enforce    # Default — block denied calls, hold approvals
mode: observe    # Log decisions but forward all calls
```

Can also be set via CLI:
```bash
sidclaw-mcp-guard --observe
```

In observe mode, the guard evaluates every call but never blocks. Useful for testing policies before enforcing them. Audit entries include `observe: true` so you can tell the difference.

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
