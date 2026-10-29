let isDirty = () => false;
let probe = () => {};
export function protectUpdates(check: () => boolean) {
  isDirty = check;
}
export async function registerPWA() {
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) return;
  let reloading = false;
  probe = () => {
    const controller = navigator.serviceWorker.controller;
    if (!controller) return;
    const channel = new MessageChannel();
    const timer = setTimeout(() => channel.port1.close(), 3000);
    channel.port1.onmessage = async (event) => {
      clearTimeout(timer);
      channel.port1.close();
      if (
        !event.data?.release ||
        event.data.release === __APP_BUILD__ ||
        isDirty() ||
        reloading
      )
        return;
      // A newly loaded shell can briefly have the previous controller. Never reload into a loop.
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        let response;
        try {
          response = await fetch("/release.json", {
            cache: "no-store",
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
        const latest = await response.json();
        if (
          latest.release === event.data.release &&
          latest.release !== __APP_BUILD__ &&
          !isDirty()
        ) {
          reloading = true;
          location.reload();
        }
      } catch {
        /* Keep the complete installed shell usable offline. */
      }
    };
    controller.postMessage({ type: "GET_RELEASE" }, [channel.port2]);
  };
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "PREPARE_UPDATE")
      event.ports[0]?.postMessage({ build: __APP_BUILD__, safe: !isDirty() });
  });
  navigator.serviceWorker.addEventListener("controllerchange", probe);
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      updateViaCache: "none",
    });
    const update = () => {
      if (document.visibilityState === "visible")
        void registration
          .update()
          .catch(() => {})
          .finally(probe);
    };
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("online", update);
    window.setInterval(update, 5 * 60 * 1000);
  } catch (error) {
    console.warn("离线资源暂未准备完成", error);
  }
}
export function checkDeferredUpdate() {
  if (!isDirty())
    setTimeout(() => {
      if (!isDirty()) probe();
    }, 200);
}
