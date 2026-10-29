import { moveAccount } from "../domain/organization.ts";
import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  closestCenter,
  pointerWithin,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
import { AccountEditor, GroupEditor } from "../components/AccountEditor.tsx";
import { balance, netWorth, removeEmptyGroup } from "../domain/ledger.ts";
import type { Account, Group } from "../domain/types.ts";
function AccountRow({
  account,
  manage,
  onMenu,
  overlay = false,
  drop = false,
  dropAfter = false,
}: {
  account: Account;
  manage: boolean;
  onMenu: () => void;
  overlay?: boolean;
  drop?: boolean;
  dropAfter?: boolean;
}) {
  const app = useApp(),
    sort = useSortable({
      id: account.id,
      data: { type: "account", groupId: account.groupId },
      disabled: !manage || overlay,
    }),
    amount = balance(app.book, account.id);
  return (
    <div
      ref={sort.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sort.transform),
        transition: sort.transition,
        opacity: sort.isDragging ? 0.2 : 1,
      }}
      className={`account-row ${overlay ? "drag-overlay" : ""} ${drop ? (dropAfter ? "drop-account-after" : "drop-account") : ""}`}
    >
      {manage && (
        <button
          type="button"
          className="drag-handle"
          aria-label={`拖动排序 ${account.name}`}
          {...sort.attributes}
          {...sort.listeners}
        >
          <Icon name="GripVertical" size={18} />
        </button>
      )}
      <button
        type="button"
        className="account-main"
        onClick={() =>
          manage ? onMenu() : app.go({ page: "account", id: account.id })
        }
      >
        <span className={`account-symbol ${account.type}`}>
          <Icon name={account.icon} size={20} />
        </span>
        <span className="account-name">
          <strong>{account.name}</strong>
          <small>
            {account.currency}
            {account.archived ? " · 已归档" : ""}
            {!account.netWorth ? " · 不纳入净值" : ""}
          </small>
        </span>
        <Amount
          value={amount}
          currency={account.currency}
          className={amount < 0n ? "negative" : ""}
        />
        {!manage && <Icon name="ChevronRight" size={15} />}
      </button>
      {manage && (
        <IconButton
          name="MoreHorizontal"
          label={`管理 ${account.name}`}
          onClick={onMenu}
        />
      )}
    </div>
  );
}
function GroupSection({
  group,
  manage,
  onAccount,
  onGroup,
  drop,
  dropAfter,
}: {
  group: Group;
  manage: boolean;
  onAccount: (a: Account) => void;
  onGroup: () => void;
  drop?: string | null;
  dropAfter?: boolean;
}) {
  const { book } = useApp(),
    sort = useSortable({
      id: group.id,
      data: { type: "group" },
      disabled: !manage,
    }),
    accounts = book.accounts
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
      className={`account-group ${drop === group.id || accounts.some((a) => a.id === drop) ? "drop-group" : ""}`}
      ref={sort.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sort.transform),
        transition: sort.transition,
        opacity: sort.isDragging ? 0.3 : 1,
      }}
    >
      <div className="group-heading">
        {manage && (
          <button
            className="drag-handle"
            aria-label={`拖动分组 ${group.name}`}
            {...sort.attributes}
            {...sort.listeners}
          >
            <Icon name="GripVertical" size={17} />
          </button>
        )}
        <h2>{group.name}</h2>
        <div className="group-totals">
          {[...totals].map(([c, n]) => (
            <span key={c}>
              <Amount value={n} currency={c} />
              <small>{c}</small>
            </span>
          ))}
        </div>
        {manage && (
          <IconButton
            name="MoreHorizontal"
            label={`管理分组 ${group.name}`}
            onClick={onGroup}
          />
        )}
      </div>
      <div className="account-surface">
        <SortableContext
          items={accounts.map((a) => a.id)}
          strategy={verticalListSortingStrategy}
        >
          {accounts.map((a) => (
            <AccountRow
              key={a.id}
              account={a}
              manage={manage}
              drop={drop === a.id}
              dropAfter={dropAfter}
              onMenu={() => onAccount(a)}
            />
          ))}
        </SortableContext>
        {!accounts.length && <div className="empty-group">暂无账户</div>}
      </div>
    </section>
  );
}
export function Accounts() {
  const app = useApp(),
    { book } = app,
    [manage, setManage] = useState(false),
    [drag, setDrag] = useState<string | null>(null),
    [drop, setDrop] = useState<string | null>(null),
    [dropAfter, setDropAfter] = useState(false);
  const sensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
      useSensor(KeyboardSensor, {
        coordinateGetter: sortableKeyboardCoordinates,
      }),
    ),
    net = netWorth(book, new Date().toISOString()),
    groups = [...book.groups].sort((a, b) => a.order - b.order),
    dragAccount = book.accounts.find((a) => a.id === drag);
  const editAccount = (a?: Account, groupId?: string) =>
      app.open(
        <AccountEditor account={a} groupId={groupId} onClose={app.close} />,
      ),
    editGroup = (id?: string) =>
      app.open(<GroupEditor id={id} onClose={app.close} />);
  function accountMenu(a: Account) {
    const siblings = book.accounts
      .filter((x) => x.groupId === a.groupId && !x.archived)
      .sort((a, b) => a.order - b.order);
    app.open(
      <Dialog title={a.name} onClose={app.close}>
        <div className="menu-list">
          <button onClick={() => editAccount(a)}>
            <Icon name="Pencil" />
            编辑账户
          </button>
          <label className="menu-select">
            <Icon name="Folder" />
            移至分组
            <select
              value={a.groupId}
              onChange={async (e) => {
                const value = e.target.value;
                if (
                  await app.save("移动账户", (b) => {
                    const target = b.accounts.find((x) => x.id === a.id)!;
                    target.groupId = value;
                    target.order = b.accounts.filter(
                      (x) => x.groupId === value,
                    ).length;
                  })
                )
                  app.close();
              }}
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          {[-1, 1].map((offset) => (
            <button
              key={offset}
              disabled={
                !siblings[siblings.findIndex((x) => x.id === a.id) + offset]
              }
              onClick={async () => {
                await app.save("排列账户", (b) => {
                  const next = arrayMove(
                    siblings,
                    siblings.findIndex((x) => x.id === a.id),
                    siblings.findIndex((x) => x.id === a.id) + offset,
                  );
                  next.forEach(
                    (x, i) =>
                      (b.accounts.find((t) => t.id === x.id)!.order = i),
                  );
                });
                app.close();
              }}
            >
              <Icon name={offset === -1 ? "ArrowUpRight" : "ArrowDownLeft"} />
              {offset === -1 ? "上移" : "下移"}
            </button>
          ))}
          <button
            onClick={async () => {
              app.close();
              if (
                await app.confirm({
                  title: "归档账户？",
                  message:
                    "保留交易、余额与净值历史，账户将从首页隐藏。取消归档后可继续记账。",
                  label: "归档",
                })
              )
                await app.save("归档账户", (b) => {
                  b.accounts.find((x) => x.id === a.id)!.archived = true;
                });
            }}
          >
            <Icon name="Archive" />
            归档账户
          </button>
        </div>
      </Dialog>,
    );
  }
  function groupMenu(g: Group) {
    app.open(
      <Dialog title={g.name} onClose={app.close}>
        <div className="menu-list">
          <button onClick={() => editGroup(g.id)}>
            <Icon name="Pencil" />
            重命名
          </button>
          {[-1, 1].map((offset) => (
            <button
              key={offset}
              disabled={!groups[groups.indexOf(g) + offset]}
              onClick={async () => {
                await app.save("排列分组", (b) =>
                  arrayMove(
                    groups,
                    groups.indexOf(g),
                    groups.indexOf(g) + offset,
                  ).forEach(
                    (x, i) => (b.groups.find((t) => t.id === x.id)!.order = i),
                  ),
                );
                app.close();
              }}
            >
              <Icon name={offset === -1 ? "ArrowUpRight" : "ArrowDownLeft"} />
              {offset === -1 ? "上移" : "下移"}
            </button>
          ))}
          <button onClick={() => editAccount(undefined, g.id)}>
            <Icon name="Plus" />
            在此分组新增账户
          </button>
          <button
            className="danger-text"
            disabled={book.accounts.some((a) => a.groupId === g.id)}
            title={
              book.accounts.some((a) => a.groupId === g.id)
                ? "请先移出所有账户，包含已归档账户"
                : undefined
            }
            onClick={async () => {
              app.close();
              if (
                await app.confirm({
                  title: "删除空分组？",
                  message: `将删除“${g.name}”。账户和交易不会被删除。`,
                  label: "删除分组",
                  danger: true,
                })
              )
                await app.save("删除空分组", (b) => removeEmptyGroup(b, g.id));
            }}
          >
            <Icon name="Trash2" />
            删除分组
          </button>
          {book.accounts.some((a) => a.groupId === g.id) && (
            <p className="menu-hint">移出所有账户后可删除，包含已归档账户。</p>
          )}
        </div>
      </Dialog>,
    );
  }
  async function end(event: DragEndEvent) {
    setDrag(null);
    setDrop(null);
    const { active, over } = event;
    if (!over || over.id === active.id) return;
    if (active.data.current?.type === "group") {
      if (over.data.current?.type !== "group") return;
      await app.save("排列分组", (b) =>
        arrayMove(
          groups,
          groups.findIndex((g) => g.id === active.id),
          groups.findIndex((g) => g.id === over.id),
        ).forEach((g, i) => (b.groups.find((x) => x.id === g.id)!.order = i)),
      );
    } else {
      const targetAccount = book.accounts.find((a) => a.id === over.id);
      const groupId = targetAccount?.groupId || String(over.id);
      const after =
        active.rect.current.translated &&
        active.rect.current.translated.top +
          active.rect.current.translated.height / 2 >
          over.rect.top + over.rect.height / 2;
      const siblings = book.accounts
        .filter((a) => a.groupId === groupId && a.id !== active.id)
        .sort((a, b) => a.order - b.order);
      const next =
        targetAccount && after
          ? siblings[siblings.findIndex((a) => a.id === targetAccount.id) + 1]
              ?.id
          : targetAccount?.id;
      await app.save("移动账户", (b) =>
        moveAccount(b, String(active.id), groupId, next),
      );
    }
  }
  return (
    <>
      <Header title="账户">
        {manage ? (
          <Button variant="plain" onClick={() => setManage(false)}>
            完成
          </Button>
        ) : (
          <Button variant="plain" onClick={() => setManage(true)}>
            管理
          </Button>
        )}
      </Header>
      <main className="page-content accounts-page">
        {manage && (
          <div className="management-toolbar">
            <Button variant="soft" icon="Wallet" onClick={() => editAccount()}>
              新增账户
            </Button>
            <Button
              variant="plain"
              icon="FolderPlus"
              onClick={() => editGroup()}
            >
              新增分组
            </Button>
          </div>
        )}
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
            {net.missing.length > 0 && (
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
                "按空格开始排序，方向键移动，再按空格放下，Escape 取消。",
            },
            announcements: {
              onDragStart: () => "开始排序",
              onDragOver: ({ over }) => (over ? "已移动到新位置" : "正在移动"),
              onDragEnd: () => "排序完成",
              onDragCancel: () => "已取消排序",
            },
          }}
          collisionDetection={(args) => {
            const containers = args.droppableContainers.filter((c) =>
              args.active.data.current?.type === "group"
                ? c.data.current?.type === "group"
                : true,
            );
            const hits = pointerWithin({
              ...args,
              droppableContainers: containers,
            });
            const accountHits = hits.filter(
              (h) =>
                containers.find((c) => c.id === h.id)?.data.current?.type ===
                "account",
            );
            return accountHits.length
              ? accountHits
              : hits.length
                ? hits
                : closestCenter({ ...args, droppableContainers: containers });
          }}
          onDragOver={(e) =>
            setDrop(
              e.over && e.over.id !== e.active.id ? String(e.over.id) : null,
            )
          }
          onDragMove={(e) => {
            const r = e.active.rect.current.translated;
            setDropAfter(
              !!(
                e.over &&
                r &&
                r.top + r.height / 2 > e.over.rect.top + e.over.rect.height / 2
              ),
            );
          }}
          onDragStart={(e) => setDrag(String(e.active.id))}
          onDragCancel={() => {
            setDrag(null);
            setDrop(null);
          }}
          onDragEnd={end}
        >
          <SortableContext
            items={groups.map((g) => g.id)}
            strategy={verticalListSortingStrategy}
          >
            {groups
              .filter(
                (g) =>
                  manage ||
                  book.accounts.some(
                    (a) => a.groupId === g.id && !a.archived,
                  ) ||
                  !book.accounts.some((a) => a.groupId === g.id),
              )
              .map((g) => (
                <GroupSection
                  key={g.id}
                  group={g}
                  manage={manage}
                  drop={drop}
                  dropAfter={dropAfter}
                  onAccount={accountMenu}
                  onGroup={() => groupMenu(g)}
                />
              ))}
          </SortableContext>
          <DragOverlay>
            {dragAccount && (
              <div className="overlay-card">
                <Icon name={dragAccount.icon} />
                <strong>{dragAccount.name}</strong>
                <Amount
                  value={balance(book, dragAccount.id)}
                  currency={dragAccount.currency}
                />
              </div>
            )}
            {drag && !dragAccount && (
              <div className="overlay-card">
                {groups.find((g) => g.id === drag)?.name}
              </div>
            )}
          </DragOverlay>
        </DndContext>
        {book.accounts.some((a) => a.archived) && (
          <button
            className="quiet-link"
            onClick={() => app.go({ page: "archive" })}
          >
            <Icon name="Archive" size={17} />
            已归档账户
            <Icon name="ChevronRight" size={15} />
          </button>
        )}
      </main>
      {!manage && book.accounts.some((a) => !a.archived) && (
        <div className="floating-entry">
          <Button
            icon="SquarePen"
            onClick={() =>
              app.go({
                page: "entry",
                accountId: book.accounts.find((a) => !a.archived)?.id,
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
