/* ============================================================
   FOM STUDIOS - Leads page extras (Nov 2026)
   Tab "Today": up to 20 business leads a day to contact, with a
   ready message and one-tap WhatsApp, Instagram or email, plus the
   follow-ups that are due. New leads arrive every Monday from the
   scheduled Claude task (leads/pack.json in this repo) and are added
   to the normal Leads Tracker (source "claude").
   Tab "Past clients": everyone you have shot for, grouped from the
   Order Database, with a personal festive message and a referral
   code (10% off for the friend and 10% off for the client's next
   shoot; the Price Calculator accepts these codes).
   Uses the Leads page globals: leads, store, DB, toast, blankLead,
   safeRenderLeads, OCFG, FOM_BIZ.
   ============================================================ */
(function(){
'use strict';
var D = document, BZ = window.FOM_BIZ, SUF = BZ.isSba ? '_sba' : '';
var DAILY = 20, FOLLOW_DAYS = 4;
var SITE_LINK = 'https://www.fomstudios.co.za/?src=outreach';
function $(id){ return D.getElementById(id); }
function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function iso(d){ return (d || new Date()).toLocaleDateString('en-CA', { timeZone:'Africa/Johannesburg' }); }
function addDays(s, n){ var x = new Date(s + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function nice(s){ try{ return new Date(String(s).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-ZA', { day:'numeric', month:'short' }); }catch(e){ return s; } }
function LSget(k, d){ try{ var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; }catch(e){ return d; } }
function LSset(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
function intl(p){ var d = String(p || '').replace(/\D/g, ''); if(!d) return ''; if(d.indexOf('27') === 0 && d.length >= 11) return d; if(d.charAt(0) === '0') return '27' + d.slice(1); return d; }
function igHandle(v){ return String(v || '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, ''); }
function first(n){ return String(n || '').trim().split(/\s+/)[0] || ''; }
async function copy(t){ try{ await navigator.clipboard.writeText(t); return true; }catch(e){ var a = D.createElement('textarea'); a.value = t; D.body.appendChild(a); a.select(); try{ D.execCommand('copy'); }catch(x){} a.remove(); return true; } }

/* ---------- tabs + style ---------- */
var css = D.createElement('style');
css.textContent = [
'.ot-top{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px}',
'.ot-goal{flex:1;min-width:220px;background:var(--surface,#fff);border:1px solid var(--line);border-radius:16px;padding:12px 16px}',
'.ot-goal b{font-size:22px}.ot-bar{height:8px;border-radius:9px;background:var(--line);margin-top:8px;overflow:hidden}.ot-bar i{display:block;height:100%;background:#1f8a4c;border-radius:9px}',
'.ot-h{font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft);margin:18px 2px 8px}',
'.ot-card{background:var(--surface,#fff);border:1px solid var(--line);border-radius:18px;padding:14px 16px;margin-bottom:12px}',
'.ot-card.done{opacity:.55}',
'.ot-row{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}',
'.ot-name{font-weight:800;font-size:16px}.ot-sub{font-size:12.5px;color:var(--ink-soft);margin-top:2px}',
'.ot-chip{display:inline-block;font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;background:var(--bg-pill,#f1efe9);margin-right:6px}',
'.ot-chip.due{background:#fff4e5;color:#7a4b00}.ot-chip.late{background:#c0392b;color:#fff}.ot-chip.new{background:#e8f6ee;color:#1f8a4c}',
'.ot-why{font-size:13px;margin:8px 0 6px;color:var(--ink-soft)}',
'.ot-msg{width:100%;min-height:96px;border:1px solid var(--line);border-radius:12px;padding:10px 12px;font:inherit;font-size:13.5px;background:var(--bg,#fafaf7);color:inherit;resize:vertical;box-sizing:border-box}',
'.ot-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}',
'.ot-btns button,.ot-btns a{border:1px solid var(--line);background:var(--bg-pill,#f1efe9);color:inherit;border-radius:999px;padding:8px 14px;font-weight:700;font-size:13px;cursor:pointer;text-decoration:none}',
'.ot-btns .wa{background:#25D366;border-color:#25D366;color:#0b1f12}.ot-btns .go{background:#111;border-color:#111;color:#fff}',
'.ot-empty{padding:22px;text-align:center;color:var(--ink-soft);border:1px dashed var(--line);border-radius:16px}',
'.ot-tpl summary{cursor:pointer;font-weight:700;padding:6px 2px}',
'.ot-filters{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 12px}',
'.ot-filters button{border:1px solid var(--line);background:var(--bg-pill,#f1efe9);border-radius:999px;padding:7px 14px;font-weight:700;font-size:12.5px;cursor:pointer;color:inherit}',
'.ot-filters button.on{background:#111;color:#fff;border-color:#111}',
'.ot-code{font-family:ui-monospace,Menlo,monospace;font-weight:800;letter-spacing:.03em}'
].join('\n');
D.head.appendChild(css);

var row = D.querySelector('.tab-row');
row.insertAdjacentHTML('afterbegin', '<button class="tab-chip" data-tab="today">🔥 Today</button>');
D.querySelector('.tab-chip[data-tab="email"]').insertAdjacentHTML('afterend', '<button class="tab-chip" data-tab="past">💛 Past clients</button>');
$('tabLeads').insertAdjacentHTML('beforebegin', '<div class="tab-panel" id="tabToday"><div id="otBody"><div class="ot-empty">Connecting...</div></div></div>');
$('tabEmail').insertAdjacentHTML('afterend', '<div class="tab-panel" id="tabPast"><div id="pcBody"><div class="ot-empty">Open this tab after signing in to see your past clients.</div></div></div>');
[].forEach.call(D.querySelectorAll('.tab-chip[data-tab="today"],.tab-chip[data-tab="past"]'), function(chip){
  chip.addEventListener('click', function(){
    D.querySelectorAll('.tab-chip').forEach(function(c){ c.classList.toggle('on', c === chip); });
    D.querySelectorAll('.tab-panel').forEach(function(p){ p.classList.toggle('on', p.id === 'tab' + chip.dataset.tab.charAt(0).toUpperCase() + chip.dataset.tab.slice(1)); });
    try{ localStorage.setItem('fom.leads.tab', chip.dataset.tab); }catch(e){}
    if(chip.dataset.tab === 'past') PC.load();
    else OT.render();
  });
});
// the existing chips should also remember the tab
D.querySelectorAll('.tab-chip').forEach(function(c){ c.addEventListener('click', function(){ try{ localStorage.setItem('fom.leads.tab', c.dataset.tab); }catch(e){} }); });
// open on Today by default (or the last tab used)
setTimeout(function(){ var t = 'today'; try{ t = localStorage.getItem('fom.leads.tab') || 'today'; }catch(e){} var c = D.querySelector('.tab-chip[data-tab="' + t + '"]'); if(c) c.click(); }, 0);

/* ============================================================
   TODAY
   ============================================================ */
var TPL_DEF = "Hi {company} team 👋 I'm Ishaaq from FOM Studios, a photography and videography studio in Joburg.\n\n{opener}\n\nYou can see our work here: {link}\n\nWould it be okay if I send you a quick idea and quote? 📸";
var OT = {
  tpl: LSget('fom.ot.tpl' + SUF, TPL_DEF),
  skip: LSget('fom.ot.skip' + SUF, {}),
  imported: false, importing: false, pack: null,
  key: function(o){ return (String(o.company || '').toLowerCase().replace(/[^a-z0-9]/g, '') || '') + '|' + String(o.web || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, ''); },
  msg: function(o){
    var opener = o.opener || ('We shoot ' + ((o.category || 'business').toLowerCase()) + ' content in Gauteng, and I think we could make something great for you.');
    return OT.tpl.replace(/\{company\}/g, o.company || 'there').replace(/\{opener\}/g, opener).replace(/\{link\}/g, SITE_LINK).replace(/\{contact\}/g, first(o.contact) || 'there');
  },
  contactedToday: function(){ var t = iso(); return leads.filter(function(o){ return o.dateEmailed === t && o.status === 'Emailed'; }).length; },
  importPack: async function(){
    if(OT.importing || OT.imported || typeof store === 'undefined' || !store || !DB) return;
    OT.importing = true;
    try{
      var r = await fetch('leads/pack' + SUF + '.json?t=' + Date.now(), { cache:'no-store' });
      OT.pack = r.ok ? await r.json() : null;
      if(OT.pack && Array.isArray(OT.pack.leads)){
        var have = {}; leads.forEach(function(o){ have[OT.key(o)] = 1; have[String(o.company || '').toLowerCase().replace(/[^a-z0-9]/g, '')] = 1; });
        var added = 0;
        OT.pack.leads.forEach(function(x){
          var k = OT.key(x), kc = String(x.company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          if(!x.company || have[k] || have[kc]) return;
          have[k] = have[kc] = 1; added++;
          store.add(blankLead({ company:x.company, contact:x.contact || '', email:x.email || '', web:x.web || '', phone:x.phone || '', instagram:igHandle(x.instagram),
            location:x.location || '', category:x.category || '', status:'Not Emailed', source:'claude', why:x.why || '', opener:x.opener || '', addedWeek:OT.pack.generatedAt || '',
            comments:'Found by Claude ' + iso() + (x.why ? ': ' + x.why : '') }));
        });
        if(added) toast(added + ' new leads from Claude added');
      }
      OT.imported = true;
    }catch(e){ console.warn('leads pack', e); }
    OT.importing = false;
  },
  lists: function(){
    var t = iso(), sk = OT.skip[t] || [];
    var follow = leads.filter(function(o){ return o.status === 'Emailed' && o.followUp && o.followUp <= t; })
      .sort(function(a, b){ return String(a.followUp).localeCompare(String(b.followUp)); });
    var left = Math.max(0, DAILY - OT.contactedToday());
    var fresh = leads.filter(function(o){ return o.status === 'Not Emailed' && o.source !== 'website' && sk.indexOf(o.id) < 0 && (o.company || o.contact); })
      .sort(function(a, b){ return (b.source === 'claude') - (a.source === 'claude') || String(a.addedWeek || '').localeCompare(String(b.addedWeek || '')); })
      .slice(0, left);
    var doneToday = leads.filter(function(o){ return o.dateEmailed === t && o.status === 'Emailed'; });
    return { follow:follow, fresh:fresh, done:doneToday, left:left };
  },
  card: function(o, kind){
    var t = iso(), late = kind === 'follow' && o.followUp < t;
    var ph = intl(o.phone), ig = igHandle(o.instagram || (/instagram\.com/i.test(o.web || '') ? o.web : '')), em = o.email;
    var msg = kind === 'follow' ? OT.follow(o) : OT.msg(o);
    var chip = kind === 'follow' ? '<span class="ot-chip ' + (late ? 'late' : 'due') + '">Follow up' + (late ? ', ' + Math.round((new Date(t) - new Date(o.followUp)) / 864e5) + 'd late' : ' today') + '</span>'
      : kind === 'done' ? '<span class="ot-chip">Contacted today' + (o.contactedVia ? ' by ' + esc(o.contactedVia) : '') + '</span>'
      : '<span class="ot-chip new">' + (o.source === 'claude' ? 'New from Claude' : 'Not contacted') + '</span>';
    var web = o.web && !/instagram\.com/i.test(o.web) ? '<a href="' + esc(/^https?:/i.test(o.web) ? o.web : 'https://' + o.web) + '" target="_blank" rel="noopener">website</a>' : '';
    return '<div class="ot-card' + (kind === 'done' ? ' done' : '') + '" data-id="' + esc(o.id) + '" data-kind="' + kind + '"><div class="ot-row"><div><div class="ot-name">' + esc(o.company || o.contact) + '</div>' +
      '<div class="ot-sub">' + [esc(o.category), esc(o.location), web, ph ? '+' + ph : '', ig ? '@' + esc(ig) : '', em ? esc(em) : ''].filter(Boolean).join(' · ') + '</div></div><div>' + chip + '</div></div>' +
      (o.why ? '<div class="ot-why">💡 ' + esc(o.why) + '</div>' : '') +
      (kind === 'done' ? '' : '<textarea class="ot-msg" data-k="msg">' + esc(msg) + '</textarea><div class="ot-btns">' +
        (ph ? '<button type="button" class="wa" data-a="wa">WhatsApp</button>' : '') +
        (ig ? '<button type="button" data-a="ig">Instagram DM</button>' : '') +
        (em ? '<button type="button" data-a="em">Email</button>' : '') +
        '<button type="button" data-a="copy">Copy</button>' +
        '<button type="button" class="go" data-a="done">' + (kind === 'follow' ? 'Followed up' : 'Contacted') + '</button>' +
        (kind === 'follow' ? '<button type="button" data-a="replied">They replied</button><button type="button" data-a="stop">No reply, stop</button>' : '<button type="button" data-a="skip">Skip today</button>') +
        '<button type="button" data-a="open">Details</button></div>') + '</div>';
  },
  follow: function(o){ return 'Hi ' + (first(o.contact) || (o.company ? o.company + ' team' : 'there')) + ', just following up on my message about photos and video for ' + (o.company || 'you') + '. Happy to send a quick idea and price if it helps. Have a great week! Ishaaq, FOM Studios 📸'; },
  render: function(){
    var host = $('otBody'); if(!host) return;
    if(typeof store === 'undefined' || !store || !DB){ host.innerHTML = '<div class="ot-empty">Sign in to see today\'s list.</div>'; return; }
    if(!OT.imported) OT.importPack();
    var L = OT.lists(), done = L.done.length, pct = Math.min(100, Math.round(done / DAILY * 100));
    var focus = D.activeElement && host.contains(D.activeElement) && D.activeElement.dataset.k === 'msg';
    if(focus) return;   // do not wipe a message being edited
    var packLine = OT.pack && OT.pack.generatedAt ? 'Claude added new leads on ' + nice(OT.pack.generatedAt) + '. Next batch: Monday morning.' : 'Claude adds about 30 new Gauteng leads every Monday morning.';
    host.innerHTML =
      '<div class="ot-top"><div class="ot-goal"><div class="ot-sub">Today\'s goal</div><b>' + done + ' of ' + DAILY + '</b> contacted<div class="ot-bar"><i style="width:' + pct + '%"></i></div></div>' +
      '<div class="ot-goal"><div class="ot-sub">Follow-ups due</div><b>' + L.follow.length + '</b><div class="ot-sub" style="margin-top:6px">' + packLine + '</div></div></div>' +
      '<details class="ot-tpl"><summary>✏️ Edit the first message</summary><p class="ot-sub">Use {company}, {contact}, {opener} (Claude\'s line about that business) and {link} (your website, tracked as outreach on the Traffic page).</p><textarea class="ot-msg" id="otTpl" style="min-height:140px">' + esc(OT.tpl) + '</textarea><div class="ot-btns"><button type="button" class="go" id="otTplSave">Save message</button><button type="button" id="otTplReset">Reset</button></div></details>' +
      (L.follow.length ? '<div class="ot-h">Follow-ups due</div>' + L.follow.map(function(o){ return OT.card(o, 'follow'); }).join('') : '') +
      '<div class="ot-h">Contact today' + (L.left < DAILY ? ' (' + L.left + ' left)' : '') + '</div>' +
      (L.fresh.length ? L.fresh.map(function(o){ return OT.card(o, 'new'); }).join('') : '<div class="ot-empty">' + (L.left ? 'No uncontacted leads left. New ones arrive on Monday, or add your own on the Leads Tracker tab.' : 'Goal reached for today. Well done! 🎉') + '</div>') +
      (done ? '<div class="ot-h">Done today</div>' + L.done.map(function(o){ return OT.card(o, 'done'); }).join('') : '');
    $('otTplSave').onclick = function(){ OT.tpl = $('otTpl').value; LSset('fom.ot.tpl' + SUF, OT.tpl); OT.saveCfg(); toast('Message saved'); OT.render(); };
    $('otTplReset').onclick = function(){ $('otTpl').value = TPL_DEF; };
  },
  saveCfg: function(){ if(DB) DB.collection('settings').doc(BZ.sid('outreachToday')).set({ json:JSON.stringify({ tpl:OT.tpl }) }, { merge:true }).catch(function(){}); },
  loadCfg: function(){ if(!DB) return; DB.collection('settings').doc(BZ.sid('outreachToday')).get().then(function(d){ if(d.exists){ var j = JSON.parse(d.data().json || '{}'); if(j.tpl){ OT.tpl = j.tpl; LSset('fom.ot.tpl' + SUF, OT.tpl); OT.render(); } } }).catch(function(){}); },
  mark: function(o, via, kind){
    var t = iso();
    o.status = 'Emailed'; o.emailed = 'Yes'; o.dateEmailed = t; o.contactedVia = via || o.contactedVia || '';
    o.followUp = kind === 'follow' ? '' : addDays(t, FOLLOW_DAYS);
    if(kind === 'follow'){ o.followedUp = t; o.comments = (o.comments ? o.comments + '\n' : '') + 'Followed up ' + t; }
    store.update(o.id); safeRenderLeads();
  }
};
$('otBody').addEventListener('click', async function(e){
  var b = e.target.closest('[data-a]'), c = e.target.closest('.ot-card'); if(!b || !c) return;
  var o = leads.find(function(x){ return x.id === c.dataset.id; }); if(!o) return;
  var a = b.dataset.a, kind = c.dataset.kind, ta = c.querySelector('[data-k=msg]'), msg = ta ? ta.value : '';
  if(a === 'wa'){ window.open('https://wa.me/' + intl(o.phone) + '?text=' + encodeURIComponent(msg), '_blank'); OT.mark(o, 'WhatsApp', kind); }
  if(a === 'ig'){ await copy(msg); toast('Message copied. Paste it in the DM.'); window.open('https://instagram.com/' + igHandle(o.instagram || o.web), '_blank'); OT.mark(o, 'Instagram', kind); }
  if(a === 'em'){ location.href = 'mailto:' + encodeURIComponent(o.email) + '?subject=' + encodeURIComponent('Photos and video for ' + (o.company || 'you')) + '&body=' + encodeURIComponent(msg); OT.mark(o, 'Email', kind); }
  if(a === 'copy'){ await copy(msg); toast('Copied'); }
  if(a === 'done') OT.mark(o, o.contactedVia || '', kind);
  if(a === 'skip'){ var t = iso(); OT.skip = { }; OT.skip[t] = (LSget('fom.ot.skip' + SUF, {})[t] || []).concat(o.id); LSset('fom.ot.skip' + SUF, OT.skip); OT.render(); }
  if(a === 'replied'){ o.status = 'Responded'; o.followUp = ''; store.update(o.id); safeRenderLeads(); toast('Nice! Marked as Responded.'); }
  if(a === 'stop'){ o.followUp = ''; o.comments = (o.comments ? o.comments + '\n' : '') + 'No reply after follow-up ' + iso(); store.update(o.id); safeRenderLeads(); }
  if(a === 'open'){ D.querySelector('.tab-chip[data-tab="leads"]').click(); if(typeof openLead === 'function') openLead(o.id); }
});

/* re-draw Today whenever the leads list changes */
var _orig = window.safeRenderLeads;
window.safeRenderLeads = function(){ _orig(); try{ OT.render(); }catch(e){ console.warn(e); } };
var waitDb = setInterval(function(){ if(typeof DB !== 'undefined' && DB && typeof store !== 'undefined' && store){ clearInterval(waitDb); OT.loadCfg(); setTimeout(function(){ OT.render(); }, 1200); } }, 400);

/* ============================================================
   PAST CLIENTS (win-back + referral codes)
   ============================================================ */
var PC_TPL_DEF = "Hi {first}! 😊 It's Ishaaq from FOM Studios. Thank you again for choosing us for your {product}.\n\nThe festive season is here, so if you'd like family photos, a year-end shoot or a gift session for someone special, I'd love to work with you again.\n\nAlso, share your code {code} with a friend: they get 10% off their first shoot, and you get 10% off your next one. 📸\n\nwww.fomstudios.co.za/?src=wa";
var PC = {
  orders: null, refs: { codes:{}, msgd:{} }, filter: 'all', tpl: LSget('fom.pc.tpl' + SUF, PC_TPL_DEF), loading: false,
  load: async function(){
    var host = $('pcBody');
    if(!DB){ host.innerHTML = '<div class="ot-empty">Sign in first.</div>'; return; }
    if(PC.orders){ PC.render(); return; }
    if(PC.loading) return; PC.loading = true; host.innerHTML = '<div class="ot-empty">Loading your clients...</div>';
    try{
      var s = await DB.collection('orders').get();
      PC.orders = BZ.mine(s.docs.map(function(d){ var x = d.data(); x.id = d.id; return x; }));
      var r = await DB.collection('settings').doc(BZ.sid('referrals')).get();
      if(r.exists){ var j = JSON.parse(r.data().json || '{}'); PC.refs = { codes:j.codes || {}, msgd:j.msgd || {} }; if(j.tpl) PC.tpl = j.tpl; }
    }catch(e){ host.innerHTML = '<div class="ot-empty">Could not load clients: ' + esc(e.message) + '</div>'; PC.loading = false; return; }
    PC.loading = false; PC.render();
  },
  save: function(){ if(DB) DB.collection('settings').doc(BZ.sid('referrals')).set({ json:JSON.stringify({ codes:PC.refs.codes, msgd:PC.refs.msgd, tpl:PC.tpl }) }).catch(function(e){ toast('Could not save: ' + e.message); }); },
  clients: function(){
    var map = {};
    (PC.orders || []).forEach(function(o){
      if(o.status === 'Cancelled' || !(o.customer || o.clientPhone || o.clientEmail)) return;
      var k = intl(o.clientPhone) || String(o.clientEmail || '').toLowerCase() || String(o.customer || '').toLowerCase().trim();
      var c = map[k] = map[k] || { key:k, name:'', phone:'', email:'', last:'', product:'', n:0, spent:0 };
      c.n++; c.spent += +o.total || 0;
      var d = String(o.shootDate || '').slice(0, 10);
      if(!c.last || d > c.last){ c.last = d; c.product = o.product || c.product; }
      c.name = c.name || o.customer || ''; c.phone = c.phone || o.clientPhone || ''; c.email = c.email || o.clientEmail || '';
    });
    return Object.keys(map).map(function(k){ return map[k]; });
  },
  codeFor: function(c){
    for(var code in PC.refs.codes){ if(PC.refs.codes[code].key === c.key) return code; }
    var base = 'FRIEND-' + (first(c.name).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) || 'FOM'), code = base, i = 2;
    while(PC.refs.codes[code]) code = base + (i++);
    PC.refs.codes[code] = { key:c.key, name:c.name, created:iso(), friends:[], rewardsUsed:0 };
    PC.dirty = true;
    return code;
  },
  months: function(d){ if(!d) return null; return Math.max(0, Math.floor((new Date(iso()) - new Date(d)) / (30.4 * 864e5))); },
  render: function(){
    var host = $('pcBody'), t = iso();
    var all = PC.clients().filter(function(c){ return !c.last || c.last <= t; });
    var list = all.filter(function(c){ var m = PC.months(c.last);
      return PC.filter === 'all' ? true : PC.filter === 'quiet' ? (m == null || m >= 3) : PC.filter === 'todo' ? !PC.refs.msgd[c.key] : PC.filter === 'owed' ? PC.owed(c) > 0 : true; })
      .sort(function(a, b){ return String(a.last).localeCompare(String(b.last)); });
    var f = function(k, l){ return '<button type="button" data-f="' + k + '" class="' + (PC.filter === k ? 'on' : '') + '">' + l + '</button>'; };
    var owedN = all.filter(function(c){ return PC.owed(c) > 0; }).length;
    var focus = D.activeElement && host.contains(D.activeElement) && D.activeElement.dataset.k === 'msg';
    if(focus) return;
    host.innerHTML =
      '<div class="ot-top"><div class="ot-goal"><div class="ot-sub">Past clients</div><b>' + all.length + '</b><div class="ot-sub" style="margin-top:6px">' + Object.keys(PC.refs.msgd).length + ' messaged so far</div></div>' +
      '<div class="ot-goal"><div class="ot-sub">Referral rewards owed</div><b>' + owedN + '</b><div class="ot-sub" style="margin-top:6px">10% off their next shoot</div></div></div>' +
      '<details class="ot-tpl"><summary>✏️ Edit the message</summary><p class="ot-sub">Use {first}, {name}, {product}, {code} and {months} (months since their last shoot).</p><textarea class="ot-msg" id="pcTpl" style="min-height:160px">' + esc(PC.tpl) + '</textarea><div class="ot-btns"><button type="button" class="go" id="pcTplSave">Save message</button><button type="button" id="pcTplReset">Reset</button></div></details>' +
      '<div class="ot-filters">' + f('all', 'All') + f('quiet', '3+ months quiet') + f('todo', 'Not messaged yet') + f('owed', 'Reward owed') + '</div>' +
      (list.length ? list.map(PC.card).join('') : '<div class="ot-empty">Nobody here. Clients come from the Order Database.</div>');
    if(PC.dirty){ PC.dirty = false; PC.save(); }
    $('pcTplSave').onclick = function(){ PC.tpl = $('pcTpl').value; LSset('fom.pc.tpl' + SUF, PC.tpl); PC.save(); toast('Message saved'); PC.render(); };
    $('pcTplReset').onclick = function(){ $('pcTpl').value = PC_TPL_DEF; };
  },
  owed: function(c){ var code = null; for(var k in PC.refs.codes){ if(PC.refs.codes[k].key === c.key) code = PC.refs.codes[k]; } return code ? (code.friends || []).length - (code.rewardsUsed || 0) : 0; },
  card: function(c){
    var code = PC.codeFor(c), r = PC.refs.codes[code], m = PC.months(c.last), ph = intl(c.phone), msgd = PC.refs.msgd[c.key], owed = PC.owed(c);
    var msg = PC.tpl.replace(/\{first\}/g, first(c.name) || 'there').replace(/\{name\}/g, c.name || '').replace(/\{product\}/g, (c.product || 'shoot').toLowerCase().indexOf('shoot') >= 0 ? (c.product || 'shoot') : (c.product + ' shoot')).replace(/\{code\}/g, code).replace(/\{months\}/g, m == null ? '' : m);
    return '<div class="ot-card" data-key="' + esc(c.key) + '" data-code="' + esc(code) + '"><div class="ot-row"><div><div class="ot-name">' + esc(c.name || 'Client') + '</div>' +
      '<div class="ot-sub">' + [c.product ? esc(c.product) : '', c.last ? 'Last shoot ' + nice(c.last) + (m != null ? ' (' + (m === 0 ? 'this month' : m + ' month' + (m === 1 ? '' : 's') + ' ago') + ')' : '') : '', c.n > 1 ? c.n + ' shoots' : '', ph ? '+' + ph : ''].filter(Boolean).join(' · ') + '</div></div>' +
      '<div>' + (msgd ? '<span class="ot-chip">Messaged ' + nice(msgd) + '</span>' : '') + (owed > 0 ? '<span class="ot-chip due">Reward owed x' + owed + '</span>' : '') + '</div></div>' +
      '<div class="ot-why">Referral code <span class="ot-code">' + esc(code) + '</span>' + ((r.friends || []).length ? ', ' + r.friends.length + ' friend' + (r.friends.length === 1 ? '' : 's') + ' booked' : '') + '</div>' +
      '<textarea class="ot-msg" data-k="msg">' + esc(msg) + '</textarea><div class="ot-btns">' +
      (ph ? '<button type="button" class="wa" data-a="wa">WhatsApp</button>' : '') +
      (c.email ? '<button type="button" data-a="em">Email</button>' : '') +
      '<button type="button" data-a="copy">Copy</button>' +
      '<button type="button" data-a="friend">A friend booked</button>' +
      (owed > 0 ? '<button type="button" class="go" data-a="used">Reward used</button>' : '') + '</div></div>';
  }
};
$('pcBody').addEventListener('click', async function(e){
  var fb = e.target.closest('[data-f]'); if(fb){ PC.filter = fb.dataset.f; PC.render(); return; }
  var b = e.target.closest('[data-a]'), c = e.target.closest('.ot-card'); if(!b || !c) return;
  var cl = PC.clients().find(function(x){ return x.key === c.dataset.key; }), code = c.dataset.code, r = PC.refs.codes[code]; if(!cl || !r) return;
  var msg = c.querySelector('[data-k=msg]').value, a = b.dataset.a;
  if(a === 'wa'){ window.open('https://wa.me/' + intl(cl.phone) + '?text=' + encodeURIComponent(msg), '_blank'); PC.refs.msgd[cl.key] = iso(); PC.save(); PC.render(); }
  if(a === 'em'){ location.href = 'mailto:' + encodeURIComponent(cl.email) + '?subject=' + encodeURIComponent('A festive hello from FOM Studios') + '&body=' + encodeURIComponent(msg); PC.refs.msgd[cl.key] = iso(); PC.save(); PC.render(); }
  if(a === 'copy'){ await copy(msg); toast('Copied'); PC.refs.msgd[cl.key] = PC.refs.msgd[cl.key] || iso(); PC.save(); PC.render(); }
  if(a === 'friend'){ var who = prompt('Who booked with ' + code + '? (name, optional)', ''); if(who === null) return; r.friends = (r.friends || []).concat({ name:who, date:iso() }); PC.save(); PC.render(); toast((first(cl.name) || 'They') + ' now get 10% off their next shoot'); }
  if(a === 'used'){ r.rewardsUsed = (r.rewardsUsed || 0) + 1; PC.save(); PC.render(); }
});
window.FOM_OT = OT; window.FOM_PC = PC;
})();
