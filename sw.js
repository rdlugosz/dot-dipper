// Service worker for Dot Dipper.
//
// Network-first for the app's own files: when online, every visit fetches the
// latest code (so updates apply automatically on the next refresh), and the
// cache is kept up to date as an offline fallback. Cross-origin requests (e.g.
// AI images) are left to the network. Bump CACHE whenever the shell changes to
// retire old caches.
const CACHE = 'dotdipper-v3';
const ASSETS = [
  './', './index.html', './css/styles.css', './manifest.json',
  './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  './js/app.js', './js/editor.js', './js/process.js', './js/quantize.js',
  './js/samples.js', './js/ai.js', './js/storage.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Network-first, and revalidate with the server (cache: 'no-cache') so the
  // browser's own HTTP cache can't serve stale code after a deploy. Falls back
  // to the cached copy when offline.
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(resp => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return resp;
      })
      .catch(() => caches.match(e.request).then(c => c || caches.match('./index.html')))
  );
});
