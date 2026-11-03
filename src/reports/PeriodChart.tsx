import { useEffect, useRef, useState } from "react";
import { money } from "../domain/money.ts";

export function PeriodChart({
  labels,
  series,
  currency,
  chart,
  selected,
  onSelect,
}: {
  labels: string[];
  series: { name: string; values: (bigint | null)[]; color: string }[];
  currency: string;
  chart: "bar" | "line";
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(320),
    [scroll, setScroll] = useState(0);
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setSize(node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const step = Math.max(
      36,
      (size - 40) / Math.max(1, Math.min(10, labels.length)),
    ),
    width = Math.max(size, labels.length * step + 40),
    first = Math.max(0, Math.floor(scroll / step) - 1),
    last = Math.min(labels.length, first + Math.ceil(size / step) + 4);
  const values = series.flatMap((s) =>
    s.values.filter((v): v is bigint => v !== null),
  );
  let low = 0n,
    high = 0n;
  for (const n of values) {
    if (n < low) low = n;
    if (n > high) high = n;
  }
  const span = high - low || 100n;
  high += span / 12n || 1n;
  if (low < 0n) low -= span / 12n || 1n;
  const x = (i: number) => 20 + (i + 0.5) * step;
  const y = (n: bigint) =>
    205 - (Number(((n - low) * 1000000n) / (high - low)) / 1000000) * 175;
  function select(index: number) {
    onSelect(index);
    const node = viewport.current;
    if (
      node &&
      (x(index) < node.scrollLeft + 20 ||
        x(index) > node.scrollLeft + size - 20)
    )
      node.scrollLeft = Math.max(0, x(index) - size / 2);
  }
  if (!labels.length) return null;
  return (
    <div className="period-chart">
      <div className="period-chart-key">
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
        <small>{currency}</small>
      </div>
      <div className="period-chart-scale">
        <span>{money(high, currency)}</span>
        <span>{money(low, currency)}</span>
      </div>
      <div
        ref={viewport}
        className="period-chart-scroll"
        onScroll={(e) => setScroll(e.currentTarget.scrollLeft)}
      >
        <svg
          width={width}
          height="246"
          viewBox={`0 0 ${width} 246`}
          role="img"
          aria-label={`${series.map((s) => s.name).join("与")}分期${chart === "bar" ? "条形" : "折线"}图，可横向浏览，使用下方滑块选择期间`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            select(
              Math.max(
                0,
                Math.min(
                  labels.length - 1,
                  Math.floor((e.clientX - r.left - 20) / step),
                ),
              ),
            );
          }}
        >
          {[30, y(0n), 205].map((v, i) => (
            <line
              key={i}
              x1="0"
              x2={width}
              y1={v}
              y2={v}
              className={i === 1 ? "chart-zero" : "chart-grid"}
            />
          ))}
          {selected !== null && (
            <rect
              x={x(selected) - step / 2}
              y="24"
              width={step}
              height="188"
              className="period-selection"
            />
          )}
          {series.map((s, si) => {
            const visible = Array.from(
              { length: last - first },
              (_, k) => k + first,
            );
            let pen = false;
            const path = visible
              .map((i) => {
                const n = s.values[i];
                if (n === null) {
                  pen = false;
                  return "";
                }
                const command = pen ? "L" : "M";
                pen = true;
                return `${command}${x(i)},${y(n)}`;
              })
              .join(" ");
            return (
              <g key={s.name}>
                {chart === "line" && (
                  <path
                    d={path}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                )}
                {visible.map((i) => {
                  const n = s.values[i];
                  if (n === null)
                    return (
                      <text
                        key={i}
                        x={x(i)}
                        y="120"
                        textAnchor="middle"
                        className="chart-label"
                      >
                        —
                      </text>
                    );
                  return chart === "bar" ? (
                    <rect
                      key={i}
                      x={
                        x(i) - step * 0.32 + (si * step * 0.64) / series.length
                      }
                      y={Math.min(y(n), y(0n))}
                      width={(step * 0.64) / series.length - 2}
                      height={Math.max(1, Math.abs(y(n) - y(0n)))}
                      rx="2"
                      fill={s.color}
                      opacity={selected === null || selected === i ? 1 : 0.55}
                    />
                  ) : (
                    <circle
                      key={i}
                      cx={x(i)}
                      cy={y(n)}
                      r={selected === i ? 4 : 2.5}
                      fill={s.color}
                    />
                  );
                })}
              </g>
            );
          })}
          {Array.from({ length: last - first }, (_, k) => k + first)
            .filter((i) => i % Math.max(1, Math.ceil(76 / step)) === 0)
            .map((i) => (
              <text
                key={i}
                x={x(i)}
                y="235"
                textAnchor="middle"
                className="chart-label"
              >
                {labels[i]}
              </text>
            ))}
        </svg>
      </div>
      <input
        className="period-slider"
        type="range"
        min="0"
        max={Math.max(0, labels.length - 1)}
        value={selected ?? 0}
        onChange={(e) => select(Number(e.target.value))}
        aria-label="选择报表期间"
        aria-valuetext={labels[selected ?? 0]}
      />
      {width > size + 1 && (
        <p className="compact-note muted">
          左右滑动查看全部 {labels.length} 个期间
        </p>
      )}
    </div>
  );
}
