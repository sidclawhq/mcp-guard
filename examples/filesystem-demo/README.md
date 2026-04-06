# Filesystem Demo

Guard a filesystem MCP server so agents can read files but can't modify without approval.

## What happens

| Tool | Decision | Why |
|------|----------|-----|
| `read_file` | Allowed | Read-only, safe |
| `list_directory` | Allowed | Read-only, safe |
| `write_file` | Approval required | Mutation, needs human check |
| `edit_file` | Approval required | Mutation, needs human check |
| Unknown tool | Denied | Default: deny |

## Try it

```bash
npx sidclaw-mcp-guard \
  --config examples/filesystem-demo/sidclaw.config.yaml \
  --upstream npx \
  --upstream-args "-y,@modelcontextprotocol/server-filesystem,/tmp"
```

## Policy file

See [sidclaw.config.yaml](./sidclaw.config.yaml) in this directory.
