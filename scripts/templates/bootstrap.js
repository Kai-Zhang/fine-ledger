(() => {
  const key = "fine-ledger-startup-log-v1";
  const build =
    document.querySelector('meta[name="build"]')?.content || "unknown";
  let ready = false;
  function mark(type, detail = {}) {
    try {
      const rows = JSON.parse(localStorage.getItem(key) || "[]");
      rows.push({
        at: new Date().toISOString(),
        build,
        type,
        online: navigator.onLine,
        visibility: document.visibilityState,
        ...detail,
      });
      localStorage.setItem(key, JSON.stringify(rows.slice(-40)));
    } catch {
      /* Diagnostics must never prevent opening the ledger. */
    }
  }
  function showFailure() {
    if (ready) return;
    const heading = document.querySelector("[data-startup-heading]");
    const message = document.querySelector("[data-startup-message]");
    if (heading) heading.textContent = "启动尚未完成";
    if (message) message.textContent = "可以重新打开；账本数据没有被清除。";
  }
  const timer = setTimeout(() => {
    mark("startup-timeout");
    showFailure();
  }, 8000);
  window.__ledgerStartup = {
    mark,
    ready() {
      ready = true;
      clearTimeout(timer);
      mark("ready");
    },
    fail(name) {
      mark("startup-error", { name });
      showFailure();
    },
  };
  window.addEventListener(
    "error",
    (event) => {
      if (
        event.target instanceof HTMLScriptElement ||
        event.target instanceof HTMLLinkElement
      ) {
        let path = "";
        try {
          path = new URL(event.target.src || event.target.href, location.href)
            .pathname;
        } catch {}
        mark("asset-error", { path });
      } else
        mark("runtime-error", {
          name: event.error?.name || "Error",
          line: event.lineno,
          column: event.colno,
        });
      showFailure();
    },
    true,
  );
  window.addEventListener("unhandledrejection", (event) => {
    mark("unhandled-rejection", { name: event.reason?.name || "Error" });
    showFailure();
  });
  window.addEventListener("pageshow", (event) =>
    mark("pageshow", { persisted: event.persisted }),
  );
  window.addEventListener("pagehide", (event) =>
    mark("pagehide", { persisted: event.persisted }),
  );
  document.addEventListener("visibilitychange", () => mark("visibility"));
  mark("shell-script");
})();
