import { edgeDirection } from "./edge-gesture.ts";

export const rowActionWidth = 80;
export function rowSwipeIntent(dx: number, dy: number) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return "pending";
  return Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
}
export function rowSwipeOffset(initial: number, dx: number) {
  return Math.max(-rowActionWidth, Math.min(0, initial + dx));
}
export function rowSwipeOpen(offset: number) {
  return offset <= -rowActionWidth / 2;
}
export function rowSwipeStart(x: number, width: number) {
  return !edgeDirection(x, width);
}
