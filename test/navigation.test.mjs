import test from "node:test";
import assert from "node:assert/strict";
import { edgeDirection, swipeIntent } from "../src/navigation/edge-gesture.ts";
import { captureSwipe } from "../src/navigation/edge-capture.ts";
import {
  completesSwipe,
  recordSwipePosition,
  swipeReleaseVelocity,
} from "../src/navigation/motion.ts";
import {
  initialNavigation,
  currentFrame,
  navigate,
} from "../src/navigation/stack.ts";
const open = (n, route) => navigate(n, { type: "open", route });
test("back candidates include the near edge without widening forward gestures", () => {
  for (const x of [0, 12, 24, 44, 80, 100, 120])
    assert.equal(edgeDirection(x, 390), "back");
  for (const x of [121, 195, 365])
    assert.equal(edgeDirection(x, 390), undefined);
  for (const x of [366, 378, 390])
    assert.equal(edgeDirection(x, 390), "forward");
});
test("horizontal intent selects the direction while mostly vertical or ambiguous drags yield", () => {
  assert.equal(swipeIntent(4, 6), "pending");
  assert.equal(swipeIntent(8, 10), "pending");
  assert.equal(swipeIntent(20, 12), "back");
  assert.equal(swipeIntent(-20, 12), "forward");
  assert.equal(swipeIntent(2, 14), "rejected");
  assert.equal(swipeIntent(24, 24), "rejected");
});
test("release requires distance within the content width or a deliberate flick", () => {
  assert.equal(completesSwipe(30, 1, 390), false);
  assert.equal(completesSwipe(70, 0, 390), false);
  assert.equal(completesSwipe(86, 0, 390), true);
  assert.equal(completesSwipe(89, 0, 640), false);
  assert.equal(completesSwipe(120, 0, 640), true);
  assert.equal(completesSwipe(70, 0, 260), true);
  assert.equal(completesSwipe(45, 0.5, 390), false);
  assert.equal(completesSwipe(45, 0.6, 390), true);
  assert.equal(completesSwipe(200, 1, 390, true), false);
});

test("release velocity respects the final direction, stationary release and either swipe direction", () => {
  const positions = [{ x: 300, at: 0 }];
  recordSwipePosition(positions, 280, 30);
  recordSwipePosition(positions, 254, 60);
  recordSwipePosition(positions, 246, 70);
  assert.ok(swipeReleaseVelocity(positions, 73, -1) > 0.6);
  assert.equal(swipeReleaseVelocity(positions, 73, 1), 0);
  assert.equal(swipeReleaseVelocity(positions, 151, -1), 0);
  recordSwipePosition(positions, 248, 79);
  assert.equal(swipeReleaseVelocity(positions, 81, -1), 0);
  recordSwipePosition(positions, 288, 110);
  assert.ok(swipeReleaseVelocity(positions, 112, 1) > 0);
});

function touch(doc, type, x, y = 150) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, "touches", {
    value: type === "touchend" ? [] : [{ clientX: x, clientY: y }],
  });
  doc.dispatchEvent(event);
  return event;
}
test("full content candidates capture swipes without eagerly blocking taps or vertical moves on iOS", () => {
  const doc = new EventTarget();
  const starts = [];
  const cleanup = captureSwipe(
    doc,
    () => 900,
    {
      start: (x) => {
        if (x < 224) return;
        starts.push(x);
        return "both";
      },
      move: (x, y) => y === 150 && x > 310,
      end: () => {},
    },
    { reserveNativeHistory: true },
  );
  for (const x of [5, 120, 223, 224, 300, 450, 600, 875, 876]) {
    const event = touch(doc, "touchstart", x);
    assert.equal(event.defaultPrevented, x === 876);
    if (x === 300) {
      assert.equal(touch(doc, "touchmove", x, 180).defaultPrevented, false);
      assert.equal(touch(doc, "touchmove", 380).defaultPrevented, true);
    }
    touch(doc, "touchend", x);
  }
  assert.deepEqual(starts, [224, 300, 450, 600, 875, 876]);
  cleanup();
});
test("claimed drags suppress a trailing click but preserve keyboard activation and the next tap", () => {
  const doc = new EventTarget();
  const cleanup = captureSwipe(doc, () => 390, {
    start: () => "both",
    move: () => true,
    end: () => {},
  });
  const click = (detail) => {
    const event = new Event("click", { cancelable: true });
    Object.defineProperty(event, "detail", { value: detail });
    doc.dispatchEvent(event);
    return event.defaultPrevented;
  };
  touch(doc, "touchstart", 36);
  touch(doc, "touchmove", 70);
  touch(doc, "touchend", 70);
  assert.equal(click(0), false);
  assert.equal(click(1), true);
  assert.equal(click(1), false);
  touch(doc, "touchstart", 36);
  touch(doc, "touchmove", 80);
  touch(doc, "touchend", 80);
  touch(doc, "touchstart", 195);
  touch(doc, "touchend", 195);
  assert.equal(click(1), false);
  cleanup();
});
test("controls with their own gestures are excluded before iOS history reservation", () => {
  const doc = new EventTarget();
  let started = false;
  doc.closest = () => ({});
  const cleanup = captureSwipe(
    doc,
    () => 390,
    {
      start: () => {
        started = true;
        return "both";
      },
      move: () => true,
      end: () => {},
    },
    { reserveNativeHistory: true },
  );
  for (const x of [5, 100])
    assert.equal(touch(doc, "touchstart", x).defaultPrevented, false);
  assert.equal(started, false);
  cleanup();
});
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

test("selecting a different account replaces the account branch from the list", () => {
  const select = (n, id) => navigate(n, { type: "select-account", id });
  let n = select(initialNavigation(), "bank");
  const bank = currentFrame(n);
  assert.equal(select(n, "bank"), n);
  n = open(n, { page: "detail", id: "one" });
  assert.deepEqual(currentFrame(back(n)), bank);
  assert.deepEqual(currentFrame(select(n, "bank")), bank);
  n = select(n, "wallet");
  assert.deepEqual(currentFrame(n).route, { page: "account", id: "wallet" });
  const home = back(n);
  assert.equal(currentFrame(home).route.page, "accounts");
  assert.equal(back(home), home);
  assert.deepEqual(currentFrame(forward(home)), currentFrame(n));
  const settings = open(open(n, { page: "settings" }), { page: "categories" });
  assert.equal(select(settings, "bank"), settings);
  assert.deepEqual(
    currentFrame(open(settings, { page: "accounts" })),
    currentFrame(n),
  );
});

test("touch capture lets vertical scrolling take over, and rejects multitouch", () => {
  const doc = new EventTarget();
  let started = 0,
    ends = [];
  const cleanup = captureSwipe(doc, () => 390, {
    start: (x) => (x !== 200 && ++started !== 3 ? "both" : undefined),
    move: (x, y) => (y > 170 ? "rejected" : x > 25),
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

test("iOS reserves physical edges only where the gesture direction can navigate", () => {
  const doc = new EventTarget();
  const cleanup = captureSwipe(
    doc,
    () => 390,
    { start: () => "back", move: () => true, end: () => {} },
    { reserveNativeHistory: true },
  );
  for (const [x, reserved] of [
    [195, false],
    [5, true],
    [24, true],
    [25, false],
    [36, false],
    [120, false],
    [121, false],
    [385, false],
  ]) {
    const event = new Event("touchstart", { cancelable: true });
    Object.defineProperty(event, "touches", { value: [{ clientX: x }] });
    doc.dispatchEvent(event);
    assert.equal(event.defaultPrevented, reserved);
    doc.dispatchEvent(new Event("touchend"));
  }
  cleanup();
});

test("content swipes use pointer moves even when Safari touch moves are non-cancelable", () => {
  const doc = new EventTarget();
  const moved = [],
    ended = [];
  const cleanup = captureSwipe(
    doc,
    () => 390,
    {
      start: () => "back",
      move: (x) => {
        moved.push(x);
        return true;
      },
      end: (cancel) => ended.push(cancel),
    },
    { usePointerEvents: true, reserveNativeHistory: true },
  );
  const pointer = (type, x, id = 1) => {
    const event = Object.assign(new Event(type), {
      clientX: x,
      clientY: 150,
      pointerId: id,
      pointerType: "touch",
      isPrimary: id === 1,
    });
    doc.dispatchEvent(event);
  };
  const swipe = (x) => {
    pointer("pointerdown", x);
    assert.equal(touch(doc, "touchstart", x).defaultPrevented, x <= 24);
    doc.dispatchEvent(new Event("touchmove", { cancelable: false }));
    pointer("pointermove", x + 60);
  };
  swipe(150);
  pointer("pointerup", 215);
  assert.deepEqual(moved, [210, 215]);
  assert.deepEqual(ended, [false]);
  const click = Object.assign(new Event("click", { cancelable: true }), {
    detail: 1,
  });
  assert.equal(doc.dispatchEvent(click), false);
  swipe(5);
  pointer("pointercancel", 65);
  assert.deepEqual(ended, [false, true]);
  swipe(150);
  pointer("pointerdown", 180, 2);
  pointer("pointerup", 210);
  assert.deepEqual(ended, [false, true, true]);
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
