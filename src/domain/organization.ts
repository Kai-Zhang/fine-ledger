import type { Book } from "./types.ts";
import { removeEmptyGroup } from "./ledger.ts";

export function removeGroup(book: Book, id: string, destination: string) {
  if (
    !book.groups.some((group) => group.id === id) ||
    destination === id ||
    (destination !== "" &&
      !book.groups.some((group) => group.id === destination))
  )
    throw Error("分组或账户目标分组不存在");
  const members = book.accounts
    .filter((account) => account.groupId === id)
    .sort((a, b) => a.order - b.order);
  for (const account of members) moveAccount(book, account.id, destination);
  removeEmptyGroup(book, id);
}

const projectNames = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});
export function sortedProjects(projects: Book["projects"]) {
  return [...projects].sort(
    (a, b) =>
      Number(a.archived) - Number(b.archived) ||
      projectNames.compare(a.name, b.name) ||
      a.id.localeCompare(b.id),
  );
}
export function moveAccount(
  book: Book,
  id: string,
  groupId: string,
  beforeId?: string,
) {
  const item = book.accounts.find((a) => a.id === id);
  if (!item || (groupId !== "" && !book.groups.some((g) => g.id === groupId)))
    throw Error("账户或目标分组不存在");
  const old = item.groupId;
  const target = book.accounts
    .filter((a) => a.groupId === groupId && a.id !== id)
    .sort((a, b) => a.order - b.order);
  const index = beforeId
    ? target.findIndex((a) => a.id === beforeId)
    : target.length;
  if (index < 0) throw Error("目标账户不在该分组");
  item.groupId = groupId;
  target.splice(index, 0, item);
  target.forEach((a, i) => (a.order = i));
  if (old !== groupId)
    book.accounts
      .filter((a) => a.groupId === old)
      .sort((a, b) => a.order - b.order)
      .forEach((a, i) => (a.order = i));
}
export function moveCategory(
  book: Book,
  id: string,
  parentId?: string,
  beforeId?: string,
) {
  const item = book.categories.find((c) => c.id === id);
  if (!item || item.archived) throw Error("请选择未归档类目");
  if (parentId) {
    const parent = book.categories.find((c) => c.id === parentId);
    if (
      !parent ||
      parent.parentId ||
      parent.archived ||
      parent.kind !== item.kind ||
      parent.id === id ||
      book.categories.some((c) => c.parentId === id)
    )
      throw Error("只能移动到同一收支类型的大类");
  }
  const old = item.parentId;
  const siblings = book.categories
    .filter(
      (c) => c.kind === item.kind && c.parentId === parentId && c.id !== id,
    )
    .sort((a, b) => a.order - b.order);
  const index = beforeId
    ? siblings.findIndex((c) => c.id === beforeId)
    : siblings.length;
  if (index < 0) throw Error("目标类目层级不同");
  item.parentId = parentId;
  siblings.splice(index, 0, item);
  siblings.forEach((c, i) => (c.order = i));
  if (old !== parentId)
    book.categories
      .filter((c) => c.kind === item.kind && c.parentId === old)
      .sort((a, b) => a.order - b.order)
      .forEach((c, i) => (c.order = i));
}

export const dragId = (type: "account" | "group" | "category", id: string) =>
  `${type}:${id}`;
