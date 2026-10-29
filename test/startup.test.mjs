import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../scripts/templates/bootstrap.js", import.meta.url),
  "utf8",
);
function shell({ storageFails = false } = {}) {
  const handlers = new Map(),
    values = new Map(),
    heading = { textContent: "正在打开账本" },
    message = { textContent: "" };
  let callback,
    cleared = false;
  const win = { addEventListener: (type, fn) => handlers.set(type, fn) };
  const doc = {
    visibilityState: "visible",
    querySelector: (selector) =>
      selector.includes("meta")
        ? { content: "test-build" }
        : selector.includes("heading")
          ? heading
          : message,
    addEventListener: (type, fn) => handlers.set(type, fn),
  };
  vm.runInNewContext(source, {
    window: win,
    document: doc,
    navigator: { onLine: false },
    localStorage: {
      getItem: (k) => {
        if (storageFails) throw Error("storage blocked");
        return values.get(k) || null;
      },
      setItem: (k, v) => values.set(k, v),
    },
    setTimeout: (fn) => {
      callback = fn;
      return 1;
    },
    clearTimeout: () => {
      cleared = true;
    },
  });
  return {
    api: win.__ledgerStartup,
    heading,
    message,
    values,
    timeout: () => callback(),
    cleared: () => cleared,
    handlers,
  };
}
test("startup watchdog explains a stalled boot without replacing a ready ledger or clearing data", () => {
  const s = shell();
  s.api.mark("database-start");
  s.timeout();
  assert.match(s.heading.textContent, /启动尚未完成/);
  assert.match(s.message.textContent, /账本数据没有被清除/);
  assert(
    JSON.parse(s.values.get("fine-ledger-startup-log-v1")).some(
      (row) => row.type === "startup-timeout",
    ),
  );
  s.api.ready();
  s.heading.textContent = "已进入账本";
  s.timeout();
  assert.equal(s.heading.textContent, "已进入账本");
  assert.equal(s.cleared(), true);
});
test("diagnostics stay bounded and unavailable localStorage cannot block boot", () => {
  const s = shell();
  for (let i = 0; i < 90; i++) s.api.mark("visibility");
  const rows = JSON.parse(s.values.get("fine-ledger-startup-log-v1"));
  assert.equal(rows.length, 40);
  assert(rows.every((r) => r.build === "test-build" && !("book" in r)));
  const blocked = shell({ storageFails: true });
  blocked.api.mark("main-script");
  blocked.api.ready();
  assert.equal(blocked.cleared(), true);
});
