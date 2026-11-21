import { captureSwipe } from "./edge-capture.ts";
import {
  edgeDirection,
  swipeIntent,
  type SwipeDirection,
} from "./edge-gesture.ts";
import {
  resistedOffset,
  completesSwipe,
  recordSwipePosition,
  swipeReleaseVelocity,
} from "./motion.ts";
import { useCallback, useEffect, useRef, useState } from "react";

type HistoryFrame = { key: number };
type SwipeHistory<T extends HistoryFrame> = {
  tab: string;
  stacks: Record<string, { past: T[]; future: T[] }>;
};
type Gesture<T> = {
  x: number;
  y: number;
  key: number;
  node: HTMLElement;
  width: number;
  layer: object | undefined;
  available: SwipeDirection | "both";
  pages: Partial<Record<SwipeDirection, T>>;
  direction?: SwipeDirection;
  distance: number;
  positions: { x: number; at: number }[];
  animate: boolean;
};

function currentFrame<T extends HistoryFrame>(n: SwipeHistory<T>): T {
  return n.stacks[n.tab].past.at(-1)!;
}

export function useSwipe<T extends HistoryFrame>(
  navigation: SwipeHistory<T>,
  blocked: () => boolean,
  activeLayer: () => object | undefined,
  request: (direction: SwipeDirection) => void,
  needsConfirmation: () => boolean,
  fullContent = false,
) {
  // Keep drag frames off React's rendering path. Only the preview needs a render.
  const [target, setTarget] = useState<T>();
  const surface = useRef<HTMLElement | null>(null);
  const animationFrame = useRef(0);
  const offset = useRef(0);
  const attachSurface = useCallback((node: HTMLElement | null) => {
    surface.current = node;
  }, []);
  const latest = useRef({
    navigation,
    blocked,
    activeLayer,
    request,
    needsConfirmation,
  });
  latest.current = {
    navigation,
    blocked,
    activeLayer,
    request,
    needsConfirmation,
  };
  const gesture = useRef<Gesture<T> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function paint(node: HTMLElement, value: number, duration = 0) {
    node.style.transition = duration
      ? `transform ${duration}ms cubic-bezier(.2,.7,.2,1)`
      : "";
    node.style.transform = value ? `translate3d(${value}px, 0, 0)` : "";
  }
  function stopFrame() {
    if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
    animationFrame.current = 0;
  }
  function drag(node: HTMLElement, value: number) {
    offset.current = value;
    if (!animationFrame.current)
      animationFrame.current = requestAnimationFrame(() => {
        animationFrame.current = 0;
        paint(node, offset.current);
      });
  }

  function begin(x: number, y: number, origin?: Element) {
    const state = latest.current,
      node = surface.current;
    if (
      !node ||
      !node.clientWidth ||
      state.blocked() ||
      timer.current ||
      gesture.current
    )
      return;
    const layer = state.activeLayer();
    const inContent = !!origin && fullContent;
    // Top-layer dialogs and calculator popovers sit outside the workspace.
    if (
      inContent &&
      !node.contains(origin) &&
      !(layer && origin.closest("dialog[open]")) &&
      !origin.closest(".amount-keyboard:popover-open")
    )
      return;

    const branch = state.navigation.stacks[state.navigation.tab];
    const pages = { back: branch.past.at(-2), forward: branch.future[0] };
    const edge = inContent ? undefined : edgeDirection(x, innerWidth);
    const back =
      (inContent || edge === "back") && (layer || pages.back || !inContent);
    const forward =
      (inContent || edge === "forward") &&
      !layer &&
      (pages.forward || !inContent);
    if (!back && !forward) return;
    const available = back ? (forward ? "both" : "back") : "forward";
    gesture.current = {
      x,
      y,
      key: currentFrame(state.navigation).key,
      node,
      width: node.clientWidth,
      layer,
      available,
      pages,
      distance: 0,
      positions: [{ x, at: performance.now() }],
      animate: !matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
    return available;
  }

  function isCurrent(s: Gesture<T>) {
    const state = latest.current;
    return (
      surface.current === s.node &&
      currentFrame(state.navigation).key === s.key &&
      state.activeLayer() === s.layer &&
      !state.blocked()
    );
  }

  function move(x: number, y: number) {
    const s = gesture.current;
    if (!s || !isCurrent(s)) return "rejected";
    const dx = x - s.x;
    if (!s.direction) {
      const intent = swipeIntent(dx, y - s.y);
      if (intent === "pending") return false;
      if (
        intent === "rejected" ||
        (s.available !== "both" && s.available !== intent)
      )
        return "rejected";
      s.direction = intent;
      if (!s.layer && s.animate) {
        const next = s.pages[intent];
        setTarget(next);
        s.node.classList.add("edge-navigation-active");
        s.node.classList.toggle("boundary-motion", !next);
      }
    }
    const sign = s.direction === "back" ? 1 : -1;
    s.distance = Math.max(0, dx * sign);
    recordSwipePosition(s.positions, x, performance.now());
    if (!s.layer && s.animate) {
      const displacement = Math.min(s.width, s.distance) * sign;
      drag(
        s.node,
        s.pages[s.direction] ? displacement : resistedOffset(displacement),
      );
    }
    return true;
  }

  function end(cancel = false) {
    const s = gesture.current;
    gesture.current = null;
    if (!s?.direction) return;
    stopFrame();
    const direction = s.direction;
    const sign = direction === "back" ? 1 : -1;
    const complete =
      !cancel &&
      isCurrent(s) &&
      s.node.clientWidth === s.width &&
      completesSwipe(
        s.distance,
        swipeReleaseVelocity(s.positions, performance.now(), sign),
        s.width,
        !s.layer && !s.pages[direction],
      );
    const slideOut = complete && !latest.current.needsConfirmation();
    const animated = s.animate && !s.layer;
    const duration = !animated
      ? 0
      : slideOut
        ? Math.max(120, 260 * (1 - Math.min(s.distance / s.width, 1)))
        : 180;
    const settle = () => {
      timer.current = undefined;
      paint(s.node, 0);
      s.node.classList.remove("boundary-motion", "edge-navigation-active");
      setTarget(undefined);
      if (complete && isCurrent(s) && s.node.clientWidth === s.width)
        latest.current.request(direction);
    };
    if (duration) {
      // A move and release can occur in the same frame. Paint the starting
      // offset before giving the browser the destination of the transition.
      if (slideOut && !s.node.style.transform) {
        paint(s.node, offset.current);
        void s.node.offsetWidth;
      }
      paint(s.node, slideOut ? s.width * sign : 0, duration);
      timer.current = setTimeout(settle, duration);
    } else {
      settle();
    }
  }

  useEffect(() => {
    const ios =
      /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const cleanup = captureSwipe(
      document,
      () => innerWidth,
      { start: begin, move, end },
      {
        reserveNativeHistory: ios,
        usePointerEvents:
          fullContent &&
          typeof PointerEvent !== "undefined" &&
          CSS.supports("touch-action", "pan-y pinch-zoom"),
      },
    );
    return () => {
      clearTimeout(timer.current);
      stopFrame();
      cleanup();
    };
  }, [fullContent]);

  return {
    target,
    attachSurface,
    pointer: {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType === "touch" || !e.isPrimary || e.button !== 0) return;
        if (begin(e.clientX, e.clientY))
          e.currentTarget.setPointerCapture(e.pointerId);
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (
          e.currentTarget.hasPointerCapture(e.pointerId) &&
          move(e.clientX, e.clientY) === "rejected"
        )
          end(true);
      },
      onPointerUp: (e: React.PointerEvent) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) end();
      },
      onLostPointerCapture: (e: React.PointerEvent) => {
        if (e.pointerType !== "touch") end(true);
      },
    },
  };
}
