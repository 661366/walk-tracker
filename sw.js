var SHELL = 'wt-shell-v1', TILES = 'wt-tiles-v1';
var FILES = ['./', 'index.html', 'style.css', 'app.js', 'manifest.json', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== SHELL && k !== TILES; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.hostname === 'tile.openstreetmap.org') {
    // Map tiles you've already viewed are kept for spotty signal.
    e.respondWith(caches.open(TILES).then(function (c) {
      return c.match(e.request).then(function (hit) {
        return hit || fetch(e.request).then(function (r) { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; });
      });
    }));
    return;
  }
  if (u.origin !== location.origin && u.hostname !== 'unpkg.com') return;
  // App shell: network first (so updates arrive), cache fallback offline.
  e.respondWith(fetch(e.request).then(function (r) {
    if (r.ok) { var cp = r.clone(); caches.open(SHELL).then(function (c) { c.put(e.request, cp); }); }
    return r;
  }).catch(function () { return caches.match(e.request, { ignoreSearch: true }).then(function (m) { return m || caches.match('index.html'); }); }));
});
