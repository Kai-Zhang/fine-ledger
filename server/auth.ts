import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt as derive,
  timingSafeEqual,
} from "node:crypto";
import type { Store } from "./store.ts";
import { ApiError, ensure, text } from "./protocol.ts";

const scrypt = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    derive(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function passwordHash(password: string) {
  text(password, "访问密码", 1024);
  ensure(password.length >= 12, "访问密码至少 12 个字符");
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt);
  return { salt, key: key.toString("hex") };
}
export async function setPassword(store: Store, password: string) {
  const record = await passwordHash(password);
  store.transaction(() => {
    store.setMeta("password", record);
    store.db.exec(
      "DELETE FROM sessions; DELETE FROM login_limits; UPDATE devices SET revoked=1;",
    );
  });
}
export async function login(
  store: Store,
  password: unknown,
  name: unknown,
  ip: string,
) {
  text(password, "访问密码", 1024);
  text(name, "设备名称", 100);
  const now = Date.now();
  // A global budget also bounds expensive scrypt work when clients rotate addresses.
  const keys = ["all", hash(ip)];
  const blocked = keys.some((k) => {
    const row = store.db
      .prepare("SELECT * FROM login_limits WHERE key=?")
      .get(k);
    return (
      row &&
      Number(row.until_at) > now &&
      Number(row.failures) >= (k === "all" ? 30 : 5)
    );
  });
  if (blocked)
    throw new ApiError(
      429,
      "LOGIN_RATE_LIMIT",
      "登录尝试过多，请十五分钟后重试",
    );
  store.transaction(() => {
    for (const key of keys)
      store.db
        .prepare(
          "INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN until_at<? THEN 1 ELSE failures+1 END,until_at=CASE WHEN until_at<? THEN excluded.until_at ELSE until_at END",
        )
        .run(key, now + 15 * 60000, now, now);
  });
  const saved = store.getMeta<{ salt: string; key: string }>("password");
  if (!saved) throw new ApiError(503, "SETUP_REQUIRED", "服务尚未设置访问密码");
  const key = await scrypt(password, saved.salt);
  if (!timingSafeEqual(key, Buffer.from(saved.key, "hex")))
    throw new ApiError(401, "INVALID_PASSWORD", "访问密码不正确");
  // Never allow an in-flight login with the old password to outlive a reset.
  if (store.getMeta<any>("password").key !== saved.key)
    throw new ApiError(401, "PASSWORD_CHANGED", "访问密码已变更");
  const token = randomBytes(32).toString("base64url"),
    csrf = randomBytes(32).toString("base64url"),
    deviceId = randomUUID();
  const expires = now + store.config.sessionDays * 86400000;
  store.transaction(() => {
    store.db.prepare("DELETE FROM login_limits WHERE key=?").run(hash(ip));
    store.db.prepare("DELETE FROM sessions WHERE expires<?").run(now);
    store.db
      .prepare("INSERT INTO devices VALUES(?,?,?,?,0)")
      .run(deviceId, name, now, now);
    store.db
      .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
      .run(hash(token), deviceId, csrf, expires);
  });
  return { token, csrf, deviceId, expires };
}
export function session(store: Store, cookie: string | undefined) {
  const name = store.config.secure ? "__Host-fine-ledger" : "fine-ledger-dev";
  const token = cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + "="))
    ?.slice(name.length + 1);
  if (!token || !/^[\w-]{43}$/.test(token))
    throw new ApiError(401, "AUTH_REQUIRED", "请先登录同步服务");
  const result = store.db
    .prepare(
      "SELECT sessions.*,devices.name FROM sessions JOIN devices ON devices.id=device_id WHERE hash=? AND expires>? AND revoked=0",
    )
    .get(hash(token), Date.now());
  if (!result)
    throw new ApiError(401, "AUTH_REQUIRED", "设备会话已失效，请重新登录");
  return result as unknown as {
    hash: string;
    device_id: string;
    csrf: string;
    expires: number;
    name: string;
  };
}
export function cookie(store: Store, token: string, maxAge: number) {
  return `${store.config.secure ? "__Host-fine-ledger" : "fine-ledger-dev"}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${store.config.secure ? "; Secure" : ""}`;
}
