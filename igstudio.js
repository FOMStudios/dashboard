/* ============================================================
   FOM STUDIOS - Instagram Studio (tabs on the Content Planner, Nov 2026)
   🎥 This week: the weekly pack Claude writes every Monday
      (content/ig-pack.json): reel and carousel ideas with 3 hooks,
      the script beats, on-screen text, shot list, caption, keywords
      to say out loud, and the day to post. Pick a hook, copy, add to
      the Posting Tracker.
   🪝 Hooks: proven hook formulas for a photo and video studio, the
      hooks from every pack, and your own. Star the ones you like.
   📊 Scorecard: log how each post did. It ranks them, shows which
      hooks and formats work, and sends the summary to the repo
      (content/ig-scores.json) so next week's pack learns from it.
   State: Firestore settings/igStudio (settings/igStudio_sba).
   Uses the Content Planner globals: store, items, toast, blankItem.
   ============================================================ */
(function(){
'use strict';
var D = document, BZ = window.FOM_BIZ, SUF = BZ.isSba ? '_sba' : '';
var WORKER = 'https://fom-gallery.cold-moon-d65c.workers.dev';
var DB = null;
function $(id){ return D.getElementById(id); }
function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function iso(d){ return (d || new Date()).toLocaleDateString('en-CA', { timeZone:'Africa/Johannesburg' }); }
function nice(s){ try{ return new Date(String(s).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-ZA', { weekday:'short', day:'numeric', month:'short' }); }catch(e){ return s; } }
async function copy(t){ try{ await navigator.clipboard.writeText(t); }catch(e){ var a = D.createElement('textarea'); a.value = t; D.body.appendChild(a); a.select(); try{ D.execCommand('copy'); }catch(x){} a.remove(); } toast('Copied'); }
function num(v){ v = String(v || '').replace(/[\s,]/g, '').toLowerCase(); var m = 1; if(/k$/.test(v)){ m = 1000; v = v.slice(0, -1); } if(/m$/.test(v)){ m = 1e6; v = v.slice(0, -1); } return Math.round((+v || 0) * m); }
function short(n){ return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e5 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n); }

var ST = { picked:{}, added:{}, done:{}, hooks:[], stars:{}, scores:[] };
var PACK = null;

/* proven hook formulas, written for a Joburg photo and video studio */
var FORMULAS = [
  ['Raw vs edit', 'This is what the client saw on the day... and this is what they got 👀'],
  ['Mistake', 'The one mistake that ruins most {shoot type} photos'],
  ['POV', 'POV: you booked a photographer who actually tells you how to pose'],
  ['Price reveal', 'What R500 gets you at FOM Studios'],
  ['Location secret', 'The most underrated photo spot in Joburg (save this)'],
  ['Before the drop', 'Wait for the beat drop 🔥'],
  ['Countdown', '3 things I always do before a {shoot type} shoot'],
  ['Hot take', 'Unpopular opinion: you do not need golden hour for great photos'],
  ['Behind the scenes', 'How we got this shot with one light and a phone torch'],
  ['Client reaction', 'Her reaction when she saw the first photo 🥹'],
  ['Challenge', 'Same location, three different photographers. Which one wins?'],
  ['Myth', 'Stop saying you are not photogenic. Watch this'],
  ['Loading bar', 'Shoot loading... 0% to 100%'],
  ['Question', 'Would you book this for your matric farewell?'],
  ['Story', 'This shoot almost did not happen'],
  ['Numbers', '1 car, 30 minutes, 1 reel. Here is how'],
  ['Local', 'If you live in Joburg, you need to see this'],
  ['Gift', 'The Christmas gift that will not end up in a drawer']
];

/* ---------- tabs ---------- */
var css = D.createElement('style');
css.textContent = [
'.ig-card{background:var(--surface,#fff);border:1px solid var(--line);border-radius:18px;padding:16px;margin-bottom:14px}',
'.ig-card.done{opacity:.55}',
'.ig-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}',
'.ig-t{font-weight:800;font-size:17px}.ig-sub{font-size:12.5px;color:var(--ink-soft);margin-top:3px}',
'.ig-chip{display:inline-block;font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;background:var(--bg-pill,#f1efe9);margin:0 6px 4px 0}',
'.ig-chip.day{background:#111;color:#fff}.ig-chip.camp{background:#fff4e5;color:#7a4b00}',
'.ig-sec{margin-top:12px}.ig-sec h4{margin:0 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft)}',
'.ig-hook{display:flex;gap:10px;align-items:flex-start;padding:9px 11px;border:1px solid var(--line);border-radius:12px;margin-bottom:6px;cursor:pointer;font-size:14px}',
'.ig-hook.on{border-color:#111;background:var(--bg-pill,#f1efe9);font-weight:700}',
'.ig-hook small{display:block;color:var(--ink-soft);font-weight:500;font-size:11.5px}',
'.ig-pre{white-space:pre-wrap;font-family:inherit;font-size:13.5px;background:var(--bg,#fafaf7);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:0}',
'.ig-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}',
'.ig-btns button{border:1px solid var(--line);background:var(--bg-pill,#f1efe9);color:inherit;border-radius:999px;padding:8px 14px;font-weight:700;font-size:13px;cursor:pointer}',
'.ig-btns .go{background:#111;border-color:#111;color:#fff}',
'.ig-empty{padding:22px;text-align:center;color:var(--ink-soft);border:1px dashed var(--line);border-radius:16px}',
'.ig-hrow{display:flex;gap:10px;align-items:center;padding:10px 12px;border:1px solid var(--line);border-radius:12px;margin-bottom:6px;background:var(--surface,#fff)}',
'.ig-hrow b{flex:1;font-weight:600;font-size:14px}.ig-hrow small{color:var(--ink-soft);font-size:11px;display:block;font-weight:500}',
'.ig-hrow button{border:0;background:none;font-size:18px;cursor:pointer;padding:4px}',
'.ig-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:10px 0}',
'.ig-form input,.ig-form select{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:10px;padding:9px 10px;font:inherit;font-size:13.5px;background:var(--bg,#fafaf7);color:inherit}',
'.ig-form label{font-size:11.5px;font-weight:700;color:var(--ink-soft);display:block;margin-bottom:3px}',
'.ig-table{width:100%;border-collapse:collapse;font-size:13px}.ig-table th,.ig-table td{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}.ig-table td.n{text-align:right;white-space:nowrap}',
'.ig-wins{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:14px}',
'.ig-win{background:var(--surface,#fff);border:1px solid var(--line);border-radius:16px;padding:12px 14px}.ig-win b{font-size:18px;display:block;margin-top:4px}'
].join('\n');
D.head.appendChild(css);

var row = D.querySelector('.tab-row');
row.insertAdjacentHTML('beforeend', '<button class="tab-chip" data-tab="igweek">🎥 This week</button><button class="tab-chip" data-tab="ighooks">🪝 Hooks</button><button class="tab-chip" data-tab="igscore">📊 Scorecard</button>');
$('tabAdvisor').insertAdjacentHTML('afterend', '<div class="tab-panel" id="tabIgweek"><div id="igWeek"><div class="ig-empty">Loading this week\'s ideas...</div></div></div>' +
  '<div class="tab-panel" id="tabIghooks"><div id="igHooks"></div></div><div class="tab-panel" id="tabIgscore"><div id="igScore"></div></div>');
D.querySelectorAll('.tab-row > .tab-chip').forEach(function(chip){
  chip.addEventListener('click', function(){
    D.querySelectorAll('.tab-row > .tab-chip').forEach(function(c){ c.classList.toggle('on', c === chip); });
    D.querySelectorAll('.page > .tab-panel, .tab-panel').forEach(function(p){ p.classList.toggle('on', p.id === 'tab' + chip.dataset.tab.charAt(0).toUpperCase() + chip.dataset.tab.slice(1)); });
    try{ localStorage.setItem('fom.content.tab', chip.dataset.tab); }catch(e){}
    if(/^ig/.test(chip.dataset.tab)) drawAll();
  });
});
setTimeout(function(){ var t = null; try{ t = localStorage.getItem('fom.content.tab'); }catch(e){} var c = t && D.querySelector('.tab-row > .tab-chip[data-tab="' + t + '"]'); if(c) c.click(); }, 0);

/* ---------- state ---------- */
function saveState(){ try{ localStorage.setItem('fom.ig' + SUF, JSON.stringify(ST)); }catch(e){} if(DB) DB.collection('settings').doc('igStudio' + SUF).set({ json:JSON.stringify(ST) }).catch(function(e){ toast('Could not save: ' + e.message); }); }
try{ var c0 = JSON.parse(localStorage.getItem('fom.ig' + SUF)); if(c0) ST = Object.assign(ST, c0); }catch(e){}
function loadPack(){ return fetch('content/ig-pack' + SUF + '.json?t=' + Date.now(), { cache:'no-store' }).then(function(r){ return r.ok ? r.json() : null; }).then(function(p){ PACK = p; drawAll(); }).catch(function(){ PACK = null; drawAll(); }); }
loadPack();

/* ============ THIS WEEK ============ */
function drawWeek(){
  var host = $('igWeek'); if(!host) return;
  if(!PACK || !(PACK.ideas || []).length){ host.innerHTML = '<div class="ig-empty">No ideas yet. Claude writes a new set every Monday morning.</div>'; return; }
  var ideas = PACK.ideas.slice().sort(function(a, b){ return String(a.day || '').localeCompare(String(b.day || '')); });
  host.innerHTML = '<p class="ig-sub" style="margin:0 0 12px">Written ' + nice(PACK.generatedAt) + (PACK.headline ? '. ' + esc(PACK.headline) : '') + ' Next set: Monday morning.</p>' +
    ideas.map(function(x){
      var pick = ST.picked[x.id] != null ? ST.picked[x.id] : 0, hooks = x.hooks || [];
      return '<div class="ig-card' + (ST.done[x.id] ? ' done' : '') + '" data-id="' + esc(x.id) + '"><div class="ig-top"><div><div class="ig-t">' + esc(x.title) + '</div><div class="ig-sub">' + esc(x.why || '') + '</div></div>' +
        '<div>' + (x.day ? '<span class="ig-chip day">Post ' + nice(x.day) + '</span>' : '') + '<span class="ig-chip">' + esc(x.format || 'Reel') + (x.length ? ', ' + esc(x.length) : '') + '</span>' + (x.campaign ? '<span class="ig-chip camp">' + esc(x.campaign) + '</span>' : '') + (ST.added[x.id] ? '<span class="ig-chip">In tracker</span>' : '') + '</div></div>' +
        '<div class="ig-sec"><h4>Pick a hook (first second)</h4>' + hooks.map(function(h, i){ return '<div class="ig-hook' + (i === pick ? ' on' : '') + '" data-hook="' + i + '"><span>' + (i === pick ? '●' : '○') + '</span><span>' + esc(h.text || h) + (h.formula ? '<small>' + esc(h.formula) + '</small>' : '') + '</span></div>'; }).join('') + '</div>' +
        (x.beats && x.beats.length ? '<div class="ig-sec"><h4>Script and beats</h4><pre class="ig-pre">' + esc(x.beats.map(function(b){ return (b.t ? b.t + '  ' : '') + (b.say || b.text || b); }).join('\n')) + '</pre></div>' : '') +
        (x.onScreen ? '<div class="ig-sec"><h4>On-screen text</h4><pre class="ig-pre">' + esc(x.onScreen) + '</pre></div>' : '') +
        (x.shots && x.shots.length ? '<div class="ig-sec"><h4>Shot list</h4><pre class="ig-pre">' + esc(x.shots.map(function(s){ return '• ' + s; }).join('\n')) + '</pre></div>' : '') +
        (x.keywords && x.keywords.length ? '<div class="ig-sec"><h4>Say these out loud and put them on screen</h4><div>' + x.keywords.map(function(k){ return '<span class="ig-chip">' + esc(k) + '</span>'; }).join('') + '</div></div>' : '') +
        '<div class="ig-sec"><h4>Caption</h4><pre class="ig-pre">' + esc(x.caption || '') + '</pre></div>' +
        '<div class="ig-btns"><button type="button" class="go" data-a="cap">Copy caption</button><button type="button" data-a="script">Copy script</button>' +
        (ST.added[x.id] ? '' : '<button type="button" data-a="add">Add to Posting Tracker</button>') +
        '<button type="button" data-a="star">⭐ Save hook</button><button type="button" data-a="done">' + (ST.done[x.id] ? 'Not done' : 'Posted') + '</button></div></div>';
    }).join('');
}
function ideaById(id){ return (PACK && PACK.ideas || []).find(function(x){ return x.id === id; }); }
function hookText(x){ var h = (x.hooks || [])[ST.picked[x.id] || 0]; return h ? (h.text || h) : ''; }
$('igWeek').addEventListener('click', function(e){
  var c = e.target.closest('.ig-card'); if(!c) return; var x = ideaById(c.dataset.id); if(!x) return;
  var hk = e.target.closest('[data-hook]'); if(hk){ ST.picked[x.id] = +hk.dataset.hook; saveState(); drawWeek(); return; }
  var b = e.target.closest('[data-a]'); if(!b) return;
  var a = b.dataset.a;
  if(a === 'cap') copy(x.caption || '');
  if(a === 'script') copy('HOOK: ' + hookText(x) + '\n\n' + (x.beats || []).map(function(b){ return (b.t ? b.t + '  ' : '') + (b.say || b.text || b); }).join('\n') + (x.onScreen ? '\n\nON SCREEN:\n' + x.onScreen : '') + (x.shots ? '\n\nSHOTS:\n' + x.shots.map(function(s){ return '- ' + s; }).join('\n') : ''));
  if(a === 'add'){
    if(typeof store === 'undefined' || !store){ toast('Still connecting, try again in a second.'); return; }
    var type = /carousel/i.test(x.format) ? 'Carousel' : /story/i.test(x.format) ? 'Story' : /photo/i.test(x.format) ? 'Photo' : 'Reel';
    store.add(blankItem({ title:x.title, type:type, platform:'Instagram', status:'Planned', targetDate:x.day || '', notes:'Hook: ' + hookText(x) + (x.caption ? '\n\nCaption:\n' + x.caption : '') }));
    ST.added[x.id] = iso(); saveState(); drawWeek(); toast('Added to the Posting Tracker');
  }
  if(a === 'star'){ var t = hookText(x); if(t && !ST.hooks.some(function(h){ return h.text === t; })) ST.hooks.unshift({ text:t, from:x.title, at:iso(), star:true }); saveState(); toast('Hook saved to your bank'); }
  if(a === 'done'){ ST.done[x.id] = ST.done[x.id] ? 0 : iso(); saveState(); drawWeek(); if(ST.done[x.id]) toast('Nice! Log its numbers on the Scorecard in 2 or 3 days.'); }
});

/* ============ HOOKS ============ */
function drawHooks(){
  var host = $('igHooks'); if(!host) return;
  var fromPacks = []; (PACK && PACK.ideas || []).forEach(function(x){ (x.hooks || []).forEach(function(h){ fromPacks.push({ text:h.text || h, from:x.title }); }); });
  var mine = ST.hooks;
  var best = topHooks();
  host.innerHTML =
    '<div class="ig-card"><div class="ig-t">Add your own hook</div><div class="ig-form" style="grid-template-columns:1fr auto"><input id="igHookNew" placeholder="e.g. Nobody tells you this about car photography"><div class="ig-btns" style="margin:0"><button type="button" class="go" id="igHookAdd">Add</button></div></div></div>' +
    (best.length ? '<h3 style="margin:18px 2px 8px">Your best performers</h3>' + best.map(function(h){ return row2(h.text, 'Score ' + h.score + ' from ' + h.n + ' post' + (h.n === 1 ? '' : 's'), null); }).join('') : '') +
    (mine.length ? '<h3 style="margin:18px 2px 8px">Saved</h3>' + mine.map(function(h, i){ return row2(h.text, h.from ? 'From: ' + h.from : 'Yours', i); }).join('') : '') +
    (fromPacks.length ? '<h3 style="margin:18px 2px 8px">From this week\'s pack</h3>' + fromPacks.map(function(h){ return row2(h.text, h.from, null); }).join('') : '') +
    '<h3 style="margin:18px 2px 8px">Formulas that work for studios</h3>' + FORMULAS.map(function(f){ return row2(f[1], f[0], null); }).join('');
  function row2(t, sub, i){ return '<div class="ig-hrow"><b>' + esc(t) + '<small>' + esc(sub || '') + '</small></b><button type="button" data-copy="' + esc(t) + '" title="Copy">📋</button>' + (i != null ? '<button type="button" data-del="' + i + '" title="Remove">🗑️</button>' : '<button type="button" data-keep="' + esc(t) + '" title="Save">⭐</button>') + '</div>'; }
  $('igHookAdd').onclick = function(){ var v = $('igHookNew').value.trim(); if(!v) return; ST.hooks.unshift({ text:v, at:iso() }); saveState(); drawHooks(); };
}
$('igHooks').addEventListener('click', function(e){
  var b = e.target.closest('button'); if(!b) return;
  if(b.dataset.copy) copy(b.dataset.copy);
  if(b.dataset.keep){ if(!ST.hooks.some(function(h){ return h.text === b.dataset.keep; })) ST.hooks.unshift({ text:b.dataset.keep, at:iso() }); saveState(); drawHooks(); toast('Saved'); }
  if(b.dataset.del != null){ ST.hooks.splice(+b.dataset.del, 1); saveState(); drawHooks(); }
});

/* ============ SCORECARD ============ */
/* score = what Instagram rewards most: sends (shares) and saves, then comments and follows, per 1,000 views */
function score(p){ var v = Math.max(p.views || 0, 1); return Math.round(((p.shares || 0) * 4 + (p.saves || 0) * 3 + (p.follows || 0) * 5 + (p.comments || 0) * 2 + (p.likes || 0) * 0.5) / v * 1000); }
function topHooks(){
  var by = {}; ST.scores.forEach(function(p){ if(!p.hook) return; var k = p.hook.trim(); var x = by[k] = by[k] || { text:k, sum:0, n:0 }; x.sum += score(p); x.n++; });
  return Object.keys(by).map(function(k){ var x = by[k]; return { text:x.text, n:x.n, score:Math.round(x.sum / x.n) }; }).sort(function(a, b){ return b.score - a.score; }).slice(0, 5);
}
function drawScore(){
  var host = $('igScore'); if(!host) return;
  var list = ST.scores.slice().sort(function(a, b){ return score(b) - score(a); });
  var fmt = {}; ST.scores.forEach(function(p){ var f = p.format || 'Reel'; var x = fmt[f] = fmt[f] || { s:0, n:0, v:0 }; x.s += score(p); x.n++; x.v += p.views || 0; });
  var fmts = Object.keys(fmt).map(function(k){ return { k:k, s:Math.round(fmt[k].s / fmt[k].n), v:Math.round(fmt[k].v / fmt[k].n), n:fmt[k].n }; }).sort(function(a, b){ return b.s - a.s; });
  var ideas = (PACK && PACK.ideas || []).map(function(x){ return '<option value="' + esc(x.id) + '">' + esc(x.title) + '</option>'; }).join('');
  host.innerHTML =
    '<div class="ig-card"><div class="ig-t">Log a post</div><div class="ig-sub">2 or 3 days after posting, copy the numbers from Instagram Insights. Type 12.5k for 12 500.</div>' +
    '<div class="ig-form"><div style="grid-column:1/-1"><label>Which post</label><select id="igSIdea"><option value="">My own post (type the title below)</option>' + ideas + '</select></div>' +
    '<div style="grid-column:1/-1"><label>Title</label><input id="igSTitle" placeholder="e.g. Raw vs edit, Golf GTI reel"></div>' +
    '<div style="grid-column:1/-1"><label>Hook used</label><input id="igSHook" placeholder="The first line or first second"></div>' +
    '<div><label>Format</label><select id="igSFmt"><option>Reel</option><option>Carousel</option><option>Photo</option><option>Story</option></select></div>' +
    '<div><label>Posted</label><input id="igSDate" type="date" value="' + iso() + '"></div>' +
    ['views','likes','comments','shares','saves','follows'].map(function(k){ return '<div><label>' + k.charAt(0).toUpperCase() + k.slice(1) + '</label><input id="igS_' + k + '" inputmode="decimal" placeholder="0"></div>'; }).join('') +
    '<div style="grid-column:1/-1"><label>Link (optional)</label><input id="igSLink" placeholder="https://www.instagram.com/reel/..."></div></div>' +
    '<div class="ig-btns"><button type="button" class="go" id="igSAdd">Save post</button></div></div>' +
    (list.length ? '<div class="ig-wins">' +
      '<div class="ig-win"><div class="ig-sub">Best post</div><b>' + esc(list[0].title) + '</b><div class="ig-sub">Score ' + score(list[0]) + ', ' + short(list[0].views || 0) + ' views</div></div>' +
      (fmts[0] ? '<div class="ig-win"><div class="ig-sub">Best format</div><b>' + esc(fmts[0].k) + '</b><div class="ig-sub">Average score ' + fmts[0].s + ', ' + short(fmts[0].v) + ' views (' + fmts[0].n + ' posts)</div></div>' : '') +
      (topHooks()[0] ? '<div class="ig-win"><div class="ig-sub">Best hook</div><b style="font-size:14px">' + esc(topHooks()[0].text) + '</b></div>' : '') +
      '</div><div class="ig-card" style="overflow-x:auto"><table class="ig-table"><thead><tr><th>Post</th><th class="n">Views</th><th class="n">Shares</th><th class="n">Saves</th><th class="n">Follows</th><th class="n">Score</th><th></th></tr></thead><tbody>' +
      list.map(function(p){ var i = ST.scores.indexOf(p); return '<tr><td><b>' + (p.link ? '<a href="' + esc(p.link) + '" target="_blank" rel="noopener">' + esc(p.title) + '</a>' : esc(p.title)) + '</b><div class="ig-sub">' + esc(p.format || '') + ', ' + nice(p.date) + (p.hook ? '<br>Hook: ' + esc(p.hook) : '') + '</div></td><td class="n">' + short(p.views || 0) + '</td><td class="n">' + (p.shares || 0) + '</td><td class="n">' + (p.saves || 0) + '</td><td class="n">' + (p.follows || 0) + '</td><td class="n"><b>' + score(p) + '</b></td><td><button type="button" data-sdel="' + i + '" style="border:0;background:none;cursor:pointer">🗑️</button></td></tr>'; }).join('') +
      '</tbody></table><p class="ig-sub" style="margin:10px 0 0">Score = shares x4, saves x3, follows x5, comments x2 and likes x0.5, per 1 000 views. Instagram pushes posts people send and save, so those count most. Claude reads your top posts each Monday.</p></div>'
      : '<div class="ig-empty">No posts logged yet. Log your next 5 posts and this shows what works.</div>');
  $('igSIdea').onchange = function(){ var x = ideaById(this.value); if(x){ $('igSTitle').value = x.title; $('igSHook').value = hookText(x); $('igSFmt').value = /carousel/i.test(x.format) ? 'Carousel' : 'Reel'; if(x.day) $('igSDate').value = x.day; } };
  $('igSAdd').onclick = function(){
    var p = { title:$('igSTitle').value.trim(), hook:$('igSHook').value.trim(), format:$('igSFmt').value, date:$('igSDate').value, link:$('igSLink').value.trim(), idea:$('igSIdea').value };
    if(!p.title){ toast('Add a title'); return; }
    ['views','likes','comments','shares','saves','follows'].forEach(function(k){ p[k] = num($('igS_' + k).value); });
    if(!p.views){ toast('Add the views'); return; }
    ST.scores.unshift(p); saveState(); sendScores(); drawScore(); toast('Saved. Score ' + score(p));
  };
}
$('igScore').addEventListener('click', function(e){ var b = e.target.closest('[data-sdel]'); if(!b) return; if(!confirm('Remove this post from the scorecard?')) return; ST.scores.splice(+b.dataset.sdel, 1); saveState(); sendScores(); drawScore(); });
/* share a short summary with next week's pack (through the gallery Worker, same GitHub link as the WhatsApp Group page) */
function sendScores(){
  try{
    var u = firebase.auth().currentUser; if(!u) return;
    var top = ST.scores.slice().sort(function(a, b){ return score(b) - score(a); }).slice(0, 20).map(function(p){ return { title:p.title, hook:p.hook, format:p.format, date:p.date, views:p.views, shares:p.shares, saves:p.saves, follows:p.follows, score:score(p) }; });
    u.getIdToken().then(function(t){ return fetch(WORKER + '/admin/channel-save', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + t }, body:JSON.stringify({ biz:BZ.id, kind:'ig', settings:{ updatedAt:new Date().toISOString(), posts:ST.scores.length, top:top, bestHooks:topHooks() } }) }); }).catch(function(){});
  }catch(e){}
}

function drawAll(){ try{ drawWeek(); drawHooks(); drawScore(); }catch(e){ console.warn('ig studio', e); } }
drawAll();

/* cloud state, once the Content Planner signs in (it calls loadAdvisor(db)) */
var _la = window.loadAdvisor;
window.loadAdvisor = function(db){
  DB = db;
  db.collection('settings').doc('igStudio' + SUF).get().then(function(d){ if(d.exists){ try{ ST = Object.assign({ picked:{}, added:{}, done:{}, hooks:[], stars:{}, scores:[] }, JSON.parse(d.data().json || '{}')); localStorage.setItem('fom.ig' + SUF, JSON.stringify(ST)); }catch(e){} drawAll(); } }).catch(function(){});
  return _la.apply(this, arguments);
};
window.FOM_IG = { state:function(){ return ST; }, score:score };
})();
