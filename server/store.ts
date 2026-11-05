import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Book } from "../src/domain/types.ts";
import {
  ApiError,
  collections,
  digest,
  ensure,
  portableBook,
  validateBook,
  validateCommand,
  type Change,
  type Collection,
  type Command,
} from "./protocol.ts";
import type { ServiceConfig } from "./config.ts";

const tables = {
  groups: "account_groups",
  accounts: "accounts",
  categories: "categories",
  projects: "projects",
  entries: "entries",
  reports: "reports",
} as const;
export class Store {
  db: DatabaseSync;
  config: ServiceConfig;
  constructor(config: ServiceConfig) {
    this.config = config;
    mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(config.databasePath);
    chmodSync(config.databasePath, 0o600);
    this.db.exec(
      `PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;`,
    );
    const version = Number(
      this.db.prepare("PRAGMA user_version").get()!.user_version,
    );
    if (version > 1) {
      this.db.close();
      throw new Error("数据库版本高于当前服务，禁止降级打开");
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS account_groups(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, group_id TEXT REFERENCES account_groups(id) DEFERRABLE INITIALLY DEFERRED, currency TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS categories(id TEXT PRIMARY KEY, parent_id TEXT REFERENCES categories(id) DEFERRABLE INITIALLY DEFERRED, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) DEFERRABLE INITIALLY DEFERRED, to_account_id TEXT REFERENCES accounts(id) DEFERRABLE INITIALLY DEFERRED, original_id TEXT REFERENCES entries(id) DEFERRABLE INITIALLY DEFERRED, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS splits(entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE, id TEXT NOT NULL, category_id TEXT NOT NULL REFERENCES categories(id) DEFERRABLE INITIALLY DEFERRED, project_id TEXT REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED, amount_minor TEXT NOT NULL, PRIMARY KEY(entry_id,id));
      CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS versions(collection TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(collection,id));
      CREATE TABLE IF NOT EXISTS receipts(ledger_id TEXT NOT NULL, operation_id TEXT NOT NULL, digest TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(ledger_id,operation_id));
      CREATE TABLE IF NOT EXISTS commits(cursor INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL, device_id TEXT NOT NULL, changes TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions(cursor INTEGER NOT NULL REFERENCES commits(cursor), collection TEXT NOT NULL, id TEXT NOT NULL, before_json TEXT, after_json TEXT, PRIMARY KEY(cursor,collection,id));
      CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS login_limits(key TEXT PRIMARY KEY, failures INTEGER NOT NULL, until_at INTEGER NOT NULL);
      PRAGMA user_version=1;
    `);
    this.transaction(() => {
      if (!this.getMeta("epoch")) this.setMeta("epoch", randomUUID());
      if (!this.getMeta("settings"))
        this.setMeta("settings", { ...config.defaults, revision: 1 });
    });
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  getMeta<T = any>(key: string): T | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key=?").get(key);
    return row ? (JSON.parse(row.value as string) as T) : undefined;
  }
  setMeta(key: string, value: unknown) {
    this.db
      .prepare(
        "INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, JSON.stringify(value));
  }
  get epoch(): string {
    return this.getMeta("epoch")!;
  }
  get cursor(): number {
    return Number(
      this.db.prepare("SELECT COALESCE(MAX(cursor),0) AS n FROM commits").get()!
        .n,
    );
  }
  book(): Book | null {
    const row = this.db
      .prepare("SELECT payload,revision FROM ledger LIMIT 1")
      .get();
    if (!row) return null;
    const b = JSON.parse(row.payload as string) as Book;
    b.revision = Number(row.revision);
    b.settings = { ...b.settings, theme: "system", savedReports: [] };
    for (const c of collections) {
      const rows = this.db
        .prepare(`SELECT payload FROM ${tables[c]} ORDER BY id`)
        .all()
        .map((r) => JSON.parse(r.payload as string));
      if (c === "reports") b.settings.savedReports = rows;
      else b[c] = rows;
    }
    return b;
  }
  ledgerId(): string | null {
    return (
      (this.db.prepare("SELECT id FROM ledger LIMIT 1").get()?.id as string) ||
      null
    );
  }
  summary() {
    const row = this.db.prepare("SELECT payload FROM ledger LIMIT 1").get();
    if (!row) return null;
    const { id, name, currency } = JSON.parse(row.payload as string);
    return {
      id,
      name,
      currency,
      accounts: Number(
        this.db.prepare("SELECT COUNT(*) AS n FROM accounts").get()!.n,
      ),
      entries: Number(
        this.db.prepare("SELECT COUNT(*) AS n FROM entries").get()!.n,
      ),
    };
  }
  version(collection: Collection, id: string) {
    return Number(
      this.db
        .prepare("SELECT version FROM versions WHERE collection=? AND id=?")
        .get(collection, id)?.version || 0,
    );
  }
  snapshot() {
    return this.transaction(() => {
      const book = this.book();
      const versions = this.db
        .prepare(
          "SELECT collection,id,version FROM versions ORDER BY collection,id",
        )
        .all();
      const data = {
        protocol: "fine-ledger-sync-v1",
        serverEpoch: this.epoch,
        cursor: this.cursor,
        book,
        versions,
      };
      return { ...data, checksum: digest(data) };
    });
  }
  entity(book: Book, collection: Collection, id: string): any {
    if (collection === "book") {
      const {
        groups,
        accounts,
        categories,
        projects,
        entries,
        revision,
        ...metadata
      } = portableBook(book);
      return {
        ...metadata,
        settings: { timeZoneMode: book.settings.timeZoneMode },
      };
    }
    return (
      (collection === "reports"
        ? book.settings.savedReports
        : book[collection]
      ).find((x) => x.id === id) || null
    );
  }
  allChanges(book: Book): Change[] {
    return [
      {
        collection: "book",
        id: book.id,
        value: this.entity(book, "book", book.id),
      },
      ...collections.flatMap((c) =>
        (c === "reports" ? book.settings.savedReports : book[c]).map((x) => ({
          collection: c,
          id: x.id,
          value: x,
        })),
      ),
    ];
  }
  writeEntity(change: Change) {
    const { collection: c, id, value } = change;
    const v = value as any;
    if (c === "book") {
      this.db
        .prepare(
          "INSERT INTO ledger VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload",
        )
        .run(id, this.cursor + 1, JSON.stringify(v));
      return;
    }
    if (value === null) {
      this.db.prepare(`DELETE FROM ${tables[c]} WHERE id=?`).run(id);
      return;
    }
    const payload = JSON.stringify(value);
    if (c === "accounts")
      this.db
        .prepare(
          "INSERT INTO accounts VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET group_id=excluded.group_id,currency=excluded.currency,payload=excluded.payload",
        )
        .run(id, v.groupId || null, v.currency, payload);
    else if (c === "categories")
      this.db
        .prepare(
          "INSERT INTO categories VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,payload=excluded.payload",
        )
        .run(id, v.parentId || null, payload);
    else if (c === "entries") {
      this.db
        .prepare(
          "INSERT INTO entries VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id,to_account_id=excluded.to_account_id,original_id=excluded.original_id,payload=excluded.payload",
        )
        .run(
          id,
          v.accountId,
          v.toAccountId || null,
          v.originalId || null,
          payload,
        );
      this.db.prepare("DELETE FROM splits WHERE entry_id=?").run(id);
      const insert = this.db.prepare("INSERT INTO splits VALUES(?,?,?,?,?)");
      for (const s of v.splits)
        insert.run(id, s.id, s.categoryId, s.projectId || null, s.amountMinor);
    } else
      this.db
        .prepare(
          `INSERT INTO ${tables[c]} VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`,
        )
        .run(id, payload);
  }
  oldReceipt(ledger: string, operation: string, hash: string) {
    const row = this.db
      .prepare(
        "SELECT digest,result FROM receipts WHERE ledger_id=? AND operation_id=?",
      )
      .get(ledger, operation);
    if (!row) return null;
    if (row.digest !== hash)
      throw new ApiError(
        409,
        "OPERATION_ID_REUSED",
        "同一操作 ID 不能更改内容",
      );
    return JSON.parse(row.result as string);
  }
  receipt(ledger: string, operation: string, hash: string, result: unknown) {
    this.db
      .prepare("INSERT INTO receipts VALUES(?,?,?,?)")
      .run(ledger, operation, hash, JSON.stringify(result));
    return result;
  }
  commit(
    ledger: string,
    operation: string,
    device: string,
    hash: string,
    changes: Change[],
    before?: Book,
  ) {
    const versioned = changes.map((ch) => {
      const version = this.version(ch.collection, ch.id) + 1;
      if (ch.collection === "entries" && ch.value)
        ch = { ...ch, value: { ...ch.value, revision: version } };
      this.writeEntity(ch);
      this.db
        .prepare(
          "INSERT INTO versions VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET version=excluded.version",
        )
        .run(ch.collection, ch.id, version);
      return { ...ch, version };
    });
    const at = new Date().toISOString();
    const cursor = Number(
      this.db
        .prepare(
          "INSERT INTO commits(operation_id,device_id,changes,at) VALUES(?,?,?,?)",
        )
        .run(operation, device, JSON.stringify(versioned), at).lastInsertRowid,
    );
    this.db
      .prepare("UPDATE ledger SET revision=? WHERE id=?")
      .run(cursor, ledger);
    for (const ch of versioned)
      this.db
        .prepare("INSERT INTO revisions VALUES(?,?,?,?,?)")
        .run(
          cursor,
          ch.collection,
          ch.id,
          JSON.stringify(
            before ? this.entity(before, ch.collection, ch.id) : null,
          ),
          JSON.stringify(ch.value),
        );
    return this.receipt(ledger, operation, hash, {
      operationId: operation,
      status: "committed",
      cursor,
      changes: versioned,
    });
  }
  initialize(book: Book, operation: string, epoch: string, device: string) {
    validateBook(book);
    return this.transaction(() => {
      if (epoch !== this.epoch)
        throw new ApiError(
          409,
          "EPOCH_CHANGED",
          "服务已恢复，请先核对本机副本",
        );
      const hash = digest({ book, operation, epoch });
      const previous = this.oldReceipt(book.id, operation, hash);
      if (previous) return previous;
      if (this.book())
        throw new ApiError(
          409,
          "LEDGER_EXISTS",
          "服务已有账本，不能覆盖初始化",
        );
      return this.commit(
        book.id,
        operation,
        device,
        hash,
        this.allChanges(portableBook(book)),
      );
    });
  }
  push(command: Command, device: string) {
    validateCommand(command);
    return this.transaction(() => {
      if (command.serverEpoch !== this.epoch)
        throw new ApiError(
          409,
          "EPOCH_CHANGED",
          "服务已恢复，请先核对本机副本",
        );
      const book = this.book();
      if (!book || book.id !== command.ledgerId)
        throw new ApiError(409, "LEDGER_CHANGED", "账本身份不一致");
      const hash = digest(command),
        old = this.oldReceipt(book.id, command.operationId, hash);
      if (old) return old;
      // Changes to referenced entities must become visible to the author before retrying.
      const expectedKeys = new Set(
        command.expected.map((e) => `${e.collection}/${e.id}`),
      );
      for (const ch of command.changes) {
        const v = ch.value as any;
        if (ch.collection === "entries" && v) {
          const refs = [
            ["accounts", v.accountId],
            ["accounts", v.toAccountId],
            ["entries", v.originalId],
            ["entries", v.transferId],
            ...(Array.isArray(v.splits)
              ? v.splits.flatMap((s: any) => [
                  ["categories", s.categoryId],
                  ["projects", s.projectId],
                ])
              : []),
          ];
          for (const [collection, id] of refs)
            if (id)
              ensure(
                expectedKeys.has(`${collection}/${id}`),
                "交易必须声明账户、类目、项目和退款来源的版本",
              );
        }
      }
      for (const dep of command.dependsOn) {
        const r = this.db
          .prepare(
            "SELECT result FROM receipts WHERE ledger_id=? AND operation_id=?",
          )
          .get(book.id, dep);
        if (!r || JSON.parse(r.result as string).status !== "committed")
          return {
            operationId: command.operationId,
            status: "blocked",
            code: "DEPENDENCY_NOT_COMMITTED",
          };
      }
      const mismatches = command.expected.filter(
        (e) => this.version(e.collection, e.id) !== e.version,
      );
      if (mismatches.length)
        return this.receipt(book.id, command.operationId, hash, {
          operationId: command.operationId,
          status: "conflict",
          code: "VERSION_CONFLICT",
          remote: mismatches.map((e) => ({
            collection: e.collection,
            id: e.id,
            version: this.version(e.collection, e.id),
            value: this.entity(book, e.collection, e.id),
          })),
        });
      const next = {
        ...book,
        settings: {
          ...book.settings,
          savedReports: [...book.settings.savedReports],
        },
        groups: [...book.groups],
        accounts: [...book.accounts],
        categories: [...book.categories],
        projects: [...book.projects],
        entries: [...book.entries],
      };
      try {
        for (const ch of command.changes) {
          if (ch.collection === "book") {
            const metadata = ch.value as any;
            ensure(
              metadata.currency &&
                metadata.settings &&
                Object.keys(metadata.settings).every(
                  (k) => k === "timeZoneMode",
                ),
              "账本变更仅接受共享元数据",
            );
            const allowed = [
              "id",
              "schema",
              "name",
              "currency",
              "timeZone",
              "createdAt",
              "settings",
            ];
            ensure(
              Object.keys(metadata).every((k) => allowed.includes(k)),
              "账本元数据含不支持字段",
            );
            Object.assign(next, {
              ...metadata,
              settings: { ...next.settings, ...metadata.settings },
            });
          } else {
            ensure(
              !(ch.collection === "entries" && ch.value === null),
              "交易删除必须保留 deletedAt 墓碑",
            );
            const rows =
              ch.collection === "reports"
                ? next.settings.savedReports
                : next[ch.collection];
            const i = rows.findIndex((x) => x.id === ch.id);
            if (ch.value === null) {
              if (i >= 0) rows.splice(i, 1);
            } else if (i < 0) rows.push(ch.value as never);
            else rows[i] = ch.value as never;
          }
        }
        validateBook(next, book);
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        return this.receipt(book.id, command.operationId, hash, {
          operationId: command.operationId,
          status: "rejected",
          code: e.code,
          message: e.message,
        });
      }
      return this.commit(
        book.id,
        command.operationId,
        device,
        hash,
        command.changes,
        book,
      );
    });
  }
  pull(epoch: string, ledger: string, after: number, limit: number) {
    if (epoch !== this.epoch)
      throw new ApiError(409, "EPOCH_CHANGED", "服务已恢复，请先核对本机副本");
    if (this.ledgerId() !== ledger)
      throw new ApiError(409, "LEDGER_CHANGED", "账本身份不一致");
    ensure(after <= this.cursor, "游标超出服务水位");
    const rows = this.db
      .prepare("SELECT * FROM commits WHERE cursor>? ORDER BY cursor LIMIT ?")
      .all(after, limit);
    const batches = rows.map((r) => ({
      cursor: Number(r.cursor),
      operationId: r.operation_id,
      deviceId: r.device_id,
      at: r.at,
      changes: JSON.parse(r.changes as string),
    }));
    const nextCursor = batches.at(-1)?.cursor ?? after;
    return {
      serverEpoch: this.epoch,
      batches,
      nextCursor,
      highWater: this.cursor,
      hasMore: nextCursor < this.cursor,
    };
  }
  close() {
    this.db.close();
  }
}
