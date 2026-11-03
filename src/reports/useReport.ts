import { useEffect, useState } from "react";
import type { ReportRequest, ReportResult } from "../domain/reporting.ts";
export function useReport(request: ReportRequest | null) {
  const [state, setState] = useState<{
    request: ReportRequest | null;
    result?: ReportResult;
    error?: string;
  }>({ request: null });
  useEffect(() => {
    if (!request) return;
    let worker: Worker;
    try {
      worker = new Worker(new URL("./calculate.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (event) => setState({ request, ...event.data });
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
  }, [request]);
  return state.request === request
    ? { ...state, pending: false }
    : { pending: !!request, result: undefined, error: undefined };
}
