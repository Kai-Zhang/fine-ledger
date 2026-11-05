import type { Book, Entry } from "./types.ts";
import type { Route } from "../navigation/routes.ts";
import { liveEntries } from "./ledger.ts";
import { compareTime, localDate, sortEntries } from "./dates.ts";
import {
  filterEntries,
  matchingSplits,
  categoryMatches,
  incomingEndpoint,
  type TransactionFilter,
} from "./filters.ts";
// App snapshots are immutable. Bounded per-book views survive tab remounts;
// a new book object invalidates every scope without revision heuristics.
const views = new WeakMap<Book, Map<string, Entry[]>>();
function cached(book: Book, key: string, calculate: () => Entry[]) {
  let map = views.get(book);
  if (!map) views.set(book, (map = new Map()));
  const hit = map.get(key);
  if (hit) return hit;
  const result = calculate();
  if (map.size >= 24) map.delete(map.keys().next().value!);
  map.set(key, result);
  return result;
}
export function transactionSelection(
  book: Book,
  route: Route,
  f: TransactionFilter,
  query = "",
  now = new Date(),
) {
  const account =
    route.page === "account"
      ? book.accounts.find((a) => a.id === route.id)
      : undefined;
  const routeKey = JSON.stringify(route);
  const base = cached(book, "base:" + routeKey, () => {
    const selectedEntryIds = route.entryIds && new Set(route.entryIds);
    return liveEntries(book).filter((e) => {
      if (selectedEntryIds && !selectedEntryIds.has(e.id)) return false;
      if (route.reportKinds && !route.reportKinds.includes(e.kind))
        return false;
      const at =
        (account?.id || route.accountId) === e.toAccountId &&
        e.kind === "transfer"
          ? e.receivedAt || e.occurredAt
          : e.occurredAt;
      const inRange = (value: string) =>
        (!route.from || compareTime(value, route.from) >= 0) &&
        (!route.to || compareTime(value, route.to) <= 0);
      const endpointDates =
        route.reportKind === "net" &&
        route.accountIds &&
        !route.accountId &&
        !account
          ? [
              ...(route.accountIds.includes(e.accountId) ? [e.occurredAt] : []),
              ...(e.kind === "transfer" &&
              route.accountIds.includes(e.toAccountId || "")
                ? [e.receivedAt || e.occurredAt]
                : []),
            ]
          : [at];
      return (
        (!route.postedOnly || e.posted) &&
        (route.reportKind !== "expense" ||
          e.kind === "expense" ||
          e.kind === "refund") &&
        (!route.accountIds ||
          route.accountIds.includes(e.accountId) ||
          (route.reportKind !== "expense" &&
            !!e.toAccountId &&
            route.accountIds.includes(e.toAccountId))) &&
        endpointDates.some(inRange) &&
        ((!route.categoryIds?.length && !route.projectIds?.length) ||
          matchingSplits(book, e, {
            categories: route.categoryIds || [],
            projects: route.projectIds || [],
          }).length > 0)
      );
    });
  });
  return cached(
    book,
    "filter:" + routeKey + JSON.stringify(f) + JSON.stringify(query) +
      (f.period && f.period !== "custom" ? localDate(now, book.timeZone) : ""),
    () =>
      filterEntries(book, base, f, query, account?.id, now).filter(
        (e) =>
          (!route.categoryIds?.length && !route.projectIds?.length) ||
          matchingSplits(book, e, f).some(
            (s) =>
              categoryMatches(book, s, route.categoryIds || []) &&
              (!route.projectIds?.length ||
                route.projectIds.includes(s.projectId || "none")),
          ),
      ),
  );
}
const orderedViews = new WeakMap<Entry[], Map<string, Entry[]>>();
export function transactionOrder(
  book: Book,
  entries: Entry[],
  scope?: string,
  currency?: string,
) {
  const key = JSON.stringify([
    scope,
    currency,
    book.accounts.map((a) => [a.id, a.currency]),
  ]);
  let map = orderedViews.get(entries);
  if (!map) orderedViews.set(entries, (map = new Map()));
  const hit = map.get(key);
  if (hit) return hit;
  const result = sortEntries(
    entries.map((e) =>
      e.receivedAt && incomingEndpoint(book, e, scope, [], currency)
        ? { ...e, occurredAt: e.receivedAt }
        : e,
    ),
  );
  if (map.size >= 8) map.delete(map.keys().next().value!);
  map.set(key, result);
  return result;
}
