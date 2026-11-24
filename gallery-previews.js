/* FOM Studios - fast previews for client and group galleries (24 Nov 2026)
   Client photos are 15 to 40 MB, which made the gallery grid slow. For every photo the dashboard makes two
   small copies in the browser and stores them next to it in R2 (never listed as client files):
     <folder>_fom/th/<name>.jpg   640 px, for the grid
     <folder>_fom/web/<name>.jpg  2048 px, for the full-screen viewer
   Downloads still give the original. Made automatically after "Upload files", and for older galleries with
   "Make fast previews" on the client in the Database (the photos come down once, so leave the tab open).
   FOM_PREV.fromFile(file, folder, name)   FOM_PREV.mount(element, folder)   FOM_PREV.fill(folder, onProgress) */
(function(){
  var W = 'https://fom-gallery.cold-moon-d65c.workers.dev';
  var IMG = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
  async function tok(){ return 'Bearer ' + await firebase.auth().currentUser.getIdToken(); }
  function toBlob(c, q){ return new Promise(function(res){ c.toBlob(res, 'image/jpeg', q); }); }
  async function shrink(bmp, max, q){
    var s = Math.min(1, max / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
    var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, c.width, c.height);
    var b = await toBlob(c, q); c.width = c.height = 0; return b;
  }
  async function put(g, n, sz, blob){
    var r = await fetch(W + '/admin/gup-prev?' + new URLSearchParams({ g:g, n:n, s:sz }), { method:'POST', headers:{ Authorization:await tok(), 'Content-Type':'image/jpeg' }, body:blob });
    if(!r.ok) throw new Error('preview upload ' + r.status);
  }
  async function fromFile(file, g, n){
    if(!IMG.test(n || file.name)) return false;
    var bmp = await createImageBitmap(file, { imageOrientation:'from-image' });
    try{
      var web = await shrink(bmp, 2048, 0.82); await put(g, n, 'web', web);
      var th = await shrink(bmp, 640, 0.78); await put(g, n, 'th', th);
    } finally { if(bmp.close) bmp.close(); }
    return true;
  }
  async function list(g){
    var r = await fetch(W + '/list?g=' + encodeURIComponent(g), { cache:'no-store' }); var j = await r.json();
    var imgs = (j.files || []).filter(function(f){ return f.kind === 'image' && IMG.test(f.name); });
    return { all:imgs, todo:imgs.filter(function(f){ return !f.th || !f.web; }) };
  }
  var RUN = {};   // folder -> running job
  async function fill(g, onProg){
    if(RUN[g]) return RUN[g];
    RUN[g] = (async function(){
      var l = await list(g), todo = l.todo.slice(), done = 0, bad = 0, total = todo.length;
      async function worker(){
        while(todo.length){
          var f = todo.shift();
          try{ var b = await (await fetch(f.url)).blob(); await fromFile(b, g, f.name); }
          catch(e){ bad++; console.warn('preview', f.name, e); }
          done++; if(onProg) onProg(done, total, bad);
        }
      }
      await Promise.all([worker(), worker()]);
      return { total:total, bad:bad };
    })();
    try{ return await RUN[g]; } finally { delete RUN[g]; }
  }
  /* the line on the client in the Database: "Fast previews: 120 of 133 ready" + Make the rest.
     The panel redraws often, so progress lives here (PROG) and is painted into whichever line is on screen. */
  var PROG = {}, CACHE = {};
  function paint(g){
    var el = document.querySelector('.pv-line[data-pvf="' + CSS.escape(g) + '"]'); if(!el) return;
    var p = PROG[g], c = CACHE[g] && CACHE[g].l;
    if(p && !p.end){ el.className = 'pv-line'; el.innerHTML = '<span>⚡ Making fast previews: <b>' + p.d + ' of ' + p.t + '</b>. Keep this tab open.</span>'; return; }
    if(!c || !c.all.length){ el.innerHTML = ''; return; }
    var ready = c.all.length - c.todo.length;
    if(!c.todo.length){ el.className = 'pv-line ok'; el.innerHTML = '<span>⚡ Fast previews ready for all ' + c.all.length + ' photos' + (p && p.bad ? ' (' + p.bad + ' could not be read, e.g. HEIC, those load full size)' : '') + '</span>'; return; }
    el.className = 'pv-line';
    el.innerHTML = '<span>⚡ Fast previews: <b>' + ready + ' of ' + c.all.length + '</b> ready. Without them the gallery loads full-size photos and feels slow.</span> <button type="button" class="op-btn pri">Make the rest (' + c.todo.length + ')</button>';
    el.querySelector('button').onclick = function(){ run(g); };
  }
  async function run(g){
    var warn = function(e){ e.preventDefault(); e.returnValue = ''; }; addEventListener('beforeunload', warn);
    PROG[g] = { d:0, t:(CACHE[g] && CACHE[g].l.todo.length) || 0 }; paint(g);
    try{ var res = await fill(g, function(d, t, bad){ PROG[g] = { d:d, t:t, bad:bad }; paint(g); }); PROG[g] = { end:true, bad:res.bad }; }
    catch(e){ PROG[g] = { end:true }; }
    finally { removeEventListener('beforeunload', warn); delete CACHE[g]; await refresh(g); }
  }
  async function refresh(g){ try{ CACHE[g] = { t:Date.now(), l:await list(g) }; }catch(e){} paint(g); }
  async function mount(el, g){
    if(!el || !g) return; el.setAttribute('data-pvf', g);
    if(CACHE[g] && Date.now() - CACHE[g].t < 60000) return paint(g);
    paint(g); await refresh(g);
  }
  window.FOM_PREV = { fromFile:fromFile, fill:fill, mount:mount, list:list, run:run };
})();
