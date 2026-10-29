import { captureEdges } from "./edge-capture.ts";
import { resistedOffset, completesSwipe } from "./motion.ts";
import { useEffect, useRef, useState } from "react";
import { currentFrame, type Navigation, type Frame } from "./stack.ts";
type Motion = {
  offset: number;
  target?: Frame;
  boundary?: boolean;
  duration?: number;
};
export function useSwipe(
  navigation: Navigation,
  blocked: () => boolean,
  layerOpen: () => boolean,
  request: (d: "back" | "forward") => void,
  needsConfirmation: () => boolean,
  authorize: () => Promise<boolean>,
) {
  const [motion, setMotion] = useState<Motion>({ offset: 0 });
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
    target?: Frame;
    key: number;
    boundary: boolean;
    rejected?: boolean;
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
    setMotion({ offset: 0, target, boundary });
  }
  function move(x: number, y: number) {
    const s = start.current;
    if (!s || s.rejected) return;
    const dx = x - s.x,
      dy = y - s.y;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
      s.rejected = true;
      setMotion({ offset: 0 });
      return;
    }
    s.previousDx = s.dx;
    s.previousAt = s.lastAt;
    s.lastAt = performance.now();
    s.dx = s.direction === "back" ? Math.max(0, dx) : Math.min(0, dx);
    if (!latest.current.layerOpen())
      setMotion({
        offset: s.boundary ? resistedOffset(s.dx) : s.dx,
        target: s.target,
        boundary: s.boundary,
      });
  }
  function reset() {
    settling.current = false;
    setMotion({ offset: 0 });
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
    setMotion({
      offset: s.direction === "back" ? innerWidth : -innerWidth,
      target: s.target,
      duration,
    });
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
    settling.current = true;
    if (latest.current.layerOpen()) {
      setMotion({ offset: 0 });
      after(120, () => {
        if (!cancel && !s.rejected && Math.abs(s.dx) > 85)
          latest.current.request(s.direction);
        reset();
      });
      return;
    }
    const velocity =
      performance.now() - s.lastAt < 100
        ? Math.abs(s.dx - s.previousDx) / Math.max(1, s.lastAt - s.previousAt)
        : 0;
    if (
      cancel ||
      s.rejected ||
      !completesSwipe(s.dx, velocity, innerWidth, s.boundary)
    ) {
      setMotion((m) => ({ ...m, offset: 0, duration: 180 }));
      after(180, reset);
      return;
    }
    if (latest.current.needsConfirmation()) {
      setMotion((m) => ({ ...m, offset: 0, duration: 180 }));
      after(180, () => {
        void latest.current.authorize().then((yes) => {
          if (yes) {
            s.dx = 0;
            complete(s);
          } else reset();
        });
      });
    } else complete(s);
  }
  useEffect(() => {
    const cleanup = captureEdges(document, () => innerWidth, {
      start: begin,
      move,
      end,
    });
    return () => {
      clearTimeout(timer.current);
      cleanup();
    };
  }, []);
  return {
    motion,
    reset: () => {
      start.current = null;
      reset();
    },
    pointer: {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType === "touch") return;
        begin(e.clientX, e.clientY);
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
