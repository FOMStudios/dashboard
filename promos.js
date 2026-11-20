/* FOM Studios promo codes, shared by the Price Calculator and the dashboard "This week" card.
   type 'percent': value is % off. type 'flat': value is Rand off.
   starts / expires (optional, 'YYYY-MM-DD'): outside these dates the code is rejected.
   Codes match without caring about capitals. Never use long dashes in labels (they print on invoices). */
window.FOM_PROMOS = {
  'FOMGIVEAWAY10':  { type: 'percent', value: 10, label: 'Giveaway 10% off', expires: '2026-12-29', starts: '2026-12-05', note: 'Nov 2026 giveaway: every entrant, first booking, once per person. Posted in the group on Sat 5 Dec after 18:00 (giveaway runs 21 Nov to 5 Dec). Dates follow the campaign on the WhatsApp Group page.' },
  'FOMBLACKFRIDAY': { type: 'percent', value: 15, label: 'Black Friday 15% off', starts: '2026-11-27', expires: '2026-11-30', note: 'Black Friday to Cyber Monday. Cannot be combined with the giveaway code or prizes. Dates follow the campaign on the WhatsApp Group page.' },
  // 'REFER15':     { type: 'percent', value: 15, label: 'Referral 15% off', expires: '2026-12-31' },
  // 'LOYALTY200':  { type: 'flat',    value: 200, label: 'Loyalty R200 off' },   // no expiry = never expires
};

/* Codes follow their campaign: a campaign on the WhatsApp Group page with a "Promo code" set
   (saved to channel/settings.json) gives that code its start and end dates, so "Move dates"
   there also moves the code here. */
(function(){
  if(typeof fetch === 'undefined') return;
  fetch('channel/settings.json?t=' + Date.now(), { cache:'no-store' }).then(r => r.ok ? r.json() : null).then(st => {
    if(!st) return;
    (st.campaigns || []).forEach(c => {
      const code = String(c.code || '').trim().toUpperCase(); if(!code || !c.start) return;
      const p = window.FOM_PROMOS[code]; if(!p) return;
      p.starts = c.start; if(c.end) p.expires = c.end;
    });
    try{ window.dispatchEvent(new Event('fom-promos')); }catch(e){}
  }).catch(() => {});
})();
