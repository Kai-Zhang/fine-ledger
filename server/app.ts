import Fastify from "fastify";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "./store.ts";
import { Backups } from "./backup.ts";
import { cookie, login, session, setPassword } from "./auth.ts";
import { loadConfig, integer, type ServiceConfig } from "./config.ts";
import { ApiError, ensure, id, PROTOCOL, text } from "./protocol.ts";

export function acquireLock(config: ServiceConfig) {
  const lock = new DatabaseSync(
    path.join(config.dataDir, "instance-lock.sqlite"),
  );
  try {
    lock.exec(
      "PRAGMA busy_timeout=0; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS instance_lock(id INTEGER);",
    );
  } catch {
    lock.close();
    throw new Error("此数据目录已有服务或管理命令运行，请先停止该实例");
  }
  return () => lock.close();
}
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
function parameter(value: unknown, min: number, max: number, name: string) {
  try {
    return integer(value, min, max, name);
  } catch (e) {
    throw new ApiError(400, "INVALID_REQUEST", (e as Error).message);
  }
}
export async function createService(
  config: ServiceConfig = loadConfig(),
  options: { initialPassword?: string; timers?: boolean } = {},
) {
  // Store creates the private directory; acquire the lifetime lock before any DB migration.
  const { mkdir } = await import("node:fs/promises");
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const unlock = acquireLock(config);
  let store: Store;
  try {
    store = new Store(config);
    if (!store.getMeta("password")) {
      const password =
        options.initialPassword ??
        (config.passwordFile
          ? (await readFile(config.passwordFile, "utf8")).replace(/\r?\n$/, "")
          : undefined);
      if (!password)
        throw new Error(
          "首次启动需要 FINE_LEDGER_PASSWORD_FILE，密码文件至少 12 个字符",
        );
      await setPassword(store, password);
    }
  } catch (e) {
    store!?.close();
    unlock();
    throw e;
  }
  let tls;
  try {
    if (config.tlsCertFile && config.tlsKeyFile)
      tls = {
        cert: await readFile(config.tlsCertFile),
        key: await readFile(config.tlsKeyFile),
        minVersion: "TLSv1.2" as const,
      };
  } catch (e) {
    store.close();
    unlock();
    throw e;
  }
  const app = (() => {
    try {
      return Fastify({
        ...(tls ? { https: tls } : {}),
        logger: false,
        trustProxy: config.trustedProxies.length
          ? config.trustedProxies
          : false,
        bodyLimit: config.bodyLimit,
        requestTimeout: 30000,
        connectionTimeout: 10000,
      });
    } catch (e) {
      store.close();
      unlock();
      throw e;
    }
  })();
  const backups = new Backups(store);
  if (options.timers !== false) backups.start();
  app.addHook("onClose", async () => {
    await backups.close();
    store.close();
    unlock();
  });
  app.setErrorHandler((error, _request, reply) => {
    const e = error as Error & { statusCode?: number; code?: string };
    const status =
      e.statusCode && e.statusCode >= 400 && e.statusCode < 500
        ? e.statusCode
        : 500;
    if (e instanceof ApiError && e.code === "LOGIN_RATE_LIMIT")
      reply.header("Retry-After", "900");
    // Do not leak paths, SQL, payloads or framework error messages into responses/logs.
    reply.code(status).send({
      code:
        e instanceof ApiError
          ? e.code
          : status === 413
            ? "PAYLOAD_TOO_LARGE"
            : status === 400
              ? "INVALID_REQUEST"
              : "SERVICE_ERROR",
      message:
        e instanceof ApiError
          ? e.message
          : status === 500
            ? "服务暂时无法完成操作"
            : "请求格式或大小无效",
    });
  });
  app.addHook("onRequest", async (request, reply) => {
    const url = request.url.split("?")[0];
    if (!url.startsWith("/api/")) return;
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Cross-Origin-Resource-Policy", "same-origin");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      if (
        request.headers.origin !== config.publicOrigin ||
        !request.headers["content-type"]?.startsWith("application/json")
      )
        throw new ApiError(
          403,
          "ORIGIN_REJECTED",
          "请从部署的同源 HTTPS 页面操作",
        );
    }
    if (
      ["/api/v1/meta", "/api/sync/capabilities"].includes(url) &&
      request.method === "GET"
    )
      return;
    if (url === "/api/v1/session" && request.method === "POST") return;
    const auth = session(store, request.headers.cookie);
    (request as any).auth = auth;
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      request.headers["x-csrf-token"] !== auth.csrf
    )
      throw new ApiError(403, "CSRF_REJECTED", "会话校验失败，请重新连接");
    store.db
      .prepare("UPDATE devices SET last_seen=? WHERE id=?")
      .run(Date.now(), auth.device_id);
  });
  const meta = () => ({
    protocol: PROTOCOL,
    protocolVersion: 1,
    minimumClientProtocol: 1,
    serverEpoch: store.epoch,
    serviceName: store.getMeta("settings").serviceName,
  });
  app.get("/api/v1/meta", async () => meta());
  app.get("/api/sync/capabilities", async () => meta());
  app.post("/api/v1/session", async (request, reply) => {
    const b = request.body as any;
    const result = await login(store, b?.password, b?.deviceName, request.ip);
    reply.header(
      "Set-Cookie",
      cookie(store, result.token, config.sessionDays * 86400),
    );
    return {
      csrf: result.csrf,
      deviceId: result.deviceId,
      expires: result.expires,
      ...meta(),
    };
  });
  app.get("/api/v1/session", async (request) => {
    const a = (request as any).auth;
    const b = store.book();
    return {
      csrf: a.csrf,
      deviceId: a.device_id,
      deviceName: a.name,
      expires: a.expires,
      ...meta(),
      ledger: b
        ? {
            id: b.id,
            name: b.name,
            currency: b.currency,
            accounts: b.accounts.length,
            entries: b.entries.length,
          }
        : null,
    };
  });
  app.delete("/api/v1/session", async (request, reply) => {
    const auth = (request as any).auth;
    store.transaction(() => {
      store.db
        .prepare("DELETE FROM sessions WHERE device_id=?")
        .run(auth.device_id);
      store.db
        .prepare("UPDATE devices SET revoked=1 WHERE id=?")
        .run(auth.device_id);
    });
    reply.header("Set-Cookie", cookie(store, "", 0));
    return { ok: true };
  });
  app.get("/api/v1/devices", async () => ({
    devices: store.db
      .prepare(
        "SELECT id,name,created_at AS createdAt,last_seen AS lastSeen,revoked,EXISTS(SELECT 1 FROM sessions WHERE device_id=devices.id AND expires>?) AS connected FROM devices ORDER BY created_at",
      )
      .all(Date.now()),
  }));
  app.patch("/api/v1/devices/:id", async (request) => {
    const device = (request.params as any).id;
    id(device);
    const b = request.body as any;
    text(b?.name, "设备名称", 100);
    const r = store.db
      .prepare("UPDATE devices SET name=? WHERE id=? AND revoked=0")
      .run(b.name, device);
    if (!r.changes) throw new ApiError(404, "DEVICE_NOT_FOUND", "设备不存在");
    return { ok: true };
  });
  app.delete("/api/v1/devices/:id", async (request) => {
    const device = (request.params as any).id;
    id(device);
    store.transaction(() => {
      store.db.prepare("UPDATE devices SET revoked=1 WHERE id=?").run(device);
      store.db.prepare("DELETE FROM sessions WHERE device_id=?").run(device);
    });
    return { ok: true };
  });
  app.get("/api/v1/snapshot", async () => store.snapshot());
  app.post("/api/v1/ledger/initialize", async (request) => {
    const b = request.body as any;
    id(b?.operationId);
    id(b?.serverEpoch);
    return store.initialize(
      b.book,
      b.operationId,
      b.serverEpoch,
      (request as any).auth.device_id,
    );
  });
  app.post("/api/v1/sync/push", async (request) => {
    const b = request.body as any;
    ensure(
      b?.protocol === PROTOCOL &&
        Array.isArray(b.commands) &&
        b.commands.length > 0 &&
        b.commands.length <= 50,
      "同步协议或批次无效",
    );
    const results = [];
    for (const command of b.commands)
      results.push(store.push(command, (request as any).auth.device_id));
    return { serverEpoch: store.epoch, results };
  });
  app.get("/api/v1/sync/pull", async (request) => {
    const q = request.query as any;
    id(q.serverEpoch);
    id(q.ledgerId);
    return store.pull(
      q.serverEpoch,
      q.ledgerId,
      parameter(q.after, 0, Number.MAX_SAFE_INTEGER, "游标"),
      parameter(q.limit || 20, 1, 100, "批次大小"),
    );
  });
  app.get("/api/v1/settings", async () => ({
    settings: store.getMeta("settings"),
    deployment: {
      publicOrigin: config.publicOrigin,
      sessionDays: config.sessionDays,
      backupTarget: "local-volume",
    },
    backupStatus: store.getMeta("backupStatus") || null,
  }));
  app.patch("/api/v1/settings", async (request) =>
    store.transaction(() => {
      const b = request.body as any,
        current = store.getMeta("settings");
      ensure(
        b &&
          typeof b === "object" &&
          Object.keys(b).every((k) =>
            [
              "revision",
              "serviceName",
              "autoBackup",
              "backupIntervalMinutes",
              "recentHours",
              "dailyDays",
              "weeklyWeeks",
              "manualKeep",
            ].includes(k),
          ),
        "仅允许运行设置，部署地址与目录需在部署配置中修改",
      );
      if (b.revision !== current.revision)
        throw new ApiError(
          409,
          "SETTINGS_CONFLICT",
          "设置已在另一设备修改，请重新载入",
        );
      const settings = { ...current, ...b, revision: current.revision + 1 };
      text(settings.serviceName, "服务名称", 100);
      ensure(typeof settings.autoBackup === "boolean", "自动备份开关无效");
      for (const [k, min, max] of [
        ["backupIntervalMinutes", 5, 1440],
        ["recentHours", 1, 168],
        ["dailyDays", 1, 90],
        ["weeklyWeeks", 1, 52],
        ["manualKeep", 1, 100],
      ] as const)
        settings[k] = parameter(settings[k], min, max, k);
      store.setMeta("settings", settings);
      return { settings };
    }),
  );
  app.get("/api/v1/backups", async () => ({ backups: await backups.list() }));
  app.post("/api/v1/backups", async () => backups.create());
  app.delete<{ Params: { id: string } }>(
    "/api/v1/backups/:id",
    async (request) => backups.remove(request.params.id),
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/backups/:id/undo-delete",
    async (request) => backups.undoDelete(request.params.id),
  );
  app.get("/healthz", async () => ({
    ok: store.db.prepare("SELECT 1 AS n").get()!.n === 1,
  }));
  app.get("/*", async (request, reply) => {
    if (request.url.startsWith("/api/"))
      throw new ApiError(404, "NOT_FOUND", "接口不存在");
    const pathname = decodeURIComponent(request.url.split("?")[0]);
    const file = path.resolve(
      config.staticDir,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    if (!file.startsWith(config.staticDir + path.sep))
      throw new ApiError(404, "NOT_FOUND", "页面不存在");
    try {
      ensure((await stat(file)).isFile(), "页面不存在");
      reply.header(
        "Content-Type",
        mime[path.extname(file)] || "application/octet-stream",
      );
      reply.header(
        "Cache-Control",
        pathname.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-store",
      );
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      );
      if (pathname === "/sw.js") reply.header("Service-Worker-Allowed", "/");
      return await readFile(file);
    } catch {
      throw new ApiError(404, "NOT_FOUND", "页面不存在");
    }
  });
  await app.ready();
  return { app, store, backups };
}
