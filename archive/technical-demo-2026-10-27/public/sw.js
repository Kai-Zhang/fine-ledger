const CACHE = 'fine-ledger-shell-v10';
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/domain.js', '/storage.js', '/validation.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(async cache => { await cache.addAll(SHELL); const lab=await fetch('/reliability.html'); if(lab.ok) await cache.addAll(['/reliability.html','/reliability.js','/reinstall.js','/reliability-fixture.js','/reliability.webmanifest']); }));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if (event.data === 'ACTIVATE_UPDATE') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? caches.match('/') : Response.error())));
});
