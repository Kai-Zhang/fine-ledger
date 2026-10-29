import type { Book, Entry, Kind, Split } from "./types.ts";
import {
  compareTime,
  dateOffset,
  localDate,
  startOfDay,
  endOfDay,
} from "./dates.ts";
import { minor } from "./money.ts";
export interface TransactionFilter {
  accounts: string[];
  kinds: Kind[];
  categories: string[];
  projects: string[];
  status: "all" | "posted" | "pending";
  period: "" | "month" | "lastMonth" | "30" | "custom";
  from: string;
  to: string;
  currency: string;
  min: string;
  max: string;
}
export const emptyFilter = (): TransactionFilter => ({
  accounts: [],
  kinds: [],
  categories: [],
  projects: [],
  status: "all",
  period: "",
  from: "",
  to: "",
  currency: "",
  min: "",
  max: "",
});
export function filterDates(
  f: TransactionFilter,
  zone: string,
  now = new Date(),
) {
  const today = localDate(now, zone),
    first = today.slice(0, 8) + "01";
  let from = "",
    to = "";
  if (f.period === "month") {
    from = first;
    to = today;
  }
  if (f.period === "lastMonth") {
    to = dateOffset(first, -1);
    from = to.slice(0, 8) + "01";
  }
  if (f.period === "30") {
    from = dateOffset(today, -29);
    to = today;
  }
  if (f.period === "custom") {
    from = f.from;
    to = f.to;
  }
  if (f.period === "custom" && (!from || !to)) throw Error("请选择起止日期");
  if (from && to && from > to) throw Error("结束日期不能早于开始日期");
  return {
    from: from ? startOfDay(from, zone) : "",
    to: to ? endOfDay(to, zone) : "",
  };
}
export function validateFilter(f: TransactionFilter, zone: string) {
  filterDates(f, zone);
  if ((f.min || f.max) && !f.currency) throw Error("请先选择金额币种");
  const min = f.min ? BigInt(minor(f.min, f.currency)) : undefined,
    max = f.max ? BigInt(minor(f.max, f.currency)) : undefined;
  if ((min !== undefined && min < 0n) || (max !== undefined && max < 0n))
    throw Error("金额范围请填写非负数");
  if (min !== undefined && max !== undefined && min > max)
    throw Error("最高金额不能小于最低金额");
  return { min, max };
}
export function categoryMatches(book: Book, s: Split, ids: string[]) {
  return (
    !ids.length ||
    ids.includes(s.categoryId) ||
    ids.includes(
      book.categories.find((c) => c.id === s.categoryId)?.parentId || "",
    )
  );
}
export function incomingEndpoint(
  book: Book,
  e: Entry,
  scope?: string,
  accounts: string[] = [],
  currency = "",
) {
  if (e.kind !== "transfer") return false;
  const selected = scope || (accounts.length === 1 ? accounts[0] : undefined);
  if (selected) return e.toAccountId === selected;
  return (
    !!currency &&
    book.accounts.find((a) => a.id === e.accountId)?.currency !== currency &&
    book.accounts.find((a) => a.id === e.toAccountId)?.currency === currency
  );
}
export function filterEntries(
  book: Book,
  entries: Entry[],
  f: TransactionFilter,
  query = "",
  scope?: string,
) {
  const dates = filterDates(f, book.timeZone),
    { min, max } = validateFilter(f, book.timeZone),
    q = query.normalize("NFKC").toLocaleLowerCase().trim();
  return entries.filter((e) => {
    if (scope && e.accountId !== scope && e.toAccountId !== scope) return false;
    if (
      f.accounts.length &&
      !f.accounts.some((id) => e.accountId === id || e.toAccountId === id)
    )
      return false;
    if (f.kinds.length && !f.kinds.includes(e.kind)) return false;
    if (
      (f.status === "posted" && !e.posted) ||
      (f.status === "pending" && e.posted)
    )
      return false;
    if (
      q &&
      ![e.description, e.note, ...e.splits.map((s) => s.note)]
        .filter(Boolean)
        .join("\n")
        .normalize("NFKC")
        .toLocaleLowerCase()
        .includes(q)
    )
      return false;
    const incoming = incomingEndpoint(book, e, scope, f.accounts, f.currency);
    const at = incoming ? e.receivedAt || e.occurredAt : e.occurredAt;
    if (
      (dates.from && compareTime(at, dates.from) < 0) ||
      (dates.to && compareTime(at, dates.to) > 0)
    )
      return false;
    if (
      (f.categories.length || f.projects.length) &&
      !matchingSplits(book, e, f).length
    )
      return false;
    const account = book.accounts.find(
      (a) => a.id === (incoming ? e.toAccountId : e.accountId),
    );
    let amount = BigInt(
        incoming ? e.receivedMinor || e.amountMinor : e.amountMinor,
      ),
      currency = account?.currency;
    if (f.currency && currency !== f.currency) return false;
    if (amount < 0n) amount = -amount;
    return (
      (min === undefined || amount >= min) &&
      (max === undefined || amount <= max)
    );
  });
}
export function matchingSplits(
  book: Book,
  e: Entry,
  f: Pick<TransactionFilter, "categories" | "projects">,
) {
  return e.splits.filter(
    (s) =>
      categoryMatches(book, s, f.categories) &&
      (!f.projects.length || f.projects.includes(s.projectId || "none")),
  );
}
