import { backup, DatabaseSync } from "node:sqlite";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  rename,
  rm,
  copyFile,
  chmod,
  access,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { ApiError, ensure, PROTOCOL } from "./protocol.ts";
import { Store } from "./store.ts";
import type { ServiceConfig } from "./config.ts";
import { reportFailure } from "./diagnostics.ts";

const fileHash = async (p: string) =>
  createHash("sha256")
    .update(await readFile(p))
    .digest("hex");
export class Backups {
  store: Store;
  running: Promise<any> | null = null;
  timer?: ReturnType<typeof setInterval>;
  private queue: Promise<unknown> = Promise.resolve();
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.catch(() => {});
    return result;
  }
  constructor(store: Store) {
    this.store = store;
  }
  async list() {
    const root = this.store.config.backupDir;
    await mkdir(root, { recursive: true, mode: 0o700 });
    const results = [];
    const names = await readdir(root);
    const deleted = new Set(
      names
        .filter((f) => f.endsWith(".deleted.json"))
        .map((f) => f.slice(0, -".deleted.json".length)),
    );
    for (const f of names.filter((f) => /^backup-[\w-]+\.json$/.test(f))) {
      if (deleted.has(f.slice(0, -5))) continue;
      try {
        const m = JSON.parse(await readFile(path.join(root, f), "utf8"));
        if (m.id === f.slice(0, -5)) results.push(m);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async create(kind: "manual" | "automatic" | "before-restore" = "manual") {
    if (this.running) return this.running;
    this.running = this.exclusive(() => this.perform(kind)).finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async perform(kind: string) {
    const root = this.store.config.backupDir;
    const id = `backup-${Date.now()}-${randomUUID()}`,
      temporary = path.join(root, id + ".partial");
    const target = path.join(root, id + ".sqlite");
    try {
      await mkdir(root, { recursive: true, mode: 0o700 });
      await backup(this.store.db, temporary);
      await chmod(temporary, 0o600);
      const check = new DatabaseSync(temporary, { readOnly: true });
      let cursor: number, ledgerId: unknown, epoch: unknown;
      try {
        ensure(
          check.prepare("PRAGMA integrity_check").get()!.integrity_check ===
            "ok" &&
            check.prepare("PRAGMA foreign_key_check").all().length === 0,
          "备份完整性校验失败",
        );
        cursor = Number(
          check
            .prepare("SELECT COALESCE(MAX(cursor),0) AS n FROM commits")
            .get()!.n,
        );
        ledgerId = check.prepare("SELECT id FROM ledger").get()?.id || null;
        epoch = JSON.parse(
          check.prepare("SELECT value FROM meta WHERE key='epoch'").get()!
            .value as string,
        );
      } finally {
        check.close();
      }
      const manifest = {
        id,
        kind,
        createdAt: new Date().toISOString(),
        schema: 1,
        protocol: PROTOCOL,
        serverEpoch: epoch,
        ledgerId,
        cursor,
        checksum: await fileHash(temporary),
        file: id + ".sqlite",
      };
      await rename(temporary, target);
      const pending = path.join(root, id + ".json.partial");
      await writeFile(pending, JSON.stringify(manifest, null, 2), {
        mode: 0o600,
      });
      await rename(pending, path.join(root, id + ".json"));
      this.store.setMeta("backupStatus", {
        lastSuccess: manifest.createdAt,
        cursor,
        error: null,
      });
      await this.pruneFiles();
      return manifest;
    } catch (e) {
      reportFailure(e, { operation: "backup-create" });
      this.store.setMeta("backupStatus", {
        ...this.store.getMeta<any>("backupStatus"),
        lastFailure: new Date().toISOString(),
        error: "备份失败，请检查备份卷和剩余空间",
      });
      await rm(temporary, { force: true }).catch(() => {});
      throw e;
    }
  }
  private validId(id: string) {
    if (!/^backup-[\w-]{1,120}$/.test(id))
      throw new ApiError(400, "INVALID_BACKUP", "备份 ID 无效");
  }
  private async manifest(id: string) {
    this.validId(id);
    try {
      const value = JSON.parse(
        await readFile(
          path.join(this.store.config.backupDir, id + ".json"),
          "utf8",
        ),
      );
      ensure(value.id === id && value.file === id + ".sqlite", "备份清单无效");
      await access(path.join(this.store.config.backupDir, id + ".sqlite"));
      return value;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        throw new ApiError(404, "BACKUP_NOT_FOUND", "备份不存在或已清理");
      throw e;
    }
  }
  async remove(id: string) {
    return this.exclusive(async () => {
      await this.manifest(id);
      const file = path.join(this.store.config.backupDir, id + ".deleted.json");
      let deletion: { id: string; deletedAt: number };
      try {
        deletion = JSON.parse(await readFile(file, "utf8"));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        deletion = { id, deletedAt: Date.now() };
        await writeFile(file + ".partial", JSON.stringify(deletion), {
          mode: 0o600,
        });
        await rename(file + ".partial", file);
      }
      return { id, deleted: true, undoUntil: deletion.deletedAt + 86400000 };
    });
  }
  async undoDelete(id: string) {
    return this.exclusive(async () => {
      const value = await this.manifest(id);
      const file = path.join(this.store.config.backupDir, id + ".deleted.json");
      try {
        const deletion = JSON.parse(await readFile(file, "utf8"));
        if (Date.now() - deletion.deletedAt >= 86400000)
          throw new ApiError(409, "BACKUP_DELETE_EXPIRED", "撤销期限已过");
        await rm(file);
      } catch (e) {
        // A retried undo is safe while the original backup still exists.
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      return value;
    });
  }
  private async purgeDeleted() {
    const root = this.store.config.backupDir;
    await mkdir(root, { recursive: true, mode: 0o700 });
    for (const file of (await readdir(root)).filter((f) =>
      /^backup-[\w-]+\.deleted\.json$/.test(f),
    )) {
      const id = file.slice(0, -".deleted.json".length);
      const deletion = JSON.parse(
        await readFile(path.join(root, file), "utf8"),
      );
      if (
        deletion.id !== id ||
        !Number.isFinite(deletion.deletedAt) ||
        Date.now() - deletion.deletedAt < 86400000
      )
        continue;
      for (const suffix of [
        ".json",
        ".sqlite",
        ".sqlite-wal",
        ".sqlite-shm",
        ".deleted.json",
      ])
        await rm(path.join(root, id + suffix), { force: true });
    }
  }
  async prune() {
    return this.exclusive(() => this.pruneFiles());
  }
  private async pruneFiles() {
    await this.purgeDeleted();
    const settings = this.store.getMeta("settings"),
      now = Date.now(),
      all = await this.list();
    const keep = new Set<string>(),
      daily = new Set(),
      weekly = new Set();
    let manual = 0;
    for (const m of all) {
      const age = now - Date.parse(m.createdAt);
      if (m.kind !== "automatic") {
        if (manual++ < settings.manualKeep) keep.add(m.id);
        continue;
      }
      const day = m.createdAt.slice(0, 10),
        week = Math.floor(Date.parse(m.createdAt) / (7 * 86400000));
      if (age < settings.recentHours * 3600000) keep.add(m.id);
      if (age < settings.dailyDays * 86400000 && !daily.has(day)) {
        daily.add(day);
        keep.add(m.id);
      }
      if (age < settings.weeklyWeeks * 7 * 86400000 && !weekly.has(week)) {
        weekly.add(week);
        keep.add(m.id);
      }
    }
    if (all[0]) keep.add(all[0].id);
    for (const m of all)
      if (!keep.has(m.id)) {
        await rm(path.join(this.store.config.backupDir, m.id + ".json"));
        await rm(path.join(this.store.config.backupDir, m.id + ".sqlite"));
      }
  }
  start() {
    this.timer = setInterval(() => {
      void this.tick().catch(() => {});
    }, 30000);
    this.timer.unref();
  }
  async tick() {
    try {
      await this.exclusive(() => this.purgeDeleted());
    } catch (e) {
      reportFailure(e, { operation: "backup-cleanup" });
      this.store.setMeta("backupStatus", {
        ...this.store.getMeta<any>("backupStatus"),
        lastFailure: new Date().toISOString(),
        error: "备份失败，请检查备份卷和剩余空间",
      });
      throw e;
    }
    const settings = this.store.getMeta("settings"),
      state = this.store.getMeta("backupStatus");
    if (
      settings.autoBackup &&
      this.store.cursor > 0 &&
      (state?.cursor !== this.store.cursor || state?.error) &&
      (!state?.lastSuccess ||
        Date.now() - Date.parse(state.lastSuccess) >=
          settings.backupIntervalMinutes * 60000)
    )
      return this.create("automatic");
    return null;
  }
  async close() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
    await this.queue;
  }
}

// Offline CLI only: caller must stop the service. The exclusive service lock is acquired by CLI.
export async function restoreBackup(config: ServiceConfig, id: string) {
  if (!/^backup-[\w-]+$/.test(id))
    throw new ApiError(400, "INVALID_BACKUP", "备份 ID 无效");
  try {
    await access(path.join(config.backupDir, id + ".deleted.json"));
    throw new ApiError(409, "BACKUP_DELETED", "备份已删除，请先撤销删除");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const manifest = JSON.parse(
    await readFile(path.join(config.backupDir, id + ".json"), "utf8"),
  );
  ensure(
    manifest.id === id &&
      manifest.schema === 1 &&
      manifest.protocol === PROTOCOL,
    "备份清单不兼容",
  );
  const source = path.join(config.backupDir, id + ".sqlite");
  ensure(
    (await fileHash(source)) === manifest.checksum,
    "备份文件校验值不一致",
  );
  const temporary = config.databasePath + ".restore-" + randomUUID();
  await copyFile(source, temporary);
  await chmod(temporary, 0o600);
  try {
    const restored = new DatabaseSync(temporary);
    try {
      ensure(
        Number(restored.prepare("PRAGMA user_version").get()!.user_version) ===
          1,
        "备份结构不兼容",
      );
      ensure(
        restored.prepare("PRAGMA integrity_check").get()!.integrity_check ===
          "ok" &&
          restored.prepare("PRAGMA foreign_key_check").all().length === 0,
        "备份完整性校验失败",
      );
      restored.exec("BEGIN IMMEDIATE");
      restored
        .prepare("UPDATE meta SET value=? WHERE key='epoch'")
        .run(JSON.stringify(randomUUID()));
      restored
        .prepare("DELETE FROM meta WHERE key IN ('password','backupStatus')")
        .run();
      restored.exec(
        "DELETE FROM sessions; DELETE FROM login_limits; UPDATE devices SET revoked=1; COMMIT; PRAGMA wal_checkpoint(TRUNCATE);",
      );
    } finally {
      restored.close();
    }
    const current = new Store(config),
      saves = new Backups(current);
    try {
      await saves.create("before-restore");
      current.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      current.close();
    }
    await rm(config.databasePath + "-wal", { force: true });
    await rm(config.databasePath + "-shm", { force: true });
    await rename(temporary, config.databasePath);
  } finally {
    await rm(temporary, { force: true });
    await rm(temporary + "-wal", { force: true });
    await rm(temporary + "-shm", { force: true });
  }
}
