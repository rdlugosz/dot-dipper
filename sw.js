// Service worker: caches the app shell so Dot Dipper loads instantly and works
// offline. AI image requests (cross-origin) always go straight to the network.

const CACHE = 'dotdipper-v1';
const ASSETS = [
  './', './index.html', './css/styles.css', './manifest.json', './icon.svg',
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
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(resp => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return resp;
      }).catch(() => caches.match('./index.html'))
    )
  );
});
