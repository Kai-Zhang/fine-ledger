import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  reportRange,
  reportPresets,
  reportAccounts,
  reportGrains,
  reportTypes,
  isTimeSeriesReport,
  type ReportPeriod,
  type ReportRequest,
} from "../domain/reporting.ts";
import { useReport } from "../reports/useReport.ts";
import { NetChart } from "../reports/NetChart.tsx";
import { PeriodChart } from "../reports/PeriodChart.tsx";
import { CategoryBreakdown } from "../reports/CategoryBreakdown.tsx";
import type { RingLayer } from "../reports/donut-model.ts";
import { startOfDay, endOfDay } from "../domain/dates.ts";
import { sortedProjects } from "../domain/organization.ts";
import { money } from "../domain/money.ts";
import {
  uid,
  type SavedReport,
  type ReportGrain,
  type ReportMetric,
  type ReportType,
} from "../domain/types.ts";
export { ReportCatalog } from "./ReportCatalog.tsx";

type StockMode = "net" | "balance";
interface View {
  type?: ReportType;
  stockScopes?: Partial<Record<StockMode, string[]>>;
  days: string;
  from: string;
  to: string;
  ids: string[];
  categoryIds: string[];
  projectIds: string[];
  grain: ReportGrain;
  metric: ReportMetric;
  chart: "bar" | "line";
  point: number | null;
  selectedCategory: string | null;
  layer: RingLayer;
  frame?: number;
}
export function Reports() {
  const app = useApp(),
    { book, route } = app;
  const saved = book.settings.savedReports.find(
    (r) => r.id === route.savedReportId,
  );
  const viewKey = `${app.mode}:reports:${JSON.stringify(route)}`;
  const cached = app.views.get(viewKey) as View | undefined;
  const sameFrame =
    app.frameKey !== undefined && cached?.frame === app.frameKey;
  const [type, setType] = useState<ReportType>(
    (sameFrame && cached?.type) || saved?.type || route.report || "net",
  );
  const stockScopes = useRef(
    cached?.stockScopes || ({} as Partial<Record<StockMode, string[]>>),
  );
  const stock = type === "net" || type === "balance";
  const income = type === "income" || type === "income-trend";
  const series = isTimeSeriesReport(type);
  const initialDays =
    cached?.days ||
    saved?.days ||
    route.reportDays ||
    (route.from && route.to
      ? "custom"
      : type === "project"
        ? "all"
        : type === "expense-trend" ||
            type === "income-trend" ||
            type === "cashflow"
          ? "12months"
          : income
            ? "month"
            : "30");
  const range = () =>
    initialDays === "custom"
      ? {
          from: cached?.from || saved?.from || route.from!,
          to: cached?.to || saved?.to || route.to!,
        }
      : reportRange(book, initialDays);
  const [days, setDays] = useState(initialDays),
    [from, setFrom] = useState(() => range().from),
    [to, setTo] = useState(() => range().to);
  const [ids, setIds] = useState<string[]>(
    () =>
      (cached?.type === type
        ? cached.ids
        : type === "net" || type === "balance"
          ? cached?.stockScopes?.[type]
          : undefined) ||
      saved?.accountIds.filter((id) =>
        book.accounts.some((a) => a.id === id),
      ) ||
      (route.accountId
        ? [route.accountId]
        : route.accountIds
          ? route.accountIds
          : type === "balance"
            ? []
            : book.accounts
                .filter((a) => type !== "net" || a.netWorth)
                .map((a) => a.id)),
  );
  const [categoryIds, setCategoryIds] = useState<string[]>(
    cached?.categoryIds || saved?.categoryIds || route.categoryIds || [],
  );
  const [projectIds, setProjectIds] = useState<string[]>(
    cached?.projectIds || saved?.projectIds || route.projectIds || [],
  );
  const [grain, setGrain] = useState<ReportGrain>(
    cached?.grain || saved?.grain || route.grain || (stock ? "day" : "month"),
  );
  const [metric, setMetric] = useState<ReportMetric>(
    cached?.metric ||
      saved?.metric ||
      (type === "expense-trend" ? "expense" : "net"),
  );
  const [chart, setChart] = useState<"bar" | "line">(
    cached?.chart || saved?.chart || "bar",
  );
  const [point, setPoint] = useState<number | null>(
    sameFrame ? (cached?.point ?? null) : null,
  );
  const [selectedCategory, setSelectedCategory] = useState<string | null>(
    sameFrame ? cached?.selectedCategory || null : null,
  );
  const [layer, setLayer] = useState<RingLayer>(
    sameFrame ? cached?.layer || "child" : "child",
  );
  const [filter, setFilter] = useState(false),
    [draftIds, setDraftIds] = useState<string[]>([]),
    [draftCategories, setDraftCategories] = useState<string[]>([]),
    [draftProjects, setDraftProjects] = useState<string[]>([]);
  const [saving, setSaving] = useState(false),
    [saveName, setSaveName] = useState(""),
    [limit, setLimit] = useState(48);
  const accounts = useMemo(
    () => reportAccounts(book),
    [book.accounts, book.groups],
  );
  const selectableAccounts =
    type === "balance"
      ? accounts.filter((a) => a.currency !== book.currency)
      : accounts;
  const noForeignAccounts = type === "balance" && !selectableAccounts.length;
  const projects = useMemo(
    () => sortedProjects(book.projects),
    [book.projects],
  );
  const selectedAccount = book.accounts.find((a) => a.id === ids[0]);
  const currency =
    type === "balance"
      ? selectedAccount?.currency || book.currency
      : book.currency;
  const projectOverview = type === "project" && !projectIds.length;
  const valid = !!from && !!to && from <= to;
  const request = useMemo<ReportRequest | null>(
    () =>
      valid && (type !== "balance" || ids.length === 1)
        ? {
            book,
            type,
            from,
            to,
            ids,
            categoryIds,
            projectIds,
            grain,
            now: new Date().toISOString(),
          }
        : null,
    [book, type, from, to, ids, categoryIds, projectIds, grain, valid],
  );
  const { result, pending, error } = useReport(request);
  const periods = result?.periods || [],
    summary = result?.summary;
  const index = Math.min(
      point ?? (stock ? periods.length - 1 : -1),
      periods.length - 1,
    ),
    current = periods[index];
  const title = stock
    ? "余额与净值"
    : reportTypes.find((r) => r.type === type)?.name || "报表";
  function switchStock(mode: StockMode, accountId?: string) {
    if (!stock || (mode === type && !accountId)) return;
    stockScopes.current = { ...stockScopes.current, [type]: ids };
    setType(mode);
    setIds(
      accountId
        ? [accountId]
        : stockScopes.current[mode] ||
            (mode === "net"
              ? book.accounts.filter((a) => a.netWorth).map((a) => a.id)
              : []),
    );
    reset();
  }
  function reset() {
    setPoint(null);
    setSelectedCategory(null);
    setLimit(48);
  }
  useEffect(() => {
    app.views.set(viewKey, {
      type,
      stockScopes: stockScopes.current,
      days,
      from,
      to,
      ids,
      categoryIds,
      projectIds,
      grain,
      metric,
      chart,
      point,
      selectedCategory,
      layer,
      frame: app.frameKey,
    });
  }, [
    viewKey,
    type,
    days,
    from,
    to,
    ids,
    categoryIds,
    projectIds,
    grain,
    metric,
    chart,
    point,
    selectedCategory,
    layer,
    app.frameKey,
  ]);
  useEffect(() => {
    if (days !== "custom") {
      const r = reportRange(book, days);
      if (r.from !== from || r.to !== to) {
        setFrom(r.from);
        setTo(r.to);
        reset();
      }
    }
  }, [days, book.timeZone, book.entries, book.accounts]);
  function openFilter() {
    setDraftIds(ids);
    setDraftCategories(categoryIds);
    setDraftProjects(projectIds);
    setFilter(true);
  }
  function drill(
    period?: ReportPeriod,
    category?: string,
    mode: "income" | "expense" | "refund" | "net" | "all" = income
      ? "income"
      : type === "expense-trend"
        ? metric
        : type === "cashflow"
          ? "all"
          : "net",
  ) {
    const kinds: Record<typeof mode, ("expense" | "income" | "refund")[]> = {
      income: ["income"],
      expense: ["expense"],
      refund: ["refund"],
      net: ["expense", "refund"],
      all: ["expense", "income", "refund"],
    };
    app.go({
      page: "transactions",
      from: startOfDay(period?.from || from, book.timeZone),
      to: endOfDay(period?.to || to, book.timeZone),
      accountId: ids.length === 1 ? ids[0] : undefined,
      accountIds: ids,
      categoryIds: category ? [category] : categoryIds,
      projectIds,
      postedOnly: true,
      reportKinds: kinds[mode],
      reportCurrency: book.currency,
      reportMeasure: mode === "all" ? "surplus" : mode,
    });
  }
  function snapshotDrill(period: ReportPeriod) {
    const end = endOfDay(period.to, book.timeZone),
      now = new Date().toISOString();
    app.go({
      page: "transactions",
      accountId: type === "balance" || ids.length === 1 ? ids[0] : undefined,
      accountIds: ids,
      to: end > now ? now : end,
      postedOnly: true,
      reportKind: "net",
    });
  }
  const periodValue = (p: ReportPeriod) =>
    stock
      ? p.total
      : income
        ? p.income
        : metric === "expense"
          ? p.expense
          : metric === "refund"
            ? p.refund
            : p.net;
  const periodMissing = (p: ReportPeriod) =>
    stock || type === "cashflow"
      ? p.missingCount
      : income
        ? p.missingIncomeCount
        : metric === "expense"
          ? p.missingExpenseCount
          : metric === "refund"
            ? p.missingRefundCount
            : p.missingExpenseCount + p.missingRefundCount;
  const periodCount = (p: ReportPeriod) =>
    type === "cashflow"
      ? p.count
      : income
        ? p.incomeCount
        : metric === "expense"
          ? p.expenseCount
          : metric === "refund"
            ? p.refundCount
            : p.expenseCount + p.refundCount;
  const valueName = stock
    ? type === "net"
      ? "净值"
      : "余额"
    : income
      ? "收入"
      : metric === "expense"
        ? "支出"
        : metric === "refund"
          ? "退款"
          : "净支出";
  const shortLabel = (p: ReportPeriod) =>
    grain === "year"
      ? p.from.slice(0, 4)
      : grain === "quarter"
        ? `${p.from.slice(0, 4)} Q${Math.ceil(Number(p.from.slice(5, 7)) / 3)}`
        : grain === "month"
          ? p.from.slice(0, 7)
          : p.from.slice(5).replace("-", "/");
  const missing = stock
    ? current?.missingCount || 0
    : summary?.missingCount || 0;
  return (
    <>
      <Header
        title={
          (saved?.type === type ? saved.name : undefined) ||
          (type === "project" && projectIds.length === 1
            ? book.projects.find((p) => p.id === projectIds[0])?.name
            : undefined) ||
          title
        }
        back
      >
        <IconButton
          name="Plus"
          label="保存当前报表"
          onClick={() => {
            setSaveName("");
            setSaving(true);
          }}
        />
      </Header>
      <main
        className="page-content reports-page"
        onClick={(e) => {
          const target = e.target;
          if (
            !(target instanceof Element) ||
            target.closest(
              'button,input,select,textarea,summary,a,svg,[role="button"],[role="slider"]',
            )
          )
            return;
          if (
            !Array.from(target.childNodes).some(
              (n) => n.nodeType === Node.TEXT_NODE && !!n.textContent?.trim(),
            )
          )
            setSelectedCategory(null);
        }}
      >
        {stock && (
          <div className="report-stock-mode" role="group" aria-label="查看口径">
            <button
              aria-pressed={type === "net"}
              onClick={() => switchStock("net")}
            >
              <span>主币净值</span>
            </button>
            <button
              aria-pressed={type === "balance"}
              onClick={() => switchStock("balance")}
            >
              <span>原币余额</span>
            </button>
          </div>
        )}
        <div className="report-toolbar">
          <select
            aria-label="报表时间范围"
            value={days}
            onChange={(e) => {
              setDays(e.target.value);
              reset();
            }}
          >
            {reportPresets.map(([v, name]) => (
              <option key={v} value={v}>
                {name}
              </option>
            ))}
          </select>
          <button
            className="report-scope-button"
            aria-label="筛选报表"
            onClick={openFilter}
            disabled={noForeignAccounts}
          >
            <Icon name="ListFilter" size={18} />
            {type === "balance"
              ? selectedAccount?.name || "选择账户"
              : ids.length === book.accounts.length
                ? "所有账户"
                : `${ids.length} 个账户`}
          </button>
        </div>
        {days === "custom" && (
          <div className="date-range">
            <input
              type="date"
              aria-label="开始日期"
              value={from}
              onChange={(e) => {
                if (e.target.value) setFrom(e.target.value);
                reset();
              }}
            />
            <span>至</span>
            <input
              type="date"
              aria-label="结束日期"
              value={to}
              onChange={(e) => {
                if (e.target.value) setTo(e.target.value);
                reset();
              }}
            />
          </div>
        )}
        <p className="report-scope-summary">
          {from} — {to}
          {projectIds.length > 0 &&
            ` · ${projectIds.map((id) => book.projects.find((p) => p.id === id)?.name || (id === "none" ? "未设置项目" : "已删除项目")).join("、")}`}
          {categoryIds.length > 0 && ` · ${categoryIds.length} 个类目`}
        </p>
        {series && (
          <div className="report-aggregation">
            <label>
              <span>按期{stock ? "末" : "汇总"}</span>
              <select
                aria-label="聚合粒度"
                value={grain}
                onChange={(e) => {
                  setGrain(e.target.value as ReportGrain);
                  reset();
                }}
              >
                {reportGrains.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            {!stock && (
              <>
                {!income && type !== "cashflow" && (
                  <label>
                    <span>
                      {type === "expense-trend" ? "指标" : "分期指标"}
                    </span>
                    <select
                      aria-label="报表指标"
                      value={metric}
                      onChange={(e) => {
                        setMetric(e.target.value as ReportMetric);
                        reset();
                      }}
                    >
                      <option value="expense">支出</option>
                      <option value="net">净支出</option>
                      <option value="refund">退款</option>
                    </select>
                  </label>
                )}
                <div
                  className="chart-style-switch"
                  role="group"
                  aria-label="图表样式"
                >
                  <IconButton
                    name="ChartNoAxesColumn"
                    label="条形图"
                    aria-pressed={chart === "bar"}
                    onClick={() => setChart("bar")}
                  />
                  <IconButton
                    name="ChartNoAxesCombined"
                    label="折线图"
                    aria-pressed={chart === "line"}
                    onClick={() => setChart("line")}
                  />
                </div>
              </>
            )}
          </div>
        )}
        {!valid ? (
          <p className="error-banner" role="alert">
            结束日期不能早于开始日期。
          </p>
        ) : !ids.length ? (
          <Empty
            title={
              type === "balance"
                ? noForeignAccounts
                  ? "暂无外币账户"
                  : "选择外币账户查看原币余额"
                : "选择账户查看报表"
            }
            icon="Wallet"
            action={
              noForeignAccounts ? undefined : (
                <Button onClick={openFilter}>选择账户</Button>
              )
            }
          />
        ) : error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : pending || !result ? (
          <div className="report-loading" role="status">
            <Icon name="LoaderCircle" />
            <p>正在生成报表…</p>
          </div>
        ) : stock && !periods.length ? (
          <Empty icon="CalendarDays" title="所选范围尚未发生" />
        ) : projectOverview ? (
          <>
            <p className="compact-note muted">
              选择项目查看全部关联时间的支出与退款，也可调整上方时间范围。
            </p>
            {projects.length ? (
              <div className="project-report-list">
                {projects.map((p, i) => {
                  const totals = result.projects.get(p.id);
                  return (
                    <div key={p.id}>
                      {(i === 0 || projects[i - 1].archived !== p.archived) && (
                        <h3 className="report-filter-heading">
                          {p.archived ? "已归档" : "未归档"}
                        </h3>
                      )}
                      <button
                        className="project-report-row"
                        onClick={() =>
                          app.go({
                            page: "report",
                            report: "project",
                            projectIds: [p.id],
                            accountIds: ids,
                            from,
                            to,
                            reportDays: days,
                            categoryIds,
                            grain,
                          })
                        }
                      >
                        <Icon name="Folder" />
                        <span>
                          <strong>{p.name}</strong>
                          <small>
                            {totals?.missingCount
                              ? "部分外币金额未计入"
                              : "净支出"}
                            {p.archived ? " · 已归档" : ""}
                          </small>
                        </span>
                        <Amount
                          value={totals?.net || 0n}
                          currency={book.currency}
                          code
                        />
                        <Icon name="ChevronRight" size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Empty
                title="还没有项目"
                icon="Folder"
                action={
                  <Button onClick={() => app.go({ page: "projects" })}>
                    管理项目
                  </Button>
                }
              />
            )}
            {result.unresolvedRefunds.length > 0 && (
              <p className="report-warning">
                有 {result.unresolvedRefunds.length}{" "}
                笔关联退款尚未明确项目归属，请在交易详情补充。
              </p>
            )}
          </>
        ) : (
          <>
            {missing > 0 && (
              <p className="report-warning">
                部分外币金额未计入{stock ? "净值" : "汇总"}（{missing}{" "}
                {stock ? "个账户" : "笔"}）。
                {!stock &&
                  [...result.missingCurrencies]
                    .map(([c, n]) => `${money(n, c)} ${c}`)
                    .join("、")}
                {!stock && (
                  <button
                    className="text-button"
                    onClick={() =>
                      app.go({
                        page: "transactions",
                        accountIds: ids,
                        from: startOfDay(from, book.timeZone),
                        to: endOfDay(to, book.timeZone),
                        postedOnly: true,
                        reportKinds: income
                          ? ["income"]
                          : type === "cashflow"
                            ? ["expense", "refund", "income"]
                            : ["expense", "refund"],
                        projectIds,
                        categoryIds,
                        reportIssue: "unpriced",
                      })
                    }
                  >
                    查看未计入记录
                    <Icon name="ArrowRight" size={14} />
                  </button>
                )}
              </p>
            )}
            {stock ? (
              <>
                <section className="chart-panel net-panel">
                  <div className="report-value">
                    <span>
                      {current?.label || "—"} · {missing ? "已计入部分 · " : ""}
                      {valueName}
                      <small>{currency}</small>
                    </span>
                    <Amount value={current?.total || 0n} currency={currency} />
                    <small className="muted">
                      {missing || result.baselineIncomplete
                        ? "期初或期末金额不完整，暂不比较变化"
                        : `较期初 ${money((current?.total || 0n) - result.baseline, currency)}`}
                    </small>
                  </div>
                  {type === "balance" && selectedAccount?.type === "credit" && (
                    <p className="compact-note muted">
                      {(current?.total || 0n) < 0n
                        ? "负余额表示欠款"
                        : "正余额表示溢缴款"}
                    </p>
                  )}
                  <NetChart
                    values={result.points}
                    selected={index}
                    onSelect={setPoint}
                    currency={currency}
                    label={valueName}
                  />
                  <p className="chart-help">
                    各期取期末{valueName}，今天截至当前；余额不按日相加。
                  </p>
                </section>
                {type === "net" && (
                  <>
                    <div className="section-title">
                      <h2>账户构成</h2>
                      <span>{current?.to}</span>
                    </div>
                    <div className="report-account-list">
                      {accounts
                        .filter((a) => ids.includes(a.id))
                        .map((a) => (
                          <button
                            key={a.id}
                            onClick={() => switchStock("balance", a.id)}
                          >
                            <span className="account-symbol">
                              <Icon name={a.icon} />
                            </span>
                            <span>
                              {a.name}
                              {a.archived && <small>已归档</small>}
                            </span>
                            <Amount
                              value={current?.balances[a.id] || 0n}
                              currency={a.currency}
                              code
                            />
                            <Icon name="ChevronRight" size={15} />
                          </button>
                        ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                {(type === "expense-trend" ||
                  type === "income-trend" ||
                  type === "cashflow" ||
                  type === "project") && (
                  <section className="chart-panel report-flow-summary">
                    <div className="report-value">
                      <span>
                        {missing > 0 ? "已计入部分 · " : ""}
                        {type === "cashflow"
                          ? "收支结余"
                          : type === "project"
                            ? "项目净支出"
                            : valueName}
                        <small>{book.currency}</small>
                      </span>
                      <Amount
                        value={
                          type === "cashflow"
                            ? summary!.surplus
                            : income
                              ? summary!.income
                              : type === "project"
                                ? summary!.net
                                : metric === "expense"
                                  ? summary!.expense
                                  : metric === "refund"
                                    ? summary!.refund
                                    : summary!.net
                        }
                        currency={book.currency}
                      />
                    </div>
                    {!income && (
                      <div className="report-summary-grid">
                        {(type === "cashflow"
                          ? [
                              ["收入", summary!.income, "income"],
                              ["支出", summary!.expense, "expense"],
                              ["退款", summary!.refund, "refund"],
                              ["净支出", summary!.net, "net"],
                            ]
                          : [
                              ["支出", summary!.expense, "expense"],
                              ["退款", summary!.refund, "refund"],
                            ]
                        ).map(([name, value, mode]) => (
                          <button
                            key={String(name)}
                            onClick={() =>
                              drill(
                                undefined,
                                undefined,
                                mode as "income" | "expense" | "refund" | "net",
                              )
                            }
                          >
                            <small>{String(name)}</small>
                            <Amount
                              value={value as bigint}
                              currency={book.currency}
                            />
                            <Icon name="ChevronRight" size={13} />
                          </button>
                        ))}
                      </div>
                    )}
                    {type === "cashflow" && (
                      <p className="compact-note muted">
                        结余为收入减净支出，转账与余额调整不计收支。
                      </p>
                    )}
                  </section>
                )}
                {(type === "expense" ||
                  type === "income" ||
                  type === "project") && (
                  <CategoryBreakdown
                    book={book}
                    stats={result.stats}
                    selectedCategory={selectedCategory}
                    selectedCategoryLayer={layer}
                    selectCategory={(id, nextLayer) => {
                      setSelectedCategory(id);
                      setLayer(nextLayer);
                    }}
                    onClear={() => setSelectedCategory(null)}
                    drill={(id) => drill(undefined, id)}
                    income={income}
                    hideSummary={type === "project"}
                  />
                )}
                {series && (
                  <>
                    <div className="section-title">
                      <h2>期间变化</h2>
                      <span>
                        按{reportGrains.find((g) => g.value === grain)?.name}
                      </span>
                    </div>
                    <section className="chart-panel period-panel">
                      <PeriodChart
                        labels={periods.map(shortLabel)}
                        series={
                          type === "cashflow"
                            ? [
                                {
                                  name: "收入",
                                  color: "var(--positive)",
                                  values: periods.map((p) =>
                                    p.missingIncomeCount ? null : p.income,
                                  ),
                                },
                                {
                                  name: "净支出",
                                  color: "var(--negative)",
                                  values: periods.map((p) =>
                                    p.missingExpenseCount + p.missingRefundCount
                                      ? null
                                      : p.net,
                                  ),
                                },
                              ]
                            : [
                                {
                                  name: valueName,
                                  color: income
                                    ? "var(--positive)"
                                    : "var(--accent)",
                                  values: periods.map((p) =>
                                    periodMissing(p) ? null : periodValue(p),
                                  ),
                                },
                              ]
                        }
                        chart={chart}
                        currency={book.currency}
                        selected={point}
                        onSelect={setPoint}
                      />
                      {current && (
                        <div className="period-inspection" aria-live="polite">
                          <span>
                            <strong>{current.label}</strong>
                            <small>
                              {periodCount(current)} 笔
                              {periodMissing(current) ? " · 金额不完整" : ""}
                            </small>
                          </span>
                          <Amount
                            value={
                              type === "cashflow"
                                ? current.surplus
                                : periodValue(current)
                            }
                            currency={book.currency}
                          />
                          <IconButton
                            name="List"
                            label="查看选中期间交易"
                            onClick={() => drill(current)}
                          />
                        </div>
                      )}
                    </section>
                  </>
                )}
              </>
            )}
            {result.unresolvedRefunds.length > 0 && (
              <p className="report-warning">
                另有 {result.unresolvedRefunds.length}{" "}
                笔关联退款的项目归属待确认，项目净支出可能不完整。
                <button
                  className="text-button"
                  onClick={() =>
                    app.go({
                      page: "transactions",
                      entryIds: result.unresolvedRefunds,
                      postedOnly: true,
                    })
                  }
                >
                  查看退款
                  <Icon name="ArrowRight" size={14} />
                </button>
              </p>
            )}
            {series && (
              <>
                <div className="section-title">
                  <h2>期间明细</h2>
                  <span>{periods.length} 期</span>
                </div>
                <div className="report-period-list">
                  {periods
                    .map((p, i) => ({ p, i }))
                    .reverse()
                    .slice(0, limit)
                    .map(({ p, i }) => (
                      <div
                        key={p.from}
                        className={`report-period-row ${index === i ? "is-selected" : ""}`}
                      >
                        <button
                          className="report-period-main"
                          onClick={() => setPoint(i)}
                        >
                          <span>
                            <strong>{p.label}</strong>
                            <small>
                              {stock ? "期末" : `${periodCount(p)} 笔`}{" "}
                              {stock
                                ? valueName
                                : type === "cashflow"
                                  ? "收支结余"
                                  : valueName}
                              {periodMissing(p) ? " · 金额不完整" : ""}
                            </small>
                          </span>
                          <Amount
                            value={
                              type === "cashflow" ? p.surplus : periodValue(p)
                            }
                            currency={currency}
                          />
                        </button>
                        <IconButton
                          name="List"
                          label={`查看${p.label}交易`}
                          onClick={() => (stock ? snapshotDrill(p) : drill(p))}
                        />
                      </div>
                    ))}
                </div>
                {periods.length > limit && (
                  <button
                    className="load-more"
                    onClick={() => setLimit(limit + 48)}
                  >
                    加载更多 · 还有 {periods.length - limit} 期
                  </button>
                )}
              </>
            )}
          </>
        )}
      </main>
      {filter && (
        <Dialog title="报表筛选" onClose={() => setFilter(false)}>
          <div className="dialog-body report-filters">
            <div className="section-title">
              <h3>{type === "balance" ? "选择外币账户" : "账户"}</h3>
              {type !== "balance" && (
                <button
                  className="text-button"
                  onClick={() =>
                    setDraftIds(
                      draftIds.length === accounts.length
                        ? []
                        : accounts.map((a) => a.id),
                    )
                  }
                >
                  {draftIds.length === accounts.length ? "清空" : "全选"}
                </button>
              )}
            </div>
            {selectableAccounts.map((a, i) => (
              <div key={a.id}>
                {(i === 0 ||
                  selectableAccounts[i - 1].archived !== a.archived) && (
                  <h4 className="report-filter-heading">
                    {a.archived ? "已归档" : "未归档"}
                  </h4>
                )}
                <label className="check-row">
                  <input
                    type={type === "balance" ? "radio" : "checkbox"}
                    name="report-account"
                    checked={draftIds.includes(a.id)}
                    onChange={() =>
                      setDraftIds(
                        type === "balance"
                          ? [a.id]
                          : draftIds.includes(a.id)
                            ? draftIds.filter((id) => id !== a.id)
                            : [...draftIds, a.id],
                      )
                    }
                  />
                  <Icon name={a.icon} size={18} />
                  <span>{a.name}</span>
                  <small>{a.currency}</small>
                </label>
              </div>
            ))}
            {type === "net" && (
              <button
                className="text-button restore-default"
                onClick={() =>
                  setDraftIds(
                    accounts.filter((a) => a.netWorth).map((a) => a.id),
                  )
                }
              >
                恢复总净值账户范围
              </button>
            )}
            {!stock && (
              <>
                <div className="section-title">
                  <h3>类目</h3>
                  <button
                    className="text-button"
                    onClick={() => setDraftCategories([])}
                  >
                    所有类目
                  </button>
                </div>
                {book.categories
                  .filter(
                    (c) =>
                      !c.parentId &&
                      (type === "cashflow" ||
                        c.kind === (income ? "income" : "expense")),
                  )
                  .map((p) => (
                    <details className="category-check" key={p.id}>
                      <summary>
                        <label
                          className="check-row"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={draftCategories.includes(p.id)}
                            onChange={() =>
                              setDraftCategories(
                                draftCategories.includes(p.id)
                                  ? draftCategories.filter((id) => id !== p.id)
                                  : [
                                      ...draftCategories.filter(
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
                          <label className="check-row child" key={c.id}>
                            <input
                              type="checkbox"
                              disabled={draftCategories.includes(p.id)}
                              checked={
                                draftCategories.includes(p.id) ||
                                draftCategories.includes(c.id)
                              }
                              onChange={() =>
                                setDraftCategories(
                                  draftCategories.includes(c.id)
                                    ? draftCategories.filter(
                                        (id) => id !== c.id,
                                      )
                                    : [...draftCategories, c.id],
                                )
                              }
                            />
                            {c.name}
                          </label>
                        ))}
                    </details>
                  ))}
                <div className="section-title">
                  <h3>项目</h3>
                  <button
                    className="text-button"
                    onClick={() => setDraftProjects([])}
                  >
                    所有项目
                  </button>
                </div>
                {[
                  { id: "none", name: "未设置项目", archived: false },
                  ...projects,
                ].map((p) => (
                  <label className="check-row" key={p.id}>
                    <input
                      type="checkbox"
                      checked={draftProjects.includes(p.id)}
                      onChange={() =>
                        setDraftProjects(
                          draftProjects.includes(p.id)
                            ? draftProjects.filter((id) => id !== p.id)
                            : [...draftProjects, p.id],
                        )
                      }
                    />
                    <span>
                      {p.name}
                      {p.archived && <small>已归档</small>}
                    </span>
                  </label>
                ))}
              </>
            )}
            <div className="dialog-footer">
              <Button
                onClick={() => {
                  const different = (a: string[], b: string[]) =>
                    a.length !== b.length || a.some((id) => !b.includes(id));
                  if (
                    different(ids, draftIds) ||
                    different(categoryIds, draftCategories) ||
                    different(projectIds, draftProjects)
                  )
                    reset();
                  setIds(draftIds);
                  setCategoryIds(draftCategories);
                  setProjectIds(draftProjects);
                  setFilter(false);
                }}
              >
                应用筛选
              </Button>
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
              if (!ids.length || (type === "balance" && ids.length !== 1))
                return;
              const report: SavedReport = {
                id: uid(),
                name: saveName.trim(),
                type,
                days,
                from,
                to,
                accountIds: ids,
                categoryIds,
                projectIds,
                ...(series
                  ? { grain, ...(stock ? {} : { metric, chart }) }
                  : {}),
              };
              if (
                await app.save("保存报表", (b) => {
                  b.settings.savedReports.push(report);
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
                placeholder={`我的${title}`}
                required
                maxLength={40}
              />
            </Field>
            <p className="compact-note muted">
              保存时间条件与筛选{series ? "，以及当前图表设置" : ""}
              ；相对时间在打开时更新。
            </p>
            {!ids.length && <p className="error-banner">请先选择账户。</p>}
            <div className="dialog-footer">
              <Button type="submit" disabled={!ids.length}>
                保存
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
