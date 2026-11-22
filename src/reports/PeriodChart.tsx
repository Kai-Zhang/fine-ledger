import { useEffect, useRef, useState } from "react";
import { compactMoney, money } from "../domain/money.ts";

const plotInset = 14;

export function PeriodChart({
  labels,
  series,
  currency,
  chart,
  compact = false,
  selected,
  onSelect,
}: {
  labels: string[];
  series: { name: string; values: (bigint | null)[]; color: string }[];
  currency: string;
  chart: "bar" | "line";
  compact?: boolean;
  selected: number | null;
  onSelect: (index: number | null) => void;
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
  const height = compact ? 204 : 246;
  const bottom = height - 41;
  const step = Math.max(
      36,
      (size - 2 * plotInset) / Math.max(1, Math.min(10, labels.length)),
    ),
    width = Math.max(size, labels.length * step + 2 * plotInset),
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
  const x = (i: number) => plotInset + (i + 0.5) * step;
  const y = (n: bigint) =>
    bottom -
    (Number(((n - low) * 1000000n) / (high - low)) / 1000000) * (bottom - 30);
  function select(index: number) {
    onSelect(index);
    const node = viewport.current;
    if (
      node &&
      (x(index) < node.scrollLeft + plotInset ||
        x(index) > node.scrollLeft + size - plotInset)
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
      <div className="period-chart-plot">
        <svg
          className="period-chart-axis"
          width="41"
          height={height}
          aria-hidden="true"
        >
          {[high, low + (high - low) / 2n, low].map((tick, i) => (
            <text
              key={i}
              x="37"
              y={y(tick)}
              dominantBaseline="middle"
              textAnchor="end"
              className="chart-label"
            >
              <title>
                {money(tick, currency)} {currency}
              </title>
              {compactMoney(tick, currency)}
            </text>
          ))}
        </svg>
        <div
          ref={viewport}
          className="period-chart-scroll"
          data-no-back
          onScroll={(e) => setScroll(e.currentTarget.scrollLeft)}
        >
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`${series.map((s) => s.name).join("与")}分期${chart === "bar" ? "条形" : "折线"}图，可横向浏览，使用下方滑块选择期间`}
            onClick={() => onSelect(null)}
          >
            {[30, y(low + (high - low) / 2n), bottom, y(0n)].map((v, i) => (
              <line
                key={i}
                x1="0"
                x2={width}
                y1={v}
                y2={v}
                className={i === 3 ? "chart-zero" : "chart-grid"}
              />
            ))}
            {selected !== null && (
              <rect
                x={x(selected) - step / 2}
                y="24"
                width={step}
                height={bottom - 17}
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
                          y={(height - 6) / 2}
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
                          x(i) -
                          step * 0.32 +
                          (si * step * 0.64) / series.length
                        }
                        y={Math.min(y(n), y(0n))}
                        width={(step * 0.64) / series.length - 2}
                        height={Math.max(1, Math.abs(y(n) - y(0n)))}
                        rx="2"
                        fill={s.color}
                        onClick={(event) => {
                          event.stopPropagation();
                          select(i);
                        }}
                        opacity={selected === null || selected === i ? 1 : 0.55}
                      />
                    ) : (
                      <g
                        key={i}
                        onClick={(event) => {
                          event.stopPropagation();
                          select(i);
                        }}
                      >
                        <circle
                          cx={x(i)}
                          cy={y(n)}
                          r={Math.min(18, step / 2)}
                          fill="transparent"
                        />
                        <circle
                          cx={x(i)}
                          cy={y(n)}
                          r={selected === i ? 4 : 2.5}
                          fill={s.color}
                        />
                      </g>
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
                  y={height - 11}
                  textAnchor="middle"
                  className="chart-label"
                >
                  {labels[i]}
                </text>
              ))}
          </svg>
        </div>
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
