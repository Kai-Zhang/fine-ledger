import test from "node:test";
import assert from "node:assert/strict";
import {
  blankBook,
  balance,
  upsertEntry,
  changePosted,
  remainingRefund,
  removeEntry,
  restoreEntry,
  descriptions,
  rateFor,
  netWorth,
  categoryStats,
} from "../src/domain/ledger.ts";
import { minor, money, roundedRatio } from "../src/domain/money.ts";
import { dateToISO, localInput, sortEntries } from "../src/domain/dates.ts";
const time = (n) => `2026-01-${String(n).padStart(2, "0")}T12:00:00.000Z`;
function fixture() {
  const b = blankBook();
  b.createdAt = time(1);
  b.accounts = ["cny", "jpy", "usd"].map((id, i) => ({
    id,
    name: id,
    groupId: "daily",
    type: "bank",
    currency: ["CNY", "JPY", "USD"][i],
    openingMinor: i ? "0" : "100000",
    openingAt: time(1),
    icon: "Wallet",
    order: i,
    archived: false,
    netWorth: true,
  }));
  return b;
}
function entry(id, overrides = {}) {
  return {
    id,
    kind: "expense",
    accountId: "cny",
    amountMinor: "100",
    description: "午餐",
    occurredAt: time(2),
    createdAt: time(2),
    updatedAt: time(2),
    posted: true,
    splits: [{ id: id + "-s", categoryId: "food-0", amountMinor: "100" }],
    revision: 0,
    ...overrides,
  };
}
function transfer(id, day, cny, jpy) {
  return entry(id, {
    kind: "transfer",
    occurredAt: time(day),
    amountMinor: cny,
    toAccountId: "jpy",
    receivedMinor: jpy,
    splits: [],
  });
}
test("money uses exact integers beyond Number safe range and respects currency decimals", () => {
  assert.equal(minor("90071992547409.93", "CNY"), "9007199254740993");
  assert.equal(money("9007199254740993", "CNY"), "90,071,992,547,409.93");
  assert.throws(() => minor("1.2", "JPY"));
  assert.equal(roundedRatio(-101n, 1n, 2n), -51n);
});
test("required descriptions and categories, exact split sums and positive split values", () => {
  const b = fixture();
  assert.throws(() => upsertEntry(b, entry("x", { description: "" })), /描述/);
  assert.throws(() => upsertEntry(b, entry("x", { splits: [] })), /类目/);
  assert.throws(
    () =>
      upsertEntry(
        b,
        entry("x", {
          splits: [{ id: "1", categoryId: "food-0", amountMinor: "99" }],
        }),
      ),
    /合计/,
  );
  const e = entry("x", {
    splits: [
      { id: "1", categoryId: "food-0", amountMinor: "60" },
      { id: "2", categoryId: "food-1", amountMinor: "40" },
    ],
  });
  upsertEntry(b, e);
  assert.equal(balance(b, "cny"), 99900n);
});
test("posting transfers changes both balances together, pending excluded", () => {
  const b = fixture();
  upsertEntry(b, transfer("fx", 2, "10000", "2000"));
  assert.equal(balance(b, "cny"), 90000n);
  assert.equal(balance(b, "jpy"), 2000n);
  changePosted(b, "fx");
  assert.equal(balance(b, "cny"), 100000n);
  assert.equal(balance(b, "jpy"), 0n);
  assert.equal(rateFor(b, "jpy", time(2)), null);
});
test("interval exchange rates use next transfer, first before first, and provisional latest tail", () => {
  const b = fixture();
  upsertEntry(b, transfer("A", 5, "10000", "2000"));
  upsertEntry(b, transfer("B", 15, "20000", "5000"));
  assert.equal(netWorth(b, time(4), ["jpy"]).total, 0n);
  assert.deepEqual(rateFor(b, "jpy", time(4)), {
    n: 10000n,
    d: 2000n,
    provisional: false,
  });
  assert.equal(netWorth(b, time(10), ["jpy"]).total, 8000n);
  assert.equal(netWorth(b, time(15), ["jpy"]).total, 28000n);
  assert.equal(netWorth(b, time(20), ["jpy"]).provisional, true);
  upsertEntry(b, transfer("C", 25, "9000", "3000"));
  assert.equal(netWorth(b, time(20), ["jpy"]).total, 21000n);
  assert.equal(netWorth(b, time(20), ["jpy"]).provisional, false);
  removeEntry(b, "C");
  assert.equal(netWorth(b, time(20), ["jpy"]).total, 28000n);
});
test("missing rate preserves native balances and identifies incomplete total", () => {
  const b = fixture();
  b.accounts[2].openingMinor = "1000";
  const n = netWorth(b, time(2));
  assert.equal(n.total, 100000n);
  assert.equal(n.missing.length, 1);
  assert.equal(n.missing[0].amount, 1000n);
});
test("archived accounts cannot receive new records but old records remain editable", () => {
  const b = fixture();
  upsertEntry(b, entry("old"));
  b.accounts[0].archived = true;
  assert.throws(() => upsertEntry(b, entry("new")), /归档/);
  const old = { ...b.entries[0], description: "午餐修正" };
  upsertEntry(b, old);
  assert.equal(b.entries[0].description, "午餐修正");
  assert.throws(() => upsertEntry(b, old), /其他页面/);
  assert.equal(netWorth(b, time(3)).total, 99900n);
});
test("refund caps, independent original deletion/restoration and historical links", () => {
  const b = fixture();
  upsertEntry(b, entry("purchase"));
  upsertEntry(
    b,
    entry("refund", {
      kind: "refund",
      originalId: "purchase",
      amountMinor: "40",
      splits: [{ id: "r", categoryId: "food-0", amountMinor: "40" }],
    }),
  );
  assert.equal(remainingRefund(b, "purchase"), 60n);
  assert.throws(
    () =>
      upsertEntry(
        b,
        entry("too-much", {
          kind: "refund",
          originalId: "purchase",
          amountMinor: "70",
          splits: [{ id: "r", categoryId: "food-0", amountMinor: "70" }],
        }),
      ),
    /可退金额/,
  );
  removeEntry(b, "purchase");
  assert.equal(balance(b, "cny"), 100040n);
  assert.equal(b.entries[1].originalId, "purchase");
  restoreEntry(b, "purchase");
  assert.equal(balance(b, "cny"), 99940n);
});
test("category aggregation counts only selected split amounts, pending excluded, refunds net negative", () => {
  const b = fixture();
  upsertEntry(
    b,
    entry("split", {
      amountMinor: "200",
      splits: [
        { id: "1", categoryId: "food-0", amountMinor: "150" },
        { id: "2", categoryId: "shopping-0", amountMinor: "50" },
      ],
    }),
  );
  upsertEntry(b, entry("pending", { posted: false }));
  upsertEntry(
    b,
    entry("refund", {
      kind: "refund",
      amountMinor: "200",
      splits: [{ id: "r", categoryId: "food-0", amountMinor: "200" }],
    }),
  );
  const stats = categoryStats(b, time(1), time(3), ["cny"], ["food"]);
  assert.equal(stats.expense, 150n);
  assert.equal(stats.refund, 200n);
  assert.equal(stats.net, -50n);
  assert.equal(stats.rows.length, 2);
  assert.equal(stats.values.get("food-0"), -50n);
});
test("description substring results rank prefix first and preserve recent unique descriptions", () => {
  const b = fixture();
  b.entries = [
    entry("a", { description: "星巴克咖啡", updatedAt: time(3) }),
    entry("b", { description: "咖啡豆", updatedAt: time(2) }),
    entry("c", { description: "咖啡豆", updatedAt: time(1) }),
  ];
  assert.deepEqual(
    descriptions(b, "expense", "咖啡").map((e) => e.description),
    ["咖啡豆", "星巴克咖啡"],
  );
});
test("editing unrelated fields preserves imported fractional seconds, full timestamp ordering stable", () => {
  const original = "2026-01-02T12:34:23.456789Z";
  assert.equal(dateToISO(localInput(original), original), original);
  assert.equal(
    sortEntries([
      { id: "a", occurredAt: time(2) },
      { id: "b", occurredAt: time(2) },
    ])[0].id,
    "b",
  );
});
test("full fractional timestamps determine balances and ordering even with different precision or time zones", () => {
  const b = fixture();
  const first = entry("first", { occurredAt: "2026-01-02T12:00:00.456Z" }),
    second = entry("second", {
      occurredAt: "2026-01-02T20:00:00.456789+08:00",
    });
  upsertEntry(b, first);
  upsertEntry(b, second);
  assert.equal(balance(b, "cny", "2026-01-02T12:00:00.456500Z"), 99900n);
  assert.deepEqual(
    sortEntries(b.entries).map((e) => e.id),
    ["second", "first"],
  );
});
test("transfers through a same-currency foreign account carry the base-cost source and cycles remain unknown", () => {
  const b = fixture();
  b.accounts.push({ ...b.accounts[1], id: "jpy-card", openingMinor: "-1000" });
  upsertEntry(b, transfer("source", 2, "10000", "2000"));
  upsertEntry(
    b,
    entry("repay", {
      kind: "transfer",
      accountId: "jpy",
      toAccountId: "jpy-card",
      amountMinor: "1000",
      receivedMinor: "1000",
      splits: [],
    }),
  );
  assert.equal(netWorth(b, time(3), ["jpy-card"]).total, 0n);
  assert.notEqual(rateFor(b, "jpy-card", time(3)), null);
  removeEntry(b, "source");
  assert.equal(rateFor(b, "jpy-card", time(3)), null);
});
test("book timezone determines business dates and DST report boundaries, while source instant stays unchanged", async () => {
  const { localDate, endOfDay, startOfDay } =
    await import("../src/domain/dates.ts");
  assert.equal(
    localDate("2026-01-01T18:00:00Z", "Asia/Shanghai"),
    "2026-01-02",
  );
  assert.equal(
    localDate("2026-01-01T18:00:00Z", "America/Los_Angeles"),
    "2026-01-01",
  );
  assert.equal(
    dateToISO("2026-01-02T02:00:27", undefined, "Asia/Shanghai"),
    "2026-01-01T18:00:27.000Z",
  );
  assert.equal(
    startOfDay("2026-03-08", "America/New_York"),
    "2026-03-08T05:00:00Z",
  );
  assert.equal(
    endOfDay("2026-03-08", "America/New_York"),
    "2026-03-09T03:59:59.999999999Z",
  );
  assert.throws(
    () => dateToISO("2026-03-08T02:30:00", undefined, "America/New_York"),
    /夏令时/,
  );
});
test("archived categories and projects preserve old edits and linked refund attribution but reject fresh use", () => {
  const b = fixture();
  b.projects = [{ id: "trip", name: "旅行", archived: false }];
  const purchase = entry("purchase", {
    splits: [
      { id: "s", categoryId: "food-0", projectId: "trip", amountMinor: "100" },
    ],
  });
  upsertEntry(b, purchase);
  b.categories.find((c) => c.id === "food-0").archived = true;
  b.projects[0].archived = true;
  assert.throws(() => upsertEntry(b, entry("new")), /类目已归档/);
  upsertEntry(b, { ...b.entries[0], description: "旧消费修正" });
  upsertEntry(
    b,
    entry("refund", {
      kind: "refund",
      originalId: "purchase",
      splits: [
        {
          id: "r",
          categoryId: "food-0",
          projectId: "trip",
          amountMinor: "100",
        },
      ],
    }),
  );
  assert.equal(balance(b, "cny"), 100000n);
});

test("empty group deletion preserves accounts and entries and rejects groups containing archived accounts", async () => {
  const { removeEmptyGroup } = await import("../src/domain/ledger.ts");
  const b = fixture(),
    accounts = structuredClone(b.accounts),
    entries = structuredClone(b.entries);
  removeEmptyGroup(b, "investment");
  assert(!b.groups.some((g) => g.id === "investment"));
  assert.deepEqual(b.accounts, accounts);
  assert.deepEqual(b.entries, entries);
  b.accounts[0].archived = true;
  assert.throws(() => removeEmptyGroup(b, "daily"), /已归档/);
  assert(b.groups.some((g) => g.id === "daily"));
});

test("legacy category icons have meaningful mappings and preserve explicitly edited icons", async () => {
  const { compatibleCategoryIcon, repairLegacyCategoryIcons } =
    await import("../src/domain/category-icons.ts");
  assert.equal(compatibleCategoryIcon({ id: "food", icon: "cup" }), "Utensils");
  assert.equal(
    compatibleCategoryIcon({ id: "coffee", icon: "Tag" }, "food"),
    "Coffee",
  );
  assert.equal(
    compatibleCategoryIcon({ id: "metro" }, "transport"),
    "TrainFront",
  );
  const b = blankBook();
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
  assert.equal(repairLegacyCategoryIcons(b, legacy, new Set(["meal"])), 2);
  assert.equal(b.categories[0].icon, "Utensils");
  assert.equal(b.categories[1].icon, "Coffee");
  assert.equal(b.categories[2].icon, "Tag");
});
