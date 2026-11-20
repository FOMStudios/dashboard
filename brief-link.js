/* Client brief link (Nov 2026): a short tap-through brief the client fills in on
   fomstudios.co.za/brief.html?b=<id> (FOM or Shot by A look). Used on the Leads page:
   - FOM_BRIEF.send(o): makes the link for this lead and opens WhatsApp with it (or copies it)
   - FOM_BRIEF.load(): fetches answers from the gallery Worker and saves them on the lead (o.brief, o.briefDone)
   - FOM_BRIEF.section(o): the "Client brief" block for the lead details panel
   Needs globals from leads.html: leads, store, toast, safeRenderLeads, esc. */
(function(){
  var WORKER = 'https://fom-gallery.cold-moon-d65c.workers.dev', SITE = 'https://www.fomstudios.co.za/brief.html?b=';
  var MAP = {}, loaded = false;
  var LABELS = [['type','Shoot'],['pkg','Package'],['length','How long'],['cover','Photos or video'],['date','Date'],['time','Start time'],['area','Area or venue'],['guests','People'],['must','Must-have shots'],['use','Will use it on'],['vertical','Vertical videos'],['vibe','Look they love'],['note','Notes']];
  function e(t){ return String(t == null ? '' : t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function iso(){ return new Date().toLocaleDateString('en-CA', { timeZone:'Africa/Johannesburg' }); }
  function nice(d){ return /^\d{4}-\d\d-\d\d$/.test(d) ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-ZA', { weekday:'short', day:'numeric', month:'short', year:'numeric' }) : d; }
  function intl(p){ var d = String(p || '').replace(/\D/g, '').replace(/^0/, '27'); return d.length >= 11 ? d : ''; }
  async function token(){ var u = window.firebase && firebase.apps.length && firebase.auth().currentUser; if(!u) throw new Error('not signed in'); return u.getIdToken(); }
  function newId(){ var a = new Uint8Array(8); crypto.getRandomValues(a); return Date.now().toString(36).slice(-4) + Array.from(a, function(x){ return (x % 36).toString(36); }).join(''); }
  // a sensible starting card on the brief from what we know about the lead
  function guessType(o){
    if(o.shootType) return o.shootType;
    var c = String(o.category || '') + ' ' + String(o.company || '');
    if(/wedding/i.test(c)) return 'Wedding';
    if(/sport|padel|club|cycl|run/i.test(c)) return 'Sports';
    if(/brand|automotive|product|car|detail/i.test(c)) return 'Product / Brand';
    if(/corporate|event|cater|venue/i.test(c)) return 'Corporate / Event';
    return '';
  }
  function first(o){ return String(o.contact || '').trim().split(' ')[0] || (o.company ? o.company + ' team' : 'there'); }
  function message(o, url){
    return 'Hi ' + first(o) + '! 👋\nSo I can send you the right quote, could you tap through this quick brief? It takes about a minute 📸\n\n' + url + '\n\nOr just send me a voice note if that is easier.';
  }
  function text(o){
    var a = o.brief || {}, L = [(o.company || o.contact || 'Client') + ': shoot brief'];
    LABELS.forEach(function(k){ var v = a[k[0]]; if(v == null || v === '' || (Array.isArray(v) && !v.length)) return; L.push(k[1] + ': ' + (Array.isArray(v) ? v.join(', ') : k[0] === 'date' ? nice(v) : v)); });
    if((a.photos || []).length) L.push('Liked ' + a.photos.length + ' of our photos');
    return L.join('\n');
  }
  function status(o){
    var b = MAP[o.id];
    if(o.briefDone || (b && b.done)) return 'done';
    if(b && b.opened) return 'opened';
    if(o.briefId) return 'sent';
    return '';
  }
  function badge(o){
    var s = status(o);
    return s === 'done' ? '<span class="ot-chip" style="background:#e8f6ee;color:#1f8a4c">📝 Brief in</span>' : s === 'opened' ? '<span class="ot-chip" style="background:#fff4e5;color:#7a4b00" title="They opened it but have not sent it yet">📝 Opened, not sent</span>' : s === 'sent' ? '<span class="ot-chip">📝 Brief sent</span>' : '';
  }
  function send(o){
    if(!o) return;
    var id = o.briefId || newId(), url = SITE + id, msg = message(o, url), ph = intl(o.phone);
    if(ph) window.open('https://wa.me/' + ph + '?text=' + encodeURIComponent(msg), '_blank');   // straight from the tap so phones do not block it
    else { try{ navigator.clipboard.writeText(msg); }catch(x){} toast('No WhatsApp number: the message and link are copied, paste them anywhere.'); }
    token().then(function(t){
      return fetch(WORKER + '/admin/brief-new', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + t }, body:JSON.stringify({ ref:o.id, id:id, name:o.contact || o.company || '', type:guessType(o), biz:o.biz === 'sba' ? 'sba' : 'fom' }) });
    }).then(function(r){ return r.json(); }).then(function(j){
      if(!j.ok) throw new Error(j.error || 'not saved');
      if(j.id !== id) toast('Heads up: use this link instead: ' + SITE + j.id);
      o.briefId = j.id; if(!o.briefSent) o.comments = (o.comments ? o.comments + '\n' : '') + 'Brief link sent ' + iso(); o.briefSent = iso();
      store.update(o.id); if(typeof safeRenderLeads === 'function') safeRenderLeads();
      if(ph) toast('Brief link ready in WhatsApp. Answers land here on this lead.');
    }).catch(function(err){ toast('Could not make the link: ' + err.message + '. Check you are signed in and try again.'); });
  }
  async function load(){
    try{
      var r = await fetch(WORKER + '/admin/briefs', { headers:{ Authorization:'Bearer ' + await token() } });
      if(!r.ok) return; var j = await r.json(); MAP = {};
      (j.briefs || []).forEach(function(b){ MAP[b.ref] = b; });
      loaded = true; var changed = false;
      (typeof leads !== 'undefined' ? leads : []).forEach(function(o){
        var b = MAP[o.id]; if(!b || !b.done || !b.answers || o.briefDone === b.done) return;
        var again = !!o.briefDone;
        o.brief = b.answers; o.briefDone = b.done; o.briefId = b.id;
        if(b.answers.date && /^\d{4}-/.test(b.answers.date) && !o.shootDate) o.shootDate = b.answers.date;
        if(b.answers.type && !o.shootType) o.shootType = b.answers.type;
        o.comments = (o.comments ? o.comments + '\n' : '') + (again ? 'Brief updated ' : 'Brief received ') + iso();
        store.update(o.id); changed = true;
      });
      if(typeof safeRenderLeads === 'function') safeRenderLeads();
      if(changed && typeof drawLead === 'function' && window.OPEN_ID) drawLead(true);
    }catch(err){ console.warn('briefs', err); }
  }
  function section(o){
    var s = status(o), a = o.brief || {}, rows = '';
    if(s === 'done'){
      LABELS.forEach(function(k){ var v = a[k[0]]; if(v == null || v === '' || (Array.isArray(v) && !v.length)) return;
        rows += '<div class="op-f' + (k[0] === 'note' || k[0] === 'must' ? ' w' : '') + '"><label>' + k[1] + '</label><div>' + e(Array.isArray(v) ? v.join(', ') : k[0] === 'date' ? nice(v) : v) + '</div></div>'; });
      var ph = (a.photos || []).map(function(u){ return '<a href="' + e(u) + '" target="_blank" rel="noopener"><img src="' + e(u) + '" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px"></a>'; }).join('');
      return '<div class="op-sec"><h3>📝 Client brief <small style="font-weight:600;color:var(--ink-soft)">sent back ' + e(new Date(o.briefDone).toLocaleDateString('en-ZA', { day:'numeric', month:'short' })) + '</small></h3><div class="op-g">' + rows + '</div>' +
        (ph ? '<div style="margin-top:8px"><label style="font-size:12px;font-weight:700;color:var(--ink-soft)">Our photos they liked</label><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">' + ph + '</div></div>' : '') +
        '<div class="op-acts"><button class="op-btn pri" type="button" data-lact="briefcopy">Copy brief</button><a class="op-btn" href="calculator.html" target="_blank" rel="noopener">🧮 Make the quote</a><button class="op-btn" type="button" data-lact="brief">Send the link again</button></div></div>';
    }
    return '<div class="op-sec"><h3>📝 Client brief</h3><div class="ot-sub" style="font-size:13.5px;color:var(--ink-soft);margin-bottom:8px">' +
      (s === 'opened' ? 'They opened the link on ' + e(new Date(MAP[o.id].opened).toLocaleDateString('en-ZA', { day:'numeric', month:'short' })) + ' but have not sent it yet. A gentle nudge usually does it.' : s === 'sent' ? 'Link sent ' + e(o.briefSent || '') + '. Their answers show up here, and your phone buzzes.' : 'A one-minute tap-through (shoot, package, date, must-haves, the look they like) so you can quote properly. No contact details needed.') +
      '</div><div class="op-acts" style="margin-top:0"><button class="op-btn pri" type="button" data-lact="brief">📝 ' + (s ? 'Send the link again' : 'Send brief link') + '</button></div></div>';
  }
  window.FOM_BRIEF = { send:send, load:load, section:section, badge:badge, status:status, text:text, url:function(o){ return o.briefId ? SITE + o.briefId : ''; } };
  document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'visible' && loaded) load(); });
  setInterval(function(){ if(document.visibilityState === 'visible' && loaded) load(); }, 180000);
})();
