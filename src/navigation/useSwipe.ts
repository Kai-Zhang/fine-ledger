import { captureEdges } from "./edge-capture.ts";
import { useEffect, useRef, useState } from "react";
import { currentFrame, type Navigation, type Frame } from "./stack.ts";
export function useSwipe(
  navigation: Navigation,
  blocked: () => boolean,
  layerOpen: () => boolean,
  request: (d: "back" | "forward") => void,
) {
  const [motion, setMotion] = useState<{ offset: number; target?: Frame }>({
    offset: 0,
  });
  const latest = useRef({ navigation, blocked, layerOpen, request });
  latest.current = { navigation, blocked, layerOpen, request };
  const start = useRef<{
    x: number;
    y: number;
    dx: number;
    direction: "back" | "forward";
    target?: Frame;
    key: number;
    rejected?: boolean;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function begin(x: number, y: number) {
    const s = latest.current;
    if (s.blocked()) return;
    const direction =
      x <= 24 ? "back" : x >= innerWidth - 24 ? "forward" : undefined;
    if (!direction) return;
    const b = s.navigation.stacks[s.navigation.tab];
    const target = direction === "back" ? b.past.at(-2) : b.future[0];
    if (!target && !s.layerOpen()) return; // root boundary: no displacement, no browser history page
    start.current = {
      x,
      y,
      dx: 0,
      direction,
      target,
      key: currentFrame(s.navigation).key,
    };
    setMotion({ offset: 0, target });
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
    s.dx = s.direction === "back" ? Math.max(0, dx) : Math.min(0, dx);
    if (!latest.current.layerOpen())
      setMotion({ offset: s.dx, target: s.target });
  }
  function end(cancel = false) {
    const s = start.current;
    if (!s) return;
    start.current = null;
    setMotion((m) => ({ ...m, offset: 0 }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setMotion({ offset: 0 });
      if (
        s &&
        !cancel &&
        !s.rejected &&
        Math.abs(s.dx) > Math.min(110, innerWidth * 0.26) &&
        currentFrame(latest.current.navigation).key === s.key
      )
        latest.current.request(s.direction);
    }, 170);
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
      setMotion({ offset: 0 });
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
