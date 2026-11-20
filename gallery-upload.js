/* Gallery upload (Database page, Gallery and portal, "⬆ Upload files"), Nov 2026.
   Uploads a client's final photos and videos straight into their R2 gallery folder through the gallery Worker,
   with no 100-file limit like the Cloudflare dashboard. 3 files at a time; videos over 90 MB go up in 50 MB parts.
   Files already in the folder with the same name and size are skipped, so you can drop the whole folder again after a break.
   Needs from database.html: auth, FOM_BIZ, store. */
(function(){
  var W = 'https://fom-gallery.cold-moon-d65c.workers.dev', ONE = 90 * 1024 * 1024, PART = 50 * 1024 * 1024;
  var OK = /\.(jpe?g|png|webp|heic|heif|gif|tiff?|mp4|mov|m4v|webm|avi|mkv|zip|pdf)$/i;
  function e(t){ return String(t == null ? '' : t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function mb(b){ return b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + ' MB'; }
  function slug(s){ return String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40); }
  function clean(n){ return String(n || '').replace(/[\\/]/g, '-').replace(/[^\w .()+-]/g, '').replace(/^[.\s]+/, '').trim().slice(0, 180); }
  async function tok(){ return 'Bearer ' + await auth.currentUser.getIdToken(); }
  async function call(path, q, body, type){
    var r = await fetch(W + path + '?' + new URLSearchParams(q), { method:'POST', headers:{ Authorization:await tok(), 'Content-Type':type || 'application/json' }, body:body });
    var j = await r.json().catch(function(){ return {}; }); if(!r.ok) throw new Error(j.error || ('upload error ' + r.status)); return j;
  }
  function css(){
    if(document.getElementById('guCss')) return;
    var s = document.createElement('style'); s.id = 'guCss';
    s.textContent = '.gu-drop{border:2px dashed var(--line);border-radius:16px;padding:26px 14px;text-align:center;cursor:pointer;color:var(--ink-soft);font-size:14px;transition:border-color .15s,background .15s}.gu-drop.on{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 6%,transparent)}.gu-drop b{display:block;color:var(--ink);font-size:16px;margin-bottom:4px}' +
      '.gu-bar{height:10px;border-radius:99px;background:var(--line);overflow:hidden;margin:12px 0 6px}.gu-bar i{display:block;height:100%;width:0;background:var(--accent);transition:width .3s}' +
      '.gu-stat{font-size:13.5px;color:var(--ink-soft)}.gu-stat b{color:var(--ink)}.gu-list{max-height:180px;overflow:auto;font-size:12.5px;margin-top:10px;border:1px solid var(--line);border-radius:10px;padding:6px 10px}.gu-list div{display:flex;justify-content:space-between;gap:8px;padding:2px 0}.gu-list .bad{color:#b3261e}' +
      '.gu-f input{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid var(--line);border-radius:12px;font:inherit;background:var(--bg);color:var(--ink)}';
    document.head.appendChild(s);
  }
  function open(o, onFolder){
    css();
    var B = window.FOM_BIZ && FOM_BIZ.b ? FOM_BIZ.b : {}, pre = B.galleryPrefix || '';
    var folder = o.galleryFolder || (pre + (slug(o.customer) || 'client') + '/deliverables/');
    var ov = document.createElement('div'); ov.className = 'lg-ov';
    ov.innerHTML = '<div class="lg-box" role="dialog" style="max-width:560px"><h3>⬆ Upload ' + e(o.customer || 'client') + '\'s files</h3>' +
      '<p class="lg-sub">Photos and videos go straight into their gallery folder. No 100-file limit, big videos are fine, and files already there are skipped. Keep this page open while it uploads.</p>' +
      '<div class="gu-f" style="margin-bottom:12px"><label class="lg-l">Gallery folder</label><input id="guF" value="' + e(folder) + '"' + (o.galleryFolder ? ' readonly title="Change it in Gallery folder on the client"' : '') + '></div>' +
      '<div class="gu-drop" id="guDrop"><b>Drop the files or the whole folder here</b>or tap to choose files<input type="file" id="guIn" multiple accept="image/*,video/*,.zip,.pdf" style="display:none"></div>' +
      '<div style="text-align:center;margin-top:6px"><button type="button" class="op-btn" id="guDir" style="font-size:12.5px">Choose a folder instead</button><input type="file" id="guDirIn" webkitdirectory multiple style="display:none"></div>' +
      '<div id="guProg" style="display:none"><div class="gu-bar"><i id="guBar"></i></div><div class="gu-stat" id="guStat"></div><div class="gu-list" id="guList"></div></div>' +
      '<div class="lg-err" id="guErr"></div><div class="lg-acts"><button type="button" id="guClose">Close</button><button type="button" class="lg-go" id="guReady" style="display:none">Set gallery to Ready ✓</button></div></div>';
    document.body.appendChild(ov);
    var $ = function(id){ return ov.querySelector('#' + id); }, busy = false;
    $('guClose').onclick = function(){ if(busy && !confirm('Uploads are still running. Stop them?')) return; busy = false; ov.remove(); };
    $('guDrop').onclick = function(){ $('guIn').click(); };
    $('guDir').onclick = function(){ $('guDirIn').click(); };
    $('guIn').onchange = function(){ go([].slice.call(this.files)); };
    $('guDirIn').onchange = function(){ go([].slice.call(this.files)); };
    var d = $('guDrop');
    d.addEventListener('dragover', function(ev){ ev.preventDefault(); d.classList.add('on'); });
    d.addEventListener('dragleave', function(){ d.classList.remove('on'); });
    d.addEventListener('drop', async function(ev){ ev.preventDefault(); d.classList.remove('on'); go(await dropped(ev.dataTransfer)); });
    $('guReady').onclick = function(){ o.deliverablesReady = true; store.update(o.id); this.textContent = 'Ready ✓'; this.disabled = true; if(onFolder) onFolder(o); };

    async function go(files){
      if(busy) return;
      files = files.filter(function(f){ return OK.test(f.name) && f.size > 0 && !/^\./.test(f.name); });
      if(!files.length){ $('guErr').textContent = 'No photos or videos in that selection.'; return; }
      var g = $('guF').value.trim().replace(/^\/+/, ''); if(!/\/$/.test(g)) g += '/';
      if(!o.galleryFolder){ o.galleryFolder = g; store.update(o.id); if(onFolder) onFolder(o); $('guF').readOnly = true; }
      busy = true; $('guErr').textContent = ''; $('guProg').style.display = ''; $('guDrop').style.display = 'none'; $('guDir').parentNode.style.display = 'none';
      var have = {};
      try{ var l = await (await fetch(W + '/list?g=' + encodeURIComponent(g))).json(); (l.files || []).forEach(function(f){ have[f.name] = f.size; }); }catch(x){}
      var total = files.reduce(function(a, f){ return a + f.size; }, 0), sent = 0, done = 0, skipped = 0, failed = [], queue = files.slice(), live = {};
      var list = $('guList');
      function paint(){
        var now = sent + Object.keys(live).reduce(function(a, k){ return a + live[k]; }, 0);
        $('guBar').style.width = Math.min(100, Math.round(now / total * 100)) + '%';
        $('guStat').innerHTML = '<b>' + done + ' of ' + files.length + '</b> files · ' + mb(now) + ' of ' + mb(total) + (skipped ? ' · ' + skipped + ' already there' : '') + (failed.length ? ' · <span style="color:#b3261e">' + failed.length + ' failed</span>' : '');
      }
      function line(n, t, bad){ list.insertAdjacentHTML('afterbegin', '<div' + (bad ? ' class="bad"' : '') + '><span>' + e(n) + '</span><span>' + e(t) + '</span></div>'); }
      paint();
      async function one(f){
        var n = clean(f.name), q = { g:g, n:n }, type = f.type || 'application/octet-stream';
        if(have[n] === f.size){ skipped++; sent += f.size; return line(n, 'already there'); }
        if(f.size <= ONE){
          await call('/admin/gup', q, f, type);
        } else {
          var st = await call('/admin/gup-start', q, '', type), parts = [];
          try{
            for(var p = 1, off = 0; off < f.size; p++, off += PART){
              if(!busy) throw new Error('stopped');
              var r = await call('/admin/gup-part', Object.assign({ u:st.u, p:p }, q), f.slice(off, off + PART), 'application/octet-stream');
              parts.push({ p:p, etag:r.etag }); live[n] = Math.min(f.size, off + PART); paint();
            }
            await call('/admin/gup-done', Object.assign({ u:st.u }, q), JSON.stringify({ parts:parts }));
          }catch(x){ call('/admin/gup-abort', Object.assign({ u:st.u }, q), '').catch(function(){}); throw x; }
          delete live[n];
        }
        sent += f.size; line(n, mb(f.size));
      }
      async function worker(){
        while(queue.length && busy){
          var f = queue.shift();
          try{ await one(f); }catch(x){ failed.push(f); delete live[clean(f.name)]; line(clean(f.name), x.message, true); }
          done++; paint();
        }
      }
      window.addEventListener('beforeunload', warn);
      await Promise.all([worker(), worker(), worker()]);
      window.removeEventListener('beforeunload', warn);
      busy = false;
      $('guStat').innerHTML += failed.length ? '<br><button type="button" class="op-btn pri" id="guRetry" style="margin-top:8px">Try the ' + failed.length + ' failed again</button>' : '<br><b style="color:#1f8a4c">All done ✓</b>';
      if($('guRetry')) $('guRetry').onclick = function(){ var f = failed.slice(); list.innerHTML = ''; go(f); };
      if(!failed.length && !o.deliverablesReady) $('guReady').style.display = '';
    }
    function warn(ev){ if(busy){ ev.preventDefault(); ev.returnValue = ''; } }
  }
  /* folders dropped from Finder or Explorer: walk them */
  async function dropped(dt){
    var items = dt.items ? [].slice.call(dt.items) : [], out = [];
    if(!items.length || !items[0].webkitGetAsEntry) return [].slice.call(dt.files || []);
    async function walk(en){
      if(!en) return;
      if(en.isFile) await new Promise(function(res){ en.file(function(f){ out.push(f); res(); }, res); });
      else if(en.isDirectory){ var rd = en.createReader(), batch; do{ batch = await new Promise(function(res){ rd.readEntries(res, function(){ res([]); }); }); for(var i = 0; i < batch.length; i++) await walk(batch[i]); }while(batch.length); }
    }
    var entries = items.map(function(it){ return it.webkitGetAsEntry && it.webkitGetAsEntry(); });
    for(var i = 0; i < entries.length; i++) await walk(entries[i]);
    return out;
  }
  window.FOM_UPLOAD = { open:open };
})();
