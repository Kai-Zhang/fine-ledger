import test from "node:test";
import assert from "node:assert/strict";
import { blankBook, balance } from "../src/domain/ledger.ts";
import { moveAccount, moveCategory } from "../src/domain/organization.ts";
import {
  emptyFilter,
  filterEntries,
  matchingSplits,
  filterDates,
  validateFilter,
} from "../src/domain/filters.ts";
function fixture() {
  const b = blankBook();
  b.timeZone = "Asia/Shanghai";
  b.groups = [
    { id: "a", name: "A", order: 0 },
    { id: "b", name: "B", order: 1 },
    { id: "empty", name: "空", order: 2 },
  ];
  b.accounts = ["one", "two", "old", "jpy"].map((id, i) => ({
    id,
    name: id,
    groupId: i < 3 ? "a" : "b",
    order: i,
    currency: i === 3 ? "JPY" : "CNY",
    type: "bank",
    icon: "Wallet",
    openingMinor: "10000",
    openingAt: "2026-01-01T00:00:00Z",
    archived: id === "old",
    netWorth: true,
  }));
  b.categories = [
    { id: "p", name: "P", kind: "expense", order: 0 },
    { id: "q", name: "Q", kind: "expense", order: 1 },
    { id: "c", name: "C", kind: "expense", parentId: "p", order: 0 },
    { id: "d", name: "D", kind: "expense", parentId: "p", order: 1 },
    { id: "income", name: "I", kind: "income", order: 0 },
  ].map((c) => ({ ...c, icon: "Tag", color: "#000", archived: false }));
  b.entries = [
    {
      id: "split",
      kind: "expense",
      accountId: "one",
      amountMinor: "12000",
      description: "咖啡",
      note: "出差收据",
      posted: true,
      occurredAt: "2026-10-01T16:30:00Z",
      splits: [
        { id: "s1", categoryId: "c", amountMinor: "2000", projectId: "trip" },
        { id: "s2", categoryId: "d", amountMinor: "10000" },
      ],
    },
    {
      id: "pending",
      kind: "expense",
      accountId: "two",
      amountMinor: "2000",
      description: "早餐",
      posted: false,
      occurredAt: "2026-09-30T16:00:00Z",
      splits: [{ id: "s3", categoryId: "c", amountMinor: "2000" }],
    },
    {
      id: "transfer",
      kind: "transfer",
      accountId: "one",
      toAccountId: "jpy",
      amountMinor: "10000",
      receivedMinor: "2000",
      description: "换汇",
      posted: true,
      occurredAt: "2026-09-30T10:00:00Z",
      receivedAt: "2026-10-02T10:00:00Z",
      splits: [],
    },
  ];
  return b;
}
test("cross-group moves normalize orders, accept an empty group, preserve IDs, balances and archived accounts", () => {
  const b = fixture(),
    entries = structuredClone(b.entries),
    before = balance(b, "one");
  moveAccount(b, "one", "b", "jpy");
  assert.equal(b.accounts.find((a) => a.id === "one").groupId, "b");
  assert.deepEqual(
    b.accounts
      .filter((a) => a.groupId === "b")
      .sort((a, b) => a.order - b.order)
      .map((a) => a.id),
    ["one", "jpy"],
  );
  moveAccount(b, "one", "empty");
  assert.equal(b.accounts.find((a) => a.id === "one").order, 0);
  assert.equal(b.accounts.find((a) => a.id === "old").archived, true);
  assert.equal(balance(b, "one"), before);
  assert.deepEqual(b.entries, entries);
  assert.throws(() => moveAccount(b, "one", "absent"));
  assert.throws(() => moveAccount(b, "one", "b", "two"));
});
test("category moves preserve child hierarchy and historical references, reject third level and changing income meaning", () => {
  const b = fixture();
  moveCategory(b, "p", undefined);
  assert.equal(b.categories.find((c) => c.id === "c").parentId, "p");
  moveCategory(b, "c", "q");
  assert.equal(b.categories.find((c) => c.id === "c").parentId, "q");
  assert.equal(b.entries[0].splits[0].categoryId, "c");
  assert.throws(() => moveCategory(b, "q", "p"));
  assert.throws(() => moveCategory(b, "d", "c"));
  assert.throws(() => moveCategory(b, "d", "income"));
});
test("combined filters OR within a field, AND between fields, search notes and match split intersection", () => {
  const b = fixture(),
    f = {
      ...emptyFilter(),
      accounts: ["one", "two"],
      kinds: ["expense", "refund"],
      categories: ["p"],
      projects: ["trip"],
      status: "posted",
    };
  assert.deepEqual(
    filterEntries(b, b.entries, f, "收据").map((e) => e.id),
    ["split"],
  );
  assert.equal(
    matchingSplits(b, b.entries[0], f).reduce(
      (n, s) => n + BigInt(s.amountMinor),
      0n,
    ),
    2000n,
  );
  assert.equal(
    filterEntries(b, b.entries, { ...f, categories: ["d"] }).length,
    0,
  );
  assert.deepEqual(
    filterEntries(b, b.entries, { ...emptyFilter(), status: "pending" }).map(
      (e) => e.id,
    ),
    ["pending"],
  );
  assert.deepEqual(
    filterEntries(b, b.entries, { ...emptyFilter(), projects: ["none"] }).map(
      (e) => e.id,
    ),
    ["split", "pending"],
  );
});
test("time ranges use book timezone and incoming transfer date; native-currency amounts never compare mixed units", () => {
  const b = fixture(),
    f = {
      ...emptyFilter(),
      period: "custom",
      from: "2026-10-02",
      to: "2026-10-02",
    };
  assert.deepEqual(
    filterEntries(b, b.entries, f, "", "jpy").map((e) => e.id),
    ["transfer"],
  );
  assert.deepEqual(
    filterEntries(b, b.entries, {
      ...emptyFilter(),
      currency: "JPY",
      min: "2000",
      max: "2000",
    }).map((e) => e.id),
    ["transfer"],
  );
  assert.equal(
    filterEntries(
      b,
      b.entries,
      { ...emptyFilter(), currency: "JPY", min: "10000" },
      "",
      "one",
    ).length,
    0,
  );
  assert.throws(() =>
    validateFilter({ ...emptyFilter(), min: "20" }, b.timeZone),
  );
  assert.throws(() =>
    validateFilter(
      { ...emptyFilter(), currency: "CNY", min: "30", max: "20" },
      b.timeZone,
    ),
  );
  const dates = filterDates(
    { ...emptyFilter(), period: "lastMonth" },
    b.timeZone,
    new Date("2026-10-29T00:00:00Z"),
  );
  assert.equal(dates.from, "2026-08-31T16:00:00Z");
  assert.equal(dates.to, "2026-09-30T15:59:59.999999999Z");
});

test("legacy credit account never collides with the credit group in drag identifiers, and ungrouped accounts remain valid", async () => {
  const { dragId } = await import("../src/domain/organization.ts");
  assert.notEqual(dragId("account", "credit"), dragId("group", "credit"));
  const b = fixture(),
    amount = balance(b, "one");
  moveAccount(b, "one", "");
  assert.equal(b.accounts.find((a) => a.id === "one").groupId, "");
  assert.equal(balance(b, "one"), amount);
  moveAccount(b, "one", "b");
  assert.equal(b.accounts.find((a) => a.id === "one").groupId, "b");
  moveCategory(b, "c", undefined, "p");
  assert.equal(b.categories.find((c) => c.id === "c").parentId, undefined);
  assert.equal(b.entries[0].splits[0].categoryId, "c");
});
