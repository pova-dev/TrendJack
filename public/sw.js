// TrendJack service worker — minimal, intentional.
//
// What it does:
//   - Receive push notifications from the server (STREAMS.alerts events
//     forwarded via /api/push when wired). Show a system notification.
//   - Click on a notification opens the dashboard at the trend's drawer.
//
// What it deliberately doesn't do:
//   - No offline caching of /api/* responses. Real-time data must be
//     fresh; serving stale signals is worse than showing a network
//     error.
//   - No precaching of assets. Next.js handles its own asset cache via
//     long-lived hashed URLs; layering another cache on top creates
//     stale-app bugs that are hard to debug.
//
// In short: this SW exists to enable PWA install + push, not to cache.

const SW_VERSION = 'tj-sw-v1';

self.addEventListener('install', () => {
  // Activate the new SW immediately on install — we don't want users
  // stuck on yesterday's worker after a deploy.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take control of any open tabs that were loaded before this SW
  // version was installed.
  event.waitUntil(self.clients.claim());
});

// Push event — wires to STREAMS.alerts via the (TODO) /api/push delivery.
// The payload shape mirrors the AlertMessage type from src/core/state.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try { payload = event.data.json(); } catch { /* malformed */ return; }
  const { title = 'TrendJack', body = '', trendId, brandId, level = 'info' } = payload;

  const options = {
    body,
    icon: '/icon-192.svg',
    badge: '/icon-192.svg',
    tag: trendId || `tj-${Date.now()}`,
    data: { trendId, brandId, level },
    requireInteraction: level === 'critical',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.trendId ? `/?trend=${data.trendId}` : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // If a tab is already open, focus it and post a message so the
      // client can open the trend drawer without navigation.
      for (const w of wins) {
        if (w.url.includes(self.registration.scope)) {
          w.postMessage({ kind: 'tj.notification.click', ...data });
          return w.focus();
        }
      }
      // Otherwise open a new tab.
      return self.clients.openWindow(url);
    }),
  );
});
