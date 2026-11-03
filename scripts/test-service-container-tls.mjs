import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import https from "node:https";
import assert from "node:assert/strict";
import { containerImage } from "./container-version.mjs";
const image = process.argv[2] || containerImage(),
  name = "fine-ledger-tls-smoke-" + crypto.randomUUID(),
  volume = name + "-data";
const dir = await mkdtemp(path.join(tmpdir(), name)),
  cert = path.join(dir, "cert.pem"),
  key = path.join(dir, "key.pem"),
  pw = path.join(dir, "password");
const password = "Synthetic-TLS-container-password-123",
  origin = "https://ledger-container.test";
const docker = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 60000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
try {
  execFileSync(
    "openssl",
    [
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
      "/CN=ledger-container.test",
      "-addext",
      "subjectAltName=DNS:ledger-container.test",
    ],
    { stdio: "ignore" },
  );
  await writeFile(pw, password, { mode: 0o644 });
  await chmod(key, 0o644);
  const ca = await readFile(cert);
  docker(["volume", "create", volume]);
  docker([
    "run",
    "-d",
    "--name",
    name,
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt",
    "no-new-privileges:true",
    "-p",
    "127.0.0.1::4181",
    "-e",
    "FINE_LEDGER_PUBLIC_ORIGIN=" + origin,
    "-e",
    "FINE_LEDGER_PASSWORD_FILE=/run/password",
    "-e",
    "FINE_LEDGER_TLS_CERT_FILE=/run/cert.pem",
    "-e",
    "FINE_LEDGER_TLS_KEY_FILE=/run/key.pem",
    "-v",
    pw + ":/run/password:ro",
    "-v",
    cert + ":/run/cert.pem:ro",
    "-v",
    key + ":/run/key.pem:ro",
    "-v",
    volume + ":/data",
    image,
  ]);
  const port = JSON.parse(docker(["inspect", name]))[0].NetworkSettings.Ports[
    "4181/tcp"
  ][0].HostPort;
  const request = (route, body) =>
    new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "127.0.0.1",
          port,
          servername: "ledger-container.test",
          ca,
          path: route,
          method: body ? "POST" : "GET",
          timeout: 3000,
          headers: { origin, "content-type": "application/json" },
        },
        (res) => {
          let text = "";
          res.on("data", (x) => (text += x));
          res.on("end", () =>
            resolve({ status: res.statusCode, body: JSON.parse(text) }),
          );
        },
      );
      req.on("error", reject);
      req.on("timeout", () => req.destroy(Error("timeout")));
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      if ((await request("/healthz")).status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  assert(ready, "TLS container did not start");
  docker(["exec", name, "node", "server/healthcheck.mjs"]);
  assert.throws(() =>
    docker([
      "exec",
      "-e",
      "FINE_LEDGER_PUBLIC_ORIGIN=https://wrong-container.test",
      name,
      "node",
      "server/healthcheck.mjs",
    ]),
  );
  const login = await request("/api/v1/session", {
    password,
    deviceName: "TLS container smoke",
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.protocol, "fine-ledger-sync-v1");
  console.log(
    JSON.stringify(
      {
        image,
        result: "passed",
        events: [
          "direct HTTPS starts without a reverse proxy",
          "health probe verifies configured TLS certificate and domain",
          "wrong certificate domain fails the health probe",
          "same-origin HTTPS authentication works",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  try {
    docker(["rm", "-f", name]);
  } catch {}
  try {
    docker(["volume", "rm", volume]);
  } catch {}
  await rm(dir, { recursive: true, force: true });
}
