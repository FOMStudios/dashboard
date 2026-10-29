/* ============================================================
   FOM STUDIOS - shared outreach brain (used by leads.html and content.html)
   ------------------------------------------------------------
   - Lead categories with a rule-based advisor playbook (editable on the Leads page)
   - Email templates with {placeholders} (editable on the Leads page)
   - South African seasonal calendar for the Content Planner advisor
   Saved to Firestore settings/outreach as {json, updatedAt}, cached in localStorage.
   ============================================================ */
(function(){
  'use strict';
  var KEY = 'fom.outreach.v1';

  /* ---------- default categories (the advisor playbook) ---------- */
  var DEF_CATS = [
    { id:'sportsbrand', name:'Sports Brand',
      keywords:'red bull, monster, nike, adidas, puma, under armour, gatorade, powerade, asics, new balance, oakley, gopro, energy drink, sportswear, supplements',
      photoCats:['sports'], template:'brand',
      angle:"For {company|your brand}, I'd focus on high-energy action content that matches your athletes and events, delivered fast in vertical cuts ready for social.",
      tips:'Lead with action and motion shots, brands decide in seconds\nKeep it short: big brands get hundreds of pitches a week\nMention athletes you have shot, like a professional padel player\nOffer reels and vertical edits, not just stills\nName one of their real events or athletes so it is clearly not a mass email\nAsk for a small paid test shoot instead of a big contract',
      content:'Athlete hero reel with slow motion and speed ramps\nBehind the scenes of an action shoot (how you get the shot)\nBefore and after colour grade carousel\nPOV reel from the sideline with the camera in frame' },
    { id:'sportsclub', name:'Sports Club / Event',
      keywords:'club, fc, united, rugby, cricket, padel, tennis, league, marathon, tournament, championship, cup, academy, falcons, athletics, swimming, basketball, hockey, netball',
      photoCats:['sports'], template:'accreditation',
      angle:"For {company|your club}, I'd cover match day action, player portraits and a fast highlight reel your fans can share the same day.",
      tips:'Ask about media accreditation or the media mailing list\nShow match day action plus portraits, clubs need both\nPromise same-day or next-day highlights for their socials\nMention clubs you already work with, like Hyde Park Falcons\nOffer a season package for regular fixtures',
      content:'Match day highlight reel within 24 hours\nPlayer portrait series for the team socials\nGame day dump carousel (10 best frames)\nWalkout and warm-up BTS story set' },
    { id:'catering', name:'Catering / Events',
      keywords:'catering, caterers, events, functions, venue, bubbles, party, decor, planner, planners, hire, banqueting, chef, kitchen, bakery, cakes, conference',
      photoCats:['other','sports'], template:'general',
      angle:"For {company|your events}, I'd capture your setups, food details and real guest moments so every event becomes ready-made marketing content.",
      tips:'Talk about detail shots: food, decor, table setups\nOffer a quick turnaround so they can post while the event is fresh\nMention event clients like Party Bubbles Events\nPropose a styled shoot of one setup for their website\nAsk which events they have coming up this season (year-end functions!)',
      content:'Setup timelapse from empty venue to full event\nFood and detail close-up carousel\nGuest reaction reel set to trending audio\nVendor spotlight collab post' },
    { id:'automotive', name:'Automotive',
      keywords:'motors, motor, auto, autos, cars, car, dealership, bmw, porsche, mercedes, benz, audi, toyota, vw, volkswagen, ford, detailing, wrap, wraps, tuning, garage, car meet, racing, motorsport, bikes, ducati',
      photoCats:['automotive'], template:'general',
      angle:"For {company|your brand}, I'd shoot cinematic rollers, detail close-ups and a short reel that makes every car look worth the drive.",
      tips:'Lead with rollers and detail shots, they sell cars\nOffer stock photos for listings plus a short reel\nMention car meets and builds you have covered (Porsche, BMW, RX7)\nSuggest a golden hour shoot for their hero stock\nDealers love monthly content packages',
      content:'Golden hour roller shoot reel\nDetail series: badges, wheels, interiors\nCar meet recap reel\nBuild progress before and after' },
    { id:'corporate', name:'Corporate',
      keywords:'pty, ltd, group, holdings, consulting, bank, insurance, law, attorneys, agency, solutions, engineering, technologies, properties, investments, accounting',
      photoCats:['other'], template:'general',
      angle:"For {company|your team}, I'd create clean headshots, team culture content and event coverage for LinkedIn and your website.",
      tips:'Keep the tone professional and short\nOffer headshot days: many staff in one session\nMention LinkedIn and website use, that is what they buy\nYear-end functions are a big corporate opportunity in Nov and Dec\nAsk for the marketing or HR contact, not the general inbox',
      content:'Headshot day before and after\nOffice culture reel\nYear-end function recap\nLinkedIn carousel: 5 tips for a great headshot' },
    { id:'wedding', name:'Wedding / Personal',
      keywords:'wedding, weddings, bride, groom, engagement, birthday, matric, dance, family, nikah, baby, graduation, anniversary',
      photoCats:['other'], template:'general',
      angle:'For your day, I would tell the story with natural moments, cinematic video and fast sneak peeks you can share with family the next day.',
      tips:'Be warm and personal, not salesy\nOffer next-day sneak peeks\nAsk about the date and venue straight away\nMention the client portal and online gallery\nShare a full gallery link, not only highlights',
      content:'Sneak peek carousel the next day\nCinematic highlight teaser reel\nGetting ready BTS stories\nCouple portrait golden hour reel' },
    { id:'media', name:'Media / Press',
      keywords:'media, news, magazine, press, tv, radio, broadcast, podcast, journal, publication, network',
      photoCats:['sports'], template:'accreditation',
      angle:"For {company|your publication}, I can supply fast, publication-ready images and short video clips from the events you cover.",
      tips:'Ask to join their media list or contributor pool\nStress fast delivery of publication-ready files\nMention captions and metadata included\nLink your best event and sports work\nFollow up before big events, not after',
      content:'Event recap gallery post\nFrom shoot to published story BTS\nMy top 5 frames from the event carousel' }
  ];

  /* ---------- default email templates ---------- */
  var SIGN = '\n\nKind regards,\n{name}\nFOM Studios\n{phone}\n{website} | Instagram: @{instagram}';
  var DEF_TEMPLATES = [
    { id:'accreditation', name:'Media accreditation request',
      subject:'Media accreditation request: {event|FOM Studios}',
      body:"Dear {recipient},\n\nMy name is {name}, founder of FOM Studios, a photography and videography brand based in South Africa.\n\nI'd like to express my interest in applying for media accreditation for {event|your upcoming event}. I specialise in sports photography and videography, and I'd love the opportunity to cover the event. {angle}\n\nYou can view my portfolio here:\nWebsite: {website}\nInstagram: @{instagram}\n\nI have also attached my portfolio for your reference.\n\nIf possible, I'd appreciate being added to your media mailing list and notified when accreditation applications open.\n\nThank you for your time, and I look forward to hearing from you." + SIGN },
    { id:'general', name:'General introduction / collaboration',
      subject:'FOM Studios x {company|your team}: photography and videography',
      body:"Dear {recipient},\n\nMy name is {name}, founder of FOM Studios, a photography and videography brand based in South Africa.\n\nI wanted to reach out to introduce FOM Studios and explore the possibility of working together{event| on }{event}. {angle}\n\nYou can view my work here:\nWebsite: {website}\nInstagram: @{instagram}\n\nI have attached my portfolio for your reference. I'd love to set up a quick call to hear what you have coming up.\n\nThank you for your time." + SIGN },
    { id:'brand', name:'Brand pitch (short)',
      subject:'Content for {company|your brand}: FOM Studios',
      body:"Hi {recipient},\n\nI'm {name} from FOM Studios, a Johannesburg photography and videography studio. {angle}\n\nPortfolio attached, more at {website} and @{instagram}.\n\nWould you be open to a small paid test shoot{event| around }{event}? Happy to work to your brief.\n\nThanks for your time." + SIGN },
    { id:'followup', name:'Follow-up',
      subject:'Following up: FOM Studios x {company|your team}',
      body:"Hi {recipient},\n\nI'm just following up on my earlier email about working together{event| on }{event}. I know inboxes get busy, so I thought I'd bring it back to the top.\n\n{angle}\n\nMy portfolio is attached again for easy reference, and you can see recent work at {website}.\n\nLet me know if it would help to chat for 10 minutes this week." + SIGN }
  ];

  var DEF_ME = { name:'Ishaaq Adam', phone:'+27 73 755 3136', email:'info@fomstudios.co.za', website:'www.fomstudios.co.za', instagram:'fom_studios_' };

  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  function defaults(){ var d = { categories:clone(DEF_CATS), templates:clone(DEF_TEMPLATES), me:clone(DEF_ME) };
    // Shot by A starts from the same playbook with her details swapped in
    return (window.FOM_BIZ && FOM_BIZ.isSba) ? JSON.parse(FOM_BIZ.rebrand(JSON.stringify(d), { owner:true })) : d; }

  /* keep saved data well-formed, fill gaps from the defaults */
  function clean(c){
    var d = defaults(); c = (c && typeof c === 'object') ? c : {};
    var str = function(v, n){ return typeof v === 'string' ? v.slice(0, n || 4000) : ''; };
    var cats = Array.isArray(c.categories) && c.categories.length ? c.categories : d.categories;
    cats = cats.filter(function(x){ return x && x.name; }).slice(0, 40).map(function(x, i){ return {
      id: str(x.id, 40) || ('c' + Date.now().toString(36) + i), name: str(x.name, 60), keywords: str(x.keywords, 800),
      photoCats: Array.isArray(x.photoCats) ? x.photoCats.filter(function(p){ return typeof p === 'string'; }).slice(0, 6) : [],
      template: str(x.template, 40), angle: str(x.angle, 600), tips: str(x.tips, 3000), content: str(x.content, 3000) }; });
    var tpls = Array.isArray(c.templates) && c.templates.length ? c.templates : d.templates;
    tpls = tpls.filter(function(x){ return x && x.name; }).slice(0, 30).map(function(x, i){ return {
      id: str(x.id, 40) || ('t' + Date.now().toString(36) + i), name: str(x.name, 80), subject: str(x.subject, 300), body: str(x.body, 6000) }; });
    var me = Object.assign({}, d.me, (c.me && typeof c.me === 'object') ? c.me : {});
    Object.keys(me).forEach(function(k){ me[k] = str(me[k], 120); });
    return { categories: cats, templates: tpls, me: me };
  }

  function cached(){ try{ var s = localStorage.getItem(KEY); return s ? clean(JSON.parse(s)) : defaults(); }catch(e){ return defaults(); } }
  function cache(c){ try{ localStorage.setItem(KEY, JSON.stringify(c)); }catch(e){} }

  function load(db){
    var c = cached();
    if(!db) return Promise.resolve(c);
    var get = window.FOM_BIZ ? FOM_BIZ.getSettings(db, 'outreach') : db.collection('settings').doc('outreach').get();
    return get.then(function(s){
      if(s.exists && s.data().json){ try{ c = clean(JSON.parse(s.data().json)); cache(c); }catch(e){} }
      return c;
    }).catch(function(e){ console.warn('outreach load', e); return c; });
  }
  function save(db, c){
    c = clean(c); cache(c);
    if(!db) return Promise.resolve(false);
    return db.collection('settings').doc(window.FOM_BIZ ? FOM_BIZ.sid('outreach') : 'outreach').set({ json: JSON.stringify(c), updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
      .then(function(){ return true; }).catch(function(e){ console.warn('outreach save', e); return false; });
  }

  /* ---------- helpers ---------- */
  function lines(s){ return String(s || '').split('\n').map(function(x){ return x.trim(); }).filter(Boolean); }
  function byId(c, id){ return (c.categories || []).find(function(x){ return x.id === id; }) || null; }
  function byName(c, name){ var n = String(name || '').toLowerCase(); return (c.categories || []).find(function(x){ return x.name.toLowerCase() === n; }) || null; }

  /* fill {key} and {key|fallback}. A fallback containing text is used when the key is empty.
     Special form {key| text } (fallback starts with a space) prints the text only when the key HAS a value. */
  function fill(tpl, vars){
    return String(tpl || '').replace(/\{(\w+)(?:\|([^}]*))?\}/g, function(m, k, fb){
      var v = vars[k] == null ? '' : String(vars[k]).trim();
      if(fb != null && /^\s/.test(fb)) return v ? fb : '';
      return v || (fb != null ? fb : '');
    });
  }

  /* guess the category from a company name or website */
  function guess(c, text){
    var t = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ') + ' ';
    if(!t.trim()) return null;
    var best = null, bestLen = 0;
    (c.categories || []).forEach(function(cat){
      String(cat.keywords || '').split(',').forEach(function(k){
        k = k.trim().toLowerCase(); if(!k) return;
        if(t.indexOf(' ' + k + ' ') >= 0 && k.length > bestLen){ best = cat; bestLen = k.length; }
      });
    });
    return best;
  }

  /* ---------- SA seasonal calendar ----------
     Recurring entries use MM-DD. Moving dates (Easter, Eid, Diwali, Black Friday) are listed per year.
     lead = how many days before the start it starts showing. */
  var REC = [
    { name:'Back to school and work', from:'01-08', to:'01-31', lead:10, cats:['corporate'], ideas:'New year headshot special for LinkedIn\nPersonal branding mini shoot\nRecap reel of your best work of last year' },
    { name:"Valentine's Day", from:'02-14', to:'02-14', lead:21, cats:['wedding'], ideas:'Couple shoot promo\nEngagement shoot reel\nLove-themed carousel of couple work' },
    { name:'Freedom Day', from:'04-27', to:'04-27', lead:10, cats:[], ideas:'Proudly South African photo series\nLocal heroes portrait carousel' },
    { name:'Comrades and winter marathon season', from:'05-20', to:'06-20', lead:21, cats:['sportsclub','sportsbrand'], ideas:'Runner portraits at training sessions\nRace day finish line reel\nPitch running clubs and race organisers' },
    { name:'Youth Day', from:'06-16', to:'06-16', lead:10, cats:[], ideas:'Young athletes spotlight series\nYouth sports club feature' },
    { name:'Rugby and winter sport season', from:'06-01', to:'09-30', lead:14, cats:['sportsclub','media','sportsbrand'], ideas:'Match day highlight reel\nPitch school and club rugby fixtures\nFan and atmosphere photo dump' },
    { name:"Women's Month", from:'08-01', to:'08-31', lead:14, cats:['sportsbrand','corporate'], ideas:'Women in sport portrait series\nFeature female athletes and founders you have shot\nCollab with a women-led business' },
    { name:'Matric dance season', from:'07-15', to:'09-30', lead:21, cats:['wedding'], ideas:'Matric dance arrival reel\nDance portrait package promo\nCar plus outfit combo shots' },
    { name:'Heritage Month', from:'09-01', to:'09-30', lead:14, cats:[], ideas:'Heritage Day braai content\nCultural attire portrait series\nLocal food and culture reel' },
    { name:'Spring and outdoor events', from:'09-01', to:'10-31', lead:7, cats:['catering','automotive'], ideas:'Golden hour outdoor shoots\nCar meet season content\nGarden and venue event coverage' },
    { name:'Year-end functions', from:'11-10', to:'12-15', lead:30, cats:['catering','corporate'], ideas:'Pitch caterers and venues for year-end functions now\nCorporate year-end party coverage package\nSetup timelapse reels for event companies' },
    { name:'Movember', from:'11-01', to:'11-30', lead:10, cats:['sportsclub'], ideas:'Team Movember portrait series\nCharity event coverage' },
    { name:'Festive and December wedding season', from:'12-01', to:'12-31', lead:30, cats:['wedding','catering'], ideas:'December wedding sneak peeks\nFestive family shoot mini sessions\nYear in review reel' },
    { name:'Day of Reconciliation', from:'12-16', to:'12-16', lead:7, cats:[], ideas:'Community and unity photo story' }
  ];
  var FIXED = [
    { name:'Ramadan (dates approximate)', from:'2026-02-18', to:'2026-03-19', lead:21, cats:['catering'], ideas:'Iftar event and food content\nCommunity iftar coverage\nEid outfit shoot bookings open' },
    { name:'Eid ul-Fitr (approximate)', from:'2026-03-20', to:'2026-03-22', lead:21, cats:['wedding','catering'], ideas:'Eid family portrait mini sessions\nEid outfit and detail carousel' },
    { name:'Easter weekend', from:'2026-04-03', to:'2026-04-06', lead:14, cats:['catering'], ideas:'Family shoot mini sessions\nEaster weekend events coverage' },
    { name:'Eid ul-Adha (approximate)', from:'2026-05-27', to:'2026-05-29', lead:14, cats:['wedding'], ideas:'Family portrait mini sessions\nCommunity event coverage' },
    { name:'Diwali', from:'2026-11-08', to:'2026-11-08', lead:21, cats:['wedding','catering'], ideas:'Festival of lights family shoots\nLights and colour detail reel' },
    { name:'Black Friday', from:'2026-11-27', to:'2026-11-30', lead:21, cats:[], ideas:'Black Friday shoot package deal\nGift voucher promo for shoots\nCountdown story series' },
    { name:'Ramadan (dates approximate)', from:'2027-02-08', to:'2027-03-09', lead:21, cats:['catering'], ideas:'Iftar event and food content\nCommunity iftar coverage\nEid outfit shoot bookings open' },
    { name:'Eid ul-Fitr (approximate)', from:'2027-03-10', to:'2027-03-12', lead:21, cats:['wedding','catering'], ideas:'Eid family portrait mini sessions\nEid outfit and detail carousel' },
    { name:'Easter weekend', from:'2027-03-26', to:'2027-03-29', lead:14, cats:['catering'], ideas:'Family shoot mini sessions\nEaster weekend events coverage' },
    { name:'Eid ul-Adha (approximate)', from:'2027-05-16', to:'2027-05-18', lead:14, cats:['wedding'], ideas:'Family portrait mini sessions\nCommunity event coverage' },
    { name:'Diwali', from:'2027-10-29', to:'2027-10-29', lead:21, cats:['wedding','catering'], ideas:'Festival of lights family shoots\nLights and colour detail reel' },
    { name:'Black Friday', from:'2027-11-26', to:'2027-11-29', lead:21, cats:[], ideas:'Black Friday shoot package deal\nGift voucher promo for shoots\nCountdown story series' },
    { name:'Ramadan (dates approximate)', from:'2028-01-28', to:'2028-02-26', lead:21, cats:['catering'], ideas:'Iftar event and food content\nCommunity iftar coverage\nEid outfit shoot bookings open' },
    { name:'Eid ul-Fitr (approximate)', from:'2028-02-27', to:'2028-02-29', lead:21, cats:['wedding','catering'], ideas:'Eid family portrait mini sessions\nEid outfit and detail carousel' },
    { name:'Easter weekend', from:'2028-04-14', to:'2028-04-17', lead:14, cats:['catering'], ideas:'Family shoot mini sessions\nEaster weekend events coverage' }
  ];
  function iso(d){ return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function addDays(s, n){ var d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); }
  /* entries that are on now or start within their lead window, soonest first */
  function upcoming(today){
    today = today || iso(new Date());
    var y = +today.slice(0, 4), out = [];
    REC.forEach(function(e){
      [y - 1, y, y + 1].forEach(function(yy){
        var from = yy + '-' + e.from, to = (e.to < e.from ? (yy + 1) : yy) + '-' + e.to;
        if(today >= addDays(from, -e.lead) && today <= to) out.push(Object.assign({}, e, { from: from, to: to }));
      });
    });
    FIXED.forEach(function(e){ if(today >= addDays(e.from, -e.lead) && today <= e.to) out.push(Object.assign({}, e)); });
    out.forEach(function(e){
      var d = Math.round((new Date(e.from + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
      e.daysTo = d; e.live = d <= 0;
    });
    return out.sort(function(a, b){ return a.daysTo - b.daysTo; });
  }

  window.FOM_OUT = { defaults: defaults, clean: clean, cached: cached, load: load, save: save, lines: lines,
    byId: byId, byName: byName, fill: fill, guess: guess, upcoming: upcoming, iso: iso, addDays: addDays,
    PHOTO_CATS: { sports:'Sports', automotive:'Automotive', other:'Other' } };
})();
