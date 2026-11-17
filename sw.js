/* Push only: the application HTML stays network-first and is not cached. */
var PUSH_CACHE = 'cerca-auto-push-v1';
var LAST_PUSH = new URL('last-push', self.registration.scope).href;
self.addEventListener('install', function(event) { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', function(event) { event.waitUntil(self.clients.claim()); });
self.addEventListener('push', function(event) {
  var data;
  try { data = event.data ? event.data.json() : {}; } catch (_e) { data = {}; }
  var title = data.title || 'Cerca auto';
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body: data.body || 'Ci sono nuovi annunci da controllare.',
      icon: new URL('icon-192.png', self.registration.scope).href,
      badge: new URL('icon-192.png', self.registration.scope).href,
      tag: data.tag || 'cerca-auto-new',
      data: { url: new URL('?push=1', self.registration.scope).href },
      renotify: false
    }),
    caches.open(PUSH_CACHE).then(function(cache) {
      return cache.put(LAST_PUSH, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
    }).catch(function() { /* A full cache must not prevent the notification. */ })
  ]));
});
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var target = new URL('?push=1', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.startsWith(self.registration.scope)) {
        return list[i].navigate(target).then(function(client) { return client && client.focus(); });
      }
    }
    return self.clients.openWindow(target);
  }));
});
