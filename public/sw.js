const CONFIG = {"release":"0.4.1-2e52407f751639f8","root":"/","shell":"/assets/0.4.1-2e52407f751639f8/index.html","cachePrefix":"fine-ledger-shell-","assets":["/assets/0.4.1-2e52407f751639f8/index-BmGwAa_t.css","/assets/0.4.1-2e52407f751639f8/index-D7sV4CtR.js","/assets/0.4.1-2e52407f751639f8/index.html","/manifest.webmanifest","/icon.svg","/icon-192.png","/icon-512.png"]};
const CACHE = CONFIG.cachePrefix + CONFIG.release;
const appURL = new URL(CONFIG.root, self.location.origin).href;
function isAppPage(url) {
  const path = new URL(url).pathname;
  return path === CONFIG.root || path === CONFIG.root + 'index.html';
}
async function installShell() {
  try {
    const cache = await caches.open(CACHE);
    await cache.addAll(CONFIG.assets.map(url => new Request(url, { cache: 'reload' })));
    const shell = await cache.match(new URL(CONFIG.shell, self.location.origin).href);
    if (!shell) throw Error('Missing release entry');
    await cache.put(appURL, shell.clone());
    await self.skipWaiting();
  } catch (error) {
    await caches.delete(CACHE);
    throw error;
  }
}
function prepareClient(client) {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, 400);
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
    client.postMessage({ type: 'PREPARE_UPDATE', release: CONFIG.release }, [channel.port2]);
  });
}
async function activateShell() {
  await self.clients.claim();
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  await Promise.all(clients.filter(client => isAppPage(client.url)).map(async client => {
    const state = await prepareClient(client);
    if (state?.build === CONFIG.release || state?.safe === false) return;
    // Legacy pages cannot handle update messages. Start their navigation before
    // activation finishes, without waiting on a fetch blocked by activation.
    void client.navigate(appURL).catch(() => {});
  }));
  // Retain previous caches while old clients may still be editing. New fetches
  // use only this release's cache, so retained copies cannot mask an update.
}
async function navigation(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) return response;
  } catch {}
  const cache = await caches.open(CACHE);
  return await cache.match(appURL) || Response.error();
}
self.addEventListener('install', event => event.waitUntil(installShell()));
self.addEventListener('activate', event => event.waitUntil(activateShell()));
self.addEventListener('message', event => {
  if (event.data === 'APPLY_UPDATE') event.waitUntil(self.skipWaiting());
  if (event.data?.type === 'GET_RELEASE') event.ports[0]?.postMessage({ release: CONFIG.release });
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate' && isAppPage(url.href)) {
    event.respondWith(navigation(event.request));
    return;
  }
  if (url.pathname.endsWith('/sw.js') || url.pathname.endsWith('/release.json')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }
  event.respondWith(caches.open(CACHE).then(cache => cache.match(event.request)).then(cached => cached || fetch(event.request)));
});
