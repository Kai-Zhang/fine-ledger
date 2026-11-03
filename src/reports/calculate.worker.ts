import { calculateReport, type ReportRequest } from "../domain/reporting.ts";
self.onmessage = (event: MessageEvent<ReportRequest>) => {
  try {
    self.postMessage({ result: calculateReport(event.data) });
  } catch (error) {
    self.postMessage({ error: (error as Error).message });
  }
};
