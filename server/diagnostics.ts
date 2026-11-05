// Log only allowlisted metadata. Error messages, SQL, headers and payloads can
// contain credentials or financial data and must never reach the log sink.
const codes = new Set([
  "ERR_SQLITE_ERROR",
  "SQLITE_FULL",
  "SQLITE_READONLY",
  "SQLITE_BUSY",
  "SQLITE_CORRUPT",
  "ENOSPC",
  "EROFS",
  "EACCES",
  "EIO",
  "ENOENT",
]);
export function diagnostic(
  error: unknown,
  context: {
    operation: string;
    requestId?: string;
    route?: string;
  },
) {
  const e = error as { code?: string; errcode?: number; stack?: string } | null;
  return {
    at: new Date().toISOString(),
    event: "service-failure",
    ...context,
    code: e?.code && codes.has(e.code) ? e.code : "UNEXPECTED_ERROR",
    sqliteCode: Number.isInteger(e?.errcode) ? e!.errcode : undefined,
    frames:
      typeof e?.stack === "string"
        ? [
            ...e.stack.matchAll(
              /\/(?:server|src)\/[\w./-]+\.[cm]?[jt]s:\d+:\d+/g,
            ),
          ]
            .slice(0, 6)
            .map((match) => match[0])
        : [],
  };
}
export function reportFailure(
  error: unknown,
  context: Parameters<typeof diagnostic>[1],
) {
  console.error(JSON.stringify(diagnostic(error, context)));
}
