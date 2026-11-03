import type { Category } from "../domain/types.ts";
export type RingLayer = "parent" | "child";
export type DonutCategory = { id: string; name: string; amount: bigint };
export type DonutGroup = DonutCategory & { children: DonutCategory[] };
export type RingSegment = DonutCategory & {
  layer: RingLayer;
  parentId: string;
  parentName: string;
  start: number;
  end: number;
};
export const TAU = Math.PI * 2;
export function ringLayout(groups: DonutGroup[]): RingSegment[] {
  const total = groups.reduce((n, g) => n + g.amount, 0n);
  if (total <= 0n) return [];
  const angle = (amount: bigint) =>
    (Number((amount * 1000000000000n) / total) / 1000000000000) * TAU;
  const rows: RingSegment[] = [];
  let offset = 0n;
  for (const group of groups) {
    const start = offset;
    offset += group.amount;
    rows.push({
      ...group,
      layer: "parent",
      parentId: group.id,
      parentName: group.name,
      start: angle(start),
      end: angle(offset),
    });
    let childOffset = start;
    for (const child of group.children) {
      const a = childOffset;
      childOffset += child.amount;
      rows.push({
        ...child,
        layer: "child",
        parentId: group.id,
        parentName: group.name,
        start: angle(a),
        end: angle(childOffset),
      });
    }
  }
  return rows;
}
export function ringHit(
  rows: RingSegment[],
  x: number,
  y: number,
  layer?: RingLayer,
) {
  const dx = x - 150,
    dy = y - 150,
    radius = Math.hypot(dx, dy);
  if (!layer && (radius < 54 || radius > 152)) return undefined;
  // Trigonometric roundoff at a shared boundary consistently chooses the next item.
  const epsilon = 1e-12;
  let angle = (Math.atan2(dy, dx) + Math.PI / 2 + TAU) % TAU;
  if (TAU - angle < epsilon) angle = 0;
  const ring = layer || (radius < 110 ? "parent" : "child");
  return rows.find(
    (row) =>
      row.layer === ring &&
      angle + epsilon >= row.start &&
      angle + epsilon < row.end,
  );
}
export function ringArc(radius: number, start: number, end: number) {
  const span = end - start,
    gap = Math.min(0.006, Math.max(0, span / 8));
  start += gap;
  end -= gap;
  const point = (a: number) => [
    150 + radius * Math.sin(a),
    150 - radius * Math.cos(a),
  ];
  const a = point(start),
    b = point(end);
  // Two arcs also support a single category occupying the whole ring.
  const middle = point((start + end) / 2);
  return `M ${a[0]} ${a[1]} A ${radius} ${radius} 0 0 1 ${middle[0]} ${middle[1]} A ${radius} ${radius} 0 0 1 ${b[0]} ${b[1]}`;
}
export function categoryShare(amount: bigint, total: bigint) {
  if (total <= 0n || amount <= 0n) return "0%";
  if (amount * 100n < total) {
    const n = (amount * 10000n + total / 2n) / total;
    return n === 0n
      ? "<0.01%"
      : `${n / 100n}.${String(n % 100n).padStart(2, "0")}%`;
  }
  const n = (amount * 1000n + total / 2n) / total;
  return `${n / 10n}.${n % 10n}%`;
}
const hues = [
  145, 28, 215, 285, 72, 185, 340, 245, 105, 8, 165, 265, 48, 305, 125, 205,
  325, 88,
];
const hash = (id: string) => {
  let value = 2166136261;
  for (const c of id) value = Math.imul(value ^ c.charCodeAt(0), 16777619);
  return value >>> 0;
};
export type PlotColor = { light: string; dark: string };
export function categoryPlotColors(categories: Category[]) {
  const colors = new Map<string, PlotColor>(),
    used = new Set<number>();
  const parents = categories
    .filter((c) => c.kind === "expense" && !c.parentId)
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const parent of parents) {
    let slot = hash(parent.id) % hues.length;
    for (let i = 0; i < hues.length && used.has(slot); i++)
      slot = (slot + 1) % hues.length;
    const hue =
      used.size < hues.length ? hues[slot] : (hash(parent.id) * 137.508) % 360;
    used.add(slot);
    colors.set(parent.id, {
      light: `hsl(${hue} 37% 49%)`,
      dark: `hsl(${hue} 40% 66%)`,
    });
    const children = categories
      .filter((c) => c.parentId === parent.id)
      .sort((a, b) => a.id.localeCompare(b.id));
    children.forEach((child, i) => {
      const shift = ((i * 13753) % 40000) / 1000 - 20,
        lightness = [59, 45, 66, 52, 56][i % 5],
        saturation = [39, 42, 34, 44, 37][i % 5];
      colors.set(child.id, {
        light: `hsl(${(hue + shift + 360) % 360} ${saturation}% ${lightness}%)`,
        dark: `hsl(${(hue + shift + 360) % 360} ${saturation}% ${Math.min(80, lightness + 17)}%)`,
      });
    });
  }
  return colors;
}
export type RingGesture = {
  layer: RingLayer;
  index: number;
  initialIndex: number;
  x: number;
  y: number;
  mode: "pending" | "scrub" | "precision" | "cancelled";
};
export const fineStep = 20;
export function beginRingGesture(
  layer: RingLayer,
  index: number,
  x: number,
  y: number,
): RingGesture {
  return { layer, index, initialIndex: index, x, y, mode: "pending" };
}
export function holdRingGesture(g: RingGesture): RingGesture {
  return g.mode === "pending" ? { ...g, mode: "precision" } : g;
}
export function moveRingGesture(
  g: RingGesture,
  x: number,
  y: number,
  angleIndex: number,
  count: number,
): RingGesture {
  if (g.mode === "cancelled") return g;
  const dx = x - g.x,
    dy = y - g.y;
  if (g.mode === "precision")
    return {
      ...g,
      index: Math.max(
        0,
        Math.min(count - 1, g.initialIndex + Math.trunc(dx / fineStep)),
      ),
    };
  if (g.mode === "pending") {
    if (Math.hypot(dx, dy) < 8) return g;
    if (Math.abs(dy) > Math.abs(dx)) return { ...g, mode: "cancelled" };
  }
  return { ...g, mode: "scrub", index: angleIndex < 0 ? g.index : angleIndex };
}
