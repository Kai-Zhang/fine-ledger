import Dexie, { type Table } from "dexie";
import { useEffect, useState } from "react";
import { dateOffset } from "../domain/dates.ts";
import type { ReferenceQuote } from "../domain/reference-rates.ts";

type CachedYear = { key: string; through: string; quotes: ReferenceQuote[] };
const db = new Dexie("fine-ledger-reference-rates");
db.version(1).stores({ years: "key" });
const years = db.table<CachedYear>("years") as Table<CachedYear, string>;
const pending = new Map<string, Promise<CachedYear>>();
const failedAt = new Map<string, number>();
const empty: ReferenceQuote[] = [];
const recentScopes = new Map<string, ReferenceQuote[]>();
let retryAfter = 0;

async function update(
  base: string,
  quote: string,
  year: number,
  through: string,
) {
  const key = `${base}:${quote}:${year}`;
  const current = await years.get(key);
  if (current && current.through >= through) return current;
  const taskKey = key + through;
  if (
    Date.now() < retryAfter ||
    Date.now() - (failedAt.get(taskKey) ?? 0) < 300_000
  )
    throw Error("报价服务暂不可用");
  const running = pending.get(taskKey);
  if (running) return running;
  const task = (async () => {
    const start = `${year}-01-01`;
    const from = current
      ? [start, dateOffset(current.through, -7)].sort().at(-1)!
      : start;
    const query = new URLSearchParams({
      base,
      quotes: quote,
      from,
      to: through,
    });
    const response = await fetch(
      `https://api.frankfurter.dev/v2/rates?${query}`,
      {
        signal: AbortSignal.timeout(8000),
        credentials: "omit",
      },
    );
    if (response.status === 429) {
      const delay = Number(response.headers.get("Retry-After"));
      retryAfter = Date.now() + (delay > 0 ? delay * 1000 : 300_000);
    }
    if (!response.ok) throw Error(`报价服务返回 ${response.status}`);
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw Error("报价数据无效");
    const merged = new Map(current?.quotes.map((row) => [row.date, row]));
    for (const row of payload) {
      if (
        row?.base !== base ||
        row.quote !== quote ||
        typeof row.date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
        row.date < from ||
        row.date > through ||
        typeof row.rate !== "number" ||
        !Number.isFinite(row.rate) ||
        row.rate <= 0
      )
        throw Error("报价数据无效");
      merged.set(row.date, { date: row.date, base, quote, rate: row.rate });
    }
    return db.transaction("rw", years, async () => {
      const latest = await years.get(key);
      if (latest && latest.through >= through) return latest;
      for (const row of latest?.quotes || [])
        if (!merged.has(row.date)) merged.set(row.date, row);
      const result = { key, through, quotes: [...merged.values()] };
      await years.put(result);
      return result;
    });
  })()
    .catch((error) => {
      failedAt.set(taskKey, Date.now());
      throw error;
    })
    .finally(() => pending.delete(taskKey));
  pending.set(taskKey, task);
  return task;
}

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
          (pair) => (loaded.get(pair.key)?.through || "") < pair.through,
        );
        let changed = false;
        for (let i = 0; i < missing.length; i += 3) {
          if (stopped || Date.now() < retryAfter) break;
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
