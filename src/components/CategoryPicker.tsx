import { useState } from "react";
import { useApp } from "../ui/context.tsx";
import { Dialog, IconButton } from "../ui/components.tsx";
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
  const [parent, setParent] = useState(
    initial?.parentId ||
      initial?.id ||
      book.categories.find((c) => c.kind === kind && !c.parentId && !c.archived)
        ?.id,
  );
  const parents = book.categories
      .filter((c) => c.kind === kind && !c.parentId && !c.archived)
      .sort((a, b) => a.order - b.order),
    children = book.categories
      .filter((c) => c.parentId === parent && !c.archived)
      .sort((a, b) => a.order - b.order);
  return (
    <Dialog title="选择类目" onClose={onClose}>
      <div className="category-picker">
        <div className="category-parents">
          {parents.map((c) => (
            <button
              type="button"
              className={parent === c.id ? "selected" : ""}
              onClick={() => setParent(c.id)}
              key={c.id}
            >
              <Icon name={c.icon} />
              {c.name}
            </button>
          ))}
        </div>
        <div className="category-children">
          {[book.categories.find((c) => c.id === parent), ...children]
            .filter(Boolean)
            .map(
              (c) =>
                c && (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => {
                      onSelect(c.id);
                      onClose();
                    }}
                  >
                    <span
                      className="category-symbol"
                      style={{ color: c.color }}
                    >
                      <Icon name={c.icon} />
                    </span>
                    <span>
                      {c.name}
                      {c.id === parent && (
                        <small className="muted">整个类目</small>
                      )}
                    </span>
                    {selected === c.id && <Icon name="Check" />}
                  </button>
                ),
            )}
        </div>
      </div>
    </Dialog>
  );
}
