import {
  cacheFresh,
  createReferenceRateCache,
} from "./reference-rate-cache.ts";
import { useEffect, useState } from "react";
import { dateOffset } from "../domain/dates.ts";
import type { ReferenceQuote } from "../domain/reference-rates.ts";

const { years, update, coolingDown } = createReferenceRateCache();
const empty: ReferenceQuote[] = [];
const recentScopes = new Map<string, ReferenceQuote[]>();

export function useReferenceRates(
  base: string,
  currencies: readonly string[],
  from?: string,
  to?: string,
  enabled = true,
) {
  const symbols = [...new Set(currencies.filter((c) => c !== base))]
    .sort()
    .join(",");
  const scope = JSON.stringify([base, symbols, from, to]);
  const [state, setState] = useState(() => ({
    scope,
    quotes: recentScopes.get(scope) ?? empty,
  }));
  useEffect(() => {
    if (!enabled || !symbols || (from && to && from > to)) return;
    let stopped = false,
      loading = false;
    async function refresh() {
      if (loading) return;
      loading = true;
      try {
        const today = new Date().toISOString().slice(0, 10);
        const end = to && to < today ? to : today;
        const start = dateOffset(from || end, -8);
        const firstYear = Number(start.slice(0, 4)),
          lastYear = Number(end.slice(0, 4));
        if (lastYear < firstYear || lastYear - firstYear > 100) return;
        const pairs = symbols.split(",").flatMap((quote) =>
          Array.from({ length: lastYear - firstYear + 1 }, (_, i) => {
            const year = lastYear - i;
            const yearEnd = `${year}-12-31`;
            // Fetch the remainder of closed years in one request.
            const through = yearEnd < today ? yearEnd : today;
            return { quote, year, through, key: `${base}:${quote}:${year}` };
          }),
        );
        const cached = await years.bulkGet(pairs.map((pair) => pair.key));
        const loaded = new Map(
          cached.flatMap((row) => (row ? [[row.key, row] as const] : [])),
        );
        const publish = () => {
          if (stopped) return;
          const quotes = [...loaded.values()].flatMap((row) => row.quotes);
          if (recentScopes.size >= 12 && !recentScopes.has(scope))
            recentScopes.delete(recentScopes.keys().next().value!);
          recentScopes.set(scope, quotes);
          setState((previous) =>
            previous.scope === scope &&
            JSON.stringify(previous.quotes) === JSON.stringify(quotes)
              ? previous
              : { scope, quotes },
          );
        };
        publish();
        if (!navigator.onLine) return;
        const missing = pairs.filter(
          (pair) => !cacheFresh(loaded.get(pair.key), pair.through),
        );
        let changed = false;
        for (let i = 0; i < missing.length; i += 3) {
          if (stopped || coolingDown()) break;
          const results = await Promise.allSettled(
            missing
              .slice(i, i + 3)
              .map((pair) => update(base, pair.quote, pair.year, pair.through)),
          );
          for (const result of results) {
            if (result.status !== "fulfilled") continue;
            loaded.set(result.value.key, result.value);
            changed = true;
          }
        }
        if (changed) publish();
      } catch {
        // Quote storage is optional; the ledger remains available.
      } finally {
        loading = false;
      }
    }
    function visible() {
      if (document.visibilityState === "visible") void refresh();
    }
    void refresh();
    const timer = setInterval(visible, 60 * 60 * 1000);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [scope, base, symbols, from, to, enabled]);
  return state.scope === scope
    ? state.quotes
    : (recentScopes.get(scope) ?? empty);
}
