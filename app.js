/* ============================================================
   FOM STUDIOS — shared admin app shell behaviour.
   Bottom nav, hamburger page list, mascot Settings sheet,
   theme (light/dark/auto) and the shared idle-lock setting.
   Loaded on every admin page after its own scripts.
   ============================================================ */
(function(){
"use strict";
var D = document, root = D.documentElement;
root.classList.add('fom-ready');

/* ---- tiny guarded storage ---- */
var LS = {
  get:function(k,d){ try{ var v=localStorage.getItem(k); return v==null?d:v; }catch(e){ return d; } },
  set:function(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
};

/* ---- theme ---- */
function applyTheme(t){ if(t==='light'||t==='dark') root.setAttribute('data-theme',t); else root.removeAttribute('data-theme'); }
var theme = LS.get('fom.theme','auto');
applyTheme(theme);

/* ---- idle auto-lock duration (read by the injected gate code) ---- */
window.FOM = window.FOM || {};
function setIdleFromStore(){ var m = +LS.get('fom.autolock','15'); window.FOM.idleMs = m>0 ? m*60000 : 0; }
setIdleFromStore();

/* ---- full page list (hamburger) ---- */
var PAGES = [
  {n:'Dashboard',       h:'dashboard.html', e:'🏠'},
  {n:'Order Database',  h:'database.html',  e:'📋'},
  {n:'Project Workflow',h:'workflow.html',  e:'✅'},
  {n:'Leads & Outreach',h:'leads.html',     e:'📣'},
  {n:'Content Planner', h:'content.html',   e:'🎬'},
  {n:'Price Calculator',h:'calculator.html',e:'🧮'},
  {n:'Email',           h:'email.html',     e:'✉️'},
  {n:'Contract',        h:'contract.html',  e:'📄'}
];
var here = (location.pathname.split('/').pop() || 'dashboard.html').toLowerCase();
if(here === '' ) here = 'dashboard.html';

/* ---- icons ---- */
var IC = {
  menu:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  home:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.2 3 10.4V20a1 1 0 0 0 1 1h5v-6h6v6h5a1 1 0 0 0 1-1v-9.6z"/></svg>',
  calc:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2.2"/><path d="M8.5 7h7"/><path d="M8.5 11h0M12 11h0M15.5 11h0M8.5 14.5h0M12 14.5h0M15.5 14.5h0M8.5 18h0M12 18h0M15.5 18h0"/></svg>'
};

/* ---- scrim + sheet (shared for hamburger list and settings) ---- */
var scrim = D.createElement('div'); scrim.className = 'fom-scrim';
var sheet = D.createElement('div'); sheet.className = 'fom-sheet';
sheet.setAttribute('role','dialog'); sheet.setAttribute('aria-modal','true');
sheet.innerHTML = '<div class="grab"></div><div class="fom-sheet-h"><h2 id="fomSheetTitle"></h2><button class="fom-x" aria-label="Close">&times;</button></div><div class="fom-sheet-b" id="fomSheetBody"></div>';
D.body.appendChild(scrim); D.body.appendChild(sheet);
function openSheet(){ scrim.classList.add('on'); sheet.classList.add('on'); }
function closeSheet(){ scrim.classList.remove('on'); sheet.classList.remove('on'); }
scrim.onclick = closeSheet;
sheet.querySelector('.fom-x').onclick = closeSheet;

/* ---- logout + current admin email, via the page's own Firebase (if up) ---- */
function fb(){ try{ return (window.firebase && firebase.apps && firebase.apps.length) ? firebase : null; }catch(e){ return null; } }
function currentEmail(){ var f=fb(); try{ return f && f.auth().currentUser ? f.auth().currentUser.email : ''; }catch(e){ return ''; } }
function logout(){ var f=fb(); try{ if(f) f.auth().signOut(); }catch(e){} closeSheet(); }

/* ---- hamburger: full page list ---- */
function openMenu(){
  D.getElementById('fomSheetTitle').textContent = 'All pages';
  D.getElementById('fomSheetBody').innerHTML = PAGES.map(function(p){
    var active = p.h === here ? ' active' : '';
    return '<a class="fom-row'+active+'" href="'+p.h+'"><span class="e">'+p.e+'</span><b>'+p.n+'</b></a>';
  }).join('');
  openSheet();
}

/* ---- mascot: profile + settings ---- */
function openSettings(){
  D.getElementById('fomSheetTitle').textContent = 'Settings';
  var email = currentEmail();
  var lock = LS.get('fom.autolock','15');
  var seg = function(val,label){ return '<button data-theme-set="'+val+'" class="'+(theme===val?'on':'')+'">'+label+'</button>'; };
  var lockOpt = function(v,label){ return '<option value="'+v+'"'+(lock===String(v)?' selected':'')+'>'+label+'</option>'; };
  D.getElementById('fomSheetBody').innerHTML =
    '<div class="fom-prof"><span class="pic"><img src="assets/mascot.png" alt=""></span>'+
      '<div><b>FOM Studios</b><small>'+(email ? email : 'Admin')+'</small></div></div>'+
    '<div class="fom-set"><span><label>Appearance</label><small>Light, dark, or follow your phone</small></span>'+
      '<div class="fom-seg" id="fomTheme">'+seg('auto','Auto')+seg('light','Light')+seg('dark','Dark')+'</div></div>'+
    '<div class="fom-set"><span><label>Auto-lock</label><small>Lock after this long with no activity</small></span>'+
      '<select class="fom-sel" id="fomLock">'+lockOpt(5,'5 min')+lockOpt(15,'15 min')+lockOpt(30,'30 min')+lockOpt(60,'1 hour')+lockOpt(0,'Never')+'</select></div>'+
    '<button class="fom-logout" id="fomLogout">Log out &amp; lock</button>'+
    '<p class="fom-note">Closing the app always locks it; you sign in again next time. FOM Studios Admin.</p>';
  // wire
  var tw = D.getElementById('fomTheme');
  tw.onclick = function(e){ var b=e.target.closest('[data-theme-set]'); if(!b) return;
    theme = b.getAttribute('data-theme-set'); LS.set('fom.theme',theme); applyTheme(theme);
    tw.querySelectorAll('button').forEach(function(x){ x.classList.toggle('on', x===b); }); };
  D.getElementById('fomLock').onchange = function(e){ LS.set('fom.autolock', e.target.value); setIdleFromStore(); };
  D.getElementById('fomLogout').onclick = logout;
  openSheet();
}

/* ---- build the bottom nav ---- */
var nav = D.createElement('nav'); nav.className = 'fom-nav'; nav.setAttribute('aria-label','App');
nav.innerHTML =
  '<button class="js-menu" aria-label="All pages">'+IC.menu+'</button>'+
  '<button class="js-home'+(here==='dashboard.html'?' active':'')+'" aria-label="Dashboard">'+IC.home+'</button>'+
  '<button class="js-calc'+(here==='calculator.html'?' active':'')+'" aria-label="Price Calculator">'+IC.calc+'</button>'+
  '<button class="js-prof" aria-label="Profile and settings"><span class="av"><img src="assets/mascot.png" alt=""></span></button>';
D.body.appendChild(nav);
nav.querySelector('.js-menu').onclick = openMenu;
nav.querySelector('.js-home').onclick = function(){ if(here!=='dashboard.html') location.href='dashboard.html'; };
nav.querySelector('.js-calc').onclick = function(){ if(here!=='calculator.html') location.href='calculator.html'; };
nav.querySelector('.js-prof').onclick = openSettings;

/* close the sheet with Escape */
addEventListener('keydown', function(e){ if(e.key==='Escape') closeSheet(); });
})();
