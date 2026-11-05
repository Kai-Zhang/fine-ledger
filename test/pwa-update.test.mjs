import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { MessageChannel } from "node:worker_threads";
import { renderWorker, buildPreview } from "../scripts/build-preview.mjs";

async function workerHarness({
  clientState,
  replyDelay = 0,
  oldCaches = new Map(),
  failure = false,
  online = true,
  diagnosticsFail = false,
} = {}) {
  const handlers = new Map(),
    entries = new Map(),
    diagnosticEntries = new Map(),
    background = [];
  let skipped = 0,
    claimed = 0,
    navigated = 0,
    networkCalls = 0;
  const root = "https://ledger.test/";
  const cache = {
    async addAll() {
      if (failure) throw Error("asset failed");
      entries.set(
        root + "release/index.html",
        new Response("release-coherent-html"),
      );
    },
    async match(request) {
      return entries
        .get(typeof request === "string" ? request : request.url)
        ?.clone();
    },
    async put(request, response) {
      entries.set(
        typeof request === "string" ? request : request.url,
        response.clone(),
      );
    },
  };
  const diagnosticCache = {
    async match(request) {
      return diagnosticEntries
        .get(typeof request === "string" ? request : request.url)
        ?.clone();
    },
    async put(request, response) {
      diagnosticEntries.set(
        typeof request === "string" ? request : request.url,
        response.clone(),
      );
    },
  };
  let deleted = false;
  const client = {
    url: root,
    postMessage(message, ports) {
      if (clientState !== undefined) {
        if (replyDelay) setTimeout(() => ports[0].postMessage(clientState), replyDelay);
        else ports[0].postMessage(clientState);
      }
    },
    async navigate(url) {
      assert.equal(url, root);
      navigated++;
    },
  };
  const context = vm.createContext({
    URL,
    Response,
    MessageChannel,
    AbortController,
    Request: class extends Request {
      constructor(url, options) {
        super(new URL(url, root), options);
      }
    },
    setTimeout,
    clearTimeout,
    caches: {
      open: async (name) => {
        if (name === "fine-ledger-startup-diagnostics-v1") {
          if (diagnosticsFail) throw Error("diagnostic cache unavailable");
          return diagnosticCache;
        }
        if (oldCaches.has(name)) return {
          match: async request => oldCaches.get(name).get(typeof request === 'string' ? request : request.url)?.clone(),
        };
        return cache;
      },
      keys: async () => ['test-new-release', ...oldCaches.keys()],
      delete: async (name) => {
        if (oldCaches.has(name)) {oldCaches.delete(name);return true;}
        deleted = true;
        entries.clear();
      },
    },
    fetch: async () => {
      networkCalls++;
      if (online === "hang") return new Promise(() => {});
      if (!online) throw Error("offline");
      return new Response("latest-online-html");
    },
    self: {
      location: { origin: "https://ledger.test" },
      skipWaiting: async () => {
        skipped++;
      },
      clients: {
        claim: async () => {
          claimed++;
        },
        matchAll: async () => [client],
      },
      addEventListener: (name, fn) => handlers.set(name, fn),
    },
  });
  const code = await renderWorker({
    release: "new-release",
    root: "/",
    shell: "/release/index.html",
    assets: ["/release/index.html"],
    cachePrefix: "test-",
    networkTimeoutMs: 30,
  });
  vm.runInContext(code, context);
  async function lifecycle(name) {
    let work;
    handlers.get(name)({
      waitUntil(promise) {
        work = promise;
      },
    });
    await work;
  }
  async function navigate() {
    let response;
    handlers.get("fetch")({
      request: { url: root, method: "GET", mode: "navigate" },
      waitUntil(promise) {
        background.push(promise);
      },
      respondWith(promise) {
        response = promise;
      },
    });
    return (await response).text();
  }
  return {
    lifecycle,
    oldCaches,
    async resource(url) {
      let response;
      handlers.get('fetch')({request:{url,method:'GET',mode:'same-origin'},waitUntil(p){background.push(p)},respondWith(p){response=p}});
      return await response;
    },
    navigate,
    state: () => ({ skipped, claimed, navigated, deleted, networkCalls }),
    entries,
    async logs() {
      await Promise.all(background);
      const response = diagnosticEntries.get(root + "__startup_diagnostics__");
      return response ? response.clone().json() : [];
    },
  };
}
test("a complete release activates automatically and refreshes a legacy root without query parameters", async () => {
  const worker = await workerHarness({clientState:{build:"old-release",safe:true}});
  await worker.lifecycle("install");
  await worker.lifecycle("activate");
  assert.equal(worker.state().skipped, 1);
  assert.equal(worker.state().claimed, 1);
  assert.equal(worker.state().navigated, 1);
});
test("a failed shell install retains the active release and does not take over", async () => {
  const worker = await workerHarness({ failure: true });
  await assert.rejects(worker.lifecycle("install"), /asset failed/);
  assert.equal(worker.state().skipped, 0);
  assert.equal(worker.state().deleted, true);
});
test("current pages are not reloaded and editing clients defer navigation", async () => {
  for (const clientState of [
    { build: "new-release", safe: true },
    { build: "old-release", safe: false },
  ]) {
    const worker = await workerHarness({ clientState });
    await worker.lifecycle("install");
    await worker.lifecycle("activate");
    assert.equal(worker.state().navigated, 0);
  }
});
test("online and offline root requests use one pinned release without a network prerequisite", async () => {
  const online = await workerHarness();
  await online.lifecycle("install");
  assert.equal(await online.navigate(), "release-coherent-html");
  assert.equal(await online.navigate(), "release-coherent-html");
  assert.equal(online.state().networkCalls, 0);
  const offline = await workerHarness({ online: false });
  await offline.lifecycle("install");
  assert.equal(await offline.navigate(), "release-coherent-html");
});
test("building unchanged sources is deterministic and all asset URLs avoid query parameters", async () => {
  const first = await buildPreview(),
    second = await buildPreview();
  assert.equal(first.release, second.release);
  assert(first.assets.every((url) => !url.includes("?")));
  assert(first.assets.some((url) => url.endsWith("/index.html")));
  assert(first.assets.some((url) => url.endsWith("/bootstrap.js")));
  const { readFile } = await import("node:fs/promises");
  const html = await readFile("public/index.html", "utf8");
  assert(html.indexOf("/bootstrap.js") < html.indexOf('type="module"'));
  assert.match(html, /data-startup-heading/);
});

test("cached launch finishes even when the network fetch never resolves", async () => {
  const worker = await workerHarness({ online: "hang" });
  await worker.lifecycle("install");
  let timer;
  try {
    const result = await Promise.race([
      worker.navigate(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("cached launch blocked by pending network")),
          100,
        );
      }),
    ]);
    assert.equal(result, "release-coherent-html");
    assert.equal(worker.state().networkCalls, 0);
  } finally {
    clearTimeout(timer);
  }
});

test("missing offline shell shows a bounded recovery page rather than an empty failed response", async () => {
  const worker = await workerHarness({ online: "hang" });
  const result = await worker.navigate();
  assert.match(result, /暂时无法打开厘序/);
  assert.match(result, /账本数据没有被清除/);
});

test("worker diagnostics are bounded technical metadata and storage failure cannot block cached navigation", async () => {
  const worker = await workerHarness();
  await worker.lifecycle("install");
  for (let i = 0; i < 28; i++) await worker.navigate();
  const rows = await worker.logs();
  assert.equal(rows.length, 50);
  assert.equal(rows.at(-1).type, "navigation-cache");
  assert(
    rows.every(
      (r) =>
        r.release === "new-release" && !("book" in r) && !("description" in r),
    ),
  );
  const broken = await workerHarness({ online: "hang", diagnosticsFail: true });
  await broken.lifecycle("install");
  assert.equal(await broken.navigate(), "release-coherent-html");
});


test('unknown and delayed dirty clients are never forced to navigate', async () => {
 for (const options of [{}, {clientState:{build:'old-release',safe:false},replyDelay:600}]) {
  const worker=await workerHarness(options);
  await worker.lifecycle('install');await worker.lifecycle('activate');
  assert.equal(worker.state().navigated,0);
 }
});

test('retained release assets work offline, cleanup preserves active and unknown clients',async()=>{
 const url='https://ledger.test/assets/old-release/calculate.worker.js';
 const oldCaches=new Map([['test-old-release',new Map([[url,new Response('old worker')]])],['test-unused',new Map()],['other-app-cache',new Map()]]);
 const worker=await workerHarness({clientState:{build:'old-release',safe:false},online:false,oldCaches});
 await worker.lifecycle('install');await worker.lifecycle('activate');
 assert.equal(await (await worker.resource(url)).text(),'old worker');
 assert(oldCaches.has('test-old-release'));assert(!oldCaches.has('test-unused'));assert(oldCaches.has('other-app-cache'));
 const unknown=new Map([['test-unknown',new Map()]]);
 const silent=await workerHarness({oldCaches:unknown});
 await silent.lifecycle('install');await silent.lifecycle('activate');
 assert(unknown.has('test-unknown'));
 // API paths never fall back to an old release's cache.
 assert.equal((await worker.resource('https://ledger.test/api/v1/session')).status,503);
});
