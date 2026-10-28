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
   CLIENT CHAT EMAILS (needs a signed-in client or admin token):
     POST /notify   body {o:"<order id>"}
       client caller -> emails you (NOTIFY_TO) their newest messages
       admin caller  -> emails the client your newest replies with a portal link
     Throttled per booking (5 min per direction) so a burst of messages sends one email.
     Needs the secret BREVO_KEY (Brevo API key). Optional variables: FROM_EMAIL, FROM_NAME,
     NOTIFY_TO, PORTAL_URL, ADMIN_URL.
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
  const u = await verifyUser(request, env);
  return u && (await isAdminUser(u, env)) ? u.pay : null;
}
async function isAdminUser(u, env) {
  try {
    const pid = env.FIREBASE_PROJECT_ID || PROJECT;
    // the Firestore rules only let a user read their own admins/<uid> doc, so a 200 proves they are an admin
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/admins/${encodeURIComponent(u.pay.sub)}`, { headers: { Authorization: 'Bearer ' + u.token } });
    return r.ok;
  } catch (e) { return false; }
}
/* any signed-in Firebase user (client or admin): returns {pay, token} when the token is genuine */
async function verifyUser(request, env) {
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
    return ok ? { pay, token } : null;
  } catch (e) { return null; }
}

/* ---- Firestore REST helpers (always called with the caller's own token, so the security rules apply) ---- */
function fsVal(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return +v.integerValue;
  if ('doubleValue' in v) return +v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsVal);
  if ('mapValue' in v) { const o = {}, f = v.mapValue.fields || {}; for (const k in f) o[k] = fsVal(f[k]); return o; }
  return null;
}
const fsObj = d => { const o = {}, f = (d && d.fields) || {}; for (const k in f) o[k] = fsVal(f[k]); return o; };
async function fsGet(env, token, path) {
  const pid = env.FIREBASE_PROJECT_ID || PROJECT;
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/${path}`, { headers: { Authorization: 'Bearer ' + token } });
  return r.ok ? r.json() : null;
}
const htmlEsc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function sendBrevo(env, to, toName, subject, html, replyTo) {
  const body = {
    sender: { name: env.FROM_NAME || 'FOM Studios', email: env.FROM_EMAIL || 'info@fomstudios.co.za' },
    to: [{ email: to, name: toName || to }], subject, htmlContent: html
  };
  if (replyTo) body.replyTo = { email: replyTo };
  const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': env.BREVO_KEY, 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
  return r.ok;
}
function chatEmail(title, intro, msgs, who, btnText, btnUrl) {
  const rows = msgs.map(m => `<tr><td style="padding:10px 14px;background:#f1f0ec;border-radius:12px;font-size:15px;line-height:1.55;color:#2a2b2c;white-space:pre-wrap">${htmlEsc(m.text)}<div style="font-size:11.5px;color:#8a8a88;margin-top:6px">${htmlEsc(who)} &middot; ${htmlEsc(new Date(m.at).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</div></td></tr><tr><td style="height:8px"></td></tr>`).join('');
  return `<div style="background:#f1f0ec;padding:24px 12px;font-family:-apple-system,Helvetica Neue,Arial,sans-serif"><table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#fafaf9;border:1px solid #dcdad3;border-radius:18px"><tr><td style="padding:26px 26px 8px">
    <div style="font-weight:800;letter-spacing:.08em;font-size:13px;color:#02367B">FOM STUDIOS</div>
    <h1 style="font-size:22px;margin:10px 0 6px;color:#2a2b2c">${htmlEsc(title)}</h1>
    <p style="font-size:14.5px;color:#6f6f6d;margin:0 0 16px;line-height:1.6">${intro}</p>
    <table role="presentation" width="100%">${rows}</table>
    <p style="margin:18px 0 24px"><a href="${htmlEsc(btnUrl)}" style="display:inline-block;background:#02367B;color:#fff;text-decoration:none;font-weight:700;font-size:14.5px;padding:13px 24px;border-radius:999px">${htmlEsc(btnText)}</a></p>
  </td></tr></table><p style="text-align:center;font-size:12px;color:#8a8a88;margin-top:14px">FOM Studios &middot; Johannesburg &middot; www.fomstudios.co.za</p></div>`;
}

/* POST /notify {o}: emails the other side about new chat messages on a booking */
const NOTIFY_GAP = 5 * 60 * 1000;
async function handleNotify(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!env.BREVO_KEY) return json({ ok: false, skipped: 'email not set up (add the BREVO_KEY secret)' });
  const u = await verifyUser(request, env);
  if (!u) return json({ error: 'not signed in' }, 401);
  let body = {}; try { body = await request.json(); } catch (e) {}
  const o = String(body.o || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
  if (!o) return json({ error: 'missing o' }, 400);
  const admin = await isAdminUser(u, env);
  // reading the order with the caller's token proves a client owns this booking
  const od = await fsGet(env, u.token, 'orders/' + o);
  if (!od) return json({ error: 'not allowed' }, 403);
  const order = fsObj(od);
  const dir = admin ? 'client' : 'fom', from = admin ? 'fom' : 'client';

  const tKey = `_notify/${o}-${dir}.json`, otherKey = `_notify/${o}-${admin ? 'fom' : 'client'}.json`;
  let last = 0;
  try { const t = await env.BUCKET.get(tKey); if (t) last = (await t.json()).at || 0; } catch (e) {}
  if (Date.now() - last < NOTIFY_GAP) return json({ ok: true, skipped: 'throttled' });

  const list = await fsGet(env, u.token, `chat/${o}/messages?orderBy=${encodeURIComponent('at desc')}&pageSize=12`);
  const msgs = ((list && list.documents) || []).map(fsObj)
    .filter(m => m.from === from && m.at && m.text && Date.parse(m.at) > last).slice(0, 6).reverse();
  if (!msgs.length) return json({ ok: true, skipped: 'nothing new' });

  const name = order.customer || 'your client', booking = [order.orderId, order.product].filter(Boolean).join(' ');
  let sent;
  if (admin) {
    if (!order.clientEmail) return json({ error: 'this booking has no client email' }, 400);
    const first = String(order.customer || '').split(' ')[0] || 'there';
    sent = await sendBrevo(env, order.clientEmail, order.customer, 'New message from FOM Studios',
      chatEmail('You have a new message', `Hi ${htmlEsc(first)}, FOM Studios replied about your booking${booking ? ' (' + htmlEsc(booking) + ')' : ''}.`, msgs, 'FOM Studios', 'Open your portal to reply', (env.PORTAL_URL || 'https://www.fomstudios.co.za/client-portal.html') + '?o=' + encodeURIComponent(o)),
      env.FROM_EMAIL || 'info@fomstudios.co.za');
  } else {
    sent = await sendBrevo(env, env.NOTIFY_TO || 'info@fomstudios.co.za', 'FOM Studios', `New message from ${name}${order.orderId ? ' (' + order.orderId + ')' : ''}`,
      chatEmail('New client message', `<b>${htmlEsc(name)}</b> sent ${msgs.length === 1 ? 'a message' : msgs.length + ' messages'} in the client portal${booking ? ' about ' + htmlEsc(booking) : ''}.`, msgs, name, 'Reply in your dashboard', (env.ADMIN_URL || 'https://fomstudios.github.io/dashboard/messages.html') + '?o=' + encodeURIComponent(o)),
      order.clientEmail || '');
  }
  if (!sent) return json({ ok: false, error: 'Brevo did not accept the email (check BREVO_KEY and that the sender address is verified in Brevo)' }, 502);
  await env.BUCKET.put(tKey, JSON.stringify({ at: Date.now() }), { httpMetadata: { contentType: 'application/json' } });
  // the other side just got a reply, so their next message should email straight away
  try { await env.BUCKET.delete(otherKey); } catch (e) {}
  return json({ ok: true, sent: msgs.length });
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
    if (g.startsWith('_notify')) return json({ error: 'not found' }, 404);   // internal email throttle records
    if (path === '/notify') return handleNotify(request, env);

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
