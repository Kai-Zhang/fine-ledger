import { captureEdges } from "./edge-capture.ts";
import { resistedOffset, completesSwipe } from "./motion.ts";
import { useCallback, useEffect, useRef, useState } from "react";
type HistoryFrame = { key: number };
type SwipeHistory<T extends HistoryFrame> = {
  tab: string;
  stacks: Record<string, { past: T[]; future: T[] }>;
};
function currentFrame<T extends HistoryFrame>(n: SwipeHistory<T>): T {
  return n.stacks[n.tab].past.at(-1)!;
}
export function useSwipe<T extends HistoryFrame>(
  navigation: SwipeHistory<T>,
  blocked: () => boolean,
  layerOpen: () => boolean,
  request: (d: "back" | "forward") => void,
  needsConfirmation: () => boolean,
  authorize: () => Promise<boolean>,
) {
  // Only mounting the preview needs React. Drag frames update the surface
  // directly so ledger queries, formatting and rows stay out of touchmove.
  const [target, setTarget] = useState<T>();
  const surface = useRef<HTMLElement | null>(null);
  const animationFrame = useRef(0);
  const offset = useRef(0);
  const attachSurface = useCallback((node: HTMLElement | null) => {
    surface.current = node;
  }, []);
  function paint(value: number, duration = 0) {
    const node = surface.current;
    if (!node) return;
    node.style.transition = duration
      ? `transform ${duration}ms cubic-bezier(.2,.7,.2,1)`
      : "none";
    node.style.transform =
      value || duration ? `translate3d(${value}px, 0, 0)` : "";
  }
  function stopFrame() {
    if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
    animationFrame.current = 0;
  }
  function drag(value: number) {
    offset.current = value;
    if (!animationFrame.current)
      animationFrame.current = requestAnimationFrame(() => {
        animationFrame.current = 0;
        paint(offset.current);
      });
  }
  const latest = useRef({
    navigation,
    blocked,
    layerOpen,
    request,
    needsConfirmation,
    authorize,
  });
  latest.current = {
    navigation,
    blocked,
    layerOpen,
    request,
    needsConfirmation,
    authorize,
  };
  const start = useRef<{
    x: number;
    y: number;
    dx: number;
    previousDx: number;
    previousAt: number;
    lastAt: number;
    direction: "back" | "forward";
    target?: T;
    key: number;
    boundary: boolean;
    intent?: "horizontal" | "rejected";
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    settling = useRef(false);
  function begin(x: number, y: number) {
    const s = latest.current;
    if (s.blocked() || settling.current) return;
    const direction =
      x <= 24 ? "back" : x >= innerWidth - 24 ? "forward" : undefined;
    if (!direction) return;
    const b = s.navigation.stacks[s.navigation.tab],
      target = direction === "back" ? b.past.at(-2) : b.future[0],
      boundary = !target && !s.layerOpen();
    const now = performance.now();
    start.current = {
      x,
      y,
      dx: 0,
      previousDx: 0,
      previousAt: now,
      lastAt: now,
      direction,
      target,
      key: currentFrame(s.navigation).key,
      boundary,
    };
    return true;
  }
  function move(x: number, y: number) {
    const s = start.current;
    if (!s || s.intent === "rejected") return false;
    const dx = x - s.x,
      dy = y - s.y;
    if (!s.intent) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) <= 8) return false;
      if (
        Math.abs(dy) >= Math.abs(dx) ||
        (s.direction === "back" ? dx <= 0 : dx >= 0)
      ) {
        s.intent = "rejected";
        return false;
      }
      s.intent = "horizontal";
      if (!latest.current.layerOpen()) {
        if (s.target) setTarget(s.target);
        surface.current?.classList.toggle("boundary-motion", s.boundary);
      }
    }
    s.previousDx = s.dx;
    s.previousAt = s.lastAt;
    s.lastAt = performance.now();
    s.dx = s.direction === "back" ? Math.max(0, dx) : Math.min(0, dx);
    if (!latest.current.layerOpen())
      drag(s.boundary ? resistedOffset(s.dx) : s.dx);
    return true;
  }
  function reset() {
    stopFrame();
    settling.current = false;
    paint(0);
    surface.current?.classList.remove("boundary-motion");
    setTarget(undefined);
  }
  function after(ms: number, fn: () => void) {
    clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  }
  function complete(s: NonNullable<typeof start.current>) {
    if (currentFrame(latest.current.navigation).key !== s.key) {
      reset();
      return;
    }
    const duration = Math.max(
      120,
      Math.min(260, 260 * (1 - Math.min(Math.abs(s.dx) / innerWidth, 0.8))),
    );
    setTarget(s.target);
    paint(s.direction === "back" ? innerWidth : -innerWidth, duration);
    after(duration, () => {
      if (currentFrame(latest.current.navigation).key === s.key)
        latest.current.request(s.direction);
      reset();
    });
  }
  function end(cancel = false) {
    const s = start.current;
    if (!s) return;
    start.current = null;
    if (s.intent !== "horizontal") return;
    stopFrame();
    settling.current = true;
    if (latest.current.layerOpen()) {
      after(120, () => {
        if (!cancel && Math.abs(s.dx) > 85) latest.current.request(s.direction);
        reset();
      });
      return;
    }
    const velocity =
      performance.now() - s.lastAt < 100
        ? Math.abs(s.dx - s.previousDx) / Math.max(1, s.lastAt - s.previousAt)
        : 0;
    if (cancel || !completesSwipe(s.dx, velocity, innerWidth, s.boundary)) {
      paint(0, 180);
      after(180, reset);
      return;
    }
    if (latest.current.needsConfirmation()) {
      paint(0, 180);
      after(180, () => {
        void latest.current.authorize().then((yes) => {
          if (yes && currentFrame(latest.current.navigation).key === s.key)
            latest.current.request(s.direction);
          reset();
        });
      });
    } else complete(s);
  }
  useEffect(() => {
    const ios =
      /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const cleanup = captureEdges(
      document,
      () => innerWidth,
      { start: begin, move, end },
      ios,
    );
    return () => {
      clearTimeout(timer.current);
      stopFrame();
      cleanup();
    };
  }, []);
  return {
    target,
    attachSurface,
    pointer: {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType === "touch") return;
        if (begin(e.clientX, e.clientY))
          e.currentTarget.setPointerCapture(e.pointerId);
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (e.pointerType !== "touch") move(e.clientX, e.clientY);
      },
      onPointerUp: (e: React.PointerEvent) => {
        if (e.pointerType !== "touch") end();
      },
      onPointerCancel: (e: React.PointerEvent) => {
        if (e.pointerType !== "touch") end(true);
      },
    },
  };
}
