/* FOM Studios - Google Search Console in the dashboard (24 Nov 2026)
   Data comes through the gallery Worker (/admin/gsc), read with the FIREBASE_SA service account.
   FOM_GSC.load(biz, days)            -> the Worker answer (cached 10 minutes per biz and range)
   FOM_GSC.setup(el, ans)             -> the step-by-step setup box when it is not connected yet
   FOM_GSC.card(el, biz, days)        -> the full card for the Website traffic page
   Shot by A = pages under /shotbya/ of the same Search Console property. Google's numbers are 2 to 3 days behind. */
(function(){
  var W = 'https://fom-gallery.cold-moon-d65c.workers.dev', CACHE = {};
  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  async function tok(){ return 'Bearer ' + await firebase.auth().currentUser.getIdToken(); }
  async function load(biz, days, fresh){
    var k = biz + ':' + days;
    if(!fresh && CACHE[k] && Date.now() - CACHE[k].t < 600000) return CACHE[k].v;
    var r = await fetch(W + '/admin/gsc?' + new URLSearchParams({ biz:biz, days:days }), { headers:{ Authorization:await tok() } });
    var j = await r.json(); if(!r.ok) throw new Error(j.error || r.status);
    CACHE[k] = { t:Date.now(), v:j }; return j;
  }
  async function verifyFile(file){
    var r = await fetch(W + '/admin/gsc-verify', { method:'POST', headers:{ Authorization:await tok(), 'Content-Type':'application/json' }, body:JSON.stringify({ file:file }) });
    var j = await r.json(); if(!r.ok) throw new Error(j.error || r.status); return j;
  }
  function setup(el, a){
    var email = a.email || '(your FIREBASE_SA service account email)', pid = a.project || '';
        var api = 'https://console.cloud.google.com/apis/library/searchconsole.googleapis.com' + (pid ? '?project=' + encodeURIComponent(pid) : '');
    el.innerHTML = '<div class="gsc-setup"><b>Connect Google Search Console</b>' +
      '<p>Free from Google. It shows the exact searches that bring people to your site, how often you appear and your position. 3 quick steps, once, for both businesses.</p><ol>' +
      '<li' + (a.why === 'api' ? ' class="done"' : '') + '>Open <a href="https://search.google.com/search-console/users" target="_blank" rel="noopener">Search Console</a> and pick <b>fomstudios.co.za</b> at the top left. Open <b>Settings</b> (bottom of the menu), <b>Users and permissions</b>, <b>Add user</b>. Paste <code id="gscEm">' + esc(email) + '</code> <button type="button" class="gsc-btn sm" id="gscCp">Copy</button>, permission <b>Restricted</b>, then <b>Add</b>. This only lets your dashboard read the numbers.</li>' +
      '<li>Switch on the API: open <a href="' + esc(api) + '" target="_blank" rel="noopener">Google Search Console API</a> (sign in with the Google account that owns your Firebase project if it asks) and tap <b>Enable</b>.</li>' +
      '<li>Back in Search Console open <b>Sitemaps</b>, type <code>https://www.fomstudios.co.za/sitemap.xml</code> and tap <b>Submit</b>. Google then finds every page and blog post, including Shot by A.</li></ol>' +
      '<details><summary>No fomstudios.co.za in Search Console yet?</summary><ol><li>Tap <b>Add property</b>, choose <b>URL prefix</b>, type <code>https://www.fomstudios.co.za/</code>.</li><li>Choose <b>HTML file</b>. Paste the file name Google shows (like <code>google1a2b3c4d.html</code>) here, tap the button, wait a minute, then <b>Verify</b>.<div class="gsc-row"><input id="gscFile" placeholder="google1a2b3c4d.html"><button type="button" class="gsc-btn" id="gscPut">Put it on my website</button></div><small id="gscPutMsg"></small></li></ol></details>' +
      '<p class="gsc-note">Then refresh this page.' + (a.why === 'api' ? ' Step 1 is done: Google sees the access, only the API switch is left.' : '') + (a.msg ? ' Google says: ' + esc(a.msg) : '') + (a.sites && a.sites.length ? ' The key can see: ' + esc(a.sites.join(', ')) + '.' : '') + '</p></div>';
    el.querySelector('#gscCp').onclick = function(){ try{ navigator.clipboard.writeText(email); this.textContent = 'Copied'; }catch(e){ prompt('Copy this:', email); } };
    el.querySelector('#gscPut').onclick = async function(){
      var b = this, f = el.querySelector('#gscFile').value.trim(), m = el.querySelector('#gscPutMsg');
      if(!f) return el.querySelector('#gscFile').focus();
      b.disabled = true; b.textContent = 'Adding…';
      try{ var j = await verifyFile(f); m.innerHTML = '✅ Added. In about a minute <a href="' + esc(j.url) + '" target="_blank" rel="noopener">this link</a> opens; then tap Verify on Google.'; b.textContent = 'Done'; }
      catch(e){ m.textContent = '⚠️ ' + e.message; b.disabled = false; b.textContent = 'Try again'; }
    };
  }
  function n(x){ return Number(x || 0).toLocaleString('en-ZA'); }
  function spark(days){
    if(!days || days.length < 2) return '';
    var mx = Math.max.apply(null, days.map(function(d){ return d.impressions; })) || 1, w = 100 / days.length;
    return '<svg class="gsc-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">' + days.map(function(d, i){ var h = d.impressions / mx * 28, c = d.clicks ? Math.max(1.5, d.clicks / mx * 28) : 0; return '<rect x="' + (i * w + w * .1) + '" y="' + (30 - h) + '" width="' + (w * .8) + '" height="' + h + '" class="i"/>' + (c ? '<rect x="' + (i * w + w * .1) + '" y="' + (30 - c) + '" width="' + (w * .8) + '" height="' + c + '" class="c"/>' : ''); }).join('') + '</svg>';
  }
  function table(rows, first, label){
    if(!rows || !rows.length) return '<p class="gsc-note">Nothing yet.</p>';
    return '<div class="gsc-tw"><table class="gsc-t"><thead><tr><th>' + label + '</th><th class="n">Clicks</th><th class="n">Seen</th><th class="n">Click rate</th><th class="n">Position</th></tr></thead><tbody>' +
      rows.map(function(r){ return '<tr><td>' + esc(r[first]) + '</td><td class="n">' + n(r.clicks) + '</td><td class="n">' + n(r.impressions) + '</td><td class="n">' + r.ctr + '%</td><td class="n">' + r.position + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  async function card(el, biz, days){
    el.innerHTML = '<p class="gsc-note">Loading Google numbers…</p>';
    try{
      var a = await load(biz, days);
      if(!a.connected) return setup(el, a);
      var t = a.totals;
      el.innerHTML = '<div class="gsc-kpi"><div><b>' + n(t.clicks) + '</b><span>clicks from Google</span></div><div><b>' + n(t.impressions) + '</b><span>times you were seen</span></div><div><b>' + t.ctr + '%</b><span>click rate</span></div><div><b>' + (t.position || '-') + '</b><span>average position</span></div></div>' + spark(a.days) +
        '<p class="gsc-note">' + esc(a.from) + ' to ' + esc(a.to) + '. Position 1 is the top of Google; 1 to 10 is page one. Grey bars: seen, blue: clicked.</p>' +
        '<h3 class="gsc-h">What people searched</h3>' + table(a.queries.slice(0, 25), 'q', 'Search') +
        (a.chances && a.chances.length ? '<h3 class="gsc-h">Almost there</h3><p class="gsc-note">You show up for these but too low to get clicks. A blog post or a line on the right page aimed at them can move you up.</p>' + table(a.chances, 'q', 'Search') + '<p><a class="gsc-btn" href="blog.html">Write a post on the Blog page</a></p>' : '') +
        '<h3 class="gsc-h">Pages Google sends people to</h3>' + table(a.pages.slice(0, 15), 'page', 'Page');
    }catch(e){ el.innerHTML = '<p class="gsc-note">Google numbers could not load (' + esc(e.message) + ').</p>'; }
  }
  var css = document.createElement('style');
  css.textContent = '.gsc-setup{background:#eef4ff;color:#1c2b45;border-radius:16px;padding:14px 16px;font-size:14px;line-height:1.55}html[data-theme=dark] .gsc-setup{background:#1b2638;color:#d9e4f7}.gsc-setup>b{display:block;font-size:15.5px;margin-bottom:4px}.gsc-setup ol{margin:8px 0 0 20px;display:flex;flex-direction:column;gap:8px}.gsc-setup li.done{opacity:.6;text-decoration:line-through}.gsc-setup details{margin-top:10px}.gsc-setup summary{cursor:pointer;font-weight:700}.gsc-setup code{background:rgba(0,0,0,.07);padding:1px 6px;border-radius:6px;font-size:12.5px;word-break:break-all}.gsc-setup a{color:inherit;text-decoration:underline}.gsc-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.gsc-row input{flex:1;min-width:200px;border:1px solid var(--line);border-radius:10px;padding:8px 10px;font:14px inherit;font-family:inherit;background:var(--bg-pill);color:var(--ink)}.gsc-btn{display:inline-flex;align-items:center;border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:99px;padding:8px 14px;font:700 13px inherit;font-family:inherit;cursor:pointer;text-decoration:none!important;color:#fff!important}.gsc-btn.sm{padding:3px 10px;font-size:12px}.gsc-btn[disabled]{opacity:.5}.gsc-note{font-size:13px;color:var(--ink-soft);margin:6px 0}.gsc-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:10px}.gsc-kpi div{background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:12px 14px}.gsc-kpi b{display:block;font-size:24px;font-weight:800;line-height:1.1}.gsc-kpi span{font-size:12.5px;color:var(--ink-soft)}.gsc-spark{width:100%;height:60px;display:block}.gsc-spark .i{fill:var(--line)}.gsc-spark .c{fill:var(--accent)}.gsc-h{font-size:15px;font-weight:800;margin:16px 0 6px}.gsc-tw{overflow-x:auto}.gsc-t{width:100%;border-collapse:collapse;font-size:13.5px}.gsc-t th{text-align:left;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft);padding:6px 8px;border-bottom:1px solid var(--line)}.gsc-t td{padding:8px;border-bottom:1px solid var(--line);word-break:break-word}.gsc-t .n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}';
  document.head.appendChild(css);
  window.FOM_GSC = { load:load, setup:setup, card:card };
})();
