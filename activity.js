/* ============================================================
   FOM STUDIOS - client activity + push notifications (loaded on every admin page)
   ------------------------------------------------------------
   - Keeps the gallery Worker's list of bookings up to date (so notifications use your names)
   - Reads the activity log (contract signed, portal sign-in, gallery opened, downloads,
     favourites, reviews, card payments) and ticks the matching Workflow steps
   - Turns notifications on or off for this phone (Settings, Notifications)
   ============================================================ */
(function(){
'use strict';
var WORKER = 'https://fom-gallery.cold-moon-d65c.workers.dev';
var LS = window.localStorage, D = document;
var STEP = { paid:'s3', portal:'s9', download:'s13', signed:'s14' };   // event -> Workflow step
var TXT = { signed:'signed the contract', portal:'signed in to the portal', gallery:'opened their gallery', download:'downloaded', favs:'picked favourites', review:'left a review', paid:'paid by card', meeting:'booked a meeting on the website' };
var ICON = { signed:'✍️', portal:'🔑', gallery:'🖼️', download:'⬇️', favs:'♥', review:'⭐', paid:'💳', meeting:'📅' };
var state = { events:[], devices:[], orders:[], ready:false, error:'' }, subs = [];
function get(k, d){ try{ var v = LS.getItem(k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } }
function set(k, v){ try{ LS.setItem(k, JSON.stringify(v)); }catch(e){} }
function fb(){ try{ return (window.firebase && firebase.apps && firebase.apps.length) ? firebase : null; }catch(e){ return null; } }
async function token(){ var f = fb(), u = f && f.auth().currentUser; if(!u) throw new Error('Sign in first'); return u.getIdToken(); }
async function api(path, opts){
  opts = opts || {}; opts.headers = Object.assign({ Authorization:'Bearer ' + await token() }, opts.headers || {});
  var r = await fetch(WORKER + path, opts), j = await r.json().catch(function(){ return {}; });
  if(!r.ok) throw new Error(j.error || ('Worker error ' + r.status));
  return j;
}
function emit(){ subs.forEach(function(f){ try{ f(state); }catch(e){} }); }

/* ---- bookings list for the Worker (all businesses), only sent when it changed ---- */
async function syncOrders(all){
  var map = {}; all.forEach(function(o){ map[o.id] = { n:o.customer || o.clientEmail || '', b:o.biz === 'sba' ? 'sba' : 'fom', o:o.orderId || '' }; });
  var h = JSON.stringify(map); if(get('fom.act.orders', '') === h) return;
  try{ await api('/push/orders', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ orders:map }) }); set('fom.act.orders', h); }catch(e){ console.warn('activity: orders', e); }
}
/* ---- tick Workflow steps from client actions ---- */
function orderFor(e, all){
  if(e.o){ var o = all.find(function(x){ return x.id === e.o; }); if(o) return o; }
  if(e.t === 'paid'){   // card payments only carry the client name: newest open booking with that name
    var n = String(e.n || '').trim().toLowerCase(); if(!n) return null;
    var c = all.filter(function(x){ return String(x.customer || '').trim().toLowerCase() === n && x.status !== 'Cancelled'; });
    c.sort(function(a, b){ return (b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0) - (a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0); });
    return c[0] || null;
  }
  return null;
}
async function autoTick(db, all){
  var done = 0;
  for(var i = state.events.length - 1; i >= 0; i--){
    var e = state.events[i], step = STEP[e.t]; if(!step) continue;
    var o = orderFor(e, all); if(!o) continue;
    if(o.workflow && o.workflow[step]) continue;
    var upd = {}; upd['workflow.' + step] = true; upd['workflowAuto.' + step] = new Date(e.at).toISOString().slice(0, 10);
    try{ await db.collection('orders').doc(o.id).update(upd); o.workflow = Object.assign({}, o.workflow, (function(){ var x = {}; x[step] = true; return x; })()); done++; }catch(err){ console.warn('activity: tick', err); }
  }
  return done;
}
async function refresh(){
  var f = fb(); if(!f || !f.auth().currentUser) return;
  try{
    var db = f.firestore(), snap = await db.collection('orders').get();
    state.orders = snap.docs.map(function(d){ return Object.assign({ id:d.id }, d.data()); });
    await syncOrders(state.orders);
    var j = await api('/events');
    state.events = j.events || []; state.devices = j.devices || []; state.ready = true; state.error = '';
    var t = await autoTick(db, state.orders);
    if(t) state.ticked = t;
  }catch(e){ state.error = e.message || 'Could not load activity'; console.warn('activity', e); }
  emit();
}
/* start once Firebase has signed you in on this page */
var started = false, tries = 0;
(function wait(){
  var f = fb();
  if(f && f.auth){ f.auth().onAuthStateChanged(function(u){ if(u && !started){ started = true; setTimeout(refresh, 800); setInterval(function(){ if(D.visibilityState === 'visible') refresh(); }, 120000); } }); return; }
  if(++tries < 60) setTimeout(wait, 500);
})();
D.addEventListener('visibilitychange', function(){ if(started && D.visibilityState === 'visible') refresh(); });

/* ---- push on this phone ---- */
var isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
var u8 = function(s){ return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), function(c){ return c.charCodeAt(0); }); };
function support(){
  var ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return { ok:ok, needsInstall:isIOS && !standalone, permission:'Notification' in window ? Notification.permission : 'unsupported', on:!!get('fom.push.device', null) };
}
var reg = null;
function swReg(){ if(!reg && 'serviceWorker' in navigator) reg = navigator.serviceWorker.register('sw.js').catch(function(e){ console.warn('sw', e); return null; }); return reg || Promise.resolve(null); }
if('serviceWorker' in navigator && get('fom.push.device', null)) swReg();
async function enable(){
  var sp = support();
  if(sp.needsInstall) throw new Error('On iPhone, open FOM from its home screen icon first, then turn this on');
  if(!sp.ok) throw new Error('This browser cannot show notifications');
  var perm = await Notification.requestPermission();
  if(perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked. Allow them in Settings, Notifications, FOM' : 'Permission not given');
  await swReg(); var r = await navigator.serviceWorker.ready;
  var key = (await (await fetch(WORKER + '/push/key')).json()).key;
  if(!key) throw new Error('The Worker does not have notifications yet. Paste the latest gallery-worker.js into Cloudflare');
  var sub = await r.pushManager.getSubscription();
  if(sub){ try{ await sub.unsubscribe(); }catch(e){} }
  sub = await r.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:u8(key) });
  var device = isIOS ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'Computer';
  await api('/push/sub', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ sub:sub.toJSON(), device:device }) });
  set('fom.push.device', { endpoint:sub.endpoint, at:Date.now() });
  return true;
}
async function disable(){
  var dev = get('fom.push.device', null);
  try{ var r = await navigator.serviceWorker.ready, s = await r.pushManager.getSubscription(); if(s) await s.unsubscribe(); }catch(e){}
  if(dev){ try{ await api('/push/sub', { method:'DELETE', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ endpoint:dev.endpoint }) }); }catch(e){} }
  try{ LS.removeItem('fom.push.device'); }catch(e){}
}
function test(){ return api('/push/test', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:'{}' }); }

/* ---- shared formatting for the activity card and order history ---- */
function ago(ms){ var s = (Date.now() - ms) / 1000; if(s < 60) return 'just now'; if(s < 3600) return Math.round(s / 60) + ' min ago'; if(s < 86400) return Math.round(s / 3600) + ' h ago';
  var d = new Date(ms); return d.toLocaleDateString('en-ZA', { day:'numeric', month:'short' }) + ' ' + d.toLocaleTimeString('en-ZA', { hour:'2-digit', minute:'2-digit' }); }
function line(e){ return { icon:ICON[e.t] || '•', name:e.n || 'A client', what:TXT[e.t] || e.t, detail:e.d || '', when:ago(e.at), biz:e.b, t:e.t, o:e.o, at:e.at }; }
function forOrder(o){ var n = String(o.customer || '').trim().toLowerCase(); return state.events.filter(function(e){ return e.o === o.id || (!e.o && e.t === 'paid' && n && String(e.n || '').trim().toLowerCase() === n); }); }

window.FOM_ACT = { state:state, on:function(f){ subs.push(f); if(state.ready || state.error) f(state); }, refresh:refresh,
  support:support, enable:enable, disable:disable, test:test, line:line, forOrder:forOrder, STEP:STEP };
})();
