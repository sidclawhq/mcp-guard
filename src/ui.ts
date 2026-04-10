/**
 * Tiny local approval UI.
 *
 * Serves a single-page web app at http://localhost:9091 for
 * reviewing pending approvals and inspecting the audit trail.
 * No external dependencies — just Node's built-in http module.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  body { background: #0a0a0b; color: #e4e4e7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; max-width: 960px; margin: 0 auto; }

  /* Header */
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand img { width: 40px; height: 40px; }
  h1 { font-size: 22px; font-weight: 600; }
  .status { font-size: 12px; display: flex; align-items: center; gap: 6px; }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; }
  .status-dot.offline { background: #ef4444; }
  .status-text { color: #71717a; }

  /* Sections */
  h2 { font-size: 14px; font-weight: 600; color: #71717a; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 12px; }
  .section { margin-bottom: 36px; }
  .empty { color: #3f3f46; font-size: 14px; padding: 24px 0; text-align: center; border: 1px dashed #27272a; border-radius: 8px; }

  /* Pending cards */
  .card { border: 1px solid #f59e0b33; border-radius: 10px; padding: 18px; margin-bottom: 10px; background: #111113; }
  .card .row1 { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .card .tool { font-family: 'SF Mono', 'JetBrains Mono', monospace; color: #3b82f6; font-size: 15px; font-weight: 600; }
  .card .badge { font-family: monospace; color: #52525b; font-size: 11px; background: #18181b; padding: 2px 8px; border-radius: 4px; }
  .card .explain { color: #a1a1aa; font-size: 13px; margin: 6px 0 10px; line-height: 1.5; }
  .card .args { font-family: monospace; color: #71717a; font-size: 12px; background: #0a0a0b; border-radius: 6px; padding: 10px; margin: 8px 0; white-space: pre-wrap; word-break: break-all; max-height: 100px; overflow-y: auto; border: 1px solid #1a1a1d; }
  .card .meta { color: #52525b; font-size: 11px; margin-top: 8px; }
  .actions { display: flex; gap: 8px; margin-top: 14px; }
  .btn { padding: 9px 24px; border: none; border-radius: 7px; cursor: pointer; font-weight: 600; font-size: 13px; transition: all 0.15s; }
  .btn:hover { transform: translateY(-1px); filter: brightness(1.1); }
  .btn:active { transform: translateY(0); }
  .btn:disabled { opacity: 0.3; cursor: not-allowed; transform: none; }
  .btn-approve { background: #22c55e; color: #fff; }
  .btn-deny { background: #ef4444; color: #fff; }
  .toast { position: fixed; top: 20px; right: 20px; padding: 12px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; opacity: 0; transition: opacity 0.3s; pointer-events: none; z-index: 100; }
  .toast.show { opacity: 1; }
  .toast.success { background: #22c55e22; color: #22c55e; border: 1px solid #22c55e44; }
  .toast.error { background: #ef444422; color: #ef4444; border: 1px solid #ef444444; }

  /* Audit */
  .audit-entry { display: grid; grid-template-columns: 75px 50px auto; gap: 10px; padding: 7px 0; border-bottom: 1px solid #18181b; font-size: 12px; font-family: monospace; align-items: baseline; }
  .audit-entry:last-child { border-bottom: none; }
  .audit-entry .time { color: #3f3f46; }
  .audit-entry .dec { font-weight: 700; text-transform: uppercase; font-size: 11px; }
  .audit-entry .dec.allow { color: #22c55e; }
  .audit-entry .dec.deny { color: #ef4444; }
  .audit-entry .dec.approve { color: #f59e0b; }
  .audit-entry .detail { color: #71717a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .audit-entry .explain-text { color: #52525b; font-style: italic; }
  .obs { background: #3b82f615; color: #60a5fa; font-size: 10px; padding: 1px 5px; border-radius: 3px; margin-left: 6px; }
  .count { color: #3f3f46; font-size: 12px; font-weight: normal; }
</style>
</head>
<body>
<div class="header">
  <div class="brand"><img src="/mascot.png" alt="Sid" onerror="this.style.display='none'"><h1>SidClaw Guard</h1></div>
  <div class="status"><span class="status-dot" id="dot"></span><span class="status-text" id="statusText">Connecting...</span></div>
</div>

<div class="section">
  <h2>Pending Approvals <span class="count" id="pendingCount"></span></h2>
  <div id="pending"><div class="empty">Waiting for tool calls...</div></div>
</div>

<div class="section">
  <h2>Audit Trail <span class="count" id="auditCount"></span></h2>
  <div id="audit"><div class="empty">No decisions yet</div></div>
</div>

<div class="toast" id="toast"></div>

<script>
let lastPendingCount = 0;

async function refresh() {
  try {
    const [pRes, aRes] = await Promise.all([fetch('/api/pending'), fetch('/api/audit')]);
    const pending = await pRes.json();
    const audit = await aRes.json();
    renderPending(pending);
    renderAudit(audit);
    document.getElementById('dot').className = 'status-dot';
    document.getElementById('statusText').textContent = 'Connected';
    if (pending.length > lastPendingCount && lastPendingCount >= 0) {
      document.title = pending.length > 0 ? '(' + pending.length + ') SidClaw Guard' : 'SidClaw Guard';
    }
    lastPendingCount = pending.length;
  } catch(e) {
    document.getElementById('dot').className = 'status-dot offline';
    document.getElementById('statusText').textContent = 'Disconnected';
  }
}

function renderPending(items) {
  const el = document.getElementById('pending');
  document.getElementById('pendingCount').textContent = items.length > 0 ? '(' + items.length + ')' : '';
  if (!items.length) { el.innerHTML = '<div class="empty">No pending approvals \\u2014 all clear</div>'; return; }
  el.innerHTML = items.map(p => {
    const args = JSON.stringify(p.args, null, 2);
    const time = new Date(p.timestamp).toLocaleTimeString();
    const age = Math.round((Date.now() - new Date(p.timestamp).getTime()) / 1000);
    const ageStr = age < 60 ? age + 's ago' : Math.round(age / 60) + 'm ago';
    const explain = p.explanation || ('Rule: ' + p.rule);
    return '<div class="card">'
      + '<div class="row1"><span class="tool">' + esc(p.tool) + '</span><span class="badge">' + esc(p.id) + '</span></div>'
      + '<div class="explain">' + esc(explain) + '</div>'
      + '<div class="args">' + esc(args) + '</div>'
      + '<div class="meta">' + time + ' \\u00b7 ' + ageStr + ' \\u00b7 Rule: ' + esc(p.rule) + '</div>'
      + '<div class="actions">'
      + '<button class="btn btn-approve" onclick="decide(\\'' + p.id + '\\',\\'approve\\',this)">\\u2714 Approve</button>'
      + '<button class="btn btn-deny" onclick="decide(\\'' + p.id + '\\',\\'deny\\',this)">\\u2718 Deny</button>'
      + '</div></div>';
  }).join('');
}

function renderAudit(items) {
  const el = document.getElementById('audit');
  const shown = items.slice(-40).reverse();
  document.getElementById('auditCount').textContent = items.length > 0 ? '(' + items.length + ')' : '';
  if (!shown.length) { el.innerHTML = '<div class="empty">No decisions yet</div>'; return; }
  el.innerHTML = shown.map(e => {
    const time = new Date(e.timestamp).toLocaleTimeString();
    const sql = e.args?.sql || e.args?.query || '';
    const summary = sql ? String(sql).trim() : JSON.stringify(e.args).substring(0, 80);
    const obs = e.observe ? '<span class="obs">observe</span>' : '';
    const statusStr = e.status && e.status !== 'pending' ? ' (' + e.status + ')' : '';
    const explain = e.explanation ? '<span class="explain-text"> \\u2014 ' + esc(e.explanation) + '</span>' : '';
    return '<div class="audit-entry">'
      + '<span class="time">' + time + '</span>'
      + '<span class="dec ' + e.decision + '">' + e.decision + statusStr + '</span>'
      + '<span class="detail">' + esc(summary.substring(0, 80)) + obs + explain + '</span>'
      + '</div>';
  }).join('');
}

async function decide(id, action, btn) {
  const card = btn.closest('.card');
  card.style.opacity = '0.5';
  card.querySelectorAll('.btn').forEach(b => b.disabled = true);
  try {
    const res = await fetch('/api/' + action + '/' + id, { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      showToast(action === 'approve' ? '\\u2714 Approved' : '\\u2718 Denied', action === 'approve' ? 'success' : 'error');
    }
    setTimeout(refresh, 200);
  } catch(e) {
    card.style.opacity = '1';
    card.querySelectorAll('.btn').forEach(b => b.disabled = false);
  }
}

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => { t.className = 'toast'; }, 2000);
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

refresh();
setInterval(refresh, 1500);
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

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');

    if (req.method === 'GET' && path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HTML_PAGE);
      return;
    }

    if (req.method === 'GET' && path === '/mascot.png') {
      // Try to find mascot image in assets/ (relative to cwd or package root)
      const candidates = [
        resolve('assets/mascot.png'),
        resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'mascot.png'),
      ];
      for (const p of candidates) {
        if (existsSync(p)) {
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
          res.end(readFileSync(p));
          return;
        }
      }
      res.writeHead(404);
      res.end();
      return;
    }

    if (req.method === 'GET' && path === '/api/pending') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(approvals.list()));
      return;
    }

    if (req.method === 'GET' && path === '/api/audit') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(audit.read()));
      return;
    }

    // CSRF check: reject POST requests from non-local origins
    if (req.method === 'POST') {
      const origin = req.headers['origin'] ?? req.headers['referer'] ?? '';
      const isLocal = !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(String(origin));
      if (!isLocal) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: non-local origin' }));
        return;
      }
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
    server.listen(port, '127.0.0.1', () => {
      resolve({ port, close: () => server.close() });
    });
  });
}
