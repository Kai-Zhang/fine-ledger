import { categoryColor } from "../ui/category-color.ts";
import { useState } from "react";
import { useApp } from "../ui/context.tsx";
import { Dialog } from "../ui/components.tsx";
import { Icon } from "../ui/icons.tsx";
export function CategoryPicker({
  kind,
  selected,
  onSelect,
  onClose,
}: {
  kind: "expense" | "income";
  selected?: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const { book } = useApp(),
    initial = book.categories.find((c) => c.id === selected);
  const parents = book.categories
    .filter((c) => c.kind === kind && !c.parentId && !c.archived)
    .sort((a, b) => a.order - b.order);
  const [expanded, setExpanded] = useState(
    initial?.parentId ||
      parents.find((p) =>
        book.categories.some((c) => c.parentId === p.id && !c.archived),
      )?.id,
  );
  const choose = (id: string) => {
    onSelect(id);
    onClose();
  };
  return (
    <Dialog title="选择类目" onClose={onClose}>
      <div className="category-accordion-picker" data-no-back>
        {parents.map((p) => {
          const children = book.categories
            .filter((c) => c.parentId === p.id && !c.archived)
            .sort((a, b) => a.order - b.order);
          const open = expanded === p.id;
          return (
            <section key={p.id}>
              <button
                className="picker-parent-row"
                onClick={() =>
                  children.length
                    ? setExpanded(open ? undefined : p.id)
                    : choose(p.id)
                }
                aria-expanded={children.length ? open : undefined}
              >
                <span
                  className="category-symbol category-ink"
                  style={categoryColor(p.color)}
                >
                  <Icon name={p.icon} />
                </span>
                <span>{p.name}</span>
                {children.length ? (
                  <Icon
                    name={open ? "ChevronDown" : "ChevronRight"}
                    size={17}
                  />
                ) : (
                  selected === p.id && <Icon name="Check" size={17} />
                )}
              </button>
              {children.length > 0 && open && (
                <div className="picker-child-list">
                  <button onClick={() => choose(p.id)}>
                    {p.name} · 整个类目
                    {selected === p.id && <Icon name="Check" size={16} />}
                  </button>
                  {children.map((c) => (
                    <button key={c.id} onClick={() => choose(c.id)}>
                      <Icon name={c.icon} size={18} />
                      <span>{c.name}</span>
                      {selected === c.id && <Icon name="Check" size={16} />}
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </Dialog>
  );
}
