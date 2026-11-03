import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  blankBook,
  balance,
  upsertEntry,
  removeEntry,
  restoreEntry,
  remainingRefund,
  refundTotals,
  refundOriginalId,
  rateFor,
} from "../src/domain/ledger.ts";
import { validateBook, PROTOCOL } from "../src/sync/protocol.ts";
import { Store } from "../server/store.ts";
import { loadConfig } from "../server/config.ts";

function fixture() {
  const b = blankBook(),
    at = "2026-01-01T00:00:00.000000Z";
  b.accounts = ["CNY", "JPY"].map((currency, i) => ({
    id: currency,
    name: currency,
    currency,
    groupId: "daily",
    type: "bank",
    openingMinor: "0",
    openingAt: at,
    icon: "Wallet",
    order: i,
    archived: false,
    netWorth: true,
  }));
  const row = (id, kind, currency, amount, reference) => ({
    id,
    kind,
    accountId: currency,
    amountMinor: amount,
    description: "Synthetic history",
    occurredAt: at,
    createdAt: at,
    updatedAt: at,
    posted: true,
    revision: 0,
    splits: [{ id: id + "-split", categoryId: "food-0", amountMinor: amount }],
    ...(reference
      ? {
          refundReference: {
            source: "moneywiz",
            originalId: reference,
            reason: reference === "foreign" ? "cross-currency" : "over-limit",
          },
        }
      : {}),
  });
  b.entries = [
    row("loan", "expense", "CNY", "500000"),
    row("repayment-one", "refund", "CNY", "251500", "loan"),
    row("repayment-two", "refund", "CNY", "253000", "loan"),
    row("foreign", "expense", "JPY", "5280"),
    row("foreign-return", "refund", "CNY", "26000", "foreign"),
  ];
  return b;
}

test("source refund references preserve excess and cross-currency history without changing money or inventing FX", () => {
  const b = fixture();
  validateBook(b);
  assert.equal(balance(b, "CNY"), 30500n);
  assert.equal(balance(b, "JPY"), -5280n);
  assert.equal(rateFor(b, "JPY", "9999"), null);
  assert.equal(refundOriginalId(b.entries[4]), "foreign");
  assert.equal(remainingRefund(b, "loan"), -4500n);
  assert.equal(remainingRefund(b, "foreign"), null);
  assert.deepEqual(refundTotals(b, "foreign"), [
    { currency: "CNY", amountMinor: "26000" },
  ]);
  const after = structuredClone(b);
  upsertEntry(after, {
    ...after.entries[1],
    description: "Edited description",
  });
  validateBook(after, b);
  assert.equal(balance(after, "CNY"), balance(b, "CNY"));
  removeEntry(after, "loan", true);
  assert(after.entries.slice(0, 3).every((e) => e.deletedAt));
  assert.equal(after.entries[4].deletedAt, undefined);
  for (const id of ["loan", "repayment-one", "repayment-two"])
    restoreEntry(after, id);
  validateBook(after, b);
  assert.equal(balance(after, "CNY"), balance(b, "CNY"));
});

test("ordinary refunds support excess and foreign currency, and legacy references can be edited into normal links", () => {
  const b = fixture(),
    candidate = structuredClone(b);
  const normal = {
    ...b.entries[1],
    id: "normal",
    accountId: "JPY",
    amountMinor: "1000000",
    originalId: "loan",
    refundReference: undefined,
    splits: [{ id: "new-split", categoryId: "food-0", amountMinor: "1000000" }],
  };
  upsertEntry(candidate, normal);
  validateBook(candidate, b);
  assert.equal(balance(candidate, "JPY"), 994720n);
  assert.equal(remainingRefund(candidate, "loan"), null);
  const old = candidate.entries.find((e) => e.id === "repayment-one");
  upsertEntry(candidate, {
    ...old,
    originalId: old.refundReference.originalId,
    refundReference: undefined,
  });
  validateBook(candidate, b);
  const orphan = structuredClone(b);
  orphan.entries = orphan.entries.filter((e) => e.id !== "loan");
  assert.throws(() => validateBook(orphan), /原记录不存在/);
});

test("a normal single-ledger server stores imported references, supports new excess refunds, and rejects a second ledger", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "refund-reference-"));
  const store = new Store(loadConfig({ FINE_LEDGER_DATA_DIR: dir }));
  t.after(async () => {
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  store.initialize(fixture(), crypto.randomUUID(), store.epoch, "test-device");
  const snapshot = store.snapshot();
  assert.equal(
    snapshot.book.entries.filter((e) => e.refundReference).length,
    3,
  );
  const current = snapshot.book.entries.find((e) => e.id === "repayment-one");
  const push = (entry) => {
    const snap = store.snapshot();
    return store.push(
      {
        protocol: PROTOCOL,
        operationId: crypto.randomUUID(),
        ledgerId: snap.book.id,
        serverEpoch: store.epoch,
        dependsOn: [],
        expected: [
          ...snap.versions,
          ...(!snap.book.entries.some((e) => e.id === entry.id)
            ? [{ collection: "entries", id: entry.id, version: 0 }]
            : []),
        ],
        changes: [{ collection: "entries", id: entry.id, value: entry }],
      },
      "test-device",
    );
  };
  assert.equal(
    push({ ...current, description: "Edited on another device" }).status,
    "committed",
  );
  assert.equal(
    push({
      ...current,
      id: "new-refund",
      originalId: "loan",
      refundReference: undefined,
    }).status,
    "committed",
  );
  assert.equal(store.book().entries.length, 6);
  assert.deepEqual(
    store.book().entries.find((e) => e.id === current.id).refundReference,
    current.refundReference,
  );
  assert.throws(
    () =>
      store.initialize(
        blankBook(),
        crypto.randomUUID(),
        store.epoch,
        "test-device",
      ),
    /已有账本/,
  );
});
