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
  const start = (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      finish(true);
      return;
    }
    if (active) return;
    const t = e.touches[0];
    if (t.clientX > 24 && t.clientX < width() - 24) return;
    if ((e.target as HTMLElement)?.closest?.(".drag-handle")) return;
    if (!callbacks.start(t.clientX, t.clientY)) return;
    active = true;
    // iOS can claim the system history gesture before the first touchmove.
    if (cancelNativeHistoryOnStart && e.cancelable) e.preventDefault();
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
    if (callbacks.move(t.clientX, t.clientY)) e.preventDefault();
  };
  function finish(cancel = false) {
    if (!active) return;
    active = false;
    target.removeEventListener("touchmove", move, { capture: true });
    callbacks.end(cancel);
  }
  const end = () => finish();
  const cancel = () => finish(true);
  target.addEventListener("touchstart", start, {
    passive: !cancelNativeHistoryOnStart,
    capture: true,
  });
  target.addEventListener("touchend", end, { capture: true });
  target.addEventListener("touchcancel", cancel, { capture: true });
  return () => {
    active = false;
    target.removeEventListener("touchstart", start, { capture: true });
    target.removeEventListener("touchmove", move, { capture: true });
    target.removeEventListener("touchend", end, { capture: true });
    target.removeEventListener("touchcancel", cancel, { capture: true });
  };
}
