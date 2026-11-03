import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { X509Certificate, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, open, unlink } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "../server/config.ts";
import { createService } from "../server/app.ts";
import { exampleBook } from "../src/domain/example.ts";
import { buildPreview } from "./build-preview.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = fileURLToPath(import.meta.url);
const runtime = path.join(root, ".local/service-review-8445");
const statePath = path.join(runtime, "service.json");
const certDir = path.resolve(
  process.env.IPHONE_CERT_DIR || path.join(root, ".local/iphone"),
);
const command = process.argv[2] || "start";
async function config() {
  const previous = JSON.parse(
    await readFile(path.join(certDir, "config.json"), "utf8"),
  );
  const cert = await readFile(path.join(certDir, "server.pem")),
    ca = await readFile(path.join(certDir, "ca.pem"));
  const leaf = new X509Certificate(cert),
    authority = new X509Certificate(ca);
  if (
    !leaf.verify(authority.publicKey) ||
    !leaf.checkHost(previous.dns) ||
    !leaf.checkIP(previous.ip) ||
    Date.parse(leaf.validTo) <= Date.now()
  )
    throw Error("P0 证书校验失败，未修改证书");
  const service = loadConfig({
    ...process.env,
    FINE_LEDGER_HOST: previous.ip,
    FINE_LEDGER_PORT: "8445",
    FINE_LEDGER_PUBLIC_ORIGIN: `https://${previous.dns}:8445`,
    FINE_LEDGER_DATA_DIR: path.join(runtime, "data"),
    FINE_LEDGER_BACKUP_DIR: path.join(runtime, "backups"),
    FINE_LEDGER_PASSWORD_FILE: path.join(runtime, "access.password"),
    FINE_LEDGER_TLS_CERT_FILE: path.join(certDir, "server.pem"),
    FINE_LEDGER_TLS_KEY_FILE: path.join(certDir, "server-key.pem"),
    FINE_LEDGER_SERVICE_NAME: "厘序账本服务",
    FINE_LEDGER_AUTO_BACKUP: "false",
  });
  return {
    service,
    ca,
    ip: previous.ip,
    dns: previous.dns,
    fingerprint: leaf.fingerprint256,
  };
}
function request(c) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        host: c.ip,
        port: 8445,
        servername: c.dns,
        ca: c.ca,
        path: "/api/v1/meta",
        timeout: 4000,
      },
      (res) => {
        const authorized = res.socket.authorized;
        const fingerprint = res.socket.getPeerCertificate().fingerprint256;
        let body = "";
        res.on("data", (x) => (body += x));
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode,
              data: JSON.parse(body),
              authorized,
              fingerprint,
            });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(Error("HTTPS 超时")));
  });
}
async function status(c) {
  const state = JSON.parse(await readFile(statePath, "utf8")),
    result = await request(c);
  if (
    !result.authorized ||
    result.fingerprint !== c.fingerprint ||
    result.data.protocol !== "fine-ledger-sync-v1"
  )
    throw Error("8445 未返回受原 CA 信任的同步服务");
  console.log(
    JSON.stringify(
      {
        running: true,
        pid: state.pid,
        url: c.service.publicOrigin,
        certificateValidated: true,
        ledger: state.ledger,
        dataDir: c.service.dataDir,
      },
      null,
      2,
    ),
  );
}
try {
  const c = await config();
  if (command === "serve") {
    const runId = process.argv[3];
    if (!runId) throw Error("缺少服务实例 ID");
    const { app, store } = await createService(c.service);
    try {
      if (!store.book()) {
        const book = exampleBook();
        book.name = "我的账本";
        store.initialize(book, randomUUID(), store.epoch, "review-fixture");
        store.setMeta("reviewFixture", book.id);
        await writeFile(
          path.join(runtime, "synthetic-backup.json"),
          JSON.stringify(
            { format: "fine-ledger-backup", version: 3, book },
            null,
            2,
          ),
          { mode: 0o600 },
        );
      } else if (store.getMeta("reviewFixture") !== store.book().id)
        throw Error("检测到非本脚本创建的账本，拒绝覆盖或作为模拟库启动");
      await app.listen({ host: c.ip, port: 8445 });
      const b = store.book();
      await writeFile(
        statePath,
        JSON.stringify(
          {
            pid: process.pid,
            runId,
            ledger: {
              id: b.id,
              name: b.name,
              accounts: b.accounts.length,
              entries: b.entries.length,
            },
            startedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      console.log("8445 模拟服务已启动");
      for (const signal of ["SIGTERM", "SIGINT"])
        process.once(signal, () => {
          void app.close();
        });
    } catch (e) {
      await app.close();
      throw e;
    }
  } else if (command === "start") {
    await buildPreview();
    try {
      await status(c);
      process.exit(0);
    } catch (e) {
      if (!["ENOENT", "ECONNREFUSED", "EHOSTUNREACH"].includes(e.code)) throw e;
    }
    await mkdir(runtime, { recursive: true, mode: 0o700 });
    try {
      await writeFile(c.service.passwordFile, "FineLedger-P2-Test-2026\n", {
        flag: "wx",
        mode: 0o600,
      });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const log = await open(path.join(runtime, "service.log"), "a", 0o600),
      runId = randomUUID();
    const child = spawn(process.execPath, [script, "serve", runId], {
      cwd: root,
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
      env: process.env,
    });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    await log.close();
    child.unref();
    for (let i = 0; i < 50; i++) {
      await delay(150);
      try {
        await status(c);
        process.exit(0);
      } catch (e) {
        if (!["ENOENT", "ECONNREFUSED"].includes(e.code)) throw e;
      }
    }
    throw Error("服务尚未就绪，请检查 .local/service-review-8445/service.log");
  } else if (command === "status") await status(c);
  else if (command === "stop") {
    const state = JSON.parse(await readFile(statePath, "utf8"));
    const args = execFileSync("ps", ["-p", String(state.pid), "-o", "args="], {
      encoding: "utf8",
    });
    if (!args.includes(`${script} serve ${state.runId}`))
      throw Error("PID 不属于此模拟服务，拒绝停止");
    await request(c);
    process.kill(state.pid, "SIGTERM");
    await unlink(statePath);
    console.log("8445 模拟服务已停止，测试数据保留");
  } else throw Error("命令为 start、status 或 stop");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
