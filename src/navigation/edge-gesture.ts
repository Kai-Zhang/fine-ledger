export const backEdgeWidth = 120;
export const forwardEdgeWidth = 24;
export const nativeHistoryEdgeWidth = 24;
export type SwipeDirection = "back" | "forward";

export function edgeDirection(x: number, width: number) {
  if (x <= backEdgeWidth) return "back";
  if (x >= width - forwardEdgeWidth) return "forward";
}

export function swipeIntent(dx: number, dy: number) {
  const horizontal = Math.abs(dx),
    vertical = Math.abs(dy);
  if (vertical >= 12 && vertical > horizontal * 1.3) return "rejected";
  if (horizontal >= 10 && horizontal >= vertical * 1.3)
    return dx > 0 ? "back" : "forward";
  // Observe a small diagonal start before deciding; a sustained diagonal
  // belongs to scrolling rather than claiming an ambiguous page transition.
  if (Math.max(horizontal, vertical) >= 24) return "rejected";
  return "pending";
}
