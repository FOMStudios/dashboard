/* FOM Engine module: Photo Cull (cull.html in the dashboard).
   The heavy lifting is in ../cull/*.py; this file is the bridge to the page. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function (api) {
  const CULL = path.join(api.ROOT, 'cull', 'cull.py');
  const CACHE = path.join(api.ROOT, 'cache');
  const RECENT = path.join(api.DATA, 'cull-recent.json');
  const IMG = /\.(jpe?g|png|heic|heif|tiff?|webp)$/i;
  const allowed = new Set();   // folders you chose this session (finals for the handoffs)

  const sid = f => crypto.createHash('sha1').update(fs.realpathSync(f)).digest('hex').slice(0, 14);
  const stateFile = f => path.join(f, '.fomcull', 'state.json');
  const readState = f => api.readJSON(stateFile(f), null);
  const okFolder = f => { try { return !!f && path.isAbsolute(f) && fs.statSync(f).isDirectory(); } catch (e) { return false; } };
  const run = (args, onP) => api.python(CULL, args, onP);

  function remember(folder, extra) {
    const list = api.readJSON(RECENT, []).filter(r => r.folder !== folder);
    list.unshift(Object.assign({ folder, name: path.basename(folder), t: Date.now() }, extra || {}));
    api.writeJSON(RECENT, list.slice(0, 30));
  }
  function summary(folder) {
    const st = readState(folder);
    if (!st) return null;
    return { folder, name: st.name, biz: st.biz, job: st.job, strict: st.strict, counts: st.counts, photos: (st.photos || []).length,
      written: st.written ? { t: st.written.t, mode: st.written.mode } : null, learned: st.learned || null, savedAt: st.savedAt };
  }
  /* the page does not need face fingerprints or hashes */
  function slim(st) {
    const out = Object.assign({}, st);
    out.photos = (st.photos || []).map(p => {
      const a = p.a || {};
      return { id: p.id, main: p.main, files: p.files, kind: p.kind, pair: p.pair, t: p.t, iso: p.iso, shutter: p.shutter, fnum: p.fnum, focal: p.focal,
        camera: p.camera, pw: p.pw, ph: p.ph, d: p.d,
        a: a.ex ? { ex: { mean: a.ex.mean, hi: a.ex.hi, lo: a.ex.lo }, st: a.st, aes: a.aes, hz: a.hz,
          faces: (a.faces || []).map(f => ({ b: f.b, eo: f.eo, smile: f.smile, pid: f.pid, sh: f.sh })) } : null };
    });
    return out;
  }
  function recount(st) {
    const c = { hl: 0, keep: 0, check: 0, dup: 0, rej: 0 };
    for (const p of st.photos || []) { if (!p.d) continue; const k = (p.d.hand && p.d.hand.c) || p.d.c; c[k] = (c[k] || 0) + 1; }
    st.counts = c;
  }

  api.post('/cull/pick-folder', async (req, res) => {
    const b = await api.body(req);
    const f = await api.pickFolder(b.prompt || 'Choose the shoot folder');
    if (!f) return api.json(res, { cancelled: true });
    allowed.add(fs.realpathSync(f));
    let n = 0;
    try { n = fs.readdirSync(f).filter(x => /\.(cr3|cr2|nef|arw|raf|dng|jpe?g|heic|heif)$/i.test(x)).length; } catch (e) {}
    api.json(res, { folder: f, name: path.basename(f), files: n, culled: summary(f) });
  });

  api.get('/cull/recent', (req, res) => {
    const list = api.readJSON(RECENT, []).filter(r => okFolder(r.folder)).map(r => Object.assign({}, r, summary(r.folder) || {}));
    api.json(res, { recent: list });
  });

  api.post('/cull/run', async (req, res) => {
    const b = await api.body(req);
    if (!okFolder(b.folder)) return api.fail(res, 'That folder is not there any more.');
    remember(b.folder, { biz: b.biz, job: b.job });
    const args = ['run', '--folder', b.folder, '--biz', b.biz === 'sba' ? 'sba' : 'fom', '--job', b.job || 'events', '--strict', b.strict || 'normal'];
    if (b.claude === false) args.push('--no-claude');
    if (b.fresh) args.push('--fresh');
    const j = api.job('cull', 'cull:' + b.folder, onP => run(args, onP));
    api.json(res, api.pub(j));
  });

  api.post('/cull/decide', async (req, res) => {
    const b = await api.body(req);
    if (!okFolder(b.folder)) return api.fail(res, 'That folder is not there any more.');
    const args = ['decide', '--folder', b.folder];
    if (b.job) args.push('--job', b.job);
    if (b.strict) args.push('--strict', b.strict);
    if (Array.isArray(b.priority)) args.push('--priority', b.priority.join(','));
    if (b.claude) args.push('--claude');
    const j = api.job('decide', 'cull:' + b.folder, onP => run(args, onP));
    api.json(res, api.pub(j));
  });

  api.get('/cull/state', (req, res, q) => {
    const f = q.get('folder');
    if (!okFolder(f)) return api.fail(res, 'That folder is not there any more.', 404);
    const st = readState(f);
    if (!st) return api.json(res, { none: true });
    allowed.add(fs.realpathSync(f));
    api.json(res, slim(st));
  });

  /* your hand changes: {folder, changes: {photoId: {c, r, l, f} or null}} (no Python needed) */
  api.post('/cull/hand', async (req, res) => {
    const b = await api.body(req);
    const st = readState(b.folder);
    if (!st) return api.fail(res, 'Cull this folder first.');
    st.overrides = st.overrides || {};
    const by = new Map((st.photos || []).map(p => [p.id, p]));
    for (const [id, v] of Object.entries(b.changes || {})) {
      const p = by.get(id); if (!p || !p.d) continue;
      if (v && typeof v === 'object') {
        const clean = {};
        if (['hl', 'keep', 'check', 'dup', 'rej'].includes(v.c)) clean.c = v.c;
        if (v.r != null && +v.r >= 0 && +v.r <= 5) clean.r = +v.r;
        if (typeof v.l === 'string' && /^(|Red|Yellow|Green|Blue|Purple)$/.test(v.l)) clean.l = v.l;
        if ([-1, 0, 1].includes(+v.f) && v.f != null) clean.f = +v.f;
        st.overrides[id] = clean; p.d.hand = clean;
      } else { delete st.overrides[id]; delete p.d.hand; }
    }
    recount(st);
    st.savedAt = Date.now() / 1000;
    api.writeJSON(stateFile(b.folder), st);
    api.json(res, { ok: true, counts: st.counts });
  });

  api.post('/cull/write', async (req, res) => {
    const b = await api.body(req);
    if (!okFolder(b.folder)) return api.fail(res, 'That folder is not there any more.');
    const args = ['write', '--folder', b.folder, '--edit', ['none', 'basic', 'preset', 'learned'].includes(b.edit) ? b.edit : 'none'];
    if (b.preset) args.push('--preset', String(b.preset));
    api.json(res, api.pub(api.job('write', 'cull:' + b.folder, onP => run(args, onP))));
  });

  api.post('/cull/reset', async (req, res) => {
    const b = await api.body(req);
    if (!okFolder(b.folder)) return api.fail(res, 'That folder is not there any more.');
    api.json(res, api.pub(api.job('reset', 'cull:' + b.folder, onP => run(['reset', '--folder', b.folder], onP))));
  });

  api.post('/cull/learn', async (req, res) => {
    const b = await api.body(req);
    if (!okFolder(b.folder) || !okFolder(b.finals)) return api.fail(res, 'Choose the shoot and the finals folder.');
    api.json(res, api.pub(api.job('learn', 'learn:' + b.folder, onP => run(['learn', '--folder', b.folder, '--finals', b.finals], onP))));
  });

  api.post('/cull/learn-edits', async (req, res) => {
    const b = await api.body(req);
    if (!okFolder(b.folder)) return api.fail(res, 'Choose the past shoot folder.');
    const args = ['learn-edits', '--folder', b.folder, '--biz', b.biz === 'sba' ? 'sba' : 'fom', '--job', b.job || 'all'];
    api.json(res, api.pub(api.job('learn-edits', 'learn:' + b.folder, onP => run(args, onP))));
  });

  let capsCache = null;
  api.get('/cull/caps', async (req, res) => {
    if (!capsCache || Date.now() - capsCache.t > 120e3) capsCache = { t: Date.now(), v: await run(['caps']) };
    api.json(res, capsCache.v);
  });
  api.get('/cull/stats', async (req, res) => api.json(res, await run(['stats'])));
  api.get('/cull/presets', async (req, res, q) => api.json(res, await run(['presets', '--biz', q.get('biz') === 'sba' ? 'sba' : 'fom'])));

  api.post('/cull/import-presets', async (req, res) => {
    const b = await api.body(req);
    const biz = b.biz === 'sba' ? 'sba' : 'fom';
    const files = await api.pickFiles('Choose your Lightroom presets (.xmp)', 'xmp');
    const dir = path.join(api.ROOT, 'presets', biz); fs.mkdirSync(dir, { recursive: true });
    let n = 0;
    for (const f of files) { if (/\.xmp$/i.test(f)) { fs.copyFileSync(f, path.join(dir, path.basename(f))); n++; } }
    api.json(res, Object.assign({ added: n }, await run(['presets', '--biz', biz])));
  });
  api.post('/cull/delete-preset', async (req, res) => {
    const b = await api.body(req);
    const f = path.join(api.ROOT, 'presets', b.biz === 'sba' ? 'sba' : 'fom', path.basename(String(b.name || '')));
    if (fs.existsSync(f) && /\.xmp$/i.test(f)) fs.unlinkSync(f);
    api.json(res, await run(['presets', '--biz', b.biz === 'sba' ? 'sba' : 'fom']));
  });

  /* pictures (need ?k=) */
  api.get('/cull/img', (req, res, q) => {
    const f = q.get('folder'), id = path.basename(String(q.get('id') || ''));
    if (!okFolder(f) || !id) { res.writeHead(404); return res.end(); }
    api.sendFile(res, path.join(CACHE, sid(f), q.get('s') === 'p' ? 'prev' : 'thumb', id + '.jpg'), 'image/jpeg', 'private, max-age=3600');
  });
  api.get('/cull/face', (req, res, q) => {
    const f = q.get('folder'), pid = path.basename(String(q.get('pid') || ''));
    if (!okFolder(f) || !pid) { res.writeHead(404); return res.end(); }
    api.sendFile(res, path.join(CACHE, sid(f), 'faces', pid + '.jpg'), 'image/jpeg', 'private, max-age=600');
  });

  /* finals for the one-tap handoffs: list a folder you chose, and hand the files to the page */
  function inAllowed(f) { try { const r = fs.realpathSync(f); return [...allowed].some(a => r === a || r.startsWith(a + path.sep)); } catch (e) { return false; } }
  api.get('/cull/list', (req, res, q) => {
    const f = q.get('folder');
    if (!okFolder(f) || !inAllowed(f)) return api.fail(res, 'Choose that folder first.', 403);
    const out = [];
    (function walk(d, depth) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory() && depth < 2) walk(p, depth + 1);
        else if (e.isFile() && IMG.test(e.name)) { const s = fs.statSync(p); out.push({ name: path.relative(f, p), size: s.size, t: s.mtimeMs }); }
      }
    })(f, 0);
    out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    api.json(res, { folder: f, files: out });
  });
  api.get('/cull/file', (req, res, q) => {
    const f = q.get('folder'), name = String(q.get('name') || '');
    if (!okFolder(f) || !inAllowed(f) || !IMG.test(name) || name.includes('..')) { res.writeHead(403); return res.end(); }
    const p = path.resolve(f, name);
    if (!p.startsWith(fs.realpathSync(f) + path.sep) && !p.startsWith(path.resolve(f) + path.sep)) { res.writeHead(403); return res.end(); }
    api.sendFile(res, p, api.mime(p), 'no-store');
  });

  return { title: 'Photo Cull', version: '1.0' };
};
