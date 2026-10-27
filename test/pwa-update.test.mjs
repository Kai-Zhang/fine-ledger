import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
import { renderWorker, buildPreview } from '../scripts/build-preview.mjs';

async function workerHarness({ clientState, failure = false, online = true } = {}) {
  const handlers = new Map(), entries = new Map(); let skipped = 0, claimed = 0, navigated = 0, networkCalls = 0;
  const root = 'https://ledger.test/';
  const cache = {
    async addAll() { if (failure) throw Error('asset failed'); entries.set(root + 'release/index.html', new Response('release-coherent-html')); },
    async match(request) { return entries.get(typeof request === 'string' ? request : request.url)?.clone(); },
    async put(request, response) { entries.set(typeof request === 'string' ? request : request.url, response.clone()); },
  };
  let deleted = false;
  const client = {
    url: root,
    postMessage(message, ports) { if (clientState !== undefined) ports[0].postMessage(clientState); },
    async navigate(url) { assert.equal(url, root); navigated++; },
  };
  const context = vm.createContext({
    URL, Response, MessageChannel,
    Request: class extends Request { constructor(url, options) { super(new URL(url, root), options); } },
    setTimeout, clearTimeout,
    caches: { open: async () => cache, delete: async () => { deleted = true; entries.clear(); } },
    fetch: async () => { networkCalls++; if (!online) throw Error('offline'); return new Response('latest-online-html'); },
    self: { location: { origin: 'https://ledger.test' }, skipWaiting: async () => { skipped++; }, clients: { claim: async () => { claimed++; }, matchAll: async () => [client] }, addEventListener: (name, fn) => handlers.set(name, fn) },
  });
  const code = await renderWorker({ release: 'new-release', root: '/', shell: '/release/index.html', assets: ['/release/index.html'], cachePrefix: 'test-' });
  vm.runInContext(code, context);
  async function lifecycle(name) { let work; handlers.get(name)({ waitUntil(promise) { work = promise; } }); await work; }
  async function navigate() { let response; handlers.get('fetch')({ request: { url: root, method: 'GET', mode: 'navigate' }, respondWith(promise) { response = promise; } }); return (await response).text(); }
  return { lifecycle, navigate, state: () => ({ skipped, claimed, navigated, deleted, networkCalls }), entries };
}
test('a complete release activates automatically and refreshes a legacy root without query parameters', async () => {
  const worker = await workerHarness(); await worker.lifecycle('install'); await worker.lifecycle('activate');
  assert.equal(worker.state().skipped, 1); assert.equal(worker.state().claimed, 1); assert.equal(worker.state().navigated, 1);
});
test('a failed shell install retains the active release and does not take over', async () => {
  const worker = await workerHarness({ failure: true });
  await assert.rejects(worker.lifecycle('install'), /asset failed/);
  assert.equal(worker.state().skipped, 0); assert.equal(worker.state().deleted, true);
});
test('current pages are not reloaded and editing clients defer navigation', async () => {
  for (const clientState of [{ build: 'new-release', safe: true }, { build: 'old-release', safe: false }]) {
    const worker = await workerHarness({ clientState }); await worker.lifecycle('install'); await worker.lifecycle('activate');
    assert.equal(worker.state().navigated, 0);
  }
});
test('online root requests always use the network; offline root uses one pinned release', async () => {
  const online = await workerHarness(); await online.lifecycle('install'); assert.equal(await online.navigate(), 'latest-online-html'); assert.equal(await online.navigate(), 'latest-online-html'); assert.equal(online.state().networkCalls, 2);
  const offline = await workerHarness({ online: false }); await offline.lifecycle('install'); assert.equal(await offline.navigate(), 'release-coherent-html');
});
test('building unchanged sources is deterministic and all asset URLs avoid query parameters', async () => {
  const first = await buildPreview(), second = await buildPreview(); assert.equal(first.release, second.release);
  assert(first.assets.every(url => !url.includes('?'))); assert(first.assets.some(url => url.endsWith('/index.html')));
});
