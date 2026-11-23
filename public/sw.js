// Lumilex service worker — handles Web Push notifications.
// Receives signed push payloads from /api/push and renders a native OS
// notification; opens the target URL on click, focusing an existing tab
// when possible.
//
// A service worker is one static file shared by every tenant, so it holds no
// firm name and no firm mark. The title and the icon ride on the payload, which
// lib/push.ts composes for the firm the notification belongs to. When the
// payload carries neither, this renders a generic title and lets the OS pick its
// own icon — never a packaged mark, which would be some other firm's.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: event.data ? event.data.text() : 'Notification' };
  }

  const title = payload.title || 'Notification';
  const options = {
    body: payload.body || '',
    ...(payload.icon ? { icon: payload.icon } : {}),
    ...(payload.badge ? { badge: payload.badge } : {}),
    tag: payload.tag,
    data: {
      href: payload.href || '/dashboard',
      entityId: payload.entityId || null,
    },
    // Re-show even if same tag exists so the OS surfaces it again
    renotify: !!payload.tag,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetHref = (event.notification.data && event.notification.data.href) || '/dashboard';

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Prefer focusing a tab already on the same origin
    for (const client of all) {
      try {
        const url = new URL(client.url);
        const here = new URL(targetHref, self.location.origin);
        if (url.origin === here.origin) {
          await client.focus();
          await client.navigate(here.toString()).catch(() => {});
          return;
        }
      } catch {
        /* ignore */
      }
    }
    await self.clients.openWindow(targetHref);
  })());
});
