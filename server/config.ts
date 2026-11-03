import path from "node:path";

export function integer(
  value: unknown,
  min: number,
  max: number,
  name: string,
) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw new Error(`${name} 必须在 ${min}–${max} 之间`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const dataDir = path.resolve(env.FINE_LEDGER_DATA_DIR || ".local/service");
  const publicOrigin = new URL(
    env.FINE_LEDGER_PUBLIC_ORIGIN || "http://localhost:4181",
  );
  if (
    !["http:", "https:"].includes(publicOrigin.protocol) ||
    publicOrigin.pathname !== "/" ||
    publicOrigin.search ||
    publicOrigin.hash ||
    publicOrigin.username ||
    publicOrigin.password
  )
    throw new Error(
      "FINE_LEDGER_PUBLIC_ORIGIN 必须是无路径、无凭据的 HTTP(S) 来源",
    );
  const secure = publicOrigin.protocol === "https:";
  if (!!env.FINE_LEDGER_TLS_CERT_FILE !== !!env.FINE_LEDGER_TLS_KEY_FILE)
    throw new Error("直连 TLS 需要同时配置证书和私钥文件");
  if (env.FINE_LEDGER_TLS_CERT_FILE && !secure)
    throw new Error("直连 TLS 的公开来源必须使用 HTTPS");
  if (
    !secure &&
    !["localhost", "127.0.0.1", "[::1]"].includes(publicOrigin.hostname)
  )
    throw new Error("局域网和正式部署必须使用 HTTPS 公开来源");
  return {
    host: env.FINE_LEDGER_HOST || "127.0.0.1",
    port: integer(env.FINE_LEDGER_PORT || 4181, 1, 65535, "端口"),
    publicOrigin: publicOrigin.origin,
    secure,
    tlsCertFile: env.FINE_LEDGER_TLS_CERT_FILE,
    tlsKeyFile: env.FINE_LEDGER_TLS_KEY_FILE,
    dataDir,
    databasePath: path.join(dataDir, "ledger.sqlite"),
    backupDir: path.resolve(
      env.FINE_LEDGER_BACKUP_DIR || path.join(dataDir, "backups"),
    ),
    passwordFile: env.FINE_LEDGER_PASSWORD_FILE,
    staticDir: path.resolve(env.FINE_LEDGER_STATIC_DIR || "public"),
    trustedProxies: (env.FINE_LEDGER_TRUSTED_PROXIES || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    sessionDays: integer(
      env.FINE_LEDGER_SESSION_DAYS || 30,
      1,
      365,
      "设备会话天数",
    ),
    bodyLimit: 32 * 1024 * 1024,
    defaults: {
      serviceName: env.FINE_LEDGER_SERVICE_NAME || "厘序同步服务",
      autoBackup: env.FINE_LEDGER_AUTO_BACKUP === "true",
      backupIntervalMinutes: integer(
        env.FINE_LEDGER_BACKUP_INTERVAL_MINUTES || 15,
        5,
        1440,
        "备份间隔",
      ),
      recentHours: 24,
      dailyDays: 14,
      weeklyWeeks: 4,
      manualKeep: 10,
    },
  };
}
export type ServiceConfig = ReturnType<typeof loadConfig>;
