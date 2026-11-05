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
  newEntry,
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
  assert.equal(backup.revisions[0].changes[0].before.name, "我的账本");
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

test("existing v3 legacy icons repair once without modifying money, source backup, or user category edits", async () => {
  const db = databases.personal;
  await db.delete();
  await db.open();
  const b = blankBook();
  b.id = "icon-upgrade-test";
  b.categories = [
    {
      id: "food",
      name: "餐饮",
      icon: "cup",
      color: "#123",
      kind: "expense",
      order: 0,
      archived: false,
    },
    {
      id: "coffee",
      name: "咖啡",
      parentId: "food",
      icon: "Tag",
      color: "#123",
      kind: "expense",
      order: 0,
      archived: false,
    },
    {
      id: "meal",
      name: "三餐",
      parentId: "food",
      icon: "Tag",
      color: "#123",
      kind: "expense",
      order: 1,
      archived: false,
    },
  ];
  b.accounts = [
    {
      id: "bank",
      name: "测试账户",
      currency: "CNY",
      type: "bank",
      groupId: "daily",
      openingMinor: "100000",
      openingAt: b.createdAt,
      icon: "Wallet",
      order: 0,
      archived: false,
      netWorth: true,
    },
  ];
  const legacy = {
    categories: [
      {
        id: "food",
        name: "餐饮",
        icon: "cup",
        children: [
          { id: "coffee", name: "咖啡" },
          { id: "meal", name: "三餐" },
        ],
      },
    ],
  };
  await db.state.put(b, "book");
  await db.state.put(legacy, "legacy-book-v2");
  await db.outbox.put({
    id: "manual-category-edit",
    changes: [{ collection: "categories", id: "meal" }],
  });
  await initialize("personal");
  const repaired = await readBook("personal");
  assert.equal(
    repaired.categories.find((c) => c.id === "coffee").icon,
    "Coffee",
  );
  assert.equal(repaired.categories.find((c) => c.id === "meal").icon, "Tag");
  assert.deepEqual(repaired.accounts, b.accounts);
  assert.deepEqual(repaired.entries, b.entries);
  assert.deepEqual(await db.state.get("legacy-book-v2"), legacy);
  assert.deepEqual(await db.state.get("before-category-icon-repair"), b);
  repaired.categories.find((c) => c.id === "coffee").icon = "Tag";
  await db.state.put(repaired, "book");
  await initialize("personal");
  assert.equal(
    (await readBook("personal")).categories.find((c) => c.id === "coffee").icon,
    "Tag",
  );
  await db.delete();
});


test('stale forms recheck account denomination, new history and archived references atomically', async t => {
  const db = databases.personal; await db.delete(); await db.open();
  t.after(()=>db.delete());
  const b = blankBook();
  b.accounts.push({id:'a',name:'账户',currency:'CNY',type:'bank',groupId:'',openingMinor:'0',openingAt:b.createdAt,icon:'Wallet',order:0,archived:false,netWorth:true});
  await initialize('personal',b);
  const entry = {...newEntry('a'),description:'消费',amountMinor:'10000',splits:[{id:'s',categoryId:'food',amountMinor:'10000'}]};
  const initial = await readBook('personal');
  await mutate('personal','另一页面改币种',book=>{book.accounts[0].currency='JPY'});
  const checkpoint = await exportBook('personal');
  await assert.rejects(mutate('personal','旧输入',book=>upsertEntry(book,entry),initial),/编辑期间/);
  assert.deepEqual(await db.state.get('book'),checkpoint.book);
  assert.deepEqual(await db.outbox.toArray(),checkpoint.operations);
  assert.deepEqual(await db.revisions.toArray(),checkpoint.revisions);
  await mutate('personal','改回',book=>{book.accounts[0].currency='CNY'});
  const beforeEntry = await readBook('personal');
  await mutate('personal','另一页面消费',book=>upsertEntry(book,entry));
  await assert.rejects(mutate('personal','旧账户编辑',book=>{book.accounts[0].currency='JPY'},beforeEntry),/不能修改币种/);
  assert.equal((await readBook('personal')).accounts[0].currency,'CNY');
  const beforeArchive=await readBook('personal');
  await mutate('personal','归档类目',book=>{book.categories.find(c=>c.id==='food').archived=true});
  await assert.rejects(mutate('personal','旧类目输入',book=>upsertEntry(book,{...entry,id:'second'}),beforeArchive),/编辑期间/);
  assert.equal((await readBook('personal')).entries.length,1);
});

test('funded accounts cannot change currency even without transactions', async t => {
 const db=databases.personal;await db.delete();await db.open();t.after(()=>db.delete());
 const b=blankBook();b.accounts.push({id:'funded',name:'账户',currency:'CNY',type:'bank',groupId:'',openingMinor:'10000',openingAt:b.createdAt,icon:'Wallet',order:0,archived:false,netWorth:true});
 await initialize('personal',b);
 await assert.rejects(mutate('personal','改币种',book=>{book.accounts[0].currency='USD';book.accounts[0].openingMinor='0'}),/不能修改币种/);
 assert.equal((await readBook('personal')).accounts[0].openingMinor,'10000');
 assert.equal(await db.outbox.count(),0);
});
