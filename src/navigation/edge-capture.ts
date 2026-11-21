import { nativeHistoryEdgeWidth, type SwipeDirection } from "./edge-gesture.ts";

type Directions = SwipeDirection | "both";

export function captureSwipe(
  target: Document,
  width: () => number,
  callbacks: {
    start: (x: number, y: number, origin: Element) => Directions | undefined;
    move: (x: number, y: number) => boolean | "rejected";
    end: (cancel?: boolean) => void;
  },
  { reserveNativeHistory = false, usePointerEvents = false } = {},
) {
  let direction: Directions | undefined;
  let pointerId: number | undefined;
  let claimed = false;
  let suppressClickUntil = 0;

  function begin(x: number, y: number, origin: Element) {
    if (
      direction ||
      origin?.closest?.(
        ".drag-handle, [data-no-back], input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=slider]",
      )
    )
      return;
    direction = callbacks.start(x, y, origin);
    claimed = false;
  }

  function finish(cancel = false) {
    if (!direction) return;
    direction = undefined;
    pointerId = undefined;
    if (claimed) suppressClickUntil = performance.now() + 500;
    claimed = false;
    callbacks.end(cancel);
  }

  function track(x: number, y: number) {
    const result = callbacks.move(x, y);
    if (result === "rejected") finish(true);
    else if (result) claimed = true;
    return result === true;
  }

  function release(x?: number, y?: number) {
    if (claimed && x !== undefined && y !== undefined) track(x, y);
    finish();
  }

  const pointerDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    suppressClickUntil = 0;
    if (!e.isPrimary) {
      finish(true);
      return;
    }
    begin(e.clientX, e.clientY, e.target as Element);
    if (direction) pointerId = e.pointerId;
  };
  const pointerMove = (e: PointerEvent) => {
    if (e.pointerId === pointerId) track(e.clientX, e.clientY);
  };
  const pointerUp = (e: PointerEvent) => {
    if (e.pointerId === pointerId) release(e.clientX, e.clientY);
  };
  const pointerCancel = (e: PointerEvent) => {
    if (e.pointerId === pointerId) finish(true);
  };

  const touchStart = (e: TouchEvent) => {
    suppressClickUntil = 0;
    if (e.touches.length !== 1) {
      finish(true);
      return;
    }
    const t = e.touches[0];
    const origin = e.target as Element;
    if (!usePointerEvents) begin(t.clientX, t.clientY, origin);
    // Keep the established physical-edge reservation on iOS. Movement in
    // the content uses Pointer Events and touch-action to share native scroll.
    if (
      reserveNativeHistory &&
      direction &&
      e.cancelable &&
      !origin?.closest?.("button, a[href], summary, [role=button]") &&
      ((direction !== "forward" && t.clientX <= nativeHistoryEdgeWidth) ||
        (direction !== "back" && t.clientX >= width() - nativeHistoryEdgeWidth))
    )
      e.preventDefault();
  };
  const touchMove = (e: TouchEvent) => {
    if (!direction) return;
    if (e.touches.length !== 1 || !e.cancelable) {
      finish(true);
      return;
    }
    const t = e.touches[0];
    if (track(t.clientX, t.clientY)) e.preventDefault();
  };
  const touchEnd = (e: TouchEvent) => {
    const t = e.changedTouches?.[0];
    release(t?.clientX, t?.clientY);
  };
  const cancel = () => finish(true);
  const click = (e: MouseEvent) => {
    if (e.detail > 0 && performance.now() < suppressClickUntil) {
      e.preventDefault();
      e.stopImmediatePropagation();
      suppressClickUntil = 0;
    }
  };

  const listeners = new AbortController();
  const options = { capture: true, passive: true, signal: listeners.signal };
  if (usePointerEvents) {
    target.addEventListener("pointerdown", pointerDown, options);
    target.addEventListener("pointermove", pointerMove, options);
    target.addEventListener("pointerup", pointerUp, options);
    target.addEventListener("pointercancel", pointerCancel, options);
    target.addEventListener("lostpointercapture", pointerCancel, options);
  } else {
    // WebKit may decide a move is non-cancelable before touchstart runs.
    target.addEventListener("touchmove", touchMove, {
      ...options,
      passive: false,
    });
    target.addEventListener("touchend", touchEnd, options);
    target.addEventListener("touchcancel", cancel, options);
  }
  target.addEventListener("touchstart", touchStart, {
    ...options,
    passive: !reserveNativeHistory,
  });
  target.addEventListener("contextmenu", cancel, options);
  target.addEventListener("click", click, { ...options, passive: false });
  return () => listeners.abort();
}
