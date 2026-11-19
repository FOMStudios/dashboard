/* ============================================================
   FOM STUDIOS - Photo Sales admin (sales.html, Nov 2026)
   Make an event, upload photos (the browser makes a watermarked
   thumbnail and preview, and keeps the full-size photo private),
   tag each photo with the numbers in it, set prices, put it on sale,
   and see who bought what. Public page: fomstudios.co.za/photos.html
   Storage and payments: the gallery Worker (/sales/...), R2 and Yoco.
   ============================================================ */
(function(){
'use strict';
var D = document, BZ = window.FOM_BIZ;
var W = 'https://fom-gallery.cold-moon-d65c.workers.dev';
var SITE = 'https://www.fomstudios.co.za/photos.html';
var AUTH = null, EVENTS = [], EV = null, ORDERS = [], SEL = new Set(), FILTER = 'all', dirty = false, saving = false;
function $(id){ return D.getElementById(id); }
function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function R(n){ return 'R' + Math.round(+n || 0).toLocaleString('en-ZA'); }
function toast(m){ var t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(function(){ t.classList.remove('show'); }, 2600); }
function slug(s){ return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 34) || 'event'; }
function thumb(n){ return W + '/file?g=' + encodeURIComponent('sales/' + EV.id + '/t/') + '&n=' + encodeURIComponent(n); }
function nice(d){ try{ return new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-ZA', { day:'numeric', month:'short', year:'numeric' }); }catch(e){ return d || ''; } }
async function tok(){ return 'Bearer ' + await AUTH.currentUser.getIdToken(); }
async function api(path, opt){
  opt = opt || {}; opt.headers = Object.assign({ Authorization: await tok() }, opt.headers || {});
  var r = await fetch(W + path, opt), j = await r.json().catch(function(){ return {}; });
  if(!r.ok) throw new Error(j.error || ('error ' + r.status)); return j;
}
function nums(v){ return String(v || '').toUpperCase().split(/[\s,;/]+/).map(function(x){ return x.replace(/[^A-Z0-9-]/g, '').slice(0, 12); }).filter(Boolean).filter(function(x, i, a){ return a.indexOf(x) === i; }).slice(0, 12); }

/* ---------- setup (Yoco key + webhook) ---------- */
async function drawSetup(){
  var b = $('psSetupBody');
  try{
    var s = await api('/sales/admin/setup');
    if(s.key && s.webhook){ b.innerHTML = '✅ Card payments are connected. Paid photos unlock straight away.'; $('psSetup').classList.add('folded'); return; }
    b.innerHTML = '<ol style="margin:0 0 10px 18px">' +
      '<li' + (s.key ? ' style="opacity:.5"' : '') + '>Cloudflare, Workers and Pages, <b>fom-gallery</b>, Settings, Variables and Secrets, Add, type <b>Secret</b>, name <b>YOCO_SECRET_KEY</b>, paste the same <b>sk_live</b> key your fom-yoco Worker uses (Yoco portal, Sales, Payment gateway), Deploy. ' + (s.key ? '✅ Done' : '') + '</li>' +
      '<li>Tap <b>Connect Yoco</b> below. It tells Yoco to let us know the moment someone pays.</li></ol>' +
      '<button type="button" class="ps-btn go" id="psConnect">Connect Yoco</button> <span id="psSetupMsg"></span>';
    $('psConnect').onclick = async function(){ this.disabled = true; $('psSetupMsg').textContent = 'Connecting...';
      try{ var j = await api('/sales/admin/setup', { method:'POST' }); $('psSetupMsg').textContent = (j.ok ? '✅ ' : '❌ ') + j.msg; if(j.ok) setTimeout(drawSetup, 1200); }catch(e){ $('psSetupMsg').textContent = '❌ ' + e.message; } this.disabled = false; };
  }catch(e){ b.textContent = 'Could not reach the gallery Worker: ' + e.message; }
}

/* ---------- events list ---------- */
async function loadEvents(){
  try{ var r = await fetch(W + '/file?g=sales%2F&n=index.json&t=' + Date.now(), { cache:'no-store' }); EVENTS = r.ok ? ((await r.json()).events || []) : []; }catch(e){ EVENTS = []; }
  drawEvents();
}
function drawEvents(){
  $('psEvents').innerHTML = EVENTS.length ? EVENTS.map(function(e){
    return '<div class="ps-ev" data-ev="' + esc(e.id) + '">' + (e.cover ? '<img src="' + W + '/file?g=' + encodeURIComponent('sales/' + e.id + '/t/') + '&n=' + encodeURIComponent(e.cover) + '" alt="">' : '<img alt="">') +
      '<div><b>' + (e.shop ? '🖼 ' : '') + esc(e.title || e.id) + '</b><small>' + (e.shop ? 'Prints shop' : esc(nice(e.date))) + (e.place ? ', ' + esc(e.place) : '') + ' · ' + (e.count || 0) + ' photos</small></div><span class="ps-on' + (e.on ? '' : ' off') + '">' + (e.on ? 'On sale' : 'Hidden') + '</span></div>';
  }).join('') : '<p class="tr-empty">No events yet. Make your first one below.</p>';
  if(!EVENTS.some(function(e){ return e.id === 'shop'; })) $('psEvents').insertAdjacentHTML('afterbegin', '<div class="ps-ev" id="psMakeShop"><img alt=""><div><b>🖼 Set up your Prints shop</b><small>Your best shots for sale as prints, frames, canvas and downloads (fomstudios.co.za/prints.html)</small></div></div>');
  var ms = $('psMakeShop'); if(ms) ms.onclick = function(e){ e.stopPropagation(); EV = { id:'shop', shop:true, title:'Prints shop', date:new Date().toLocaleDateString('en-CA', { timeZone:'Africa/Johannesburg' }), place:'', about:'', prices:{ photo:0, bundle:0 }, on:false, cover:'', photos:[] }; ORDERS = []; SEL.clear(); dirty = true; drawEdit(); save().then(loadEvents); };
}
$('psEvents').addEventListener('click', function(e){ var r = e.target.closest('[data-ev]'); if(r) openEvent(r.dataset.ev); });
$('psNew').onclick = function(){
  var t = $('psNewTitle').value.trim(); if(!t){ $('psNewTitle').focus(); return; }
  var id = slug(t), i = 2; while(EVENTS.some(function(e){ return e.id === id; })) id = slug(t).slice(0, 30) + '-' + (i++);
  EV = { id:id, title:t, date:new Date().toLocaleDateString('en-CA', { timeZone:'Africa/Johannesburg' }), place:'', about:'', numLabel:'Your race number', prices:{ photo:50, bundle:150 }, on:false, cover:'', photos:[] };
  $('psNewTitle').value = ''; ORDERS = []; SEL.clear(); dirty = true; drawEdit(); save().then(loadEvents);
};
async function openEvent(id){
  try{ var r = await fetch(W + '/sales/event?ev=' + encodeURIComponent(id) + '&preview=1&t=' + Date.now(), { cache:'no-store' }); if(!r.ok) throw new Error('not found'); EV = await r.json(); }
  catch(e){ toast('Could not open: ' + e.message); return; }
  EV.photos = EV.photos || []; EV.prices = EV.prices || {}; SEL.clear(); FILTER = 'all'; dirty = false; drawEdit(); loadOrders();
  $('psEdit').scrollIntoView({ behavior:'smooth', block:'start' });
}

/* ---------- one event ---------- */
function drawEdit(){
  if(!EV){ $('psEdit').innerHTML = ''; return; }
  var SH = !!EV.shop;
  var link = SH ? SITE.replace('photos.html', 'prints.html') + '?x=1' : SITE + '?ev=' + EV.id, untagged = EV.photos.filter(function(p){ return !(p.nums || []).length; }).length;
  $('psEdit').innerHTML =
    '<section class="tr-card"><h2>' + esc(EV.title) + '</h2>' +
    (SH ? '<p class="tr-sub" style="margin:0 0 10px">Add your best shots and give each a title. Sizes, frames and prices are in Print settings above and apply to every print, also client gallery and event photo prints.</p><div class="ps-grid2"><div><label>Digital download price (R, empty = prints only)</label><input inputmode="numeric" data-p="photo" value="' + esc(EV.prices.photo || '') + '"></div></div>' :
    '<div class="ps-grid2"><div><label>Event name</label><input data-k="title" value="' + esc(EV.title) + '"></div><div><label>Date</label><input type="date" data-k="date" value="' + esc(EV.date) + '"></div>' +
    '<div><label>Place</label><input data-k="place" value="' + esc(EV.place) + '" placeholder="e.g. FNB Stadium"></div><div><label>Search box says</label><input data-k="numLabel" value="' + esc(EV.numLabel || '') + '" placeholder="Your race number"></div>' +
    '<div><label>Price per photo (R)</label><input inputmode="numeric" data-p="photo" value="' + esc(EV.prices.photo || '') + '"></div><div><label>All photos of one number (R, empty = off)</label><input inputmode="numeric" data-p="bundle" value="' + esc(EV.prices.bundle || '') + '"></div>' +
    '<div style="grid-column:1/-1"><label>A line about the event (optional)</label><textarea data-k="about" rows="2" placeholder="e.g. Photos from the start, the Westcliff hill and the finish.">' + esc(EV.about || '') + '</textarea></div></div>') +
    '<div class="ps-row" style="margin-top:12px"><label class="tr-tg" style="margin:0"><span>On sale</span> <input type="checkbox" id="psOn"' + (EV.on ? ' checked' : '') + '></label>' +
    '<button type="button" class="ps-btn go" id="psSave">Save</button><a class="ps-btn" href="' + link + (EV.on || SH ? '' : '&preview=1') + '" target="_blank" rel="noopener">Open the page</a>' +
    '<button type="button" class="ps-btn" id="psCopy">Copy link</button><button type="button" class="ps-btn red" id="psDelEv">' + (SH ? 'Delete shop' : 'Delete event') + '</button><span id="psSaveMsg" class="tr-sub"></span></div></section>' +

    '<section class="tr-card"><h2>Photos <span class="tr-sub" style="font-weight:600">' + EV.photos.length + ' photos' + (untagged ? ', ' + untagged + ' without a number' : '') + '</span></h2>' +
    '<div class="ps-drop" id="psDrop">📤 Tap to add photos, or drop them here<br><small>JPG, PNG or HEIC. The full-size photo stays private until someone pays. Keep this page open while it uploads.</small><input type="file" id="psFiles" accept="image/*" multiple hidden></div>' +
    '<div id="psProg"' + (UP.msg ? '' : ' style="display:none"') + '><div class="tr-sub" id="psProgTx">' + esc(UP.msg || '') + '</div><div class="ps-bar"><i id="psProgBar"></i></div></div>' +
    '<div class="ps-tools"><button type="button" class="ps-btn' + (FILTER === 'all' ? ' go' : '') + '" data-f="all">All</button><button type="button" class="ps-btn' + (FILTER === 'untagged' ? ' go' : '') + '" data-f="untagged">No number yet</button>' +
    '<input class="ps-in" id="psFindNum" placeholder="Find a number" style="width:130px" value="' + (FILTER.indexOf('#') === 0 ? esc(FILTER.slice(1)) : '') + '">' +
    (SEL.size ? '<span class="tr-sub"><b>' + SEL.size + ' selected</b></span><input class="ps-in" id="psTagSel" placeholder="Add number to selected" style="width:190px"><button type="button" class="ps-btn go" id="psTagGo">Add</button><button type="button" class="ps-btn red" id="psDelSel">Delete</button><button type="button" class="ps-btn" id="psSelNone">Clear</button>' : '<span class="tr-sub">' + (SH ? 'Tap a photo to select it. Type a title under each photo.' : 'Tap a photo to select it. Type numbers under each photo (123, 45). Enter jumps to the next.') + '</span>') + '</div>' +
    '<div class="ps-photos" id="psPhotos"></div></section>' +

    (SH ? '' : '<section class="tr-card"><h2>Sales</h2><div id="psSales"><p class="tr-empty">Loading...</p></div></section>');
  drawPhotos(); drawSales();
  var ed = $('psEdit');
  ed.querySelectorAll('[data-k]').forEach(function(i){ i.oninput = function(){ EV[i.dataset.k] = i.value; dirty = true; }; });
  ed.querySelectorAll('[data-p]').forEach(function(i){ i.oninput = function(){ EV.prices[i.dataset.p] = +i.value.replace(/\D/g, '') || 0; dirty = true; }; });
  $('psOn').onchange = function(){ EV.on = this.checked; dirty = true; if(EV.on && !EV.photos.length) toast('Add photos before people can buy.'); save(); };
  $('psSave').onclick = function(){ save(); };
  $('psCopy').onclick = function(){ navigator.clipboard.writeText(SH ? 'https://www.fomstudios.co.za/prints.html?src=ig' : link + '&src=ig').then(function(){ toast('Link copied (tracked as Instagram on the Traffic page)'); }); };
  $('psDelEv').onclick = async function(){ if(!confirm('Delete ' + EV.title + ' and all its photos? Buyers lose their downloads. This cannot be undone.')) return;
    try{ await api('/sales/admin/delete', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ ev:EV.id, all:true }) }); EV = null; drawEdit(); loadEvents(); toast('Deleted'); }catch(e){ toast(e.message); } };
  var drop = $('psDrop'), inp = $('psFiles');
  drop.onclick = function(){ inp.click(); };
  inp.onchange = function(){ upload([].slice.call(inp.files)); inp.value = ''; };
  drop.ondragover = function(e){ e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = function(){ drop.classList.remove('over'); };
  drop.ondrop = function(e){ e.preventDefault(); drop.classList.remove('over'); upload([].slice.call(e.dataTransfer.files).filter(function(f){ return /^image\//.test(f.type) || /\.(heic|jpe?g|png)$/i.test(f.name); })); };
  ed.querySelectorAll('[data-f]').forEach(function(b){ b.onclick = function(){ FILTER = b.dataset.f; drawEdit(); }; });
  if($('psFindNum')) $('psFindNum').onchange = function(){ var v = nums(this.value)[0]; FILTER = v ? '#' + v : 'all'; drawEdit(); };
  if($('psTagGo')){
    var tagSel = function(){ var add = nums($('psTagSel').value); if(!add.length) return; EV.photos.forEach(function(p){ if(SEL.has(p.n)) p.nums = nums((p.nums || []).concat(add).join(' ')); }); dirty = true; SEL.clear(); drawEdit(); save(); };
    $('psTagGo').onclick = tagSel; $('psTagSel').onkeydown = function(e){ if(e.key === 'Enter') tagSel(); };
    $('psSelNone').onclick = function(){ SEL.clear(); drawEdit(); };
    $('psDelSel').onclick = async function(){ if(!confirm('Delete ' + SEL.size + ' photo(s)?')) return; var ns = [...SEL];
      try{ await api('/sales/admin/delete', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ ev:EV.id, n:ns }) }); EV.photos = EV.photos.filter(function(p){ return !SEL.has(p.n); }); if(SEL.has(EV.cover)) EV.cover = ''; SEL.clear(); dirty = true; await save(); drawEdit(); }catch(e){ toast(e.message); } };
  }
}
function shown(){ return EV.photos.filter(function(p){ return FILTER === 'all' ? true : FILTER === 'untagged' ? !(p.nums || []).length : (p.nums || []).indexOf(FILTER.slice(1)) >= 0; }); }
function drawPhotos(){
  var host = $('psPhotos'); if(!host) return;
  var list = shown();
  host.innerHTML = list.length ? list.map(function(p){
    return '<div class="ps-ph' + (SEL.has(p.n) ? ' sel' : '') + '" data-n="' + esc(p.n) + '"><img src="' + thumb(p.n) + '" loading="lazy" alt=""><button type="button" class="ps-star' + (EV.cover === p.n ? ' on' : '') + '" title="Use as cover">' + (EV.cover === p.n ? '★ Cover' : '☆') + '</button>' +
      (EV.shop ? '<input data-title="1" value="' + esc(p.title || '') + '" placeholder="Title" aria-label="Title" style="text-transform:none">' : '<input value="' + esc((p.nums || []).join(', ')) + '" placeholder="Numbers" aria-label="Numbers in this photo" inputmode="text">') + '</div>';
  }).join('') : '<p class="tr-empty">' + (EV.photos.length ? 'No photos match.' : 'No photos yet.') + '</p>';
}
D.addEventListener('click', function(e){
  var ph = e.target.closest('.ps-ph'); if(!ph || !EV || !ph.dataset.n) return;
  var n = ph.dataset.n;
  if(e.target.closest('.ps-star')){ EV.cover = n; dirty = true; drawPhotos(); save(); return; }
  if(e.target.tagName === 'IMG'){ if(SEL.has(n)) SEL.delete(n); else SEL.add(n); drawEdit(); }
});
D.addEventListener('change', function(e){
  var ph = e.target.closest('.ps-ph'); if(!ph || !EV || e.target.tagName !== 'INPUT') return;
  var p = EV.photos.find(function(x){ return x.n === ph.dataset.n; }); if(!p) return;
  if(e.target.dataset.title) p.title = e.target.value.trim().slice(0, 80); else { p.nums = nums(e.target.value); e.target.value = p.nums.join(', '); } dirty = true; clearTimeout(save.t); save.t = setTimeout(save, 1500);
});
D.addEventListener('keydown', function(e){
  if(e.key !== 'Enter') return; var ph = e.target.closest && e.target.closest('.ps-ph'); if(!ph) return;
  e.preventDefault(); e.target.dispatchEvent(new Event('change', { bubbles:true }));
  var next = ph.nextElementSibling; if(next){ var i = next.querySelector('input'); if(i){ i.focus(); i.select(); next.scrollIntoView({ block:'nearest' }); } }
});

async function save(){
  if(!EV || saving) return; saving = true; var m = $('psSaveMsg'); if(m) m.textContent = 'Saving...';
  try{
    EV.prices = { photo: +EV.prices.photo || 0, bundle: +EV.prices.bundle || 0 };
    if(!EV.cover && EV.photos[0]) EV.cover = EV.photos[0].n;
    await api('/sales/admin/save', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(EV) });
    dirty = false; if(m) m.textContent = 'Saved ' + new Date().toLocaleTimeString('en-ZA', { hour:'2-digit', minute:'2-digit' });
    var c = EVENTS.find(function(e){ return e.id === EV.id; }); if(c){ c.title = EV.title; c.on = EV.on; c.count = EV.photos.length; c.cover = EV.cover; c.date = EV.date; drawEvents(); } else loadEvents();
  }catch(e){ if(m) m.textContent = 'Could not save: ' + e.message; }
  saving = false;
}
window.addEventListener('beforeunload', function(e){ if(dirty || UP.busy){ e.preventDefault(); e.returnValue = ''; } });

/* ---------- upload: watermarked thumb + preview, private full size ---------- */
var LOGO = new Image(); LOGO.src = 'assets/logo.png';
var UP = { busy:false, msg:'' };
function canvasOf(bmp, max){ var s = Math.min(1, max / Math.max(bmp.width, bmp.height)), c = D.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s); var x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, c.width, c.height); return c; }
function watermark(c, strong){
  var x = c.getContext('2d'), w = c.width, h = c.height;
  // 'difference' shows on light and dark photos alike
  x.save(); x.globalCompositeOperation = 'difference'; x.globalAlpha = strong ? 0.16 : 0.13; x.fillStyle = '#fff'; x.font = '800 ' + Math.round(w / 16) + 'px -apple-system, Helvetica, Arial, sans-serif'; x.textAlign = 'center';
  x.translate(w / 2, h / 2); x.rotate(-Math.PI / 7);
  for(var yy = -h; yy <= h; yy += w / 7){ for(var xx = -w; xx <= w; xx += w / 2.2){ x.fillText('FOM STUDIOS', xx + (yy / (w / 7) % 2 ? w / 4.4 : 0), yy); } }
  x.restore();
  if(LOGO.complete && LOGO.naturalWidth){ var lw = w * (strong ? 0.36 : 0.42), lh = lw * LOGO.naturalHeight / LOGO.naturalWidth; x.save(); x.globalCompositeOperation = 'difference'; x.globalAlpha = strong ? 0.32 : 0.38; x.filter = 'invert(1)'; x.drawImage(LOGO, (w - lw) / 2, (h - lh) / 2, lw, lh); x.restore(); }
  return c;
}
function blob(c, q){ return new Promise(function(res){ c.toBlob(res, 'image/jpeg', q); }); }
async function put(n, v, b){
  var r = await fetch(W + '/sales/admin/upload?ev=' + encodeURIComponent(EV.id) + '&n=' + encodeURIComponent(n) + '&v=' + v, { method:'POST', headers:{ Authorization: await tok(), 'Content-Type': b.type || 'image/jpeg' }, body:b });
  if(!r.ok){ var j = await r.json().catch(function(){ return {}; }); throw new Error(j.error || ('upload ' + r.status)); }
}
function safeN(name){ var base = String(name || 'photo').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'photo', n = base + '.jpg', i = 2;
  while(EV.photos.some(function(p){ return p.n === n; })) n = base + '-' + (i++) + '.jpg'; return n; }
async function upload(files){
  if(!files.length || !EV) return;
  if(UP.busy){ toast('Wait for the current upload to finish.'); return; }
  UP.busy = true; UP.msg = ''; $('psProg').style.display = ''; var done = 0, failed = 0, total = files.length;
  var tick = function(){ $('psProgTx').textContent = 'Uploading ' + done + ' of ' + total + (failed ? ' (' + failed + ' failed)' : '') + '... keep this page open'; $('psProgBar').style.width = Math.round(done / total * 100) + '%'; };
  tick();
  var queue = files.slice();
  async function worker(){
    while(queue.length){
      var f = queue.shift(), n = null;
      try{
        var bmp = await createImageBitmap(f, { imageOrientation:'from-image' });
        n = safeN(f.name); var w = bmp.width, h = bmp.height;
        EV.photos.push({ n:n, nums:[], w:w, h:h });   // reserve the name now so parallel uploads never clash
        var full = (f.type === 'image/jpeg' && f.size <= 24 * 1024 * 1024) ? f : await blob(canvasOf(bmp, 4200), 0.92);
        var prev = await blob(watermark(canvasOf(bmp, 1400), true), 0.8);
        var th = await blob(watermark(canvasOf(bmp, 560), false), 0.78);
        bmp.close && bmp.close();
        await put(n, 'f', full); await put(n, 'p', prev); await put(n, 't', th);
        done++;
      }catch(e){ console.warn(f.name, e); failed++; done++; if(n) EV.photos = EV.photos.filter(function(p){ return p.n !== n; }); }
      tick();
      if(done % 15 === 0){ dirty = true; await save(); drawPhotos(); }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  dirty = true; await save(); UP.busy = false;
  UP.msg = 'Done: ' + (total - failed) + ' uploaded' + (failed ? ', ' + failed + ' failed (try those again)' : '') + '. Now type the numbers under each photo.';
  drawEdit();
}

/* ---------- sales ---------- */
async function loadOrders(){ if(!EV) return; try{ ORDERS = (await api('/sales/admin/orders?ev=' + encodeURIComponent(EV.id))).orders || []; }catch(e){ ORDERS = []; } drawSales(); }
function drawSales(){
  var host = $('psSales'); if(!host) return;
  var paid = ORDERS.filter(function(o){ return o.status === 'paid'; }), sum = paid.reduce(function(a, o){ return a + (+o.amount || 0); }, 0);
  host.innerHTML = '<div class="ps-kpis"><div class="ps-kpi"><span class="tr-sub">Sold</span><b>' + R(sum) + '</b></div><div class="ps-kpi"><span class="tr-sub">Orders</span><b>' + paid.length + '</b></div><div class="ps-kpi"><span class="tr-sub">Photos sold</span><b>' + paid.reduce(function(a, o){ return a + (o.count || 0); }, 0) + '</b></div><div class="ps-kpi"><span class="tr-sub">Started, not paid</span><b>' + (ORDERS.length - paid.length) + '</b></div></div>' +
    (ORDERS.length ? '<div style="overflow-x:auto"><table class="ps-tab"><thead><tr><th>Buyer</th><th>Bought</th><th class="n">Amount</th><th></th></tr></thead><tbody>' + ORDERS.map(function(o){
      var ph = String(o.buyer && o.buyer.phone || '').replace(/\D/g, ''); if(ph.charAt(0) === '0') ph = '27' + ph.slice(1);
      return '<tr><td><b>' + esc(o.buyer && o.buyer.name) + '</b><div class="tr-sub">' + esc(o.buyer && o.buyer.email) + (ph ? ' · <a href="https://wa.me/' + ph + '" target="_blank" rel="noopener">WhatsApp</a>' : '') + '</div><div class="tr-sub">' + new Date(o.created).toLocaleString('en-ZA', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) + '</div></td>' +
        '<td>' + esc(o.label) + '<div><span class="ps-st' + (o.status === 'paid' ? ' paid' : '') + '">' + (o.status === 'paid' ? 'Paid' : 'Not paid') + '</span></div></td><td class="n">' + R(o.amount) + '</td>' +
        '<td>' + (o.status === 'paid' ? '<button type="button" class="ps-btn" data-copy="' + esc(o.link) + '">Copy link</button>' : '<button type="button" class="ps-btn" data-paid="' + esc(o.o) + '">Mark paid</button>') + '</td></tr>';
    }).join('') + '</tbody></table></div><p class="tr-sub" style="margin-top:8px">Mark paid unlocks the photos for someone who paid by EFT or cash, and emails them their link.</p>' : '<p class="tr-empty">No sales yet. Share the link on Instagram, in the WhatsApp group and with the event organisers.</p>') +
    '<div class="ps-row" style="margin-top:10px"><button type="button" class="ps-btn" id="psRefresh">Refresh</button></div>';
  $('psRefresh').onclick = loadOrders;
}
D.addEventListener('click', async function(e){
  var b = e.target.closest('[data-copy],[data-paid]'); if(!b || !$('psSales') || !$('psSales').contains(b)) return;
  if(b.dataset.copy){ navigator.clipboard.writeText(b.dataset.copy).then(function(){ toast('Download link copied'); }); return; }
  if(!confirm('Mark this order as paid? The buyer gets their download link by email.')) return;
  try{ var j = await api('/sales/admin/paid', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ o:b.dataset.paid }) }); toast('Unlocked'); loadOrders(); }catch(x){ toast(x.message); }
});

/* ---------- print settings ---------- */
var CFG = null;
var CFG_DEF = { sizes:[{ id:'a4', label:'A4 (21 x 30 cm)' },{ id:'a3', label:'A3 (30 x 42 cm)' },{ id:'a2', label:'A2 (42 x 59 cm)' }],
  finishes:[{ id:'print', label:'Print only' },{ id:'framed-black', label:'Framed, black' },{ id:'framed-white', label:'Framed, white' },{ id:'framed-oak', label:'Framed, oak' },{ id:'canvas', label:'Canvas' }],
  prices:{}, delivery:[{ id:'collect', label:'Collect in Joburg', fee:0, on:true, note:'We WhatsApp you when it is ready to collect.' },{ id:'gauteng', label:'Gauteng delivery', fee:0, on:false },{ id:'courier', label:'Courier anywhere in SA', fee:0, on:false }],
  turnaround:'5 to 7 working days', note:'' };
async function loadCfg(){ try{ var j = await (await fetch(W + '/sales/shop?t=' + Date.now(), { cache:'no-store' })).json(); CFG = j.cfg && j.cfg.sizes ? j.cfg : JSON.parse(JSON.stringify(CFG_DEF)); }catch(e){ CFG = JSON.parse(JSON.stringify(CFG_DEF)); } drawCfg(); }
function drawCfg(){
  var c = CFG, b = $('psCfgBody'), set = Object.keys(c.prices || {}).filter(function(k){ return +c.prices[k]; }).length;
  if(!set) $('psCfg').classList.remove('folded');
  b.innerHTML = '<p class="tr-sub" style="margin:0 0 10px">Your selling prices, used by the Prints shop, client galleries and event photos. Empty = not offered. Example: if your lab charges R180 for an A4 framed, you could sell it at R450.</p>' +
    '<div style="overflow-x:auto"><table class="ps-tab"><thead><tr><th>Size</th>' + c.finishes.map(function(f){ return '<th>' + esc(f.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
    c.sizes.map(function(z){ return '<tr><td><b>' + esc(z.label) + '</b></td>' + c.finishes.map(function(f){ var k = z.id + '|' + f.id; return '<td><input class="ps-in" style="width:84px" inputmode="numeric" data-price="' + esc(k) + '" value="' + esc(c.prices[k] || '') + '" placeholder="R"></td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' +
    '<div class="ps-grid2" style="margin-top:12px"><div><label>Sizes (one per line)</label><textarea class="ps-in" rows="4" id="psSizes">' + esc(c.sizes.map(function(z){ return z.label; }).join('\n')) + '</textarea></div>' +
    '<div><label>Finishes (one per line)</label><textarea class="ps-in" rows="4" id="psFins">' + esc(c.finishes.map(function(z){ return z.label; }).join('\n')) + '</textarea></div></div>' +
    '<h3 style="margin:16px 0 8px;font-size:15px">Delivery</h3>' + c.delivery.map(function(d, i){ return '<div class="ps-row" style="margin-bottom:6px"><label class="tr-tg" style="margin:0"><input type="checkbox" data-don="' + i + '"' + (d.on ? ' checked' : '') + '></label><input class="ps-in" data-dlabel="' + i + '" value="' + esc(d.label) + '"><input class="ps-in" style="width:90px;flex:none" inputmode="numeric" data-dfee="' + i + '" value="' + esc(d.fee || '') + '" placeholder="Fee R"></div>'; }).join('') +
    '<div class="ps-grid2" style="margin-top:10px"><div><label>Ready in</label><input class="ps-in" id="psTurn" value="' + esc(c.turnaround || '') + '"></div><div><label>Line under each print (optional)</label><input class="ps-in" id="psNote" value="' + esc(c.note || '') + '" placeholder="Printed by a professional lab and checked by us before it goes out."></div></div>' +
    '<div class="ps-row" style="margin-top:12px"><button type="button" class="ps-btn go" id="psCfgSave">Save print settings</button><span class="tr-sub" id="psCfgMsg"></span></div>';
  $('psCfgSave').onclick = saveCfg;
}
function idOf(l){ return String(l).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'x'; }
async function saveCfg(){
  var c = CFG, b = $('psCfgBody');
  b.querySelectorAll('[data-price]').forEach(function(i){ var v = +i.value.replace(/\D/g, '') || 0; if(v) c.prices[i.dataset.price] = v; else delete c.prices[i.dataset.price]; });
  var lines = function(id){ return $(id).value.split('\n').map(function(x){ return x.trim(); }).filter(Boolean).slice(0, 12); };
  var keepId = function(list, label){ var o = list.find(function(x){ return x.label === label; }); return o ? o.id : idOf(label); };
  c.sizes = lines('psSizes').map(function(l){ return { id:keepId(c.sizes, l), label:l }; });
  c.finishes = lines('psFins').map(function(l){ return { id:keepId(c.finishes, l), label:l }; });
  b.querySelectorAll('[data-dlabel]').forEach(function(i){ c.delivery[+i.dataset.dlabel].label = i.value.trim(); });
  b.querySelectorAll('[data-dfee]').forEach(function(i){ c.delivery[+i.dataset.dfee].fee = +i.value.replace(/\D/g, '') || 0; });
  b.querySelectorAll('[data-don]').forEach(function(i){ c.delivery[+i.dataset.don].on = i.checked; });
  c.turnaround = $('psTurn').value.trim(); c.note = $('psNote').value.trim();
  try{ await api('/sales/admin/shopcfg', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(c) }); drawCfg(); $('psCfgMsg').textContent = 'Saved'; toast('Print settings saved'); }catch(e){ $('psCfgMsg').textContent = 'Could not save: ' + e.message; }
}

/* ---------- print orders ---------- */
var PO = [], PO_ALL = false;
var STAGES = [['new','New'],['ordered','Ordered from lab'],['ready','Ready'],['out','Out for delivery'],['delivered','Delivered']];
var STAGE_MSG = { ordered:'your print is at the lab now and should be ready in {turn}', ready:'your print is ready! {how}', out:'your print is on its way to you today', delivered:'hope you love your print! If you share it, tag @fom_studios_ 📸' };
async function loadPO(){ try{ PO = (await api('/sales/admin/orders?type=print')).orders || []; }catch(e){ PO = []; } drawPO(); }
function drawPO(){
  var host = $('psPO'); if(!host) return;
  var paid = PO.filter(function(o){ return o.status === 'paid'; }), open = paid.filter(function(o){ return o.stage !== 'delivered'; });
  var list = PO_ALL ? PO : open;
  host.innerHTML = '<div class="ps-kpis"><div class="ps-kpi"><span class="tr-sub">To do</span><b>' + open.length + '</b></div><div class="ps-kpi"><span class="tr-sub">Sold (all time)</span><b>' + R(paid.reduce(function(a, o){ return a + (+o.amount || 0); }, 0)) + '</b></div></div>' +
    (list.length ? list.map(function(o, oi){
      var ph = String(o.buyer && o.buyer.phone || '').replace(/\D/g, ''); if(ph.charAt(0) === '0') ph = '27' + ph.slice(1);
      var a = o.delivery && o.delivery.address;
      return '<div class="ps-ev" style="display:block;cursor:default"><div class="ps-row" style="justify-content:space-between"><div><b>' + esc(o.buyer && o.buyer.name) + '</b> <span class="ps-st' + (o.status === 'paid' ? ' paid' : '') + '">' + (o.status === 'paid' ? R(o.amount) + ' paid' : 'Not paid') + '</span><div class="tr-sub">' + new Date(o.created).toLocaleString('en-ZA', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) + ' · ' + esc(o.buyer && o.buyer.email) + (ph ? ' · +' + ph : '') + (o.from ? ' · from ' + esc(o.from) : '') + '</div></div>' +
        (o.status === 'paid' ? '<select class="ps-in" style="width:auto" data-stage="' + esc(o.o) + '">' + STAGES.map(function(s){ return '<option value="' + s[0] + '"' + ((o.stage || 'new') === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select>' : '<button type="button" class="ps-btn" data-popaid="' + esc(o.o) + '">Mark paid</button>') + '</div>' +
        '<div class="ps-photos" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">' + (o.prints || []).map(function(p, i){ return '<div class="ps-ph"><img src="' + esc(p.thumb) + '" alt=""><div style="padding:6px 8px;font-size:12.5px">' + esc(p.label) + '<br><button type="button" class="ps-btn" style="margin-top:6px;padding:6px 10px" data-file="' + esc(o.o) + '|' + i + '">⬇ Full file</button></div></div>'; }).join('') + '</div>' +
        '<div class="tr-sub" style="margin-top:8px">' + esc(o.delivery ? o.delivery.label : '') + (a ? ': ' + esc([a.street, a.suburb, a.city, a.code, a.province].filter(Boolean).join(', ')) + (a.notes ? ' (' + esc(a.notes) + ')' : '') : '') + ((o.count || 0) ? ' · plus ' + o.count + ' digital (sent automatically)' : '') + '</div>' +
        (ph && o.status === 'paid' ? '<div class="ps-row" style="margin-top:8px"><button type="button" class="ps-btn" data-wa="' + oi + '">💬 WhatsApp update</button></div>' : '') + '</div>';
    }).join('') : '<p class="tr-empty">' + (PO.length ? 'All print orders are delivered. 🎉' : 'No print orders yet.') + '</p>') +
    '<div class="ps-row" style="margin-top:8px"><button type="button" class="ps-btn" id="psPOAll">' + (PO_ALL ? 'Show only open orders' : 'Show all orders') + '</button><button type="button" class="ps-btn" id="psPORefresh">Refresh</button></div>';
  $('psPOAll').onclick = function(){ PO_ALL = !PO_ALL; drawPO(); };
  $('psPORefresh').onclick = loadPO;
  host.querySelectorAll('[data-wa]').forEach(function(b){ b.onclick = function(){ var o = list[+b.dataset.wa], st = o.stage || 'new';
    var how = o.delivery && o.delivery.id === 'collect' ? 'When would you like to collect it?' : 'We will let you know when it is on the way.';
    var line = (STAGE_MSG[st] || 'thank you for your order! We are getting your print made').replace('{turn}', (CFG && CFG.turnaround) || 'a few days').replace('{how}', how);
    var ph = String(o.buyer.phone).replace(/\D/g, ''); if(ph.charAt(0) === '0') ph = '27' + ph.slice(1);
    window.open('https://wa.me/' + ph + '?text=' + encodeURIComponent('Hi ' + String(o.buyer.name || '').split(' ')[0] + ', ' + line + '. FOM Studios'), '_blank'); }; });
}
D.addEventListener('change', async function(e){
  var sel = e.target.closest && e.target.closest('[data-stage]'); if(!sel) return;
  try{ await api('/sales/admin/stage', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ o:sel.dataset.stage, stage:sel.value }) }); var o = PO.find(function(x){ return x.o === sel.dataset.stage; }); if(o) o.stage = sel.value; toast('Updated. Tap WhatsApp update to tell them.'); drawPO(); }catch(x){ toast(x.message); }
});
D.addEventListener('click', async function(e){
  var f = e.target.closest('[data-file],[data-popaid]'); if(!f) return;
  if(f.dataset.popaid){ if(!confirm('Mark this print order as paid?')) return; try{ await api('/sales/admin/paid', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ o:f.dataset.popaid }) }); loadPO(); }catch(x){ toast(x.message); } return; }
  var q = f.dataset.file.split('|'); f.disabled = true; f.textContent = 'Downloading...';
  try{ var r = await fetch(W + '/sales/admin/file?o=' + encodeURIComponent(q[0]) + '&i=' + q[1], { headers:{ Authorization: await tok() } }); if(!r.ok) throw new Error('file ' + r.status);
    var name = (/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '') || [])[1] || 'print.jpg', bl = await r.blob(), a = D.createElement('a');
    a.href = URL.createObjectURL(bl); a.download = name; D.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
  }catch(x){ toast('Could not download: ' + x.message); }
  f.disabled = false; f.textContent = '⬇ Full file';
});

/* ---------- start ---------- */
window.FOM_SALES_START = function(auth){
  AUTH = auth;
  if(BZ && BZ.isSba){ $('psOffBiz').style.display = ''; $('psMain').style.display = 'none'; return; }
  drawSetup(); loadEvents(); loadCfg(); loadPO();
  var q = new URLSearchParams(location.search).get('ev'); if(q) openEvent(q);
};
window.FOM_SALES = { ev:function(){ return EV; }, upload:upload, save:save };
})();
