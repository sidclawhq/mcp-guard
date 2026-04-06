/**
 * Tiny local approval UI.
 *
 * Serves a single-page web app at http://localhost:9091 for
 * reviewing pending approvals and inspecting the audit trail.
 * No external dependencies — just Node's built-in http module.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ApprovalQueue } from './approval.js';
import { AuditLog } from './audit.js';

const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SidClaw Guard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a0b; color: #e4e4e7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 22px; font-weight: 600; margin-bottom: 4px; }
  .subtitle { color: #71717a; font-size: 14px; margin-bottom: 32px; }
  h2 { font-size: 16px; font-weight: 600; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; }
  .section { margin-bottom: 32px; }
  .empty { color: #52525b; font-size: 14px; padding: 16px 0; }
  .card { border: 1px solid #27272a; border-radius: 8px; padding: 16px; margin-bottom: 8px; background: #111113; }
  .card.pending { border-color: #f59e0b33; }
  .card .top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .card .tool { font-family: 'JetBrains Mono', 'SF Mono', monospace; color: #3b82f6; font-size: 14px; font-weight: 600; }
  .card .id { font-family: monospace; color: #52525b; font-size: 12px; }
  .card .args { font-family: monospace; color: #a1a1aa; font-size: 13px; background: #0a0a0b; border-radius: 4px; padding: 8px; margin: 8px 0; white-space: pre-wrap; word-break: break-all; max-height: 120px; overflow-y: auto; }
  .card .meta { color: #71717a; font-size: 12px; }
  .card .rule { color: #a1a1aa; }
  .actions { display: flex; gap: 8px; margin-top: 12px; }
  .btn { padding: 8px 20px; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px; transition: opacity 0.15s; }
  .btn:hover { opacity: 0.85; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-approve { background: #22c55e; color: #fff; }
  .btn-deny { background: #ef4444; color: #fff; }
  .audit-row { display: flex; gap: 12px; padding: 6px 0; border-bottom: 1px solid #1a1a1d; font-size: 13px; font-family: monospace; align-items: baseline; }
  .audit-row:last-child { border-bottom: none; }
  .audit-row .time { color: #52525b; min-width: 80px; }
  .audit-row .decision { min-width: 70px; font-weight: 600; }
  .audit-row .decision.allow { color: #22c55e; }
  .audit-row .decision.deny { color: #ef4444; }
  .audit-row .decision.approve { color: #f59e0b; }
  .audit-row .tool-name { color: #3b82f6; min-width: 80px; }
  .audit-row .summary { color: #a1a1aa; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .observe-badge { background: #3b82f622; color: #60a5fa; font-size: 11px; padding: 2px 6px; border-radius: 4px; margin-left: 8px; }
  .refresh { color: #52525b; font-size: 12px; float: right; }
</style>
</head>
<body>
<h1>&#x1f6e1;&#xfe0f; SidClaw Guard</h1>
<p class="subtitle">Local approval dashboard</p>

<div class="section">
  <h2>Pending Approvals <span class="refresh" id="status">Auto-refreshing</span></h2>
  <div id="pending"><div class="empty">Loading...</div></div>
</div>

<div class="section">
  <h2>Recent Audit Trail</h2>
  <div id="audit"><div class="empty">Loading...</div></div>
</div>

<script>
async function refresh() {
  try {
    const [pendingRes, auditRes] = await Promise.all([
      fetch('/api/pending'),
      fetch('/api/audit'),
    ]);
    const pending = await pendingRes.json();
    const audit = await auditRes.json();
    renderPending(pending);
    renderAudit(audit);
    document.getElementById('status').textContent = 'Auto-refreshing';
  } catch(e) {
    document.getElementById('status').textContent = 'Connection lost';
  }
}

function renderPending(items) {
  const el = document.getElementById('pending');
  if (!items.length) {
    el.innerHTML = '<div class="empty">No pending approvals</div>';
    return;
  }
  el.innerHTML = items.map(p => {
    const args = JSON.stringify(p.args, null, 2);
    const time = new Date(p.timestamp).toLocaleTimeString();
    return '<div class="card pending">'
      + '<div class="top"><span class="tool">' + esc(p.tool) + '</span><span class="id">' + esc(p.id) + '</span></div>'
      + '<div class="args">' + esc(args) + '</div>'
      + '<div class="meta">Rule: <span class="rule">' + esc(p.rule) + '</span> &middot; ' + time + '</div>'
      + '<div class="actions">'
      + '<button class="btn btn-approve" onclick="decide(\\'' + p.id + '\\',\\'approve\\',this)">Approve</button>'
      + '<button class="btn btn-deny" onclick="decide(\\'' + p.id + '\\',\\'deny\\',this)">Deny</button>'
      + '</div></div>';
  }).join('');
}

function renderAudit(items) {
  const el = document.getElementById('audit');
  if (!items.length) {
    el.innerHTML = '<div class="empty">No audit entries yet</div>';
    return;
  }
  el.innerHTML = items.slice(-30).reverse().map(e => {
    const time = new Date(e.timestamp).toLocaleTimeString();
    const sql = e.args?.sql || e.args?.query || JSON.stringify(e.args).substring(0, 60);
    const obs = e.observe ? '<span class="observe-badge">observe</span>' : '';
    return '<div class="audit-row">'
      + '<span class="time">' + time + '</span>'
      + '<span class="decision ' + e.decision + '">' + e.decision + (e.status ? ' (' + e.status + ')' : '') + '</span>'
      + '<span class="tool-name">' + esc(e.tool) + '</span>'
      + '<span class="summary">' + esc(String(sql)) + obs + '</span>'
      + '</div>';
  }).join('');
}

async function decide(id, action, btn) {
  btn.disabled = true;
  btn.parentElement.querySelectorAll('.btn').forEach(b => b.disabled = true);
  try {
    await fetch('/api/' + action + '/' + id, { method: 'POST' });
    setTimeout(refresh, 300);
  } catch(e) {
    btn.disabled = false;
  }
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;

export interface UIServerOptions {
  port?: number;
  approvalDir?: string;
  auditPath?: string;
}

export async function startUIServer(options: UIServerOptions = {}): Promise<{ port: number; close: () => void }> {
  const port = options.port ?? 9091;
  const approvalDir = options.approvalDir ?? '.sidclaw/pending';
  const auditPath = options.auditPath ?? '.sidclaw/audit.jsonl';

  const approvals = new ApprovalQueue(approvalDir);
  const audit = new AuditLog(auditPath);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const path = url.pathname;

    // CORS headers for local dev
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');

    if (req.method === 'GET' && path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HTML_PAGE);
      return;
    }

    if (req.method === 'GET' && path === '/api/pending') {
      const pending = approvals.list();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(pending));
      return;
    }

    if (req.method === 'GET' && path === '/api/audit') {
      const entries = audit.read();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(entries));
      return;
    }

    if (req.method === 'POST' && path.startsWith('/api/approve/')) {
      const id = path.split('/').pop()!;
      try {
        approvals.decide(id, 'approved');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, decision: 'approved' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (e as Error).message }));
      }
      return;
    }

    if (req.method === 'POST' && path.startsWith('/api/deny/')) {
      const id = path.split('/').pop()!;
      try {
        approvals.decide(id, 'denied');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, decision: 'denied' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (e as Error).message }));
      }
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      resolve({
        port,
        close: () => server.close(),
      });
    });
  });
}
