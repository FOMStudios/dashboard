/* FOM Studios health checks and next steps.
   Pure functions, no page code. Used by advisor.html and the Dashboard cards.
   FOM_HEALTH.run(data)  -> list of findings, most serious first
   FOM_HEALTH.nextFor(o) -> progress and next steps for one order            */
(function(){
  var DAY = 86400000;
  var STEPS = [
    { key:'s1',  who:'client', title:'Client enquiry received' },
    { key:'s4',  who:'me', title:'Create the order on the Database', link:'database.html', label:'Database' },
    { key:'s5',  who:'me', title:'Upload contract and invoice to Cloudflare R2, paste the links', link:'database.html', label:'Database' },
    { key:'s2',  who:'me', title:'Send invoice, contract and signing link', link:'database.html', label:'Copy sign link' },
    { key:'s14', who:'client', title:'Client signs the contract online', auto:function(o){ return !!o.contractSigned; } },
    { key:'s3',  who:'client', title:'Client pays the deposit' },
    { key:'s6',  who:'me', title:'Create their Firebase account', link:'https://console.firebase.google.com/', label:'Firebase' },
    { key:'s7',  who:'me', title:'Send the password reset email', link:'https://console.firebase.google.com/', label:'Firebase' },
    { key:'s8',  who:'me', title:'Send the confirmation email', link:'email.html', label:'Email' },
    { key:'s9',  who:'client', title:'Client logs into the portal' },
    { key:'s10', who:'me', title:'Shoot day completed', link:'database.html', label:'Database' },
    { key:'s11', who:'me', title:'Upload edits to R2 and set the gallery folder', link:'database.html', label:'Database' },
    { key:'s12', who:'me', title:'Send the Files Ready email', link:'email.html', label:'Email' },
    { key:'s13', who:'client', title:'Client downloads their files' }
  ];
  function done(s, o){ var wf = o.workflow || {}; return !!wf[s.key] || (typeof s.auto === 'function' && !!s.auto(o)); }
  function nextFor(o){
    var left = STEPS.filter(function(s){ return !done(s, o); });
    return { total:STEPS.length, done:STEPS.length - left.length, next:left.slice(0,3), complete:left.length === 0 };
  }

  function dt(v){ if(!v) return null; var s = String(v).slice(0,10); var d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(v); return isNaN(d) ? null : d; }
  function money(n){ return 'R' + Math.round(+n || 0).toLocaleString('en-ZA'); }
  function plural(n, w){ return n + ' ' + w + (n === 1 ? '' : 's'); }
  var KNOWN_TOK = ['biz','depositPct','balancePct','cancelDays','cancelFee','overtime','rush','editRate','revisions','n'];
  var RANK = { bad:0, warn:1, info:2 };

  function run(d){
    d = d || {};
    var out = [], today = d.today ? new Date(d.today) : new Date(); today.setHours(0,0,0,0);
    function add(area, level, title, detail, link, label, order){ out.push({ area:area, level:level, title:title, detail:detail || '', link:link || '', label:label || '', order:order || '' }); }
    var orders = Array.isArray(d.orders) ? d.orders : [];

    /* ---------- orders ---------- */
    var seen = {};
    orders.forEach(function(o){
      var who = (o.orderId ? o.orderId + ' ' : '') + (o.customer || 'Unnamed order');
      var status = o.status || '';
      var active = ['Completed','Delivered','Cancelled'].indexOf(status) < 0;
      var total = +o.total || 0, paid = +o.paid || 0, owing = total - paid;
      var shoot = dt(o.shootDate), days = shoot ? Math.round((shoot - today) / DAY) : null;
      var L = 'database.html';
      if(o.orderId){ if(seen[o.orderId]) add('Orders', 'bad', 'Duplicate order number ' + o.orderId, 'Two orders share this number, which will confuse invoices and the portal.', L, 'Database', who); seen[o.orderId] = 1; }
      if(total > 0 && paid > total) add('Orders', 'bad', who + ': paid is more than the total', 'Paid ' + money(paid) + ' against a total of ' + money(total) + '. Check the amounts.', L, 'Database', who);
      if(status === 'Cancelled') return;
      if(active && !o.clientEmail) add('Orders', 'warn', who + ': no client email', 'The portal login, confirmation and gallery emails all need it.', L, 'Database', who);
      if(active && days != null && days >= 0 && days <= 14 && !o.contractSigned)
        add('Orders', days <= 7 ? 'bad' : 'warn', who + ': contract not signed, shoot ' + (days === 0 ? 'is today' : 'in ' + plural(days, 'day')), o.contractUrl ? 'Send a reminder with their signing link.' : 'No contract has been attached yet.', L, 'Database', who);
      if(active && days != null && days >= 0 && days <= 7 && paid <= 0 && total > 0)
        add('Orders', 'bad', who + ': no deposit received, shoot ' + (days === 0 ? 'is today' : 'in ' + plural(days, 'day')), 'Total ' + money(total) + '. Nothing paid yet.', L, 'Database', who);
      else if(active && days != null && days >= 0 && days <= 3 && owing > 0)
        add('Orders', 'warn', who + ': ' + money(owing) + ' still owing before the shoot', 'Shoot ' + (days === 0 ? 'is today' : 'in ' + plural(days, 'day')) + '.', L, 'Database', who);
      if(shoot && days < 0 && owing > 0) add('Orders', 'warn', who + ': shoot done, ' + money(owing) + ' still owing', 'Shot ' + plural(-days, 'day') + ' ago. Send a payment reminder.', L, 'Database', who);
      if(shoot && days <= -2 && status === 'Pending') add('Orders', 'warn', who + ': status is still Pending', 'The shoot was ' + plural(-days, 'day') + ' ago. Update the status so the dashboard stays accurate.', L, 'Database', who);
      if(shoot && days <= -14 && !o.galleryFolder && !o.deliverablesReady && active) add('Orders', 'warn', who + ': no gallery yet, ' + plural(-days, 'day') + ' after the shoot', 'Upload the edits and set the Gallery folder.', L, 'Database', who);
      if(o.deliverablesReady && !o.galleryFolder) add('Orders', 'warn', who + ': marked ready but no gallery folder', 'The client portal has nothing to open. Set the Gallery folder on the Database.', L, 'Database', who);
      var ex = dt(o.galleryExpiry);
      if(o.galleryFolder && ex){
        var left = Math.round((ex - today) / DAY);
        if(left >= 0 && left <= 7) add('Orders', 'warn', who + ': gallery expires ' + (left === 0 ? 'today' : 'in ' + plural(left, 'day')), 'Send the "Gallery Expiring" email so they download in time.', 'email.html', 'Email', who);
      }
    });

    /* ---------- contract ---------- */
    var c = d.contract;
    if(!c){ add('Contract', 'info', 'Contract wording has not been saved yet', 'The built in wording is in use. Open the Contract page, Edit contract, and save once to keep a version history.', 'contract.html', 'Contract'); }
    else {
      var b = c.biz || {}, t = c.terms || {};
      [['bank','bank name'],['holder','account holder'],['branch','branch code'],['acc','account number']].forEach(function(p){ if(!String(b[p[0]] || '').trim()) add('Contract', 'bad', 'Business details: ' + p[1] + ' is empty', 'It prints on the contract and invoice.', 'contract.html', 'Contract'); });
      [['name','business name'],['email','email'],['phone','phone']].forEach(function(p){ if(!String(b[p[0]] || '').trim()) add('Contract', 'warn', 'Business details: ' + p[1] + ' is empty', '', 'contract.html', 'Contract'); });
      if(typeof t.depositPct === 'number' && (t.depositPct < 10 || t.depositPct > 90)) add('Contract', 'warn', 'Deposit is set to ' + t.depositPct + '%', 'That is unusual. Check the Terms tab in Edit contract.', 'contract.html', 'Contract');
      var ids = (c.clauses || []).map(function(x){ return x.id; }), badTok = [];
      (c.clauses || []).forEach(function(cl){
        if(cl.on === false) return;
        String(cl.body || '').replace(/\{(\w+)(?::(\w+))?\}/g, function(m, k, a){ if(KNOWN_TOK.indexOf(k) < 0 || (k === 'n' && ids.indexOf(a) < 0)) badTok.push(m + ' in "' + cl.title + '"'); return m; });
      });
      if(badTok.length) add('Contract', 'bad', 'Unknown placeholder in the contract: ' + badTok[0], badTok.length > 1 ? 'Plus ' + (badTok.length - 1) + ' more. Clients would see the raw text.' : 'Clients would see the raw text. Fix it in Edit contract.', 'contract.html', 'Contract');
      var on = (c.clauses || []).filter(function(x){ return x.on !== false; }).length;
      if(c.clauses && on < 5) add('Contract', 'warn', 'Only ' + on + ' clauses are switched on', 'Check you have not hidden something important like cancellation or usage rights.', 'contract.html', 'Contract');
    }

    /* ---------- invoice ---------- */
    var k = d.calc;
    if(k && k.invoice && k.invoice.bank && k.invoice.bank.length){
      var rows = k.invoice.bank, acc = c && c.biz && String(c.biz.acc || '').trim();
      var half = rows.filter(function(r){ return (r.k && !r.v) || (!r.k && r.v); });
      if(half.length) add('Invoice', 'warn', 'An invoice banking row is half empty', 'Fill in both the label and the value, or remove the row.', 'calculator.html', 'Calculator, Data, Invoice');
      if(acc && !rows.some(function(r){ return String(r.v || '').replace(/\s/g,'') === acc.replace(/\s/g,''); }))
        add('Invoice', 'warn', 'Invoice account number differs from the contract', 'Your own invoice rows do not contain the account number from the contract Business details. Fine if intentional.', 'calculator.html', 'Calculator, Data, Invoice');
    }

    /* ---------- calculator packages ---------- */
    if(!k){ add('Calculator', 'info', 'Calculator data has not been saved yet', 'Open Data on the calculator and press Save once so the advisor can keep watch on your packages.', 'calculator.html', 'Calculator'); }
    else if(k.advSummary && k.advSummary.items){
      k.advSummary.items.forEach(function(i){ add('Packages', i.l === 'bad' ? 'bad' : 'warn', i.n + ': ' + (i.t || 'check the pricing'), 'From the package advisor when you last saved.', 'calculator.html', 'Calculator, Data, Advisor'); });
    }

    /* ---------- website ---------- */
    var s = d.site;
    if(!s){ add('Website', 'info', 'Website details have not been saved yet', 'The site is showing the details built into its files. Open the Website page and save once.', 'website.html', 'Website'); }
    else {
      if(!String(s.phone || '').trim()) add('Website', 'warn', 'No phone number on the website page', '', 'website.html', 'Website');
      if(!String(s.email || '').trim()) add('Website', 'warn', 'No email on the website page', '', 'website.html', 'Website');
      if(!String(s.whatsapp || '').trim()) add('Website', 'warn', 'No WhatsApp number on the website page', 'Clients use it to book.', 'website.html', 'Website');
      var bn = s.banner || {};
      if(bn.on && !String(bn.text || '').trim()) add('Website', 'warn', 'Banner is switched on but has no text', '', 'website.html', 'Website');
      var bd = Array.isArray(s.blockedDates) ? s.blockedDates : [], old = 0;
      bd.forEach(function(r){ var to = dt(r.to || r.from); if(to && to < today) old++; });
      if(old) add('Website', 'info', plural(old, 'old blocked date range') + ' can be cleared', 'They are in the past. Use Clear past on the Website page.', 'website.html', 'Website');
      orders.forEach(function(o){
        if(['Completed','Delivered','Cancelled'].indexOf(o.status || '') >= 0) return;
        var sh = dt(o.shootDate); if(!sh || sh < today) return;
        bd.forEach(function(r){ var f = dt(r.from), to = dt(r.to || r.from); if(f && to && sh >= f && sh <= to) add('Website', 'warn', (o.customer || 'An order') + ' is booked on a blocked date', (r.label ? '"' + r.label + '" is blocked. ' : '') + 'Check the shoot date or the block.', 'website.html', 'Website', o.orderId); });
      });
    }

    /* ---------- connection ---------- */
    (d.errors || []).forEach(function(e){ add('Connection', 'bad', 'Could not read ' + e, 'Publish the latest Firestore rules (deploy checklist) and refresh.', '', ''); });

    out.sort(function(a, b){ return (RANK[a.level] - RANK[b.level]); });
    return out;
  }


  /* ---- payment reminders and shoot-day checklist ---- */
  var SHOOT_ITEMS = [
    ['batteries','Camera and drone batteries charged'], ['cards','Memory cards formatted and packed'], ['lenses','Lenses and sensors cleaned'],
    ['drone','Drone checked and flight area confirmed'], ['shotlist','Shot list and locations confirmed'], ['client','Client messaged with time and place'],
    ['travel','Fuel and route sorted'], ['backup','Backup drive and laptop packed']
  ];
  function owingList(orders, today){
    today = today ? new Date(today) : new Date(); today.setHours(0,0,0,0);
    var out = [];
    (orders || []).forEach(function(o){
      if(o.status === 'Cancelled') return;
      var owe = (+o.total || 0) - (+o.paid || 0); if(owe <= 0) return;
      var sh = dt(o.shootDate); if(!sh) return;
      var days = Math.round((sh - today) / DAY);
      if(days < 0) out.push({ o:o, owing:owe, days:days, kind:'overdue' });
      else if(days <= 7) out.push({ o:o, owing:owe, days:days, kind:'soon' });
    });
    out.sort(function(a, b){ return a.days - b.days; });
    return out;
  }
  function reminderText(o, owing, kind, biz){
    biz = biz || {};
    var first = String(o.customer || '').trim().split(/\s+/)[0] || 'there';
    var ref = o.orderId ? ' Please use ' + o.orderId + ' as the payment reference.' : '';
    var what = o.product ? ' for your ' + o.product + ' booking' : '';
    var lead = kind === 'overdue' ? 'Hi ' + first + ', I hope you are well. A friendly reminder that ' + money(owing) + ' is still outstanding' + what + '.'
                                  : 'Hi ' + first + ', looking forward to your shoot. A friendly reminder that ' + money(owing) + ' is due before the shoot date' + what + '.';
    var bank = (biz.bank && biz.acc) ? ' EFT details: ' + biz.bank + ', account holder ' + (biz.holder || '') + ', branch code ' + (biz.branch || '') + ', account number ' + biz.acc + '.' : '';
    return lead + bank + ref + ' Thank you! FOM Studios';
  }

  function checklist(lines){
    var def = {}; SHOOT_ITEMS.forEach(function(i){ def[i[1]] = i[0]; });
    var a = (Array.isArray(lines) && lines.length ? lines : SHOOT_ITEMS.map(function(i){ return i[1]; })).map(function(s){ return String(s).trim(); }).filter(Boolean).slice(0,30), seen = {};
    return a.map(function(t){ t = t.slice(0,80); var k = def[t] || (t.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40) || 'x'); while(seen[k]) k += 'x'; seen[k] = 1; return [k, t]; });
  }
  window.FOM_HEALTH = { checklist:checklist, SHOOT_ITEMS:SHOOT_ITEMS, owingList:owingList, reminderText:reminderText, run:run, nextFor:nextFor, STEPS:STEPS, parseDate:dt, money:money };
})();
