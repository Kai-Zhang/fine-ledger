import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { exampleBook } from "../src/domain/example.ts";
import { containerImage } from "./container-version.mjs";

// Only disposable, uniquely named containers/volumes and synthetic credentials.
const image = process.argv[2] || containerImage();
const suffix = crypto.randomUUID();
const name = "fine-ledger-smoke-" + suffix;
const volume = name + "-data";
const directory = await mkdtemp(path.join(tmpdir(), name));
const passwordFile = path.join(directory, "synthetic-password");
const password = "Synthetic-container-test-password-123";
await writeFile(passwordFile, password, { mode: 0o644 });
const docker = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 60000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const origin = "http://localhost:4181";
let base,
  cookie = "",
  csrf = "";
const events = [];
async function api(url, method = "GET", payload) {
  const response = await fetch(base + url, {
    method,
    headers: {
      origin,
      cookie,
      "content-type": "application/json",
      "x-csrf-token": csrf,
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  return { response, data };
}
async function ready() {
  const binding = JSON.parse(docker(["inspect", name]))[0].NetworkSettings
    .Ports["4181/tcp"][0];
  base = "http://127.0.0.1:" + binding.HostPort;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await api("/healthz");
      if (r.response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw Error("Container did not become ready: " + docker(["logs", name]));
}
const configArgs = [
  "-e",
  "FINE_LEDGER_PUBLIC_ORIGIN=" + origin,
  "-e",
  "FINE_LEDGER_PASSWORD_FILE=/run/access-password",
  "-v",
  passwordFile + ":/run/access-password:ro",
  "-v",
  volume + ":/data",
];
try {
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
    ...configArgs,
    image,
  ]);
  const binding = JSON.parse(docker(["inspect", name]))[0].NetworkSettings
    .Ports["4181/tcp"][0];
  base = "http://127.0.0.1:" + binding.HostPort;
  await ready();
  docker(["exec", name, "node", "server/healthcheck.mjs"]);
  events.push("non-root read-only container startup and HTTP health probe");
  const login = await api("/api/v1/session", "POST", {
    password,
    deviceName: "container-smoke",
  });
  assert.equal(login.response.status, 200);
  cookie = login.response.headers.get("set-cookie").split(";")[0];
  csrf = login.data.csrf;
  const book = exampleBook(),
    operationId = crypto.randomUUID();
  const init = { book, operationId, serverEpoch: login.data.serverEpoch };
  const created = await api("/api/v1/ledger/initialize", "POST", init);
  assert.equal(created.response.status, 200, JSON.stringify(created.data));
  const retried = await api("/api/v1/ledger/initialize", "POST", init);
  assert.deepEqual(retried.data, created.data);
  events.push("same-origin login and idempotent synthetic initialization");
  const snapshot = await api("/api/v1/snapshot");
  assert.equal(snapshot.data.book.entries.length, book.entries.length);
  const saved = await api("/api/v1/backups", "POST", {});
  assert.equal(saved.response.status, 200);
  events.push("SQLite consistent backup in persistent volume");
  docker(["restart", name]);
  await ready();
  const reopened = await api("/api/v1/snapshot");
  assert.equal(reopened.data.book.id, book.id);
  assert.equal(reopened.data.cursor, snapshot.data.cursor);
  events.push("container restart preserves ledger, cursor and session");
  docker(["stop", name]);
  docker([
    "run",
    "--rm",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt",
    "no-new-privileges:true",
    ...configArgs,
    image,
    "node",
    "server/main.ts",
    "restore",
    saved.data.id,
  ]);
  docker(["start", name]);
  await ready();
  assert.equal((await api("/api/v1/snapshot")).response.status, 401);
  const newSession = await api("/api/v1/session", "POST", {
    password,
    deviceName: "after-restore",
  });
  assert.equal(newSession.response.status, 200);
  assert.notEqual(newSession.data.serverEpoch, init.serverEpoch);
  events.push("offline restore changes epoch and revokes old sessions");
  console.log(JSON.stringify({ image, result: "passed", events }, null, 2));
} finally {
  try {
    docker(["rm", "-f", name]);
  } catch {}
  try {
    docker(["volume", "rm", volume]);
  } catch {}
  await rm(directory, { recursive: true, force: true });
}
