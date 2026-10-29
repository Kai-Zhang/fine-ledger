export { ReportCatalog } from "./ReportCatalog.tsx";
import { useMemo, useState, useEffect } from "react";
import { useApp } from "../ui/context.tsx";
import {
  Header,
  Button,
  IconButton,
  Amount,
  Field,
  Dialog,
  Empty,
} from "../ui/components.tsx";
import { Icon } from "../ui/icons.tsx";
import { netWorth, balance, categoryStats } from "../domain/ledger.ts";
import {
  localDate,
  endOfDay,
  dateToISO,
  dateOffset,
  startOfDay,
} from "../domain/dates.ts";
import { money } from "../domain/money.ts";
import { uid, type SavedReport } from "../domain/types.ts";
const colors = [
  "#477B66",
  "#83A28B",
  "#C4AA78",
  "#A486A6",
  "#799EAA",
  "#CA8C6B",
  "#7E8AB3",
  "#A5B875",
];
function arc(cx: number, cy: number, r: number, start: number, end: number) {
  const p = (angle: number) => [
    cx + r * Math.cos(angle - Math.PI / 2),
    cy + r * Math.sin(angle - Math.PI / 2),
  ];
  const a = p(start),
    b = p(end);
  return `M ${a[0]} ${a[1]} A ${r} ${r} 0 ${end - start > Math.PI ? 1 : 0} 1 ${b[0]} ${b[1]}`;
}
function startFor(days: string, timeZone: string) {
  const today = localDate(new Date(), timeZone);
  if (days === "month") return today.slice(0, 8) + "01";
  if (days === "year") return today.slice(0, 5) + "01-01";
  return dateOffset(today, -Number(days || 30) + 1);
}
interface ReportView {
  type: "net" | "expense";
  days: string;
  from: string;
  to: string;
  ids: string[];
  categoryIds: string[];
  interval: "day" | "week" | "month";
  point: number | null;
}
export function Reports() {
  const app = useApp(),
    { book } = app;
  const viewKey = `${app.mode}:reports:${JSON.stringify(app.route)}`;
  const saved = book.settings.savedReports.find(
    (r) => r.id === app.route.savedReportId,
  );
  const cached = (app.views.get(viewKey) ||
    (saved
      ? {
          ...saved,
          ids: saved.accountIds.filter((id) =>
            book.accounts.some((a) => a.id === id),
          ),
          interval: "day",
          point: null,
        }
      : undefined)) as ReportView | undefined;
  const [type, setType] = useState<"net" | "expense">(
      cached?.type || app.route.report || "net",
    ),
    [days, setDays] = useState(cached?.days || "30"),
    [from, setFrom] = useState(
      cached?.days === "custom"
        ? cached.from
        : startFor(cached?.days || "30", book.timeZone),
    ),
    [to, setTo] = useState(
      cached?.days === "custom"
        ? cached.to
        : localDate(new Date(), book.timeZone),
    ),
    [ids, setIds] = useState(
      cached?.ids ||
        book.accounts
          .filter((a) => app.route.report === "expense" || a.netWorth)
          .map((a) => a.id),
    ),
    [categoryIds, setCategoryIds] = useState<string[]>(
      cached?.categoryIds || [],
    ),
    [filter, setFilter] = useState(false),
    [interval, setInterval] = useState<"day" | "week" | "month">(
      cached?.interval || "day",
    ),
    [point, setPoint] = useState<number | null>(cached?.point ?? null),
    [saveName, setSaveName] = useState(""),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    app.views.set(viewKey, {
      type,
      days,
      from,
      to,
      ids,
      categoryIds,
      interval,
      point,
    });
  }, [viewKey, type, days, from, to, ids, categoryIds, interval, point]);
  useEffect(() => {
    if (days !== "custom") {
      setFrom(startFor(days, book.timeZone));
      setTo(localDate(new Date(), book.timeZone));
    }
    setPoint(null);
  }, [book.timeZone]);
  const rangeDays = Math.ceil(
    (new Date(to + "T12:00:00").getTime() -
      new Date(from + "T12:00:00").getTime()) /
      86400000,
  );
  useEffect(() => {
    if (rangeDays > 5600 && interval !== "month") setInterval("month");
    else if (rangeDays > 730 && interval === "day") setInterval("week");
  }, [rangeDays, interval]);
  const beginning = startOfDay(from, book.timeZone),
    end = endOfDay(to, book.timeZone),
    valid = from <= to,
    stats = useMemo(
      () => categoryStats(book, beginning, end, ids, categoryIds),
      [book, beginning, end, ids, categoryIds],
    );
  const points = useMemo(() => {
    if (!valid) return [];
    const dates: string[] = [],
      cursor = new Date(from + "T12:00:00"),
      last = new Date(to + "T12:00:00");
    while (cursor <= last) {
      dates.push(localDate(cursor));
      if (interval === "month") cursor.setMonth(cursor.getMonth() + 1);
      else cursor.setDate(cursor.getDate() + (interval === "week" ? 7 : 1));
    }
    if (dates.at(-1) !== to) dates.push(to);
    return dates.map((date) => ({
      date,
      ...netWorth(
        book,
        date === localDate(new Date(), book.timeZone)
          ? new Date().toISOString()
          : endOfDay(date, book.timeZone),
        ids,
      ),
    }));
  }, [book, from, to, ids, interval, valid]);
  const current =
      points[Math.min(point ?? points.length - 1, points.length - 1)],
    first = points[0],
    change =
      current && first
        ? current.total -
          netWorth(book, endOfDay(dateOffset(from, -1), book.timeZone), ids)
            .total
        : 0n;
  const positive = [...stats.values].filter(([, v]) => v > 0n),
    negative = [...stats.values].filter(([, v]) => v < 0n),
    positiveTotal = positive.reduce((a, [, n]) => a + n, 0n);
  const parents = new Map<
    string,
    {
      id: string;
      name: string;
      icon: string;
      color: string;
      amount: bigint;
      children: { id: string; name: string; icon: string; amount: bigint }[];
    }
  >();
  positive.forEach(([id, n]) => {
    const c = book.categories.find((c) => c.id === id);
    if (!c) return;
    const p = book.categories.find((p) => p.id === c.parentId) || c;
    if (!parents.has(p.id))
      parents.set(p.id, { ...p, amount: 0n, children: [] });
    const parent = parents.get(p.id)!;
    parent.amount += n;
    parent.children.push({ id, name: c.name, icon: c.icon, amount: n });
  });
  const parentValues = [...parents.values()].sort((a, b) =>
    a.amount > b.amount ? -1 : 1,
  );
  const drill = (category?: string) =>
    app.go({
      page: "transactions",
      from: beginning,
      to: end,
      categoryIds: category ? [category] : categoryIds,
      accountId: ids.length === 1 ? ids[0] : undefined,
      accountIds: ids,
      postedOnly: true,
      reportKind: "expense",
    });
  function saveDialog() {
    setSaveName("");
    setSaving(true);
  }
  return (
    <>
      <Header
        title={saved?.name || (type === "net" ? "净值走势" : "支出分类")}
        back
      >
        <IconButton
          name="ListFilter"
          label="筛选报表"
          onClick={() => setFilter(true)}
        />
      </Header>
      <main className="page-content reports-page">
        <div className="report-toolbar">
          <select
            aria-label="报表时间范围"
            value={days}
            onChange={(e) => {
              setDays(e.target.value);
              if (e.target.value !== "custom") {
                setFrom(startFor(e.target.value, book.timeZone));
                setTo(localDate(new Date(), book.timeZone));
              }
              setPoint(null);
            }}
          >
            <option value="30">近 30 天</option>
            <option value="90">近 90 天</option>
            <option value="month">本月</option>
            <option value="year">今年</option>
            <option value="custom">自定义时间</option>
          </select>
          <button onClick={() => setFilter(true)}>
            {ids.length === book.accounts.length
              ? "所有账户"
              : `${ids.length} 个账户`}
            <Icon name="ChevronDown" size={15} />
          </button>
          <IconButton name="Plus" label="保存当前报表" onClick={saveDialog} />
        </div>
        {days === "custom" && (
          <div className="date-range">
            <input
              aria-label="开始日期"
              type="date"
              value={from}
              onChange={(e) => {
                if (e.target.value) setFrom(e.target.value);
                setPoint(null);
              }}
            />
            <span>至</span>
            <input
              aria-label="结束日期"
              type="date"
              value={to}
              onChange={(e) => {
                if (e.target.value) setTo(e.target.value);
                setPoint(null);
              }}
            />
          </div>
        )}
        {!valid ? (
          <p role="alert" className="error-banner">
            结束日期需要晚于开始日期。
          </p>
        ) : !ids.length ? (
          <Empty
            icon="ChartNoAxesCombined"
            title="选择账户查看报表"
            action={<Button onClick={() => setFilter(true)}>选择账户</Button>}
          />
        ) : type === "net" ? (
          <>
            <section className="chart-panel net-panel">
              <div className="report-value">
                <span>
                  {current?.date.replaceAll("-", ".") || "—"} ·{" "}
                  {current?.missing.length ? "已折算净值" : "总净值"}
                  <small>{book.currency}</small>
                </span>
                <Amount value={current?.total || 0n} currency={book.currency} />
                <small className={change >= 0n ? "positive" : "negative"}>
                  较期初 {change >= 0n ? "+" : "−"}
                  {money(change >= 0n ? change : -change, book.currency)}
                </small>
              </div>
              {current?.missing.length > 0 && (
                <p className="report-warning">
                  {current.missing.map((m) => m.account.name).join("、")}
                  缺少转入汇率。上方为可折算部分。
                </p>
              )}
              {current?.provisional && (
                <span className="provisional-label">
                  尾段沿用最近一次转入汇率
                </span>
              )}
              <NetChart
                values={points.map((p) => ({ date: p.date, value: p.total }))}
                selected={point ?? points.length - 1}
                onSelect={setPoint}
                currency={book.currency}
              />
              <div className="chart-granularity">
                {(["day", "week", "month"] as const).map((v, i) => (
                  <button
                    key={v}
                    className={interval === v ? "selected" : ""}
                    disabled={
                      (v === "day" && rangeDays > 730) ||
                      (v === "week" && rangeDays > 5600)
                    }
                    onClick={() => {
                      setInterval(v);
                      setPoint(null);
                    }}
                  >
                    {["日", "周", "月"][i]}
                  </button>
                ))}
              </div>
            </section>
            <div className="section-title">
              <h2>账户构成</h2>
              <span>{current?.date}</span>
            </div>
            <div className="report-account-list">
              {book.accounts
                .filter((a) => ids.includes(a.id))
                .map((a) => {
                  const n = balance(
                    book,
                    a.id,
                    current
                      ? current.date === localDate(new Date(), book.timeZone)
                        ? new Date().toISOString()
                        : endOfDay(current.date, book.timeZone)
                      : end,
                  );
                  return (
                    <button
                      key={a.id}
                      onClick={() =>
                        app.go({
                          page: "transactions",
                          accountId: a.id,
                          to: current
                            ? current.date ===
                              localDate(new Date(), book.timeZone)
                              ? new Date().toISOString()
                              : endOfDay(current.date, book.timeZone)
                            : end,
                          postedOnly: true,
                          reportKind: "net",
                        })
                      }
                    >
                      <span className="account-symbol">
                        <Icon name={a.icon} />
                      </span>
                      <span>
                        {a.name}
                        {a.archived && <small>已归档</small>}
                      </span>
                      <Amount value={n} currency={a.currency} code />
                      <Icon name="ChevronRight" size={15} />
                    </button>
                  );
                })}
            </div>
          </>
        ) : (
          <>
            <section className="chart-panel expense-panel">
              <div className="expense-summary">
                <div>
                  <span>
                    净支出 <small>{book.currency}</small>
                  </span>
                  <Amount value={stats.net} currency={book.currency} />
                </div>
                <div className="expense-breakdown">
                  <span>
                    支出 <b>{money(stats.expense, book.currency)}</b>
                  </span>
                  <span>
                    退款 <b>{money(stats.refund, book.currency)}</b>
                  </span>
                </div>
              </div>
              {stats.missingCount > 0 && (
                <p className="report-warning">
                  {stats.missingCount} 笔外币交易待折算，尚未计入汇总。
                </p>
              )}
              {positiveTotal > 0n ? (
                <div className="donut-wrap">
                  <svg
                    viewBox="0 0 300 300"
                    role="img"
                    aria-label="支出分类双层环形图，内环为大类，外环为子类"
                  >
                    <title>支出分类：内环大类，外环子类</title>
                    {(() => {
                      let offset = 0;
                      return parentValues.map((p, i) => {
                        const start = offset,
                          end =
                            offset +
                            (Number((p.amount * 1000000n) / positiveTotal) /
                              1000000) *
                              Math.PI *
                              2;
                        offset = end;
                        let childOffset = start;
                        return (
                          <g
                            key={p.id}
                            style={{
                              color: p.color || colors[i % colors.length],
                            }}
                          >
                            <path
                              className="donut-segment"
                              d={arc(150, 150, 91, start + 0.008, end - 0.008)}
                              stroke="currentColor"
                              strokeWidth="34"
                              fill="none"
                              onClick={() => drill(p.id)}
                              tabIndex={0}
                              role="button"
                              aria-label={`${p.name} ${money(p.amount, book.currency)}`}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ")
                                  drill(p.id);
                              }}
                            />
                            <g opacity=".66">
                              {p.children.map((c) => {
                                const a = childOffset,
                                  b =
                                    a +
                                    (Number(
                                      (c.amount * 1000000n) / positiveTotal,
                                    ) /
                                      1000000) *
                                      Math.PI *
                                      2;
                                childOffset = b;
                                return (
                                  <path
                                    className="donut-segment"
                                    key={c.id}
                                    d={arc(150, 150, 123, a + 0.006, b - 0.006)}
                                    stroke="currentColor"
                                    strokeWidth="22"
                                    fill="none"
                                    onClick={() => drill(c.id)}
                                    tabIndex={0}
                                    role="button"
                                    aria-label={`${c.name} ${money(c.amount, book.currency)}`}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === " ")
                                        drill(c.id);
                                    }}
                                  />
                                );
                              })}
                            </g>
                          </g>
                        );
                      });
                    })()}
                    <text
                      x="150"
                      y="144"
                      textAnchor="middle"
                      className="donut-caption"
                    >
                      正向支出构成
                    </text>
                    <text
                      x="150"
                      y="171"
                      textAnchor="middle"
                      className="donut-total"
                    >
                      {money(positiveTotal, book.currency)}
                    </text>
                  </svg>
                </div>
              ) : (
                <Empty
                  icon="ChartNoAxesCombined"
                  title={negative.length ? "本期为净退款" : "本期暂无支出"}
                />
              )}
              {negative.length > 0 && (
                <p className="compact-note muted">
                  环图展示正向支出，净退款单列在下方。
                </p>
              )}
            </section>
            <div className="section-title">
              <h2>分类明细</h2>
              <button className="text-button" onClick={() => drill()}>
                查看交易
                <Icon name="ArrowRight" size={15} />
              </button>
            </div>
            <div className="category-stat-list">
              {parentValues.map((p, i) => (
                <details key={p.id} open>
                  <summary>
                    <span
                      className="legend-dot"
                      style={{
                        background: p.color || colors[i % colors.length],
                      }}
                    />
                    <strong>{p.name}</strong>
                    <span className="percent">
                      {(
                        Number((p.amount * 1000n) / (positiveTotal || 1n)) / 10
                      ).toFixed(1)}
                      %
                    </span>
                    <Amount value={p.amount} currency={book.currency} />
                    <Icon name="ChevronDown" size={15} />
                  </summary>
                  {p.children.map((c) => (
                    <button key={c.id} onClick={() => drill(c.id)}>
                      <Icon name={c.icon} size={17} />
                      <span>{c.name}</span>
                      <span className="percent">
                        {(
                          Number((c.amount * 1000n) / (positiveTotal || 1n)) /
                          10
                        ).toFixed(1)}
                        %
                      </span>
                      <Amount value={c.amount} currency={book.currency} />
                      <Icon name="ChevronRight" size={14} />
                    </button>
                  ))}
                </details>
              ))}
              {negative.map(([id, n]) => (
                <button
                  className="net-refund-row"
                  key={id}
                  onClick={() => drill(id)}
                >
                  <Icon name="RotateCcw" size={18} />
                  <span>
                    {book.categories.find((c) => c.id === id)?.name} · 净退款
                  </span>
                  <Amount value={n} currency={book.currency} />
                  <Icon name="ChevronRight" size={14} />
                </button>
              ))}
            </div>
          </>
        )}
      </main>
      {filter && (
        <Dialog title="报表筛选" dirty={false} onClose={() => setFilter(false)}>
          <div className="dialog-body report-filters">
            <div className="section-title">
              <h3>账户</h3>
              <button
                className="text-button"
                onClick={() =>
                  setIds(
                    ids.length === book.accounts.length
                      ? []
                      : book.accounts.map((a) => a.id),
                  )
                }
              >
                {ids.length === book.accounts.length ? "清空" : "全选"}
              </button>
            </div>
            {book.accounts.map((a) => (
              <label className="check-row" key={a.id}>
                <input
                  type="checkbox"
                  checked={ids.includes(a.id)}
                  onChange={() =>
                    setIds(
                      ids.includes(a.id)
                        ? ids.filter((id) => id !== a.id)
                        : [...ids, a.id],
                    )
                  }
                />
                <Icon name={a.icon} size={18} />
                <span>
                  {a.name}
                  {a.archived && <small>已归档</small>}
                </span>
                <small>{a.currency}</small>
              </label>
            ))}
            {type === "net" && (
              <button
                className="text-button restore-default"
                onClick={() =>
                  setIds(
                    book.accounts.filter((a) => a.netWorth).map((a) => a.id),
                  )
                }
              >
                恢复总净值账户范围
              </button>
            )}
            {type === "expense" && (
              <>
                <div className="section-title">
                  <h3>支出类目</h3>
                  <button
                    className="text-button"
                    onClick={() => setCategoryIds([])}
                  >
                    所有类目
                  </button>
                </div>
                {book.categories
                  .filter((c) => c.kind === "expense" && !c.parentId)
                  .map((p) => (
                    <details className="category-check" key={p.id}>
                      <summary>
                        <label
                          className="check-row"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={categoryIds.includes(p.id)}
                            onChange={() =>
                              setCategoryIds(
                                categoryIds.includes(p.id)
                                  ? categoryIds.filter((id) => id !== p.id)
                                  : [
                                      ...categoryIds.filter(
                                        (id) =>
                                          book.categories.find(
                                            (c) => c.id === id,
                                          )?.parentId !== p.id,
                                      ),
                                      p.id,
                                    ],
                              )
                            }
                          />
                          <Icon name={p.icon} size={18} />
                          {p.name}
                        </label>
                        <Icon name="ChevronDown" size={16} />
                      </summary>
                      {book.categories
                        .filter((c) => c.parentId === p.id)
                        .map((c) => (
                          <label key={c.id} className="check-row child">
                            <input
                              type="checkbox"
                              disabled={categoryIds.includes(p.id)}
                              checked={
                                categoryIds.includes(p.id) ||
                                categoryIds.includes(c.id)
                              }
                              onChange={() =>
                                setCategoryIds(
                                  categoryIds.includes(c.id)
                                    ? categoryIds.filter((id) => id !== c.id)
                                    : [...categoryIds, c.id],
                                )
                              }
                            />
                            {c.name}
                          </label>
                        ))}
                    </details>
                  ))}
              </>
            )}
            <div className="dialog-footer">
              <Button onClick={() => setFilter(false)}>应用筛选</Button>
            </div>
          </div>
        </Dialog>
      )}
      {saving && (
        <Dialog title="保存报表" onClose={() => setSaving(false)}>
          <form
            className="dialog-body"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await app.save("保存报表", (b) => {
                  b.settings.savedReports.push({
                    id: uid(),
                    name: saveName.trim(),
                    type,
                    days,
                    from,
                    to,
                    accountIds: ids,
                    categoryIds,
                  });
                })
              )
                setSaving(false);
            }}
          >
            <Field label="名称">
              <input
                autoFocus
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                required
                maxLength={40}
                placeholder={type === "net" ? "我的净值走势" : "每月消费"}
              />
            </Field>
            <p className="compact-note muted">
              相对时间在每次打开时更新，账户与类目保留当前选择。
            </p>
            <div className="dialog-footer">
              <Button type="submit">保存</Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
function NetChart({
  values,
  selected,
  onSelect,
  currency,
}: {
  values: { date: string; value: bigint }[];
  selected: number;
  onSelect: (n: number) => void;
  currency: string;
}) {
  if (!values.length) return null;
  const width = 640,
    height = 230,
    left = 16,
    right = 624,
    top = 24,
    bottom = 192,
    nums = values.map((v) => Number(v.value)),
    min = Math.min(...nums),
    max = Math.max(...nums),
    spread = max - min || Math.max(Math.abs(max) * 0.1, 100),
    y = (v: number) => bottom - ((v - min) / spread) * (bottom - top),
    x = (i: number) =>
      left + (i / Math.max(1, values.length - 1)) * (right - left),
    path = values
      .map((v, i) => `${i ? "L" : "M"}${x(i)},${y(Number(v.value))}`)
      .join(" "),
    index = Math.min(Math.max(0, selected), values.length - 1);
  return (
    <div className="net-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="净值走势，拖动查看日期"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
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
        }}
        onPointerMove={(e) => {
          if (e.buttons) {
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
        }}
      >
        <defs>
          <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity=".15" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
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
        <path
          d={`${path} L ${right},${bottom} L ${left},${bottom} Z`}
          fill="url(#chart-fill)"
        />
        <path
          d={path}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
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
        <circle
          cx={x(index)}
          cy={y(nums[index])}
          r="4"
          fill="var(--accent)"
          stroke="var(--surface)"
          strokeWidth="2"
        />
        <text x={left} y="222" className="chart-label">
          {values[0].date.slice(5).replace("-", "/")}
        </text>
        <text x={right} y="222" textAnchor="end" className="chart-label">
          {values.at(-1)!.date.slice(5).replace("-", "/")}
        </text>
      </svg>
      <input
        type="range"
        min="0"
        max={values.length - 1}
        value={index}
        onChange={(e) => onSelect(Number(e.target.value))}
        aria-label="选择净值日期"
        aria-valuetext={`${values[index].date} ${money(values[index].value, currency)} ${currency}`}
      />
    </div>
  );
}
