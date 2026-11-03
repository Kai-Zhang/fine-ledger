import { Temporal } from "@js-temporal/polyfill";
import type { Book, Entry, ReportType, ReportGrain } from "./types.ts";
import { localDate, endOfDay, dateOffset } from "./dates.ts";
import { roundedRatio } from "./money.ts";
import { categoryStats, refundOriginalId } from "./ledger.ts";
import { convertedSplits } from "./report-amounts.ts";
import { categoryMatches } from "./filters.ts";

export const reportPresets = [
  ["30", "近 30 天"],
  ["90", "近 90 天"],
  ["6months", "近 6 个月"],
  ["12months", "近 12 个月"],
  ["month", "本月"],
  ["year", "今年"],
  ["lastYear", "去年"],
  ["all", "所有时间"],
  ["custom", "自定义时间"],
] as const;
export const reportRangeLabel = (days: string) =>
  reportPresets.find((p) => p[0] === days)?.[1] || `近 ${days} 天`;
// Same instant ordering as the ledger, including imported sub-millisecond times.
const instant = (iso: string) =>
  BigInt(Math.floor(Date.parse(iso) / 1000)) * 1000000000n +
  BigInt((iso.match(/\.(\d+)/)?.[1] || "").padEnd(9, "0").slice(0, 9) || "0");
export function reportRange(
  book: Book,
  days: string,
  now = new Date().toISOString(),
) {
  const today = Temporal.PlainDate.from(localDate(now, book.timeZone));
  let from = today,
    to = today;
  if (days === "month") from = today.with({ day: 1 });
  else if (days === "year") from = today.with({ month: 1, day: 1 });
  else if (days === "lastYear") {
    from = today.subtract({ years: 1 }).with({ month: 1, day: 1 });
    to = from.with({ month: 12, day: 31 });
  } else if (days === "6months" || days === "12months")
    from = today
      .subtract({ months: days === "6months" ? 6 : 12 })
      .add({ days: 1 });
  else if (days === "all") {
    let earliest = now,
      key = instant(now);
    for (const value of [
      ...book.accounts.map((a) => a.openingAt),
      ...book.entries
        .filter((e) => !e.deletedAt)
        .flatMap((e) => [
          e.occurredAt,
          ...(e.receivedAt ? [e.receivedAt] : []),
        ]),
    ]) {
      const time = instant(value);
      if (time < key) {
        key = time;
        earliest = value;
      }
    }
    from = Temporal.PlainDate.from(localDate(earliest, book.timeZone));
  } else if (days !== "custom")
    from = today.subtract({ days: Math.max(1, Number(days) || 30) - 1 });
  return { from: from.toString(), to: to.toString() };
}
export function reportAccounts(book: Book) {
  const groups = new Map(book.groups.map((g) => [g.id, g.order]));
  return [...book.accounts].sort(
    (a, b) =>
      Number(a.archived) - Number(b.archived) ||
      (groups.get(a.groupId) ?? -1) - (groups.get(b.groupId) ?? -1) ||
      a.order - b.order ||
      a.id.localeCompare(b.id),
  );
}
const lower = <T>(rows: T[], test: (row: T) => boolean) => {
  let lo = 0,
    hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (test(rows[mid])) hi = mid;
    else lo = mid + 1;
  }
  return lo;
};
type Rate = { n: bigint; d: bigint; provisional: boolean };
export function reportIndex(book: Book) {
  const accounts = new Map(book.accounts.map((a) => [a.id, a]));
  const timelines = new Map<string, { at: bigint; amount: bigint }[]>();
  const anchors = new Map<string, { at: bigint; entry: Entry }[]>();
  const add = (id: string, at: string, amount: bigint) => {
    if (!timelines.has(id)) timelines.set(id, []);
    timelines.get(id)!.push({ at: instant(at), amount });
  };
  for (const a of book.accounts) add(a.id, a.openingAt, BigInt(a.openingMinor));
  for (const e of book.entries) {
    if (e.deletedAt || !e.posted) continue;
    add(
      e.accountId,
      e.occurredAt,
      BigInt(e.amountMinor) *
        (e.kind === "expense" || e.kind === "transfer" ? -1n : 1n),
    );
    if (e.kind === "transfer" && e.toAccountId) {
      add(
        e.toAccountId,
        e.receivedAt || e.occurredAt,
        BigInt(e.receivedMinor || "0"),
      );
      if (BigInt(e.receivedMinor || "0") > 0n) {
        if (!anchors.has(e.toAccountId)) anchors.set(e.toAccountId, []);
        anchors
          .get(e.toAccountId)!
          .push({ at: instant(e.receivedAt || e.occurredAt), entry: e });
      }
    }
  }
  const compare = (a: { at: bigint }, b: { at: bigint }) =>
    a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
  for (const rows of timelines.values()) {
    rows.sort(compare);
    let total = 0n;
    for (const row of rows) {
      total += row.amount;
      row.amount = total;
    }
  }
  for (const rows of anchors.values()) rows.sort(compare);
  const memo = new Map<string, Rate | null>();
  function rate(id: string, at: string, seen = new Set<string>()): Rate | null {
    const a = accounts.get(id);
    if (!a) return null;
    if (a.currency === book.currency)
      return { n: 1n, d: 1n, provisional: false };
    if (seen.has(id)) return null;
    const key = JSON.stringify([id, at, [...seen].sort()]);
    if (memo.has(key)) return memo.get(key)!;
    const visited = new Set(seen);
    visited.add(id);
    const rows = anchors.get(id) || [],
      time = instant(at);
    const start = lower(rows, (row) => row.at >= time);
    // Preserve the ledger rule: earliest usable future anchor, then latest fallback.
    const candidates = [...rows.slice(start), ...rows.slice(-1)];
    for (const anchor of candidates) {
      const source = rate(
        anchor.entry.accountId,
        anchor.entry.occurredAt,
        visited,
      );
      if (source) {
        const result = {
          n: BigInt(anchor.entry.amountMinor) * source.n,
          d: BigInt(anchor.entry.receivedMinor!) * source.d,
          provisional: anchor.at < time || source.provisional,
        };
        memo.set(key, result);
        return result;
      }
    }
    memo.set(key, null);
    return null;
  }
  function balanceAt(id: string, at: string) {
    const rows = timelines.get(id) || [],
      time = instant(at);
    return rows[lower(rows, (row) => row.at > time) - 1]?.amount || 0n;
  }
  function netAt(ids: string[], at: string) {
    let total = 0n,
      provisional = false;
    const missing: { accountId: string; amount: bigint }[] = [],
      balances: Record<string, bigint> = {};
    for (const id of new Set(ids)) {
      if (!accounts.has(id)) continue;
      const amount = balanceAt(id, at);
      balances[id] = amount;
      const r = rate(id, at);
      if (r) {
        total += roundedRatio(amount, r.n, r.d);
        provisional ||= r.provisional && amount !== 0n;
      } else if (amount !== 0n) missing.push({ accountId: id, amount });
    }
    return { total, missing, provisional, balances };
  }
  return { balanceAt, rate, netAt };
}
export type NetPoint = ReturnType<ReturnType<typeof reportIndex>["netAt"]> & {
  date: string;
};
export const reportTypes: { type: ReportType; name: string; icon: string }[] = [
  { type: "project", name: "项目支出", icon: "Folder" },
  { type: "expense-trend", name: "支出趋势", icon: "ChartNoAxesCombined" },
  { type: "expense", name: "支出分类", icon: "ChartPie" },
  { type: "net", name: "净值走势", icon: "ChartNoAxesCombined" },
  { type: "cashflow", name: "收支结余", icon: "Scale" },
  { type: "income", name: "收入分类", icon: "ChartPie" },
  { type: "income-trend", name: "收入趋势", icon: "ChartNoAxesColumn" },
  { type: "balance", name: "账户余额", icon: "Wallet" },
];
export const isTimeSeriesReport = (type: ReportType) =>
  type !== "expense" && type !== "income" && type !== "project";
export const reportGroups = [
  { name: "账户", types: ["net", "cashflow"] },
  { name: "支出", types: ["expense", "expense-trend"] },
  { name: "收入", types: ["income", "income-trend"] },
  { name: "项目", types: ["project"] },
] as const;
export const reportGrains: { value: ReportGrain; name: string }[] = [
  { value: "day", name: "日" },
  { value: "week", name: "周" },
  { value: "month", name: "月" },
  { value: "quarter", name: "季度" },
  { value: "year", name: "年" },
];
export type ReportRequest = {
  book: Book;
  type: ReportType;
  from: string;
  to: string;
  ids: string[];
  categoryIds: string[];
  projectIds?: string[];
  grain?: ReportGrain;
  now: string;
};
export function reportPeriods(from: string, to: string, grain: ReportGrain) {
  let first = Temporal.PlainDate.from(from);
  const last = Temporal.PlainDate.from(to);
  if (Temporal.PlainDate.compare(first, last) > 0)
    throw Error("结束日期不能早于开始日期。");
  if (first.until(last).days > 36600)
    throw Error("请选择不超过 100 年的时间范围。");
  const periods: { from: string; to: string; label: string }[] = [];
  while (Temporal.PlainDate.compare(first, last) <= 0) {
    let next: Temporal.PlainDate;
    if (grain === "day") next = first.add({ days: 1 });
    else if (grain === "week") next = first.add({ days: 8 - first.dayOfWeek });
    else if (grain === "month")
      next = first.with({ day: 1 }).add({ months: 1 });
    else if (grain === "quarter")
      next = first
        .with({ month: Math.floor((first.month - 1) / 3) * 3 + 1, day: 1 })
        .add({ months: 3 });
    else next = first.with({ month: 1, day: 1 }).add({ years: 1 });
    const end =
      Temporal.PlainDate.compare(next, last) > 0
        ? last
        : next.subtract({ days: 1 });
    const a = first.toString(),
      b = end.toString();
    periods.push({ from: a, to: b, label: a === b ? a : `${a} — ${b}` });
    first = next;
  }
  return periods;
}
export interface FlowRow {
  entry: Entry;
  amount: bigint;
  native: bigint;
  missing: boolean;
  splits: {
    categoryId: string;
    projectId?: string;
    amount: bigint;
    native: bigint;
  }[];
}
export function reportRows(
  request: ReportRequest,
  index = reportIndex(request.book),
): FlowRow[] {
  const { book, from, to, ids, categoryIds, projectIds = [] } = request;
  const accounts = new Set(ids),
    start = instant(
      Temporal.PlainDate.from(from)
        .toZonedDateTime(book.timeZone)
        .toInstant()
        .toString(),
    ),
    end = instant(endOfDay(to, book.timeZone));
  const rows: FlowRow[] = [];
  for (const entry of book.entries) {
    if (
      entry.deletedAt ||
      !entry.posted ||
      !["expense", "income", "refund"].includes(entry.kind) ||
      !accounts.has(entry.accountId)
    )
      continue;
    const at = instant(entry.occurredAt);
    if (at < start || at > end) continue;
    const rate = index.rate(entry.accountId, entry.occurredAt);
    const values = rate ? convertedSplits(entry, rate.n, rate.d) : [];
    const splits = entry.splits.flatMap((s, i) =>
      categoryMatches(book, s, categoryIds) &&
      (!projectIds.length || projectIds.includes(s.projectId || "none"))
        ? [
            {
              categoryId: s.categoryId,
              projectId: s.projectId,
              native: BigInt(s.amountMinor),
              amount: values[i] || 0n,
            },
          ]
        : [],
    );
    // Legacy income may have no category; include only when no split filter is active.
    if (
      !splits.length &&
      (entry.splits.length || categoryIds.length || projectIds.length)
    )
      continue;
    const native = splits.length
      ? splits.reduce((n, s) => n + s.native, 0n)
      : BigInt(entry.amountMinor);
    const sign = entry.kind === "refund" ? -1n : 1n;
    const amount = rate
      ? (splits.length
          ? splits.reduce((n, s) => n + s.amount, 0n)
          : roundedRatio(native, rate.n, rate.d)) * sign
      : 0n;
    rows.push({ entry, native, amount, missing: !rate, splits });
  }
  return rows;
}
export const emptyFlow = () => ({
  income: 0n,
  expense: 0n,
  refund: 0n,
  net: 0n,
  surplus: 0n,
  count: 0,
  incomeCount: 0,
  expenseCount: 0,
  refundCount: 0,
  missingCount: 0,
  missingIncomeCount: 0,
  missingExpenseCount: 0,
  missingRefundCount: 0,
});
export type FlowSummary = ReturnType<typeof emptyFlow>;
function addRow(summary: FlowSummary, row: FlowRow) {
  summary.count++;
  if (row.entry.kind === "income") summary.incomeCount++;
  else if (row.entry.kind === "refund") summary.refundCount++;
  else summary.expenseCount++;
  if (row.missing) {
    summary.missingCount++;
    if (row.entry.kind === "income") summary.missingIncomeCount++;
    else if (row.entry.kind === "refund") summary.missingRefundCount++;
    else summary.missingExpenseCount++;
  } else if (row.entry.kind === "income") summary.income += row.amount;
  else if (row.entry.kind === "refund") summary.refund -= row.amount;
  else summary.expense += row.amount;
  summary.net = summary.expense - summary.refund;
  summary.surplus = summary.income - summary.net;
}
export interface ReportPeriod extends FlowSummary {
  from: string;
  to: string;
  label: string;
  total: bigint;
  balances: Record<string, bigint>;
  missing: { accountId: string; amount: bigint }[];
  provisional: boolean;
}
export function calculateReport(request: ReportRequest) {
  const {
    book,
    type,
    from,
    to,
    ids,
    categoryIds,
    now,
    projectIds = [],
    grain = "day",
  } = request;
  if (!reportGrains.some((g) => g.value === grain)) throw Error("聚合粒度无效");
  const series = isTimeSeriesReport(type);
  const ranges = reportPeriods(from, to, series ? grain : "year"),
    index = reportIndex(book);
  if (type === "balance" && ids.length !== 1)
    throw Error("请选择一个账户查看原币余额");
  const stock = type === "net" || type === "balance";
  const today = localDate(now, book.timeZone);
  const actualRanges = stock
    ? ranges
        .filter((p) => p.from <= today)
        .map((p) => {
          const end = p.to > today ? today : p.to;
          return {
            ...p,
            to: end,
            label: p.from === end ? end : `${p.from} — ${end}`,
          };
        })
    : series
      ? ranges
      : [];
  const periods: ReportPeriod[] = actualRanges.map((p) => ({
    ...p,
    ...emptyFlow(),
    total: 0n,
    balances: {},
    missing: [],
    provisional: false,
  }));
  const rows = stock
    ? []
    : reportRows(request, index).filter((r) =>
        type === "income" || type === "income-trend"
          ? r.entry.kind === "income"
          : type === "cashflow" || r.entry.kind !== "income",
      );
  const summary = emptyFlow(),
    values = new Map<string, bigint>();
  const missingCurrencies = new Map<string, bigint>();
  for (const row of rows) {
    addRow(summary, row);
    if (series) {
      const day = localDate(row.entry.occurredAt, book.timeZone);
      const period = periods[lower(periods, (p) => p.to >= day)];
      if (period) addRow(period, row);
    }
    if (row.missing) {
      const currency = book.accounts.find(
        (a) => a.id === row.entry.accountId,
      )!.currency;
      missingCurrencies.set(
        currency,
        (missingCurrencies.get(currency) || 0n) +
          row.native * (row.entry.kind === "refund" ? -1n : 1n),
      );
    } else
      for (const s of row.splits) {
        values.set(
          s.categoryId,
          (values.get(s.categoryId) || 0n) +
            s.amount * (row.entry.kind === "refund" ? -1n : 1n),
        );
      }
  }
  for (const p of periods) {
    if (stock) {
      const end = endOfDay(p.to, book.timeZone),
        at = instant(end) > instant(now) ? now : end;
      const n = index.netAt(ids, at);
      p.total = type === "balance" ? index.balanceAt(ids[0], at) : n.total;
      p.balances = n.balances;
      p.missing = type === "balance" ? [] : n.missing;
      p.provisional = type !== "balance" && n.provisional;
      p.missingCount = p.missing.length;
    } else
      p.total = type === "income" || type === "income-trend" ? p.income : p.net;
  }
  const baselineAt = endOfDay(dateOffset(from, -1), book.timeZone);
  const baseline =
    type === "balance"
      ? index.balanceAt(ids[0], baselineAt)
      : index.netAt(ids, baselineAt).total;
  const points: NetPoint[] = stock
    ? periods.map((p) => ({
        date: p.to,
        total: p.total,
        balances: p.balances,
        missing: p.missing,
        provisional: p.provisional,
      }))
    : [];
  const stats =
    type === "expense" && !projectIds.length
      ? categoryStats(
          book,
          Temporal.PlainDate.from(from)
            .toZonedDateTime(book.timeZone)
            .toInstant()
            .toString(),
          endOfDay(to, book.timeZone),
          ids,
          categoryIds,
          index.rate,
        )
      : {
          values,
          rows: rows.map(({ entry, amount, native, missing }) => ({
            entry,
            amount,
            native,
            missing,
          })),
          expense: summary.expense,
          refund: summary.refund,
          net:
            type === "income" || type === "income-trend"
              ? summary.income
              : summary.net,
          missingCount: summary.missingCount,
        };
  const projects = new Map<string, FlowSummary>();
  // One pass over explicitly attributed splits; never copy whole entries to each project.
  if (type === "project" && !projectIds.length)
    for (const row of rows) {
      const grouped = new Map<string, FlowRow["splits"]>();
      for (const s of row.splits)
        if (s.projectId)
          grouped.set(s.projectId, [...(grouped.get(s.projectId) || []), s]);
      for (const [id, splits] of grouped) {
        if (!projects.has(id)) projects.set(id, emptyFlow());
        addRow(projects.get(id)!, {
          ...row,
          splits,
          amount:
            splits.reduce((n, s) => n + s.amount, 0n) *
            (row.entry.kind === "refund" ? -1n : 1n),
        });
      }
    }
  const entryMap = new Map(book.entries.map((e) => [e.id, e]));
  const unresolvedRefunds =
    type === "project"
      ? book.entries
          .filter((e) => {
            if (
              e.deletedAt ||
              !e.posted ||
              e.kind !== "refund" ||
              !ids.includes(e.accountId) ||
              e.splits.every((s) => s.projectId) ||
              (categoryIds.length > 0 &&
                !e.splits.some((s) => categoryMatches(book, s, categoryIds)))
            )
              return false;
            const day = localDate(e.occurredAt, book.timeZone);
            if (day < from || day > to) return false;
            const original = entryMap.get(refundOriginalId(e) || "");
            return original?.splits.some(
              (s) =>
                s.projectId &&
                (!projectIds.length || projectIds.includes(s.projectId)),
            );
          })
          .map((e) => e.id)
      : [];
  return {
    type,
    periods,
    points,
    baseline,
    summary,
    stats,
    rows,
    projects,
    missingCurrencies,
    unresolvedRefunds,
    baselineIncomplete:
      type === "net" && index.netAt(ids, baselineAt).missing.length > 0,
  };
}
export type ReportResult = ReturnType<typeof calculateReport>;
