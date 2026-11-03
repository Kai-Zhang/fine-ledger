import http from "node:http";
import https from "node:https";
import { readFile } from "node:fs/promises";
import { checkServerIdentity } from "node:tls";
const certFile = process.env.FINE_LEDGER_TLS_CERT_FILE;
const host = process.env.FINE_LEDGER_HOST || "127.0.0.1";
const localHost =
  host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
try {
  const name = new URL(
    process.env.FINE_LEDGER_PUBLIC_ORIGIN || "http://localhost:4181",
  ).hostname;
  const options = {
    hostname: localHost,
    port: Number(process.env.FINE_LEDGER_PORT || 4181),
    path: "/healthz",
    timeout: 4000,
    ...(certFile
      ? {
          servername: name,
          ca: await readFile(certFile),
          allowPartialTrustChain: true,
          checkServerIdentity: (_host, cert) => checkServerIdentity(name, cert),
        }
      : {}),
  };
  await new Promise((resolve, reject) => {
    const req = (certFile ? https : http).get(options, (res) => {
      res.resume();
      res.on("end", () =>
        res.statusCode === 200 ? resolve() : reject(Error("Unhealthy status")),
      );
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(Error("Health timeout")));
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
