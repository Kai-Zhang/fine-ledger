import test from "node:test";
import assert from "node:assert/strict";
import {
  allocateSplits,
  descriptionSplits,
} from "../src/domain/split-allocation.ts";
import { resistedOffset, completesSwipe } from "../src/navigation/motion.ts";
import {
  effectiveTimeZone,
  dateToISO,
  localInput,
  startOfDay,
  endOfDay,
  localDate,
} from "../src/domain/dates.ts";
import { blankBook } from "../src/domain/ledger.ts";
const rows = (...amounts) =>
  amounts.map((v, i) => ({ id: String(i), amountMinor: String(v) }));
test("allocation shares exact minor units with stable remainders, including zero-decimal currencies", () => {
  assert.deepEqual(allocateSplits(10001n, rows(0, 0, 0)), [
    "3334",
    "3334",
    "3333",
  ]);
  assert.deepEqual(allocateSplits(101n, rows(0, 0)), ["51", "50"]);
  const result = allocateSplits(9007199254740993n, rows(0, 0, 0));
  assert.equal(
    result.reduce((s, v) => s + BigInt(v), 0n),
    9007199254740993n,
  );
});
test("locks survive adding/removing rows and total changes; editing a free amount only fixes it for that allocation", () => {
  const list = rows(3000, 1000, 1000);
  list[0].locked = true;
  assert.deepEqual(allocateSplits(10000n, list), ["3000", "3500", "3500"]);
  list.push({ id: "3", amountMinor: "0" });
  assert.deepEqual(allocateSplits(10000n, list), [
    "3000",
    "2334",
    "2333",
    "2333",
  ]);
  list[1].amountMinor = "4000";
  assert.deepEqual(allocateSplits(10000n, list, "1"), [
    "3000",
    "4000",
    "1500",
    "1500",
  ]);
  assert.deepEqual(allocateSplits(12000n, list), [
    "3000",
    "3000",
    "3000",
    "3000",
  ]);
  assert.deepEqual(allocateSplits(10000n, list.slice(0, 3)), [
    "3000",
    "3500",
    "3500",
  ]);
  assert.throws(() => allocateSplits(2000n, list), /超过总金额/);
  assert.throws(
    () =>
      allocateSplits(10000n, [{ id: "a", amountMinor: "3000", locked: true }]),
    /解除锁定/,
  );
  assert.throws(() => allocateSplits(10000n, rows(-1, 1)), /不能为负数/);
});
test("root gestures visibly resist and never navigate; distance and quick partial flicks commit nested gestures", () => {
  assert.equal(resistedOffset(0), 0);
  assert.ok(resistedOffset(30) > 0 && resistedOffset(30) < 30);
  assert.ok(resistedOffset(200) > resistedOffset(30));
  assert.ok(resistedOffset(400) <= 26);
  assert.equal(resistedOffset(-200), -resistedOffset(200));
  assert.equal(completesSwipe(350, 2, 390, true), false);
  assert.equal(completesSwipe(120, 0.1, 390), true);
  assert.equal(completesSwipe(-70, 0.8, 390), true);
  assert.equal(completesSwipe(30, 3, 390), false);
  assert.equal(completesSwipe(70, 0.1, 390), false);
});
test("system time zone drives input, display and report dates without rewriting UTC instants; fixed override remains available", () => {
  const b = blankBook();
  b.timeZone = "Asia/Shanghai";
  const at = dateToISO("2026-10-30T23:30:05", undefined, "Asia/Shanghai");
  assert.equal(at, "2026-10-30T15:30:05.000Z");
  const zone = effectiveTimeZone(b, "Asia/Tokyo");
  assert.equal(localInput(at, zone), "2026-10-31T00:30:05");
  assert.equal(localDate(at, zone), "2026-10-31");
  assert.ok(
    Date.parse(at) < Date.parse(startOfDay("2026-10-31", "Asia/Shanghai")),
  );
  assert.ok(Date.parse(at) >= Date.parse(startOfDay("2026-10-31", zone)));
  assert.ok(Date.parse(at) <= Date.parse(endOfDay("2026-10-31", zone)));
  assert.equal(dateToISO(localInput(at, zone), at, zone), at);
  b.settings.timeZoneMode = "fixed";
  assert.equal(effectiveTimeZone(b, "Asia/Tokyo"), "Asia/Shanghai");
  delete b.settings.timeZoneMode;
  assert.equal(effectiveTimeZone(b, "Asia/Tokyo"), "Asia/Tokyo");
});

test("description templates keep every category in order, evenly divide the current amount and isolate historical data", () => {
  const book = blankBook();
  const source = {
    kind: "expense",
    splits: [
      {
        id: "old-a",
        categoryId: "food-0",
        amountMinor: "1000",
        projectId: "old-trip",
        note: "historical note",
      },
      { id: "old-b", categoryId: "shopping-0", amountMinor: "9000" },
    ],
  };
  const before = structuredClone(source);
  const result = descriptionSplits(book, source, 10001n);
  assert.deepEqual(
    result.map((s) => s.categoryId),
    ["food-0", "shopping-0"],
  );
  assert.deepEqual(
    result.map((s) => s.amountMinor),
    ["5001", "5000"],
  );
  assert.ok(
    result.every(
      (s) =>
        !s.locked &&
        !s.projectId &&
        !s.note &&
        !source.splits.some((old) => old.id === s.id),
    ),
  );
  assert.equal(new Set(result.map((s) => s.id)).size, 2);
  assert.deepEqual(source, before);
  const empty = descriptionSplits(book, source, 0n);
  assert.deepEqual(
    empty.map((s) => s.amountMinor),
    ["0", "0"],
  );
  assert.deepEqual(allocateSplits(12600n, empty), ["6300", "6300"]);
  const single = descriptionSplits(
    book,
    { kind: "expense", splits: [source.splits[1]] },
    100n,
  );
  assert.equal(single.length, 1);
  assert.equal(single[0].categoryId, "shopping-0");
  assert.equal(single[0].amountMinor, "100");
  book.categories.find((c) => c.id === "food-0").archived = true;
  assert.deepEqual(
    descriptionSplits(book, source, 100n).map((s) => s.categoryId),
    ["", "shopping-0"],
  );
});
