import type {
  RuntimeSettings,
  ServiceBackup,
  ServiceDevice,
  ServiceSession,
} from "./service.ts";

export type ServiceView = {
  auth: ServiceSession;
  settings: RuntimeSettings;
  backups: ServiceBackup[];
  devices: ServiceDevice[];
};
// Memory only: reuse the last verified view across page and gesture mounts.
// Cookies remain authoritative; a 401 or explicit disconnect discards this view.
const views = new Map<string, ServiceView>();
export function readServiceView(origin: string): ServiceView | undefined {
  const view = views.get(origin);
  return view ? structuredClone(view) : undefined;
}
export function saveServiceView(origin: string, view: ServiceView) {
  views.set(origin, structuredClone(view));
}
export function clearServiceView(origin: string) {
  views.delete(origin);
}
