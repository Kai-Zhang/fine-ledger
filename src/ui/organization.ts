import {
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useApp } from "./context.tsx";
import type { Book } from "../domain/types.ts";
// Reorder the rendered source before DragOverlay measures its landing position.
export function useOrganization() {
  const app = useApp(),
    [preview, setPreview] = useState<Book | null>(null);
  const signature = (b: Book) =>
    JSON.stringify([
      b.groups,
      b.accounts.map((a) => [a.id, a.groupId, a.order]),
      b.categories.map((c) => [c.id, c.parentId, c.order]),
    ]);
  useEffect(() => {
    if (preview && signature(app.book) === signature(preview)) setPreview(null);
  }, [app.book, preview]);
  async function commit(action: string, change: (b: Book) => void) {
    const base = preview || app.book;
    const next = {
      ...base,
      groups: base.groups.map((g) => ({ ...g })),
      accounts: base.accounts.map((a) => ({ ...a })),
      categories: base.categories.map((c) => ({ ...c })),
    };
    try {
      change(next);
    } catch (e) {
      app.toast((e as Error).message);
      return;
    }
    flushSync(() => setPreview(next));
    if (!(await app.save(action, change))) setPreview(null);
  }
  return { book: preview || app.book, commit };
}
export { dragId } from "../domain/organization.ts";
export const dragActivation = { delay: 280, tolerance: 7 };

export function useDragSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: dragActivation }),
    useSensor(KeyboardSensor, {
      coordinateGetter: (event, args) => {
        const map = args.context.droppableContainers;
        const type = args.context.active?.data.current?.type;
        const narrowed = new Proxy(map, {
          get(target, key) {
            if (key === "getEnabled")
              return () =>
                target
                  .getEnabled()
                  .filter((item) =>
                    type
                      ? item.data.current?.type === type
                      : !!item.data.current?.sortable,
                  );
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        return sortableKeyboardCoordinates(event, {
          ...args,
          context: { ...args.context, droppableContainers: narrowed },
        });
      },
    }),
  );
}
export function useDragSelection(active: boolean) {
  useEffect(() => {
    if (!active) return;
    document.documentElement.classList.add("is-reordering");
    return () => document.documentElement.classList.remove("is-reordering");
  }, [active]);
}
