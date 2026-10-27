const CACHE = 'fine-ledger-p0-shell-v4';
const FILES = ['/', '/index.html', '/style.css', '/app.js', '/domain.js', '/storage.js', '/seed.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))));
self.addEventListener('activate', event => event.waitUntil(Promise.all([
  caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('fine-ledger-p0-shell-') && key !== CACHE).map(key => caches.delete(key)))),
  self.clients.claim(),
])));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
