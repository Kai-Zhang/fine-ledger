import test from "node:test";
import assert from "node:assert/strict";
import { serviceRequest } from "../src/sync/service.ts";
test("worker offline fallback and HTML responses cannot masquerade as a successful service connection", async (t) => {
  const fetch = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("Offline resource unavailable", { status: 503 }),
  );
  await assert.rejects(serviceRequest("session"), /无法连接远端/);
  fetch.mock.mockImplementation(
    async () => new Response("<!doctype html><h1>厘序</h1>", { status: 200 }),
  );
  await assert.rejects(
    serviceRequest("session"),
    (e) => e.code === "INVALID_SERVICE_RESPONSE",
  );
});
test("authentication errors preserve status and server code so the UI can remove stale session controls", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      { code: "AUTH_REQUIRED", message: "设备会话已失效" },
      { status: 401 },
    ),
  );
  await assert.rejects(
    serviceRequest("session"),
    (e) =>
      e.status === 401 &&
      e.code === "AUTH_REQUIRED" &&
      e.message === "设备会话已失效",
  );
});
test("aborted page loads keep their cancellation signal and network failures get a usable retry message", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Load failed");
  });
  await assert.rejects(serviceRequest("snapshot"), /请检查网络后重试/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    serviceRequest("session", { signal: controller.signal }),
    (e) => e.message === "Load failed",
  );
});
