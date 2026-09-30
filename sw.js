// Offline support: the app opens from this cache, and each file is refreshed in the background
// whenever it's requested, so a new version shows up on the next launch.
const CACHE = 'planner';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/app.js', 'js/config.js', 'js/parse.js', 'js/store.js', 'js/sync.js', 'js/firebase.js',
  'js/view.js', 'js/edit.js', 'js/gestures.js', 'js/menus.js', 'js/ui.js',
  'vendor/firebase.js', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; });
    if (!hit) return fresh;
    e.waitUntil(fresh.catch(() => {}));
    return hit;
  }));
});
