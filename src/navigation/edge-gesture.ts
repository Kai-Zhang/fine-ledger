export const backEdgeWidth = 44;
export const forwardEdgeWidth = 24;
// Preserve the existing iOS system-history reservation. The wider back
// candidate area must still allow taps and scrolling until intent is clear.
export const nativeHistoryEdgeWidth = 24;

export function edgeDirection(x: number, width: number) {
  if (x <= backEdgeWidth) return "back";
  if (x >= width - forwardEdgeWidth) return "forward";
}

export function edgeSwipeIntent(
  dx: number,
  dy: number,
  direction: "back" | "forward",
): "pending" | "horizontal" | "rejected" {
  const inward = direction === "back" ? dx : -dx;
  const vertical = Math.abs(dy);
  if (inward < -8) return "rejected";
  if (vertical >= 12 && vertical > Math.abs(dx) * 1.3) return "rejected";
  if (inward >= 10 && inward > vertical * 1.1) return "horizontal";
  // Observe a small diagonal start before deciding; a sustained diagonal
  // belongs to scrolling rather than claiming an ambiguous page transition.
  if (Math.max(Math.abs(dx), vertical) >= 24) return "rejected";
  return "pending";
}
