import { transactionOrder } from "../domain/transaction-view.ts";
import { PostingDialog } from "./PostingDialog.tsx";
import { categoryColor } from "../ui/category-color.ts";
import { incomingEndpoint } from "../domain/filters.ts";
import { useState, useEffect, useMemo, useRef } from "react";
import { useApp } from "../ui/context.tsx";
import { Icon } from "../ui/icons.tsx";
import { Amount, Empty, IconButton } from "../ui/components.tsx";
import { localDate } from "../domain/dates.ts";
import {
  balancesAfterEntries,
  entryCurrency,
  needsSettlement,
  changePosted,
} from "../domain/ledger.ts";
import type { Entry } from "../domain/types.ts";
const transactionPageSize = 40;
const dayFormat = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "short",
});
const dayWithYearFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
});
export const kindLabel = {
  expense: "支出",
  income: "收入",
  transfer: "转账",
  refund: "退款",
  adjustment: "余额调整",
};
export function EntryIcon({ entry }: { entry: Entry }) {
  const { book } = useApp();
  const category = book.categories.find(
    (c) => c.id === entry.splits[0]?.categoryId,
  );
  return (
    <span
      className={`transaction-symbol ${entry.posted ? "category-ink" : "unposted"}`}
      style={categoryColor(
        entry.posted
          ? entry.kind === "expense"
            ? category?.color
            : undefined
          : undefined,
      )}
    >
      <Icon
        name={
          entry.kind === "transfer"
            ? "ArrowLeftRight"
            : entry.kind === "refund"
              ? "RotateCcw"
              : entry.kind === "adjustment"
                ? "SlidersHorizontal"
                : category?.icon || "Tag"
        }
      />
      {!entry.posted && <i />}
    </span>
  );
}
export function Transactions({
  entries,
  scope,
  matched,
  currency,
  reportMatched,
}: {
  entries: Entry[];
  scope?: string;
  currency?: string;
  matched?: Map<string, string>;
  reportMatched?: Map<string, string>;
}) {
  const app = useApp(),
    { book, route, views, preview } = app;
  const ledgerAccount = book.accounts.find((a) => a.id === scope);
  const balances = useMemo(
    () => ledgerAccount && balancesAfterEntries(book.entries, ledgerAccount),
    [book.entries, ledgerAccount],
  );
  const limitKey = `transaction-limit:${JSON.stringify(route)}`;
  const [limit, setLimit] = useState(
    () => (views.get(limitKey) as number) ?? transactionPageSize,
  );
  useEffect(() => {
    if (!preview) views.set(limitKey, limit);
  }, [limitKey, limit, preview, views]);
  const sorted = useMemo(
    () => transactionOrder(book, entries, scope, currency),
    [book, entries, scope, currency],
  );
  const listEnd = useRef<HTMLDivElement>(null);
  const hasMore = sorted.length > limit;
  const canObserve = typeof IntersectionObserver !== "undefined";
  useEffect(() => {
    const end = listEnd.current;
    if (!end || !hasMore || preview || !canObserve) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        setLimit(limit + transactionPageSize);
      },
      {
        root: end.closest(".page-content"),
        rootMargin: "0px 0px 320px 0px",
      },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [canObserve, hasMore, limit, preview]);
  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: book.timeZone,
      }),
    [book.timeZone],
  );
  if (!entries.length) return <Empty title="还没有交易" icon="List" />;
  const currentYear = new Date().getFullYear();
  let last = "";
  return (
    <div className="transaction-list">
      {sorted.slice(0, limit).map((e) => {
        const day = localDate(e.occurredAt, book.timeZone),
          heading = day !== last;
        last = day;
        const account = book.accounts.find((a) => a.id === e.accountId),
          to = book.accounts.find((a) => a.id === e.toAccountId),
          incoming = incomingEndpoint(book, e, scope, [], currency);
        const category = e.splits
          .map((s) => book.categories.find((c) => c.id === s.categoryId)?.name)
          .filter(Boolean)
          .join(" · ");
        const value = incoming
          ? e.receivedMinor || e.amountMinor
          : e.amountMinor;
        const balanceAfter = balances?.get(e.id);
        return (
          <section key={e.id}>
            {heading && (
              <div className="date-divider">
                {(new Date(day).getFullYear() === currentYear
                  ? dayFormat
                  : dayWithYearFormat
                ).format(new Date(day + "T12:00"))}
              </div>
            )}
            <div className="transaction-row">
              <button
                className="posting-button"
                aria-label={`${e.posted ? "标记未入账" : "标记已入账"}：${e.description}`}
                title={
                  e.posted ? "已入账，点击标记为未入账" : "未入账，点击入账"
                }
                onClick={() =>
                  !e.posted && (needsSettlement(book, e) || e.originalAmount)
                    ? app.open(<PostingDialog entry={e} />)
                    : void app.save("切换入账状态", (b) =>
                        changePosted(b, e.id),
                      )
                }
              >
                <EntryIcon entry={e} />
              </button>
              <button
                className="transaction-main"
                onClick={() => app.go({ page: "detail", id: e.id })}
              >
                <div className="transaction-copy">
                  <strong>{e.description}</strong>
                  <div className="transaction-secondary">
                    <small>
                      {e.kind === "transfer"
                        ? `${account?.name} → ${to?.name}`
                        : category || kindLabel[e.kind]}
                      {!scope && e.kind !== "transfer" && (
                        <> · {account?.name}</>
                      )}
                    </small>
                    <span className="transaction-meta">
                      {timeFormat.format(new Date(e.occurredAt))}
                      {!e.posted && <em>未入账</em>}
                      {e.splits.length > 1 && (
                        <span>{e.splits.length} 个类目</span>
                      )}
                    </span>
                  </div>
                </div>
                <div
                  className={`transaction-amount ${e.kind === "income" || e.kind === "refund" ? "positive" : e.kind === "expense" ? "negative" : ""}`}
                >
                  <span>
                    {e.kind === "expense" ||
                    (e.kind === "transfer" && !incoming)
                      ? "−"
                      : BigInt(value) >= 0n
                        ? "+"
                        : ""}
                    <Amount
                      value={value}
                      currency={
                        incoming ? to!.currency : entryCurrency(book, e)
                      }
                    />
                  </span>
                  {(incoming ? to?.currency : entryCurrency(book, e)) !==
                    book.currency && (
                    <small>
                      {incoming ? to?.currency : entryCurrency(book, e)}
                    </small>
                  )}
                  {ledgerAccount && balanceAfter !== undefined && (
                    <small>
                      余额{" "}
                      <Amount
                        value={balanceAfter}
                        currency={ledgerAccount.currency}
                      />
                    </small>
                  )}
                  {e.originalAmount && !needsSettlement(book, e) && (
                    <small>
                      原始{" "}
                      {e.originalAmount.amountMinor && (
                        <Amount
                          value={e.originalAmount.amountMinor}
                          currency={e.originalAmount.currency}
                          code
                        />
                      )}
                    </small>
                  )}
                  {needsSettlement(book, e) && (
                    <small>{account?.currency} 待确认</small>
                  )}
                  {matched?.has(e.id) && (
                    <small>其中匹配 {matched.get(e.id)}</small>
                  )}
                  {reportMatched?.has(e.id) && (
                    <small>报表 {reportMatched.get(e.id)}</small>
                  )}
                </div>
              </button>
            </div>
          </section>
        );
      })}
      {hasMore &&
        (canObserve ? (
          <div
            className="transaction-list-end"
            ref={listEnd}
            aria-hidden="true"
          />
        ) : (
          <button
            className="load-more"
            onClick={() => setLimit(limit + transactionPageSize)}
          >
            加载更多 · 还有 {sorted.length - limit} 笔
          </button>
        ))}
    </div>
  );
}
