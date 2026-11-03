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

test("edge capture leaves vertical scroll alone and cancels only claimed moves", async () => {
  const { captureEdges } = await import("../src/navigation/edge-capture.ts");
  const doc = new EventTarget();
  let started = 0,
    ends = [];
  const cleanup = captureEdges(doc, () => 390, {
    start: () => ++started !== 3,
    move: (x, y) => x > 25 && y === 150,
    end: (cancel) => ends.push(cancel),
  });
  const fire = (type, x, y = 150, touches = 1, cancelable = true) => {
    const event = new Event(type, { cancelable });
    Object.defineProperty(event, "touches", {
      value: Array.from({ length: touches }, () => ({
        clientX: x,
        clientY: y,
      })),
    });
    doc.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(fire("touchstart", 200), false);
  assert.equal(fire("touchstart", 3, 150, 2), false);
  assert.equal(started, 0);
  assert.equal(fire("touchstart", 5), false);
  assert.equal(fire("touchmove", 5, 220), false);
  assert.equal(fire("touchmove", 5, 245, 1, false), false);
  assert.deepEqual(ends, [true]);
  assert.equal(fire("touchstart", 5), false);
  assert.equal(fire("touchmove", 8), false);
  assert.equal(fire("touchmove", 160), true);
  fire("touchend", 160);
  assert.deepEqual(ends, [true, false]);
  fire("touchstart", 5); // blocked by app
  assert.equal(fire("touchmove", 160), false);
  fire("touchend", 160);
  assert.deepEqual(ends, [true, false]);
  fire("touchstart", 385);
  fire("touchstart", 385, 150, 2);
  assert.deepEqual(ends, [true, false, true]);
  cleanup();
  fire("touchstart", 3);
  assert.equal(started, 4);
});

test("iOS reserves edge touchstart before the system history gesture", async () => {
  const { captureEdges } = await import("../src/navigation/edge-capture.ts");
  const doc = new EventTarget();
  const cleanup = captureEdges(
    doc,
    () => 390,
    { start: () => true, move: () => true, end: () => {} },
    true,
  );
  for (const [x, reserved] of [
    [195, false],
    [5, true],
    [385, true],
  ]) {
    const event = new Event("touchstart", { cancelable: true });
    Object.defineProperty(event, "touches", { value: [{ clientX: x }] });
    doc.dispatchEvent(event);
    assert.equal(event.defaultPrevented, reserved);
    doc.dispatchEvent(new Event("touchend"));
  }
  cleanup();
});

// First-run pages share the edge-gesture engine but keep their own history.
import {
  initialStartNavigation,
  startNavigate,
} from "../src/navigation/onboarding.ts";
test("first-run navigation returns to choices and can move forward to the same step", () => {
  const home = initialStartNavigation();
  const create = startNavigate(home, { type: "open", page: "create" });
  const back = startNavigate(create, { type: "back" });
  assert.equal(back.stacks.start.past.at(-1).page, "choose");
  const forward = startNavigate(back, { type: "forward" });
  assert.deepEqual(forward.stacks.start.past, create.stacks.start.past);
  assert.equal(forward.stacks.start.future.length, 0);
});
test("choosing another first-run branch invalidates forward history instead of opening a stale form", () => {
  let n = startNavigate(initialStartNavigation(), {
    type: "open",
    page: "create",
  });
  n = startNavigate(n, { type: "back" });
  n = startNavigate(n, { type: "open", page: "connect" });
  assert.equal(n.stacks.start.past.at(-1).page, "connect");
  assert.equal(n.stacks.start.future.length, 0);
  assert.equal(startNavigate(n, { type: "forward" }), n);
  assert.equal(startNavigate(n, { type: "open", page: "connect" }), n);
});
test("first-run history boundaries never remove the choice page or manufacture a forward page", () => {
  const home = initialStartNavigation();
  assert.equal(startNavigate(home, { type: "back" }), home);
  assert.equal(startNavigate(home, { type: "forward" }), home);
});
