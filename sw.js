// Offline support and updates. The app opens from this cache; each file is re-checked with GitHub in the
// background (skipping the browser's own 10-minute cache), and when any file has changed, the open app is
// told so it can reload into the new version.
const CACHE = 'planner';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/app.js', 'js/config.js', 'js/parse.js', 'js/store.js', 'js/sync.js', 'js/firebase.js',
  'js/view.js', 'js/edit.js', 'js/gestures.js', 'js/menus.js', 'js/ui.js',
  'vendor/firebase.js', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// A file's version as the server labels it.
const tag = res => res.headers.get('etag') || res.headers.get('last-modified') || res.headers.get('content-length');

// Fetches a file fresh and stores it; true when it differs from the stored copy.
async function refresh(cache, url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) return false;
  const old = await cache.match(url, { ignoreSearch: true });
  await cache.put(url, res.clone());
  return !!old && tag(old) !== tag(res);
}

// Re-checks every file, then tells the open app if anything changed, so it reloads into a complete
// new version rather than a mix of old and new files.
let checking = null, found = false;
function checkAll() {
  return checking ??= caches.open(CACHE).then(async cache => {
    const changed = await Promise.all(FILES.map(f => refresh(cache, new URL(f, location).href).catch(() => false)));
    checking = null;
    if (found || changed.some(Boolean)) {
      found = false;
      for (const client of await self.clients.matchAll()) client.postMessage({ type: 'updated' });
    }
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const url = req.mode === 'navigate' ? new URL('./', location).href : req.url;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(url, { ignoreSearch: true });
    if (!hit) return fetch(req);
    e.waitUntil(refresh(cache, url).then(changed => { if (changed) { found = true; return checkAll(); } }, () => {}));
    return hit;
  }));
});

// The app sends "check" when it comes back to the screen.
self.addEventListener('message', e => { if (e.data === 'check') e.waitUntil(checkAll()); });
