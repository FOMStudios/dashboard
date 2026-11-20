/* FOM date shifter: moves a campaign (giveaway, promo, event, announcement) to new dates
   and rewrites every date written in its texts, so one change updates everything.
   Rule: anything before the old end date moves with the start; the end date and anything
   after it (last day, close-out, winners, follow-ups) moves with the end.
   Only dates from 3 days before the old start to 7 days after the old end are touched,
   so far-off dates (a code that expires weeks later) stay as they are.
   Used by channel.html (Move dates) and tested in node. */
(function(root){
  const MF = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const MS = MF.map(m => m.slice(0, 3));
  const DF = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const DS = DF.map(d => d.slice(0, 3));
  const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const diff = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5);
  const pad = n => String(n).padStart(2, '0');
  // "Saturday 5 December 2026", "Sat 5 Dec", "5 December", "5 Dec 2026"
  const RE = new RegExp('\\b(?:(' + DF.join('|') + '|' + DS.join('|') + ')\\.?,?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(' + MF.join('|') + '|' + MS.join('|') + ')\\b(\\.?)(?:\\s+(20\\d\\d))?', 'g');

  function plan(oldStart, oldEnd, newStart, newEnd){
    oldEnd = oldEnd || oldStart; newEnd = newEnd || newStart;
    const ds = diff(oldStart, newStart), de = diff(oldEnd, newEnd);
    const lo = addDays(oldStart, -3), hi = addDays(oldEnd, 7);
    return {
      oldStart, oldEnd, newStart, newEnd, ds, de, lo, hi,
      inWindow: d => !!d && d >= lo && d <= hi,
      map: d => d < oldEnd ? addDays(d, ds) : addDays(d, de)
    };
  }
  // rewrite dates written in text. Keeps the style it found (full or short names, year or not).
  function rewrite(text, P){
    if(!text || (!P.ds && !P.de)) return text;
    const baseY = +P.oldStart.slice(0, 4), baseM = +P.oldStart.slice(5, 7);
    return String(text).replace(RE, (all, wd, day, mon, dot, yr) => {
      const mi = MF.indexOf(mon) >= 0 ? MF.indexOf(mon) : MS.indexOf(mon);
      let y = yr ? +yr : baseY;
      if(!yr && mi + 1 < baseM - 6) y++;           // "5 Jan" in a December campaign = next year
      if(!yr && mi + 1 > baseM + 6) y--;
      const iso = y + '-' + pad(mi + 1) + '-' + pad(+day);
      if(!P.inWindow(iso)) return all;
      const n = P.map(iso), nd = new Date(n + 'T12:00:00Z');
      const long = mon.length > 3, wl = wd && wd.length > 3;
      const w = wd ? (wl ? DF : DS)[nd.getUTCDay()] + (all.match(/^\w+\./) ? '.' : '') + (all.match(/^\w+\.?,/) ? ',' : '') + ' ' : '';
      const m = (long ? MF : MS)[nd.getUTCMonth()];
      return w + nd.getUTCDate() + ' ' + m + dot + (yr ? ' ' + nd.getUTCFullYear() : '');
    });
  }
  root.FOM_SHIFT = { plan, rewrite, addDays, diff };
  if(typeof module !== 'undefined') module.exports = root.FOM_SHIFT;
})(typeof window !== 'undefined' ? window : globalThis);
