export const resistedOffset = (distance: number) =>
  Math.sign(distance) * Math.min(26, Math.log1p(Math.abs(distance) / 24) * 11);
export function completesSwipe(
  distance: number,
  velocity: number,
  width: number,
  boundary = false,
) {
  return (
    !boundary &&
    (Math.abs(distance) > Math.min(110, width * 0.26) ||
      (Math.abs(distance) > 38 && velocity > 0.45))
  );
}
