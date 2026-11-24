/* ============================================================
   FOM STUDIOS - Photo Cull (cull.html, Nov 2026)
   Aftershoot-style culling for both businesses (same rules), run by the FOM Engine
   on the Mac (127.0.0.1:7788, see the "FOM Engine" folder and claude/photo-cull.md).
   1 Choose a shoot folder, job type, how much to keep, starter edits.
   2 The engine groups similar shots, rejects blur / closed eyes / misfires, picks
     keepers and highlights; Claude decides the close calls.
   3 Review: grid, loupe, compare, keyboard like Lightroom, priority people.
   4 Write for Lightroom (XMP), Reset puts the files back.
   5 After Lightroom: learn from your final picks, and send the finals to a client
     gallery, Photo Sales or an Instagram carousel in the Content Planner.
   Photos never leave the Mac except through those handoffs.
   ============================================================ */
(function(){
'use strict';
var D = document, BZ = window.FOM_BIZ, BIZ = BZ && BZ.isSba ? 'sba' : 'fom';
var E = 'http://127.0.0.1:7788', W = 'https://fom-gallery.cold-moon-d65c.workers.dev';
var KEY = '', ST = null, FOLDER = '', FILTER = 'all', PERSON = '', STACK = false, OPEN = {}, LIST = [], CUR = -1, LOUPE = false, CMP = false;
var PEND = {}, pendT = null, FINALS = null, AUTH = null, DB = null, ORDERS = null;
var CAT = {
  hl:{ n:'Highlights', s:'★', c:'#c98a1f' }, keep:{ n:'Keepers', s:'✓', c:'#1f8a4c' }, check:{ n:'Check me', s:'!', c:'#c0392b' },
  dup:{ n:'Duplicates', s:'≈', c:'#c9a227' }, rej:{ n:'Rejects', s:'✕', c:'#7d7d7a' }
};
var JOBS = [['events','Events & birthdays'],['portraits','Portraits & family'],['cars','Cars'],['sport','Sport']];
var STRICT = [['tight','Keep 20%'],['normal','Keep 35%'],['loose','Keep 50%']];
var EDITS = [['basic','Basic','Exposure, white balance, highlights, shadows, straighten'],['preset','My preset','One of your Lightroom presets per job, plus the basic fixes'],['learned','Learned','Your look and slider habits from past shoots'],['none','None','Ratings only']];
var STAGE = { scan:'Finding photos', previews:'Making previews', analyse:'Checking focus, eyes and faces', beauty:'Finding similar shots', decide:'Grouping and choosing', claude:'Claude is deciding the close calls', write:'Writing for Lightroom', reset:'Putting the files back', learn:'Learning' };

function $(id){ return D.getElementById(id); }
function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function toast(m){ var t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(function(){ t.classList.remove('show'); }, 2800); }
function LSget(k, d){ try{ var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } }
function LSset(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
var SET = Object.assign({ job:'events', strict:'normal', edit:'', preset:'', claude:true }, LSget('fom.cull.setup.' + BIZ, {}));
function saveSet(){ LSset('fom.cull.setup.' + BIZ, SET); }
function catOf(p){ return (p.d && p.d.hand && p.d.hand.c) || (p.d && p.d.c) || 'check'; }
function slug(s){ return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'shoot'; }
function ago(t){ if(!t) return ''; var s = (Date.now() / 1000 - t); return s < 90 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : new Date(t * 1000).toLocaleDateString('en-ZA', { day:'numeric', month:'short' }); }
function mins(s){ return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s'; }

/* ---------------- engine ---------------- */
async function eng(path, body){
  var r = await fetch(E + path, body === undefined ? { headers:{ 'X-FOM-Engine':'1' } } :
    { method:'POST', headers:{ 'X-FOM-Engine':'1', 'Content-Type':'application/json' }, body:JSON.stringify(body) });
  var j = await r.json().catch(function(){ return {}; });
  if(!r.ok || j.error) throw new Error(j.error || ('engine ' + r.status));
  return j;
}
function img(id, s){ return E + '/cull/img?' + new URLSearchParams({ folder:FOLDER, id:id, s:s || 't', k:KEY }); }
function fileUrl(folder, name){ return E + '/cull/file?' + new URLSearchParams({ folder:folder, name:name, k:KEY }); }
async function waitJob(j, onP){
  try{ sessionStorage.setItem('fom.cull.job', JSON.stringify({ id:j.id, folder:FOLDER, kind:j.kind })); }catch(e){}
  while(j.status === 'running'){
    if(onP) onP(j);
    await new Promise(function(r){ setTimeout(r, 700); });
    j = await eng('/jobs?id=' + j.id);
  }
  try{ sessionStorage.removeItem('fom.cull.job'); }catch(e){}
  if(j.status === 'error') throw new Error((j.result && j.result.error) || 'the engine stopped');
  return j;
}
async function connect(){
  $('cuEng').innerHTML = '<span class="cu-dot"></span>Engine: checking...';
  try{
    var ctl = new AbortController(); setTimeout(function(){ ctl.abort(); }, 3000);
    var h = await (await fetch(E + '/health', { headers:{ 'X-FOM-Engine':'1' }, signal:ctl.signal })).json();
    KEY = h.key;
    $('cuEng').innerHTML = '<span class="cu-dot on"></span>FOM Engine ' + esc(h.version) + ' on this Mac';
    $('cuOff').hidden = true; $('cuMain').hidden = false;
    eng('/cull/caps').then(drawCaps).catch(function(){});
    return true;
  }catch(e){
    $('cuEng').innerHTML = '<span class="cu-dot off"></span>Engine not found';
    $('cuOff').hidden = false; $('cuMain').hidden = true;
    return false;
  }
}
function drawCaps(c){
  var miss = [];
  if(!c.faces) miss.push('face finder'); if(!c.eyes) miss.push('eye check'); if(!c.people) miss.push('people');
  if(!c.clip || !c.beauty) miss.push('looks and similar shots'); if(!c.claude) miss.push('Claude Code');
  $('cuCaps').innerHTML = miss.length ? '⚠ Missing on the Mac: ' + esc(miss.join(', ')) + '. Run setup.sh again.' : '';
}

/* ---------------- setup ---------------- */
function seg(el, items, val, on){
  el.innerHTML = items.map(function(x){ return '<button type="button" data-v="' + x[0] + '"' + (x[0] === val ? ' class="on"' : '') + '>' + esc(x[1]) + '</button>'; }).join('');
  el.onclick = function(e){ var b = e.target.closest('button[data-v]'); if(!b) return; [].forEach.call(el.children, function(c){ c.classList.toggle('on', c === b); }); on(b.dataset.v); };
}
var PRESETS = [], LEARNED = null;
function drawSetup(){
  seg($('cuJob'), JOBS, SET.job, function(v){ SET.job = v; saveSet(); drawEdits(); });
  seg($('cuStrict'), STRICT, SET.strict, function(v){ SET.strict = v; saveSet(); });
  $('cuClaude').checked = SET.claude !== false;
  $('cuClaude').onchange = function(){ SET.claude = this.checked; saveSet(); };
  drawEdits();
  loadPresets();
}
function editReady(m){
  if(m === 'preset') return PRESETS.length > 0;
  if(m === 'learned') return !!(LEARNED && (LEARNED[BIZ + '-' + SET.job] || LEARNED[BIZ + '-all']));
  return true;
}
function drawEdits(){
  var el = $('cuEdit');
  el.innerHTML = EDITS.map(function(x){
    var ok = editReady(x[0]), why = x[0] === 'preset' && !ok ? 'Import a preset first' : x[0] === 'learned' && !ok ? 'Learn from a past shoot first' : x[2];
    return '<button type="button" class="cu-opt' + (SET.edit === x[0] ? ' on' : '') + (ok ? '' : ' off') + '" data-v="' + x[0] + '"><b>' + esc(x[1]) + '</b><small>' + esc(why) + '</small></button>';
  }).join('');
  el.onclick = function(e){
    var b = e.target.closest('[data-v]'); if(!b) return;
    if(b.classList.contains('off')){ if(b.dataset.v === 'preset') importPresets(); else $('cuLearnCard').scrollIntoView({ behavior:'smooth' }); return; }
    SET.edit = b.dataset.v; saveSet(); drawEdits(); drawWrite();
  };
  var pr = $('cuPresetRow');
  pr.hidden = SET.edit !== 'preset';
  var key = SET.job;
  $('cuPreset').innerHTML = PRESETS.map(function(p){ return '<option' + (((SET.presets || {})[key] || SET.preset) === p ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('');
  $('cuPreset').onchange = function(){ SET.presets = SET.presets || {}; SET.presets[key] = this.value; SET.preset = this.value; saveSet(); };
}
function presetFor(){ return ((SET.presets || {})[SET.job]) || SET.preset || PRESETS[0] || ''; }
async function loadPresets(){
  try{ PRESETS = (await eng('/cull/presets?biz=' + BIZ)).presets || []; }catch(e){ PRESETS = []; }
  try{ LEARNED = (await eng('/cull/stats')).edits || {}; }catch(e){}
  drawEdits(); drawPresetList();
}
async function importPresets(){
  toast('Choose your .xmp presets in the window on your Mac');
  try{ var r = await eng('/cull/import-presets', { biz:BIZ }); PRESETS = r.presets || []; toast(r.added ? r.added + ' preset' + (r.added > 1 ? 's' : '') + ' added' : 'No presets added'); }catch(e){ toast(e.message); }
  drawEdits(); drawPresetList();
}
function drawPresetList(){
  var el = $('cuPresets'); if(!el) return;
  el.innerHTML = (PRESETS.length ? PRESETS.map(function(p){ return '<div class="cu-li"><span>🎨 ' + esc(p) + '</span><button type="button" class="cu-x" data-del="' + esc(p) + '" aria-label="Remove">✕</button></div>'; }).join('') : '<p class="cu-sub">No presets yet.</p>') +
    '<button type="button" class="cu-btn" id="cuImport">+ Import presets (.xmp)</button>';
  $('cuImport').onclick = importPresets;
  el.onclick = async function(e){ var b = e.target.closest('[data-del]'); if(!b) return;
    if(!confirm('Remove the preset "' + b.dataset.del + '" from Photo Cull? (It stays in Lightroom.)')) return;
    try{ PRESETS = (await eng('/cull/delete-preset', { biz:BIZ, name:b.dataset.del })).presets || []; }catch(x){ toast(x.message); } drawEdits(); drawPresetList(); };
}

async function pickFolder(){
  toast('Choose the shoot folder in the window on your Mac');
  try{
    var r = await eng('/cull/pick-folder', { prompt:'Choose the shoot folder' });
    if(r.cancelled) return;
    FOLDER = r.folder;
    if(!r.culled){ ST = null; $('cuSetup').classList.remove('folded'); $('cuStart').textContent = 'Start cull'; $('cuReview').hidden = true; $('cuWriteCard').hidden = true; $('cuAfter').hidden = true; }
    $('cuFolder').innerHTML = '<b>' + esc(r.name) + '</b> · ' + (r.files || 0) + ' files' + (r.culled ? ' · culled before ' + ago(r.culled.savedAt) : '');
    $('cuStart').disabled = false;
    if(r.culled){ await loadState(); }
  }catch(e){ toast(e.message); }
}
async function drawRecent(){
  try{
    var r = (await eng('/cull/recent')).recent || [];
    $('cuRecent').innerHTML = r.slice(0, 8).map(function(x){
      var c = x.counts || {};
      return '<button type="button" class="cu-rc' + (x.biz && x.biz !== BIZ ? ' other' : '') + '" data-f="' + esc(x.folder) + '"><b>' + esc(x.name) + '</b><small>' + (x.photos ? x.photos + ' photos · ' + ((c.hl || 0) + (c.keep || 0)) + ' kept' : 'not culled') + (x.written ? ' · written' : '') + '</small></button>';
    }).join('');
    $('cuRecent').onclick = function(e){ var b = e.target.closest('[data-f]'); if(!b) return; FOLDER = b.dataset.f; $('cuStart').disabled = false; $('cuFolder').innerHTML = '<b>' + esc(b.querySelector('b').textContent) + '</b>'; loadState(); };
  }catch(e){}
}

async function start(){
  if(!FOLDER) return toast('Choose a shoot folder first');
  if(!SET.edit){ $('cuEdit').classList.add('want'); setTimeout(function(){ $('cuEdit').classList.remove('want'); }, 1500); return toast('Choose the starter edits first: Basic, My preset, Learned or None'); }
  if(SET.edit === 'preset' && !presetFor()) return toast('Import a Lightroom preset first');
  var again = ST && ST.folder === FOLDER;
  if(again && !confirm('Cull this folder again? Your hand changes and priority people are kept.')) return;
  $('cuStart').disabled = true;
  try{
    var j = await eng('/cull/run', { folder:FOLDER, biz:BIZ, job:SET.job, strict:SET.strict, claude:SET.claude !== false });
    await follow(j, 'Culling');
    await loadState();
    toast('Cull done');
  }catch(e){ toast('Cull stopped: ' + e.message); $('cuProg').hidden = true; }
  $('cuStart').disabled = false;
}
async function follow(j, title){
  $('cuProg').hidden = false; $('cuProgT').textContent = title;
  var t0 = Date.now();
  j = await waitJob(j, function(x){
    var p = x.progress || {}, pct = p.t ? Math.round(p.d / p.t * 100) : 0;
    $('cuProgBar').style.width = (p.t ? pct : 8) + '%';
    $('cuProgTx').innerHTML = '<b>' + esc(STAGE[p.p] || p.m || 'Working') + '</b>' + (p.t > 1 ? ' · ' + p.d + ' of ' + p.t : '') + ' · ' + mins(Math.round((Date.now() - t0) / 1000));
  });
  $('cuProg').hidden = true;
  return j;
}

/* ---------------- state + review ---------------- */
async function loadState(){
  if(!FOLDER) return;
  try{
    var s = await eng('/cull/state?folder=' + encodeURIComponent(FOLDER));
    if(s.none){ ST = null; $('cuReview').hidden = true; $('cuAfter').hidden = true; $('cuWriteCard').hidden = true; return; }
    ST = s; LSset('fom.cull.last.' + BIZ, FOLDER);
    $('cuSetup').classList.add('folded'); $('cuFold').hidden = false; $('cuStart').textContent = 'Cull again';
    if(ST.job && ST.job !== SET.job){ SET.job = ST.job; saveSet(); }
    drawSetup();
    FINALS = (LSget('fom.cull.finals', {})[ST.sid]) || null;
    drawReview(); drawWrite(); drawAfter(); drawRecent();
  }catch(e){ toast(e.message); }
}
function counts(){ var c = { hl:0, keep:0, check:0, dup:0, rej:0, hand:0 }; (ST.photos || []).forEach(function(p){ if(!p.d) return; c[catOf(p)]++; if(p.d.hand) c.hand++; }); return c; }
function drawReview(){
  $('cuReview').hidden = false;
  var c = counts(), n = ST.photos.length;
  $('cuShoot').innerHTML = '<b>' + esc(ST.name) + '</b> · ' + n + ' photos · ' + esc((JOBS.find(function(j){ return j[0] === ST.job; }) || [0,''])[1]) + (ST.secs ? ' · culled in ' + mins(ST.secs) : '') +
    (ST.learnUsed ? ' · your taste ' + Math.round(ST.learnUsed.alpha * 100) + '%' : '') + (ST.claudeMsg ? '<br><span class="cu-warn">' + esc(ST.claudeMsg) + '</span>' : '');
  var chips = [['all','All', n]].concat(['hl','keep','check','dup','rej'].map(function(k){ return [k, CAT[k].n, c[k]]; })).concat(c.hand ? [['hand','Changed by you', c.hand]] : []);
  $('cuChips').innerHTML = chips.map(function(x){ return '<button type="button" class="cu-chip' + (FILTER === x[0] ? ' on' : '') + '" data-f="' + x[0] + '">' + (CAT[x[0]] ? '<i style="background:' + CAT[x[0]].c + '">' + CAT[x[0]].s + '</i>' : '') + esc(x[1]) + ' <b>' + x[2] + '</b></button>'; }).join('');
  $('cuChips').onclick = function(e){ var b = e.target.closest('[data-f]'); if(!b) return; FILTER = b.dataset.f; drawReview(); };
  seg($('cuStrict2'), STRICT, ST.strict || 'normal', function(v){ redecide({ strict:v }); });
  $('cuStack').checked = STACK; $('cuStack').onchange = function(){ STACK = this.checked; OPEN = {}; drawGrid(); };
  drawPeople(); drawGrid();
}
function drawPeople(){
  var ppl = ST.people || [], pr = ST.priority || [], el = $('cuPeople');
  if(!ppl.length){ el.hidden = true; return; }
  el.hidden = false;
  var miss = (ST.missing || []).length;
  $('cuPeopleList').innerHTML = ppl.slice(0, 24).map(function(p){
    var on = pr.indexOf(p.id) >= 0, f = PERSON === p.id;
    return '<div class="cu-face' + (on ? ' star' : '') + (f ? ' show' : '') + '" data-p="' + p.id + '"><img src="' + E + '/cull/face?' + new URLSearchParams({ folder:FOLDER, pid:p.id, k:KEY }) + '" alt=""><button type="button" class="cu-star" data-star="' + p.id + '" aria-label="Priority">' + (on ? '★' : '☆') + '</button><small>' + p.n + '</small></div>';
  }).join('');
  $('cuMissing').innerHTML = miss ? '⚠ ' + miss + (miss > 1 ? ' people have' : ' person has') + ' no keeper. <button type="button" class="cu-link" id="cuAddMissing">Add their best shot</button>' : '';
  if($('cuAddMissing')) $('cuAddMissing').onclick = function(){ var ch = {}; ST.missing.forEach(function(m){ ch[m.photo] = { c:'keep' }; }); hand(ch); ST.missing = []; drawPeople(); };
  $('cuPeopleList').onclick = function(e){
    var s = e.target.closest('[data-star]');
    if(s){ var id = s.dataset.star, list = (ST.priority || []).slice(), i = list.indexOf(id); if(i >= 0) list.splice(i, 1); else list.push(id); redecide({ priority:list }); return; }
    var f = e.target.closest('[data-p]'); if(!f) return; PERSON = PERSON === f.dataset.p ? '' : f.dataset.p; drawPeople(); drawGrid();
  };
}
async function redecide(o){
  try{
    var j = await eng('/cull/decide', Object.assign({ folder:FOLDER }, o));
    await follow(j, o.claude ? 'Asking Claude' : 'Re-choosing');
    await loadState();
  }catch(e){ toast(e.message); }
}
function visible(){
  var ps = ST.photos.filter(function(p){ return p.d; });
  if(PERSON) ps = ps.filter(function(p){ return (p.d.people || []).indexOf(PERSON) >= 0; });
  if(FILTER === 'hand') ps = ps.filter(function(p){ return p.d.hand; });
  else if(FILTER !== 'all') ps = ps.filter(function(p){ return catOf(p) === FILTER; });
  if(STACK && FILTER === 'all'){
    var best = {}, size = {};
    ps.forEach(function(p){ var g = p.d.g; size[g] = (size[g] || 0) + 1; var b = best[g], r = rank(p); if(!b || r < rank(b)) best[g] = p; });
    ps = ps.filter(function(p){ return OPEN[p.d.g] || best[p.d.g] === p; });
    ps.forEach(function(p){ p._stack = OPEN[p.d.g] ? 0 : size[p.d.g]; });
  } else ps.forEach(function(p){ p._stack = 0; });
  return ps;
}
function rank(p){ return ['hl','keep','check','dup','rej'].indexOf(catOf(p)) * 1000 + (p.d.gr || 0); }
function tile(p, i){
  var c = catOf(p), why = (p.d.hand ? ['by you'] : (p.d.why || [])).slice(0, 2).join(', ');
  var prev = LIST[i - 1], gs = !prev || prev.d.g !== p.d.g;
  return '<div class="cu-t' + (gs ? ' gs' : '') + (i === CUR ? ' sel' : '') + ' c-' + c + '" data-i="' + i + '"><img loading="lazy" src="' + img(p.id) + '" alt="">' +
    '<span class="cu-b" style="background:' + CAT[c].c + '">' + CAT[c].s + '</span>' + (p.d.hand ? '<span class="cu-h" title="Changed by you"></span>' : '') +
    (p._stack > 1 ? '<button type="button" class="cu-stk" data-g="' + p.d.g + '">+' + (p._stack - 1) + '</button>' : '') +
    (why ? '<span class="cu-why">' + esc(why) + '</span>' : '') + '</div>';
}
function drawGrid(){
  LIST = visible();
  if(CUR >= LIST.length) CUR = LIST.length - 1;
  $('cuGrid').innerHTML = LIST.length ? LIST.map(tile).join('') : '<p class="cu-sub" style="padding:20px">Nothing here.</p>';
}
$('cuGrid') && ($('cuGrid').onclick = function(e){
  var s = e.target.closest('.cu-stk'); if(s){ OPEN[s.dataset.g] = 1; drawGrid(); return; }
  var t = e.target.closest('.cu-t'); if(!t) return;
  var i = +t.dataset.i;
  if(i === CUR || matchMedia('(pointer:coarse)').matches){ CUR = i; openLoupe(); } else select(i);
});
$('cuGrid') && ($('cuGrid').ondblclick = function(e){ var t = e.target.closest('.cu-t'); if(t){ CUR = +t.dataset.i; openLoupe(); } });
function select(i){
  var old = $('cuGrid').querySelector('.cu-t.sel'); if(old) old.classList.remove('sel');
  CUR = Math.max(0, Math.min(LIST.length - 1, i));
  var t = $('cuGrid').querySelector('[data-i="' + CUR + '"]'); if(t){ t.classList.add('sel'); t.scrollIntoView({ block:'nearest' }); }
  if(LOUPE) drawLoupe();
}
function cols(){ var g = $('cuGrid'), t = g.querySelector('.cu-t'); if(!t) return 1; return Math.max(1, Math.round(g.clientWidth / t.offsetWidth)); }

/* hand changes: saved half a second after the last tap */
function hand(changes){
  Object.keys(changes).forEach(function(id){
    var p = ST.photos.find(function(x){ return x.id === id; }); if(!p || !p.d) return;
    var v = changes[id];
    if(v && v.c === p.d.c && !v.r && v.l == null){ v = null; changes[id] = null; }   // same as the cull: no hand change
    if(v) p.d.hand = v; else delete p.d.hand;
    PEND[id] = v;
  });
  clearTimeout(pendT); pendT = setTimeout(flush, 500);
  var keep = CUR;
  drawReview(); CUR = keep; select(CUR); drawWrite();
}
async function flush(){
  var ch = PEND; PEND = {};
  if(!Object.keys(ch).length) return;
  try{
    var r = await fetch(E + '/cull/hand', { method:'POST', keepalive:true, headers:{ 'X-FOM-Engine':'1', 'Content-Type':'application/json' }, body:JSON.stringify({ folder:FOLDER, changes:ch }) });
    if(!r.ok) throw new Error('engine ' + r.status);
  }catch(e){ toast('Could not save: ' + e.message); Object.keys(ch).forEach(function(k){ if(!(k in PEND)) PEND[k] = ch[k]; }); }
}
window.addEventListener('pagehide', function(){ if(Object.keys(PEND).length) flush(); });
function setCat(c){ var p = LIST[CUR]; if(!p) return; var o = {}; o[p.id] = c ? { c:c } : null; hand(o); }

/* ---------------- loupe + compare ---------------- */
function openLoupe(){ if(CUR < 0) CUR = 0; LOUPE = true; $('cuLoupe').hidden = false; D.body.style.overflow = 'hidden'; drawLoupe(); }
function closeLoupe(){ LOUPE = false; CMP = false; $('cuLoupe').hidden = true; D.body.style.overflow = ''; select(CUR); }
function groupOf(p){ return (ST.groups || [])[p.d.g] || [p.id]; }
function byId(id){ return ST.photos.find(function(x){ return x.id === id; }); }
function info(p){
  var a = p.a || {}, d = p.d, pt = d.pt || {}, c = catOf(p);
  var bits = [];
  if(p.shutter) bits.push(p.shutter < 1 ? '1/' + Math.round(1 / p.shutter) : p.shutter + 's');
  if(p.fnum) bits.push('f/' + p.fnum); if(p.iso) bits.push('ISO ' + p.iso); if(p.focal) bits.push(Math.round(p.focal) + 'mm');
  var bar = function(n, v){ return v == null ? '' : '<div class="cu-sc"><span>' + n + '</span><i><b style="width:' + Math.round(v * 100) + '%"></b></i></div>'; };
  return '<div class="cu-li2"><b style="color:' + CAT[c].c + '">' + CAT[c].s + ' ' + CAT[c].n.replace(/s$/, '') + '</b>' + (d.hand ? ' · changed by you <button type="button" class="cu-link" data-k="u">undo</button>' : '') + '</div>' +
    ((d.why || []).length ? '<div class="cu-tags">' + d.why.map(function(w){ return '<span>' + esc(w) + '</span>'; }).join('') + '</div>' : '') +
    '<div class="cu-meta">' + esc(p.main) + (p.pair ? ' + JPEG' : '') + '<br>' + esc([p.camera].concat(bits).filter(Boolean).join(' · ')) + '<br>' + (p.t ? new Date(p.t * 1000).toLocaleTimeString('en-ZA') : '') + ' · group ' + (d.g + 1) + ' (' + groupOf(p).length + ')</div>' +
    bar('Sharp', pt.sharp) + bar('Looks', pt.beauty) + (d.faces ? bar('Eyes', pt.eyes) + bar('Smile', pt.smile) : '') + bar('Light', pt.expo) +
    '<div class="cu-fz" id="cuFz"></div>';
}
function drawLoupe(){
  var p = LIST[CUR]; if(!p) return closeLoupe();
  var other = CMP ? groupOf(p).map(byId).filter(function(q){ return q && q.id !== p.id && q.d; }).sort(function(a, b){ return rank(a) - rank(b); })[0] || null : null;
  $('cuLImg').innerHTML = '<div class="cu-pane"><img id="cuLA" src="' + img(p.id, 'p') + '" alt=""><canvas class="cu-ov" id="cuOvA"></canvas></div>' + (other ? '<div class="cu-pane"><img src="' + img(other.id, 'p') + '" alt=""><span class="cu-cl" style="background:' + CAT[catOf(other)].c + '">' + CAT[catOf(other)].s + ' ' + esc(other.main) + '</span><button type="button" class="cu-btn sm" data-swap="' + other.id + '">Keep this one instead</button></div>' : '');
  $('cuLImg').classList.toggle('two', !!other);
  $('cuLInfo').innerHTML = info(p);
  $('cuLStrip').innerHTML = groupOf(p).map(function(id){ var q = byId(id); return q ? '<img src="' + img(id) + '" data-id="' + id + '" class="' + (id === p.id ? 'on ' : '') + 'c-' + catOf(q) + '" alt="">' : ''; }).join('');
  $('cuLPos').textContent = (CUR + 1) + ' / ' + LIST.length;
  $('cuCmp').classList.toggle('on', CMP);
  [].forEach.call($('cuLBtns').querySelectorAll('[data-c]'), function(b){ b.classList.toggle('on', b.dataset.c === catOf(p)); });
  var im = $('cuLA');
  im.onload = function(){ faceZoom(p, im); };
  im.onclick = function(ev){ zoom(im, ev); };
}
function faceZoom(p, im){
  var fz = $('cuFz'), fs = ((p.a || {}).faces || []).slice().sort(function(a, b){ return b.b[2] - a.b[2]; }).slice(0, 6), ov = $('cuOvA');
  if(ov){ var r = im.getBoundingClientRect(); ov.width = r.width; ov.height = r.height; ov.style.width = r.width + 'px'; ov.style.height = r.height + 'px'; ov.style.left = im.offsetLeft + 'px'; ov.style.top = im.offsetTop + 'px';
    var x = ov.getContext('2d'); x.clearRect(0, 0, ov.width, ov.height); x.lineWidth = 2;
    if($('cuLoupe').classList.contains('boxes')) fs.forEach(function(f){ x.strokeStyle = f.eo == null ? '#ffffff' : f.eo < 0.35 ? '#ff4d4d' : '#3ddc84'; x.strokeRect(f.b[0] * ov.width, f.b[1] * ov.height, f.b[2] * ov.width, f.b[3] * ov.height); });
  }
  if(!fz) return;
  fz.innerHTML = fs.map(function(f, i){ return '<div><canvas id="cuF' + i + '" width="112" height="84"></canvas><small>' + (f.eo == null ? '' : f.eo < 0.35 ? '👁 closed' : '👁 open') + (f.pid && (ST.priority || []).indexOf(f.pid) >= 0 ? ' ★' : '') + '</small></div>'; }).join('');
  fs.forEach(function(f, i){
    var c = $('cuF' + i); if(!c) return; var W = im.naturalWidth, H = im.naturalHeight;
    var cx = (f.b[0] + f.b[2] / 2) * W, cy = (f.b[1] + f.b[3] * 0.42) * H, w = f.b[2] * W * 1.05, h = w * 0.75;   // the eye band
    c.getContext('2d').drawImage(im, cx - w / 2, cy - h / 2, w, h, 0, 0, 112, 84);
  });
}
function zoom(im, ev){
  if(im.classList.contains('z')){ im.classList.remove('z'); im.style.transformOrigin = ''; return; }
  var r = im.getBoundingClientRect();
  im.style.transformOrigin = ((ev.clientX - r.left) / r.width * 100) + '% ' + ((ev.clientY - r.top) / r.height * 100) + '%';
  im.classList.add('z');
}
function bindLoupe(){
  $('cuLClose').onclick = closeLoupe;
  $('cuLPrev').onclick = function(){ if(CUR > 0){ CUR--; drawLoupe(); } };
  $('cuLNext').onclick = function(){ if(CUR < LIST.length - 1){ CUR++; drawLoupe(); } };
  $('cuCmp').onclick = function(){ CMP = !CMP; drawLoupe(); };
  $('cuBoxes').onclick = function(){ $('cuLoupe').classList.toggle('boxes'); drawLoupe(); };
  $('cuLBtns').onclick = function(e){ var b = e.target.closest('[data-c]'); if(b){ setCat(b.dataset.c); drawLoupe(); } };
  $('cuLStrip').onclick = function(e){ var t = e.target.closest('[data-id]'); if(!t) return; var i = LIST.findIndex(function(p){ return p.id === t.dataset.id; }); if(i < 0){ FILTER = 'all'; PERSON = ''; STACK = false; drawReview(); i = LIST.findIndex(function(p){ return p.id === t.dataset.id; }); } CUR = i; drawLoupe(); };
  $('cuLInfo').onclick = function(e){ if(e.target.closest('[data-k="u"]')){ setCat(null); drawLoupe(); } };
  $('cuLImg').onclick = function(e){ var s = e.target.closest('[data-swap]'); if(!s) return; var p = LIST[CUR], o = {}; o[s.dataset.swap] = { c:catOf(p) === 'hl' ? 'hl' : 'keep' }; o[p.id] = { c:'dup' }; hand(o); drawLoupe(); };
  // swipe on phones
  var sx = 0;
  $('cuLImg').addEventListener('touchstart', function(e){ sx = e.touches[0].clientX; }, { passive:true });
  $('cuLImg').addEventListener('touchend', function(e){ var dx = e.changedTouches[0].clientX - sx; if(Math.abs(dx) > 60){ if(dx < 0) $('cuLNext').click(); else $('cuLPrev').click(); } }, { passive:true });
}
D.addEventListener('keydown', function(e){
  if(!ST || $('cuReview').hidden || /INPUT|SELECT|TEXTAREA/.test((e.target.tagName || '')) || e.metaKey || e.ctrlKey || e.altKey) return;
  if(D.querySelector('.lg-ov')) return;
  var k = e.key, used = true;
  if(k === 'ArrowRight') LOUPE ? $('cuLNext').click() : select(CUR + 1);
  else if(k === 'ArrowLeft') LOUPE ? $('cuLPrev').click() : select(CUR - 1);
  else if(k === 'ArrowDown' && !LOUPE) select(CUR + cols());
  else if(k === 'ArrowUp' && !LOUPE) select(CUR - cols());
  else if(k === 'Enter' || k === ' ') LOUPE ? closeLoupe() : openLoupe();
  else if(k === 'Escape') LOUPE ? closeLoupe() : (used = false);
  else if(k === 'c' || k === 'C'){ if(!LOUPE) openLoupe(); CMP = !CMP; drawLoupe(); }
  else if(k === 'b' || k === 'B'){ if(LOUPE){ $('cuBoxes').click(); } }
  else if(k === 'g' || k === 'G'){ STACK = !STACK; OPEN = {}; drawReview(); }
  else if(CUR >= 0 && LIST[CUR]){
    var map = { p:'keep', P:'keep', x:'rej', X:'rej', '5':'hl', '4':'keep', '3':'keep', '2':'check', '1':'dup', '6':'check', '7':'dup' };
    if(map[k]){ setCat(map[k]); if(LOUPE) drawLoupe(); if(!LOUPE && SET.advance !== false && LIST[CUR + 1]) select(CUR + 1); else if(LOUPE && SET.advance !== false && CUR < LIST.length - 1){ CUR++; drawLoupe(); } }
    else if(k === 'u' || k === 'U' || k === '0'){ setCat(null); if(LOUPE) drawLoupe(); }
    else used = false;
  } else used = false;
  if(used) e.preventDefault();
});

/* ---------------- write for Lightroom ---------------- */
function drawWrite(){
  var card = $('cuWriteCard'); if(!ST){ card.hidden = true; return; }
  card.hidden = false;
  var w = ST.written, c = counts();
  var mode = SET.edit || 'basic', em = (EDITS.find(function(x){ return x[0] === mode; }) || ['', ''])[1] + (mode === 'preset' ? ' (' + presetFor() + ')' : '');
  var changed = w && ST.savedAt > (w.t || 0) + 2;
  $('cuWriteTx').innerHTML = (c.hl + c.keep) + ' picks (' + c.hl + ' highlights), ' + c.check + ' check me, ' + c.dup + ' duplicates, ' + c.rej + ' rejects · starter edits: <b>' + esc(em) + '</b>' +
    (w ? '<br>' + (changed ? '<span class="cu-warn">Changed since you wrote it ' + ago(w.t) + '. Write again.</span>' : '✅ Written ' + ago(w.t) + (w.errors ? ' · <span class="cu-warn">' + w.errors + ' files had a problem</span>' : '')) : '');
  $('cuReset').hidden = !w; $('cuReveal').hidden = !w;
  $('cuWrite').textContent = w ? 'Write again' : 'Write for Lightroom';
}
async function write(){
  await flush();
  var c = counts(), mode = SET.edit || 'basic';
  if(!SET.edit) return toast('Choose the starter edits first (top of the page)');
  if(!confirm('Write ' + ST.photos.length + ' photos for Lightroom?\n\n' + (c.hl + c.keep) + ' picks, ' + c.check + ' check me, ' + c.dup + ' duplicates, ' + c.rej + ' rejects.\nStarter edits: ' + mode + '.\n\nRAW files get an XMP file next to them. JPEG, HEIC and DNG get it inside (their old metadata is backed up). Reset undoes it all.')) return;
  try{
    var j = await eng('/cull/write', { folder:FOLDER, edit:mode, preset:mode === 'preset' ? presetFor() : '' });
    j = await follow(j, 'Writing for Lightroom');
    toast('Ready for Lightroom: import the folder');
    await loadState();
  }catch(e){ toast('Could not write: ' + e.message); }
}
async function reset(){
  if(!confirm('Reset the files? This removes the XMP files Photo Cull made and puts the old metadata back in the JPEG, HEIC and DNG files. Your cull and hand changes stay here.')) return;
  try{ var j = await eng('/cull/reset', { folder:FOLDER }); await follow(j, 'Putting the files back'); toast('Files reset'); await loadState(); }catch(e){ toast(e.message); }
}

/* ---------------- after Lightroom ---------------- */
var WEBOK = /\.(jpe?g|png|webp)$/i;   // what the browser can open (HEIC and RAW cannot)
function normStem(n){
  var s = String(n).split('/').pop().replace(/\.[^.]+$/, '');
  s = s.replace(/(-|_| )(edit|enhanced|nr|hdr|pano)(-\d+)?$/i, '').replace(/ ?\(\d+\)$/, '').replace(/-\d{1,2}$/, '');
  return s.toLowerCase();
}
function matchFinals(){
  if(!FINALS || !ST) return [];
  var by = {};
  ST.photos.forEach(function(p){ (p.files || [p.main]).forEach(function(f){ by[normStem(f)] = p; }); });
  return FINALS.files.map(function(f){ var p = by[normStem(f.name)]; return { f:f, p:p || null, c:p ? catOf(p) : '', q:p && p.d ? p.d.q : 0 }; });
}
function drawAfter(){
  var card = $('cuAfter'); if(!ST){ card.hidden = true; return; }
  card.hidden = false;
  $('cuFinTx').innerHTML = FINALS ? '<b>' + esc(FINALS.name) + '</b> · ' + FINALS.files.length + ' finals' : 'Export your finals from Lightroom into a folder, then choose it here.';
  [].forEach.call(card.querySelectorAll('.cu-hand button'), function(b){ b.disabled = !FINALS; });
  $('cuSales').hidden = BIZ === 'sba';
  var L = ST.learned;
  $('cuLearnRes').innerHTML = L ? '🧠 Learned ' + ago(L.t) + ': you kept ' + L.matched + ', the cull agreed on ' + L.agree + ' (' + Math.round(L.recall * 100) + '%).' + ((L.tips || []).length ? ' ' + esc(L.tips.join('. ')) + '.' : '') : '';
}
async function chooseFinals(){
  toast('Choose the folder you exported the finals to');
  try{
    var r = await eng('/cull/pick-folder', { prompt:'Choose the folder with your Lightroom finals' });
    if(r.cancelled) return;
    var l = await eng('/cull/list?folder=' + encodeURIComponent(r.folder));
    FINALS = { folder:r.folder, name:r.name, files:l.files || [] };
    var m = LSget('fom.cull.finals', {}); m[ST.sid] = FINALS; LSset('fom.cull.finals', m);
    drawAfter();
  }catch(e){ toast(e.message); }
}
async function refreshFinals(){
  if(!FINALS) return false;
  try{ FINALS.files = (await eng('/cull/list?folder=' + encodeURIComponent(FINALS.folder))).files || []; return true; }
  catch(e){ toast('Choose the finals folder again (the engine restarted)'); FINALS = null; drawAfter(); return false; }
}
async function learnPicks(){
  if(!(await refreshFinals())) return;
  try{
    var j = await eng('/cull/learn', { folder:FOLDER, finals:FINALS.folder });
    j = await follow(j, 'Learning from your picks');
    var r = j.result || {};
    if(!r.ok) return toast(r.msg || 'Nothing learned');
    var e = r.edits && r.edits.ok ? ' It also learned your editing from ' + r.edits.n + ' photos.' : '';
    toast('Learned. The cull has ' + Math.round((r.model.alpha || 0) * 100) + '% of your taste for this job type now.' + e);
    await loadState(); drawLearn();
  }catch(e){ toast(e.message); }
}
function lazyFiles(list){
  return list.map(function(x){ var f = x.f || x; return { name:f.name.split('/').pop(), size:f.size, lazy:async function(){
    var b = await (await fetch(fileUrl(FINALS.folder, f.name))).blob(); return new File([b], f.name.split('/').pop(), { type:b.type || 'image/jpeg' }); } }; });
}
async function toGallery(){
  if(!(await refreshFinals())) return;
  await loadOrders();
  var ov = modal('<h3>🖼 Send finals to a client gallery</h3><p class="lg-sub">' + FINALS.files.length + ' photos from ' + esc(FINALS.name) + '. Pick the client.</p>' +
    '<input class="cu-in" id="cuOq" placeholder="Search clients"><div class="cu-olist" id="cuOl"></div>', [['Cancel']]);
  function draw(q){
    q = (q || '').toLowerCase();
    ov.querySelector('#cuOl').innerHTML = ORDERS.filter(function(o){ return !q || String(o.customer || '').toLowerCase().indexOf(q) >= 0; }).slice(0, 40).map(function(o){
      return '<button type="button" data-o="' + esc(o.id) + '"><b>' + esc(o.customer || 'Client') + '</b><small>' + esc([o.product, o.shootDate, o.galleryFolder ? '📁 ' + o.galleryFolder : ''].filter(Boolean).join(' · ')) + '</small></button>';
    }).join('') || '<p class="cu-sub">No clients found.</p>';
  }
  draw();
  ov.querySelector('#cuOq').oninput = function(){ draw(this.value); };
  ov.querySelector('#cuOl').onclick = function(e){
    var b = e.target.closest('[data-o]'); if(!b) return;
    var o = ORDERS.find(function(x){ return x.id === b.dataset.o; }); ov.remove();
    window.FOM_UPLOAD.open(o, null, { files:lazyFiles(FINALS.files), from:FINALS.name });
  };
}
async function toSales(){
  if(!(await refreshFinals())) return;
  var m = matchFinals().filter(function(x){ return WEBOK.test(x.f.name); }), hl = m.filter(function(x){ return x.c === 'hl'; });
  if(!m.length) return toast('Photo Sales needs JPEG finals. Export JPEGs from Lightroom.');
  var ov = modal('<h3>🛒 Sell on Photo Sales</h3><p class="lg-sub">Makes a new sale event (switched off until you check prices) and adds the photos with your watermark.</p>' +
    '<input class="cu-in" id="cuSt" value="' + esc(ST.name) + '"><div class="cu-seg2" id="cuSw"><button type="button" class="on" data-v="all">All finals (' + m.length + ')</button>' + (hl.length ? '<button type="button" data-v="hl">Highlights only (' + hl.length + ')</button>' : '') + '</div>', [['Cancel'], ['Make the event', 'go']]);
  var which = 'all';
  seg(ov.querySelector('#cuSw'), [['all','All finals (' + m.length + ')']].concat(hl.length ? [['hl','Highlights only (' + hl.length + ')']] : []), 'all', function(v){ which = v; });
  ov.querySelector('.lg-go').onclick = function(){
    var names = (which === 'hl' ? hl : m).map(function(x){ return x.f.name; });
    LSset('fom.cull.sales', { t:Date.now(), title:ov.querySelector('#cuSt').value.trim() || ST.name, date:ST.photos[0] && ST.photos[0].t ? new Date(ST.photos[0].t * 1000).toLocaleDateString('en-CA') : '', folder:FINALS.folder, names:names });
    ov.remove(); window.open('sales.html?from=cull', '_blank');
  };
}
async function toInstagram(){
  if(!(await refreshFinals())) return;
  var m = matchFinals().filter(function(x){ return WEBOK.test(x.f.name); }).sort(function(a, b){ return (b.c === 'hl') - (a.c === 'hl') || (b.q || 0) - (a.q || 0); });
  if(!m.length) return toast('Instagram needs JPEG finals. Export JPEGs from Lightroom.');
  var cand = m.slice(0, 24), pick = cand.filter(function(x){ return x.c === 'hl'; }).slice(0, 10);
  if(pick.length < 10) pick = pick.concat(cand.filter(function(x){ return pick.indexOf(x) < 0; }).slice(0, 10 - pick.length));
  var ov = modal('<h3>📱 Instagram carousel</h3><p class="lg-sub">Tap to choose up to 10, in the order you tap. They go to the Content Planner as a Carousel idea, sized for Instagram (up to 1080 × 1350).</p>' +
    '<input class="cu-in" id="cuIt" value="Carousel: ' + esc(ST.name) + '"><div class="cu-ig" id="cuIg"></div>', [['Cancel'], ['Add to Content Planner', 'go']]);
  var order = pick.slice();
  function draw(){
    ov.querySelector('#cuIg').innerHTML = cand.map(function(x, i){ var n = order.indexOf(x);
      return '<button type="button" data-i="' + i + '" class="' + (n >= 0 ? 'on' : '') + '"><img src="' + (x.p ? img(x.p.id) : fileUrl(FINALS.folder, x.f.name)) + '" alt="">' + (n >= 0 ? '<b>' + (n + 1) + '</b>' : '') + '</button>'; }).join('');
    ov.querySelector('.lg-go').textContent = 'Add ' + order.length + ' to Content Planner';
  }
  draw();
  ov.querySelector('#cuIg').onclick = function(e){ var b = e.target.closest('[data-i]'); if(!b) return; var x = cand[+b.dataset.i], n = order.indexOf(x); if(n >= 0) order.splice(n, 1); else if(order.length < 10) order.push(x); else return toast('10 is the most Instagram takes'); draw(); };
  ov.querySelector('.lg-go').onclick = async function(){
    if(!order.length) return;
    var btn = this; btn.disabled = true;
    try{
      var urls = [], tag = 'ig-' + BIZ + '-' + slug(ST.name) + '-' + Date.now().toString(36);
      for(var i = 0; i < order.length; i++){
        btn.textContent = 'Preparing ' + (i + 1) + ' of ' + order.length + '...';
        var b = await (await fetch(fileUrl(FINALS.folder, order[i].f.name))).blob();
        var bmp = await createImageBitmap(b, { imageOrientation:'from-image' }), s = Math.min(1, 1080 / bmp.width, 1350 / bmp.height);
        var c = D.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
        var x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, c.width, c.height);
        var jb = await new Promise(function(r){ c.toBlob(r, 'image/jpeg', 0.9); });
        var n = tag + '-' + String(i + 1).padStart(2, '0') + '.jpg';
        var r = await fetch(W + '/admin/upload?' + new URLSearchParams({ n:n, f:'portfolio' }), { method:'POST', headers:{ Authorization:'Bearer ' + await AUTH.currentUser.getIdToken(), 'Content-Type':'image/jpeg' }, body:jb });
        if(!r.ok) throw new Error('upload ' + r.status);
        urls.push(W + '/file?g=portfolio%2F&n=' + encodeURIComponent(n));
      }
      var item = BZ.tag({ title:ov.querySelector('#cuIt').value.trim() || ('Carousel: ' + ST.name), type:'Carousel', platform:'Instagram', status:'Planned', targetDate:'', postedDate:'', link:'',
        notes:order.length + ' photos from ' + ST.name + ' (Photo Cull), in posting order. Lead with the first one; it is the strongest.', photos:urls, from:'cull', createdAt:firebase.firestore.FieldValue.serverTimestamp() });
      await DB.collection('contentPlanner').add(item);
      ov.remove(); toast('Added to the Content Planner Idea Board');
    }catch(e){ btn.disabled = false; btn.textContent = 'Try again'; toast('Could not add it: ' + e.message); }
  };
}
function modal(html, btns){
  var ov = D.createElement('div'); ov.className = 'lg-ov';
  ov.innerHTML = '<div class="lg-box cu-box" role="dialog">' + html + '<div class="lg-acts">' + btns.map(function(b){ return '<button type="button"' + (b[1] ? ' class="lg-' + b[1] + '"' : ' class="lg-x"') + '>' + esc(b[0]) + '</button>'; }).join('') + '</div></div>';
  D.body.appendChild(ov);
  ov.querySelector('.lg-x').onclick = function(){ ov.remove(); };
  ov.onclick = function(e){ if(e.target === ov) ov.remove(); };
  return ov;
}
async function loadOrders(){
  if(ORDERS) return;
  var s = await DB.collection('orders').get();
  ORDERS = BZ.mine(s.docs.map(function(d){ return Object.assign({ id:d.id }, d.data()); })).filter(function(o){ return !o.test && o.status !== 'Cancelled'; })
    .sort(function(a, b){ return String(b.shootDate || '').localeCompare(String(a.shootDate || '')); });
}
/* gallery-upload.js expects the Database's globals */
window.store = { update:function(id){ var o = (ORDERS || []).find(function(x){ return x.id === id; }); if(!o) return;
  DB.collection('orders').doc(id).set({ galleryFolder:o.galleryFolder || '', deliverablesReady:!!o.deliverablesReady }, { merge:true }).catch(function(e){ toast('Could not save the gallery folder: ' + e.message); }); } };

/* ---------------- learning card ---------------- */
async function drawLearn(){
  var el = $('cuLearnBody'); if(!el) return;
  try{
    var s = await eng('/cull/stats'); LEARNED = s.edits || {};
    var rows = JOBS.map(function(j){ var m = (s.picks || {})[j[0]], h = (s.history || []).filter(function(x){ return x.job === j[0]; }).slice(-1)[0];
      return '<div class="cu-li"><span><b>' + esc(j[1]) + '</b>: ' + (m ? m.shoots + ' shoot' + (m.shoots > 1 ? 's' : '') + ' · ' + Math.round((m.alpha || 0) * 100) + '% your taste' + (h ? ' · last agreed ' + Math.round(h.recall * 100) + '%' : '') : 'nothing yet') + '</span></div>'; }).join('');
    var ed = Object.keys(LEARNED).filter(function(k){ return k.indexOf(BIZ + '-') === 0; }).map(function(k){ var m = LEARNED[k];
      return '<div class="cu-li"><span>🎨 <b>' + esc(k.split('-')[1] === 'all' ? 'All jobs' : (JOBS.find(function(j){ return j[0] === k.split('-')[1]; }) || [0, k])[1]) + '</b>: ' + m.n + ' edits · ' + esc((m.sliders || []).map(function(x){ return x.replace('2012', ''); }).join(', ')) + (m.look ? ' + your look' : '') + '</span></div>'; }).join('');
    el.innerHTML = '<h3 class="cu-h3">Your picks</h3>' + rows + '<h3 class="cu-h3">Your editing (' + esc(BZ.b.name) + ')</h3>' + (ed || '<p class="cu-sub">Nothing yet.</p>') +
      '<div class="cu-row"><select class="cu-in" id="cuLeJob" style="max-width:220px"><option value="all">All jobs</option>' + JOBS.map(function(j){ return '<option value="' + j[0] + '">' + esc(j[1]) + '</option>'; }).join('') + '</select><button type="button" class="cu-btn" id="cuLeGo">🧠 Learn my editing from a past shoot</button></div>';
    $('cuLeGo').onclick = learnEdits;
    drawEdits();
  }catch(e){ el.innerHTML = '<p class="cu-sub">' + esc(e.message) + '</p>'; }
}
async function learnEdits(){
  var job = $('cuLeJob').value;
  toast('Choose a past shoot exported from Lightroom as Original + Settings');
  try{
    var r = await eng('/cull/pick-folder', { prompt:'Choose a past shoot exported as Original + Settings' });
    if(r.cancelled) return;
    var j = await eng('/cull/learn-edits', { folder:r.folder, biz:BIZ, job:job });
    j = await follow(j, 'Learning your editing');
    var x = j.result || {};
    toast(x.ok ? 'Learned from ' + x.n + ' edits' + (x.look ? ', with your look' : '') : (x.msg || 'Nothing learned'));
    drawLearn();
  }catch(e){ toast(e.message); }
}

/* ---------------- start ---------------- */
window.FOM_CULL_START = async function(auth, db){
  AUTH = auth; DB = db; window.auth = auth;
  $('cuBiz').textContent = BZ.b.name;
  $('cuFold').onclick = function(){ $('cuSetup').classList.toggle('folded'); };
  $('cuPick').onclick = pickFolder; $('cuStart').onclick = start; $('cuRetry').onclick = boot;
  $('cuWrite').onclick = write; $('cuReset').onclick = reset;
  $('cuReveal').onclick = function(){ eng('/reveal', { path:FOLDER }).catch(function(e){ toast(e.message); }); };
  $('cuClaudeAgain').onclick = function(){ redecide({ claude:true }); };
  $('cuFin').onclick = chooseFinals; $('cuLearnBtn').onclick = learnPicks; $('cuGal').onclick = toGallery; $('cuSales').onclick = toSales; $('cuIgBtn').onclick = toInstagram;
  bindLoupe();
  boot();
};
async function boot(){
  if(!(await connect())) return;
  drawSetup(); drawRecent(); drawLearn();
  var last = LSget('fom.cull.last.' + BIZ, '');
  var running = null; try{ running = JSON.parse(sessionStorage.getItem('fom.cull.job') || 'null'); }catch(e){}
  if(running){ FOLDER = running.folder; try{ await follow(await eng('/jobs?id=' + running.id), 'Still working'); }catch(e){} }
  if(!FOLDER && last) FOLDER = last;
  if(FOLDER){ $('cuFolder').innerHTML = '<b>' + esc(FOLDER.split('/').pop()) + '</b>'; $('cuStart').disabled = false; await loadState(); }
}
})();
