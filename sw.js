// FOM Studios admin service worker: receives client activity notifications from the gallery Worker.
// It does not cache pages, so updates always show straight away.
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (err) { m = { body: e.data ? e.data.text() : '' }; }
  const sba = /^Shot by A/.test(m.title || '');
  e.waitUntil(self.registration.showNotification(m.title || 'FOM Studios', {
    body: m.body || '', tag: m.tag || undefined, renotify: !!m.tag,
    icon: sba ? 'assets/sba-icon-192.png' : 'assets/fom-icon-192.png',
    badge: sba ? 'assets/sba-icon-192.png' : 'assets/fom-icon-192.png',
    data: { url: m.url || 'dashboard.html' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || 'dashboard.html', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope) && 'focus' in w) {
        await w.focus();
        if ('navigate' in w && w.url !== target) { try { await w.navigate(target); } catch (err) {} }
        return;
      }
    }
    return clients.openWindow(target);
  })());
});
