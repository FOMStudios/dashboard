/* FOM Studios - shared sign-in policy for every admin page.
   - Stays signed in when the app is closed completely.
   - Expires on its own after 10 days.
   - "Log out of all devices" (Settings) signs out every phone/computer.
   Loaded in the <head> so the unlock state is known before the page paints. */
(function(){
  var LIFE = 10 * 864e5;        // 10 days
  var SKEW = 12e4;              // 2 min tolerance between device and server clocks
  var LS = {
    get:function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
    set:function(k,v){ try{ localStorage.setItem(k,v); }catch(e){} },
    del:function(k){ try{ localStorage.removeItem(k); }catch(e){} }
  };
  function loginAt(){ return +LS.get('fom.loginAt') || 0; }

  // Skip the "checking session" splash when we already know this device is signed in and not expired
  var t = loginAt();
  if(LS.get('fom.authed') === '1' && t && Date.now() - t < LIFE) document.documentElement.classList.add('fom-authed');

  window.FOM_SESSION = {
    LIFE_DAYS: 10,
    expiresAt: function(){ var a = loginAt(); return a ? a + LIFE : 0; },

    // sign out this device and every other one
    logoutAll: function(){
      var f = window.firebase;
      return f.firestore().doc('settings/security')
        .set({ epoch: f.firestore.FieldValue.serverTimestamp() })
        .then(function(){ return f.auth().signOut(); });
    },

    attach: function(auth){
      var idleT;
      function idleMs(){ return (window.FOM && typeof FOM.idleMs === 'number') ? FOM.idleMs : 0; }   // 0 = never
      function rst(){
        clearTimeout(idleT);
        var m = idleMs();
        if(m > 0 && auth.currentUser) idleT = setTimeout(function(){ if(auth.currentUser) auth.signOut(); }, m);
      }
      function expired(){ var a = loginAt(); return !!a && Date.now() - a >= LIFE; }

      ['pointerdown','keydown','scroll','touchstart','mousemove'].forEach(function(ev){ addEventListener(ev, rst, {passive:true}); });
      document.addEventListener('visibilitychange', function(){
        if(document.hidden) return;
        if(auth.currentUser && expired()) auth.signOut(); else rst();
      });

      var unsub = null;
      auth.onAuthStateChanged(function(u){
        var ac = document.getElementById('authCheck'); if(ac) ac.style.display = 'none';
        if(unsub){ unsub(); unsub = null; }
        if(!u){ LS.del('fom.authed'); LS.del('fom.loginAt'); return; }

        if(!loginAt()) LS.set('fom.loginAt', String(Date.now()));   // first sign-in on this device
        if(expired()){ auth.signOut(); return; }
        LS.set('fom.authed', '1');
        rst();

        // remote "log out of all devices": any session older than the stamp is ended
        try{
          unsub = firebase.firestore().doc('settings/security').onSnapshot(function(s){
            var d = s.exists ? s.data() : null;
            var ep = d && d.epoch && d.epoch.toMillis ? d.epoch.toMillis() : 0;
            if(ep && loginAt() < ep - SKEW) auth.signOut();
          }, function(){ /* rules not published yet: ignore */ });
        }catch(e){}
      });
    }
  };
})();
