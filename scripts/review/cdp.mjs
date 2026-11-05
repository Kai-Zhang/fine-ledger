export async function connect(url = "about:blank", targetId) {
  const info = targetId
    ? (await (await fetch("http://127.0.0.1:9337/json/list")).json()).find(
        (t) => t.id === targetId,
      )
    : await (
        await fetch(
          "http://127.0.0.1:9337/json/new?" + encodeURIComponent("about:blank"),
          { method: "PUT" },
        )
      ).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map(),
    events = [];
  ws.addEventListener("message", ({ data }) => {
    const result = JSON.parse(data);
    if (result.id) {
      const p = pending.get(result.id);
      pending.delete(result.id);
      if (result.error) p.reject(Error(JSON.stringify(result.error)));
      else p.resolve(result.result);
    } else events.push(result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.enable");
  // Freeze calendar time, not performance.now(), so fixture totals and date
  // filters remain reproducible after the review date. This isolated browser
  // hook never ships in the application bundle.
  if (!targetId) {
    const at = Date.parse(process.env.REVIEW_TIME || "2026-11-06T04:00:00Z");
    if (!Number.isFinite(at)) throw Error("Invalid REVIEW_TIME");
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => { const NativeDate = Date; window.Date = new Proxy(NativeDate, {
        construct(target, args) { return Reflect.construct(target, args.length ? args : [${at}]); },
        apply() { return new NativeDate(${at}).toString(); },
        get(target, key) { return key === 'now' ? () => ${at} : Reflect.get(target, key); }
      }); })();`,
    });
  }
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const wait = async (expression, timeout = 20000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        if (await evaluate(expression)) return;
      } catch (e) {
        if (!/navigated|context|Cannot find/.test(e.message)) throw e;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error("Timeout: " + expression);
  };
  if (!targetId && url !== "about:blank") await send("Page.navigate", { url });
  return { id: info.id, send, evaluate, wait, events, close: () => ws.close() };
}
