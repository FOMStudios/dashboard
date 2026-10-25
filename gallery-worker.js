/* ============================================================
   FOM STUDIOS - Gallery Worker (Cloudflare Workers + R2)
   ------------------------------------------------------------
   Powers gallery.html:
     GET  /list?g=<folder>/           -> JSON list of files in that R2 folder
     GET  /file?g=<folder>/&n=<name>  -> streams a file (add &dl=1 to force download)
     POST /meta?g=<folder>/           -> body {expiry:"yyyy-mm-dd", graceDays:7}
                                         writes <folder>/_gallery.json (drives auto-delete)
   ADMIN ONLY (needs the signed-in Firebase admin token, used by the dashboard Photos page):
     POST /admin/upload?n=<name>&f=<folder>  -> body = the image; saved as <folder>/<name>
     POST /admin/delete               -> body {n:"<name>", f:"<folder>"}; removes <folder>/<name>
     <folder> is "portfolio" (website photos, the default) or "deck" (pitch deck images).
   Portfolio and deck images are public: GET /file?g=portfolio/&n=<name>  or  g=deck/
   Scheduled (Cron) run: deletes any folder whose expiry + graceDays has passed.

   SETUP
   1. Create an R2 bucket (your deliverables bucket) and note its name.
   2. Deploy this as a Worker. In the Worker settings bind the bucket:
        Settings -> Variables -> R2 Bucket Bindings -> name it  BUCKET  -> pick your bucket.
   3. Add a Cron Trigger (Settings -> Triggers -> Cron):  0 3 * * *   (daily 03:00 UTC).
   4. Put the Worker URL into gallery.html  CONFIG.worker.
   5. (Optional, recommended) tighten CORS ALLOW_ORIGIN to your site only.

   NOTE ON ACCESS: this version serves any folder by name. Folder names should be
   unguessable (e.g. include a random suffix). For strict per-client security we can
   later verify the client's Firebase login token here before serving.
   ============================================================ */

const ALLOW_ORIGIN = '*';                 // set to 'https://www.fomstudios.co.za' to lock down
const VIDEO = ['mp4','webm','m4v','ogg','mov','avi','mkv'];
const IMAGE = ['jpg','jpeg','png','webp','gif','avif','bmp','heic'];
const ext   = n => (n.split('.').pop() || '').toLowerCase();
const kind  = n => VIDEO.includes(ext(n)) ? 'video' : IMAGE.includes(ext(n)) ? 'image' : 'file';
const cors  = {
  'Access-Control-Allow-Origin': ALLOW_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });

/* ---- admin check: verify the Firebase login token, then confirm the user is in the admins collection ---- */
const PROJECT = 'fom-studios';
let jwks = { at: 0, keys: null };
const b64u = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
async function firebaseKeys() {
  if (jwks.keys && Date.now() - jwks.at < 3600000) return jwks.keys;
  const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  jwks = { at: Date.now(), keys: (await r.json()).keys || [] };
  return jwks.keys;
}
async function verifyAdmin(request, env) {
  try {
    const m = /^Bearer (.+)$/.exec(request.headers.get('Authorization') || '');
    if (!m) return null;
    const token = m[1], parts = token.split('.');
    if (parts.length !== 3) return null;
    const dec = new TextDecoder();
    const head = JSON.parse(dec.decode(b64u(parts[0]))), pay = JSON.parse(dec.decode(b64u(parts[1])));
    const pid = env.FIREBASE_PROJECT_ID || PROJECT, now = Math.floor(Date.now() / 1000);
    if (head.alg !== 'RS256' || pay.aud !== pid || pay.iss !== 'https://securetoken.google.com/' + pid) return null;
    if (!pay.sub || !pay.exp || pay.exp < now || (pay.iat || 0) > now + 300) return null;
    const jwk = (await firebaseKeys()).find(k => k.kid === head.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    if (!ok) return null;
    // the Firestore rules only let a user read their own admins/<uid> doc, so a 200 proves they are an admin
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/admins/${encodeURIComponent(pay.sub)}`, { headers: { Authorization: 'Bearer ' + token } });
    return r.ok ? pay : null;
  } catch (e) { return null; }
}
const safeName = n => String(n || '').toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^[.-]+/, '').slice(0, 80);
const MAX_UPLOAD = 15 * 1024 * 1024;
const ADMIN_FOLDERS = ['portfolio', 'deck'];
const PUBLIC_FOLDERS = ['portfolio/', 'deck/'];
const adminFolder = f => ADMIN_FOLDERS.includes(f) ? f : 'portfolio';

const normPrefix = g => { g = (g || '').replace(/^\/+/, ''); if (g && !g.endsWith('/')) g += '/'; return g; };

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (!env.BUCKET) return json({ error: 'R2 bucket not bound (name it BUCKET).' }, 500);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const g = normPrefix(url.searchParams.get('g'));

    // ---- list files in a folder ----
    if (path === '/list') {
      if (!g) return json({ error: 'missing g' }, 400);
      const out = [];
      let cursor;
      do {
        const r = await env.BUCKET.list({ prefix: g, cursor, limit: 1000 });
        for (const o of r.objects) {
          const name = o.key.slice(g.length);
          if (!name || name.endsWith('/') || name === '_gallery.json') continue;  // skip folder markers + manifest
          out.push({
            name,
            size: o.size,
            kind: kind(name),
            url: `${url.origin}/file?g=${encodeURIComponent(g)}&n=${encodeURIComponent(name)}`
          });
        }
        cursor = r.truncated ? r.cursor : undefined;
      } while (cursor);
      out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      return json({ files: out });
    }

    // ---- stream a single file (preview or download) ----
    if (path === '/file') {
      const n = url.searchParams.get('n');
      if (!g || !n) return json({ error: 'missing g or n' }, 400);
      const key = g + n;
      const range = request.headers.get('range');
      const obj = range
        ? await env.BUCKET.get(key, { range: parseRange(range) })
        : await env.BUCKET.get(key);
      if (!obj) return json({ error: 'not found' }, 404);

      const h = new Headers(cors);
      obj.writeHttpMetadata(h);
      h.set('etag', obj.httpEtag);
      h.set('Accept-Ranges', 'bytes');
      h.set('Cache-Control', PUBLIC_FOLDERS.includes(g) ? 'public, max-age=86400' : 'private, max-age=3600');
      if (url.searchParams.get('dl') === '1') h.set('Content-Disposition', `attachment; filename="${n.replace(/"/g, '')}"`);
      if (range && obj.range) {
        const end = obj.range.offset + obj.range.length - 1;
        h.set('Content-Range', `bytes ${obj.range.offset}-${end}/${obj.size}`);
        return new Response(obj.body, { status: 206, headers: h });
      }
      return new Response(obj.body, { headers: h });
    }

    // ---- admin: upload / delete portfolio photos and pitch deck images ----
    if (path === '/admin/upload' || path === '/admin/delete') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      if (!(await verifyAdmin(request, env))) return json({ error: 'not allowed' }, 401);
      if (path === '/admin/upload') {
        const n = safeName(url.searchParams.get('n'));
        const type = (request.headers.get('Content-Type') || '').split(';')[0];
        if (!n || !/^image\//.test(type)) return json({ error: 'need a name and an image' }, 400);
        const len = Number(request.headers.get('Content-Length') || 0);
        if (len > MAX_UPLOAD) return json({ error: 'file too large (15 MB max)' }, 413);
        const buf = await request.arrayBuffer();
        if (buf.byteLength > MAX_UPLOAD || !buf.byteLength) return json({ error: 'bad file size' }, 413);
        await env.BUCKET.put(adminFolder(url.searchParams.get('f')) + '/' + n, buf, { httpMetadata: { contentType: type } });
        return json({ ok: true, name: n });
      }
      let body = {}; try { body = await request.json(); } catch (e) {}
      const n = safeName(body.n);
      if (!n) return json({ error: 'missing n' }, 400);
      await env.BUCKET.delete(adminFolder(body.f || url.searchParams.get('f')) + '/' + n);
      return json({ ok: true });
    }

    // ---- write/update a folder's expiry manifest (called by the admin Database) ----
    if (path === '/meta' && request.method === 'POST') {
      if (!g) return json({ error: 'missing g' }, 400);
      let body = {};
      try { body = await request.json(); } catch (e) {}
      const meta = { expiry: body.expiry || '', graceDays: Number(body.graceDays ?? 7), updated: new Date().toISOString() };
      await env.BUCKET.put(g + '_gallery.json', JSON.stringify(meta), { httpMetadata: { contentType: 'application/json' } });
      return json({ ok: true, meta });
    }

    return json({ error: 'not found' }, 404);
  },

  // ---- Cron: auto-delete folders past expiry + grace ----
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      if (!env.BUCKET) return;
      const now = Date.now();
      // find every _gallery.json manifest
      let cursor;
      const manifests = [];
      do {
        const r = await env.BUCKET.list({ cursor, limit: 1000 });
        for (const o of r.objects) if (o.key.endsWith('_gallery.json')) manifests.push(o.key);
        cursor = r.truncated ? r.cursor : undefined;
      } while (cursor);

      for (const mkey of manifests) {
        const prefix = mkey.slice(0, -('_gallery.json'.length));   // folder of this manifest
        let meta;
        try { meta = await (await env.BUCKET.get(mkey)).json(); } catch (e) { continue; }
        if (!meta || !meta.expiry) continue;
        const cutoff = new Date(meta.expiry + 'T23:59:59').getTime() + (Number(meta.graceDays || 7) * 86400000);
        if (now <= cutoff) continue;                                // not past grace yet

        // delete every object under this folder (in batches)
        let c2, keys = [];
        do {
          const r = await env.BUCKET.list({ prefix, cursor: c2, limit: 1000 });
          keys.push(...r.objects.map(o => o.key));
          c2 = r.truncated ? r.cursor : undefined;
        } while (c2);
        for (let i = 0; i < keys.length; i += 100) await env.BUCKET.delete(keys.slice(i, i + 100));
      }
    })());
  }
};

function parseRange(h) {
  const m = /bytes=(\d*)-(\d*)/.exec(h || '');
  if (!m) return {};
  const start = m[1] ? Number(m[1]) : undefined;
  const end = m[2] ? Number(m[2]) : undefined;
  if (start !== undefined && end !== undefined) return { offset: start, length: end - start + 1 };
  if (start !== undefined) return { offset: start };
  if (end !== undefined) return { suffix: end };
  return {};
}
