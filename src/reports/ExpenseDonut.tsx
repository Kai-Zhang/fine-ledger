import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Icon } from "../ui/icons.tsx";
import { money } from "../domain/money.ts";
import { plotColor } from "./plot-color.ts";
import {
  ringLayout,
  ringHit,
  ringArc,
  categoryShare,
  beginRingGesture,
  holdRingGesture,
  moveRingGesture,
  type DonutGroup,
  type RingLayer,
  type RingSegment,
  type RingGesture,
  type PlotColor,
} from "./donut-model.ts";
export function ExpenseDonut({
  groups,
  selectedId,
  layer,
  onSelect,
  onClear,
  currency,
  colors,
  label = "支出分类",
  totalLabel = "正向净支出",
}: {
  groups: DonutGroup[];
  selectedId: string | null;
  layer: RingLayer;
  onSelect: (id: string, layer: RingLayer) => void;
  onClear: () => void;
  currency: string;
  colors: Map<string, PlotColor>;
  label?: string;
  totalLabel?: string;
}) {
  const segments = useMemo(() => ringLayout(groups), [groups]);
  const total = groups.reduce((n, g) => n + g.amount, 0n);
  const selected = segments.find(
    (s) => s.id === selectedId && s.layer === layer,
  );
  const [fine, setFine] = useState<"manual" | "gesture" | null>(null);
  const [finePlacement, setFinePlacement] = useState<"top" | "bottom">("top");
  const root = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null);
  const blankTap = useRef<{ x: number; y: number } | null>(null);
  const gesture = useRef<RingGesture | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({
    segments,
    onSelect,
    onClear,
    fine,
    selectedId,
    layer,
  });
  latest.current = { segments, onSelect, onClear, fine, selectedId, layer };
  const segmentNodes = useRef(new Map<string, SVGPathElement>());
  const choose = (s: RingSegment | undefined) => {
    if (s) latest.current.onSelect(s.id, s.layer);
  };
  function clearTimer() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }
  function hit(clientX: number, clientY: number, locked?: RingLayer) {
    const box = svg.current!.getBoundingClientRect();
    return ringHit(
      latest.current.segments,
      ((clientX - box.left) / box.width) * 300,
      ((clientY - box.top) / box.height) * 300,
      locked,
    );
  }
  function begin(x: number, y: number) {
    blankTap.current = null;
    if (!hit(x, y)) {
      clearTimer();
      gesture.current = null;
      blankTap.current = { x, y };
      return true;
    }
    const row =
      latest.current.fine === "manual"
        ? latest.current.segments.find(
            (s) =>
              s.id === latest.current.selectedId &&
              s.layer === latest.current.layer,
          ) || hit(x, y)
        : hit(x, y);
    if (!row) return false;
    const rows = latest.current.segments.filter((s) => s.layer === row.layer);
    gesture.current = beginRingGesture(row.layer, rows.indexOf(row), x, y);
    clearTimer();
    if (latest.current.fine === "manual") {
      gesture.current = holdRingGesture(gesture.current);
      return true;
    }
    timer.current = setTimeout(() => {
      const g = gesture.current;
      if (!g || g.mode !== "pending") return;
      gesture.current = holdRingGesture(g);
      const box = svg.current!.getBoundingClientRect();
      setFinePlacement(g.y > box.top + box.height / 2 ? "top" : "bottom");
      choose(
        latest.current.segments.filter((s) => s.layer === g.layer)[g.index],
      );
      setFine((current) => (current === "manual" ? "manual" : "gesture"));
    }, 300);
    return true;
  }
  function move(x: number, y: number) {
    if (blankTap.current) {
      if (Math.hypot(x - blankTap.current.x, y - blankTap.current.y) > 8)
        blankTap.current = null;
      return false;
    }
    const g = gesture.current;
    if (!g) return false;
    const rows = latest.current.segments.filter((s) => s.layer === g.layer),
      row = hit(x, y, g.layer);
    const next = moveRingGesture(
      g,
      x,
      y,
      row ? rows.indexOf(row) : -1,
      rows.length,
    );
    gesture.current = next;
    if (next.mode !== "pending") clearTimer();
    if (next.mode === "cancelled") return false;
    if (next.mode === "scrub" || next.mode === "precision") {
      if (g.index !== next.index || g.mode !== next.mode)
        choose(rows[next.index]);
      return true;
    }
    return false;
  }
  function finish(cancel = false) {
    clearTimer();
    const blank = blankTap.current;
    blankTap.current = null;
    if (blank && !cancel) {
      latest.current.onClear();
      setFine(null);
    }
    const g = gesture.current;
    gesture.current = null;
    if (!cancel && g?.mode === "pending")
      choose(
        latest.current.segments.filter((s) => s.layer === g.layer)[g.index],
      );
    setFine((current) => (current === "gesture" ? null : current));
    return (!!g && g.mode !== "cancelled") || !!blank;
  }
  useEffect(() => {
    const element = root.current!;
    let touchId: number | null = null;
    const start = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        finish(true);
        touchId = null;
        return;
      }
      if (
        !(event.target instanceof Element) ||
        event.target.closest("svg") !== svg.current
      )
        return;
      const touch = event.touches[0];
      if (begin(touch.clientX, touch.clientY)) touchId = touch.identifier;
    };
    const change = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        finish(true);
        touchId = null;
        return;
      }
      const touch = Array.from(event.touches).find(
        (t) => t.identifier === touchId,
      );
      if (touch && move(touch.clientX, touch.clientY) && event.cancelable)
        event.preventDefault();
    };
    const end = (event: TouchEvent) => {
      if (
        !Array.from(event.changedTouches).some((t) => t.identifier === touchId)
      )
        return;
      const handled = finish(event.type === "touchcancel");
      touchId = null;
      if (handled && event.cancelable) event.preventDefault();
    };
    element.addEventListener("touchstart", start, { passive: false });
    element.addEventListener("touchmove", change, { passive: false });
    element.addEventListener("touchend", end, { passive: false });
    element.addEventListener("touchcancel", end, { passive: false });
    return () => {
      clearTimer();
      element.removeEventListener("touchstart", start);
      element.removeEventListener("touchmove", change);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", end);
    };
  }, []);
  useEffect(() => {
    gesture.current = null;
    blankTap.current = null;
    clearTimer();
    setFine(null);
  }, [segments]);
  useEffect(() => {
    if (selectedId === null) {
      gesture.current = null;
      blankTap.current = null;
      clearTimer();
      setFine(null);
    }
  }, [selectedId]);
  const point = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "touch") return;
    if (move(e.clientX, e.clientY)) e.preventDefault();
  };
  const rows = segments.filter((s) => s.layer === layer),
    index = rows.findIndex((s) => s.id === selectedId),
    current = Math.max(0, index);
  function openFine() {
    if (fine) {
      setFine(null);
      return;
    }
    const row = rows[current];
    if (row)
      setFinePlacement(
        Math.cos((row.start + row.end) / 2) > 0 ? "bottom" : "top",
      );
    choose(row);
    setFine("manual");
  }
  return (
    <div
      className="donut-wrap expense-donut"
      ref={root}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg
        ref={svg}
        viewBox="0 0 300 300"
        role="group"
        aria-label={`${label}双层环形图，内环大类、外环子类，点按选择，按住后左右滑动精细选择`}
        onPointerDown={(e) => {
          if (
            e.pointerType !== "touch" &&
            e.button === 0 &&
            begin(e.clientX, e.clientY)
          ) {
            e.currentTarget.setPointerCapture(e.pointerId);
            e.preventDefault();
          }
        }}
        onPointerMove={point}
        onPointerUp={(e) => {
          if (e.pointerType !== "touch") finish();
        }}
        onPointerCancel={(e) => {
          if (e.pointerType !== "touch") finish(true);
        }}
        onLostPointerCapture={(e) => {
          if (
            e.pointerType !== "touch" &&
            (gesture.current || blankTap.current)
          )
            finish(true);
        }}
      >
        <title>{label}：内环大类，外环子类；图形和比例保持真实金额</title>
        {segments.map((s) => {
          const related =
            !selected ||
            (s.id === selected.id && s.layer === selected.layer) ||
            (selected.layer === "parent" && s.parentId === selected.id);
          return (
            <path
              key={`${s.layer}:${s.id}`}
              ref={(node) => {
                const key = `${s.layer}:${s.id}`;
                if (node) segmentNodes.current.set(key, node);
                else segmentNodes.current.delete(key);
              }}
              className={`ring-segment report-category-ink ${selected?.id === s.id && selected.layer === s.layer ? "is-selected" : ""} ${related ? "" : "is-muted"}`}
              style={plotColor(colors.get(s.id))}
              d={ringArc(s.layer === "parent" ? 91 : 123, s.start, s.end)}
              stroke="currentColor"
              strokeWidth={s.layer === "parent" ? 34 : 22}
              strokeLinecap="butt"
              fill="none"
              tabIndex={0}
              role="button"
              aria-label={`${s.layer === "parent" ? "内环" : "外环"} ${s.name} ${categoryShare(s.amount, total)} ${money(s.amount, currency)}`}
              aria-pressed={selected?.id === s.id && selected.layer === s.layer}
              onClick={() => choose(s)}
              onKeyDown={(e) => {
                const ring = segments.filter((row) => row.layer === s.layer),
                  at = ring.indexOf(s);
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  choose(s);
                }
                if (
                  ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                ) {
                  e.preventDefault();
                  const next =
                    e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? ring.length - 1
                        : Math.max(
                            0,
                            Math.min(
                              ring.length - 1,
                              at + (e.key === "ArrowRight" ? 1 : -1),
                            ),
                          );
                  choose(ring[next]);
                  setFine("manual");
                  requestAnimationFrame(() =>
                    segmentNodes.current
                      .get(`${ring[next].layer}:${ring[next].id}`)
                      ?.focus({ preventScroll: true }),
                  );
                }
              }}
            />
          );
        })}
        {selected && (
          <g
            className="ring-highlight report-category-ink"
            style={plotColor(colors.get(selected.id))}
            aria-hidden="true"
            pointerEvents="none"
          >
            <path
              className="ring-halo"
              d={ringArc(142, selected.start, selected.end)}
              stroke="currentColor"
              strokeWidth="8"
              strokeLinecap="butt"
              fill="none"
            />
            {selected.end - selected.start < 0.025 && (
              <line
                x1={150 + 134 * Math.sin((selected.start + selected.end) / 2)}
                y1={150 - 134 * Math.cos((selected.start + selected.end) / 2)}
                x2={150 + 149 * Math.sin((selected.start + selected.end) / 2)}
                y2={150 - 149 * Math.cos((selected.start + selected.end) / 2)}
                stroke="currentColor"
                strokeWidth="2"
              />
            )}
          </g>
        )}
        <g className="ring-center" aria-hidden="true" pointerEvents="none">
          <text x="150" y="129" textAnchor="middle" className="donut-caption">
            {selected ? selected.name.slice(0, 10) : totalLabel}
          </text>
          <text
            x="150"
            y="155"
            textAnchor="middle"
            className="donut-total"
            style={{
              fontSize:
                money(selected?.amount ?? total, currency).length > 13
                  ? 14
                  : 20,
            }}
          >
            {money(selected?.amount ?? total, currency)}
          </text>
          <text x="150" y="179" textAnchor="middle" className="donut-share">
            {selected ? categoryShare(selected.amount, total) : "100%"}
          </text>
        </g>
      </svg>
      <div className="ring-explore-controls">
        <small>
          {fine
            ? "左右滑动或点击相邻类别，逐项查看"
            : "按住圆环后左右滑动，精确选择小类别"}
        </small>
        <button
          type="button"
          className="ring-fine-toggle"
          aria-expanded={!!fine}
          onClick={openFine}
        >
          <Icon name={fine ? "Check" : "Crosshair"} size={18} />
          <span>{fine ? "完成" : "精细选择"}</span>
        </button>
      </div>
      {fine && (
        <div
          className={`ring-precision ${fine === "gesture" ? "is-gesture" : "is-manual"} at-${finePlacement}`}
          role="group"
          aria-label={`精细选择${layer === "parent" ? "大类" : "子类"}`}
        >
          <div className="ring-precision-heading">
            <span>{layer === "parent" ? "大类" : "子类"} · 精细选择</span>
            <span>
              {current + 1} / {rows.length}
            </span>
          </div>
          <div className="ring-neighbors">
            {[-1, 0, 1].map((offset) => {
              const row = rows[current + offset];
              return row ? (
                <button
                  key={offset}
                  type="button"
                  className={offset === 0 ? "selected" : ""}
                  aria-label={`${offset < 0 ? "上一个" : offset > 0 ? "下一个" : "当前"}类目 ${row.name}`}
                  aria-current={offset === 0 ? "true" : undefined}
                  onClick={() => choose(row)}
                >
                  <small>
                    {offset < 0 ? "上一个" : offset > 0 ? "下一个" : "当前"}
                  </small>
                  <span>{row.name}</span>
                </button>
              ) : (
                <span key={offset} />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
