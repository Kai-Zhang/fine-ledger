import test from "node:test";
import assert from "node:assert/strict";
import {
  initialNavigation,
  currentFrame,
  navigate,
} from "../src/navigation/stack.ts";
const open = (n, route) => navigate(n, { type: "open", route });
const back = (n) => navigate(n, { type: "back" }),
  forward = (n) => navigate(n, { type: "forward" });
test("tabs keep independent logical stacks; roots never back into duplicate home pages", () => {
  let n = initialNavigation();
  assert.equal(back(n), n);
  n = open(n, { page: "account", id: "bank" });
  const key = currentFrame(n).key;
  n = open(n, { page: "settings" });
  n = open(n, { page: "categories" });
  assert.equal(currentFrame(back(n)).route.page, "settings");
  n = back(n);
  assert.equal(back(n), n);
  n = open(n, { page: "accounts" });
  assert.equal(currentFrame(n).key, key);
  n = open(n, { page: "accounts" });
  assert.equal(currentFrame(n).route.page, "accounts");
  assert.equal(back(n), n);
  n = forward(n);
  assert.equal(currentFrame(n).key, key);
});
test("back/forward preserves frame identity, new branches clear only their own future", () => {
  let n = open(open(initialNavigation(), { page: "settings" }), {
    page: "categories",
  });
  const category = currentFrame(n);
  n = back(n);
  assert.deepEqual(currentFrame(forward(n)), category);
  n = open(n, { page: "projects" });
  assert.equal(forward(n), n);
  n = back(n);
  n = open(n, { page: "reports" });
  n = open(n, { page: "report", report: "expense" });
  assert.equal(currentFrame(back(n)).route.page, "reports");
  n = open(n, { page: "settings" });
  assert.equal(currentFrame(n).route.page, "settings");
  assert.equal(currentFrame(forward(n)).route.page, "projects");
});
test("account shortcut report and nested drilldown return to their actual source", () => {
  let n = open(initialNavigation(), { page: "report", report: "net" });
  n = open(n, {
    page: "transactions",
    postedOnly: true,
    reportKind: "net",
    accountIds: ["bank"],
  });
  n = open(n, { page: "detail", id: "one" });
  n = open(n, { page: "entry", id: "one" });
  for (const page of ["detail", "transactions", "report", "accounts"]) {
    n = back(n);
    assert.equal(currentFrame(n).route.page, page);
  }
  assert.equal(back(n), n);
});
