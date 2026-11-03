import test from "node:test";
import assert from "node:assert/strict";
import {
  blankBook,
  balance,
  upsertEntry,
  changePosted,
  entryCurrency,
  categoryStats,
  removeEntry,
  restoreEntry,
} from "../src/domain/ledger.ts";
import {
  postingPreview,
  confirmPosting,
  proportionalAmounts,
} from "../src/domain/posting.ts";
import { validateBook } from "../src/sync/protocol.ts";
import { filterEntries, emptyFilter } from "../src/domain/filters.ts";
import { encodeBackup, decodeBackup } from "../src/storage/archive.ts";
function fixture() {
  const b = blankBook();
  b.timeZone = "UTC";
  b.accounts = [
    {
      id: "card",
      name: "信用卡",
      currency: "CNY",
      groupId: "credit",
      type: "credit",
      openingMinor: "0",
      openingAt: "2020-01-01T00:00:00Z",
      icon: "CreditCard",
      order: 0,
      archived: false,
      netWorth: true,
    },
  ];
  const at = "2026-10-15T01:02:03.123456Z";
  const e = {
    id: "purchase",
    kind: "expense",
    accountId: "card",
    amountMinor: "10000",
    amountCurrency: "JPY",
    originalAmount: { currency: "JPY", amountMinor: "10000" },
    description: "合成酒店",
    occurredAt: at,
    posted: false,
    splits: [
      { id: "s1", categoryId: "food-0", amountMinor: "3333" },
      { id: "s2", categoryId: "food-1", amountMinor: "6667" },
    ],
    createdAt: at,
    updatedAt: at,
    revision: 0,
  };
  upsertEntry(b, e);
  return { b, e: b.entries[0] };
}
test("foreign-only pending has no fabricated account amount, is excluded from totals and filters in its entered currency", () => {
  const { b, e } = fixture();
  validateBook(b);
  assert.equal(b.schema, 4);
  assert.equal(balance(b, "card"), 0n);
  assert.equal(
    categoryStats(
      b,
      "2026-01-01T00:00:00Z",
      "2027-01-01T00:00:00Z",
      ["card"],
      [],
    ).net,
    0n,
  );
  assert.equal(
    filterEntries(b, b.entries, {
      ...emptyFilter(),
      currency: "JPY",
      min: "10000",
      max: "10000",
    }).length,
    1,
  );
  assert.equal(
    filterEntries(b, b.entries, { ...emptyFilter(), currency: "CNY" }).length,
    0,
  );
  assert.throws(() => changePosted(b, e.id), /确认/);
  assert.equal(e.posted, false);
  const malformed = structuredClone(b);
  malformed.entries[0].posted = true;
  assert.throws(() => validateBook(malformed), /入账/);
});
test("one confirmation preserves identity, source currency and microseconds, proportionally allocating exact account cents once", () => {
  const { b, e } = fixture();
  const preview = postingPreview(b, e, "49001");
  assert.deepEqual(
    preview.splits.map((s) => s.amountMinor),
    ["16332", "32669"],
  );
  confirmPosting(b, e, "49001");
  validateBook(b);
  const saved = b.entries[0];
  assert.equal(b.entries.length, 1);
  assert.equal(saved.id, e.id);
  assert.equal(saved.occurredAt, e.occurredAt);
  assert.deepEqual(saved.originalAmount, e.originalAmount);
  assert.equal(entryCurrency(b, saved), "CNY");
  assert.equal(balance(b, "card"), -49001n);
  assert.throws(() => confirmPosting(b, e, "50000"), /更新/);
  assert.equal(balance(b, "card"), -49001n);
  removeEntry(b, e.id);
  assert.equal(balance(b, "card"), 0n);
  restoreEntry(b, e.id);
  assert.equal(balance(b, "card"), -49001n);
});
test("split preview allows a zero-cent proposal, but confirmation requires positive splits with exact sum and preserves state on rejection", () => {
  const { b, e } = fixture();
  assert.throws(() => confirmPosting(b, e, "1"), /类目/);
  assert.equal(b.entries[0].posted, false);
  assert.throws(() => confirmPosting(b, e, "100", ["1", "98"]), /合计/);
  assert.equal(b.entries[0].amountMinor, "10000");
  confirmPosting(b, e, "100", ["40", "60"]);
  assert.equal(balance(b, "card"), -100n);
});
test("largest remainders are exact beyond safe integers and stable on ties", () => {
  assert.deepEqual(proportionalAmounts(5n, ["1", "1", "1"]), ["2", "2", "1"]);
  const total = 900719925474099312345n;
  assert.equal(
    proportionalAmounts(total, ["123", "456", "789"]).reduce(
      (n, x) => n + BigInt(x),
      0n,
    ),
    total,
  );
});
test("pending edits preserve state, accept unknown estimate and reject mismatched original facts", () => {
  const { b, e } = fixture();
  upsertEntry(b, { ...e, description: "改描述", estimatedMinor: "48000" });
  assert.equal(b.entries[0].posted, false);
  assert.throws(
    () =>
      upsertEntry(b, {
        ...b.entries[0],
        originalAmount: { currency: "USD", amountMinor: "10000" },
      }),
    /不一致/,
  );
});
test("ZIP roundtrip preserves foreign-only and confirmed records, credit limits and fee references; schema 3 remains accepted", async () => {
  const { b, e } = fixture();
  b.accounts[0].creditLimitMinor = "3000000";
  validateBook(b);
  const decoded = await decodeBackup(
    await encodeBackup({
      format: "fine-ledger-backup",
      version: 3,
      book: b,
      operations: [],
      revisions: [],
    }),
  );
  assert.deepEqual(decoded.book, b);
  const previous = structuredClone(b);
  const downgrade = structuredClone(b);
  downgrade.schema = 3;
  assert.throws(() => validateBook(downgrade, previous), /降级/);
  const legacy = blankBook();
  validateBook(legacy);
  assert.equal(legacy.schema, 3);
});
test("fee references need a real transfer and archived destination rules stay intact", () => {
  const { b } = fixture();
  b.accounts.push({
    ...b.accounts[0],
    id: "bank",
    type: "bank",
    name: "储蓄卡",
  });
  const t = {
    ...b.entries[0],
    id: "transfer",
    kind: "transfer",
    accountId: "bank",
    toAccountId: "card",
    amountMinor: "10000",
    receivedMinor: "10000",
    amountCurrency: undefined,
    originalAmount: undefined,
    posted: true,
    splits: [],
    revision: 0,
  };
  upsertEntry(b, t);
  const fee = {
    ...b.entries[0],
    id: "fee",
    kind: "expense",
    accountId: "bank",
    amountMinor: "100",
    amountCurrency: undefined,
    originalAmount: undefined,
    posted: true,
    transferId: t.id,
    splits: [{ id: "f", categoryId: "food-0", amountMinor: "100" }],
    revision: 0,
  };
  upsertEntry(b, fee);
  validateBook(b);
  assert.equal(balance(b, "bank"), -10100n);
  assert.equal(balance(b, "card"), 10000n);
  assert.throws(
    () => upsertEntry(b, { ...fee, id: "bad", transferId: "purchase" }),
    /关联转账/,
  );
  const invalid = structuredClone(b);
  invalid.accounts[0].creditLimitMinor = "-1";
  assert.throws(() => validateBook(invalid), /额度/);
});

test('account views retain foreign pending rows unless an amount range requires the locked account currency',()=>{
 const {b,e}=fixture();const f={...emptyFilter(),currency:'CNY'};
 assert.deepEqual(filterEntries(b,b.entries,f,'','card').map(x=>x.id),[e.id]);
 assert.deepEqual(filterEntries(b,b.entries,{...f,status:'pending'},'','card').map(x=>x.id),[e.id]);
 assert.equal(filterEntries(b,b.entries,{...f,min:'1'},'','card').length,0);
 assert.equal(filterEntries(b,b.entries,{...f,max:'500'},'','card').length,0);
 assert.equal(filterEntries(b,b.entries,f).length,0); // Explicit global currency filter remains effective.
});
