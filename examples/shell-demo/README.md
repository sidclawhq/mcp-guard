# Shell Demo

Guard a shell-execution MCP server so agents can run safe commands but can't destroy anything.

## What happens

| Command | Decision | Why |
|---------|----------|-----|
| `ls /home/user/projects` | Allowed | Read-only, safe |
| `curl https://api.stripe.com -X POST` | Approval required | Network request, needs human check |
| `rm -rf /` | Denied | Destructive, always blocked |

Compound commands like `ls && rm -rf /` are split and each part is evaluated. The most restrictive decision wins.

## Try it

### Quick demo (no server needed)

```bash
npx sidclaw-mcp-guard demo
```

### With a shell-execution MCP server

```bash
npx sidclaw-mcp-guard \
  --config examples/shell-demo/sidclaw.config.yaml \
  --upstream <your-shell-mcp-server>
```

## Policy file

See [sidclaw.config.yaml](./sidclaw.config.yaml) in this directory.
