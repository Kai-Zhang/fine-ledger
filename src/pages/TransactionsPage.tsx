import { useMemo, useState, useEffect } from "react";
import { useApp } from "../ui/context.tsx";
import {
  Header,
  Button,
  IconButton,
  Amount,
  Dialog,
  Empty,
  Field,
} from "../ui/components.tsx";
import { Icon } from "../ui/icons.tsx";
import {
  Transactions,
  kindLabel,
  EntryIcon,
} from "../components/Transactions.tsx";
import { AccountEditor } from "../components/AccountEditor.tsx";
import {
  balance,
  liveEntries,
  remainingRefund,
  removeEntry,
  restoreEntry,
  categoryStats,
} from "../domain/ledger.ts";
import { localDate, displayTime, compareTime } from "../domain/dates.ts";
import { money } from "../domain/money.ts";
export function TransactionsPage() {
  const app = useApp(),
    { book, route } = app;
  const viewKey = `${app.mode}:transactions:${JSON.stringify(route)}`,
    cached = app.views.get(viewKey) as
      | {
          query: string;
          pending: boolean;
          accountId: string;
          showFilters: boolean;
        }
      | undefined;
  const [query, setQuery] = useState(cached?.query || ""),
    [pending, setPending] = useState(
      cached?.pending ?? route.filter === "pending",
    ),
    [accountId, setAccount] = useState(
      cached?.accountId || route.accountId || "",
    ),
    [showFilters, setShowFilters] = useState(cached?.showFilters || false);
  useEffect(() => {
    app.views.set(viewKey, { query, pending, accountId, showFilters });
  }, [query, pending, accountId, showFilters, viewKey]);
  const fromReport = !!(
    route.from ||
    route.to ||
    route.accountIds ||
    route.reportKind
  );
  const account =
    route.page === "account"
      ? book.accounts.find((a) => a.id === route.id)
      : undefined;
  const entries = useMemo(
    () =>
      liveEntries(book).filter((e) => {
        const scope = account?.id || accountId;
        const at =
          scope && e.kind === "transfer" && e.toAccountId === scope
            ? e.receivedAt || e.occurredAt
            : e.occurredAt;
        return (
          (!scope || e.accountId === scope || e.toAccountId === scope) &&
          (!pending || !e.posted) &&
          (!route.postedOnly || e.posted) &&
          (route.reportKind !== "expense" ||
            e.kind === "expense" ||
            e.kind === "refund") &&
          (!route.accountIds || route.accountIds.includes(e.accountId)) &&
          (!query ||
            e.description
              .normalize("NFKC")
              .toLocaleLowerCase()
              .includes(query.normalize("NFKC").toLocaleLowerCase())) &&
          (!route.from || compareTime(at, route.from) >= 0) &&
          (!route.to || compareTime(at, route.to) <= 0) &&
          (!route.categoryIds?.length ||
            e.splits.some(
              (s) =>
                route.categoryIds!.includes(s.categoryId) ||
                route.categoryIds!.includes(
                  book.categories.find((c) => c.id === s.categoryId)
                    ?.parentId || "",
                ),
            ))
        );
      }),
    [book, account, query, pending, accountId, route],
  );
  const matched = useMemo(() => {
    if (!route.categoryIds?.length) return undefined;
    const result = categoryStats(
      book,
      route.from || "0001-01-01T00:00:00Z",
      route.to || "9999",
      route.accountIds || book.accounts.map((a) => a.id),
      route.categoryIds,
    );
    return new Map(
      result.rows
        .filter((r) => r.entry.splits.length > 1)
        .map((r) => [
          r.entry.id,
          money(
            r.native,
            book.accounts.find((a) => a.id === r.entry.accountId)!.currency,
          ),
        ]),
    );
  }, [book, route]);
  function menu() {
    if (!account) return;
    app.open(
      <Dialog title={account.name} onClose={app.close}>
        <div className="menu-list">
          <button
            onClick={() =>
              app.open(<AccountEditor account={account} onClose={app.close} />)
            }
          >
            <Icon name="Pencil" />
            编辑账户
          </button>
          {!account.archived && (
            <button
              onClick={() => {
                app.close();
                app.go({
                  page: "entry",
                  accountId: account.id,
                  kind: "adjustment",
                });
              }}
            >
              <Icon name="SlidersHorizontal" />
              调整余额
            </button>
          )}
          <button
            onClick={async () => {
              app.close();
              if (
                account.archived ||
                (await app.confirm({
                  title: "归档账户？",
                  message: "账户将从首页隐藏，旧交易仍可查看和修改。",
                  label: "归档",
                }))
              )
                await app.save(
                  account.archived ? "取消归档" : "归档账户",
                  (b) => {
                    b.accounts.find((a) => a.id === account.id)!.archived =
                      !account.archived;
                  },
                );
            }}
          >
            <Icon name={account.archived ? "ArchiveRestore" : "Archive"} />
            {account.archived ? "取消归档" : "归档账户"}
          </button>
        </div>
      </Dialog>,
    );
  }
  return (
    <>
      <Header
        title={account?.name || (fromReport ? "报表明细" : "交易")}
        back={!!account || fromReport}
      >
        {account ? (
          <IconButton name="MoreHorizontal" label="账户菜单" onClick={menu} />
        ) : (
          <IconButton
            name="SlidersHorizontal"
            label="筛选交易"
            onClick={() => setShowFilters(!showFilters)}
          />
        )}
      </Header>
      <main className="page-content transactions-page">
        {account && (
          <div className="account-balance">
            <span>
              已入账余额 <small>{account.currency}</small>
            </span>
            <Amount
              value={balance(book, account.id)}
              currency={account.currency}
            />
            {account.archived && <span className="status-badge">已归档</span>}
          </div>
        )}
        <div className="search-bar">
          <Icon name="Search" size={19} />
          <input
            type="search"
            placeholder="搜索描述"
            aria-label="搜索交易描述"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="filter-bar">
          <button
            className={!pending ? "selected" : ""}
            onClick={() => setPending(false)}
          >
            全部
          </button>
          {!route.postedOnly && (
            <button
              className={pending ? "selected" : ""}
              onClick={() => setPending(true)}
            >
              未入账{" "}
              <small>
                {liveEntries(book).filter(
                  (e) =>
                    !e.posted &&
                    (!account ||
                      e.accountId === account.id ||
                      e.toAccountId === account.id),
                ).length || ""}
              </small>
            </button>
          )}
          {(route.from || route.categoryIds?.length) && (
            <span className="filter-label">报表筛选</span>
          )}
          {!account && (
            <span className="record-count">{entries.length} 笔</span>
          )}
        </div>
        {showFilters && !account && (
          <div className="filter-panel">
            <Field label="账户">
              <select
                value={accountId}
                onChange={(e) => setAccount(e.target.value)}
              >
                <option value="">所有账户</option>
                {book.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.archived ? "（已归档）" : ""}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
        <Transactions
          entries={entries}
          scope={account?.id || accountId || undefined}
          matched={matched}
        />
      </main>
      {!account?.archived && book.accounts.some((a) => !a.archived) && (
        <div className="floating-entry">
          <Button
            icon="Plus"
            onClick={() =>
              app.go({
                page: "entry",
                accountId:
                  account?.id ||
                  accountId ||
                  book.accounts.find((a) => !a.archived)?.id,
              })
            }
          >
            记一笔
          </Button>
        </div>
      )}
    </>
  );
}
export function Detail() {
  const app = useApp(),
    { book } = app,
    e = book.entries.find((e) => e.id === app.route.id),
    [deleting, setDeleting] = useState(false);
  if (!e)
    return (
      <>
        <Header title="交易详情" back />
        <Empty title="交易不存在" />
      </>
    );
  const a = book.accounts.find((a) => a.id === e.accountId),
    to = book.accounts.find((a) => a.id === e.toAccountId),
    refunds = book.entries.filter((r) => r.originalId === e.id && !r.deletedAt),
    original = book.entries.find((r) => r.id === e.originalId),
    refundable =
      e.kind === "expense" &&
      !e.deletedAt &&
      !a?.archived &&
      remainingRefund(book, e.id) > 0n;
  function deleteDialog() {
    setDeleting(true);
    app.open(
      <Dialog
        title="删除这笔交易？"
        onClose={() => {
          setDeleting(false);
          app.close();
        }}
      >
        <div className="dialog-body">
          <p>
            {refunds.length
              ? `这笔消费关联 ${refunds.length} 笔退款，可选择是否一并删除。`
              : "删除后可在最近删除中恢复。"}
          </p>
          <div className="stacked-actions">
            <Button
              variant="danger"
              onClick={async () => {
                if (await app.save("删除交易", (b) => removeEntry(b, e!.id))) {
                  app.close();
                  app.back();
                }
              }}
            >
              {refunds.length ? "只删除这笔消费" : "删除交易"}
            </Button>
            {refunds.length > 0 && (
              <Button
                variant="danger"
                onClick={async () => {
                  if (
                    await app.save("删除消费及退款", (b) =>
                      removeEntry(b, e!.id, true),
                    )
                  ) {
                    app.close();
                    app.back();
                  }
                }}
              >
                连同关联退款删除
              </Button>
            )}
            <Button
              variant="plain"
              onClick={() => {
                app.close();
                setDeleting(false);
              }}
            >
              取消
            </Button>
          </div>
        </div>
      </Dialog>,
    );
  }
  return (
    <>
      <Header title={kindLabel[e.kind]} back>
        {!e.deletedAt && (
          <Button
            variant="plain"
            icon="Pencil"
            onClick={() => app.go({ page: "entry", id: e.id })}
          >
            编辑
          </Button>
        )}
      </Header>
      <main className="page-content detail-page">
        <div className="detail-hero">
          <EntryIcon entry={e} />
          <h2>{e.description}</h2>
          <Amount
            value={e.amountMinor}
            currency={a?.currency || book.currency}
            code
          />
          <span className={`status-badge ${e.posted ? "" : "pending"}`}>
            {e.deletedAt ? "已删除" : e.posted ? "已入账" : "未入账"}
          </span>
        </div>
        <div className="detail-surface">
          <div className="detail-line">
            <span>{e.kind === "transfer" ? "转出账户" : "账户"}</span>
            <button onClick={() => app.go({ page: "account", id: a?.id })}>
              {a?.name}
              <Icon name="ChevronRight" size={15} />
            </button>
          </div>
          {to && (
            <>
              <div className="detail-line">
                <span>转入账户</span>
                <button onClick={() => app.go({ page: "account", id: to.id })}>
                  {to.name}
                  <Icon name="ChevronRight" size={15} />
                </button>
              </div>
              <div className="detail-line">
                <span>转入金额</span>
                <Amount
                  value={e.receivedMinor || e.amountMinor}
                  currency={to.currency}
                  code
                />
              </div>
            </>
          )}
          <div className="detail-line">
            <span>时间</span>
            <time>{displayTime(e.occurredAt, book.timeZone)}</time>
          </div>
          {e.receivedAt && (
            <div className="detail-line">
              <span>接收时间</span>
              <time>{displayTime(e.receivedAt, book.timeZone)}</time>
            </div>
          )}
          {e.splits.length > 0 && (
            <div className="detail-categories">
              <div className="section-title">
                <h3>{e.splits.length > 1 ? "类目拆分" : "类目"}</h3>
              </div>
              {e.splits.map((s) => {
                const c = book.categories.find((c) => c.id === s.categoryId),
                  parent = book.categories.find((p) => p.id === c?.parentId),
                  project = book.projects.find((p) => p.id === s.projectId);
                return (
                  <div key={s.id} className="detail-split">
                    <span
                      className="category-symbol"
                      style={{ color: c?.color }}
                    >
                      <Icon name={c?.icon || "Tag"} />
                    </span>
                    <span>
                      {parent && <small>{parent.name} / </small>}
                      {c?.name || "历史类目"}
                      {project && (
                        <small className="project-label">{project.name}</small>
                      )}
                    </span>
                    <Amount
                      value={s.amountMinor}
                      currency={a?.currency || book.currency}
                    />
                  </div>
                );
              })}
            </div>
          )}
          {e.note && (
            <div className="detail-note">
              <span>备注</span>
              <p>{e.note}</p>
            </div>
          )}
        </div>
        {original && (
          <button
            className="linked-entry"
            onClick={() => app.go({ page: "detail", id: original.id })}
          >
            <Icon name="RotateCcw" />
            <span>
              原消费 · {original.description}
              {original.deletedAt && <small>原消费已删除</small>}
            </span>
            <Icon name="ChevronRight" size={16} />
          </button>
        )}
        {refunds.length > 0 && (
          <div className="linked-refunds">
            <h3>关联退款</h3>
            {refunds.map((r) => (
              <button
                key={r.id}
                onClick={() => app.go({ page: "detail", id: r.id })}
              >
                <span>{r.description}</span>
                <Amount
                  value={r.amountMinor}
                  currency={a?.currency || book.currency}
                />
                <Icon name="ChevronRight" size={16} />
              </button>
            ))}
          </div>
        )}
        <div className="detail-actions">
          {refundable && (
            <Button
              variant="soft"
              icon="RotateCcw"
              onClick={() =>
                app.go({
                  page: "entry",
                  kind: "refund",
                  originalId: e.id,
                  accountId: e.accountId,
                })
              }
            >
              退款
            </Button>
          )}
          {e.deletedAt ? (
            <Button
              variant="soft"
              icon="ArchiveRestore"
              onClick={async () => {
                if (await app.save("恢复交易", (b) => restoreEntry(b, e.id)))
                  app.back();
              }}
            >
              恢复交易
            </Button>
          ) : (
            <Button
              variant="plain"
              icon="Trash2"
              className="danger-text"
              disabled={deleting}
              onClick={deleteDialog}
            >
              删除交易
            </Button>
          )}
        </div>
      </main>
    </>
  );
}
export function Trash() {
  const app = useApp(),
    deleted = app.book.entries.filter((e) => e.deletedAt);
  return (
    <>
      <Header title="最近删除" back />
      <main className="page-content">
        <Transactions entries={deleted} />
      </main>
    </>
  );
}
