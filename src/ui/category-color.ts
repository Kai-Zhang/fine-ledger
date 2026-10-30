import type { CSSProperties } from "react";

/** Presentation only: never replace the category color stored in the ledger. */
export function categoryColor(color?: string): CSSProperties {
  return { "--category-color": color } as CSSProperties;
}
