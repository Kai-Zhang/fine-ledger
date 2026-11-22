import { useLayoutEffect, useRef, type ReactNode, type UIEvent } from "react";
import { useApp } from "../ui/context.tsx";

function useColumnScroll(wideLayout: boolean, column: "chart" | "details") {
  const { frameKey, preview, views } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const key = `report-scroll:${frameKey}:${column}`;
  useLayoutEffect(() => {
    if (wideLayout && ref.current) {
      const top = views.get(key);
      if (typeof top === "number") ref.current.scrollTop = top;
    }
  }, [wideLayout, views, key]);
  const onScroll =
    wideLayout && !preview
      ? (event: UIEvent<HTMLDivElement>) => {
          views.set(key, event.currentTarget.scrollTop);
        }
      : undefined;
  return { ref, onScroll };
}

export function ReportColumns({
  wideLayout,
  summary,
  chart,
  details,
}: {
  wideLayout: boolean;
  summary?: ReactNode;
  chart: ReactNode;
  details: ReactNode;
}) {
  const chartScroll = useColumnScroll(wideLayout, "chart");
  const detailScroll = useColumnScroll(wideLayout, "details");
  return (
    <div className="report-columns">
      {summary}
      <div className="report-chart-column" {...chartScroll}>
        {chart}
      </div>
      <div className="report-detail-column" {...detailScroll}>
        {details}
      </div>
    </div>
  );
}
