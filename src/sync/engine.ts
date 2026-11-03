import {
  databases,
  type LedgerDB,
  type Mode,
  type RemoteBaseline,
} from "../storage/repository.ts";
import type { Book } from "../domain/types.ts";
import {
  canonical,
  PROTOCOL,
  validateBook,
  type Collection,
  type Command,
} from "./protocol.ts";
import {
  applyChanges,
  allEntities,
  business,
  changesBetween,
  commandFor,
  entity,
  keyOf,
  rebase,
  same,
  type ConflictItem,
  type VersionedChange,
} from "./model.ts";
import { serviceRequest, type ServiceSession } from "./service.ts";
import { verifySnapshot, type Snapshot } from "./snapshot.ts";
import type { SyncFlight, SyncIssue, SyncLease, SyncStatus } from "./state.ts";

type Transport = typeof serviceRequest;
class LeaseLost extends Error {}
class Editing extends Error {}
const nowISO = () => new Date().toISOString();
const listeners = new Set<(force: boolean) => void>();
export function requestSync(force = false) {
  for (const listener of listeners) listener(force);
}
export function onSyncRequested(listener: (force: boolean) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const syncMessage = (phase: SyncStatus["phase"]) =>
  ({
    idle: "已同步",
    syncing: "正在同步",
    offline: "等待网络",
    "auth-required": "需要重新连接",
    unlinked: "未连接同步",
    conflict: "有冲突待处理",
    recovery: "恢复后待核对",
    paused: "编辑完成后继续同步",
    error: "同步需要处理",
  })[phase];
function baselineFrom(snapshot: Snapshot, origin: string): RemoteBaseline {
  return {
    origin,
    ledgerId: snapshot.book.id,
    serverEpoch: snapshot.serverEpoch,
    cursor: snapshot.cursor,
    versions: snapshot.versions,
    checksum: snapshot.checksum,
    book: snapshot.book,
    restoredAt: nowISO(),
  };
}
function itemsFor(
  base: Book,
  local: Book,
  remote: Book,
  keys?: Set<string>,
): ConflictItem[] {
  const known = new Map(
    [...changesBetween(base, local), ...changesBetween(base, remote)].map(
      (ch) => [keyOf(ch.collection, ch.id), ch],
    ),
  );
  return [...known.values()]
    .filter((ch) => !keys || keys.has(keyOf(ch.collection, ch.id)))
    .map((ch) => ({
      collection: ch.collection,
      id: ch.id,
      base: structuredClone(entity(base, ch.collection, ch.id)),
      local: structuredClone(entity(local, ch.collection, ch.id)),
      remote: structuredClone(entity(remote, ch.collection, ch.id)),
    }));
}
function refreshItems(issue: SyncIssue, local: Book, remote: Book) {
  const keys = new Set(issue.items.map((i) => keyOf(i.collection, i.id)));
  if (issue.kind === "recovery" || issue.kind === "migration") {
    for (const ch of changesBetween(remote, local))
      if (
        ch.value !== null ||
        issue.localKeys?.includes(keyOf(ch.collection, ch.id))
      )
        keys.add(keyOf(ch.collection, ch.id));
  } else {
    for (const item of rebase(issue.baseBook, local, remote).conflicts)
      if (
        !issue.localKeys ||
        issue.localKeys.includes(keyOf(item.collection, item.id))
      )
        keys.add(keyOf(item.collection, item.id));
  }
  const candidates = new Map(
    [
      ...allEntities(issue.baseBook),
      ...allEntities(local),
      ...allEntities(remote),
      ...issue.items,
    ].map((ch) => [keyOf(ch.collection, ch.id), ch]),
  );
  return [...keys].map((key) => {
    const ch = candidates.get(key)!;
    return {
      collection: ch.collection,
      id: ch.id,
      base: structuredClone(entity(issue.baseBook, ch.collection, ch.id)),
      local: structuredClone(entity(local, ch.collection, ch.id)),
      remote: structuredClone(entity(remote, ch.collection, ch.id)),
    };
  });
}
export class SyncEngine {
  mode: Mode;
  options: {
    origin?: string;
    request?: Transport;
    canApply?: () => boolean;
    db?: LedgerDB;
  };
  db: LedgerDB;
  origin: string;
  owner = crypto.randomUUID();
  running = false;
  csrf = "";
  constructor(
    mode: Mode = "personal",
    options: {
      origin?: string;
      request?: Transport;
      canApply?: () => boolean;
      db?: LedgerDB;
    } = {},
  ) {
    this.mode = mode;
    this.options = options;
    this.db = options.db || databases[mode];
    this.origin = options.origin || location.origin;
  }
  private async api(path: string, method = "GET", data?: unknown) {
    return (this.options.request || serviceRequest)(path, {
      method,
      data,
      csrf: this.csrf,
      signal: AbortSignal.timeout(15000),
    });
  }
  private async status(
    phase: SyncStatus["phase"],
    message?: string,
    extra: Partial<SyncStatus> = {},
  ) {
    await this.db.transaction("rw", this.db.state, async () => {
      const previous = (await this.db.state.get("sync-status")) as
        SyncStatus | undefined;
      const next = {
        lastSuccess: previous?.lastSuccess,
        phase,
        message,
        ...extra,
      };
      if (canonical(previous || null) !== canonical(next))
        await this.db.state.put(next, "sync-status");
    });
  }
  private async acquire() {
    return this.db.transaction("rw", this.db.state, async () => {
      const lease = (await this.db.state.get("sync-lease")) as
        SyncLease | undefined;
      if (lease && lease.until > Date.now() && lease.owner !== this.owner)
        return false;
      await this.db.state.put(
        { owner: this.owner, until: Date.now() + 120000 },
        "sync-lease",
      );
      return true;
    });
  }
  private async guard() {
    const lease = (await this.db.state.get("sync-lease")) as
      SyncLease | undefined;
    if (!lease || lease.owner !== this.owner || lease.until <= Date.now())
      throw new LeaseLost("同步已交给另一个页面");
  }
  private async write<T>(fn: () => Promise<T>) {
    return this.db.transaction(
      "rw",
      this.db.state,
      this.db.outbox,
      this.db.revisions,
      this.db.drafts,
      async () => {
        await this.guard();
        return fn();
      },
    );
  }
  private async session() {
    const s = (await this.api("session")) as ServiceSession;
    if (s.protocol !== PROTOCOL) throw Error("同步协议不兼容");
    this.csrf = s.csrf;
    return s;
  }
  private async snapshot(session: ServiceSession) {
    if (!session.ledger) throw Error("远端尚无账本");
    return verifySnapshot(await this.api("snapshot"), {
      ledgerId: session.ledger.id,
      serverEpoch: session.serverEpoch,
    });
  }
  private async archive(reason: string) {
    const book = await this.db.state.get("book");
    if (book)
      await this.db.state.put(
        {
          at: nowISO(),
          reason,
          book,
          operations: await this.db.outbox.toArray(),
          baseline: await this.db.state.get("remote-baseline"),
          revisions: await this.db.revisions.toArray(),
        },
        "sync-archive",
      );
  }
  private async issueFromSnapshot(
    session: ServiceSession,
    kind: SyncIssue["kind"],
    message: string,
  ) {
    const snapshot = await this.snapshot(session);
    await this.write(async () => {
      const local = (await this.db.state.get("book")) as Book,
        base = (await this.db.state.get("remote-baseline")) as
          RemoteBaseline | undefined;
      if (local.id !== snapshot.book.id) {
        await this.db.state.put(
          {
            phase: "unlinked",
            message: "本机与远端是不同账本，请先选择从远端恢复；本机内容仍保留",
          },
          "sync-status",
        );
        return;
      }
      const original = base?.book || snapshot.book;
      let items = itemsFor(original, local, snapshot.book);
      if (kind === "recovery" || kind === "migration") {
        const localRows = new Map(
          [...changesBetween(snapshot.book, local)].map((c) => [
            keyOf(c.collection, c.id),
            c,
          ]),
        );
        // A missing row in an old unbound copy is not proof that the user deleted it.
        const explicitDeletes = new Set(
          (await this.db.outbox.toArray()).flatMap((o) =>
            (Array.isArray(o.changes) ? o.changes : [])
              .filter((c) => c.after === undefined && c.before !== undefined)
              .map((c) => `${c.collection}/${c.id}`),
          ),
        );
        items = [...localRows.values()]
          .filter(
            (c) =>
              c.value !== null ||
              (kind === "recovery" && !!entity(original, c.collection, c.id)) ||
              explicitDeletes.has(keyOf(c.collection, c.id)),
          )
          .map((c) => ({
            collection: c.collection,
            id: c.id,
            base: structuredClone(entity(original, c.collection, c.id)),
            local: structuredClone(entity(local, c.collection, c.id)),
            remote: structuredClone(entity(snapshot.book, c.collection, c.id)),
          }));
      }
      const issue: SyncIssue = {
        id: crypto.randomUUID(),
        kind,
        message,
        baseBook: original,
        remoteBook: snapshot.book,
        items,
        serverEpoch: snapshot.serverEpoch,
        cursor: snapshot.cursor,
        versions: snapshot.versions,
        at: nowISO(),
      };
      await this.db.state.put(issue, "sync-issue");
      await this.db.state.put(
        { phase: kind === "recovery" ? "recovery" : "conflict", message },
        "sync-status",
      );
    });
  }
  private async compact() {
    const baseline = (await this.db.state.get("remote-baseline")) as
        RemoteBaseline | undefined,
      book = (await this.db.state.get("book")) as Book | undefined;
    if (
      baseline &&
      book &&
      !changesBetween(baseline.book, book).length &&
      !(await this.db.state.get("sync-flight")) &&
      !(await this.db.state.get("sync-issue")) &&
      (await this.db.outbox.count()) > 0
    )
      await this.db.outbox.clear();
  }
  private async applyBatch(
    batch: { cursor: number; operationId: string; changes: VersionedChange[] },
    epoch: string,
  ) {
    if (this.options.canApply?.() === false) throw new Editing();
    await this.write(async () => {
      if (this.options.canApply?.() === false) throw new Editing();
      const base = (await this.db.state.get(
          "remote-baseline",
        )) as RemoteBaseline,
        local = (await this.db.state.get("book")) as Book;
      if (
        base.serverEpoch !== epoch ||
        base.origin !== this.origin ||
        base.ledgerId !== local.id
      )
        throw new LeaseLost("账本连接在同步期间发生变化");
      if (batch.cursor <= base.cursor) return;
      if (
        !Number.isSafeInteger(batch.cursor) ||
        batch.cursor !== base.cursor + 1 ||
        !Array.isArray(batch.changes) ||
        !batch.changes.length
      )
        throw Error("远端提交批次无效");
      const versions = new Map(
        base.versions.map((v) => [keyOf(v.collection, v.id), v]),
      );
      for (const ch of batch.changes) {
        if (
          !Number.isSafeInteger(ch.version) ||
          ch.version !==
            (versions.get(keyOf(ch.collection, ch.id))?.version || 0) + 1
        )
          throw Error("远端版本不连续，请重新核对副本");
        versions.set(keyOf(ch.collection, ch.id), {
          collection: ch.collection,
          id: ch.id,
          version: ch.version,
        });
      }
      const remote = applyChanges(base.book, batch.changes);
      remote.revision = batch.cursor;
      validateBook(remote, base.book);
      const flight = (await this.db.state.get("sync-flight")) as
        SyncFlight | undefined;
      const own = flight?.receipt?.operationId === batch.operationId;
      const merge = rebase(base.book, local, remote, own);
      let issue = (await this.db.state.get("sync-issue")) as
        SyncIssue | undefined;
      let relationError = "";
      try {
        validateBook(merge.book, remote);
      } catch (e) {
        relationError = (e as Error).message;
      }
      if (!issue && (merge.conflicts.length || relationError)) {
        issue = {
          id: crypto.randomUUID(),
          kind: "conflict",
          message: relationError || "同一条内容在本机和远端都发生了变化",
          baseBook: base.book,
          remoteBook: remote,
          items: relationError
            ? itemsFor(base.book, local, remote)
            : merge.conflicts,
          serverEpoch: epoch,
          cursor: batch.cursor,
          versions: [...versions.values()],
          at: nowISO(),
          localKeys: changesBetween(base.book, local).map((ch) =>
            keyOf(ch.collection, ch.id),
          ),
        };
      }
      if (issue) {
        issue.remoteBook = remote;
        issue.cursor = batch.cursor;
        issue.versions = [...versions.values()];
        issue.items = refreshItems(issue, local, remote);
        await this.db.state.put(issue, "sync-issue");
      }
      const next = {
        ...base,
        book: remote,
        versions: [...versions.values()],
        cursor: batch.cursor,
        checksum: "",
        ...(own ? { lastOperationId: batch.operationId } : {}),
      };
      await this.db.state.put(next, "remote-baseline");
      // A broken relation never becomes a partially applied local business state.
      if (!relationError) await this.db.state.put(merge.book, "book");
      if (flight?.receipt && batch.cursor >= flight.receipt.cursor)
        await this.db.state.delete("sync-flight");
      await this.compact();
    });
  }
  private async pull() {
    for (let page = 0; page < 100; page++) {
      const base = (await this.db.state.get(
        "remote-baseline",
      )) as RemoteBaseline;
      const q = new URLSearchParams({
        ledgerId: base.ledgerId,
        serverEpoch: base.serverEpoch,
        after: String(base.cursor),
        limit: "50",
      });
      const response = await this.api("sync/pull?" + q);
      if (
        response.serverEpoch !== base.serverEpoch ||
        !Array.isArray(response.batches) ||
        !Number.isSafeInteger(response.nextCursor) ||
        response.nextCursor < base.cursor
      )
        throw Error("远端增量响应无效");
      for (const batch of response.batches)
        await this.applyBatch(batch, response.serverEpoch);
      const current = (await this.db.state.get(
        "remote-baseline",
      )) as RemoteBaseline;
      if (current.cursor !== response.nextCursor) throw Error("远端水位不一致");
      if (!response.hasMore) return;
      if (!response.batches.length) throw Error("远端增量没有向前推进");
    }
    throw Error("本轮同步量较大，将在下次继续");
  }
  private async freeze() {
    return this.write(async () => {
      const old = (await this.db.state.get("sync-flight")) as
        SyncFlight | undefined;
      if (old) return old;
      if (await this.db.state.get("sync-issue")) return null;
      const base = (await this.db.state.get(
          "remote-baseline",
        )) as RemoteBaseline,
        local = (await this.db.state.get("book")) as Book;
      let command: Command | null;
      try {
        validateBook(local, base.book);
        command = commandFor(
          base.book,
          local,
          base.versions,
          base.serverEpoch,
          base.lastOperationId,
        );
      } catch (e) {
        const issue: SyncIssue = {
          id: crypto.randomUUID(),
          kind: "rejected",
          message: (e as Error).message,
          baseBook: base.book,
          remoteBook: base.book,
          items: itemsFor(base.book, local, base.book),
          serverEpoch: base.serverEpoch,
          cursor: base.cursor,
          versions: base.versions,
          at: nowISO(),
          localKeys: changesBetween(base.book, local).map((ch) =>
            keyOf(ch.collection, ch.id),
          ),
        };
        await this.db.state.put(issue, "sync-issue");
        return null;
      }
      if (!command) {
        await this.compact();
        return null;
      }
      const flight = { command };
      await this.db.state.put(flight, "sync-flight");
      return flight;
    });
  }
  private async send(flight: SyncFlight) {
    if (flight.receipt) return;
    const response = await this.api("sync/push", "POST", {
      protocol: PROTOCOL,
      commands: [flight.command],
    });
    const result = response.results?.[0];
    if (!result || result.operationId !== flight.command.operationId)
      throw Error("上传回执不完整");
    await this.write(async () => {
      const current = (await this.db.state.get("sync-flight")) as
        SyncFlight | undefined;
      if (
        !current ||
        current.command.operationId !== flight.command.operationId
      )
        throw new LeaseLost();
      if (result.status === "committed") {
        current.receipt = result;
        await this.db.state.put(current, "sync-flight");
        return;
      }
      if (result.status === "blocked")
        throw Error("前序操作尚未完成，请稍后重试");
      if (!["conflict", "rejected"].includes(result.status))
        throw Error("上传回执状态无效");
      const base = (await this.db.state.get(
          "remote-baseline",
        )) as RemoteBaseline,
        local = (await this.db.state.get("book")) as Book;
      const keys = new Set(
        flight.command.changes.map((ch) => keyOf(ch.collection, ch.id)),
      );
      const issue: SyncIssue = {
        id: crypto.randomUUID(),
        kind: result.status === "rejected" ? "rejected" : "conflict",
        message: result.message || "远端已修改相关记录，请核对后重试",
        baseBook: base.book,
        remoteBook: base.book,
        items: itemsFor(base.book, local, base.book, keys),
        serverEpoch: base.serverEpoch,
        cursor: base.cursor,
        versions: base.versions,
        at: nowISO(),
        localKeys: changesBetween(base.book, local).map((ch) =>
          keyOf(ch.collection, ch.id),
        ),
      };
      await this.db.state.put(issue, "sync-issue");
      await this.db.state.delete("sync-flight");
    });
  }
  private async completeInitialization(session: ServiceSession) {
    const init = (await this.db.state.get("sync-init")) as
      { book: Book; operationId: string; serverEpoch: string } | undefined;
    if (!init) return;
    if (init.serverEpoch !== session.serverEpoch)
      throw Object.assign(Error("服务已恢复，需要核对初始化内容"), {
        code: "EPOCH_CHANGED",
      });
    await this.api("ledger/initialize", "POST", init);
    const current = await this.session(),
      snapshot = await this.snapshot(current);
    await this.write(async () => {
      const local = (await this.db.state.get("book")) as Book;
      if (local.id !== snapshot.book.id)
        throw new LeaseLost("本机账本在初始化期间发生变化");
      await this.db.state.put(
        baselineFrom(snapshot, this.origin),
        "remote-baseline",
      );
      await this.db.state.delete("sync-init");
      await this.db.state.delete("sync-import-review");
      await this.db.state.put(true, "sync-enabled");
      await this.compact();
    });
  }
  async publish() {
    if (this.running || !(await this.acquire()))
      throw Error("另一页面正在同步，请稍后再试");
    this.running = true;
    try {
      const session = await this.session();
      await this.write(async () => {
        if (await this.db.state.get("sync-init")) return;
        if (session.ledger) throw Error("远端已有账本，请使用下载或核对入口");
        const book = (await this.db.state.get("book")) as Book;
        validateBook(book);
        await this.db.state.put(
          {
            book,
            operationId: crypto.randomUUID(),
            serverEpoch: session.serverEpoch,
          },
          "sync-init",
        );
      });
      await this.completeInitialization(session);
    } finally {
      await this.release();
      this.running = false;
    }
    requestSync();
  }
  private async release() {
    await this.db.transaction("rw", this.db.state, async () => {
      const lease = (await this.db.state.get("sync-lease")) as
        SyncLease | undefined;
      if (lease?.owner === this.owner) await this.db.state.delete("sync-lease");
    });
  }
  async run(force = false) {
    if (this.running) return;
    const enabled = await this.db.state.get("sync-enabled");
    if (enabled === false) return;
    const base = (await this.db.state.get("remote-baseline")) as
      RemoteBaseline | undefined;
    if (!base && !enabled) return;
    const previous = (await this.db.state.get("sync-status")) as
      SyncStatus | undefined;
    if (
      !force &&
      (["auth-required", "conflict", "recovery"].includes(
        previous?.phase || "",
      ) ||
        (previous?.retryAt || 0) > Date.now())
    )
      return;
    if (!(await this.acquire())) return;
    this.running = true;
    const heartbeat = setInterval(() => {
      void this.db
        .transaction("rw", this.db.state, async () => {
          const lease = (await this.db.state.get("sync-lease")) as
            SyncLease | undefined;
          if (lease?.owner === this.owner)
            await this.db.state.put(
              { owner: this.owner, until: Date.now() + 120000 },
              "sync-lease",
            );
        })
        .catch(() => {});
    }, 20000);
    try {
      if (this.options.canApply?.() === false) throw new Editing();
      await this.status("syncing");
      let session = await this.session();
      const local = (await this.db.state.get("book")) as Book | undefined;
      if (!local) {
        await this.status("unlinked", "请先下载或创建本机账本");
        return;
      }
      if (await this.db.state.get("sync-init")) {
        await this.completeInitialization(session);
        session = await this.session();
      }
      let baseline = (await this.db.state.get("remote-baseline")) as
        RemoteBaseline | undefined;
      if (!session.ledger) {
        await this.status(
          "unlinked",
          "远端尚无账本，可以将本机账本用于建立远端",
        );
        return;
      }
      if (local.id !== session.ledger.id) {
        await this.status(
          "unlinked",
          "本机与远端是不同账本，请先从远端恢复或保留本机继续使用",
        );
        return;
      }
      const existingIssue = (await this.db.state.get("sync-issue")) as
        SyncIssue | undefined;
      if (existingIssue) {
        await this.status(
          existingIssue.kind === "recovery" ? "recovery" : "conflict",
          existingIssue.message,
        );
        return;
      }
      if (await this.db.state.get("sync-import-review")) {
        await this.issueFromSnapshot(
          session,
          "recovery",
          "这是从备份文件恢复的本机副本，请先核对后再同步",
        );
        return;
      }
      if (!baseline) {
        const snapshot = await this.snapshot(session);
        if (!changesBetween(snapshot.book, local).length) {
          await this.write(async () => {
            await this.db.state.put(
              baselineFrom(snapshot, this.origin),
              "remote-baseline",
            );
            await this.compact();
          });
          baseline = (await this.db.state.get(
            "remote-baseline",
          )) as RemoteBaseline;
        } else {
          await this.issueFromSnapshot(
            session,
            "migration",
            "本机旧副本尚无同步基线，请核对后建立连接",
          );
          return;
        }
      }
      if (
        baseline.origin !== this.origin ||
        baseline.serverEpoch !== session.serverEpoch
      ) {
        await this.issueFromSnapshot(
          session,
          "recovery",
          "服务已恢复或来源发生变化，已暂停上传，请核对本机与远端",
        );
        return;
      }
      for (let round = 0; round < 100; round++) {
        let flight = (await this.db.state.get("sync-flight")) as
          SyncFlight | undefined;
        if (flight) await this.send(flight);
        await this.pull();
        const issue = (await this.db.state.get("sync-issue")) as
          SyncIssue | undefined;
        if (issue) {
          await this.status(
            issue.kind === "recovery" ? "recovery" : "conflict",
            issue.message,
          );
          return;
        }
        flight = (await this.freeze()) || undefined;
        if (!flight) {
          const issue = (await this.db.state.get("sync-issue")) as
            SyncIssue | undefined;
          if (issue) {
            await this.status("conflict", issue.message);
            return;
          }
          await this.status("idle", undefined, {
            lastSuccess: nowISO(),
            retryAt: undefined,
          });
          return;
        }
        await this.send(flight);
      }
      await this.status("offline", "还有内容待同步，将继续处理", {
        retryAt: Date.now() + 1000,
      });
    } catch (e) {
      const err = e as Error & { status?: number; code?: string };
      if (err instanceof LeaseLost) return;
      if (err instanceof Editing) {
        await this.status("paused");
        return;
      }
      if (err.status === 401) {
        await this.status("auth-required", err.message);
        return;
      }
      if (err.code === "EPOCH_CHANGED" || err.code === "LEDGER_CHANGED") {
        try {
          await this.issueFromSnapshot(
            await this.session(),
            "recovery",
            "远端账本已恢复或切换，已停止旧请求上传",
          );
        } catch {
          await this.status("recovery", "服务发生变化，请重新连接后核对");
        }
        return;
      }
      const network = !err.status || err.status >= 500 || err.status === 429;
      const message = ["AbortError", "TimeoutError"].includes(err.name)
        ? "连接已中断，将在恢复后重试"
        : err.message;
      await this.status(network ? "offline" : "error", message, {
        retryAt: network ? Date.now() + 15000 : undefined,
      });
    } finally {
      clearInterval(heartbeat);
      await this.release();
      this.running = false;
    }
  }
  async resolve(choices: Record<string, "local" | "remote">) {
    if (this.running || !(await this.acquire()))
      throw Error("正在同步，请稍后再处理");
    this.running = true;
    try {
      const issue = (await this.db.state.get("sync-issue")) as
        SyncIssue | undefined;
      if (!issue) throw Error("待处理内容已变化，请重新查看");
      const target = canonical({
        book: await this.db.state.get("book"),
        operations: await this.db.outbox.toArray(),
      });
      const snapshot = await this.snapshot(await this.session());
      if (
        snapshot.serverEpoch !== issue.serverEpoch ||
        !same(allComparable(snapshot.book), allComparable(issue.remoteBook))
      ) {
        await this.write(async () => {
          const current = (await this.db.state.get("sync-issue")) as SyncIssue;
          if (current.id !== issue.id) throw new LeaseLost();
          current.remoteBook = snapshot.book;
          current.versions = snapshot.versions;
          current.cursor = snapshot.cursor;
          current.serverEpoch = snapshot.serverEpoch;
          current.items = refreshItems(
            current,
            (await this.db.state.get("book")) as Book,
            snapshot.book,
          );
          await this.db.state.put(current, "sync-issue");
        });
        throw Error("远端又有变化，已更新对比，请重新确认");
      }
      await this.write(async () => {
        if (
          canonical({
            book: await this.db.state.get("book"),
            operations: await this.db.outbox.toArray(),
          }) !== target
        )
          throw Error("本机内容在核对期间变化，请重新查看");
        const currentIssue = (await this.db.state.get(
          "sync-issue",
        )) as SyncIssue;
        if (currentIssue.id !== issue.id) throw new LeaseLost();
        const local = (await this.db.state.get("book")) as Book;
        const keep =
          issue.kind === "recovery" || issue.kind === "migration"
            ? issue.items.map((i) => ({
                collection: i.collection,
                id: i.id,
                value: entity(local, i.collection, i.id),
              }))
            : changesBetween(issue.baseBook, local).filter(
                (ch) =>
                  !issue.localKeys ||
                  issue.localKeys.includes(keyOf(ch.collection, ch.id)) ||
                  choices[keyOf(ch.collection, ch.id)] === "local",
              );
        const selected = keep.filter((ch) => {
          const key = keyOf(ch.collection, ch.id),
            item = issue.items.find((i) => keyOf(i.collection, i.id) === key);
          if (item && !choices[key]) throw Error("请为每项差异选择保留版本");
          return !item || choices[key] === "local";
        });
        // Remote choices remove only reviewed local changes; unrelated work stays intact.
        const candidate = applyChanges(snapshot.book, selected);
        candidate.settings.theme = local.settings.theme;
        candidate.revision = local.revision + 1;
        validateBook(candidate, snapshot.book);
        await this.archive("同步核对前副本");
        await this.db.state.put(
          baselineFrom(snapshot, this.origin),
          "remote-baseline",
        );
        await this.db.state.put(candidate, "book");
        await this.db.state.delete("sync-flight");
        await this.db.state.delete("sync-init");
        await this.db.state.delete("sync-issue");
        await this.db.state.delete("sync-import-review");
        await this.db.state.put(true, "sync-enabled");
        await this.compact();
        await this.db.state.put({ phase: "idle" }, "sync-status");
      });
    } finally {
      await this.release();
      this.running = false;
    }
    requestSync();
  }
}
function allComparable(book: Book) {
  return allEntities(book)
    .map((ch) => ({ ...ch, value: business(ch.value) }))
    .sort((a, b) =>
      keyOf(a.collection, a.id).localeCompare(keyOf(b.collection, b.id)),
    );
}
