import test from "node:test";
import assert from "node:assert/strict";
import {
  readServiceView,
  saveServiceView,
  clearServiceView,
} from "../src/sync/service-cache.ts";
import {
  rowSwipeIntent,
  rowSwipeOffset,
  rowSwipeOpen,
  rowSwipeStart,
} from "../src/navigation/row-swipe.ts";
test("service views survive navigation without sharing mutable settings or crossing origins; logout drops the view", () => {
  const origin = "https://ledger.test",
    view = {
      auth: { deviceId: "a" },
      settings: { serviceName: "Saved" },
      backups: [{ id: "one" }],
      devices: [],
    };
  saveServiceView(origin, view);
  view.settings.serviceName = "modified source";
  const first = readServiceView(origin);
  assert.equal(first.settings.serviceName, "Saved");
  first.settings.serviceName = "unsaved form";
  first.backups.pop();
  assert.equal(readServiceView(origin).settings.serviceName, "Saved");
  assert.equal(readServiceView(origin).backups.length, 1);
  assert.equal(readServiceView("https://other.test"), undefined);
  clearServiceView(origin);
  assert.equal(readServiceView(origin), undefined);
});
test("row swipes yield vertical scrolling and page edges, clamp to an exposed action, and allow closing", () => {
  assert.equal(rowSwipeStart(24, 390), false);
  assert.equal(rowSwipeStart(36, 390), false);
  assert.equal(rowSwipeStart(44, 390), false);
  assert.equal(rowSwipeStart(45, 390), true);
  assert.equal(rowSwipeStart(366, 390), false);
  assert.equal(rowSwipeStart(260, 390), true);
  assert.equal(rowSwipeIntent(-3, 2), "pending");
  assert.equal(rowSwipeIntent(-9, 25), "vertical");
  assert.equal(rowSwipeIntent(-30, 8), "horizontal");
  assert.equal(rowSwipeOffset(0, -500), -80);
  assert.equal(rowSwipeOffset(0, 80), 0);
  assert.equal(rowSwipeOpen(rowSwipeOffset(0, -55)), true);
  assert.equal(rowSwipeOpen(rowSwipeOffset(0, -20)), false);
  assert.equal(rowSwipeOpen(rowSwipeOffset(-80, 60)), false);
});
