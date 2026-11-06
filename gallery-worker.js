/* ============================================================
   FOM STUDIOS - Gallery Worker (Cloudflare Workers + R2)
   ------------------------------------------------------------
   Powers gallery.html:
     GET  /list?g=<folder>/           -> JSON list of files in that R2 folder
     GET  /file?g=<folder>/&n=<name>  -> streams a file (add &dl=1 to force download)
     POST /meta?g=<folder>/           -> body {expiry:"yyyy-mm-dd", graceDays:7}
                                         writes <folder>/_gallery.json (drives auto-delete)
   ADMIN ONLY (needs the signed-in Firebase admin token, used by the dashboard Photos page):
     POST /admin/upload?n=<name>&f=<folder>  -> body = the image; saved as <folder>/<name> (folders: portfolio, deck, test-client, shotbya/test-client)
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
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
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
const ADMIN_FOLDERS = ['portfolio', 'deck', 'test-client', 'shotbya/test-client'];   // test-client folders: the dashboard's Test client (Database page)
const PUBLIC_FOLDERS = ['portfolio/', 'deck/'];
const adminFolder = f => ADMIN_FOLDERS.includes(f) ? f : 'portfolio';


/* ============================================================
   CLIENT ACTIVITY + PUSH NOTIFICATIONS (to your phone)
   ------------------------------------------------------------
   POST /event                 (client pages) {t:type, o:order id, n:name, b:'fom'|'sba', d:detail}
                               logs the event and pushes it to your subscribed devices
   GET  /push/key              the public key phones subscribe with (made once, kept in R2)
   POST /push/sub    (admin)   {sub, device}  save this device;  DELETE removes it
   POST /push/test   (admin)   send a test notification to every device
   POST /push/orders (admin)   {orders:{id:{n,b,o}}}  known bookings, so names come from your data
   GET  /events      (admin)   ?since=<ms>  the activity log (newest first, last 400)
   Private records live in R2 under _push/ and _events/, which /file and /list never serve.
   ============================================================ */
const EV_TYPES = {
  signed:   { once: true,  title: 'Contract signed',      body: (n, d) => n + ' signed the contract' + (d ? ' (' + d + ')' : '') + '.' },
  portal:   { once: true,  title: 'Portal sign-in',       body: (n) => n + ' signed in to the client portal for the first time.' },
  gallery:  { once: true,  title: 'Gallery opened',       body: (n) => n + ' opened their gallery.' },
  download: { gap: 3600e3, title: 'Files downloaded',     body: (n, d) => n + ' is downloading ' + (d || 'their files') + '.' },
  inspo:    { gap: 600e3,  title: 'Inspiration added',    body: (n, d) => n + ' added ' + (d || 'some') + ' inspiration to their mood board.' },
  favs:     { gap: 1800e3, title: 'Favourites picked',    body: (n, d) => n + ' picked ' + (d || 'their') + ' favourites.' },
  review:   { gap: 60e3,   title: 'New review',           body: (n, d) => n + ' left a review' + (d ? ': ' + d : '') + '.' },
  paid:     { gap: 300e3,  title: 'Card payment',         body: (n, d) => n + ' paid ' + (d || 'by card') + ' (check Yoco to confirm).' },
  meeting:  { gap: 30e3,   title: 'Meeting request',      body: (n, d) => n + ' asked to meet' + (d ? ': ' + d : '') + '.', url: 'bookings.html' }   // Book a meeting page on either website
};
const R2J = async (env, key, def) => { try { const o = await env.BUCKET.get(key); return o ? await o.json() : def; } catch (e) { return def; } };
const R2P = (env, key, val) => env.BUCKET.put(key, JSON.stringify(val), { httpMetadata: { contentType: 'application/json' } });
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const cat = (...a) => { const n = a.reduce((s, x) => s + x.length, 0), o = new Uint8Array(n); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const te = new TextEncoder();

async function vapid(env) {
  let v = await R2J(env, '_push/vapid.json', null);
  if (v && v.pub && v.jwk) return v;
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  v = { jwk: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: b64url(await crypto.subtle.exportKey('raw', kp.publicKey)) };
  await R2P(env, '_push/vapid.json', v);
  return v;
}
async function vapidHeader(env, endpoint) {
  const v = await vapid(env), aud = new URL(endpoint).origin;
  const head = b64url(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64url(te.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:' + (env.FROM_EMAIL || 'info@fomstudios.co.za') })));
  const key = await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(head + '.' + body));
  return 'vapid t=' + head + '.' + body + '.' + b64url(sig) + ', k=' + v.pub;
}
/* RFC 8291 message encryption (aes128gcm) */
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
async function encryptPush(sub, payload) {
  const ua = b64u(sub.keys.p256dh), auth = b64u(sub.keys.auth);
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(auth, secret, cat(te.encode('WebPush: info\0'), ua, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, cat(te.encode(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);   // record size 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}
async function sendPush(env, sub, msg) {
  const body = await encryptPush(sub, JSON.stringify(msg));
  return fetch(sub.endpoint, { method: 'POST', body, headers: {
    Authorization: await vapidHeader(env, sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' } });
}
async function pushAll(env, msg) {
  const subs = await R2J(env, '_push/subs.json', []);
  if (!subs.length) return { sent: 0, devices: 0 };
  let sent = 0; const keep = [];
  for (const s of subs) {
    try {
      const r = await sendPush(env, s.sub, msg);
      if (r.status === 404 || r.status === 410) continue;   // that phone unsubscribed: forget it
      if (r.ok) sent++;
      keep.push(s);
    } catch (e) { keep.push(s); }
  }
  if (keep.length !== subs.length) await R2P(env, '_push/subs.json', keep);
  return { sent, devices: keep.length };
}
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n || 80);

async function handlePush(path, request, env) {
  if (path === '/push/key') return json({ key: (await vapid(env)).pub });
  if (!(await verifyAdmin(request, env))) return json({ error: 'not allowed' }, 401);
  let body = {}; try { body = await request.json(); } catch (e) {}
  if (path === '/push/sub') {
    let subs = await R2J(env, '_push/subs.json', []);
    if (request.method === 'DELETE') { subs = subs.filter(s => s.sub.endpoint !== body.endpoint); await R2P(env, '_push/subs.json', subs); return json({ ok: true }); }
    const sub = body.sub;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return json({ error: 'bad subscription' }, 400);
    subs = subs.filter(s => s.sub.endpoint !== sub.endpoint);
    subs.push({ sub, device: clean(body.device, 30), at: Date.now() });
    await R2P(env, '_push/subs.json', subs.slice(-12));
    return json({ ok: true, devices: subs.length });
  }
  if (path === '/push/test') {
    const r = await pushAll(env, { title: 'Notifications are on', body: 'You will hear from FOM Studios and Shot by A clients here.', url: 'dashboard.html', tag: 'fom-test' });
    return json({ ok: r.sent > 0, ...r });
  }
  if (path === '/push/orders') {
    const src = (body && body.orders) || {}, out = {};
    Object.keys(src).slice(0, 3000).forEach(id => { const o = src[id] || {}; out[clean(id, 60)] = { n: clean(o.n, 60), b: o.b === 'sba' ? 'sba' : 'fom', o: clean(o.o, 30) }; });
    await R2P(env, '_push/orders.json', out);
    return json({ ok: true, count: Object.keys(out).length });
  }
  return json({ error: 'not found' }, 404);
}

async function handleEvent(request, env, ctx) {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  let b = {}; try { b = JSON.parse(await request.text()); } catch (e) { return json({ error: 'bad body' }, 400); }
  const type = clean(b.t, 12), def = EV_TYPES[type];
  if (!def) return json({ error: 'unknown event' }, 400);
  const o = clean(b.o, 60).replace(/[^A-Za-z0-9_-]/g, '');
  const known = o ? (await R2J(env, '_push/orders.json', {}))[o] : null;
  const name = (known && known.n) || clean(b.n, 60) || 'A client';
  const biz = known ? known.b : (b.b === 'sba' ? 'sba' : 'fom');
  const detail = clean(b.d, 120);
  const now = Date.now();
  // once-only and throttled events (per booking, or per name when there is no booking)
  const marks = await R2J(env, '_events/marks.json', {});
  const mk = type + ':' + (o || name.toLowerCase());
  if (def.once && marks[mk]) return json({ ok: true, skipped: 'already' });
  if (def.gap && marks[mk] && now - marks[mk] < def.gap) return json({ ok: true, skipped: 'throttled' });
  // bookings we do not know yet: cap so the link cannot be used to spam you
  if (!known) { const k = 'unknown:' + Math.floor(now / 3600e3); marks[k] = (marks[k] || 0) + 1; if (marks[k] > 30) return json({ ok: true, skipped: 'busy' }); }
  marks[mk] = now;
  Object.keys(marks).forEach(k => { if (k.startsWith('unknown:') && +k.split(':')[1] < Math.floor(now / 3600e3) - 2) delete marks[k]; });
  await R2P(env, '_events/marks.json', marks);
  const ev = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), t: type, o, n: name, b: biz, d: detail, at: now, known: !!known };
  const log = await R2J(env, '_events/log.json', []);
  log.unshift(ev); await R2P(env, '_events/log.json', log.slice(0, 400));
  const label = biz === 'sba' ? 'Shot by A: ' : '';
  const msg = { title: label + def.title, body: def.body(name, detail), url: def.url ? def.url + '?biz=' + biz : 'dashboard.html#activity', tag: 'fom-' + type + '-' + (o || name) };
  if (ctx && ctx.waitUntil) ctx.waitUntil(pushAll(env, msg)); else await pushAll(env, msg);
  return json({ ok: true });
}
async function handleEvents(request, env, url) {
  if (!(await verifyAdmin(request, env))) return json({ error: 'not allowed' }, 401);
  const since = +url.searchParams.get('since') || 0;
  const log = await R2J(env, '_events/log.json', []);
  const subs = await R2J(env, '_push/subs.json', []);
  return json({ events: log.filter(e => e.at > since), devices: subs.map(s => ({ device: s.device, at: s.at, endpoint: s.sub.endpoint })) });
}

const normPrefix = g => { g = (g || '').replace(/^\/+/, ''); if (g && !g.endsWith('/')) g += '/'; return g; };

/* ============================================================
   CLIENT INSPIRATION ON A MOOD BOARD LINK (no login)
   POST /mood/upload?s=<link id>   body: a JPEG the page already resized  -> { ok, url, name }
   POST /mood/delete?s=<link id>&n=<name>                                  -> { ok }
   Only works while that mood board link exists and has not expired (checked against the public
   Firestore moodShare doc). Files live in R2 under mood-client/<link id>/, at most 30 per link,
   and stay after the link ends so the meeting's inspo keeps its pictures.
   ============================================================ */
const MOOD_MAX = 30, MOOD_BYTES = 6 * 1024 * 1024;
async function moodShareLive(env, id) {
  try {
    const pid = env.FIREBASE_PROJECT_ID || PROJECT;
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/moodShare/${encodeURIComponent(id)}`);
    if (!r.ok) return false;                                  // missing, turned off or expired (the rules refuse expired links)
    const exp = ((await r.json()).fields || {}).expiresAt;
    return !exp || !exp.timestampValue || Date.parse(exp.timestampValue) > Date.now();
  } catch (e) { return false; }
}
async function handleMoodClient(path, request, env, url) {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  const id = String(url.searchParams.get('s') || '');
  if (!/^[A-Za-z0-9]{12,40}$/.test(id)) return json({ error: 'bad link' }, 400);
  if (!(await moodShareLive(env, id))) return json({ error: 'This mood board link has ended.' }, 403);
  const prefix = 'mood-client/' + id + '/';
  if (path === '/mood/delete') {
    const n = safeName(url.searchParams.get('n'));
    if (!n) return json({ error: 'missing n' }, 400);
    await env.BUCKET.delete(prefix + n);
    return json({ ok: true });
  }
  const type = (request.headers.get('Content-Type') || '').split(';')[0];
  if (!/^image\/(jpeg|png|webp)$/.test(type)) return json({ error: 'pictures only' }, 400);
  if (Number(request.headers.get('Content-Length') || 0) > MOOD_BYTES) return json({ error: 'picture too large' }, 413);
  const have = await env.BUCKET.list({ prefix, limit: MOOD_MAX + 1 });
  if (have.objects.length >= MOOD_MAX) return json({ error: 'You can add up to ' + MOOD_MAX + ' pictures.' }, 429);
  const buf = await request.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > MOOD_BYTES) return json({ error: 'bad file size' }, 413);
  const n = Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + (type === 'image/png' ? '.png' : type === 'image/webp' ? '.webp' : '.jpg');
  await env.BUCKET.put(prefix + n, buf, { httpMetadata: { contentType: type } });
  return json({ ok: true, name: n, url: `${url.origin}/file?g=${encodeURIComponent(prefix)}&n=${encodeURIComponent(n)}` });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (!env.BUCKET) return json({ error: 'R2 bucket not bound (name it BUCKET).' }, 500);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const g = normPrefix(url.searchParams.get('g'));
    if (/^_(notify|push|events)\//.test(g)) return json({ error: 'not found' }, 404);   // private records (email throttle, push keys, activity log)
    if (path === '/event') return handleEvent(request, env, ctx);
    if (path === '/events') return handleEvents(request, env, url);
    if (path.startsWith('/push/')) return handlePush(path, request, env);
    if (path === '/notify') return handleNotify(request, env);
    if (path === '/mood/upload' || path === '/mood/delete') return handleMoodClient(path, request, env, url);

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
      // Video players fetch big files in pieces (Range requests). Every piece must say exactly
      // which bytes it holds, or the player stalls (this was the "big MP4 gets stuck" bug).
      const range = request.headers.get('range');
      let want = range ? parseRange(range) : null;
      if (want && !('offset' in want) && !('suffix' in want)) want = null;
      if (want) {
        const head = await env.BUCKET.head(key);
        if (!head) return json({ error: 'not found' }, 404);
        want = fitRange(want, head.size);
        if (!want) return new Response(null, { status: 416, headers: { ...cors, 'Content-Range': `bytes */${head.size}` } });
      }
      const obj = want ? await env.BUCKET.get(key, { range: want }) : await env.BUCKET.get(key);
      if (!obj) return json({ error: 'not found' }, 404);

      const h = new Headers(cors);
      obj.writeHttpMetadata(h);
      h.set('etag', obj.httpEtag);
      h.set('Accept-Ranges', 'bytes');
      h.set('Cache-Control', PUBLIC_FOLDERS.includes(g) ? 'public, max-age=86400' : 'private, max-age=3600');
      if (url.searchParams.get('dl') === '1') h.set('Content-Disposition', `attachment; filename="${n.replace(/"/g, '')}"`);
      if (want) {
        h.set('Content-Range', `bytes ${want.offset}-${want.offset + want.length - 1}/${obj.size}`);
        h.set('Content-Length', String(want.length));
        return new Response(obj.body, { status: 206, headers: h });
      }
      h.set('Content-Length', String(obj.size));
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
        return json({ ok: true, name: n, folder: adminFolder(url.searchParams.get('f')) });
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

// Turn any range (start-end, start-, or last N bytes) into an exact { offset, length } inside the file.
function fitRange(r, size) {
  if (!size) return null;
  let offset, length;
  if ('suffix' in r) { length = Math.min(r.suffix, size); offset = size - length; }
  else { offset = r.offset; if (offset >= size) return null; length = 'length' in r ? Math.min(r.length, size - offset) : size - offset; }
  return length > 0 ? { offset, length } : null;
}
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
