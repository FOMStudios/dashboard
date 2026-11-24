/* Group gallery link (Database page, Gallery and portal, "👥 Group link"), Nov 2026.
   Shares one client's gallery with a whole group (a Pilates class, a team) through a temporary link:
   same gallery look, chosen photos only, the client's folder never shows. Per link: title, end date (14 days to start),
   what guests can do (free downloads, view only, or watermarked and buy through Photo Sales) and an optional 4-digit PIN.
   Worker: GET /admin/groups?order=, POST /admin/group. Guest page: fomstudios.co.za/g.html?s=<id> (Shot by A: /shotbya/g.html).
   Needs from database.html: auth, GALLERY_WORKER, FOM_BIZ, esc, store. QR codes: vendor/qrcode.js. */
(function(){
  var W = 'https://fom-gallery.cold-moon-d65c.workers.dev';
  var MODES = [['free','Free downloads','Guests view and download full quality, like the client'],['view','View only','No download buttons (screenshots still work)'],['paid','Watermarked, buy to download','Guests see watermarked photos and buy downloads or prints (Photo Sales)']];
  function e(t){ return String(t == null ? '' : t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function today(){ return new Date().toLocaleDateString('en-CA', { timeZone:'Africa/Johannesburg' }); }
  function addDays(d, n){ var x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  function nice(d){ try{ return new Date(d + 'T12:00:00Z').toLocaleDateString('en-ZA', { weekday:'short', day:'numeric', month:'short' }); }catch(x){ return d; } }
  function pin(){ return String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000)); }
  function sba(){ return !!(window.FOM_BIZ && FOM_BIZ.isSba); }
  function link(g){ return 'https://www.fomstudios.co.za/' + (g.biz === 'sba' ? 'shotbya/' : '') + 'g.html?s=' + g.s; }
  async function api(path, body){
    var t = await auth.currentUser.getIdToken();
    var r = await fetch(W + path, body ? { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + t }, body:JSON.stringify(body) } : { headers:{ Authorization:'Bearer ' + t } });
    var j = await r.json().catch(function(){ return {}; }); if(!r.ok) throw new Error(j.error || ('Worker error ' + r.status)); return j;
  }
  function modal(html){
    var ov = document.createElement('div'); ov.className = 'lg-ov'; ov.innerHTML = '<div class="lg-box gl-box" role="dialog">' + html + '</div>';
    document.body.appendChild(ov); ov.addEventListener('click', function(ev){ if(ev.target === ov || ev.target.closest('[data-glx]')) ov.remove(); });
    return ov;
  }
  function css(){
    if(document.getElementById('glCss')) return;
    var s = document.createElement('style'); s.id = 'glCss';
    s.textContent = '.gl-box{max-width:620px;max-height:92vh;overflow:auto}.gl-f{margin:0 0 12px}.gl-f>label{display:block;font-size:12px;font-weight:700;color:var(--ink-soft);margin-bottom:4px}' +
      '.gl-f input[type=text],.gl-f input[type=date],.gl-f input:not([type]){width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid var(--line);border-radius:12px;font:inherit;background:var(--bg);color:var(--ink)}' +
      '.gl-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.gl-chips button{border:1px solid var(--line);background:var(--bg);border-radius:99px;padding:5px 11px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;color:var(--ink)}' +
      '.gl-mode{display:grid;gap:6px}.gl-mode label{display:flex;gap:10px;align-items:flex-start;border:1.5px solid var(--line);border-radius:12px;padding:10px 12px;cursor:pointer}.gl-mode label.on{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 7%,transparent)}.gl-mode small{display:block;color:var(--ink-soft);font-size:12px}.gl-mode label.dis{opacity:.45;cursor:not-allowed}' +
      '.gl-pin{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.gl-pin input{width:110px!important;text-align:center;font-size:20px!important;font-weight:800;letter-spacing:.25em}' +
      '.gl-ph{display:grid;grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:6px;max-height:300px;overflow:auto;padding:2px}.gl-ph button{position:relative;aspect-ratio:1;border:0;padding:0;border-radius:8px;overflow:hidden;cursor:pointer;background:var(--line)}.gl-ph img{width:100%;height:100%;object-fit:cover;display:block}' +
      '.gl-ph button.off img{opacity:.28;filter:grayscale(1)}.gl-ph button i{position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;background:var(--accent);color:#fff;font-size:12px;font-style:normal;font-weight:800;display:flex;align-items:center;justify-content:center}.gl-ph button.off i{background:rgba(0,0,0,.35)}' +
      '.gl-ph .vid{display:flex;align-items:center;justify-content:center;height:100%;font-size:24px}' +
      '.gl-link{display:flex;gap:12px;align-items:center;background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:12px;margin:10px 0}.gl-link img{width:110px;height:110px;flex:none;background:#fff;border-radius:8px;padding:4px}.gl-link b{word-break:break-all}' +
      '.gl-stats{display:flex;gap:14px;flex-wrap:wrap;font-size:13px;color:var(--ink-soft);margin:6px 0 4px}.gl-stats b{color:var(--ink);font-size:16px;display:block}.gl-who{margin:8px 0;font-size:13px}.gl-who summary{cursor:pointer;font-weight:700}.gl-wl{display:grid;gap:6px;margin-top:8px;max-height:240px;overflow:auto}.gl-wl div{display:flex;flex-wrap:wrap;gap:2px 10px;align-items:baseline;padding:7px 10px;border-radius:10px;background:var(--surface-2,#f1f0ec)}.gl-wl span{color:var(--ink-soft);font-size:12px}.gl-wl a{margin-left:auto;font-size:12px}.gl-warn{background:#fff4e5;color:#7a4b00;border-radius:10px;padding:8px 10px;font-size:12.5px;margin:8px 0}';
    document.head.appendChild(s);
  }
  var PICKS = {};
  function first(o){ return String(o.customer || 'The client').split(' ')[0]; }
  /* the client's "Group photos" switch changed on the Database: bring their group link(s) in line */
  async function sync(o){
    try{
      var res = await api('/admin/groups?order=' + encodeURIComponent(o.id));
      for(var k = 0; k < (res.groups || []).length; k++){ var g = res.groups[k]; var cv = o.galleryCover && o.galleryCover.n ? o.galleryCover : null, same = JSON.stringify(g.cover ? [g.cover.n, g.cover.fx, g.cover.fy] : null) === JSON.stringify(cv ? [cv.n, isFinite(parseFloat(cv.fx)) ? Math.round(cv.fx) : 50, isFinite(parseFloat(cv.fy)) ? Math.round(cv.fy) : 40] : null);
        if(!!g.client !== !!o.groupPicksOn || !same) await api('/admin/group', Object.assign({}, g, { client:!!o.groupPicksOn, cover:cv })); }
    }catch(x){ console.warn('group sync', x); }
  }
  function qr(url){ try{ var q = qrcode(0, 'M'); q.addData(url); q.make(); return q.createDataURL(6, 2); }catch(x){ return ''; } }

  async function open(o){
    css();
    if(!o.galleryFolder){ alert('Set the client\'s Gallery folder first, then make the group link.'); return; }
    var groups = [];
    try{ var res = await api('/admin/groups?order=' + encodeURIComponent(o.id)); groups = res.groups || []; PICKS[o.id] = { list:res.picks, at:res.picksAt }; }catch(x){ alert('Could not reach the gallery Worker: ' + x.message); return; }
    if(groups.length) return show(o, groups[groups.length - 1]); else edit(o, null);
  }

  /* ---------- the link: copy, WhatsApp, QR, stats, change, turn off ---------- */
  function ppl(g){ return Array.isArray(g.people) ? g.people : []; }
  /* who downloaded: name (asked before their first download), WhatsApp, phone type, files, when */
  function who(g){
    var list = ppl(g); if(!list.length && !(g.dls > 0)) return '';
    var known = list.reduce(function(a, p){ return a + (p.files || 0); }, 0), older = Math.max(0, (g.dls || 0) - known);
    var ago = function(t){ var m = Math.round((Date.now() - Date.parse(t)) / 60000); return !isFinite(m) ? '' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
    var wa = function(n){ var d = String(n || '').replace(/\D/g, ''); if(d.charAt(0) === '0') d = '27' + d.slice(1); return d.length > 8 ? d : ''; };
    return '<details class="gl-who"' + (list.length && list.length <= 12 ? ' open' : '') + '><summary>Who downloaded (' + list.length + ')</summary>' +
      (list.length ? '<div class="gl-wl">' + list.map(function(p){
        var w = wa(p.p);
        return '<div><b>' + e(p.n || 'No name') + '</b><span>' + (p.files || 0) + ' file' + (p.files === 1 ? '' : 's') + (p.dev ? ' · ' + e(p.dev) : '') + ' · ' + ago(p.last) + '</span>' + (w ? '<a target="_blank" rel="noopener" href="https://wa.me/' + w + '">' + e(p.p) + '</a>' : '') + '</div>';
      }).join('') + '</div>' : '') +
      (older ? '<div style="font-size:12px;color:var(--ink-soft);margin-top:6px">' + older + ' files were saved before names were asked (24 Nov 2026).</div>' : '') + '</details>';
  }
  function show(o, g){
    var url = link(g), msg = 'Hi everyone! 📸 The photos from ' + g.title + ' are ready.\n\n' + url + (g.pin ? '\nPIN: ' + g.pin : '') + '\n\nThey are up until ' + nice(g.expires) + (g.mode === 'free' ? ', so download your favourites before then.' : '.') + (g.mode === 'paid' ? ' Tap the ones you love to get the full-quality download or a print.' : '') + '\n\nTag ' + (g.biz === 'sba' ? '@shotbya_photography' : '@fom_studios_') + ' when you post them 🙌';
    var mode = MODES.filter(function(m){ return m[0] === g.mode; })[0] || MODES[0];
    var late = o.galleryExpiry && g.expires > addDays(o.galleryExpiry, 7);
    var ov = modal('<h3>👥 Group link: ' + e(g.title) + '</h3>' +
      '<div class="gl-stats"><span><b>' + (g.ended ? (g.on ? 'Ended' : 'Off') : 'Live') + '</b>status</span><span><b>' + nice(g.expires) + '</b>ends</span><span><b>' + (g.views || 0) + '</b>people opened it</span><span><b>' + ppl(g).length + '</b>' + (ppl(g).length === 1 ? 'person' : 'people') + ' downloaded<small style="display:block;font-size:11.5px">' + (g.dls || 0) + ' files saved</small></span><span><b>' + (g.client ? (g.soon ? 'Waiting' : g.files.length) : (Array.isArray(g.files) ? g.files.length : 'All')) + '</b>' + (g.client ? 'approved by ' + e(first(o)) : 'photos') + '</span></div>' +
      who(g) +
      (g.client && g.soon ? '<div class="gl-warn">' + e(first(o)) + ' has not approved any photos yet, so guests see "Photos coming soon". She ticks them in her portal gallery (👥 Choose what the group sees). It goes live the moment she taps Done, and your phone buzzes.</div>' : '') +
      '<div class="gl-link">' + (qr(url) ? '<img src="' + qr(url) + '" alt="QR code">' : '') + '<div><b>' + e(url) + '</b><div style="font-size:13px;color:var(--ink-soft);margin-top:4px">' + e(mode[1]) + (g.pin ? ' · PIN <b style="color:var(--ink)">' + e(g.pin) + '</b>' : ' · No PIN, anyone with the link') + '</div></div></div>' +
      (late ? '<div class="gl-warn">Heads up: the client\'s gallery folder is deleted 7 days after their own expiry (' + nice(o.galleryExpiry) + '), before this link ends. Push their expiry out, or end the group link sooner.</div>' : '') +
      (g.mode === 'paid' && !g.salesUrl ? '<div class="gl-warn">Last step: build the sale page from these photos. Guests see "Photos coming soon" until then.<div style="margin-top:8px"><a class="op-btn pri" target="_blank" rel="noopener" href="sales.html?group=' + e(g.s) + '">🛒 Build the Photo Sales page</a></div></div>' : '') +
      (g.mode === 'paid' && g.salesUrl ? '<div style="font-size:13px;color:var(--ink-soft)">Opens the sale page: <a href="' + e(g.salesUrl) + '&preview=1" target="_blank" rel="noopener">' + e(g.salesUrl.replace('https://www.', '')) + '</a>. Photo Sales must be live on your website (Photo Sales page).</div>' : '') +
      '<label class="lg-l" style="margin-top:12px">Message to send</label><textarea class="lg-msg" id="glMsg">' + e(msg) + '</textarea>' +
      '<div class="lg-acts"><button type="button" id="glEdit">Change</button><button type="button" id="glOff">' + (g.on ? 'Turn off' : 'Turn on') + '</button><button type="button" id="glNew" title="Makes a fresh link; the old one stops working">New link</button>' +
      '<a class="lg-go wa" style="text-decoration:none" target="_blank" rel="noopener" id="glWa">Share on WhatsApp</a><button type="button" class="lg-go" id="glCopy">Copy message</button>' + (qr(url) ? '<a download="group-link-qr.png" href="' + qr(url) + '" style="text-decoration:none">QR picture</a>' : '') + '<button type="button" data-glx>Done</button></div>');
    var m = ov.querySelector('#glMsg');
    ov.querySelector('#glWa').onclick = function(){ this.href = 'https://wa.me/?text=' + encodeURIComponent(m.value); };
    var cb = ov.querySelector('#glCopy'); cb.onclick = function(){ navigator.clipboard.writeText(m.value).then(function(){ cb.textContent = 'Copied ✓'; }, function(){ prompt('Copy this:', m.value); }); };
    ov.querySelector('#glEdit').onclick = function(){ ov.remove(); edit(o, g); };
    ov.querySelector('#glOff').onclick = async function(){ try{ var j = await api('/admin/group', Object.assign({}, g, { on:!g.on })); ov.remove(); show(o, j.group); }catch(x){ alert(x.message); } };
    ov.querySelector('#glNew').onclick = async function(){
      if(!confirm('Make a new link? The old link stops working straight away, so anyone you sent it to needs the new one.')) return;
      try{ await api('/admin/group', { action:'delete', s:g.s }); var c = Object.assign({}, g); delete c.s; c.pin = g.pin ? pin() : ''; var j = await api('/admin/group', c); ov.remove(); show(o, j.group); }catch(x){ alert(x.message); }
    };
  }

  /* ---------- make or change: title, end date, what guests can do, PIN, photos ---------- */
  async function edit(o, g){
    var B = window.FOM_BIZ && FOM_BIZ.b ? FOM_BIZ.b : { name:'FOM Studios' };
    g = g || { title:o.product || 'Event photos', date:o.shootDate || '', expires:addDays(today(), 14), mode:'free', pin:pin(), files:null, on:true };
    var pinOn = !!g.pin, pinVal = g.pin || pin(), files = [], picked = null;
    var ov = modal('<h3>👥 ' + (g.s ? 'Change group link' : 'New group link') + '</h3><p class="lg-sub">One link for everyone at the event. Same gallery look as ' + e(o.customer || 'the client') + '\'s, only the photos you pick, and it ends on the date you set. Their own gallery and portal do not change.</p>' +
      '<div class="gl-f"><label>Title guests see</label><input id="glT" maxlength="80" value="' + e(g.title) + '"></div>' +
      '<div class="gl-f"><label>Link ends on</label><input id="glE" type="date" value="' + e(g.expires) + '"><div class="gl-chips"><button type="button" data-d="7">7 days</button><button type="button" data-d="14">14 days</button><button type="button" data-d="30">30 days</button></div></div>' +
      '<div class="gl-f"><label>What guests can do</label><div class="gl-mode" id="glM">' + MODES.map(function(m){ var dis = m[0] === 'paid' && sba(); return '<label class="' + (g.mode === m[0] ? 'on' : '') + (dis ? ' dis' : '') + '"><input type="radio" name="glm" value="' + m[0] + '"' + (g.mode === m[0] ? ' checked' : '') + (dis ? ' disabled' : '') + '><span><b>' + m[1] + '</b><small>' + m[2] + (dis ? ' (FOM only for now)' : '') + '</small></span></label>'; }).join('') + '</div></div>' +
      '<div class="gl-f"><label>PIN</label><div class="gl-pin"><label style="display:flex;gap:8px;align-items:center;font-weight:700;font-size:14px;cursor:pointer"><input type="checkbox" id="glPo" style="width:18px;height:18px"' + (pinOn ? ' checked' : '') + '> Ask for a 4-digit PIN</label><input id="glP" inputmode="numeric" maxlength="4" value="' + e(pinVal) + '"' + (pinOn ? '' : ' disabled') + '></div><small style="color:var(--ink-soft);font-size:12px">Off: anyone with the link can open it.</small></div>' +
      (o.groupPicksOn ? '<div class="gl-f"><label>Photos the group sees</label><div class="gl-warn" style="background:var(--bg);color:var(--ink)">&#128101; <b>' + e(first(o)) + ' chooses them</b> in her portal gallery (Group photos is set to "They choose" on this client). ' +
        ((PICKS[o.id] && PICKS[o.id].list && PICKS[o.id].list.length) ? 'She has approved <b>' + PICKS[o.id].list.length + '</b> so far.' : 'Nothing approved yet: guests see "Photos coming soon" until she does.') + ' To pick them yourself instead, set Group photos back to "I choose them".</div></div>'
      : '<div class="gl-f"><label>Photos the group sees <span id="glN"></span></label><div class="gl-chips" style="margin:0 0 8px"><button type="button" id="glAll">Select all</button><button type="button" id="glNone">Select none</button></div><div class="gl-ph" id="glPh"><div style="grid-column:1/-1;color:var(--ink-soft);font-size:13px;padding:10px">Loading the photos...</div></div></div>') +
      '<div class="lg-err" id="glErr"></div><div class="lg-acts"><button type="button" data-glx>Cancel</button><button type="button" class="lg-go" id="glSave">' + (g.s ? 'Save changes' : 'Make the link') + '</button></div>');
    var $ = function(id){ return ov.querySelector('#' + id); };
    ov.querySelectorAll('[data-d]').forEach(function(b){ b.onclick = function(){ $('glE').value = addDays(today(), +b.dataset.d); }; });
    $('glM').onchange = function(){ ov.querySelectorAll('#glM label').forEach(function(l){ l.classList.toggle('on', l.querySelector('input').checked); }); };
    $('glPo').onchange = function(){ $('glP').disabled = !this.checked; if(this.checked && !/^\d{4}$/.test($('glP').value)) $('glP').value = pin(); };
    var CL = !!o.groupPicksOn;
    function count(){ if(CL) return; $('glN').textContent = '(' + picked.size + ' of ' + files.length + ')'; }
    function draw(){
      $('glPh').innerHTML = files.length ? files.map(function(f, i){ return '<button type="button" data-p="' + i + '" class="' + (picked.has(f.name) ? '' : 'off') + '" title="' + e(f.name) + '">' + (f.kind === 'image' ? '<img loading="lazy" src="' + e(f.url) + '" alt="">' : '<span class="vid">🎬</span>') + '<i>' + (picked.has(f.name) ? '✓' : '') + '</i></button>'; }).join('') : '<div style="grid-column:1/-1;color:var(--ink-soft);font-size:13px;padding:10px">No photos in ' + e(o.galleryFolder) + ' yet.</div>';
      count();
    }
    if(!CL) $('glPh').onclick = function(ev){ var b = ev.target.closest('[data-p]'); if(!b) return; var f = files[+b.dataset.p]; if(picked.has(f.name)) picked.delete(f.name); else picked.add(f.name); b.classList.toggle('off', !picked.has(f.name)); b.querySelector('i').textContent = picked.has(f.name) ? '✓' : ''; count(); };
    if(!CL){ $('glAll').onclick = function(){ files.forEach(function(f){ picked.add(f.name); }); draw(); };
    $('glNone').onclick = function(){ picked.clear(); draw(); }; }
    if(CL){ picked = new Set(); } else try{
      var j = await (await fetch(W + '/list?g=' + encodeURIComponent(o.galleryFolder))).json();
      files = (j.files || []).filter(function(f){ return f.kind === 'image' || f.kind === 'video'; });
      picked = new Set(Array.isArray(g.files) ? g.files.filter(function(n){ return files.some(function(f){ return f.name === n; }); }) : files.map(function(f){ return f.name; }));
      draw();
    }catch(x){ $('glPh').innerHTML = '<div style="grid-column:1/-1;color:#b3261e;font-size:13px;padding:10px">Could not list the folder: ' + e(x.message) + '</div>'; files = []; picked = new Set(); }
    $('glSave').onclick = async function(){
      var er = $('glErr'), mode = (ov.querySelector('input[name=glm]:checked') || {}).value || 'free', usePin = $('glPo').checked, p = $('glP').value.trim();
      if(usePin && !/^\d{4}$/.test(p)){ er.textContent = 'The PIN must be 4 numbers.'; return; }
      if(!$('glE').value || $('glE').value < today()){ er.textContent = 'Pick an end date from today on.'; return; }
      if(!CL && !picked.size){ er.textContent = 'Pick at least one photo.'; return; }
      var all = !CL && picked.size === files.length;
      this.disabled = true; this.textContent = 'Saving...';
      try{
        var r = await api('/admin/group', Object.assign({}, g, { biz:sba() ? 'sba' : 'fom', order:o.id, name:o.customer || '', folder:o.galleryFolder, cover:o.galleryCover && o.galleryCover.n ? o.galleryCover : null, title:$('glT').value.trim() || 'Event photos', date:o.shootDate || g.date || '', expires:$('glE').value, mode:mode, pin:usePin ? p : '', client:CL, files:CL ? [] : all ? null : files.filter(function(f){ return picked.has(f.name); }).map(function(f){ return f.name; }), on:true, salesUrl:mode === 'paid' ? (g.salesUrl || '') : '' }));
        ov.remove(); show(o, r.group);
      }catch(x){ er.textContent = x.message; this.disabled = false; this.textContent = g.s ? 'Save changes' : 'Make the link'; }
    };
  }
  window.FOM_GROUP = { open:open, sync:sync };
})();
