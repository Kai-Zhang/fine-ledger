import { useEffect, useMemo, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { databases } from "../storage/repository.ts";
import { onSyncRequested, SyncEngine } from "./engine.ts";

export function useSyncCoordinator(
  active: boolean,
  canApply: () => boolean,
  bookRevision?: number,
) {
  const latest = useRef(canApply);
  latest.current = canApply;
  const engine = useMemo(
    () => new SyncEngine("personal", { canApply: () => latest.current() }),
    [],
  );
  const revision = useLiveQuery(
    async () => ({
      enabled: await databases.personal.state.get("sync-enabled"),
      count: await databases.personal.outbox.count(),
    }),
    [],
  );
  const schedule = useRef<(force?: boolean) => void>(() => {});
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | undefined,
      forced = false;
    const request = (force = false) => {
      forced ||= force;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const value = forced;
        forced = false;
        if (engine.running) {
          request(value);
          return;
        }
        void engine.run(value).catch(() => {});
      }, 300);
    };
    schedule.current = request;
    const remove = onSyncRequested(request);
    const foreground = () => {
      if (document.visibilityState === "visible") request(true);
    };
    window.addEventListener("online", foreground);
    window.addEventListener("pageshow", foreground);
    document.addEventListener("visibilitychange", foreground);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") request();
    }, 10000);
    request();
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      remove();
      schedule.current = () => {};
      window.removeEventListener("online", foreground);
      window.removeEventListener("pageshow", foreground);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [active, engine]);
  useEffect(() => {
    if (active) schedule.current();
  }, [active, revision, bookRevision]);
}
