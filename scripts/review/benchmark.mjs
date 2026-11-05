import { performance } from "node:perf_hooks";
import { mkdtemp, rm } from "node:fs/promises";
import { Store } from "../../server/store.ts";
import { loadConfig } from "../../server/config.ts";
import { blankBook } from "../../src/domain/ledger.ts";
import { commandFor, changesBetween } from "../../src/sync/model.ts";
import { validateBook } from "../../src/sync/protocol.ts";
const results = [];
for (const n of [16000, 32000]) {
  const dir = await mkdtemp("/tmp/fine-ledger-benchmark-");
  const store = new Store(loadConfig({ FINE_LEDGER_DATA_DIR: dir }));
  const b = blankBook();
  b.accounts.push({
    id: "a",
    name: "synthetic",
    type: "bank",
    currency: "CNY",
    openingMinor: "0",
    openingAt: "2026-01-01T00:00:00Z",
    groupId: "",
    icon: "Wallet",
    archived: false,
    netWorth: true,
    order: 0,
  });
  const base = {
    kind: "expense",
    accountId: "a",
    amountMinor: "100",
    description: "synthetic benchmark",
    posted: true,
    occurredAt: "2026-11-01T00:00:00Z",
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    revision: 1,
  };
  b.entries = Array.from({ length: n }, (_, i) => ({
    ...base,
    id: `e${i}`,
    splits: [{ id: `s${i}`, categoryId: "food", amountMinor: "100" }],
  }));
  const measure = (fn) => {
    const t = performance.now();
    const value = fn();
    return { value, ms: +(performance.now() - t).toFixed(1) };
  };
  try {
    const init = measure(() =>
      store.initialize(b, crypto.randomUUID(), store.epoch, "test"),
    );
    const snap = store.snapshot();
    const next = structuredClone(snap.book);
    next.entries[0].description = "changed";
    const val = measure(() => validateBook(next, snap.book));
    const diff = measure(() => changesBetween(snap.book, next));
    const command = measure(() =>
      commandFor(snap.book, next, snap.versions, snap.serverEpoch),
    );
    const push = measure(() => store.push(command.value, "test"));
    const read = measure(() => store.book());
    const idlePull = measure(() =>
      store.pull(store.epoch, b.id, store.cursor, 50),
    );
    results.push({
      n,
      jsonMB: +(JSON.stringify(b).length / 1048576).toFixed(1),
      initialize_ms: init.ms,
      validate_ms: val.ms,
      diff_ms: diff.ms,
      command_ms: command.ms,
      push_ms: push.ms,
      book_ms: read.ms,
      idle_pull_ms: idlePull.ms,
    });
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}
console.log(JSON.stringify(results, null, 2));
