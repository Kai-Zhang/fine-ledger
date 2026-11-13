const CONFIG = {"release":"0.14.5-760054d8f5570596","root":"/","shell":"/assets/0.14.5-760054d8f5570596/index.html","cachePrefix":"fine-ledger-shell-","assets":["/assets/0.14.5-760054d8f5570596/bootstrap.js","/assets/0.14.5-760054d8f5570596/calculate.worker-CQqDVp5K.js","/assets/0.14.5-760054d8f5570596/index-DAQUoyXe.css","/assets/0.14.5-760054d8f5570596/index-DJ-yu_5F.js","/assets/0.14.5-760054d8f5570596/index.html","/manifest.webmanifest","/icon.svg","/icon-192.png","/icon-512.png","/apple-touch-icon-ledger-v1.png"]};
const CACHE = CONFIG.cachePrefix + CONFIG.release;
const appURL = new URL(CONFIG.root, self.location.origin).href;
const shellURL = new URL(CONFIG.shell, self.location.origin).href;
const JOURNAL = 'fine-ledger-startup-diagnostics-v1';
const journalURL = new URL('/__startup_diagnostics__', self.location.origin).href;
let journal = Promise.resolve();
function trace(event, type, detail = {}) {
  // Bounded technical metadata only; diagnostic writes never gate a response.
  journal = journal.catch(() => {}).then(async () => {
    const cache = await caches.open(JOURNAL);
    const previous = await cache.match(journalURL);
    const rows = previous ? await previous.json() : [];
    rows.push({ at: new Date().toISOString(), release: CONFIG.release, type, ...detail });
    await cache.put(journalURL, new Response(JSON.stringify(rows.slice(-50)), { headers: { 'Content-Type': 'application/json' } }));
  }).catch(() => {});
  event.waitUntil(journal);
}
function isAppPage(url) {
  const path = new URL(url).pathname;
  return path === CONFIG.root || path === CONFIG.root + 'index.html';
}
async function installShell() {
  try {
    const cache = await caches.open(CACHE);
    await cache.addAll(CONFIG.assets.map(url => new Request(url, { cache: 'reload' })));
    const shell = await cache.match(shellURL);
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
    if (state?.build === CONFIG.release || state?.safe !== true) return;
    void client.navigate(appURL).catch(() => {});
  }));
  await cleanupCaches();
}
let cleanup;
function cleanupCaches() {
  if (cleanup) return cleanup;
  cleanup = (async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const states = await Promise.all(clients.filter(client => isAppPage(client.url)).map(prepareClient));
    // A suspended or legacy client may still use any old release. Fail closed.
    if (states.some(state => typeof state?.build !== 'string' || !/^[\w.-]+$/.test(state.build))) return;
    const keep = new Set([CACHE, ...states.map(state => CONFIG.cachePrefix + state.build)]);
    for (const name of await caches.keys())
      if (name.startsWith(CONFIG.cachePrefix) && !keep.has(name)) await caches.delete(name);
  })().catch(() => {}).finally(() => { cleanup = undefined; });
  return cleanup;
}
async function boundedFetch(request) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      fetch(request, { cache: 'no-store', signal: controller.signal }),
      new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(Error('network-timeout')); }, CONFIG.networkTimeoutMs || 3000);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
function unavailable() {
  return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>厘序</title><main><h1>暂时无法打开厘序</h1><p>离线启动文件尚未准备完整。请连接可访问原服务器的网络后重试。</p><p>账本数据没有被清除。</p><a href="' + CONFIG.root + '">重新打开</a></main></html>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
async function navigation(event) {
  trace(event, 'navigation-start');
  try {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(shellURL) || await cache.match(appURL);
    if (cached) {
      trace(event, 'navigation-cache');
      return cached;
    }
  } catch (error) { trace(event, 'cache-read-error', { error: String(error).slice(0, 180) }); }
  // A valid pinned shell must never wait for connectivity, DNS or server updates.
  trace(event, 'navigation-cache-miss');
  try {
    const response = await boundedFetch(event.request);
    if (response.ok) { trace(event, 'navigation-network'); return response; }
    trace(event, 'navigation-network-status', { status: response.status });
  } catch (error) { trace(event, 'navigation-network-error', { error: String(error).slice(0, 180) }); }
  return unavailable();
}
async function resource(event) {
  const path = new URL(event.request.url).pathname;
  try {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const release = path.match(/^\/assets\/([\w.-]+)\//)?.[1];
    const pinned = release && CONFIG.cachePrefix + release;
    if (pinned && pinned !== CACHE && (await caches.keys()).includes(pinned)) {
      const old = await (await caches.open(pinned)).match(event.request);
      if (old) return old;
    }
  } catch {}
  try { return await boundedFetch(event.request); }
  catch (error) {
    trace(event, 'resource-unavailable', { path, error: String(error).slice(0, 180) });
    return new Response('Offline resource unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
self.addEventListener('install', event => event.waitUntil(installShell()));
self.addEventListener('activate', event => event.waitUntil(activateShell()));
self.addEventListener('message', event => {
  if (event.data === 'APPLY_UPDATE') event.waitUntil(self.skipWaiting());
  if (event.data?.type === 'GET_RELEASE') {
    event.ports[0]?.postMessage({ release: CONFIG.release });
    event.waitUntil(cleanupCaches());
  }
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate' && isAppPage(url.href)) {
    event.respondWith(navigation(event));
    return;
  }
  if (url.pathname.endsWith('/sw.js') || url.pathname.endsWith('/release.json')) {
    event.respondWith(boundedFetch(event.request));
    return;
  }
  event.respondWith(resource(event));
});
