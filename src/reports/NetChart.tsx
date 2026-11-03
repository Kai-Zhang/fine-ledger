import { useMemo, useId, useRef, type PointerEvent } from "react";
import type { NetPoint } from "../domain/reporting.ts";
import { money } from "../domain/money.ts";

export function NetChart({
  values,
  selected,
  onSelect,
  currency,
  label = "净值",
}: {
  values: NetPoint[];
  selected: number;
  onSelect: (n: number) => void;
  currency: string;
  label?: string;
}) {
  const fillId = useId();
  const dragging = useRef<number | null>(null);
  const geometry = useMemo(() => {
    const width = 360,
      height = 340,
      left = 10,
      right = 350,
      top = 30,
      bottom = 307;
    let min = values.find((v) => !v.missing.length)?.total || 0n,
      max = min;
    for (const v of values) {
      if (v.missing.length) continue;
      if (v.total < min) min = v.total;
      if (v.total > max) max = v.total;
    }
    // Keep money exact; only convert bounded differences for SVG coordinates.
    const spread = max - min || (max < 0n ? -max : max) / 10n || 100n;
    const pad = spread / 12n || 1n,
      low = min - pad,
      high = max + pad;
    const y = (v: bigint) =>
      bottom -
      (Number(((v - low) * 1000000n) / (high - low)) / 1000000) *
        (bottom - top);
    const x = (i: number) =>
      values.length === 1
        ? (left + right) / 2
        : left + (i / (values.length - 1)) * (right - left);
    // Retain each pixel bucket's extrema; selecting still uses every daily point.
    const keep = new Set<number>([0, Math.max(0, values.length - 1)]),
      bucket = Math.max(1, Math.ceil(values.length / 600));
    for (let start = 0; start < values.length; start += bucket) {
      let low = -1,
        high = -1;
      for (let i = start; i < Math.min(values.length, start + bucket); i++) {
        if (values[i].missing.length) continue;
        if (low < 0 || values[i].total < values[low].total) low = i;
        if (high < 0 || values[i].total > values[high].total) high = i;
      }
      if (low >= 0) keep.add(low);
      if (high >= 0) keep.add(high);
    }
    let previous = -1;
    const path = [...keep]
      .sort((a, b) => a - b)
      .filter((i) => !values[i].missing.length)
      .map((i) => {
        const disconnected =
          previous < 0 ||
          values.slice(previous + 1, i).some((v) => v.missing.length);
        previous = i;
        return `${disconnected ? "M" : "L"}${x(i).toFixed(2)},${y(values[i].total).toFixed(2)}`;
      })
      .join(" ");
    return { width, height, left, right, top, bottom, x, y, path, low, high };
  }, [values]);
  if (!values.length) return null;
  const { width, height, left, right, top, bottom, x, y, path, low, high } =
      geometry,
    index = Math.min(Math.max(0, selected), values.length - 1);
  function pick(e: PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    onSelect(
      Math.max(
        0,
        Math.min(
          values.length - 1,
          Math.round(
            ((((e.clientX - r.left) / r.width) * width - left) /
              (right - left)) *
              (values.length - 1),
          ),
        ),
      ),
    );
  }
  return (
    <div className="net-chart" onContextMenu={(e) => e.preventDefault()}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${label}走势，点按或按住左右滑动查看期间`}
        onPointerDown={(e) => {
          dragging.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          pick(e);
        }}
        onPointerMove={(e) => {
          if (dragging.current === e.pointerId) pick(e);
        }}
        onPointerUp={(e) => {
          if (dragging.current === e.pointerId) {
            pick(e);
            dragging.current = null;
          }
        }}
        onPointerCancel={() => {
          dragging.current = null;
        }}
        onLostPointerCapture={() => {
          dragging.current = null;
        }}
      >
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity=".2" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity=".02" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((n) => (
          <line
            key={n}
            x1={left}
            x2={right}
            y1={top + n * (bottom - top)}
            y2={top + n * (bottom - top)}
            className="chart-grid"
          />
        ))}
        <text x={left} y="17" className="chart-label">
          {money(high, currency)}
        </text>
        <text x={left} y={bottom - 5} className="chart-label">
          {money(low, currency)}
        </text>
        {values.length > 1 && !values.some((v) => v.missing.length) && (
          <path
            d={`${path} L ${right},${bottom} L ${left},${bottom} Z`}
            fill={`url(#${fillId})`}
          />
        )}
        <path
          d={path}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <line
          x1={x(index)}
          x2={x(index)}
          y1={top}
          y2={bottom}
          className="chart-cursor"
        />
        {!values[index].missing.length && (
          <circle
            cx={x(index)}
            cy={y(values[index].total)}
            r="4"
            fill="var(--accent)"
            stroke="var(--surface)"
            strokeWidth="2"
          />
        )}
        <text x={left} y="333" className="chart-label">
          {values[0].date.replaceAll("-", "/")}
        </text>
        <text x={right} y="333" textAnchor="end" className="chart-label">
          {values.at(-1)!.date.replaceAll("-", "/")}
        </text>
      </svg>
      <input
        className="chart-accessible-slider"
        type="range"
        min="0"
        max={values.length - 1}
        value={index}
        onChange={(e) => onSelect(Number(e.target.value))}
        aria-label={`选择${label}日期`}
        aria-valuetext={`${values[index].date} ${money(values[index].total, currency)} ${currency}`}
      />
    </div>
  );
}
