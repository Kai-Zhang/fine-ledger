import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createService } from "../server/app.ts";
import { loadConfig } from "../server/config.ts";
import { restoreBackup } from "../server/backup.ts";
import { setPassword } from "../server/auth.ts";
import { blankBook } from "../src/domain/ledger.ts";
import { digest, PROTOCOL } from "../server/protocol.ts";
import { spawnSync } from "node:child_process";
import { balance } from "../src/domain/ledger.ts";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

const password = "Synthetic-test-password-123";
function fixture() {
  const book = blankBook();
  book.accounts = ["a", "b"].map((id, order) => ({
    id,
    name: id,
    groupId: "daily",
    currency: "CNY",
    type: "bank",
    openingMinor: "9007199254740993",
    openingAt: book.createdAt,
    icon: "Wallet",
    order,
    archived: false,
    netWorth: true,
  }));
  return book;
}
const entry = (id, extra = {}) => ({
  id,
  kind: "expense",
  accountId: "a",
  amountMinor: "100",
  description: "合成测试",
  occurredAt: "2026-01-02T10:03:21.123456Z",
  createdAt: "2026-01-02T10:03:21Z",
  updatedAt: "2026-01-02T10:03:21Z",
  posted: true,
  splits: [{ id: "s", categoryId: "food-0", amountMinor: "100" }],
  revision: 0,
  ...extra,
});
async function setup(t, overrides = {}) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "fine-ledger-server-"),
  );
  const config = {
    ...loadConfig({ FINE_LEDGER_DATA_DIR: directory }),
    ...overrides,
  };
  const service = await createService(config, {
    initialPassword: password,
    timers: false,
  });
  t.after(async () => {
    await service.app.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { ...service, config, directory };
}
async function connect(
  app,
  origin = "http://localhost:4181",
  name = "测试设备",
) {
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/session",
    headers: { origin },
    payload: { password, deviceName: name },
  });
  assert.equal(r.statusCode, 200, r.body);
  return {
    csrf: r.json().csrf,
    deviceId: r.json().deviceId,
    cookie: r.headers["set-cookie"].split(";")[0],
    origin,
  };
}
const call = (app, auth, method, url, payload) =>
  app.inject({
    method,
    url,
    headers: {
      origin: auth.origin,
      cookie: auth.cookie,
      "x-csrf-token": auth.csrf,
      "content-type": "application/json",
    },
    ...(payload !== undefined ? { payload } : {}),
  });
async function initialize(
  service,
  auth,
  book = fixture(),
  op = crypto.randomUUID(),
) {
  const r = await call(service.app, auth, "POST", "/api/v1/ledger/initialize", {
    book,
    operationId: op,
    serverEpoch: service.store.epoch,
  });
  assert.equal(r.statusCode, 200, r.body);
  return book;
}
function command(store, book, changes, extra = {}) {
  const expected = new Map();
  const expect = (c, id) => {
    if (id)
      expected.set(`${c}/${id}`, {
        collection: c,
        id,
        version: store.version(c, id),
      });
  };
  for (const ch of changes) {
    expect(ch.collection, ch.id);
    if (ch.collection === "entries" && ch.value) {
      const e = ch.value;
      expect("accounts", e.accountId);
      expect("accounts", e.toAccountId);
      expect("entries", e.originalId);
      for (const s of e.splits) {
        expect("categories", s.categoryId);
        expect("projects", s.projectId);
      }
    }
  }
  return {
    operationId: crypto.randomUUID(),
    ledgerId: book.id,
    serverEpoch: store.epoch,
    expected: [...expected.values()],
    dependsOn: [],
    changes,
    ...extra,
  };
}
const push = (service, auth, ...commands) =>
  call(service.app, auth, "POST", "/api/v1/sync/push", {
    protocol: PROTOCOL,
    commands,
  });

test("same-origin PWA, secure sessions, authentication, CSRF and configurable deployment", async (t) => {
  const s = await setup(t, {
    publicOrigin: "https://ledger.example.test",
    secure: true,
  });
  assert.equal((await s.app.inject("/")).statusCode, 200);
  const m = (await s.app.inject("/api/v1/meta")).json();
  assert.equal(m.protocol, PROTOCOL);
  assert.equal(m.book, undefined);
  assert.equal((await s.app.inject("/api/v1/snapshot")).statusCode, 401);
  const wrong = await s.app.inject({
    method: "POST",
    url: "/api/v1/session",
    headers: { origin: "https://evil.test" },
    payload: { password, deviceName: "x" },
  });
  assert.equal(wrong.statusCode, 403);
  const r = await s.app.inject({
    method: "POST",
    url: "/api/v1/session",
    headers: { origin: s.config.publicOrigin },
    payload: { password, deviceName: "Safari" },
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.match(
    r.headers["set-cookie"],
    /__Host-fine-ledger=.*HttpOnly; SameSite=Strict;.*Secure/,
  );
  const auth = {
    origin: s.config.publicOrigin,
    deviceId: r.json().deviceId,
    cookie: r.headers["set-cookie"].split(";")[0],
    csrf: r.json().csrf,
  };
  assert.equal(
    (
      await call(
        s.app,
        { ...auth, csrf: "wrong" },
        "POST",
        "/api/v1/backups",
        {},
      )
    ).statusCode,
    403,
  );
  const st = (await call(s.app, auth, "GET", "/api/v1/settings")).json();
  assert.equal(st.settings.autoBackup, false);
  assert.equal(
    (
      await call(s.app, auth, "PATCH", "/api/v1/settings", {
        revision: st.settings.revision,
        backupIntervalMinutes: 0,
      })
    ).statusCode,
    400,
  );
  const changed = await call(s.app, auth, "PATCH", "/api/v1/settings", {
    revision: st.settings.revision,
    serviceName: "自托管账本",
    backupIntervalMinutes: 30,
  });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(
    (
      await call(s.app, auth, "PATCH", "/api/v1/settings", {
        revision: st.settings.revision,
        serviceName: "stale",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call(s.app, auth, "PATCH", "/api/v1/settings", {
        revision: 2,
        dataDir: "/tmp",
      })
    ).statusCode,
    400,
  );
  const disconnected = await call(s.app, auth, "DELETE", "/api/v1/session", {});
  assert.match(disconnected.headers["set-cookie"], /Max-Age=0/);
  assert.equal(
    s.store.db
      .prepare("SELECT revoked FROM devices WHERE id=?")
      .get(auth.deviceId).revoked,
    1,
  );
  assert.equal(
    s.store.db
      .prepare("SELECT count(*) AS n FROM sessions WHERE device_id=?")
      .get(auth.deviceId).n,
    0,
  );
  assert.equal(
    (await call(s.app, auth, "GET", "/api/v1/snapshot")).statusCode,
    401,
  );
});
test("snapshot initialization and idempotency survive response loss and process reopen", async (t) => {
  const s = await setup(t);
  const auth = await connect(s.app);
  const b = fixture(),
    op = crypto.randomUUID();
  await initialize(s, auth, b, op);
  await initialize(s, auth, b, op);
  assert.equal(s.store.cursor, 1);
  assert.equal(s.store.book().accounts[0].openingMinor, "9007199254740993");
  assert.equal(
    (
      await call(s.app, auth, "POST", "/api/v1/ledger/initialize", {
        book: fixture(),
        operationId: crypto.randomUUID(),
        serverEpoch: s.store.epoch,
      })
    ).statusCode,
    409,
  );
  const cmd = command(s.store, b, [
    { collection: "entries", id: "e", value: entry("e") },
  ]);
  const first = await push(s, auth, cmd),
    retry = await push(s, auth, JSON.parse(JSON.stringify(cmd)));
  assert.deepEqual(first.json(), retry.json());
  assert.equal(s.store.book().entries.length, 1);
  assert.equal(s.store.book().entries[0].occurredAt, entry("e").occurredAt);
  await s.app.close();
  const next = await createService(s.config, { timers: false });
  t.after(() => next.app.close());
  const again = await push(next, auth, cmd);
  assert.deepEqual(again.json(), first.json());
  assert.equal(next.store.cursor, 2);
  const snapshot = (
    await call(next.app, auth, "GET", "/api/v1/snapshot")
  ).json();
  const { checksum, ...data } = snapshot;
  assert.equal(checksum, digest(data));
});
test("concurrent edits preserve remote conflict, reused IDs reject and pull pages whole commits", async (t) => {
  const s = await setup(t),
    a = await connect(s.app),
    other = await connect(s.app, "http://localhost:4181", "另一设备"),
    b = await initialize(s, a);
  const ch = { collection: "entries", id: "e", value: entry("e") },
    one = command(s.store, b, [ch]),
    two = command(s.store, b, [
      {
        ...ch,
        value: entry("e", {
          amountMinor: "200",
          splits: [{ id: "s", categoryId: "food-0", amountMinor: "200" }],
        }),
      },
    ]);
  assert.equal((await push(s, a, one)).json().results[0].status, "committed");
  const conflict = (await push(s, other, two)).json().results[0];
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.remote[0].value.amountMinor, "100");
  assert.equal(
    (await push(s, a, { ...one, changes: two.changes })).statusCode,
    409,
  );
  const url = `/api/v1/sync/pull?ledgerId=${b.id}&serverEpoch=${s.store.epoch}&after=0&limit=1`;
  const p = (await call(s.app, a, "GET", url)).json();
  assert.equal(p.batches.length, 1);
  assert.equal(p.batches[0].changes.length, s.store.allChanges(b).length);
  assert.equal(p.hasMore, true);
  assert.deepEqual((await call(s.app, a, "GET", url)).json(), p);
});
test("transfer aggregate, FK references and invalid amounts roll back; rejected dependencies stay blocked", async (t) => {
  const s = await setup(t),
    a = await connect(s.app),
    b = await initialize(s, a);
  const bad = command(s.store, b, [
    {
      collection: "entries",
      id: "bad",
      value: entry("bad", {
        kind: "transfer",
        toAccountId: "b",
        receivedMinor: "99",
        splits: [],
      }),
    },
  ]);
  const r = (await push(s, a, bad)).json().results[0];
  assert.equal(r.status, "rejected");
  assert.equal(s.store.cursor, 1);
  assert.equal(s.store.book().entries.length, 0);
  const dep = command(
    s.store,
    b,
    [{ collection: "entries", id: "dep", value: entry("dep") }],
    { dependsOn: [bad.operationId] },
  );
  assert.equal((await push(s, a, dep)).json().results[0].status, "blocked");
  const fine = command(s.store, b, [
    { collection: "entries", id: "ok", value: entry("ok") },
  ]);
  assert.equal((await push(s, a, fine)).json().results[0].status, "committed");
  const remove = command(s.store, b, [
    { collection: "accounts", id: "a", value: null },
  ]);
  assert.equal((await push(s, a, remove)).json().results[0].status, "rejected");
  assert.equal(s.store.book().accounts.length, 2);
  assert.equal(s.store.db.prepare("PRAGMA foreign_key_check").all().length, 0);
});
test("independent refund amounts may exceed principal while account archive version conflicts remain protected", async (t) => {
  const s = await setup(t),
    a = await connect(s.app),
    b = await initialize(s, a);
  await push(
    s,
    a,
    command(s.store, b, [
      { collection: "entries", id: "e", value: entry("e") },
    ]),
  );
  const r1 = command(s.store, b, [
    {
      collection: "entries",
      id: "r1",
      value: entry("r1", {
        kind: "refund",
        originalId: "e",
        amountMinor: "80",
        splits: [{ id: "s", categoryId: "food-0", amountMinor: "80" }],
      }),
    },
  ]);
  const r2 = command(s.store, b, [
    {
      collection: "entries",
      id: "r2",
      value: entry("r2", {
        kind: "refund",
        originalId: "e",
        amountMinor: "80",
        splits: [{ id: "s", categoryId: "food-0", amountMinor: "80" }],
      }),
    },
  ]);
  await push(s, a, r1);
  assert.equal((await push(s, a, r2)).json().results[0].status, "committed");
  const pending = command(s.store, b, [
    { collection: "entries", id: "pending", value: entry("pending") },
  ]);
  await push(
    s,
    a,
    command(s.store, b, [
      {
        collection: "accounts",
        id: "a",
        value: {
          ...s.store.book().accounts.find((x) => x.id === "a"),
          archived: true,
        },
      },
    ]),
  );
  assert.equal(
    (await push(s, a, pending)).json().results[0].status,
    "conflict",
  );
});
test("consistent backup, checksum, epoch restoration and session revocation preserve current safety copy", async (t) => {
  const s = await setup(t),
    a = await connect(s.app),
    b = await initialize(s, a),
    oldEpoch = s.store.epoch;
  const saved = await s.backups.create();
  assert.equal((await s.backups.list()).length, 1);
  await push(
    s,
    a,
    command(s.store, b, [
      { collection: "entries", id: "new", value: entry("new") },
    ]),
  );
  await s.app.close();
  await restoreBackup(s.config, saved.id);
  const next = await createService(s.config, {
    initialPassword: password,
    timers: false,
  });
  t.after(() => next.app.close());
  assert.notEqual(next.store.epoch, oldEpoch);
  assert.equal(next.store.book().entries.length, 0);
  assert.equal(
    (await call(next.app, a, "GET", "/api/v1/snapshot")).statusCode,
    401,
  );
  const newAuth = await connect(next.app);
  const oldCommand = command(
    next.store,
    b,
    [{ collection: "entries", id: "new", value: entry("new") }],
    { serverEpoch: oldEpoch },
  );
  assert.equal(
    (await push(next, newAuth, oldCommand)).json().code,
    "EPOCH_CHANGED",
  );
  assert.ok(
    (await next.backups.list()).some((x) => x.kind === "before-restore"),
  );
  const filename = path.join(s.config.backupDir, saved.file);
  await writeFile(filename, "corrupted");
  await next.app.close();
  await assert.rejects(restoreBackup(s.config, saved.id), /校验值/);
});
test("single-instance lock, reset password and revoked devices cannot continue writing", async (t) => {
  const s = await setup(t),
    a = await connect(s.app),
    b = await connect(s.app);
  await assert.rejects(createService(s.config, { timers: false }), /已有服务/);
  assert.equal(
    (await call(s.app, a, "GET", "/api/v1/devices"))
      .json()
      .devices.find((d) => d.id === b.deviceId).connected,
    1,
  );
  await call(s.app, a, "DELETE", "/api/v1/devices/" + b.deviceId, {});
  assert.equal(
    (await call(s.app, a, "GET", "/api/v1/devices"))
      .json()
      .devices.find((d) => d.id === b.deviceId).connected,
    0,
  );
  assert.equal(
    (await call(s.app, b, "GET", "/api/v1/snapshot")).statusCode,
    401,
  );
  await setPassword(s.store, "Another-test-password-123");
  assert.equal(
    (await call(s.app, a, "GET", "/api/v1/session")).statusCode,
    401,
  );
});
test("configuration rejects insecure LAN origins and embedded paths; login attempts are paced", async (t) => {
  assert.throws(
    () => loadConfig({ FINE_LEDGER_PUBLIC_ORIGIN: "http://example.test" }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      loadConfig({ FINE_LEDGER_PUBLIC_ORIGIN: "https://example.test/path" }),
    /无路径/,
  );
  const s = await setup(t);
  for (let i = 0; i < 5; i++) {
    const r = await s.app.inject({
      method: "POST",
      url: "/api/v1/session",
      headers: { origin: s.config.publicOrigin },
      payload: { password: "invalid", deviceName: "x" },
    });
    assert.equal(r.statusCode, 401);
  }
  const blocked = await s.app.inject({
    method: "POST",
    url: "/api/v1/session",
    headers: { origin: s.config.publicOrigin },
    payload: { password, deviceName: "x" },
  });
  assert.equal(blocked.statusCode, 429);
});
test("scheduled backup is opt-in, skips unchanged data, and reports inaccessible local storage", async (t) => {
  const s = await setup(t),
    auth = await connect(s.app);
  await initialize(s, auth);
  assert.equal(await s.backups.tick(), null);
  s.store.setMeta("settings", {
    ...s.store.getMeta("settings"),
    autoBackup: true,
  });
  const first = await s.backups.tick();
  assert.equal(first.kind, "automatic");
  assert.equal(await s.backups.tick(), null);
  assert.equal((await s.backups.list()).length, 1);
  const blocked = path.join(s.directory, "not-a-directory");
  await writeFile(blocked, "blocked");
  const original = s.config.backupDir;
  s.config.backupDir = blocked;
  await assert.rejects(s.backups.create());
  assert.ok(s.store.getMeta("backupStatus").lastFailure);
  s.config.backupDir = original;
  assert.equal((await s.backups.list()).length, 1);
});

test("expired sessions and forged CSRF cannot read or mutate protected data", async (t) => {
  const s = await setup(t),
    a = await connect(s.app);
  await initialize(s, a);
  assert.equal(
    (
      await call(s.app, { ...a, csrf: "forged" }, "PATCH", "/api/v1/settings", {
        revision: 1,
        serviceName: "not applied",
      })
    ).statusCode,
    403,
  );
  assert.equal(s.store.getMeta("settings").revision, 1);
  s.store.db
    .prepare("UPDATE sessions SET expires=? WHERE device_id=?")
    .run(Date.now() - 1, a.deviceId);
  assert.equal(
    (await call(s.app, a, "GET", "/api/v1/snapshot")).statusCode,
    401,
  );
  assert.equal(
    (await call(s.app, a, "POST", "/api/v1/backups", {})).statusCode,
    401,
  );
  assert.equal((await s.backups.list()).length, 0);
});

test("invalid snapshots never initialize partial rows; exact dates, IDs and amounts are checked", async (t) => {
  const s = await setup(t),
    a = await connect(s.app);
  const cases = [
    (b) => b.accounts.push({ ...b.accounts[0] }),
    (b) => (b.accounts[0].groupId = "missing"),
    (b) => (b.accounts[0].openingMinor = 0.1),
    (b) => (b.accounts[0].openingAt = "not-a-date"),
    (b) => (b.categories[0].parentId = b.categories[0].id),
    (b) => b.entries.push(entry("bad", { amountMinor: "101" })),
    (b) =>
      b.entries.push(
        entry("bad", {
          amountMinor: "100",
          splits: [{ id: "s", categoryId: "missing", amountMinor: "100" }],
        }),
      ),
  ];
  for (const mutate of cases) {
    const b = fixture();
    mutate(b);
    const r = await call(s.app, a, "POST", "/api/v1/ledger/initialize", {
      book: b,
      operationId: crypto.randomUUID(),
      serverEpoch: s.store.epoch,
    });
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(s.store.book(), null);
    assert.equal(s.store.cursor, 0);
  }
});

test("device appearance is excluded, saved report and fractional timestamps survive snapshots", async (t) => {
  const s = await setup(t),
    a = await connect(s.app),
    b = fixture();
  b.settings.theme = "dark";
  b.settings.savedReports = [
    {
      id: "report",
      name: "合成报告",
      type: "expense",
      days: "30",
      from: "",
      to: "",
      accountIds: ["a"],
      categoryIds: ["food-0"],
    },
  ];
  b.entries = [entry("exact")];
  await initialize(s, a, b);
  const snap = (await call(s.app, a, "GET", "/api/v1/snapshot")).json();
  assert.equal(snap.book.settings.theme, "system");
  assert.deepEqual(snap.book.settings.savedReports, b.settings.savedReports);
  assert.equal(snap.book.entries[0].occurredAt, "2026-01-02T10:03:21.123456Z");
});

test("SQL failure after partial writes rolls back entry, split, revision, receipt and cursor together", async (t) => {
  const s = await setup(t),
    a = await connect(s.app),
    b = await initialize(s, a);
  const cmd = command(s.store, b, [
    { collection: "entries", id: "fault", value: entry("fault") },
  ]);
  s.store.db.exec(
    "CREATE TRIGGER injected_failure BEFORE INSERT ON splits BEGIN SELECT RAISE(ABORT,'injected write failure'); END;",
  );
  assert.equal((await push(s, a, cmd)).statusCode, 500);
  assert.equal(s.store.book().entries.length, 0);
  assert.equal(s.store.version("entries", "fault"), 0);
  assert.equal(s.store.cursor, 1);
  assert.equal(
    s.store.db
      .prepare("SELECT COUNT(*) AS n FROM receipts WHERE operation_id=?")
      .get(cmd.operationId).n,
    0,
  );
  assert.equal(
    s.store.db
      .prepare("SELECT COUNT(*) AS n FROM revisions WHERE id=?")
      .get("fault").n,
    0,
  );
  s.store.db.exec("DROP TRIGGER injected_failure");
  assert.equal((await push(s, a, cmd)).json().results[0].status, "committed");
  assert.equal(s.store.book().entries.length, 1);
});

test("blocked dependent request can safely retry unchanged once predecessor is committed", async (t) => {
  const s = await setup(t),
    a = await connect(s.app),
    b = await initialize(s, a);
  const parent = command(s.store, b, [
    {
      collection: "projects",
      id: "new-project",
      value: { id: "new-project", name: "合成项目", archived: false },
    },
  ]);
  const child = command(
    s.store,
    b,
    [
      {
        collection: "entries",
        id: "dependent",
        value: entry("dependent", {
          splits: [
            {
              id: "s",
              categoryId: "food-0",
              projectId: "new-project",
              amountMinor: "100",
            },
          ],
        }),
      },
    ],
    { dependsOn: [parent.operationId] },
  );
  child.expected.find((e) => e.collection === "projects").version = 1;
  assert.equal((await push(s, a, child)).json().results[0].status, "blocked");
  assert.equal(
    (await push(s, a, parent)).json().results[0].status,
    "committed",
  );
  assert.equal((await push(s, a, child)).json().results[0].status, "committed");
  assert.equal((await push(s, a, child)).json().results[0].status, "committed");
  assert.equal(s.store.book().entries.length, 1);
});

test("concurrent devices and duplicate submissions have exact balances and gap-free cursors", async (t) => {
  const s = await setup(t),
    a = await connect(s.app),
    other = await connect(s.app),
    b = await initialize(s, a);
  const commands = Array.from({ length: 25 }, (_, i) =>
    command(s.store, b, [
      {
        collection: "entries",
        id: "parallel-" + i,
        value: entry("parallel-" + i),
      },
    ]),
  );
  const replies = await Promise.all(
    commands.flatMap((c, i) => [
      push(s, i % 2 ? a : other, c),
      push(s, i % 2 ? other : a, c),
    ]),
  );
  for (const r of replies)
    assert.equal(r.json().results[0].status, "committed", r.body);
  assert.equal(s.store.book().entries.length, 25);
  assert.equal(balance(s.store.book(), "a"), 9007199254740993n - 2500n);
  assert.equal(s.store.cursor, 26);
  let after = 0,
    seen = [];
  while (true) {
    const p = s.store.pull(s.store.epoch, b.id, after, 4);
    seen.push(...p.batches.map((x) => x.cursor));
    after = p.nextCursor;
    if (!p.hasMore) break;
  }
  assert.deepEqual(
    seen,
    Array.from({ length: 26 }, (_, i) => i + 1),
  );
});

test("commit remains durable after SIGKILL without graceful close, and receipt retries stay idempotent", async (t) => {
  const s = await setup(t),
    a = await connect(s.app),
    b = await initialize(s, a);
  const cmd = command(s.store, b, [
    { collection: "entries", id: "crash", value: entry("crash") },
  ]);
  await s.app.close();
  const input = path.join(s.directory, "crash-input.json");
  await writeFile(input, JSON.stringify({ config: s.config, cmd }));
  const source = `import {readFileSync} from 'node:fs'; import {Store} from './server/store.ts'; const {config,cmd}=JSON.parse(readFileSync(process.argv[1],'utf8')); const store=new Store(config); const result=store.push(cmd,'crash-test'); process.stdout.write(JSON.stringify(result),()=>process.kill(process.pid,'SIGKILL'));`;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", source, input],
    { cwd: process.cwd(), encoding: "utf8", timeout: 15000 },
  );
  assert.equal(child.signal, "SIGKILL", child.stderr);
  const committed = JSON.parse(child.stdout);
  assert.equal(committed.status, "committed");
  const reopened = await createService(s.config, { timers: false });
  t.after(() => reopened.app.close());
  assert.equal(reopened.store.book().entries.length, 1);
  assert.deepEqual((await push(reopened, a, cmd)).json().results[0], committed);
  assert.equal(
    reopened.store.db.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
});

test("retention keeps recent and spaced historical automatic backups and bounds manual copies", async (t) => {
  const s = await setup(t),
    a = await connect(s.app);
  await initialize(s, a);
  s.store.setMeta("settings", {
    ...s.store.getMeta("settings"),
    manualKeep: 2,
  });
  for (let i = 0; i < 5; i++) await s.backups.create("manual");
  assert.equal(
    (await s.backups.list()).filter((x) => x.kind === "manual").length,
    2,
  );
  const ancient = await s.backups.create("automatic");
  ancient.createdAt = new Date(Date.now() - 60 * 86400000).toISOString();
  await writeFile(
    path.join(s.config.backupDir, ancient.id + ".json"),
    JSON.stringify(ancient),
  );
  await s.backups.create("automatic");
  const retained = await s.backups.list();
  assert.ok(!retained.some((x) => x.id === ancient.id));
  assert.ok(retained.some((x) => x.kind === "automatic"));
});

test("valid checksum cannot hide corrupt foreign keys during restore; current ledger remains intact", async (t) => {
  const s = await setup(t),
    a = await connect(s.app),
    b = await initialize(s, a);
  const saved = await s.backups.create();
  const filename = path.join(s.config.backupDir, saved.file);
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys=OFF");
  db.prepare("UPDATE accounts SET group_id='missing' WHERE id='a'").run();
  db.close();
  saved.checksum = createHash("sha256")
    .update(await readFile(filename))
    .digest("hex");
  await writeFile(
    path.join(s.config.backupDir, saved.id + ".json"),
    JSON.stringify(saved),
  );
  await s.app.close();
  await assert.rejects(restoreBackup(s.config, saved.id), /完整性/);
  const reopened = await createService(s.config, { timers: false });
  t.after(() => reopened.app.close());
  assert.equal(reopened.store.book().id, b.id);
  assert.equal(
    reopened.store.db.prepare("PRAGMA foreign_key_check").all().length,
    0,
  );
});

test("oversized and malformed requests are bounded, reference preconditions are required", async (t) => {
  const s = await setup(t, { bodyLimit: 32768 }),
    a = await connect(s.app);
  const huge = await call(s.app, a, "POST", "/api/v1/ledger/initialize", {
    padding: "x".repeat(40000),
  });
  assert.equal(huge.statusCode, 413);
  const malformed = await s.app.inject({
    method: "POST",
    url: "/api/v1/sync/push",
    headers: {
      origin: a.origin,
      cookie: a.cookie,
      "x-csrf-token": a.csrf,
      "content-type": "application/json",
    },
    payload: "{",
  });
  assert.equal(malformed.statusCode, 400);
  const b = await initialize(s, a);
  const cmd = command(s.store, b, [
    {
      collection: "entries",
      id: "no-reference-version",
      value: entry("no-reference-version"),
    },
  ]);
  cmd.expected = cmd.expected.filter((x) => x.collection === "entries");
  assert.equal((await push(s, a, cmd)).statusCode, 400);
  assert.equal(s.store.cursor, 1);
  assert.throws(
    () => loadConfig({ FINE_LEDGER_TLS_CERT_FILE: "/tmp/one" }),
    /同时/,
  );
  assert.throws(
    () =>
      loadConfig({
        FINE_LEDGER_TLS_CERT_FILE: "/tmp/one",
        FINE_LEDGER_TLS_KEY_FILE: "/tmp/two",
      }),
    /HTTPS/,
  );
});

test("deletion retains a transaction tombstone and replay cannot subtract balance twice", async (t) => {
  const s = await setup(t),
    a = await connect(s.app),
    b = await initialize(s, a);
  await push(
    s,
    a,
    command(s.store, b, [
      { collection: "entries", id: "deleted", value: entry("deleted") },
    ]),
  );
  const direct = command(s.store, b, [
    { collection: "entries", id: "deleted", value: null },
  ]);
  assert.equal((await push(s, a, direct)).json().results[0].status, "rejected");
  const saved = s.store.book().entries[0],
    cmd = command(s.store, b, [
      {
        collection: "entries",
        id: "deleted",
        value: { ...saved, deletedAt: "2026-10-31T00:00:00Z" },
      },
    ]);
  const first = await push(s, a, cmd),
    retry = await push(s, a, cmd);
  assert.deepEqual(retry.json(), first.json());
  assert.equal(s.store.book().entries.length, 1);
  assert.equal(s.store.book().entries[0].deletedAt, "2026-10-31T00:00:00Z");
  assert.equal(balance(s.store.book(), "a"), 9007199254740993n);
  assert.equal(
    s.store.pull(s.store.epoch, b.id, 2, 1).batches[0].changes[0].value
      .deletedAt,
    "2026-10-31T00:00:00Z",
  );
});

test("stale initialization epoch and ledger identity never replace a remote book", async (t) => {
  const s = await setup(t),
    a = await connect(s.app),
    b = fixture();
  const r = await call(s.app, a, "POST", "/api/v1/ledger/initialize", {
    book: b,
    operationId: crypto.randomUUID(),
    serverEpoch: "outdated",
  });
  assert.equal(r.json().code, "EPOCH_CHANGED");
  assert.equal(s.store.book(), null);
  await initialize(s, a, b);
  const cmd = command(
    s.store,
    b,
    [
      {
        collection: "entries",
        id: "wrong-ledger",
        value: entry("wrong-ledger"),
      },
    ],
    { ledgerId: crypto.randomUUID() },
  );
  assert.equal((await push(s, a, cmd)).json().code, "LEDGER_CHANGED");
  assert.equal(s.store.cursor, 1);
});

test("TLS initialization failure releases the instance lock for a corrected startup", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "fine-ledger-tls-test-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cert = path.join(directory, "bad-cert.pem"),
    key = path.join(directory, "bad-key.pem");
  await writeFile(cert, "invalid");
  await writeFile(key, "invalid");
  const config = loadConfig({
    FINE_LEDGER_DATA_DIR: directory,
    FINE_LEDGER_PUBLIC_ORIGIN: "https://ledger.example.test",
    FINE_LEDGER_TLS_CERT_FILE: cert,
    FINE_LEDGER_TLS_KEY_FILE: key,
  });
  await assert.rejects(
    createService(config, { initialPassword: password, timers: false }),
  );
  const corrected = await createService(
    { ...config, tlsCertFile: undefined, tlsKeyFile: undefined },
    { timers: false },
  );
  await corrected.app.close();
});

test("backup deletion and undo are authenticated, idempotent, reversible and do not change the ledger", async (t) => {
  const s = await setup(t),
    auth = await connect(s.app);
  await initialize(s, auth);
  const first = await s.backups.create(),
    second = await s.backups.create();
  const epoch = s.store.epoch,
    cursor = s.store.cursor,
    book = s.store.book();
  const file = path.join(s.config.backupDir, first.id + ".sqlite"),
    bytes = await readFile(file);
  const url = "/api/v1/backups/" + first.id;
  assert.equal(
    (
      await s.app.inject({
        method: "DELETE",
        url,
        headers: { origin: auth.origin, "content-type": "application/json" },
        payload: {},
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (await call(s.app, { ...auth, csrf: "forged" }, "DELETE", url, {}))
      .statusCode,
    403,
  );
  assert.equal(
    (await call(s.app, auth, "DELETE", "/api/v1/backups/invalid", {}))
      .statusCode,
    400,
  );
  assert.equal(
    (await call(s.app, auth, "DELETE", "/api/v1/backups/backup-missing", {}))
      .statusCode,
    404,
  );
  const removed = await call(s.app, auth, "DELETE", url, {});
  assert.equal(removed.statusCode, 200, removed.body);
  assert.ok(removed.json().undoUntil > Date.now());
  assert.deepEqual(
    (await call(s.app, auth, "DELETE", url, {})).json(),
    removed.json(),
  );
  assert.deepEqual(
    (await s.backups.list()).map((b) => b.id),
    [second.id],
  );
  assert.deepEqual(await readFile(file), bytes);
  await s.backups.prune();
  assert.deepEqual(await readFile(file), bytes);
  await assert.rejects(
    restoreBackup(s.config, first.id),
    (e) => e.code === "BACKUP_DELETED",
  );
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await call(s.app, auth, "POST", url + "/undo-delete", {})).statusCode,
      200,
    );
  assert.equal((await s.backups.list()).length, 2);
  assert.deepEqual(await readFile(file), bytes);
  assert.deepEqual(s.store.book(), book);
  assert.equal(s.store.epoch, epoch);
  assert.equal(s.store.cursor, cursor);
});
test("deleted backup markers survive restart and expire without enabling automatic backups", async (t) => {
  const s = await setup(t),
    auth = await connect(s.app);
  await initialize(s, auth);
  const saved = await s.backups.create();
  await s.backups.remove(saved.id);
  await s.app.close();
  const next = await createService(s.config, { timers: false });
  t.after(() => next.app.close());
  assert.equal((await next.backups.list()).length, 0);
  await next.backups.undoDelete(saved.id);
  assert.equal((await next.backups.list()).length, 1);
  await next.backups.remove(saved.id);
  const marker = path.join(s.config.backupDir, saved.id + ".deleted.json");
  await writeFile(
    marker,
    JSON.stringify({ id: saved.id, deletedAt: Date.now() - 86400001 }),
  );
  await assert.rejects(
    next.backups.undoDelete(saved.id),
    (e) => e.code === "BACKUP_DELETE_EXPIRED",
  );
  assert.equal(next.store.getMeta("settings").autoBackup, false);
  await next.backups.tick();
  await assert.rejects(
    readFile(path.join(s.config.backupDir, saved.id + ".sqlite")),
    (e) => e.code === "ENOENT",
  );
  await assert.rejects(readFile(marker), (e) => e.code === "ENOENT");
  assert.equal((await next.backups.list()).length, 0);
});
test("creating, deleting, undoing and pruning backups serialize without losing a restorable copy", async (t) => {
  const s = await setup(t),
    auth = await connect(s.app);
  await initialize(s, auth);
  const one = await s.backups.create();
  await Promise.all([
    s.backups.create(),
    s.backups.remove(one.id),
    s.backups.undoDelete(one.id),
    s.backups.prune(),
  ]);
  const rows = await s.backups.list();
  assert.equal(rows.length, 2);
  assert.ok(rows.some((b) => b.id === one.id));
  for (const b of rows)
    assert.equal(
      createHash("sha256")
        .update(await readFile(path.join(s.config.backupDir, b.file)))
        .digest("hex"),
      b.checksum,
    );
});
