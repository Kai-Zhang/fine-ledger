import type { CSSProperties } from "react";
import type { PlotColor } from "./donut-model.ts";
export const plotColor = (color?: PlotColor) =>
  ({
    "--plot-light": color?.light || "var(--accent)",
    "--plot-dark": color?.dark || "var(--accent)",
  }) as CSSProperties;
