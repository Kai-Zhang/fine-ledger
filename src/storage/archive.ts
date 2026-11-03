import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import type { Book, Operation } from "../domain/types.ts";
import { validateBook, id } from "../sync/protocol.ts";
import {
  databases,
  exportBook,
  readRestoreTarget,
  type Mode,
  type RemoteBaseline,
} from "./repository.ts";
import { syncKeys, type SyncLease } from "../sync/state.ts";
const LIMIT = 64 * 1024 * 1024;
export type BackupData = Omit<
  Awaited<ReturnType<typeof exportBook>>,
  "book"
> & { book: Book };
async function sha(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export async function encodeBackup(
  data: Awaited<ReturnType<typeof exportBook>>,
): Promise<Uint8Array> {
  validateBook(data.book);
  const ledger = strToU8(JSON.stringify(data));
  if (ledger.length > LIMIT)
    throw Error("完整备份超过 64 MB，请由服务管理者处理");
  const manifest = strToU8(
    JSON.stringify({
      format: "fine-ledger-exchange",
      version: 1,
      createdAt: new Date().toISOString(),
      files: [
        {
          path: "ledger.json",
          bytes: ledger.length,
          sha256: await sha(ledger),
        },
      ],
    }),
  );
  return zipSync(
    { "manifest.json": manifest, "ledger.json": ledger },
    { level: 1 },
  );
}
export async function decodeBackup(bytes: Uint8Array): Promise<BackupData> {
  if (bytes.length > LIMIT) throw Error("备份文件超过 64 MB");
  let data: unknown;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    let total = 0,
      count = 0;
    const files = unzipSync(bytes, {
      filter: (file) => {
        count++;
        total += file.originalSize;
        if (
          count > 2 ||
          total > LIMIT ||
          !["manifest.json", "ledger.json"].includes(file.name) ||
          file.originalSize < 0
        )
          throw Error("备份包内容或解压大小无效");
        return true;
      },
    });
    if (
      !files["manifest.json"] ||
      !files["ledger.json"] ||
      files["manifest.json"].length > 4096
    )
      throw Error("备份包文件不完整");
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    if (
      manifest.format !== "fine-ledger-exchange" ||
      manifest.version !== 1 ||
      manifest.files?.length !== 1 ||
      manifest.files[0].path !== "ledger.json" ||
      manifest.files[0].bytes !== files["ledger.json"].length ||
      manifest.files[0].sha256 !== (await sha(files["ledger.json"]))
    )
      throw Error("备份包校验失败，未修改本机数据");
    data = JSON.parse(strFromU8(files["ledger.json"]));
  } else data = JSON.parse(strFromU8(bytes));
  const backup = data as BackupData;
  if (!backup || backup.format !== "fine-ledger-backup" || backup.version !== 3)
    throw Error("不支持的备份格式");
  validateBook(backup.book);
  const operations = backup.operations || [];
  if (!Array.isArray(operations) || operations.length > 100000)
    throw Error("备份操作记录无效");
  const ids = new Set();
  for (const op of operations) {
    id(op.id);
    if (
      ids.has(op.id) ||
      (op.bookId !== undefined && op.bookId !== backup.book!.id)
    )
      throw Error("备份操作归属或编号无效");
    ids.add(op.id);
  }
  if (backup.remoteBaseline) {
    const base = backup.remoteBaseline as RemoteBaseline;
    validateBook(base.book);
    id(base.serverEpoch);
    if (
      base.ledgerId !== backup.book!.id ||
      base.book.id !== base.ledgerId ||
      !Array.isArray(base.versions) ||
      !Number.isSafeInteger(base.cursor) ||
      base.cursor < 1 ||
      new URL(base.origin).origin !== base.origin
    )
      throw Error("备份同步基线无效");
  }
  return backup;
}
export async function importLocalBackup(
  mode: Mode,
  backup: BackupData,
  expectedTarget: string,
) {
  validateBook(backup.book);
  const db = databases[mode];
  return db.transaction(
    "rw",
    db.state,
    db.outbox,
    db.revisions,
    db.drafts,
    async () => {
      const lease = (await db.state.get("sync-lease")) as SyncLease | undefined;
      if (lease && lease.until > Date.now())
        throw Error("同步正在进行，请稍后再恢复文件");
      const target = await readRestoreTarget(mode);
      if (target.token !== expectedTarget)
        throw Error("本机内容在预览后变化，请重新预览");
      const before = await exportBook(mode);
      await db.state.put(
        { ...before, beforeFileRestore: undefined },
        "before-file-restore",
      );
      const book = structuredClone(backup.book as Book);
      book.settings.theme =
        (before.book as Book | undefined)?.settings.theme ||
        book.settings.theme;
      await db.outbox.clear();
      await db.revisions.clear();
      await db.drafts.clear();
      await db.state.put(book, "book");
      for (const op of backup.operations || [])
        await db.outbox.put(op as Operation);
      for (const rev of backup.revisions || []) await db.revisions.put(rev);
      for (const [i, draft] of (backup.draftRecords?.length
        ? []
        : backup.legacy?.drafts || []
      ).entries())
        await db.drafts.put(draft, "imported-draft-" + i);
      for (const record of backup.draftRecords || [])
        await db.drafts.put(record.value, record.key);
      if (backup.remoteBaseline)
        await db.state.put(backup.remoteBaseline, "remote-baseline");
      else await db.state.delete("remote-baseline");
      await db.state.put(backup, "source-backup");
      for (const [key, value] of [
        ["legacy-book-v2", backup.legacy?.book],
        ["before-remote-restore", backup.beforeRemoteRestore],
        ["sync-archive", backup.syncArchive],
        [
          "imported-sync-state",
          {
            issue: backup.syncIssue,
            flight: backup.syncFlight,
            initialization: backup.syncInitialization,
            previous: backup.importedSyncState,
          },
        ],
      ] as const) {
        if (value !== undefined) await db.state.put(value, key);
        else await db.state.delete(key);
      }
      await db.state.put(true, "category-icons-repaired-v1");
      for (const key of syncKeys) await db.state.delete(key);
      await db.state.put(false, "sync-enabled");
      await db.state.put(true, "sync-import-review");
      await db.state.put(
        { phase: "unlinked", message: "文件已恢复到本机，连接远端后需先核对" },
        "sync-status",
      );
      return book;
    },
  );
}
