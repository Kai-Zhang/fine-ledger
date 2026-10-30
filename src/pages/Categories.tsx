import { categoryColor } from "../ui/category-color.ts";
import {
  useOrganization,
  dragId,
  useDragSensors,
  useDragSelection,
} from "../ui/organization.ts";
import { useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useApp } from "../ui/context.tsx";
import { Header, IconButton } from "../ui/components.tsx";
import { Icon } from "../ui/icons.tsx";
import { CategoryEditor } from "./Settings.tsx";
import type { Category } from "../domain/types.ts";
import { moveCategory } from "../domain/organization.ts";
function CategoryRow({
  c,
  children,
  collapsed,
  toggle,
  edit,
  archive,
  over,
  after = false,
}: {
  c: Category;
  children?: ReactNode;
  collapsed?: boolean;
  toggle?: () => void;
  edit: () => void;
  archive: () => void;
  over: boolean;
  after?: boolean;
}) {
  const sort = useSortable({
    id: dragId("category", c.id),
    data: { id: c.id, parentId: c.parentId },
    disabled: c.archived,
  });
  return (
    <section
      ref={sort.setNodeRef}
      className={`category-block ${c.parentId ? "child-category" : ""} ${over ? (after ? "drop-category-after" : "drop-category") : ""}`}
      style={{
        transform: CSS.Transform.toString(sort.transform),
        transition: sort.transition,
        opacity: sort.isDragging ? 0.25 : 1,
      }}
    >
      <div className="category-manage-row">
        <button
          className="drag-handle"
          aria-label={`拖动类目 ${c.name}`}
          disabled={c.archived}
          {...sort.attributes}
          {...sort.listeners}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Icon name="GripVertical" size={18} />
        </button>
        {toggle && (
          <button
            className={`category-expand ${collapsed ? "" : "expanded"}`}
            aria-label={`${collapsed ? "展开" : "折叠"} ${c.name}`}
            onClick={toggle}
          >
            <Icon name="ChevronRight" size={16} />
          </button>
        )}
        <button
          className="category-edit"
          onClick={() => {
            if (!window.getSelection()?.toString()) edit();
          }}
        >
          <span
            className="category-symbol category-ink"
            style={categoryColor(c.color)}
          >
            <Icon name={c.icon} />
          </span>
          <span className="copyable-name">
            {c.name}
            {c.archived && <small>已归档</small>}
          </span>
        </button>
        <IconButton
          className="subtle-action"
          name={c.archived ? "ArchiveRestore" : "Archive"}
          label={`${c.archived ? "恢复" : "归档"}类目 ${c.name}`}
          onClick={archive}
        />
      </div>
      {!collapsed && children}
    </section>
  );
}
export function Categories() {
  const app = useApp(),
    { book, commit } = useOrganization();
  const cached = app.views.get("categories") as
    { kind: "expense" | "income"; closed: string[] } | undefined;
  const [kind, setKind] = useState<"expense" | "income">(
      cached?.kind || "expense",
    ),
    [closed, setClosed] = useState<string[]>(cached?.closed || []),
    [archived, setArchived] = useState(false),
    [drag, setDrag] = useState<string | null>(null),
    [over, setOver] = useState<string | null>(null),
    [dropAfter, setDropAfter] = useState(false);
  const sensors = useDragSensors();
  useDragSelection(!!drag);
  app.views.set("categories", { kind, closed });
  const parents = book.categories
    .filter((c) => c.kind === kind && !c.parentId && (archived || !c.archived))
    .sort((a, b) => a.order - b.order);
  const active = book.categories.find((c) => c.id === drag);
  const edit = (c?: Category, parentId?: string) =>
    app.open(
      <CategoryEditor
        category={c}
        kind={kind}
        parentId={parentId}
        onClose={app.close}
      />,
    );
  async function archive(c: Category) {
    if (
      !c.archived &&
      !(await app.confirm({
        title: "归档类目？",
        message: !c.parentId
          ? "将同时归档其子类目。历史交易和报表保留，新增交易时隐藏。"
          : "历史交易和报表保留，新增交易时隐藏。",
        label: "归档",
      }))
    )
      return;
    await app.save(c.archived ? "恢复类目" : "归档类目", (b) => {
      b.categories
        .filter(
          (x) =>
            x.id === c.id ||
            x.parentId === c.id ||
            (c.archived && x.id === c.parentId),
        )
        .forEach((x) => (x.archived = !c.archived));
    });
  }
  async function end(e: DragEndEvent) {
    if (!e.over || e.over.id === e.active.id) {
      setDrag(null);
      setOver(null);
      return;
    }
    const item = book.categories.find(
        (c) => c.id === e.active.data.current?.id,
      )!,
      target = book.categories.find((c) => c.id === e.over!.data.current?.id)!;
    const parentId = item.parentId ? target.parentId || target.id : undefined;
    const siblings = book.categories
      .filter(
        (c) => c.parentId === parentId && c.kind === kind && c.id !== item.id,
      )
      .sort((a, b) => a.order - b.order);
    const after =
      e.activatorEvent.type === "keydown"
        ? item.parentId === target.parentId && item.order < target.order
        : e.active.rect.current.translated &&
          e.active.rect.current.translated.top +
            e.active.rect.current.translated.height / 2 >
            e.over.rect.top + e.over.rect.height / 2;
    const before =
      target.id === parentId
        ? undefined
        : after
          ? siblings[siblings.findIndex((c) => c.id === target.id) + 1]?.id
          : target.id;
    void commit("移动类目", (b) => moveCategory(b, item.id, parentId, before));
    setDrag(null);
    setOver(null);
  }
  return (
    <>
      <Header title="类目" back>
        <IconButton name="Plus" label="新增类目" onClick={() => edit()} />
      </Header>
      <main className="page-content">
        <div className="segmented">
          {(["expense", "income"] as const).map((k) => (
            <button
              key={k}
              className={kind === k ? "selected" : ""}
              onClick={() => setKind(k)}
            >
              {k === "expense" ? "支出" : "收入"}
            </button>
          ))}
        </div>
        <DndContext
          accessibility={{
            screenReaderInstructions: {
              draggable: "按空格开始排序，方向键移动，空格放下，Escape 取消。",
            },
            announcements: {
              onDragStart: () => "开始排序",
              onDragOver: ({ over }) => (over ? "已移动到新位置" : "正在移动"),
              onDragEnd: () => "排序完成",
              onDragCancel: () => "已取消排序",
            },
          }}
          sensors={sensors}
          collisionDetection={(args) => {
            const containers = args.droppableContainers.filter((c) =>
              !active?.parentId ? !c.data.current?.parentId : true,
            );
            const hits = pointerWithin({
                ...args,
                droppableContainers: containers,
              }),
              childHits = hits.filter(
                (h) =>
                  containers.find((c) => c.id === h.id)?.data.current?.parentId,
              );
            return childHits.length
              ? childHits
              : hits.length
                ? hits
                : closestCenter({ ...args, droppableContainers: containers });
          }}
          onDragStart={(e) => setDrag(String(e.active.data.current?.id))}
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
          onDragOver={(e) => {
            setOver(e.over ? String(e.over.id) : null);
            if (active?.parentId && e.over) {
              const t = book.categories.find(
                (c) => c.id === e.over!.data.current?.id,
              );
              setClosed((ids) =>
                ids.filter((id) => id !== (t?.parentId || t?.id)),
              );
            }
          }}
          onDragCancel={() => {
            setDrag(null);
            setOver(null);
          }}
          onDragEnd={end}
        >
          <SortableContext
            items={parents.map((p) => dragId("category", p.id))}
            strategy={verticalListSortingStrategy}
          >
            <div className="manage-categories">
              {parents.map((p) => {
                const children = book.categories
                  .filter(
                    (c) => c.parentId === p.id && (archived || !c.archived),
                  )
                  .sort((a, b) => a.order - b.order);
                return (
                  <CategoryRow
                    key={p.id}
                    c={p}
                    collapsed={closed.includes(p.id)}
                    toggle={
                      children.length
                        ? () =>
                            setClosed(
                              closed.includes(p.id)
                                ? closed.filter((id) => id !== p.id)
                                : [...closed, p.id],
                            )
                        : undefined
                    }
                    edit={() => edit(p)}
                    archive={() => void archive(p)}
                    after={dropAfter}
                    over={over === dragId("category", p.id) && drag !== p.id}
                  >
                    <SortableContext
                      items={children.map((c) => dragId("category", c.id))}
                      strategy={verticalListSortingStrategy}
                    >
                      {children.map((c) => (
                        <CategoryRow
                          key={c.id}
                          c={c}
                          edit={() => edit(c)}
                          archive={() => void archive(c)}
                          after={dropAfter}
                          over={
                            over === dragId("category", c.id) && drag !== c.id
                          }
                        />
                      ))}
                    </SortableContext>
                  </CategoryRow>
                );
              })}
            </div>
          </SortableContext>
          <DragOverlay>
            {active && (
              <div className="overlay-card">
                <Icon name={active.icon} />
                <strong>{active.name}</strong>
              </div>
            )}
          </DragOverlay>
        </DndContext>
        <button className="quiet-link" onClick={() => setArchived(!archived)}>
          <Icon name="Archive" size={16} />
          {archived ? "隐藏已归档类目" : "查看已归档类目"}
        </button>
      </main>
    </>
  );
}
