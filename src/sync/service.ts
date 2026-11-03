export type ServicePage =
  | "overview"
  | "restore"
  | "backups"
  | "policy"
  | "devices"
  | "device"
  | "service"
  | "import"
  | "review"
  | "publish";
export type RuntimeSettings = {
  revision: number;
  serviceName: string;
  autoBackup: boolean;
  backupIntervalMinutes: number;
  recentHours: number;
  dailyDays: number;
  weeklyWeeks: number;
  manualKeep: number;
};
export type ServiceSession = {
  protocol: string;
  csrf: string;
  deviceId: string;
  deviceName: string;
  serviceName: string;
  serverEpoch: string;
  ledger: {
    id: string;
    name: string;
    currency: string;
    accounts: number;
    entries: number;
  } | null;
};
export type ServiceDevice = {
  id: string;
  name: string;
  revoked: number;
  lastSeen: number;
  connected?: number;
};
export type ServiceBackup = {
  id: string;
  kind: string;
  createdAt: string;
  cursor: number;
};
export async function serviceRequest(
  path: string,
  options: {
    method?: string;
    data?: unknown;
    csrf?: string;
    signal?: AbortSignal;
  } = {},
) {
  const method = options.method || "GET";
  let response: Response;
  try {
    response = await fetch("/api/v1/" + path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal || AbortSignal.timeout(30000),
      headers:
        method === "GET"
          ? {}
          : {
              "Content-Type": "application/json",
              "X-CSRF-Token": options.csrf || "",
            },
      ...(options.data !== undefined
        ? { body: JSON.stringify(options.data) }
        : {}),
    });
  } catch (e) {
    if (options.signal?.aborted) throw e;
    throw Error("暂时无法连接远端，请检查网络后重试");
  }
  const result = await response.json().catch(() => {
    throw Object.assign(
      Error(
        response.status === 503
          ? "暂时无法连接远端，请检查网络后重试"
          : "此网页尚未提供账本服务",
      ),
      { status: response.status, code: "INVALID_SERVICE_RESPONSE" },
    );
  });
  if (!response.ok)
    throw Object.assign(Error(result.message || "服务暂时不可用"), {
      status: response.status,
      code: result.code,
    });
  return result;
}
