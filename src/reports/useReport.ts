import { useEffect, useMemo, useState } from "react";
import type { ReportRequest, ReportResult } from "../domain/reporting.ts";
// Project drilldown remounts the overview. Reuse completed calculations for
// the same immutable book and report scope while that book remains loaded.
const projectResults = new WeakMap<
  ReportRequest["book"],
  Map<string, ReportResult>
>();

export function useReport(request: ReportRequest | null) {
  const [state, setState] = useState<{
    request: ReportRequest | null;
    result?: ReportResult;
    error?: string;
  }>({ request: null });
  const projectKey = useMemo(
    () =>
      request?.type === "project"
        ? JSON.stringify([
            request.from,
            request.to,
            request.ids,
            request.categoryIds,
            request.projectIds,
            request.grain,
            request.referenceQuotes,
          ])
        : undefined,
    [request],
  );
  const cached =
    request && projectKey
      ? projectResults.get(request.book)?.get(projectKey)
      : undefined;
  useEffect(() => {
    if (!request || cached) return;
    let worker: Worker;
    try {
      worker = new Worker(new URL("./calculate.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (event) => {
        const { result, error } = event.data as {
          result?: ReportResult;
          error?: string;
        };
        if (projectKey && result) {
          let results = projectResults.get(request.book);
          if (!results) {
            results = new Map();
            projectResults.set(request.book, results);
          }
          if (results.size >= 12) results.delete(results.keys().next().value!);
          results.set(projectKey, result);
        }
        setState({ request, result, error });
      };
      worker.onerror = () =>
        setState({
          request,
          error: "报表计算未能完成，请重新选择时间范围后重试。",
        });
      worker.postMessage(request);
    } catch {
      setState({ request, error: "无法启动报表计算，请重新打开页面后重试。" });
    }
    return () => worker?.terminate();
  }, [request, projectKey, cached]);
  if (cached) return { result: cached, pending: false, error: undefined };
  return state.request === request
    ? { ...state, pending: false }
    : { pending: !!request, result: undefined, error: undefined };
}
