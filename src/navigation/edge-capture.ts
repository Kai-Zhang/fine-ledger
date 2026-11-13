import { edgeDirection, nativeHistoryEdgeWidth } from "./edge-gesture.ts";

export function captureEdges(
  target: Document,
  width: () => number,
  callbacks: {
    start: (x: number, y: number) => boolean | undefined;
    move: (x: number, y: number) => boolean;
    end: (cancel?: boolean) => void;
  },
  cancelNativeHistoryOnStart = false,
) {
  let active = false;
  let claimed = false;
  let suppressClickUntil = 0;
  const start = (e: TouchEvent) => {
    suppressClickUntil = 0;
    if (e.touches.length !== 1) {
      finish(true);
      return;
    }
    if (active) return;
    const t = e.touches[0];
    if (!edgeDirection(t.clientX, width())) return;
    if (
      (e.target as Element)?.closest?.(
        ".drag-handle, [data-no-back], input, textarea, select, [contenteditable=true], [role=slider]",
      )
    )
      return;
    if (!callbacks.start(t.clientX, t.clientY)) return;
    active = true;
    claimed = false;
    // iOS can claim the system history gesture before the first touchmove.
    if (
      cancelNativeHistoryOnStart &&
      e.cancelable &&
      (t.clientX <= nativeHistoryEdgeWidth ||
        t.clientX >= width() - nativeHistoryEdgeWidth)
    )
      e.preventDefault();
    // Only an edge candidate needs a blocking listener. Ordinary scrolling
    // should not wait for JS to decide whether its touchmove can be canceled.
    target.addEventListener("touchmove", move, {
      passive: false,
      capture: true,
    });
  };
  const move = (e: TouchEvent) => {
    if (e.touches.length !== 1 || !e.cancelable) {
      finish(true);
      return;
    }
    const t = e.touches[0];
    if (callbacks.move(t.clientX, t.clientY)) {
      claimed = true;
      e.preventDefault();
    }
  };
  function finish(cancel = false) {
    if (!active) return;
    active = false;
    if (claimed) suppressClickUntil = performance.now() + 500;
    target.removeEventListener("touchmove", move, { capture: true });
    callbacks.end(cancel);
  }
  const end = () => finish();
  const cancel = () => finish(true);
  const click = (e: MouseEvent) => {
    if (e.detail > 0 && performance.now() < suppressClickUntil) {
      e.preventDefault();
      e.stopImmediatePropagation();
      suppressClickUntil = 0;
    }
  };
  target.addEventListener("touchstart", start, {
    passive: !cancelNativeHistoryOnStart,
    capture: true,
  });
  target.addEventListener("touchend", end, { capture: true });
  target.addEventListener("touchcancel", cancel, { capture: true });
  target.addEventListener("click", click, { capture: true });
  return () => {
    active = false;
    target.removeEventListener("touchstart", start, { capture: true });
    target.removeEventListener("touchmove", move, { capture: true });
    target.removeEventListener("touchend", end, { capture: true });
    target.removeEventListener("touchcancel", cancel, { capture: true });
    target.removeEventListener("click", click, { capture: true });
  };
}
