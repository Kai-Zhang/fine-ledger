import { TransactionFilters } from "../components/TransactionFilters.tsx";
import {
  emptyFilter,
  filterEntries,
  matchingSplits,
  categoryMatches,
  type TransactionFilter,
} from "../domain/filters.ts";
import { useMemo, useState, useEffect } from "react";
import { useApp } from "../ui/context.tsx";
import {
  Header,
  Button,
  IconButton,
  Amount,
  Dialog,
  Empty,
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
} from "../domain/ledger.ts";
import { localDate, displayTime, compareTime } from "../domain/dates.ts";
import { money } from "../domain/money.ts";
export function TransactionsPage() {
  const app = useApp(),
    { book, route } = app;
  const viewKey = `${app.mode}:transactions:${JSON.stringify(route)}`;
  const cached = app.views.get(viewKey) as
    { query: string; filters: TransactionFilter } | undefined;
  const account =
    route.page === "account"
      ? book.accounts.find((a) => a.id === route.id)
      : undefined;
  const [query, setQuery] = useState(cached?.query || ""),
    [filters, setFilters] = useState<TransactionFilter>(
      cached?.filters || {
        ...emptyFilter(),
        accounts: route.accountId ? [route.accountId] : [],
        currency: account?.currency || "",
        status: route.filter === "pending" ? "pending" : "all",
      },
    ),
    [showFilters, setShowFilters] = useState(false);
  useEffect(() => {
    app.views.set(viewKey, { query, filters });
  }, [viewKey, query, filters]);
  const fromReport = !!(
    route.from ||
    route.to ||
    route.accountIds ||
    route.reportKind
  );
  const base = useMemo(
    () =>
      liveEntries(book).filter((e) => {
        const at =
          (account?.id || route.accountId) === e.toAccountId &&
          e.kind === "transfer"
            ? e.receivedAt || e.occurredAt
            : e.occurredAt;
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
          (!route.from || compareTime(at, route.from) >= 0) &&
          (!route.to || compareTime(at, route.to) <= 0) &&
          (!route.categoryIds?.length ||
            matchingSplits(book, e, {
              categories: route.categoryIds,
              projects: [],
            }).length > 0)
        );
      }),
    [book, route, account],
  );
  const select = (f: TransactionFilter) =>
    filterEntries(book, base, f, query, account?.id).filter(
      (e) =>
        !route.categoryIds?.length ||
        matchingSplits(book, e, f).some((s) =>
          categoryMatches(book, s, route.categoryIds!),
        ),
    );
  const entries = useMemo(
    () => select(filters),
    [book, base, filters, query, account, route],
  );
  const scope =
    account?.id ||
    (filters.accounts.length === 1 ? filters.accounts[0] : undefined);
  const matched = useMemo(() => {
    if (
      !filters.categories.length &&
      !filters.projects.length &&
      !route.categoryIds?.length
    )
      return undefined;
    return new Map(
      entries
        .filter((e) => e.splits.length > 1)
        .map((e) => {
          const splits = matchingSplits(book, e, filters).filter(
            (s) =>
              !route.categoryIds?.length ||
              matchingSplits(
                book,
                { ...e, splits: [s] },
                { categories: route.categoryIds, projects: [] },
              ).length,
          );
          const sum = splits.reduce((n, s) => n + BigInt(s.amountMinor), 0n);
          return [
            e.id,
            money(
              sum,
              book.accounts.find((a) => a.id === e.accountId)!.currency,
            ),
          ];
        }),
    );
  }, [book, entries, filters, route]);
  const chips: { label: string; clear: () => void }[] = [];
  const clear = (key: keyof TransactionFilter) =>
    setFilters((f) => ({ ...f, [key]: emptyFilter()[key] }));
  if (filters.period)
    chips.push({
      label:
        filters.period === "month"
          ? "本月"
          : filters.period === "lastMonth"
            ? "上月"
            : filters.period === "30"
              ? "近30天"
              : `${filters.from}—${filters.to}`,
      clear: () => clear("period"),
    });
  if (filters.accounts.length)
    chips.push({
      label: filters.accounts
        .map((id) => book.accounts.find((a) => a.id === id)?.name)
        .join("、"),
      clear: () => clear("accounts"),
    });
  if (filters.kinds.length)
    chips.push({
      label: filters.kinds.map((k) => kindLabel[k]).join("、"),
      clear: () => clear("kinds"),
    });
  if (filters.categories.length)
    chips.push({
      label: `类目 · ${filters.categories.length}`,
      clear: () => clear("categories"),
    });
  if (filters.projects.length)
    chips.push({
      label: `项目 · ${filters.projects.length}`,
      clear: () => clear("projects"),
    });
  if (filters.status !== "all")
    chips.push({
      label: filters.status === "posted" ? "已入账" : "未入账",
      clear: () => clear("status"),
    });
  if (filters.min || filters.max || (!account && filters.currency))
    chips.push({
      label: `${filters.currency} ${filters.min || "0"}—${filters.max || "不限"}`,
      clear: () =>
        setFilters((f) => ({
          ...f,
          currency: account?.currency || "",
          min: "",
          max: "",
        })),
    });
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
              <Icon name="ListFilter" />
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
        {account && (
          <IconButton name="MoreHorizontal" label="账户菜单" onClick={menu} />
        )}
        <IconButton
          name="ListFilter"
          label="筛选交易"
          onClick={() => setShowFilters(!showFilters)}
        />
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
            placeholder="搜索描述、备注"
            aria-label="搜索交易描述和备注"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="filter-bar">
          <button
            className={filters.status === "all" ? "selected" : ""}
            onClick={() => clear("status")}
          >
            全部
          </button>
          {!route.postedOnly && (
            <button
              className={filters.status === "pending" ? "selected" : ""}
              onClick={() => setFilters((f) => ({ ...f, status: "pending" }))}
            >
              未入账
            </button>
          )}
          {fromReport && <span className="filter-label">报表筛选</span>}
          <span className="record-count">{entries.length} 笔</span>
        </div>
        {chips.length > 0 && (
          <div className="active-filter-chips">
            {chips.map((c, i) => (
              <button key={i} onClick={c.clear}>
                {c.label}
                <Icon name="X" size={12} />
              </button>
            ))}
          </div>
        )}
        <Transactions
          entries={entries}
          scope={scope}
          currency={filters.currency}
          matched={matched}
        />
      </main>
      {showFilters && (
        <TransactionFilters
          value={filters}
          scope={account?.id}
          count={(f) => select(f).length}
          onApply={setFilters}
          onClose={() => setShowFilters(false)}
        />
      )}
      {!account?.archived && book.accounts.some((a) => !a.archived) && (
        <div className="floating-entry">
          <IconButton
            className="entry-action"
            name="SquarePen"
            label="记一笔"
            onClick={() =>
              app.go({
                page: "entry",
                accountId:
                  account?.id ||
                  (filters.accounts.length === 1
                    ? filters.accounts[0]
                    : undefined) ||
                  book.accounts.find((a) => !a.archived)?.id,
              })
            }
          />
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
      (remainingRefund(book, e.id) ?? 0n) > 0n;
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
