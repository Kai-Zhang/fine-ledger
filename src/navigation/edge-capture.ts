export function captureEdges(
  target: Document,
  width: () => number,
  callbacks: {
    start: (x: number, y: number) => void;
    move: (x: number, y: number) => void;
    end: (cancel?: boolean) => void;
  },
) {
  let active = false;
  const start = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.clientX > 24 && t.clientX < width() - 24) return;
    if ((e.target as HTMLElement)?.closest?.(".drag-handle")) return;
    if (e.cancelable) e.preventDefault();
    active = true;
    callbacks.start(t.clientX, t.clientY);
  };
  const move = (e: TouchEvent) => {
    if (!active) return;
    if (e.cancelable) e.preventDefault();
    callbacks.move(e.touches[0].clientX, e.touches[0].clientY);
  };
  const end = () => {
    if (active) {
      active = false;
      callbacks.end();
    }
  };
  const cancel = () => {
    if (active) {
      active = false;
      callbacks.end(true);
    }
  };
  target.addEventListener("touchstart", start, {
    passive: false,
    capture: true,
  });
  target.addEventListener("touchmove", move, { passive: false, capture: true });
  target.addEventListener("touchend", end, { capture: true });
  target.addEventListener("touchcancel", cancel, { capture: true });
  return () => {
    target.removeEventListener("touchstart", start, { capture: true });
    target.removeEventListener("touchmove", move, { capture: true });
    target.removeEventListener("touchend", end, { capture: true });
    target.removeEventListener("touchcancel", cancel, { capture: true });
  };
}
