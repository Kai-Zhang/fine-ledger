import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createService } from "../server/app.ts";
import { loadConfig } from "../server/config.ts";
import { digest } from "../server/protocol.ts";
import { exampleBook } from "../src/domain/example.ts";
import { blankBook, balance } from "../src/domain/ledger.ts";
import {
  databases,
  initialize,
  mutate,
  readBook,
  exportBook,
  readRestoreTarget,
  restoreRemoteBook,
} from "../src/storage/repository.ts";
import { verifySnapshot } from "../src/sync/snapshot.ts";

async function setup(t) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "fine-ledger-restore-"),
  );
  const service = await createService(
    loadConfig({ FINE_LEDGER_DATA_DIR: directory }),
    { initialPassword: "Synthetic-restore-password-123", timers: false },
  );
  const db = databases.personal;
  await db.delete();
  await db.open();
  const book = exampleBook();
  service.store.initialize(
    book,
    crypto.randomUUID(),
    service.store.epoch,
    "fixture",
  );
  const login = await service.app.inject({
    method: "POST",
    url: "/api/v1/session",
    headers: { origin: "http://localhost:4181" },
    payload: {
      password: "Synthetic-restore-password-123",
      deviceName: "恢复测试",
    },
  });
  const response = await service.app.inject({
    method: "GET",
    url: "/api/v1/snapshot",
    headers: { cookie: login.headers["set-cookie"].split(";")[0] },
  });
  assert.equal(response.statusCode, 200);
  const snapshot = response.json();
  t.after(async () => {
    await service.app.close();
    await db.delete();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    ...service,
    db,
    snapshot,
    async restore(input = snapshot, target, overrides = {}) {
      return restoreRemoteBook("personal", input, {
        origin: "https://ledger.example",
        expectedTarget: target ?? (await readRestoreTarget("personal")).token,
        ledgerId: snapshot.book.id,
        serverEpoch: snapshot.serverEpoch,
        ...overrides,
      });
    },
  };
}
function resign(s) {
  const { checksum, ...data } = s;
  s.checksum = digest(data);
  return s;
}

test("authenticated server snapshot restores a usable local ledger and baseline; offline edits never mutate remote", async (t) => {
  const x = await setup(t);
  const target = await readRestoreTarget("personal");
  assert.equal(target.book, undefined);
  await x.restore();
  const local = await readBook("personal");
  assert.deepEqual(local, x.snapshot.book);
  for (const a of local.accounts)
    assert.equal(balance(local, a.id), balance(x.snapshot.book, a.id));
  assert.equal(await x.db.outbox.count(), 0);
  const baseline = await x.db.state.get("remote-baseline");
  assert.equal(baseline.cursor, x.snapshot.cursor);
  assert.equal(baseline.serverEpoch, x.snapshot.serverEpoch);
  assert.deepEqual(baseline.versions, x.snapshot.versions);
  await mutate("personal", "离线编辑", (b) => {
    b.name = "本机修改";
  });
  assert.equal((await readBook("personal")).name, "本机修改");
  assert.equal(await x.db.outbox.count(), 1);
  assert.equal(x.store.book().name, x.snapshot.book.name);
  assert.equal(
    (await x.db.state.get("remote-baseline")).book.name,
    x.snapshot.book.name,
  );
});

test("replacement archives local book, pending operations, drafts and history without replaying them", async (t) => {
  const x = await setup(t),
    old = blankBook();
  old.settings.theme = "dark";
  await initialize("personal", old);
  await mutate("personal", "测试修改", (b) => {
    b.name = "本机旧测试账本";
  });
  await x.db.drafts.put({ description: "未完成输入" }, "entry");
  const target = await readRestoreTarget("personal");
  assert.equal(target.pending, 1);
  await x.restore(x.snapshot, target.token);
  const data = await exportBook("personal");
  assert.equal(data.book.id, x.snapshot.book.id);
  assert.equal(data.book.settings.theme, "dark");
  assert.equal(data.beforeRemoteRestore.book.name, "本机旧测试账本");
  assert.equal(data.beforeRemoteRestore.operations.length, 1);
  assert.equal(data.beforeRemoteRestore.revisions.length, 1);
  assert.equal(data.beforeRemoteRestore.drafts[0].description, "未完成输入");
  assert.equal(data.operations.length, 0);
  assert.equal(data.revisions.length, 0);
  assert.equal(data.legacy.drafts.length, 0);
  assert.equal(data.remoteBaseline.origin, "https://ledger.example");
});

test("corrupt checksum, invalid relationships, missing versions and duplicate versions never touch local data", async (t) => {
  const x = await setup(t);
  await initialize("personal", blankBook());
  const before = await exportBook("personal");
  const corrupt = structuredClone(x.snapshot);
  corrupt.book.name = "校验破坏";
  const relation = structuredClone(x.snapshot);
  relation.book.accounts[0].groupId = "missing";
  resign(relation);
  const versions = structuredClone(x.snapshot);
  versions.versions = [];
  resign(versions);
  const duplicates = structuredClone(x.snapshot);
  duplicates.versions.push(duplicates.versions[0]);
  resign(duplicates);
  for (const bad of [corrupt, relation, versions, duplicates]) {
    await assert.rejects(x.restore(bad));
    assert.deepEqual(await readBook("personal"), before.book);
    assert.equal(await x.db.state.get("remote-baseline"), undefined);
  }
});

test("local changes after preview reject replacement and preserve the newly committed operation", async (t) => {
  const x = await setup(t);
  await initialize("personal", blankBook());
  const target = await readRestoreTarget("personal");
  await mutate("personal", "另一标签页保存", (b) => {
    b.name = "必须保留的新修改";
  });
  await assert.rejects(x.restore(x.snapshot, target.token), /预览后有变化/);
  assert.equal((await readBook("personal")).name, "必须保留的新修改");
  assert.equal(await x.db.outbox.count(), 1);
});

test("draft changes after preview also reject replacement", async (t) => {
  const x = await setup(t),
    target = await readRestoreTarget("personal");
  await x.db.drafts.put({ description: "新草稿" }, "entry");
  await assert.rejects(x.restore(x.snapshot, target.token), /预览后有变化/);
  assert.equal((await x.db.drafts.get("entry")).description, "新草稿");
  assert.equal(await readBook("personal"), undefined);
});

test("failure after writing the replacement rolls back book, outbox, drafts, archive and baseline together", async (t) => {
  const x = await setup(t);
  await initialize("personal", blankBook());
  await mutate("personal", "原操作", (b) => {
    b.name = "原账本";
  });
  await x.db.drafts.put({ text: "保留" }, "draft");
  const before = await exportBook("personal"),
    put = x.db.state.put;
  x.db.state.put = function (value, key) {
    if (key === "remote-baseline") throw Error("模拟存储不足");
    return put.call(this, value, key);
  };
  try {
    await assert.rejects(x.restore(), /模拟存储不足/);
  } finally {
    x.db.state.put = put;
  }
  const after = await exportBook("personal");
  for (const key of [
    "book",
    "operations",
    "revisions",
    "legacy",
    "remoteBaseline",
    "beforeRemoteRestore",
  ])
    assert.deepEqual(after[key], before[key]);
});

test("wrong ledger and stale epoch require fresh preview instead of replacing the local book", async (t) => {
  const x = await setup(t);
  for (const overrides of [
    { ledgerId: "wrong-book" },
    { serverEpoch: crypto.randomUUID() },
  ])
    await assert.rejects(x.restore(x.snapshot, undefined, overrides), /已变化/);
  assert.equal(await readBook("personal"), undefined);
});

test("concurrent restore attempts cannot both overwrite the same preview target", async (t) => {
  const x = await setup(t),
    target = await readRestoreTarget("personal");
  const results = await Promise.allSettled([
    x.restore(x.snapshot, target.token),
    x.restore(x.snapshot, target.token),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.equal((await readBook("personal")).entries.length, 28);
  assert.equal(await x.db.outbox.count(), 0);
});

test("snapshot verification clones its input, preserves exact timestamps and rejects unsupported protocols", async (t) => {
  const x = await setup(t);
  const validated = await verifySnapshot(x.snapshot, {
    ledgerId: x.snapshot.book.id,
    serverEpoch: x.snapshot.serverEpoch,
  });
  validated.book.name = "只修改副本";
  assert.notEqual(validated.book.name, x.snapshot.book.name);
  assert.equal(
    validated.book.entries[0].occurredAt,
    x.snapshot.book.entries[0].occurredAt,
  );
  const bad = structuredClone(x.snapshot);
  bad.protocol = "future-protocol";
  resign(bad);
  await assert.rejects(x.restore(bad), /协议/);
});
