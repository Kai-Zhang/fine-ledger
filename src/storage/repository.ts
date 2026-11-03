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
import { canonical } from "../sync/protocol.ts";
import { verifySnapshot, type Snapshot } from "../sync/snapshot.ts";
import { changesBetween, applyChanges, entity, same } from "../sync/model.ts";
import { syncKeys, type SyncLease, type SyncIssue } from "../sync/state.ts";
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
        if (old && ![3, 4].includes(old.schema)) {
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
  if ([3, 4].includes(old.schema)) return old;
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
export type RestoreTarget = {
  token: string;
  book?: { id: string; name: string; accounts: number; entries: number };
  pending: number;
};
export type RemoteBaseline = {
  origin: string;
  ledgerId: string;
  serverEpoch: string;
  cursor: number;
  versions: Snapshot["versions"];
  checksum: string;
  book: Book;
  restoredAt: string;
  lastOperationId?: string;
};
async function restoreState(db: LedgerDB) {
  return {
    book: (await db.state.get("book")) as Book | undefined,
    operations: await db.outbox.toArray(),
    drafts: await db.drafts.toArray(),
    baseline: await db.state.get("remote-baseline"),
  };
}
export async function readRestoreTarget(mode: Mode): Promise<RestoreTarget> {
  const db = databases[mode];
  return db.transaction("r", db.state, db.outbox, db.drafts, async () => {
    const data = await restoreState(db),
      b = data.book;
    return {
      token: canonical(data),
      book: b
        ? {
            id: b.id,
            name: b.name,
            accounts: b.accounts.length,
            entries: b.entries.length,
          }
        : undefined,
      pending: data.operations.length,
    };
  });
}
export async function restoreRemoteBook(
  mode: Mode,
  input: unknown,
  options: {
    origin: string;
    expectedTarget: string;
    ledgerId: string;
    serverEpoch: string;
  },
) {
  // Hash/network work finishes before opening the IndexedDB write transaction.
  const snapshot = await verifySnapshot(input, options);
  const url = new URL(options.origin);
  if (
    url.origin !== options.origin ||
    url.username ||
    url.password ||
    !["https:", "http:"].includes(url.protocol)
  )
    throw Error("账本来源无效");
  const db = databases[mode];
  return db.transaction(
    "rw",
    db.state,
    db.outbox,
    db.revisions,
    db.drafts,
    async () => {
      const previous = await restoreState(db);
      const lease = (await db.state.get("sync-lease")) as SyncLease | undefined;
      if (lease && lease.until > Date.now())
        throw Error("同步正在进行，请稍后再恢复");
      if (canonical(previous) !== options.expectedTarget)
        throw Error("本机账本在预览后有变化，请重新预览再恢复");
      if (previous.book)
        await db.state.put(
          {
            ...previous,
            revisions: await db.revisions.toArray(),
            at: new Date().toISOString(),
          },
          "before-remote-restore",
        );
      const book = structuredClone(snapshot.book);
      // Appearance belongs to this device, not the remote ledger.
      book.settings.theme = previous.book?.settings.theme || "system";
      const baseline: RemoteBaseline = {
        origin: options.origin,
        ledgerId: book.id,
        serverEpoch: snapshot.serverEpoch,
        cursor: snapshot.cursor,
        versions: snapshot.versions,
        checksum: snapshot.checksum,
        book: snapshot.book,
        restoredAt: new Date().toISOString(),
      };
      await db.outbox.clear();
      await db.revisions.clear();
      await db.drafts.clear();
      await db.state.put(book, "book");
      await db.state.put(baseline, "remote-baseline");
      await db.state.put(true, "category-icons-repaired-v1");
      await db.state.put(true, "sync-enabled");
      for (const key of syncKeys) await db.state.delete(key);
      return book;
    },
  );
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
  editBase?: Book,
) {
  const db = databases[mode];
  return db.transaction("rw", db.state, db.outbox, db.revisions, async () => {
    const original = (await db.state.get("book")) as Book | undefined;
    if (!original) throw Error("请先创建账本");
    if (editBase && editBase.id !== original.id)
      throw Error("本机账本已经切换，输入仍保留，请先核对");
    const intent = structuredClone(editBase || original);
    change(intent);
    const delta = changesBetween(editBase || original, intent);
    if (editBase)
      for (const ch of delta) {
        const current = entity(original, ch.collection, ch.id);
        if (
          !same(current, entity(editBase, ch.collection, ch.id)) &&
          !same(current, ch.value)
        )
          throw Error("这条记录在编辑期间发生变化，输入仍保留，请先核对");
      }
    const next = applyChanges(original, delta);
    if (intent.settings.theme !== (editBase || original).settings.theme)
      next.settings.theme = intent.settings.theme;
    next.revision = original.revision + 1;
    for (const ch of delta)
      if (ch.collection === "entries" && ch.value) {
        const row = next.entries.find((e) => e.id === ch.id)!;
        row.revision =
          (original.entries.find((e) => e.id === ch.id)?.revision || 0) + 1;
      }
    const id = uid(),
      at = new Date().toISOString();
    const changes: Change[] = [];
    for (const ch of changesBetween(original, next))
      changes.push({
        collection: ch.collection,
        id: ch.id,
        before: entity(original, ch.collection, ch.id) || undefined,
        after: ch.value || undefined,
      });
    await db.revisions.put({ id, at, changes });
    await db.state.put(next, "book");
    const issue = (await db.state.get("sync-issue")) as SyncIssue | undefined;
    if (issue) {
      issue.localKeys = [
        ...new Set([
          ...(issue.localKeys || []),
          ...delta.map((ch) => `${ch.collection}/${ch.id}`),
        ]),
      ];
      issue.items = issue.items.map((i) => ({
        ...i,
        local: structuredClone(entity(next, i.collection, i.id)),
      }));
      await db.state.put(issue, "sync-issue");
    }
    if (changes.length)
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
      remoteBaseline: await db.state.get("remote-baseline"),
      beforeRemoteRestore: await db.state.get("before-remote-restore"),
      syncArchive: await db.state.get("sync-archive"),
      syncIssue: await db.state.get("sync-issue"),
      syncFlight: await db.state.get("sync-flight"),
      syncInitialization: await db.state.get("sync-init"),
      importedSyncState: await db.state.get("imported-sync-state"),
      draftRecords: await Promise.all(
        (await db.drafts.toCollection().primaryKeys()).map(async (key) => ({
          key,
          value: await db.drafts.get(key),
        })),
      ),
      beforeFileRestore: await db.state.get("before-file-restore"),
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
