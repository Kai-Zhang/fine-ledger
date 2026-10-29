import { useState, useCallback, useEffect, useRef } from "react";
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
import { AccountEditor, GroupEditor } from "../components/AccountEditor.tsx";
import { balance, netWorth, removeEmptyGroup } from "../domain/ledger.ts";
import { moveAccount } from "../domain/organization.ts";
import type { Account, Group, Book } from "../domain/types.ts";
function AccountRow({
  account,
  manage,
  edit,
  archive,
  drop,
  after,
  book,
}: {
  account: Account;
  manage: boolean;
  edit: () => void;
  archive: () => void;
  drop: boolean;
  after: boolean;
  book: Book;
}) {
  const app = useApp(),
    sort = useSortable({
      id: dragId("account", account.id),
      data: { type: "account", id: account.id, groupId: account.groupId },
      disabled: !manage,
    });
  const value = balance(book, account.id);
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
  const accounts = book.accounts
      .filter((a) => a.groupId === group.id && !a.archived)
      .sort((a, b) => a.order - b.order),
    totals = new Map<string, bigint>();
  accounts.forEach((a) =>
    totals.set(
      a.currency,
      (totals.get(a.currency) || 0n) + balance(book, a.id),
    ),
  );
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
          <div className="group-totals">
            {[...totals].map(([currency, n]) => (
              <span key={currency}>
                <Amount value={n} currency={currency} />
                <small>{currency}</small>
              </span>
            ))}
          </div>
          {manage &&
            !!group.id &&
            !book.accounts.some((a) => a.groupId === group.id) && (
              <IconButton
                className="subtle-action"
                name="Trash2"
                label={`删除空分组 ${group.name}`}
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
              book={book}
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
export function Accounts() {
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
  const groups = book.groups.slice().sort((a, b) => a.order - b.order),
    net = netWorth(book, new Date().toISOString()),
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
  async function deleteGroup(g: Group) {
    if (
      await app.confirm({
        title: "删除空分组？",
        message: `将删除“${g.name}”，交易不会改变。`,
        label: "删除",
        danger: true,
      })
    )
      await app.save("删除空分组", (b) => removeEmptyGroup(b, g.id));
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
      <Header title="账户">
        <IconButton
          name={manage ? "Check" : "ListOrdered"}
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
              {net.missing.length ? "已折算净值" : "总净值"}{" "}
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
            {[{ id: "", name: "未分组", order: -1 }, ...groups]
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
                      value={balance(book, activeAccount.id)}
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
      {!manage && book.accounts.some((a) => !a.archived) && (
        <div className="floating-entry">
          <IconButton
            className="entry-action"
            name="SquarePen"
            label="记一笔"
            onClick={() =>
              app.go({
                page: "entry",
                accountId: book.accounts.find((a) => !a.archived)?.id,
              })
            }
          />
        </div>
      )}
    </>
  );
}
export function ArchiveAccounts() {
  const app = useApp();
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
                  value={balance(app.book, a.id)}
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
