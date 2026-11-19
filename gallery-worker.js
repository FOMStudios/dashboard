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
  enquiry:  { gap: 30e3,   title: 'New enquiry',          body: (n, d) => n + ' sent an enquiry' + (d ? ': ' + d : '') + '.', url: 'leads.html' },   // Book a shoot form on the FOM website
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
  // Book a shoot form: also email you the whole enquiry (needs the BREVO_KEY secret; NOTIFY_TO changes the address)
  if (type === 'enquiry' && env.BREVO_KEY) {
    const job = sendEnquiryEmail(env, name, detail, clean(b.x, 1500), clean(b.p, 20), clean(b.e, 100)).catch(() => false);
    if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job;
  }
  return json({ ok: true });
}
async function sendEnquiryEmail(env, name, detail, text, phone, email) {
  const intl = String(phone || '').replace(/\D/g, '').replace(/^0/, '27');
  const first = String(name || '').split(' ')[0] || 'there';
  const wa = intl.length >= 11 ? 'https://wa.me/' + intl + '?text=' + encodeURIComponent('Hi ' + first + ', thanks for your enquiry with FOM Studios! ') : '';
  const admin = (env.ADMIN_URL || 'https://fomstudios.github.io/dashboard/') .replace(/[^/]*$/, '') + 'leads.html?biz=fom';
  const btn = (href, label, dark) => `<a href="${htmlEsc(href)}" style="display:inline-block;background:${dark ? '#02367B' : '#25D366'};color:#fff;text-decoration:none;font-weight:700;font-size:14.5px;padding:13px 22px;border-radius:999px;margin:0 8px 8px 0">${htmlEsc(label)}</a>`;
  const html = `<div style="background:#f1f0ec;padding:24px 12px;font-family:-apple-system,Helvetica Neue,Arial,sans-serif"><table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#fafaf9;border:1px solid #dcdad3;border-radius:18px"><tr><td style="padding:26px 26px 18px">
    <div style="font-weight:800;letter-spacing:.08em;font-size:13px;color:#02367B">FOM STUDIOS</div>
    <h1 style="font-size:22px;margin:10px 0 6px;color:#2a2b2c">New enquiry from ${htmlEsc(name)}</h1>
    <p style="font-size:14.5px;color:#6f6f6d;margin:0 0 16px;line-height:1.6">Sent from the Book a shoot form on your website${detail ? ': ' + htmlEsc(detail) : ''}.</p>
    <div style="padding:14px 16px;background:#f1f0ec;border-radius:12px;font-size:15px;line-height:1.6;color:#2a2b2c;white-space:pre-wrap">${htmlEsc(text || detail || '')}</div>
    <p style="margin:18px 0 6px">${wa ? btn(wa, 'Reply on WhatsApp') : ''}${btn(admin, 'Open Leads', true)}</p>
    <p style="font-size:12.5px;color:#8a8a88;margin:6px 0 0">${email ? 'Reply to this email to answer ' + htmlEsc(first) + ' directly. ' : ''}It is also on your Leads page as a New enquiry.</p>
  </td></tr></table></div>`;
  return sendBrevo(env, env.NOTIFY_TO || 'info@fomstudios.co.za', 'FOM Studios', 'New enquiry: ' + name + (detail ? ', ' + detail : ''), html, email || '');
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


/* ============================================================
   PHOTO SALES (event photos people buy, Nov 2026)
   ------------------------------------------------------------
   R2 layout:
     sales/index.json                public list of events
     sales/<ev>/event.json           public: title, date, place, prices, photos [{n, nums, w, h}]
     sales/<ev>/t/<n>, p/<n>         public watermarked thumbnail (480px) and preview (1400px)
     _sales/<ev>/<n>                 private full-size photo (never served by /file or /list)
     _sales/orders/<o>.json          private orders
     _sales/webhook.json             private Yoco webhook id and signing secret
   Public:  GET /sales/events, GET /sales/event?ev=, POST /sales/checkout,
            GET /sales/order?o=&k=, GET /sales/dl?o=&k=&n=, POST /sales/yoco (Yoco webhook)
   Admin:   POST /sales/admin/upload?ev=&n=&v=t|p|f, POST /sales/admin/save, POST /sales/admin/delete,
            GET /sales/admin/orders?ev=, POST /sales/admin/paid, GET|POST /sales/admin/setup
   Needs the secret YOCO_SECRET_KEY (the same sk_live key as the fom-yoco Worker).
   ============================================================ */
const SALES_SITE = 'https://www.fomstudios.co.za/photos.html';
const SALE_DAYS = 60;                                       // download links work for 60 days
const evId = v => String(v || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
const rnd = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => (b % 36).toString(36)).join('');
async function r2json(env, key) { const o = await env.BUCKET.get(key); if (!o) return null; try { return JSON.parse(await o.text()); } catch (e) { return null; } }
const r2put = (env, key, v) => env.BUCKET.put(key, JSON.stringify(v), { httpMetadata: { contentType: 'application/json' } });
function salePrice(ev, items, num) {
  const photo = Math.max(0, +ev.prices?.photo || 0), bundle = Math.max(0, +ev.prices?.bundle || 0);
  if (num && bundle) return { amount: bundle, label: 'All photos of #' + num };
  const per = items.length * photo;
  return { amount: bundle && per > bundle ? bundle : per, label: items.length + ' photo' + (items.length === 1 ? '' : 's') };
}
async function yocoWebhookSecret(env) { const w = await r2json(env, '_sales/webhook.json'); return w && w.secret; }
async function verifyYoco(request, body, env) {
  const secret = await yocoWebhookSecret(env); if (!secret) return false;
  const id = request.headers.get('webhook-id'), ts = request.headers.get('webhook-timestamp'), sig = request.headers.get('webhook-signature') || '';
  if (!id || !ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const raw = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(id + '.' + ts + '.' + body)));
  const want = btoa(String.fromCharCode(...mac));
  return sig.split(' ').some(p => p.split(',')[1] === want);
}
async function markPaid(env, o, how) {
  if (o.status === 'paid') return o;
  o.status = 'paid'; o.paidAt = new Date().toISOString(); o.paidBy = how; if (o.type === 'print' && (o.prints || []).length) o.stage = 'new';
  await r2put(env, '_sales/orders/' + o.o + '.json', o);
  const link = SALES_SITE + '?ev=' + o.ev + '&o=' + o.o + '&k=' + o.k;
  await pushAll(env, { title: (o.type === 'print' ? 'Print order R' : 'Photo sale R') + o.amount, body: (o.buyer?.name || 'Someone') + ' bought ' + o.label + (o.type === 'print' ? '' : ' from ' + (o.evTitle || o.ev)) + '.', url: 'sales.html?ev=' + o.ev, tag: 'fom-sale-' + o.o }).catch(() => null);
  if (env.BREVO_KEY && o.buyer?.email) {
    const html = o.type === 'print' ? `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#2a2b2c"><h2 style="margin:0 0 10px">Thank you for your order 🖼</h2><p>Hi ${htmlEsc((o.buyer.name || '').split(' ')[0] || 'there')}, we have your order for ${htmlEsc(o.label)} (R${o.amount}).</p>${(o.prints || []).length ? `<p>Your print${o.prints.length === 1 ? ' is' : 's are'} now being made. We will WhatsApp you when ${o.prints.length === 1 ? 'it is' : 'they are'} ready${o.delivery && o.delivery.id !== 'collect' ? ' and on the way' : ' to collect'}.</p>` : ''}${(o.dig || []).length ? `<p><a href="${link}" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:700">Download your digital photos</a></p>` : `<p><a href="${link}">See your order</a></p>`}<p>FOM Studios</p></div>`
      : `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#2a2b2c"><h2 style="margin:0 0 10px">Your photos are ready 📸</h2><p>Hi ${htmlEsc((o.buyer.name || '').split(' ')[0] || 'there')}, thank you for buying ${htmlEsc(o.label)} from ${htmlEsc(o.evTitle || 'FOM Studios')}.</p><p><a href="${link}" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:700">Download your photos</a></p><p style="font-size:13px;color:#6f6f6d">The link works for ${SALE_DAYS} days. Tag @fom_studios_ when you post them!</p><p>FOM Studios</p></div>`;
    await sendBrevo(env, o.buyer.email, o.buyer.name || '', o.type === 'print' ? 'Your FOM Studios order' : 'Your photos from ' + (o.evTitle || 'FOM Studios'), html).catch(() => null);
  }
  return o;
}
async function handleSales(path, request, env, url) {
  const B = env.BUCKET;
  // ---------- public ----------
  if (path === '/sales/events') {
    const idx = (await r2json(env, 'sales/index.json')) || { events: [] };
    return json({ events: (idx.events || []).filter(e => e.on && !e.shop) });
  }
  if (path === '/sales/event') {
    const ev = await r2json(env, 'sales/' + evId(url.searchParams.get('ev')) + '/event.json');
    if (!ev || (!ev.on && url.searchParams.get('preview') !== '1')) return json({ error: 'not found' }, 404);
    return json(ev);
  }
  if (path === '/sales/checkout' && request.method === 'POST') {
    let b = {}; try { b = await request.json(); } catch (e) {}
    const ev = await r2json(env, 'sales/' + evId(b.ev) + '/event.json');
    if (!ev || !ev.on) return json({ error: 'This event is not on sale.' }, 404);
    if (!env.YOCO_SECRET_KEY) return json({ error: 'Card payments are not set up yet. Please WhatsApp us to buy.' }, 503);
    const all = new Map((ev.photos || []).map(p => [p.n, p]));
    let num = String(b.num || '').trim().toUpperCase().slice(0, 12), items;
    if (num) { items = (ev.photos || []).filter(p => (p.nums || []).map(x => String(x).toUpperCase()).includes(num)).map(p => p.n); if (!items.length) return json({ error: 'No photos with that number.' }, 400); }
    else { items = [...new Set((b.items || []).map(String))].filter(n => all.has(n)).slice(0, 200); num = ''; }
    if (!items.length) return json({ error: 'Pick at least one photo.' }, 400);
    const price = salePrice(ev, items, num);
    if (price.amount < 2) return json({ error: 'This event has no price set yet.' }, 400);
    const buyer = { name: String(b.buyer?.name || '').slice(0, 60), email: String(b.buyer?.email || '').slice(0, 80), phone: String(b.buyer?.phone || '').slice(0, 20) };
    if (!buyer.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyer.email)) return json({ error: 'Add your name and email so we can send your photos.' }, 400);
    const o = { o: Date.now().toString(36) + rnd(4), k: rnd(16), ev: ev.id, evTitle: ev.title, items, num, label: price.label, amount: price.amount, status: 'pending', created: new Date().toISOString(), buyer };
    const back = SALES_SITE + '?ev=' + ev.id;
    const r = await fetch('https://payments.yoco.com/api/checkouts', { method: 'POST', headers: { Authorization: 'Bearer ' + env.YOCO_SECRET_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ amount: Math.round(price.amount * 100), currency: 'ZAR', successUrl: back + '&o=' + o.o + '&k=' + o.k, cancelUrl: back, failureUrl: back, metadata: { sale: o.o, event: ev.id, kind: 'photos' } }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.redirectUrl) return json({ error: (d && d.message) || 'Could not start the payment. Please try again.' }, 502);
    o.checkoutId = d.id; await r2put(env, '_sales/orders/' + o.o + '.json', o);
    return json({ redirectUrl: d.redirectUrl, o: o.o });
  }
  if (path === '/sales/order' || path === '/sales/dl') {
    const o = await r2json(env, '_sales/orders/' + safeName(url.searchParams.get('o')) + '.json');
    if (!o || o.k !== url.searchParams.get('k')) return json({ error: 'not found' }, 404);
    const expired = o.paidAt && Date.now() - Date.parse(o.paidAt) > SALE_DAYS * 864e5;
    const dig = o.dig || (o.items || []).map(n => ({ ev: o.ev, n }));   // digital files in this order
    if (path === '/sales/order') {
      const out = { type: o.type || 'photos', status: expired ? 'expired' : o.status, label: o.label, amount: o.amount, ev: o.ev, evTitle: o.evTitle, count: dig.length, stage: o.stage || '', prints: o.prints ? o.prints.map(p => ({ label: p.label, qty: p.qty, thumb: p.thumb })) : undefined, delivery: o.delivery ? o.delivery.label : undefined };
      if (o.status === 'paid' && !expired) out.items = dig.map((d, i) => ({ n: d.n, thumb: `${url.origin}/file?g=${encodeURIComponent('sales/' + d.ev + '/t/')}&n=${encodeURIComponent(d.n)}`, url: `${url.origin}/sales/dl?o=${o.o}&k=${o.k}&i=${i}` }));
      return json(out);
    }
    let d = null; const i = url.searchParams.get('i');
    if (i != null) d = dig[+i]; else { const n0 = url.searchParams.get('n'); d = dig.find(x => x.n === n0); }
    if (o.status !== 'paid' || expired || !d) return json({ error: 'not available' }, 403);
    const n = d.n;
    const f = await B.get('_sales/' + d.ev + '/' + n); if (!f) return json({ error: 'not found' }, 404);
    const h = new Headers(cors); f.writeHttpMetadata(h); h.set('Cache-Control', 'private, max-age=3600');
    h.set('Content-Disposition', `attachment; filename="FOM-${d.ev}-${n.replace(/"/g, '')}"`);
    return new Response(f.body, { headers: h });
  }
  if (path === '/sales/yoco' && request.method === 'POST') {
    const body = await request.text();
    if (!(await verifyYoco(request, body, env))) return json({ error: 'bad signature' }, 401);
    let e = {}; try { e = JSON.parse(body); } catch (x) {}
    if ((e.type || e.event_type) === 'payment.succeeded') {
      const sale = e.payload?.metadata?.sale;
      if (sale) { const o = await r2json(env, '_sales/orders/' + safeName(sale) + '.json'); if (o && Math.round(o.amount * 100) <= (e.payload.amount || 0)) await markPaid(env, o, 'card'); }
    }
    return json({ ok: true });
  }
  if (path === '/sales/shop') {   // print sizes, frames, prices and delivery (public)
    const cfg = (await r2json(env, 'shop/config.json')) || {};
    const shop = await r2json(env, 'sales/shop/event.json');
    return json({ cfg, shop: shop && shop.on ? shop : null });
  }
  if (path === '/sales/print-checkout' && request.method === 'POST') {
    let b = {}; try { b = await request.json(); } catch (e) {}
    if (!env.YOCO_SECRET_KEY) return json({ error: 'Card payments are not set up yet. Please WhatsApp us to order.' }, 503);
    const cfg = (await r2json(env, 'shop/config.json')) || {}, evs = {};
    const ev = async id => (evs[id] = evs[id] !== undefined ? evs[id] : await r2json(env, 'sales/' + evId(id) + '/event.json'));
    const prints = [], dig = []; let total = 0, nPrint = 0;
    for (const it of (b.items || []).slice(0, 30)) {
      let thumb = '', src, title = '';
      if (it.src === 'gallery') {
        const g = normPrefix(it.g), n = String(it.n || '');
        if (!g || /^_|^sales\//.test(g) || kind(n) !== 'image' || !(await B.head(g + n))) return json({ error: 'A photo in your cart is no longer available.' }, 400);
        src = { src: 'gallery', g, n }; thumb = `${url.origin}/file?g=${encodeURIComponent(g)}&n=${encodeURIComponent(n)}`; title = 'Your photo (' + n + ')';
      } else {
        const e = await ev(it.ev); const p = e && e.on && (e.photos || []).find(x => x.n === it.n);
        if (!p) return json({ error: 'A photo in your cart is no longer available.' }, 400);
        src = { src: 'ev', ev: e.id, n: p.n }; thumb = `${url.origin}/file?g=${encodeURIComponent('sales/' + e.id + '/t/')}&n=${encodeURIComponent(p.n)}`; title = p.title || e.title;
        if (it.digital) { const pr = +(e.prices && e.prices.photo) || 0; if (!pr) return json({ error: 'Digital downloads are not on sale for this photo.' }, 400); dig.push({ ev: e.id, n: p.n }); total += pr; continue; }
      }
      const size = (cfg.sizes || []).find(x => x.id === it.size), fin = (cfg.finishes || []).find(x => x.id === it.finish);
      const price = size && fin ? +((cfg.prices || {})[size.id + '|' + fin.id]) || 0 : 0;
      if (!price) return json({ error: 'That size and finish is not available.' }, 400);
      const qty = Math.max(1, Math.min(10, Math.round(+it.qty || 1)));
      prints.push(Object.assign(src, { size: size.id, finish: fin.id, qty, price, thumb, label: title + ', ' + size.label + ', ' + fin.label + (qty > 1 ? ' x' + qty : '') }));
      total += price * qty; nPrint += qty;
    }
    if (!prints.length && !dig.length) return json({ error: 'Your cart is empty.' }, 400);
    let delivery = null;
    if (prints.length) {
      const dv = (cfg.delivery || []).find(x => x.id === (b.delivery && b.delivery.id) && x.on);
      if (!dv) return json({ error: 'Choose how to get your prints.' }, 400);
      const a = b.delivery.address || {};
      delivery = { id: dv.id, label: dv.label, fee: +dv.fee || 0, address: dv.id === 'collect' ? null : { street: String(a.street || '').slice(0, 100), suburb: String(a.suburb || '').slice(0, 60), city: String(a.city || '').slice(0, 60), code: String(a.code || '').slice(0, 10), province: String(a.province || '').slice(0, 30), notes: String(a.notes || '').slice(0, 200) } };
      if (delivery.address && (!delivery.address.street || !delivery.address.city)) return json({ error: 'Add your delivery address.' }, 400);
      total += delivery.fee;
    }
    const buyer = { name: String(b.buyer?.name || '').slice(0, 60), email: String(b.buyer?.email || '').slice(0, 80), phone: String(b.buyer?.phone || '').slice(0, 20) };
    if (!buyer.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyer.email)) return json({ error: 'Add your name and email.' }, 400);
    if (prints.length && buyer.phone.replace(/\D/g, '').length < 9) return json({ error: 'Add your WhatsApp number so we can update you about your print.' }, 400);
    if (total < 2) return json({ error: 'Nothing to pay.' }, 400);
    const label = [nPrint ? nPrint + ' print' + (nPrint === 1 ? '' : 's') : '', dig.length ? dig.length + ' digital photo' + (dig.length === 1 ? '' : 's') : ''].filter(Boolean).join(' and ');
    const o = { o: Date.now().toString(36) + rnd(4), k: rnd(16), type: 'print', ev: (prints[0] && prints[0].ev) || (dig[0] && dig[0].ev) || 'shop', evTitle: 'FOM Studios', prints, dig, delivery, label, amount: total, status: 'pending', created: new Date().toISOString(), buyer, from: String(b.from || '').slice(0, 40) };
    const back = String(b.back || '').startsWith('https://www.fomstudios.co.za/') ? b.back : 'https://www.fomstudios.co.za/prints.html';
    const r = await fetch('https://payments.yoco.com/api/checkouts', { method: 'POST', headers: { Authorization: 'Bearer ' + env.YOCO_SECRET_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ amount: Math.round(total * 100), currency: 'ZAR', successUrl: SALES_SITE + '?o=' + o.o + '&k=' + o.k, cancelUrl: back, failureUrl: back, metadata: { sale: o.o, kind: 'print' } }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.redirectUrl) return json({ error: (d && d.message) || 'Could not start the payment. Please try again.' }, 502);
    o.checkoutId = d.id; await r2put(env, '_sales/orders/' + o.o + '.json', o);
    return json({ redirectUrl: d.redirectUrl, o: o.o });
  }

  // ---------- admin ----------
  if (!path.startsWith('/sales/admin/')) return json({ error: 'not found' }, 404);
  if (!(await verifyAdmin(request, env))) return json({ error: 'not allowed' }, 401);
  if (path === '/sales/admin/upload' && request.method === 'POST') {
    const ev = evId(url.searchParams.get('ev')), n = safeName(url.searchParams.get('n')), v = url.searchParams.get('v');
    const type = (request.headers.get('Content-Type') || '').split(';')[0];
    if (!ev || !n || !/^image\//.test(type) || !['t', 'p', 'f'].includes(v)) return json({ error: 'need ev, n, v and an image' }, 400);
    const buf = await request.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > 25 * 1024 * 1024) return json({ error: 'bad file size (25 MB max)' }, 413);
    await B.put(v === 'f' ? '_sales/' + ev + '/' + n : 'sales/' + ev + '/' + v + '/' + n, buf, { httpMetadata: { contentType: type } });
    return json({ ok: true, n });
  }
  if (path === '/sales/admin/save' && request.method === 'POST') {
    let ev = {}; try { ev = await request.json(); } catch (e) {}
    ev.id = evId(ev.id); if (!ev.id) return json({ error: 'missing id' }, 400);
    ev.updated = new Date().toISOString();
    const body = JSON.stringify(ev); if (body.length > 900000) return json({ error: 'too many photos in one event' }, 413);
    await r2put(env, 'sales/' + ev.id + '/event.json', ev);
    const idx = (await r2json(env, 'sales/index.json')) || { events: [] };
    const card = { id: ev.id, title: ev.title || '', date: ev.date || '', place: ev.place || '', cover: ev.cover || (ev.photos && ev.photos[0] && ev.photos[0].n) || '', count: (ev.photos || []).length, on: !!ev.on, shop: !!ev.shop, prices: ev.prices || {} };
    idx.events = [card].concat((idx.events || []).filter(e => e.id !== ev.id)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    await r2put(env, 'sales/index.json', idx);
    return json({ ok: true });
  }
  if (path === '/sales/admin/delete' && request.method === 'POST') {
    let b = {}; try { b = await request.json(); } catch (e) {}
    const ev = evId(b.ev); if (!ev) return json({ error: 'missing ev' }, 400);
    const names = b.all ? null : (b.n || []).map(safeName);
    for (const pre of ['sales/' + ev + '/', '_sales/' + ev + '/']) {
      let cursor; do { const r = await B.list({ prefix: pre, cursor, limit: 1000 });
        const keys = r.objects.map(o => o.key).filter(k => names ? names.includes(k.split('/').pop()) : true);
        if (keys.length) await B.delete(keys);
        cursor = r.truncated ? r.cursor : undefined; } while (cursor);
    }
    if (b.all) { const idx = (await r2json(env, 'sales/index.json')) || { events: [] }; idx.events = (idx.events || []).filter(e => e.id !== ev); await r2put(env, 'sales/index.json', idx); }
    return json({ ok: true });
  }
  if (path === '/sales/admin/orders') {
    const ev = evId(url.searchParams.get('ev')), out = [];
    let cursor; do { const r = await B.list({ prefix: '_sales/orders/', cursor, limit: 1000 });
      const type = url.searchParams.get('type');
      for (const ob of r.objects) { const o = await r2json(env, ob.key); if (!o) continue;
        if (type === 'print' ? o.type !== 'print' : (o.type === 'print' || (ev && o.ev !== ev))) continue;
        out.push({ o: o.o, type: o.type || 'photos', ev: o.ev, label: o.label, amount: o.amount, status: o.status, stage: o.stage || '', created: o.created, paidAt: o.paidAt, buyer: o.buyer, count: (o.dig || o.items || []).length, prints: o.prints, delivery: o.delivery, from: o.from, link: SALES_SITE + (o.type === 'print' ? '?' : '?ev=' + o.ev + '&') + 'o=' + o.o + '&k=' + o.k }); }
      cursor = r.truncated ? r.cursor : undefined; } while (cursor);
    out.sort((a, b) => String(b.created).localeCompare(String(a.created)));
    return json({ orders: out.slice(0, 500) });
  }
  if (path === '/sales/admin/paid' && request.method === 'POST') {   // paid by EFT or cash: unlock it by hand
    let b = {}; try { b = await request.json(); } catch (e) {}
    const o = await r2json(env, '_sales/orders/' + safeName(b.o) + '.json'); if (!o) return json({ error: 'not found' }, 404);
    await markPaid(env, o, 'manual');
    return json({ ok: true, link: SALES_SITE + '?ev=' + o.ev + '&o=' + o.o + '&k=' + o.k });
  }
  if (path === '/sales/admin/shopcfg' && request.method === 'POST') {
    let c = {}; try { c = await request.json(); } catch (e) {}
    const body = JSON.stringify(c); if (body.length > 50000) return json({ error: 'too big' }, 413);
    c.updated = new Date().toISOString(); await r2put(env, 'shop/config.json', c);
    return json({ ok: true });
  }
  if (path === '/sales/admin/stage' && request.method === 'POST') {
    let b = {}; try { b = await request.json(); } catch (e) {}
    const o = await r2json(env, '_sales/orders/' + safeName(b.o) + '.json'); if (!o) return json({ error: 'not found' }, 404);
    if (!['new', 'ordered', 'ready', 'out', 'delivered'].includes(b.stage)) return json({ error: 'bad stage' }, 400);
    o.stage = b.stage; o.stages = Object.assign(o.stages || {}, { [b.stage]: new Date().toISOString() });
    await r2put(env, '_sales/orders/' + o.o + '.json', o);
    return json({ ok: true });
  }
  if (path === '/sales/admin/file') {   // the full-size file for a print, to send to the lab
    const o = await r2json(env, '_sales/orders/' + safeName(url.searchParams.get('o')) + '.json');
    const p = o && (o.prints || [])[+url.searchParams.get('i')]; if (!p) return json({ error: 'not found' }, 404);
    const f = await B.get(p.src === 'gallery' ? p.g + p.n : '_sales/' + p.ev + '/' + p.n); if (!f) return json({ error: 'file not found' }, 404);
    const h = new Headers(cors); f.writeHttpMetadata(h); h.set('Access-Control-Expose-Headers', 'Content-Disposition'); h.set('Content-Disposition', `attachment; filename="${o.o}-${+url.searchParams.get('i') + 1}-${p.size}-${p.finish}-${p.n.replace(/"/g, '')}"`);
    return new Response(f.body, { headers: h });
  }
  if (path === '/sales/admin/setup') {
    const w = await r2json(env, '_sales/webhook.json');
    if (request.method === 'POST') {
      if (!env.YOCO_SECRET_KEY) return json({ ok: false, msg: 'Add the YOCO_SECRET_KEY secret to the fom-gallery Worker first (same sk_live key as fom-yoco).' });
      if (w && w.id) await fetch('https://payments.yoco.com/api/webhooks/' + w.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + env.YOCO_SECRET_KEY } }).catch(() => null);
      const r = await fetch('https://payments.yoco.com/api/webhooks', { method: 'POST', headers: { Authorization: 'Bearer ' + env.YOCO_SECRET_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'fom-photo-sales', url: url.origin + '/sales/yoco' }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.secret) return json({ ok: false, msg: 'Yoco did not accept it (' + r.status + '): ' + JSON.stringify(d).slice(0, 160) });
      await r2put(env, '_sales/webhook.json', { id: d.id, secret: d.secret, at: new Date().toISOString() });
      return json({ ok: true, msg: 'Connected. Payments now unlock photos straight away.' });
    }
    return json({ key: !!env.YOCO_SECRET_KEY, webhook: !!(w && w.secret), at: w && w.at });
  }
  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (!env.BUCKET) return json({ error: 'R2 bucket not bound (name it BUCKET).' }, 500);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const g = normPrefix(url.searchParams.get('g'));
    if (/^_(notify|push|events|sales|channel)\//.test(g)) return json({ error: 'not found' }, 404);   // private records (email throttle, push keys, activity log, photo sales originals and orders)
    if (path.startsWith('/sales/')) return handleSales(path, request, env, url);
    if (path === '/event') return handleEvent(request, env, ctx);
    if (path === '/t') return handleTrack(request, env, ctx);
    if (path === '/admin/channel-save') return handleChannelSave(request, env);
    if (path === '/admin/channel-test') return handleChannelTest(request, env);
    if (path === '/admin/stats' || path === '/admin/stats-alerts') return handleStatsAdmin(path, request, env, url);
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
    // hourly: website traffic alerts (spike, daily summary, weekly report)
    if (event.cron === '0 * * * *') {
      if (env.STATS) ctx.waitUntil(statsHourly(env).catch(() => null));
      if (env.BUCKET) ctx.waitUntil(channelCheck(env).catch(() => null));   // WhatsApp Group: new messages from the scheduled task
      return;
    }
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

/* ============================================================
   WEBSITE TRAFFIC (18 Nov 2026)
   Cookieless counts from both websites (portfolio/track.js), stored in the
   Stats Durable Object (SQLite, free plan), shown on the dashboard Traffic page.
     POST /t                    a page view, click, time-on-page or form step (no login; no IP, no cookies kept)
     GET  /admin/stats          admin: aggregates for ?biz=fom|sba&from=yyyy-mm-dd&to=yyyy-mm-dd
     POST /admin/stats-alerts   admin: { biz, alerts:{ daily, weekly, hot, spike } }
   Alerts (to the phones in _push/subs.json): hot visitor (live), traffic spike (hourly check),
   daily summary 18:00 and weekly report Monday 07:00 (South African time), via the hourly cron.
   Days and hours are South African time (UTC+2). Rows older than 400 days are removed.
   ============================================================ */
const SAST = 2 * 3600e3;
const sastDay = ts => new Date(ts + SAST).toISOString().slice(0, 10);
const sastHour = ts => new Date(ts + SAST).getUTCHours();
const SENT_STEPS = ['book_sent_wa', 'book_sent_email', 'meet_sent'];
const ALERT_DEF = { daily: true, weekly: true, hot: true, spike: true };
const HOT = { book_open: 'is filling in the Book a shoot form', meet_open: 'is picking a meeting time', whatsapp: 'just tapped WhatsApp' };

export class Stats {
  constructor(state, env) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS hits (ts INTEGER, day TEXT, hour INTEGER, wd INTEGER, biz TEXT, sid TEXT, type TEXT, path TEXT, label TEXT, src TEXT, dev TEXT, city TEXT, secs INTEGER, scroll INTEGER)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS hits_biz_day ON hits (biz, day)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS hits_ts ON hits (ts)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`);
  }
  q(sql, ...a) { return this.sql.exec(sql, ...a).toArray(); }
  get(k, d) { const r = this.q('SELECT v FROM kv WHERE k = ?', k)[0]; try { return r ? JSON.parse(r.v) : d; } catch (e) { return d; } }
  set(k, v) { this.sql.exec('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, JSON.stringify(v)); }
  alerts(biz) { return Object.assign({}, ALERT_DEF, (this.get('alerts', {}) || {})[biz] || {}); }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    let b = {}; try { b = await request.json(); } catch (e) {}
    try {
      if (path === '/add') return Response.json(this.add(b));
      if (path === '/query') return Response.json(this.query(b));
      if (path === '/alerts') { if (b.set) { const all = this.get('alerts', {}) || {}; all[b.biz] = Object.assign({}, ALERT_DEF, b.set); this.set('alerts', all); } return Response.json(this.alerts(b.biz)); }
      if (path === '/hourly') return Response.json(this.hourly(b.now || Date.now()));
    } catch (e) { return Response.json({ error: String(e && e.message || e) }, { status: 500 }); }
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  add(h) {
    const ts = h.ts, day = sastDay(ts);
    // a runaway tab or a script cannot flood the table: at most 400 rows per visit
    const n = this.q('SELECT COUNT(*) AS n FROM hits WHERE sid = ? AND day = ?', h.sid, day)[0].n;
    if (n >= 400) return { ok: true, skipped: 'busy' };
    this.sql.exec('INSERT INTO hits (ts, day, hour, wd, biz, sid, type, path, label, src, dev, city, secs, scroll) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ts, day, sastHour(ts), new Date(ts + SAST).getUTCDay(), h.biz, h.sid, h.type, h.path, h.label, h.src, h.dev, h.city, h.secs, h.scroll);
    // hot visitor: once per visit per kind, and at most one per kind every 3 minutes per business
    const kind = h.type === 'step' && HOT[h.label] && h.label !== 'whatsapp' ? h.label : (h.type === 'click' && /^whatsapp\b/i.test(h.label) ? 'whatsapp' : '');
    if (!kind || !this.alerts(h.biz).hot) return { ok: true };
    const marks = this.get('hot', {}) || {}, mk = h.biz + ':' + kind;
    if (marks[h.sid + ':' + kind] || (marks[mk] && ts - marks[mk] < 180e3)) return { ok: true };
    marks[h.sid + ':' + kind] = ts; marks[mk] = ts;
    Object.keys(marks).forEach(k => { if (ts - marks[k] > 86400e3) delete marks[k]; });
    this.set('hot', marks);
    const first = this.q("SELECT src, city FROM hits WHERE sid = ? AND type = 'view' ORDER BY ts LIMIT 1", h.sid)[0] || {};
    const from = [first.src && first.src !== 'Direct' ? 'from ' + first.src : '', first.city ? 'in ' + first.city : ''].filter(Boolean).join(', ');
    return { ok: true, hot: { kind, text: 'Someone' + (from ? ' (' + from + ')' : '') + ' ' + HOT[kind] + (kind === 'whatsapp' && h.path ? ' on ' + pageName(h.path) : '') + '.' } };
  }

  range(biz, from, to) {
    const rows = this.q('SELECT ts, day, hour, wd, sid, type, path, label, src, dev, city, secs, scroll FROM hits WHERE biz = ? AND day >= ? AND day <= ? ORDER BY ts', biz, from, to);
    const visits = new Map(), enquired = new Set();
    for (const r of rows) {
      let v = visits.get(r.sid);
      if (!v) { v = { src: '', dev: r.dev, city: r.city, day: r.day, pages: new Set() }; visits.set(r.sid, v); }
      if (r.type === 'view') { if (!v.src) v.src = r.src || 'Direct'; v.pages.add(r.path); }
      if (r.type === 'step' && SENT_STEPS.includes(r.label)) enquired.add(r.sid);
    }
    return { rows, visits, enquired };
  }

  query({ biz, from, to, prevFrom, prevTo }) {
    const { rows, visits, enquired } = this.range(biz, from, to);
    const views = rows.filter(r => r.type === 'view'), leaves = rows.filter(r => r.type === 'leave' && r.secs > 0);
    const count = (arr, key) => { const m = {}; arr.forEach(x => { const k = key(x); if (k) m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
    const days = {};
    for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(to + 'T00:00:00Z'); d = new Date(+d + 86400e3)) days[d.toISOString().slice(0, 10)] = { visits: 0, views: 0, enquiries: 0 };
    visits.forEach((v, sid) => { if (days[v.day]) { days[v.day].visits++; if (enquired.has(sid)) days[v.day].enquiries++; } });
    views.forEach(r => { if (days[r.day]) days[r.day].views++; });
    // pages: views, visits, time, scroll, and how many of those visits went on to enquire
    const pg = {};
    views.forEach(r => { const p = pg[r.path] || (pg[r.path] = { path: r.path, views: 0, sids: new Set(), secs: 0, secN: 0, scroll: 0, scN: 0 }); p.views++; p.sids.add(r.sid); });
    leaves.forEach(r => { const p = pg[r.path]; if (!p) return; p.secs += Math.min(r.secs, 1800); p.secN++; if (r.scroll != null) { p.scroll += r.scroll; p.scN++; } });
    const pages = Object.values(pg).map(p => ({ path: p.path, name: pageName(p.path), views: p.views, visits: p.sids.size, avgSecs: p.secN ? Math.round(p.secs / p.secN) : 0, avgScroll: p.scN ? Math.round(p.scroll / p.scN) : 0, enquired: [...p.sids].filter(s => enquired.has(s)).length })).sort((a, b) => b.views - a.views).slice(0, 30);
    // clicks: by label, with the page it is clicked on most
    const ck = {};
    rows.filter(r => r.type === 'click').forEach(r => { const c = ck[r.label] || (ck[r.label] = { label: r.label, n: 0, sids: new Set(), on: {} }); c.n++; c.sids.add(r.sid); c.on[r.path] = (c.on[r.path] || 0) + 1; });
    const clicks = Object.values(ck).map(c => { const top = Object.entries(c.on).sort((a, b) => b[1] - a[1])[0]; return { label: c.label, clicks: c.n, visits: c.sids.size, topPage: top ? pageName(top[0]) : '', enquired: [...c.sids].filter(s => enquired.has(s)).length }; }).sort((a, b) => b.clicks - a.clicks).slice(0, 40);
    const vs = [...visits.values()];
    const funnel = {}; rows.filter(r => r.type === 'step').forEach(r => { (funnel[r.label] = funnel[r.label] || new Set()).add(r.sid); });
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0)); views.forEach(r => { grid[r.wd][r.hour]++; });
    const totalSecs = leaves.reduce((s, r) => s + Math.min(r.secs, 1800), 0);
    const now = Date.now();
    const live = this.q("SELECT sid, MAX(ts) AS at, path FROM hits WHERE biz = ? AND ts > ? GROUP BY sid ORDER BY at DESC", biz, now - 5 * 60e3);
    const out = {
      biz, from, to,
      totals: { visits: visits.size, views: views.length, enquiries: enquired.size, conversion: visits.size ? Math.round(enquired.size / visits.size * 1000) / 10 : 0, avgSecs: leaves.length ? Math.round(totalSecs / Math.max(1, visits.size)) : 0, pagesPerVisit: visits.size ? Math.round(views.length / visits.size * 10) / 10 : 0 },
      days: Object.entries(days).map(([day, v]) => ({ day, ...v })),
      pages, clicks,
      sources: count(vs, v => v.src || 'Direct').map(([k, n]) => ({ k, n })),
      devices: count(vs, v => v.dev || 'Other').map(([k, n]) => ({ k, n })),
      cities: count(vs, v => v.city).slice(0, 12).map(([k, n]) => ({ k, n })),
      funnel: Object.fromEntries(Object.entries(funnel).map(([k, s]) => [k, s.size])),
      grid,
      live: live.map(l => ({ page: pageName(l.path), ago: Math.round((now - l.at) / 1000) })),
      alerts: this.alerts(biz)
    };
    if (prevFrom && prevTo) { const p = this.range(biz, prevFrom, prevTo); out.prev = { visits: p.visits.size, views: p.rows.filter(r => r.type === 'view').length, enquiries: p.enquired.size }; }
    return out;
  }

  /* hourly cron: spike check every hour, daily summary at 18:00, weekly report Monday 07:00, tidy old rows */
  hourly(now) {
    const out = [], h = sastHour(now), wd = new Date(now + SAST).getUTCDay(), today = sastDay(now);
    const dayStr = n => sastDay(now - n * 86400e3);
    for (const biz of ['fom', 'sba']) {
      const a = this.alerts(biz), who = biz === 'sba' ? 'Shot by A' : 'FOM';
      if (a.spike) {
        const last = this.q("SELECT COUNT(DISTINCT sid) AS n FROM hits WHERE biz = ? AND ts > ?", biz, now - 3600e3)[0].n;
        const week = this.q("SELECT COUNT(DISTINCT sid || day) AS n FROM hits WHERE biz = ? AND ts > ? AND ts <= ?", biz, now - 7 * 86400e3, now - 3600e3)[0].n;
        const avg = week / (7 * 24 - 1), sp = this.get('spike:' + biz, 0);
        if (last >= Math.max(8, avg * 3) && now - sp > 6 * 3600e3) {
          this.set('spike:' + biz, now);
          const top = this.q("SELECT src, COUNT(DISTINCT sid) AS n FROM hits WHERE biz = ? AND ts > ? AND type = 'view' GROUP BY src ORDER BY n DESC LIMIT 1", biz, now - 3600e3)[0];
          out.push({ biz, kind: 'spike', title: who + ': traffic spike', body: last + ' visits in the last hour, ' + (avg < 0.5 ? 'far more than usual' : 'about ' + Math.round(last / avg) + 'x normal') + (top && top.src ? '. Most from ' + top.src : '') + '.' });
        }
      }
      if (a.daily && h === 18) {
        const q = this.query({ biz, from: today, to: today });
        if (q.totals.visits) out.push({ biz, kind: 'daily', title: who + ' today', body: q.totals.visits + ' visit' + (q.totals.visits === 1 ? '' : 's') + (q.pages[0] ? ', top page ' + q.pages[0].name : '') + (q.clicks[0] ? ', top click ' + q.clicks[0].label : '') + ', ' + q.totals.enquiries + ' enquir' + (q.totals.enquiries === 1 ? 'y' : 'ies') + '.' });
      }
      if (a.weekly && h === 7 && wd === 1) {
        const q = this.query({ biz, from: dayStr(7), to: dayStr(1), prevFrom: dayStr(14), prevTo: dayStr(8) });
        const ch = q.prev && q.prev.visits ? Math.round((q.totals.visits - q.prev.visits) / q.prev.visits * 100) : null;
        if (q.totals.visits || (q.prev && q.prev.visits)) out.push({ biz, kind: 'weekly', title: who + ': your week', body: q.totals.visits + ' visits' + (ch == null ? '' : ' (' + (ch >= 0 ? '+' : '') + ch + '% on last week)') + (q.sources[0] ? ', best source ' + q.sources[0].k : '') + (q.pages[0] ? ', best page ' + q.pages[0].name : '') + ', ' + q.totals.enquiries + ' enquir' + (q.totals.enquiries === 1 ? 'y' : 'ies') + '.' });
      }
    }
    if (h === 3) this.sql.exec('DELETE FROM hits WHERE ts < ?', now - 400 * 86400e3);
    return out;
  }
}

function pageName(p) {
  p = String(p || '/');
  const s = p.replace(/^\/shotbya/, '').replace(/\.html$/, '').replace(/^\/+|\/+$/g, '');
  const names = { '': 'Home', index: 'Home', prices: 'Prices', gallery: 'Gallery', book: 'Book a meeting', contact: 'Contact', policy: 'Policy' };
  return (names[s] != null ? names[s] : s.replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase()));
}
function statsStub(env) { return env.STATS ? env.STATS.get(env.STATS.idFromName('stats')) : null; }
async function statsCall(env, path, body) {
  const st = statsStub(env); if (!st) return null;
  const r = await st.fetch('https://stats' + path, { method: 'POST', body: JSON.stringify(body || {}) });
  return r.json();
}
const SRC_OK = ['WhatsApp group', 'WhatsApp channel', 'Instagram', 'Instagram stories', 'Facebook', 'TikTok', 'Google', 'Google Business', 'Bing', 'WhatsApp', 'QR code', 'YouTube', 'LinkedIn', 'Pinterest', 'Email', 'Direct'];
async function handleTrack(request, env, ctx) {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!env.STATS) return json({ ok: true, off: true });
  let b = {}; try { b = JSON.parse(await request.text()); } catch (e) { return json({ error: 'bad body' }, 400); }
  const type = ['view', 'click', 'leave', 'step'].includes(b.t) ? b.t : '';
  const sid = clean(b.s, 24).replace(/[^a-z0-9]/gi, '');
  if (!type || sid.length < 8) return json({ error: 'bad hit' }, 400);
  let src = clean(b.r, 40);
  if (src && !SRC_OK.includes(src) && !/^QR: [a-z -]{1,20}$/.test(src)) src = src.toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9.-]/g, '').slice(0, 40);
  const cf = request.cf || {};
  const hit = {
    ts: Date.now(), biz: b.b === 'sba' ? 'sba' : 'fom', sid, type,
    path: (clean(b.p, 80).split('?')[0] || '/').replace(/[^\w\/.-]/g, ''),
    label: clean(b.l, 60), src: type === 'view' ? (src || 'Direct') : '',
    dev: ['phone', 'tablet', 'computer'].includes(b.d) ? b.d : '',
    city: type === 'view' ? clean(cf.city, 40) : '',
    secs: type === 'leave' ? Math.max(0, Math.min(7200, Math.round(+b.secs || 0))) : null,
    scroll: type === 'leave' ? Math.max(0, Math.min(100, Math.round(+b.sc || 0))) : null
  };
  const res = await statsCall(env, '/add', hit);
  if (res && res.hot) {
    const who = hit.biz === 'sba' ? 'Shot by A: ' : '';
    const msg = { title: who + (res.hot.kind === 'whatsapp' ? 'WhatsApp tap' : 'Hot visitor'), body: res.hot.text, url: 'traffic.html?biz=' + hit.biz, tag: 'fom-hot-' + hit.biz + '-' + res.hot.kind };
    const job = pushAll(env, msg).catch(() => null);
    if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job;
  }
  return json({ ok: true });
}
async function handleStatsAdmin(path, request, env, url) {
  if (!(await verifyAdmin(request, env))) return json({ error: 'not allowed' }, 401);
  if (!env.STATS) return json({ error: 'Traffic is not switched on yet: the latest gallery-worker.js has not deployed (STATS binding missing).' }, 503);
  const biz = url.searchParams.get('biz') === 'sba' ? 'sba' : 'fom';
  if (path === '/admin/stats-alerts') {
    let b = {}; try { b = await request.json(); } catch (e) {}
    const set = {}; Object.keys(ALERT_DEF).forEach(k => { set[k] = !!(b.alerts || {})[k]; });
    return json({ ok: true, alerts: await statsCall(env, '/alerts', { biz, set }) });
  }
  const day = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : '';
  const to = day(url.searchParams.get('to')) || sastDay(Date.now());
  const from = day(url.searchParams.get('from')) || sastDay(Date.now() - 6 * 86400e3);
  const span = Math.round((new Date(to) - new Date(from)) / 86400e3) + 1;
  if (span < 1 || span > 400) return json({ error: 'bad range' }, 400);
  const prevTo = sastDay(new Date(from + 'T12:00:00Z') - 86400e3 - SAST), prevFrom = sastDay(new Date(from + 'T12:00:00Z') - span * 86400e3 - SAST);
  return json(await statsCall(env, '/query', { biz, from, to, prevFrom, prevTo }));
}
async function statsHourly(env) {
  const msgs = await statsCall(env, '/hourly', { now: Date.now() });
  for (const m of (msgs || [])) await pushAll(env, { title: m.title, body: m.body, url: 'traffic.html?biz=' + m.biz, tag: 'fom-' + m.kind + '-' + m.biz });
}

/* ============================================================
   WHATSAPP CHANNEL (19 Nov 2026)
   The dashboard Channel page saves its settings here; the Worker commits them to
   channel/settings.json in this repo (public), where the scheduled Claude task reads them
   and writes channel/pack.json (the messages). Needs the GH_TOKEN secret: a fine-grained
   GitHub token with Contents read and write on FOMStudios/dashboard only.
     POST /admin/channel-save   admin: { biz, settings }  -> commits channel/settings.json (or settings_sba.json)
   Hourly cron: when channel/pack.json has a new generatedAt, phones get "New group messages".
   ============================================================ */
const GH_REPO = 'FOMStudios/dashboard';
async function ghFile(env, path) {
  const r = await fetch('https://api.github.com/repos/' + GH_REPO + '/contents/' + path + '?ref=main', { headers: { Authorization: 'Bearer ' + env.GH_TOKEN, 'User-Agent': 'fom-gallery-worker', Accept: 'application/vnd.github+json' } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('GitHub read failed (' + r.status + ')');
  const j = await r.json();
  return { sha: j.sha, text: decodeURIComponent(escape(atob(String(j.content || '').replace(/\n/g, '')))) };
}
async function handleChannelSave(request, env) {
  if (!(await verifyAdmin(request, env))) return json({ error: 'not allowed' }, 401);
  if (!env.GH_TOKEN) return json({ error: 'The GitHub link is not set up yet: add the GH_TOKEN secret to the fom-gallery Worker (see the Channel page).' }, 503);
  let b = {}; try { b = await request.json(); } catch (e) { return json({ error: 'bad body' }, 400); }
  const s = b.settings;
  if (!s || typeof s !== 'object') return json({ error: 'no settings' }, 400);
  const body = JSON.stringify(s, null, 2);
  if (body.length > 60000) return json({ error: 'Settings are too long' }, 413);
  // kind 'ig': the Instagram scorecard from the Content Planner, read by the weekly Instagram pack task
  const sfx = b.biz === 'sba' ? '_sba' : '';
  const path = b.kind === 'ig' ? 'content/ig-scores' + sfx + '.json' : 'channel/settings' + sfx + '.json';
  try {
    const cur = await ghFile(env, path);
    if (cur && cur.text.trim() === body.trim()) return json({ ok: true, same: true });
    const r = await fetch('https://api.github.com/repos/' + GH_REPO + '/contents/' + path, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + env.GH_TOKEN, 'User-Agent': 'fom-gallery-worker', Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: b.kind === 'ig' ? 'Instagram scorecard saved from the dashboard' : 'Group settings saved from the dashboard', content: btoa(unescape(encodeURIComponent(body))), sha: cur ? cur.sha : undefined, branch: 'main' })
    });
    if (!r.ok) { const t = await r.text(); return json({ error: 'GitHub did not accept it (' + r.status + '): ' + t.slice(0, 160) }, 502); }
    return json({ ok: true });
  } catch (e) { return json({ error: String(e && e.message || e) }, 502); }
}
// "Test the GitHub link" on the WhatsApp Group page: says exactly which step is wrong
async function handleChannelTest(request, env) {
  if (!(await verifyAdmin(request, env))) return json({ error: 'not allowed' }, 401);
  const H = { Authorization: 'Bearer ' + env.GH_TOKEN, 'User-Agent': 'fom-gallery-worker', Accept: 'application/vnd.github+json' };
  if (!env.GH_TOKEN) return json({ ok: false, step: 'secret', msg: 'The fom-gallery Worker has no GH_TOKEN. In Cloudflare open fom-gallery, Settings, Variables and Secrets (not Build variables), add a Secret named GH_TOKEN and press Deploy.' });
  try {
    const u = await fetch('https://api.github.com/user', { headers: H });
    if (u.status === 401) return json({ ok: false, step: 'token', msg: 'GitHub does not recognise the token (wrong, expired or copied with a space). Make a new token and replace the GH_TOKEN secret.' });
    const r = await fetch('https://api.github.com/repos/' + GH_REPO, { headers: H });
    if (r.status === 404 || r.status === 403) return json({ ok: false, step: 'access', msg: 'The token works but cannot see FOMStudios/dashboard. Check: Resource owner FOMStudios, Only select repositories: dashboard, and approve it under FOMStudios, Settings, Personal access tokens, Pending requests.' });
    if (!r.ok) return json({ ok: false, step: 'access', msg: 'GitHub answered ' + r.status + ' when opening the repo.' });
    const path = 'channel/link-test.txt', cur = await ghFile(env, path);
    const w = await fetch('https://api.github.com/repos/' + GH_REPO + '/contents/' + path, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, H),
      body: JSON.stringify({ message: 'GitHub link test from the dashboard', content: btoa('Link tested ' + new Date().toISOString() + '\n'), sha: cur ? cur.sha : undefined, branch: 'main' }) });
    if (w.status === 403 || w.status === 404) return json({ ok: false, step: 'write', msg: 'The token can read the repo but not write. Edit the token: Repository permissions, Contents: Read and write, then save (the secret stays the same).' });
    if (!w.ok) return json({ ok: false, step: 'write', msg: 'GitHub refused the write (' + w.status + '): ' + (await w.text()).slice(0, 120) });
    return json({ ok: true, msg: 'All good: the Worker can write to your repo. Press Save.' });
  } catch (e) { return json({ ok: false, step: 'network', msg: String(e && e.message || e) }); }
}
async function channelCheck(env) {
  // new messages from the scheduled task? (public file, no token needed)
  for (const biz of ['fom', 'sba']) {
    const r = await fetch('https://raw.githubusercontent.com/' + GH_REPO + '/main/channel/pack' + (biz === 'sba' ? '_sba' : '') + '.json?t=' + Date.now(), { cf: { cacheTtl: 0 } }).catch(() => null);
    if (!r || !r.ok) continue;
    const p = await r.json().catch(() => null);
    if (!p || !p.generatedAt) continue;
    const key = '_channel/seen_' + biz + '.txt', seenObj = await env.BUCKET.get(key), seen = seenObj ? await seenObj.text() : '';
    if (seen === p.generatedAt) continue;
    await env.BUCKET.put(key, p.generatedAt);
    if (!seen) continue;   // first look: just remember it
    const n = (p.messages || []).length;
    await pushAll(env, { title: (biz === 'sba' ? 'Shot by A: ' : '') + 'New group messages', body: n + ' WhatsApp Group message' + (n === 1 ? '' : 's') + ' ready to review' + (p.headline ? ': ' + p.headline : '.'), url: 'channel.html?biz=' + biz, tag: 'fom-channel-' + biz });
  }
}
