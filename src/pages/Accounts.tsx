import { referenceRateLookup } from "../domain/reference-rates.ts";
import { EntryAction } from "../components/EntryAction.tsx";
import { currentAccountBalances } from "../domain/account-view.ts";
import {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import {
  DndContext,
  useDroppable,
  DragOverlay,
  closestCenter,
  pointerWithin,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useApp } from "../ui/context.tsx";
import {
  useOrganization,
  dragId,
  useDragSensors,
  useDragSelection,
} from "../ui/organization.ts";
import {
  Header,
  Button,
  IconButton,
  Amount,
  Empty,
} from "../ui/components.tsx";
import { Icon } from "../ui/icons.tsx";
import {
  AccountEditor,
  GroupEditor,
  GroupRemoval,
} from "../components/AccountEditor.tsx";
import { netWorth, rateFor } from "../domain/ledger.ts";
import { moveAccount } from "../domain/organization.ts";
import type { Account, Group, Book } from "../domain/types.ts";

const ungrouped = { id: "", name: "未分组", order: -1 };
function activeAccountsInGroup(book: Book, groupId: string) {
  return book.accounts
    .filter((a) => a.groupId === groupId && !a.archived)
    .sort((a, b) => a.order - b.order);
}
function groupBalanceTotals(
  accounts: Account[],
  balances: ReadonlyMap<string, bigint>,
) {
  const totals = new Map<string, bigint>();
  for (const { id, currency } of accounts) {
    totals.set(
      currency,
      (totals.get(currency) ?? 0n) + (balances.get(id) ?? 0n),
    );
  }
  return totals;
}

function GroupTotals({ totals }: { totals: ReadonlyMap<string, bigint> }) {
  return (
    <div className="group-totals">
      {[...totals].map(([currency, value]) => (
        <span key={currency}>
          <Amount value={value} currency={currency} />
          <small>{currency}</small>
        </span>
      ))}
    </div>
  );
}

function AccountRow({
  account,
  manage,
  edit,
  archive,
  drop,
  after,
  value,
}: {
  account: Account;
  manage: boolean;
  edit: () => void;
  archive: () => void;
  drop: boolean;
  after: boolean;
  value: bigint;
}) {
  const app = useApp(),
    sort = useSortable({
      id: dragId("account", account.id),
      data: { type: "account", id: account.id, groupId: account.groupId },
      disabled: !manage,
    });
  return (
    <div
      ref={sort.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sort.transform),
        transition: sort.transition,
        opacity: sort.isDragging ? 0.18 : 1,
      }}
      className={`account-row ${drop ? (after ? "drop-account-after" : "drop-account") : ""}`}
    >
      {manage && (
        <button
          type="button"
          className="drag-handle"
          aria-label={`拖动排序 ${account.name}`}
          {...sort.attributes}
          {...sort.listeners}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Icon name="GripVertical" size={17} />
        </button>
      )}
      <button
        type="button"
        className="account-main"
        onClick={() => {
          if (window.getSelection()?.toString()) return;
          manage ? edit() : app.go({ page: "account", id: account.id });
        }}
      >
        <span className={`account-symbol ${account.type}`}>
          <Icon name={account.icon} size={20} />
        </span>
        <span className="account-name">
          <strong className="copyable-name">{account.name}</strong>
          <small>
            {account.currency}
            {!account.netWorth ? " · 不纳入净值" : ""}
          </small>
        </span>
        <Amount
          value={value}
          currency={account.currency}
          className={value < 0n ? "negative" : ""}
        />
        {!manage && <Icon name="ChevronRight" size={15} />}
      </button>
      {manage && (
        <IconButton
          className="subtle-action"
          name="Archive"
          label={`归档账户 ${account.name}`}
          onClick={archive}
        />
      )}
    </div>
  );
}
function GroupSection({
  group,
  manage,
  book,
  balances,
  edit,
  archive,
  editGroup,
  deleteGroup,
  drop,
  after,
}: {
  group: Group;
  manage: boolean;
  book: Book;
  balances: ReadonlyMap<string, bigint>;
  edit: (a: Account) => void;
  archive: (a: Account) => void;
  editGroup: () => void;
  deleteGroup: () => void;
  drop: string | null;
  after: boolean;
}) {
  const sort = useSortable({
    id: dragId("group", group.id),
    data: { type: "group", id: group.id },
    disabled: !manage || !group.id,
  });
  const bucket = useDroppable({
    id: `bucket:${group.id}`,
    data: { type: "bucket", groupId: group.id },
    disabled: !manage,
  });
  const ref = useCallback(
    (node: HTMLElement | null) => {
      sort.setNodeRef(node);
      bucket.setNodeRef(node);
    },
    [sort.setNodeRef, bucket.setNodeRef],
  );
  const accounts = activeAccountsInGroup(book, group.id);
  return (
    <section
      ref={ref}
      className={`account-group ${drop === `bucket:${group.id}` ? "drop-bucket" : ""}`}
      style={{
        transform: CSS.Transform.toString(sort.transform),
        transition: sort.transition,
        opacity: sort.isDragging ? 0.25 : 1,
      }}
    >
      {(!!group.id || manage) && (
        <div className="group-heading">
          {manage && !!group.id && (
            <button
              className="drag-handle"
              aria-label={`拖动分组 ${group.name}`}
              {...sort.attributes}
              {...sort.listeners}
              onContextMenu={(e) => e.preventDefault()}
            >
              <Icon name="GripVertical" size={17} />
            </button>
          )}
          {manage && !!group.id ? (
            <button className="group-edit" onClick={editGroup}>
              {group.name}
            </button>
          ) : (
            <h2>{group.name}</h2>
          )}
          <GroupTotals totals={groupBalanceTotals(accounts, balances)} />
          {manage && !!group.id && (
            <IconButton
              className="subtle-action"
              name="Trash2"
              label={`删除分组 ${group.name}`}
              onClick={deleteGroup}
            />
          )}
        </div>
      )}
      <div className="account-surface">
        <SortableContext
          items={accounts.map((a) => dragId("account", a.id))}
          strategy={verticalListSortingStrategy}
        >
          {accounts.map((a) => (
            <AccountRow
              key={a.id}
              account={a}
              manage={manage}
              edit={() => edit(a)}
              archive={() => archive(a)}
              drop={drop === dragId("account", a.id)}
              after={after}
              value={balances.get(a.id) ?? 0n}
            />
          ))}
        </SortableContext>
        {!accounts.length && (
          <div className="empty-group">{manage ? "拖到这里" : "暂无账户"}</div>
        )}
      </div>
    </section>
  );
}
export function AccountListPane({
  selectedId,
  onSelect,
}: {
  selectedId?: string;
  onSelect: (accountId: string) => void;
}) {
  const app = useApp();
  const list = useRef<HTMLElement>(null);
  const scrollKey = `${app.mode}:accounts:split-list-scroll`;
  useLayoutEffect(() => {
    if (list.current)
      list.current.scrollTop = (app.views.get(scrollKey) as number) ?? 0;
  }, [app.views, scrollKey]);
  useLayoutEffect(() => {
    const container = list.current;
    const selected = container?.querySelector(
      ".account-main[aria-current=true]",
    );
    if (!container || !selected) return;
    const row = selected.getBoundingClientRect();
    const area = container.getBoundingClientRect();
    if (row.top < area.top) container.scrollTop += row.top - area.top;
    else if (row.bottom > area.bottom)
      container.scrollTop += row.bottom - area.bottom;
  }, [selectedId]);
  const groups = [
    ungrouped,
    ...app.book.groups.slice().sort((a, b) => a.order - b.order),
  ];
  const balances = useMemo(
    () => currentAccountBalances(app.book, new Date().toISOString()),
    [app.book],
  );
  return (
    <aside className="account-pane" aria-label="账户列表">
      <h2>账户</h2>
      <nav
        ref={list}
        aria-label="选择账户"
        className="account-pane-list"
        onScroll={(event) =>
          app.views.set(scrollKey, event.currentTarget.scrollTop)
        }
      >
        <button
          type="button"
          className="account-pane-overview"
          aria-current={!selectedId ? "page" : undefined}
          onClick={() => app.go({ page: "accounts" })}
        >
          <Icon name="Wallet" size={18} />
          总览
        </button>
        {groups.map((group) => {
          const accounts = activeAccountsInGroup(app.book, group.id);
          if (!accounts.length) return null;
          return (
            <section className="account-pane-group" key={group.id}>
              <h3>{group.name}</h3>
              {accounts.map((account) => (
                <button
                  type="button"
                  className="account-main"
                  key={account.id}
                  aria-current={selectedId === account.id ? true : undefined}
                  onClick={() => onSelect(account.id)}
                >
                  <span className={`account-symbol ${account.type}`}>
                    <Icon name={account.icon} size={18} />
                  </span>
                  <span className="account-name">
                    <strong title={account.name}>{account.name}</strong>
                    <Amount
                      value={balances.get(account.id) ?? 0n}
                      currency={account.currency}
                      code
                    />
                  </span>
                </button>
              ))}
            </section>
          );
        })}
      </nav>
    </aside>
  );
}

export function Accounts({ overview = false }: { overview?: boolean }) {
  const app = useApp(),
    { book, commit } = useOrganization(),
    [manage, setManage] = useState(false),
    [addMenu, setAddMenu] = useState(false),
    [drag, setDrag] = useState<{ type: string; id: string } | null>(null),
    [drop, setDrop] = useState<string | null>(null),
    [after, setAfter] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!addMenu || app.preview) return;
    const menu = menuRef.current;
    const trigger = menu?.querySelector<HTMLButtonElement>(".entry-action");
    const items = () => [
      ...(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || []),
    ];
    const focusTimer = requestAnimationFrame(() => items()[0]?.focus());
    const unregister = app.registerLayer(() => {
      setAddMenu(false);
      trigger?.focus();
    });
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setAddMenu(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setAddMenu(false);
        trigger?.focus();
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const list = items(),
          index = list.indexOf(document.activeElement as HTMLButtonElement),
          step = event.key === "ArrowDown" ? 1 : -1;
        list[(index + step + list.length) % list.length]?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      cancelAnimationFrame(focusTimer);
      unregister();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [addMenu, app.preview]);
  const sensors = useDragSensors();
  useDragSelection(!!drag);
  const hasActiveAccounts = book.accounts.some((a) => !a.archived);
  const netAccounts = book.accounts.filter((account) => account.netWorth);
  const lookup = referenceRateLookup(
    app.currentReferenceQuotes,
    book.currency,
    book.timeZone,
  );
  const groups = book.groups.slice().sort((a, b) => a.order - b.order),
    at = new Date().toISOString(),
    balances = currentAccountBalances(book, at),
    net = netWorth(book, at, undefined, balances, (id, date) => {
      const account = netAccounts.find((candidate) => candidate.id === id);
      return (
        (account && lookup(account.currency, date)) || rateFor(book, id, date)
      );
    }),
    activeAccount =
      drag?.type === "account"
        ? book.accounts.find((a) => a.id === drag.id)
        : undefined;
  const editAccount = (a?: Account) =>
    app.open(<AccountEditor account={a} onClose={app.close} />);
  const editGroup = (id?: string) =>
    app.open(<GroupEditor id={id} onClose={app.close} />);
  async function archive(a: Account) {
    if (
      await app.confirm({
        title: "归档账户？",
        message: `“${a.name}”将从首页隐藏，保留交易、余额和净值历史。`,
        label: "归档",
      })
    )
      await app.save("归档账户", (b) => {
        b.accounts.find((x) => x.id === a.id)!.archived = true;
      });
  }
  function deleteGroup(g: Group) {
    app.open(<GroupRemoval id={g.id} onClose={app.close} />);
  }
  function end(e: DragEndEvent) {
    const active = e.active.data.current,
      target = e.over?.data.current;
    if (active && target && e.over && e.over.id !== e.active.id) {
      if (active.type === "group" && target.type === "group") {
        void commit("排列分组", (b) => {
          const rows = b.groups.slice().sort((a, b) => a.order - b.order);
          arrayMove(
            rows,
            rows.findIndex((g) => g.id === active.id),
            rows.findIndex((g) => g.id === target.id),
          ).forEach((g, i) => (b.groups.find((x) => x.id === g.id)!.order = i));
        });
      } else if (
        active.type === "account" &&
        (target.type === "account" || target.type === "bucket")
      ) {
        const groupId = target.groupId as string;
        const r = e.active.rect.current.translated,
          below =
            e.activatorEvent.type === "keydown"
              ? target.type === "account" &&
                book.accounts.find((a) => a.id === active.id)!.groupId ===
                  target.groupId &&
                book.accounts.find((a) => a.id === active.id)!.order <
                  book.accounts.find((a) => a.id === target.id)!.order
              : !!r &&
                r.top + r.height / 2 > e.over.rect.top + e.over.rect.height / 2;
        const siblings = book.accounts
          .filter((a) => a.groupId === groupId && a.id !== active.id)
          .sort((a, b) => a.order - b.order);
        const before =
          target.type === "bucket"
            ? undefined
            : below
              ? siblings[siblings.findIndex((a) => a.id === target.id) + 1]?.id
              : target.id;
        void commit("移动账户", (b) =>
          moveAccount(b, active.id, groupId, before),
        );
      }
    }
    setDrag(null);
    setDrop(null);
  }
  return (
    <>
      <Header title={overview ? "账户总览" : "账户"}>
        <IconButton
          name={manage ? "Check" : "Pencil"}
          label={manage ? "完成账户管理" : "管理账户"}
          onClick={() => {
            setAddMenu(false);
            setManage(!manage);
          }}
        />
      </Header>
      <main className="page-content accounts-page">
        {!book.accounts.length && (
          <Empty
            title="还没有账户"
            action={<Button onClick={() => editAccount()}>新增账户</Button>}
          />
        )}
        <button
          className="net-summary"
          onClick={() => app.go({ page: "report", report: "net" })}
        >
          <div>
            <span>
              {net.missing.length
                ? "已折算净值"
                : net.provisional
                  ? "净值估算"
                  : "总净值"}{" "}
              <small>{book.currency}</small>
            </span>
            <Amount value={net.total} currency={book.currency} />
            {!!net.missing.length && (
              <small className="warning">
                另有 {net.missing.length} 个外币账户待折算
              </small>
            )}
          </div>
          <Icon name="ArrowUpRight" />
        </button>
        {overview && !manage && hasActiveAccounts && (
          <section className="account-overview-groups">
            <h2>分组余额</h2>
            <div className="account-surface">
              {[ungrouped, ...groups].map((group) => {
                const accounts = activeAccountsInGroup(book, group.id);
                if (!accounts.length) return null;
                return (
                  <div key={group.id} className="account-overview-group">
                    <div>
                      <h3>{group.name}</h3>
                      <small>{accounts.length} 个账户</small>
                    </div>
                    <GroupTotals
                      totals={groupBalanceTotals(accounts, balances)}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        )}
        <DndContext
          sensors={sensors}
          accessibility={{
            screenReaderInstructions: {
              draggable:
                "长按手柄拖动，或按空格开始排序；方向键移动，空格放下，Escape取消。",
            },
            announcements: {
              onDragStart: () => "开始排序",
              onDragOver: () => "正在移动",
              onDragEnd: () => "排序完成",
              onDragCancel: () => "已取消排序",
            },
          }}
          collisionDetection={(args) => {
            const items = args.droppableContainers.filter((c) =>
              args.active.data.current?.type === "group"
                ? c.data.current?.type === "group"
                : c.data.current?.type === "account" ||
                  c.data.current?.type === "bucket",
            );
            const hits = pointerWithin({ ...args, droppableContainers: items }),
              rows = hits.filter(
                (h) =>
                  items.find((c) => c.id === h.id)?.data.current?.type ===
                  "account",
              );
            return rows.length
              ? rows
              : hits.length
                ? hits
                : closestCenter({
                    ...args,
                    droppableContainers: items.filter(
                      (c) => c.data.current?.type !== "bucket",
                    ),
                  });
          }}
          onDragStart={(e) => {
            setDrag({
              type: e.active.data.current!.type,
              id: e.active.data.current!.id,
            });
            document.documentElement.classList.add("is-reordering");
          }}
          onDragOver={(e) =>
            setDrop(
              e.over && e.over.id !== e.active.id ? String(e.over.id) : null,
            )
          }
          onDragMove={(e) => {
            const r = e.active.rect.current.translated;
            setAfter(
              !!(
                e.over &&
                r &&
                r.top + r.height / 2 > e.over.rect.top + e.over.rect.height / 2
              ),
            );
          }}
          onDragEnd={(e) => {
            document.documentElement.classList.remove("is-reordering");
            end(e);
          }}
          onDragCancel={() => {
            document.documentElement.classList.remove("is-reordering");
            setDrag(null);
            setDrop(null);
          }}
        >
          <SortableContext
            items={groups.map((g) => dragId("group", g.id))}
            strategy={verticalListSortingStrategy}
          >
            {(!overview || manage) &&
              [ungrouped, ...groups]
                .filter(
                  (g) =>
                    g.id ||
                    manage ||
                    book.accounts.some((a) => !a.groupId && !a.archived),
                )
                .map((g) => (
                  <GroupSection
                    key={g.id}
                    group={g}
                    manage={manage}
                    book={book}
                    balances={balances}
                    edit={editAccount}
                    archive={(a) => void archive(a)}
                    editGroup={() => editGroup(g.id)}
                    deleteGroup={() => void deleteGroup(g)}
                    drop={drop}
                    after={after}
                  />
                ))}
          </SortableContext>
          <DragOverlay>
            {drag && (
              <div className="overlay-card">
                {activeAccount ? (
                  <>
                    <Icon name={activeAccount.icon} />
                    <strong>{activeAccount.name}</strong>
                    <Amount
                      value={balances.get(activeAccount.id) ?? 0n}
                      currency={activeAccount.currency}
                    />
                  </>
                ) : (
                  <strong>{groups.find((g) => g.id === drag.id)?.name}</strong>
                )}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </main>
      {manage && (
        <div className="floating-entry account-add" ref={menuRef} data-no-back>
          {addMenu && (
            <div className="add-menu" role="menu" aria-label="新增类型">
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setAddMenu(false);
                  editAccount();
                }}
              >
                <Icon name="Wallet" />
                新增账户
              </button>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setAddMenu(false);
                  editGroup();
                }}
              >
                <Icon name="FolderPlus" />
                新增分组
              </button>
            </div>
          )}
          <IconButton
            className="entry-action"
            name={addMenu ? "X" : "Plus"}
            label={addMenu ? "关闭新增菜单" : "新增账户或分组"}
            aria-haspopup="menu"
            aria-expanded={addMenu}
            onClick={() => setAddMenu(!addMenu)}
          />
        </div>
      )}
      {!manage && hasActiveAccounts && (
        <EntryAction
          onClick={() =>
            app.go({
              page: "entry",
              accountId: book.accounts.find((a) => !a.archived)?.id,
            })
          }
        />
      )}
    </>
  );
}
export function ArchiveAccounts() {
  const app = useApp();
  const balances = currentAccountBalances(app.book, new Date().toISOString());
  return (
    <>
      <Header title="已归档账户" back />
      <main className="page-content">
        {app.book.accounts
          .filter((a) => a.archived)
          .map((a) => (
            <div className="archive-account" key={a.id}>
              <button onClick={() => app.go({ page: "account", id: a.id })}>
                <Icon name={a.icon} />
                <strong>{a.name}</strong>
                <Amount
                  value={balances.get(a.id) ?? 0n}
                  currency={a.currency}
                  code
                />
              </button>
              <Button
                variant="plain"
                onClick={() =>
                  void app.save("取消归档", (b) => {
                    b.accounts.find((x) => x.id === a.id)!.archived = false;
                  })
                }
              >
                取消归档
              </Button>
            </div>
          ))}
        {!app.book.accounts.some((a) => a.archived) && (
          <Empty icon="Archive" title="没有已归档账户" />
        )}
      </main>
    </>
  );
}
