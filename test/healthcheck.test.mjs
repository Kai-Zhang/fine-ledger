import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createService } from "../server/app.ts";
import { loadConfig } from "../server/config.ts";
const exec = promisify(execFile);
async function fixture(t, tls) {
  const dir = await mkdtemp(path.join(tmpdir(), "fine-health-"));
  let cert, key;
  if (tls) {
    cert = path.join(dir, "cert.pem");
    key = path.join(dir, "key.pem");
    await exec("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=ledger-health.test",
      "-addext",
      "subjectAltName=DNS:ledger-health.test",
    ]);
  }
  const config = loadConfig({
    FINE_LEDGER_DATA_DIR: dir,
    FINE_LEDGER_PUBLIC_ORIGIN: tls
      ? "https://ledger-health.test"
      : "http://localhost:4181",
    ...(tls
      ? { FINE_LEDGER_TLS_CERT_FILE: cert, FINE_LEDGER_TLS_KEY_FILE: key }
      : {}),
  });
  const service = await createService(config, {
    initialPassword: "Synthetic-health-password-123",
    timers: false,
  });
  t.after(async () => {
    await service.app.close();
    await rm(dir, { recursive: true, force: true });
  });
  await service.app.listen({ host: "127.0.0.1", port: 0 });
  return {
    env: {
      ...process.env,
      FINE_LEDGER_HOST: "127.0.0.1",
      FINE_LEDGER_PORT: String(service.app.server.address().port),
      FINE_LEDGER_PUBLIC_ORIGIN: config.publicOrigin,
      FINE_LEDGER_TLS_CERT_FILE: cert || "",
    },
  };
}
test("container health probe supports plain HTTP upstream without relying on the public DNS route", async (t) => {
  const { env } = await fixture(t, false);
  await exec(process.execPath, ["server/healthcheck.mjs"], { env });
});
test("direct HTTPS health probe trusts only the configured certificate and verifies its domain", async (t) => {
  const { env } = await fixture(t, true);
  await exec(process.execPath, ["server/healthcheck.mjs"], { env });
  await assert.rejects(
    exec(process.execPath, ["server/healthcheck.mjs"], {
      env: { ...env, FINE_LEDGER_PUBLIC_ORIGIN: "https://wrong-health.test" },
    }),
    /does not match certificate/,
  );
});
