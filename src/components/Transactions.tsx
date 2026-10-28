import { useState } from "react";
import { useApp } from "../ui/context.tsx";
import { Icon } from "../ui/icons.tsx";
import { Amount, Empty, IconButton } from "../ui/components.tsx";
import { sortEntries, localDate } from "../domain/dates.ts";
import { changePosted } from "../domain/ledger.ts";
import type { Entry } from "../domain/types.ts";
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
      className={`transaction-symbol ${entry.posted ? "" : "unposted"}`}
      style={{
        color: entry.posted
          ? entry.kind === "expense"
            ? category?.color
            : undefined
          : undefined,
      }}
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
}: {
  entries: Entry[];
  scope?: string;
  matched?: Map<string, string>;
}) {
  const app = useApp(),
    { book } = app;
  const [limit, setLimit] = useState(80);
  const sorted = sortEntries(
    entries.map((e) =>
      e.kind === "transfer" && e.toAccountId === scope && e.receivedAt
        ? { ...e, occurredAt: e.receivedAt }
        : e,
    ),
  );
  if (!entries.length) return <Empty title="还没有交易" icon="List" />;
  let last = "";
  return (
    <div className="transaction-list">
      {sorted.slice(0, limit).map((e) => {
        const day = localDate(e.occurredAt, book.timeZone),
          heading = day !== last;
        last = day;
        const account = book.accounts.find((a) => a.id === e.accountId),
          to = book.accounts.find((a) => a.id === e.toAccountId),
          incoming =
            !!scope && e.kind === "transfer" && e.toAccountId === scope;
        const category = e.splits
          .map((s) => book.categories.find((c) => c.id === s.categoryId)?.name)
          .filter(Boolean)
          .join(" · ");
        const value = incoming
          ? e.receivedMinor || e.amountMinor
          : e.amountMinor;
        return (
          <section key={e.id}>
            {heading && (
              <div className="date-divider">
                {new Date(day + "T12:00").toLocaleDateString("zh-CN", {
                  year:
                    new Date(day).getFullYear() !== new Date().getFullYear()
                      ? "numeric"
                      : undefined,
                  month: "long",
                  day: "numeric",
                  weekday: "short",
                })}
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
                  void app.save("切换入账状态", (b) => changePosted(b, e.id))
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
                      {new Date(e.occurredAt).toLocaleTimeString("zh-CN", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                        timeZone: book.timeZone,
                      })}
                      {!e.posted && <em>未入账</em>}
                      {e.splits.length > 1 && (
                        <span>{e.splits.length} 个类目</span>
                      )}
                    </span>
                  </div>
                </div>
                <div
                  className={`transaction-amount ${e.kind === "income" || e.kind === "refund" || incoming ? "positive" : ""}`}
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
                        (incoming ? to : account)?.currency || book.currency
                      }
                    />
                  </span>
                  {account?.currency !== book.currency && (
                    <small>{(incoming ? to : account)?.currency}</small>
                  )}
                  {matched?.has(e.id) && (
                    <small>其中匹配 {matched.get(e.id)}</small>
                  )}
                </div>
              </button>
            </div>
          </section>
        );
      })}
      {sorted.length > limit && (
        <button className="load-more" onClick={() => setLimit(limit + 80)}>
          加载更多 · 还有 {sorted.length - limit} 笔
        </button>
      )}
    </div>
  );
}
