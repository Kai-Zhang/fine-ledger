import { transactionSelection } from "../domain/transaction-view.ts";
import { EntryAction } from "../components/EntryAction.tsx";
import { useReferenceRates } from "../reports/useReferenceRates.ts";
import { PostingDialog } from "../components/PostingDialog.tsx";
import { TransactionFilters } from "../components/TransactionFilters.tsx";
import {
  emptyFilter,
  matchingSplits,
  categoryMatches,
  type TransactionFilter,
} from "../domain/filters.ts";
import {
  useMemo,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  type UIEvent,
} from "react";
import { useApp } from "../ui/context.tsx";
import { wideLayoutQuery } from "../ui/layout.ts";
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
  entryCurrency,
  needsSettlement,
  balance,
  liveEntries,
  removeEntry,
  restoreEntry,
  refundOriginalId,
} from "../domain/ledger.ts";
import { localDate, displayTime } from "../domain/dates.ts";
import { money } from "../domain/money.ts";
import { reportRows } from "../domain/reporting.ts";
export function TransactionsPage({
  wideLayout = false,
}: {
  wideLayout?: boolean;
}) {
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
  const ledger = useRef<HTMLElement>(null);
  const wideViewport = useMemo(() => window.matchMedia(wideLayoutQuery), []);
  const scrollAnchor = useRef<{ section: HTMLElement; offset: number } | null>(
    null,
  );
  function rememberScrollAnchor(event: UIEvent<HTMLElement>) {
    // A viewport resize can dispatch a scroll event before React updates the layout.
    if (wideViewport.matches !== wideLayout) return;
    const container = event.currentTarget;
    const { left, top, width } = container.getBoundingClientRect();
    const section = document
      .elementFromPoint(left + width / 2, top + 1)
      ?.closest<HTMLElement>(".transaction-list > section");
    scrollAnchor.current =
      section && container.contains(section)
        ? { section, offset: section.getBoundingClientRect().top - top }
        : null;
  }
  useLayoutEffect(() => {
    const container = ledger.current,
      anchor = scrollAnchor.current;
    if (!container || !anchor || !container.contains(anchor.section)) return;
    const top = container.getBoundingClientRect().top;
    container.scrollTop +=
      anchor.section.getBoundingClientRect().top - top - anchor.offset;
  }, [wideLayout]);
  useEffect(() => {
    app.views.set(viewKey, { query, filters });
  }, [viewKey, query, filters]);
  const fromReport = !!(
    route.from ||
    route.to ||
    route.accountIds ||
    route.reportKind ||
    route.reportKinds ||
    route.entryIds
  );
  const select = (f: TransactionFilter) =>
    transactionSelection(book, route, f, query);
  const entries = useMemo(() => select(filters), [book, route, filters, query]);
  const scope =
    account?.id ||
    (filters.accounts.length === 1 ? filters.accounts[0] : undefined);
  const matched = useMemo(() => {
    if (
      !filters.categories.length &&
      !filters.projects.length &&
      !route.categoryIds?.length &&
      !route.projectIds?.length
    )
      return undefined;
    return new Map(
      entries
        .filter((e) => e.splits.length > 1)
        .map((e) => {
          const splits = matchingSplits(book, e, filters).filter(
            (s) =>
              (!route.categoryIds?.length && !route.projectIds?.length) ||
              matchingSplits(
                book,
                { ...e, splits: [s] },
                {
                  categories: route.categoryIds || [],
                  projects: route.projectIds || [],
                },
              ).length,
          );
          const sum = splits.reduce((n, s) => n + BigInt(s.amountMinor), 0n);
          return [e.id, money(sum, entryCurrency(book, e))];
        }),
    );
  }, [book, entries, filters, route]);
  const referenceQuotes = useReferenceRates(
    book.currency,
    book.accounts
      .filter((a) => route.accountIds?.includes(a.id))
      .map((a) => a.currency),
    route.from && localDate(route.from, book.timeZone),
    route.to && localDate(route.to, book.timeZone),
    !!route.reportCurrency && !app.preview,
  );
  const priced = useMemo(() => {
    if (!route.reportCurrency) return;
    const visible = new Set(entries.map((e) => e.id));
    const rows = reportRows({
      book,
      type: "cashflow",
      from: localDate(route.from!, book.timeZone),
      to: localDate(route.to!, book.timeZone),
      ids: route.accountIds || [],
      categoryIds: route.categoryIds || [],
      projectIds: route.projectIds || [],
      now: new Date().toISOString(),
      referenceQuotes,
    });
    const labels = new Map<string, string>();
    let total = 0n,
      missing = 0;
    for (const row of rows) {
      if (!visible.has(row.entry.id)) continue;
      if (row.missing) {
        missing++;
        labels.set(row.entry.id, "未计入汇总");
        continue;
      }
      const splits = row.splits.filter(
        (s) =>
          categoryMatches(
            book,
            { ...s, id: "", amountMinor: s.native.toString() },
            filters.categories,
          ) &&
          (!filters.projects.length ||
            filters.projects.includes(s.projectId || "none")),
      );
      let amount = row.splits.length
        ? splits.reduce((n, s) => n + s.amount, 0n)
        : row.amount;
      if (route.reportMeasure === "surplus" && row.entry.kind === "expense")
        amount = -amount;
      else if (
        row.entry.kind === "refund" &&
        route.reportMeasure !== "refund" &&
        route.reportMeasure !== "surplus"
      )
        amount = -amount;
      total += amount;
      labels.set(row.entry.id, money(amount, route.reportCurrency, true));
    }
    return { total, missing, labels };
  }, [book, entries, filters, route, referenceQuotes]);
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
          <button
            onClick={() => {
              app.close();
              app.go({
                page: "report",
                report: "balance",
                accountId: account.id,
              });
            }}
          >
            <Icon name="ChartNoAxesCombined" />
            余额历史
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
  const postedBalance = account ? balance(book, account.id) : 0n;
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
      <main
        className={`page-content transactions-page${account ? " account-ledger-page" : ""}`}
        ref={account && !app.preview ? ledger : undefined}
        onScroll={account && !app.preview ? rememberScrollAnchor : undefined}
      >
        {priced && (
          <div className="report-drill-summary">
            <span>
              报表
              {route.reportMeasure === "surplus"
                ? "结余"
                : route.reportMeasure === "net"
                  ? "净支出"
                  : "合计"}{" "}
              <small>{route.reportCurrency}</small>
            </span>
            <Amount value={priced.total} currency={route.reportCurrency!} />
            {priced.missing > 0 && (
              <small>{priced.missing} 笔缺少折算依据，未计入</small>
            )}
          </div>
        )}
        {account && (
          <div className="account-balance">
            <span>
              已入账余额 <small>{account.currency}</small>
            </span>
            <Amount value={postedBalance} currency={account.currency} />
            {account.type === "credit" &&
              account.creditLimitMinor !== undefined && (
                <p className="muted compact-note">
                  信用额度 {money(account.creditLimitMinor, account.currency)} ·
                  可用{" "}
                  {money(
                    BigInt(account.creditLimitMinor) + postedBalance,
                    account.currency,
                  )}{" "}
                  {account.currency}
                </p>
              )}
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
          reportMatched={priced?.labels}
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
        <EntryAction
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
    refunds = book.entries.filter(
      (r) => refundOriginalId(r) === e.id && !r.deletedAt,
    ),
    original = book.entries.find((r) => r.id === refundOriginalId(e)),
    refundable =
      e.kind === "expense" && e.posted && !e.deletedAt && !a?.archived;
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
              : book.entries.some((f) => f.transferId === e!.id && !f.deletedAt)
                ? "删除转账会保留独立的手续费支出，可从关联记录单独处理。"
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
            currency={entryCurrency(book, e)}
            code
          />
          <span className={`status-badge ${e.posted ? "" : "pending"}`}>
            {e.deletedAt ? "已删除" : e.posted ? "已入账" : "未入账"}
          </span>
        </div>
        <div className="detail-surface">
          {e.originalAmount && !needsSettlement(book, e) && (
            <div className="detail-line">
              <span>原始金额</span>
              <Amount
                value={e.originalAmount.amountMinor}
                currency={e.originalAmount.currency}
                code
              />
            </div>
          )}
          {needsSettlement(book, e) && (
            <div className="detail-line">
              <span>{a?.currency} 入账金额</span>
              <span>待确认</span>
            </div>
          )}
          {e.transferId && (
            <button
              className="linked-entry"
              onClick={() => app.go({ page: "detail", id: e.transferId })}
            >
              关联转账 ·{" "}
              {book.entries.find((t) => t.id === e.transferId)?.description}
              <Icon name="ChevronRight" size={16} />
            </button>
          )}
          {book.entries
            .filter((t) => t.transferId === e.id && !t.deletedAt)
            .map((f) => (
              <button
                className="linked-entry"
                key={f.id}
                onClick={() => app.go({ page: "detail", id: f.id })}
              >
                <span>手续费</span>
                <Amount
                  value={f.amountMinor}
                  currency={entryCurrency(book, f)}
                  code
                />
                <Icon name="ChevronRight" size={16} />
              </button>
            ))}

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
                      currency={entryCurrency(book, e)}
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
              原记录 · {original.description}
              {original.deletedAt && <small>原消费已删除</small>}
            </span>
            <Icon name="ChevronRight" size={16} />
          </button>
        )}
        {refunds.length > 0 && (
          <div className="linked-refunds">
            <h3>关联退款</h3>
            {refunds.map((r) => {
              const refundCurrency =
                book.accounts.find((account) => account.id === r.accountId)
                  ?.currency || book.currency;
              return (
                <button
                  key={r.id}
                  onClick={() => app.go({ page: "detail", id: r.id })}
                >
                  <span>{r.description}</span>
                  <Amount
                    value={r.amountMinor}
                    currency={refundCurrency}
                    code={refundCurrency !== a?.currency}
                  />
                  <Icon name="ChevronRight" size={16} />
                </button>
              );
            })}
          </div>
        )}
        <div className="detail-actions">
          {!e.posted &&
            !e.deletedAt &&
            ["expense", "income"].includes(e.kind) && (
              <Button
                icon="Check"
                onClick={() => app.open(<PostingDialog entry={e} />)}
              >
                确认入账
              </Button>
            )}

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
