import type { Book } from "../domain/types.ts";
import {
  canonical,
  collections,
  validateBook,
  type Change,
  type Collection,
  type Command,
} from "./protocol.ts";

export type Entity = Record<string, any> | null;
export const keyOf = (collection: Collection, id: string) =>
  `${collection}/${id}`;
export function entity(book: Book, collection: Collection, id: string): Entity {
  if (collection === "book")
    return {
      id: book.id,
      schema: book.schema,
      name: book.name,
      currency: book.currency,
      timeZone: book.timeZone,
      createdAt: book.createdAt,
      settings: book.settings.timeZoneMode
        ? { timeZoneMode: book.settings.timeZoneMode }
        : {},
    };
  return (
    (collection === "reports"
      ? book.settings.savedReports
      : book[collection]
    ).find((x) => x.id === id) || null
  );
}
export function business(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  const clean = JSON.parse(JSON.stringify(value));
  // Entry revisions are concurrency metadata, not a user edit.
  if (clean && typeof clean === "object" && !Array.isArray(clean))
    delete clean.revision;
  return clean;
}
export const same = (a: unknown, b: unknown) =>
  canonical(business(a)) === canonical(business(b));
export function allEntities(book: Book): Change[] {
  return [
    { collection: "book", id: book.id, value: entity(book, "book", book.id) },
    ...collections.flatMap((collection) =>
      (collection === "reports"
        ? book.settings.savedReports
        : book[collection]
      ).map((row) => ({ collection, id: row.id, value: row })),
    ),
  ];
}
export function changesBetween(before: Book, after: Book): Change[] {
  if (before.id !== after.id) throw Error("不能把不同账本直接合并");
  const previous = new Map(
    allEntities(before).map((ch) => [keyOf(ch.collection, ch.id), ch]),
  );
  const next = new Map(
    allEntities(after).map((ch) => [keyOf(ch.collection, ch.id), ch]),
  );
  const result: Change[] = [];
  for (const key of new Set([...previous.keys(), ...next.keys()])) {
    const a = previous.get(key),
      b = next.get(key);
    if (!same(a?.value, b?.value)) result.push(b || { ...a!, value: null });
  }
  return result;
}
export function applyChanges(book: Book, changes: Change[]): Book {
  const next = structuredClone(book);
  for (const ch of changes) {
    if (ch.collection === "book") {
      if (!ch.value || (ch.value as { id: string }).id !== book.id)
        throw Error("账本身份变化");
      const metadata = ch.value as Partial<Book>;
      Object.assign(next, {
        ...metadata,
        settings: { ...next.settings, ...metadata.settings },
      });
    } else {
      const rows =
        ch.collection === "reports"
          ? next.settings.savedReports
          : next[ch.collection];
      const index = rows.findIndex((x) => x.id === ch.id);
      if (ch.value === null) {
        if (index >= 0) rows.splice(index, 1);
      } else if (index < 0) rows.push(structuredClone(ch.value) as never);
      else rows[index] = structuredClone(ch.value) as never;
    }
  }
  return next;
}
export type VersionedChange = Change & { version: number };
export type ConflictItem = {
  collection: Collection;
  id: string;
  base: Entity;
  local: Entity;
  remote: Entity;
};
export function rebase(base: Book, local: Book, remote: Book, own = false) {
  const changes = changesBetween(base, remote),
    conflicts: ConflictItem[] = [];
  const applicable: Change[] = [];
  for (const change of changes) {
    const old = entity(base, change.collection, change.id),
      here = entity(local, change.collection, change.id);
    if (same(here, old) || same(here, change.value)) applicable.push(change);
    else if (!own)
      conflicts.push({
        collection: change.collection,
        id: change.id,
        base: structuredClone(old),
        local: structuredClone(here),
        remote: structuredClone(change.value) as Entity,
      });
  }
  const merged = applyChanges(local, applicable);
  merged.revision = local.revision + 1;
  return { book: merged, conflicts };
}
function ordered(changes: Change[]): Change[] {
  const rank: Record<Collection, number> = {
    book: 0,
    groups: 1,
    accounts: 2,
    categories: 3,
    projects: 4,
    entries: 5,
    reports: 6,
  };
  const pending = [...changes].sort(
    (a, b) =>
      (a.value === null ? 20 - rank[a.collection] : rank[a.collection]) -
        (b.value === null ? 20 - rank[b.collection] : rank[b.collection]) ||
      a.id.localeCompare(b.id),
  );
  const result: Change[] = [];
  // Creation references precede their dependants; deletions follow them.
  while (pending.length) {
    const i = pending.findIndex((ch) => {
      const v = ch.value as any;
      const refs: [Collection, string | undefined][] = v
        ? [
            ["groups", v.groupId],
            ["categories", v.parentId],
            ["entries", v.originalId],
            ["entries", v.transferId],
          ]
        : [];
      return !refs.some(
        ([c, id]) =>
          id &&
          pending.some(
            (other) =>
              other !== ch &&
              other.collection === c &&
              other.id === id &&
              other.value !== null,
          ),
      );
    });
    if (i < 0) throw Error("变更存在循环依赖，请核对类目或退款关系");
    result.push(pending.splice(i, 1)[0]);
  }
  return result;
}
export function commandFor(
  base: Book,
  local: Book,
  versions: { collection: Collection; id: string; version: number }[],
  epoch: string,
  predecessor?: string,
): Command | null {
  const delta = ordered(changesBetween(base, local));
  if (!delta.length) return null;
  const versionMap = new Map(
    versions.map((v) => [keyOf(v.collection, v.id), v.version]),
  );
  // Cut only at a valid business state, never halfway through a transfer/refund relation.
  for (let size = Math.min(200, delta.length); size > 0; size--) {
    const changes = delta.slice(0, size);
    try {
      validateBook(applyChanges(base, changes), base);
    } catch {
      continue;
    }
    const expected = new Map<
      string,
      { collection: Collection; id: string; version: number }
    >();
    const expect = (collection: Collection, id?: string) => {
      if (id)
        expected.set(keyOf(collection, id), {
          collection,
          id,
          version: versionMap.get(keyOf(collection, id)) || 0,
        });
    };
    for (const ch of changes) {
      expect(ch.collection, ch.id);
      if (ch.collection === "entries" && ch.value) {
        const e = ch.value as Book["entries"][number];
        expect("accounts", e.accountId);
        expect("accounts", e.toAccountId);
        expect("entries", e.originalId);
        expect("entries", e.transferId);
        for (const split of e.splits) {
          expect("categories", split.categoryId);
          expect("projects", split.projectId);
        }
      }
    }
    if (expected.size > 500) continue;
    return {
      operationId: crypto.randomUUID(),
      ledgerId: base.id,
      serverEpoch: epoch,
      expected: [...expected.values()],
      dependsOn: predecessor ? [predecessor] : [],
      changes: JSON.parse(JSON.stringify(changes)),
    };
  }
  throw Error("这次修改无法拆成安全的提交，请导出本机副本后核对关联记录");
}
