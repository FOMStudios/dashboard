#!/usr/bin/env node
/* ============================================================
   FOM ENGINE - one small local server for the FOM dashboard's Mac tools.
   Runs on this Mac only (127.0.0.1:7788). No API keys, nothing is uploaded.

   Modules (modules/*.js) add their own routes:
     cull.js    Photo Cull (Aftershoot-style culling, starter edits, learning)
     video.js   FOM Video slot: the FOM Video project plugs its routes in here

   Safety: only the FOM dashboard (fomstudios.github.io) and local pages may call it,
   every JSON call needs the X-FOM-Engine header (other websites cannot send it), and
   pictures need the key the dashboard gets from /health.
   ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const VERSION = '1.0.0';
const PORT = +process.env.FOM_ENGINE_PORT || 7788;
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });
const KEY = crypto.randomBytes(16).toString('hex');
const ORIGINS = [/^https:\/\/fomstudios\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/, /^https:\/\/(www\.)?fomstudios\.co\.za$/];

const routes = { GET: {}, POST: {} };
const jobs = new Map();
const PY = [path.join(ROOT, '.venv', 'bin', 'python3'), path.join(ROOT, '.venv', 'bin', 'python')].find(p => fs.existsSync(p)) || 'python3';

/* ---------------- helpers given to modules ---------------- */
function okOrigin(o) { return !o || ORIGINS.some(r => r.test(o)); }
function cors(req, res) {
  const o = req.headers.origin;
  if (o && okOrigin(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-FOM-Engine');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}
function json(res, obj, code) {
  const b = JSON.stringify(obj);
  res.writeHead(code || 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(b);
}
function fail(res, msg, code) { json(res, { error: msg }, code || 400); }
function body(req) {
  return new Promise((ok, no) => {
    let b = ''; req.on('data', c => { b += c; if (b.length > 20e6) { no(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(new Error('bad JSON')); } });
  });
}
function sendFile(res, file, type, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': type || mime(file), 'Content-Length': st.size, 'Cache-Control': cache || 'private, max-age=300' });
    fs.createReadStream(file).pipe(res);
  });
}
function mime(f) {
  const e = path.extname(f).toLowerCase();
  return { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.heic': 'image/heic', '.heif': 'image/heif', '.webp': 'image/webp',
    '.tif': 'image/tiff', '.tiff': 'image/tiff', '.json': 'application/json', '.mp4': 'video/mp4', '.mov': 'video/quicktime' }[e] || 'application/octet-stream';
}
/* run a Python script that prints {"p":...} progress lines and ends with {"done":true,...} */
function python(script, args, onProgress) {
  return new Promise((ok) => {
    const p = spawn(PY, [script, ...args], { cwd: path.dirname(script), env: Object.assign({}, process.env, { PYTHONUNBUFFERED: '1' }) });
    let last = null, err = '', buf = '';
    p.stdout.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        try { const o = JSON.parse(line); if (o.done) last = o; else if (onProgress) onProgress(o); } catch (e) { /* not ours */ }
      }
    });
    p.stderr.on('data', d => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    p.on('close', code => {
      if (last) { delete last.done; return ok(last); }
      ok({ error: 'stopped (' + code + ')' + (err ? ': ' + err.trim().split('\n').slice(-3).join(' ') : '') });
    });
    p.on('error', e => ok({ error: 'Python did not start: ' + e.message + '. Run setup.sh again.' }));
  });
}
/* background job with progress the page can poll */
function job(kind, key, fn) {
  for (const j of jobs.values()) if (j.key === key && j.status === 'running') return j;
  const j = { id: crypto.randomBytes(6).toString('hex'), kind, key, status: 'running', progress: null, started: Date.now(), result: null };
  jobs.set(j.id, j);
  Promise.resolve().then(() => fn(p => { j.progress = p; })).then(r => {
    j.result = r; j.status = r && r.error ? 'error' : 'done'; j.ended = Date.now();
  }).catch(e => { j.status = 'error'; j.result = { error: e.message }; });
  // forget finished jobs after an hour
  for (const [id, o] of jobs) if (o.ended && Date.now() - o.ended > 3600e3) jobs.delete(id);
  return j;
}
function pub(j) { return { id: j.id, kind: j.kind, status: j.status, progress: j.progress, result: j.result, secs: Math.round(((j.ended || Date.now()) - j.started) / 1000) }; }
/* native Mac pickers */
function osa(script) {
  return new Promise(ok => {
    if (process.platform !== 'darwin') return ok(process.env.FOM_PICK || '');
    execFile('osascript', ['-e', script], { timeout: 600000 }, (e, out) => ok(e ? '' : String(out).trim()));
  });
}
function pickFolder(prompt) { return osa('POSIX path of (choose folder with prompt "' + String(prompt || 'Choose a folder').replace(/"/g, '') + '")').then(p => p.replace(/\/$/, '')); }
function pickFiles(prompt, ext) {
  return osa('set fs to choose file with prompt "' + String(prompt || 'Choose files').replace(/"/g, '') + '"' + (ext ? ' of type {"' + ext + '"}' : '') +
    ' with multiple selections allowed\nset out to ""\nrepeat with f in fs\nset out to out & POSIX path of f & linefeed\nend repeat\nreturn out').then(s => s.split('\n').filter(Boolean));
}
function readJSON(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } }
function writeJSON(f, o) { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o)); fs.renameSync(t, f); }

const api = {
  ROOT, DATA, KEY, PY, VERSION,
  get: (p, h) => { routes.GET[p] = h; }, post: (p, h) => { routes.POST[p] = h; },
  json, fail, body, sendFile, mime, python, job, pub, pickFolder, pickFiles, readJSON, writeJSON, osa
};

/* ---------------- core routes ---------------- */
const modules = [];
api.get('/health', (req, res) => json(res, { ok: true, engine: 'FOM Engine', version: VERSION, key: KEY, modules, platform: process.platform, python: PY }));
api.get('/jobs', (req, res, q) => { const j = jobs.get(q.get('id')); j ? json(res, pub(j)) : fail(res, 'no such job', 404); });
api.post('/reveal', async (req, res) => {
  const b = await body(req); const p = String(b.path || '');
  if (!p || !fs.existsSync(p)) return fail(res, 'not found', 404);
  if (process.platform === 'darwin') execFile('open', ['-R', p]);
  json(res, { ok: true });
});

for (const f of fs.readdirSync(path.join(ROOT, 'modules')).filter(f => f.endsWith('.js')).sort()) {
  try { const m = require(path.join(ROOT, 'modules', f)); const info = m(api) || {}; modules.push(Object.assign({ name: f.replace(/\.js$/, '') }, info)); }
  catch (e) { console.error('module', f, 'failed:', e.message); modules.push({ name: f.replace(/\.js$/, ''), error: e.message }); }
}

/* ---------------- server ---------------- */
const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(okOrigin(req.headers.origin) ? 204 : 403); return res.end(); }
  const u = new URL(req.url, 'http://127.0.0.1');
  const h = (routes[req.method] || {})[u.pathname];
  if (!h) return fail(res, 'not found', 404);
  if (!okOrigin(req.headers.origin)) return fail(res, 'origin not allowed', 403);
  const isPicture = req.method === 'GET' && u.searchParams.has('k');
  if (isPicture ? u.searchParams.get('k') !== KEY : !req.headers['x-fom-engine']) return fail(res, 'not allowed', 403);
  try { await h(req, res, u.searchParams); }
  catch (e) { console.error(u.pathname, e); if (!res.headersSent) fail(res, e.message, 500); }
});
server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? 'FOM Engine is already running on port ' + PORT + '.' : e.message); process.exit(1); });
server.listen(PORT, '127.0.0.1', () => console.log('FOM Engine ' + VERSION + ' on http://127.0.0.1:' + PORT + '  modules: ' + modules.map(m => m.name + (m.error ? ' (failed)' : '')).join(', ')));
