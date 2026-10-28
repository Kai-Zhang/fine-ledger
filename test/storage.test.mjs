import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import Dexie from "dexie";
import {
  LedgerDB,
  databases,
  initialize,
  mutate,
  readBook,
  exportBook,
} from "../src/storage/repository.ts";
import { blankBook, upsertEntry } from "../src/domain/ledger.ts";
test("upgrades legacy IndexedDB without discarding records, precise timestamps, or raw backup", async () => {
  const name = "migration-test-" + crypto.randomUUID(),
    old = new Dexie(name);
  old.version(2).stores({ state: "", outbox: "id", drafts: "" });
  const legacy = {
    schema: 1,
    id: "old-book",
    createdAt: "2026-01-01T00:00:00Z",
    accounts: [
      {
        id: "bank",
        name: "旧账户",
        type: "bank",
        currency: "CNY",
        openingMinor: "123456",
      },
    ],
    categories: [
      {
        id: "food",
        name: "餐饮",
        kind: "expense",
        children: [{ id: "lunch", name: "午餐" }],
      },
    ],
    projects: ["旅行"],
    entries: [
      {
        id: "old-entry",
        kind: "expense",
        accountId: "bank",
        amountMinor: "123",
        categoryId: "lunch",
        description: "旧记录",
        occurredAt: "2026-01-02T10:03:21.123456Z",
        createdAt: "2026-01-02T10:03:21Z",
        revision: 4,
      },
    ],
  };
  await old.table("state").put(legacy, "book");
  await old.table("outbox").put({ id: "old-operation" });
  old.close();
  const next = new LedgerDB(name);
  const b = await next.state.get("book");
  assert.equal(b.schema, 3);
  assert.equal(b.entries[0].occurredAt, legacy.entries[0].occurredAt);
  assert.equal(b.entries[0].splits[0].categoryId, "lunch");
  assert.equal(b.accounts[0].openingMinor, "123456");
  assert.deepEqual(await next.state.get("legacy-book-v2"), legacy);
  assert.equal(await next.outbox.count(), 1);
  next.close();
  await Dexie.delete(name);
});
test("local mutation, operation log and recovery revision commit atomically, errors leave all unchanged", async () => {
  const db = databases.personal;
  await db.delete();
  await db.open();
  const b = blankBook();
  b.accounts = [
    {
      id: "bank",
      name: "测试",
      currency: "CNY",
      type: "bank",
      groupId: "daily",
      openingMinor: "0",
      openingAt: b.createdAt,
      icon: "Wallet",
      order: 0,
      archived: false,
      netWorth: true,
    },
  ];
  await initialize("personal", b);
  await assert.rejects(
    mutate("personal", "失败", (book) => {
      book.name = "不应保存";
      throw Error("模拟存储前失败");
    }),
  );
  assert.equal((await readBook("personal")).name, "我的账本");
  assert.equal(await db.outbox.count(), 0);
  assert.equal(await db.revisions.count(), 0);
  await mutate("personal", "重命名", (book) => {
    book.name = "已保存";
  });
  assert.equal((await readBook("personal")).revision, 1);
  assert.equal(await db.outbox.count(), 1);
  const backup = await exportBook("personal");
  assert.equal(backup.book.name, "已保存");
  assert.equal(backup.revisions[0].changes[0].before, "我的账本");
  const previousPut = db.outbox.put;
  db.outbox.put = async () => {
    throw Error("模拟写日志失败");
  };
  await assert.rejects(
    mutate("personal", "原子失败", (book) => {
      book.name = "不能保存";
    }),
    /写日志失败/,
  );
  db.outbox.put = previousPut;
  assert.equal((await readBook("personal")).name, "已保存");
  assert.equal(await db.revisions.count(), 1);
  await initialize("example");
  assert.notEqual((await readBook("example")).id, b.id);
  assert.equal((await readBook("personal")).name, "已保存");
  await db.delete();
  await databases.example.delete();
});
