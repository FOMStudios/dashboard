/* ============================================================
   FOM STUDIOS / SHOT BY A - business switch (loaded in the <head> of every admin page)
   ------------------------------------------------------------
   One login, two businesses. The switch (Settings, or the chip on the Dashboard)
   decides:
     - the theme (FOM navy, or Shot by A dark red and stone)
     - which orders, leads, content items and reviews you see and create
       (every new item gets biz:'fom' or biz:'sba'; old items with no biz are FOM)
     - which saved settings are used: settings/<id> for FOM, settings/<id>_sba for Shot by A
       (calculator, contract, checklist, outreach, pitchDeck, brand)
     - the business name, email, phone and links in invoices, contracts, emails and the deck
   The first time a Shot by A setting is opened it is copied from FOM's with the details swapped.
   ============================================================ */
(function(){
'use strict';
var KEY = 'fom.biz';
var ls = window.localStorage;
var DEF = {
  fom: { id:'fom', name:'FOM Studios', upper:'FOM STUDIOS', legal:'Frames Of Motion (FOM) Studios', tagline:'FRAMES OF MOTION',
    owner:'Ishaaq Adam', email:'info@fomstudios.co.za', phone:'073 755 3136', site:'www.fomstudios.co.za',
    siteUrl:'https://www.fomstudios.co.za', instagram:'fom_studios_', role:'Photographer / Videographer',
    portal:'https://www.fomstudios.co.za/client-portal.html', clientQS:'',
    logo:'assets/mascot.png', logoAbs:'https://www.fomstudios.co.za/assets/mascot.png', icon:'assets/mascot.png',
    accent:'#02367B', accent2:'#5B9AE0', galleryPrefix:'' },
  sba: { id:'sba', name:'Shot by A', upper:'SHOT BY A', legal:'Shot by A Photography', tagline:'PHOTOGRAPHY',
    owner:'Amarah Rangraze', email:'amarah.rangraze@gmail.com', phone:'073 755 3136', site:'instagram.com/shotbya_photography',
    siteUrl:'https://instagram.com/shotbya_photography', instagram:'shotbya_photography', role:'Photographer',
    portal:'https://www.fomstudios.co.za/shotbya/', clientQS:'b=sba',
    logo:'assets/shotbya-logo.png', logoAbs:'https://www.fomstudios.co.za/shotbya/logo.png', icon:'assets/shotbya-icon.png',
    accent:'#780000', accent2:'#C1121F', galleryPrefix:'shotbya/' }
};
var EDITABLE = ['name','owner','email','phone','site','instagram','role'];

function readJSON(k){ try{ return JSON.parse(ls.getItem(k)) || null; }catch(e){ return null; } }
var cur = 'fom';
try{ cur = ls.getItem(KEY) === 'sba' ? 'sba' : 'fom'; }catch(e){}

/* business details you can edit in Settings (cached; synced to settings/brand and settings/brand_sba) */
function brandOf(id){
  var b = Object.assign({}, DEF[id]), o = readJSON('fom.brand.' + id);
  if(o) EDITABLE.forEach(function(k){ if(typeof o[k] === 'string' && o[k].trim()) b[k] = o[k].trim(); });
  b.upper = b.name.toUpperCase();
  b.siteUrl = /^https?:/i.test(b.site) ? b.site : 'https://' + b.site.replace(/^\/+/, '');
  return b;
}
var B = brandOf(cur);

/* ---- theme: set before the page paints ---- */
var root = document.documentElement;
root.setAttribute('data-biz', cur);

/* ---- keep each business's cached settings apart in this browser ---- */
var SCOPED = { 'fom.calc.v1':1, 'fom.contract.v1':1, 'fom.checklist.v1':1, 'fom.dash.client':1, 'fom_orders':1,
  'fom.outreach.v1':1, 'fom.decks.v1':1, 'fom.deck.draft.v1':1 };
if(cur === 'sba'){
  var P = Storage.prototype, g = P.getItem, s = P.setItem, r = P.removeItem;
  var map = function(st, k){ return (st === ls && SCOPED[k]) ? k + '.sba' : k; };
  P.getItem = function(k){ return g.call(this, map(this, k)); };
  P.setItem = function(k, v){ return s.call(this, map(this, k), v); };
  P.removeItem = function(k){ return r.call(this, map(this, k)); };
}

/* ---- rebrand: swap FOM's details for the current business in generated text and HTML ---- */
var esc = function(t){ return String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
function rules(opts){
  var F = DEF.fom, b = B, out = [];
  var add = function(from, to){ if(to != null && from !== to) out.push([typeof from === 'string' ? new RegExp(esc(from), 'g') : from, to]); };
  add(F.legal, b.legal);
  add('https://www.fomstudios.co.za/client-portal.html', b.portal);
  ['https://www.fomstudios.co.za/assets/mascot.png','https://www.fomstudios.co.za/assets/mascot-head-color.png','https://www.fomstudios.co.za/assets/mascot-head-color.jpg','https://www.fomstudios.co.za/assets/logo.png'].forEach(function(u){ add(u, b.logoAbs); });
  add(F.email, b.email);
  add(/https:\/\/www\.fomstudios\.co\.za(?![\/\w.])/g, b.siteUrl);
  add(/(^|[^\/\w.])www\.fomstudios\.co\.za(?![\/\w])/g, '$1' + b.site);
  add('The FOM Difference', 'The ' + b.name + ' Difference'); add('THE FOM DIFFERENCE', ('The ' + b.name + ' Difference').toUpperCase());
  add('FOM Studios', b.name); add('FOM STUDIOS', b.upper); add('FOM studios', b.name);
  add(F.tagline, b.tagline);
  add(/@?fom_studios_/g, (function(){ return '@' + b.instagram; })());
  if(b.phone !== F.phone){ ['+27 73 755 3136','073 755 3136','0737553136','27737553136'].forEach(function(p){ add(p, b.phone); }); }
  if(opts && opts.owner){ add(F.owner, b.owner); add(F.owner.toUpperCase(), b.owner.toUpperCase()); add('Ishaaq', b.owner.split(' ')[0]); }
  if(opts && opts.colors !== false){ add(/#02367B/gi, b.accent); add(/#5B9AE0/gi, b.accent2); }
  if(opts && opts.role){ add(F.role, b.role); }
  return out;
}
function rebrand(str, opts){
  if(str == null) return str;
  if(cur === 'fom' && !readJSON('fom.brand.fom')) return str;
  var s2 = String(str);
  rules(opts || {}).forEach(function(r){
    // the instagram rule keeps a leading @ only when the source had one
    if(String(r[0]) === String(/@?fom_studios_/g)) s2 = s2.replace(/(@?)fom_studios_/g, function(m, at){ return at + B.instagram; });
    else s2 = s2.replace(r[0], r[1]);
  });
  return s2;
}

/* FOM's navy and light blues written straight into page styles become Shot by A's palette */
var CSS_SWAP = [[/#02367B/gi,'var(--accent)'],[/#022a5f/gi,'var(--accent-hover)'],[/#5B9AE0/gi,'var(--accent-on-dark)'],[/#7aa6c9/gi,'#B9BAA3'],
  [/#e7f0ff/gi,'#F2E3E1'],[/#bcd4f5/gi,'#E2C3C0'],[/#eef2fb/gi,'#F4E9E7'],[/#cfe0d3/gi,'#D6D5C9'],[/#8fb8e8/gi,'#E8B7B3'],[/#dce8ff/gi,'#EDE0DD'],[/#e6eefb/gi,'#F2E5E3']];
var CSS_TEST = new RegExp(CSS_SWAP.map(function(x){ return x[0].source; }).join('|'), 'i');
function swapCss(t){ for(var i = 0; i < CSS_SWAP.length; i++) t = t.replace(CSS_SWAP[i][0], CSS_SWAP[i][1]); return t; }
function swapStyles(){
  var st = document.querySelectorAll('style:not([data-biz-done])');
  for(var i = 0; i < st.length; i++){ var t = st[i].textContent; if(CSS_TEST.test(t)) st[i].textContent = swapCss(t); st[i].setAttribute('data-biz-done',''); }
}
if(cur === 'sba') swapStyles();

/* rebrand the page's own text (headings, labels, cards) as it renders; never touches what you type */
var SKIP = { SCRIPT:1, STYLE:1, TEXTAREA:1, INPUT:1, SELECT:1, OPTION:0, CODE:1 };
function fixNode(n){
  if(n.nodeType === 3){
    var p = n.parentNode; if(!p || SKIP[p.nodeName] || (p.closest && p.closest('[data-norebrand],[contenteditable]'))) return;
    var v = n.nodeValue; if(!/FOM|fomstudios|fom_studios_|Frames Of Motion|FRAMES OF MOTION|755 3136/.test(v)) return;
    var nv = rebrand(v, { colors:false }); if(nv !== v) n.nodeValue = nv;
  } else if(n.nodeType === 1){
    if(SKIP[n.nodeName] || n.hasAttribute('data-norebrand') || (n.closest && n.closest('[data-norebrand]'))) return;
    var sa = n.getAttribute('style'); if(sa && CSS_TEST.test(sa)) n.setAttribute('style', swapCss(sa));
    ['placeholder','title','alt','aria-label'].forEach(function(a){ var v = n.getAttribute(a); if(v && /FOM|fomstudios/.test(v)){ var nv = rebrand(v, { colors:false }); if(nv !== v) n.setAttribute(a, nv); } });
    for(var c = n.firstChild; c; c = c.nextSibling) fixNode(c);
  }
}
function swapIcons(){
  var links = document.querySelectorAll('link[rel="icon"],link[rel="apple-touch-icon"]');
  for(var i = 0; i < links.length; i++) links[i].href = B.icon;
}
if(cur === 'sba'){
  document.title = rebrand(document.title, { colors:false });
  document.addEventListener('DOMContentLoaded', function(){
    document.title = rebrand(document.title, { colors:false });
    swapIcons(); swapStyles(); fixNode(document.body);
    // logos and mascots shown in the page itself
    var imgs = document.querySelectorAll('img[src*="mascot"],img[src*="logo"]');
    for(var i = 0; i < imgs.length; i++){ if(!imgs[i].closest('[data-norebrand]')) var ic = imgs[i].closest('.fom-nav,.fom-prof,.av,.pic'); imgs[i].src = ic ? B.icon : B.logo; if(!ic) imgs[i].classList.add('sba-logo'); }
    new MutationObserver(function(ms){ ms.forEach(function(m){
      if(m.type === 'characterData') fixNode(m.target);
      else for(var j = 0; j < m.addedNodes.length; j++){ var a = m.addedNodes[j]; fixNode(a);
        if(a.querySelectorAll){ var im = a.querySelectorAll('img[src*="mascot"],img[src*="logo"]'); for(var k = 0; k < im.length; k++) if(!im[k].closest('[data-norebrand]')) { var ic2 = im[k].closest('.fom-nav,.fom-prof,.av,.pic'); im[k].src = ic2 ? B.icon : B.logo; if(!ic2) im[k].classList.add('sba-logo'); } } }
    }); }).observe(document.body, { childList:true, subtree:true, characterData:true });
  });
}

/* ---- data helpers ---- */
var bizOf = function(o){ return (o && o.biz === 'sba') ? 'sba' : 'fom'; };
function mine(arr){ return (arr || []).filter(function(o){ return bizOf(o) === cur; }); }
function tag(o){ o.biz = cur; return o; }
function sid(id){ return cur === 'sba' ? id + '_sba' : id; }
var OWNER_DOCS = { outreach:1, pitchDeck:1 };
/* read a settings doc for this business; Shot by A's first read copies FOM's (rebranded) */
function getSettings(db, id){
  var ref = db.collection('settings').doc(sid(id));
  return ref.get().then(function(snap){
    if(cur === 'fom' || snap.exists) return snap;
    return db.collection('settings').doc(id).get().then(function(f){
      if(!f.exists || !f.data().json) return snap;
      var json = rebrand(f.data().json, { owner:!!OWNER_DOCS[id], role:true });
      ref.set({ json: json, copiedFrom: id, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(function(e){ console.warn('copy settings', e); });
      return { exists:true, id: sid(id), data:function(){ return { json: json }; } };
    });
  });
}
function setSettings(db, id, json){
  return db.collection('settings').doc(sid(id)).set({ json: json, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
}
/* client links: Shot by A's portal pages carry ?b=sba until she has her own domain */
function clientUrl(page, qs){
  var base = 'https://www.fomstudios.co.za/' + page;
  var q = [qs, B.clientQS].filter(Boolean).join('&');
  return base + (q ? (base.indexOf('?') >= 0 ? '&' : '?') + q : '');
}
function setBiz(id){
  try{ ls.setItem(KEY, id === 'sba' ? 'sba' : 'fom'); }catch(e){}
  location.reload();
}
function saveBrand(id, vals, db){
  var o = {}; EDITABLE.forEach(function(k){ if(typeof vals[k] === 'string') o[k] = vals[k].trim(); });
  try{ ls.setItem('fom.brand.' + id, JSON.stringify(o)); }catch(e){}
  if(db) return db.collection('settings').doc(id === 'sba' ? 'brand_sba' : 'brand').set({ json: JSON.stringify(o), updatedAt: firebase.firestore.FieldValue.serverTimestamp() }).then(function(){ return true; }).catch(function(){ return false; });
  return Promise.resolve(false);
}
/* pull the synced business details once per page (so a new device gets them) */
function syncBrand(db){
  ['fom','sba'].forEach(function(id){
    db.collection('settings').doc(id === 'sba' ? 'brand_sba' : 'brand').get().then(function(s){
      if(s.exists && s.data().json){ var before = ls.getItem('fom.brand.' + id); if(before !== s.data().json){ ls.setItem('fom.brand.' + id, s.data().json); if(id === cur) B = brandOf(cur); } }
    }).catch(function(){});
  });
}

window.FOM_BIZ = {
  id: cur, isSba: cur === 'sba', brand: function(id){ return id ? brandOf(id) : B; }, get b(){ return B; },
  NAMES: { fom:'FOM Studios', sba:'Shot by A' }, COLORS: { fom:'#02367B', sba:'#780000' },
  bizOf: bizOf, mine: mine, tag: tag, sid: sid, getSettings: getSettings, setSettings: setSettings,
  rebrand: rebrand, clientUrl: clientUrl, setBiz: setBiz, saveBrand: saveBrand, syncBrand: syncBrand, EDITABLE: EDITABLE
};
})();
