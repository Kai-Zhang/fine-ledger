export const resistedOffset = (distance: number) =>
  Math.sign(distance) * Math.min(26, Math.log1p(Math.abs(distance) / 24) * 11);

type Position = { x: number; at: number };
const releaseWindow = 80;

export function recordSwipePosition(
  positions: Position[],
  x: number,
  at: number,
) {
  if (positions.at(-1)?.x === x) return;
  while (positions.length > 1 && positions[1].at <= at - releaseWindow)
    positions.shift();
  positions.push({ x, at });
}

export function swipeReleaseVelocity(
  positions: Position[],
  at: number,
  sign: 1 | -1,
) {
  const last = positions.at(-1),
    previous = positions.at(-2);
  if (
    !last ||
    !previous ||
    at - last.at >= releaseWindow ||
    (last.x - previous.x) * sign <= 0
  )
    return 0;

  const cutoff = at - releaseWindow;
  const first = positions.findIndex((position) => position.at >= cutoff);
  if (first <= 0) {
    const start = positions[0];
    return ((last.x - start.x) * sign) / Math.max(1, at - start.at);
  }
  const before = positions[first - 1],
    after = positions[first];
  const fraction = (cutoff - before.at) / (after.at - before.at);
  const startX = before.x + (after.x - before.x) * fraction;
  return ((last.x - startX) * sign) / releaseWindow;
}

export function completesSwipe(
  distance: number,
  velocity: number,
  width: number,
  boundary = false,
) {
  return (
    !boundary &&
    (Math.abs(distance) >= Math.min(120, Math.max(70, width * 0.22)) ||
      (Math.abs(distance) >= 45 && velocity >= 0.6))
  );
}
