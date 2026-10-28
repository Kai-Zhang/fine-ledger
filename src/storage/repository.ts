import {
  compatibleCategoryIcon,
  repairLegacyCategoryIcons,
} from "../domain/category-icons.ts";
import { deviceTimeZone } from "../domain/dates.ts";
import Dexie, { type Table } from "dexie";
import { blankBook, defaultCategories } from "../domain/ledger.ts";
import {
  uid,
  type Book,
  type Entry,
  type Operation,
  type Change,
} from "../domain/types.ts";
import { exampleBook } from "../domain/example.ts";
export type Mode = "personal" | "example";
export class LedgerDB extends Dexie {
  state!: Table<unknown, string>;
  outbox!: Table<Operation, string>;
  revisions!: Table<
    { id: string; at: string; book?: Book; changes?: Change[] },
    string
  >;
  drafts!: Table<unknown, string>;
  constructor(name: string) {
    super(name);
    this.version(2).stores({ state: "", outbox: "id", drafts: "" });
    this.version(3)
      .stores({ state: "", outbox: "id", drafts: "", revisions: "id,at" })
      .upgrade(async (tx) => {
        const old = await tx.table("state").get("book");
        if (old && old.schema !== 3) {
          await tx.table("state").put(old, "legacy-book-v2");
          await tx.table("state").put(migrate(old), "book");
        }
      });
    this.on("versionchange", () => this.close());
  }
}
export const databases = {
  personal: new LedgerDB("fine-ledger-p0-review-v1"),
  example: new LedgerDB("fine-ledger-example-v1"),
};
export function migrate(old: any): Book {
  if (old.schema === 3) return old;
  const b = blankBook("CNY", "我的账本");
  b.id = old.id || b.id;
  b.timeZone = old.timeZone || b.timeZone;
  b.createdAt = old.createdAt || b.createdAt;
  const oldCategories = old.categories || [];
  const flattened = oldCategories.flatMap((c: any, i: number) => [
    {
      id: c.id,
      name: c.name,
      kind: c.kind || "expense",
      icon: compatibleCategoryIcon(c),
      color: c.color || defaultCategories()[i]?.color || "#608D9D",
      order: i,
      archived: false,
    },
    ...(c.children || []).map((s: any, j: number) => ({
      id: s.id,
      name: s.name,
      parentId: c.id,
      kind: c.kind || "expense",
      icon: compatibleCategoryIcon(s, c.id),
      color: c.color || "#608D9D",
      order: j,
      archived: false,
    })),
  ]);
  b.categories = flattened.length ? flattened : b.categories;
  b.projects = (old.projects || []).map((p: any) =>
    typeof p === "string" ? { id: uid(), name: p, archived: false } : p,
  );
  const earliest = (old.entries || []).reduce(
    (a: string, e: any) => (e.occurredAt < a ? e.occurredAt : a),
    b.createdAt,
  );
  b.accounts = (old.accounts || []).map((a: any, i: number) => ({
    ...a,
    groupId:
      a.groupId ||
      (a.type === "credit"
        ? "credit"
        : a.type === "investment"
          ? "investment"
          : "daily"),
    icon:
      a.icon ||
      (a.type === "credit"
        ? "CreditCard"
        : a.type === "wallet"
          ? "Wallet"
          : a.type === "cash"
            ? "Banknote"
            : "Landmark"),
    order: i,
    archived: !!a.archived,
    netWorth: a.netWorth !== false,
    openingAt: a.openingAt || earliest,
    openingMinor: String(a.openingMinor || "0"),
  }));
  b.entries = (old.entries || []).map((e: any) => ({
    ...e,
    posted: e.posted !== false,
    amountMinor: String(e.amountMinor),
    receivedMinor:
      e.kind === "transfer"
        ? String(e.receivedMinor || e.amountMinor)
        : undefined,
    splits:
      e.splits ||
      (["expense", "income", "refund"].includes(e.kind)
        ? [
            {
              id: uid(),
              categoryId: e.categoryId,
              amountMinor: String(e.amountMinor),
              projectId: b.projects.find((p) => p.name === e.project)?.id,
            },
          ]
        : []),
    updatedAt: e.updatedAt || e.createdAt || e.occurredAt,
    revision: e.revision || 1,
  }));
  return b;
}
export async function readBook(mode: Mode): Promise<Book | undefined> {
  return (await databases[mode].state.get("book")) as Book | undefined;
}
export async function initialize(mode: Mode, book?: Book) {
  const db = databases[mode];
  return db.transaction("rw", db.state, db.outbox, async () => {
    const old = await db.state.get("book");
    if (old) {
      const value = old as Book;
      let changed = false;
      if (!value.timeZone) {
        value.timeZone = deviceTimeZone();
        changed = true;
      }
      if (!(await db.state.get("category-icons-repaired-v1"))) {
        const legacy = (await db.state.get("legacy-book-v2")) as
          Parameters<typeof repairLegacyCategoryIcons>[1] | undefined;
        if (legacy) {
          const operations = await db.outbox.toArray();
          const edited = new Set(
            operations.flatMap((op) =>
              Array.isArray(op.changes)
                ? op.changes
                    .filter((change) => change.collection === "categories")
                    .map((change) => change.id)
                : [],
            ),
          );
          const previous = structuredClone(value);
          if (repairLegacyCategoryIcons(value, legacy, edited)) {
            await db.state.put(previous, "before-category-icon-repair");
            changed = true;
          }
          await db.state.put(true, "category-icons-repaired-v1");
        }
      }
      if (changed) await db.state.put(value, "book");
      return value;
    }
    const b = book || (mode === "example" ? exampleBook() : undefined);
    if (b) await db.state.put(b, "book");
    return b;
  });
}
export async function mutate(
  mode: Mode,
  action: string,
  change: (book: Book) => void,
) {
  const db = databases[mode];
  return db.transaction("rw", db.state, db.outbox, db.revisions, async () => {
    const original = (await db.state.get("book")) as Book | undefined;
    if (!original) throw Error("请先创建账本");
    const next = structuredClone(original);
    change(next);
    next.revision++;
    const id = uid(),
      at = new Date().toISOString();
    const changes: Change[] = [];
    const collections = [
      "accounts",
      "groups",
      "categories",
      "projects",
      "entries",
    ] as const;
    for (const collection of collections) {
      const before = new Map(
          original[collection].map((item) => [item.id, item] as const),
        ),
        after = new Map(
          next[collection].map((item) => [item.id, item] as const),
        );
      for (const itemId of new Set([...before.keys(), ...after.keys()])) {
        if (
          JSON.stringify(before.get(itemId)) !==
          JSON.stringify(after.get(itemId))
        )
          changes.push({
            collection,
            id: itemId,
            before: before.get(itemId),
            after: after.get(itemId),
          });
      }
    }
    for (const key of ["name", "currency", "timeZone", "settings"] as const) {
      if (JSON.stringify(original[key]) !== JSON.stringify(next[key]))
        changes.push({
          collection: "book",
          id: key,
          before: original[key],
          after: next[key],
        });
    }
    await db.revisions.put({ id, at, changes });
    await db.state.put(next, "book");
    await db.outbox.put({
      id,
      bookId: next.id,
      revision: next.revision,
      at,
      action,
      changes,
    });
    return next;
  });
}
export async function exportBook(mode: Mode) {
  const db = databases[mode];
  return db.transaction(
    "r",
    db.state,
    db.outbox,
    db.revisions,
    db.drafts,
    async () => ({
      format: "fine-ledger-backup",
      version: 3,
      exportedAt: new Date().toISOString(),
      book: await db.state.get("book"),
      operations: await db.outbox.toArray(),
      revisions: await db.revisions.toArray(),
      legacy: {
        book: await db.state.get("legacy-book-v2"),
        drafts: await db.drafts.toArray(),
      },
    }),
  );
}
export function newEntry(
  accountId: string,
  kind: Entry["kind"] = "expense",
): Entry {
  const now = new Date().toISOString();
  return {
    id: uid(),
    kind,
    accountId,
    amountMinor: "0",
    description: "",
    occurredAt: now,
    createdAt: now,
    updatedAt: now,
    posted: true,
    splits: [],
    revision: 0,
  };
}
