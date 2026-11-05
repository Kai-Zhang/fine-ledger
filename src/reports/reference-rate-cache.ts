import Dexie, { type Table } from "dexie";
import { dateOffset } from "../domain/dates.ts";
import type { ReferenceQuote } from "../domain/reference-rates.ts";
export type CachedYear = {
  key: string;
  through: string;
  quotes: ReferenceQuote[];
  fetchedAt?: number;
  latestQuoteDate?: string;
};
export function cacheFresh(
  current: CachedYear | undefined,
  through: string,
  now = Date.now(),
) {
  if (!current || current.through < through || !current.fetchedAt) return false;
  const today = new Date(now).toISOString().slice(0, 10);
  const ttl =
    through >= dateOffset(today, -8) || !current.quotes.length
      ? 60 * 60 * 1000
      : 30 * 86400000;
  const age = now - current.fetchedAt;
  return age >= 0 && age < ttl;
}
export function createReferenceRateCache(
  name = "fine-ledger-reference-rates",
  clock = Date.now,
  request: typeof fetch = fetch,
) {
  const db = new Dexie(name);
  db.version(1).stores({ years: "key" });
  const years = db.table<CachedYear>("years") as Table<CachedYear, string>;
  const pending = new Map<string, Promise<CachedYear>>();
  const failedAt = new Map<string, number>();
  let retryAfter = 0;

  async function update(
    base: string,
    quote: string,
    year: number,
    through: string,
  ) {
    const key = `${base}:${quote}:${year}`;
    const current = await years.get(key);
    if (cacheFresh(current, through, clock())) return current!;
    const taskKey = key + through;
    if (
      clock() < retryAfter ||
      clock() - (failedAt.get(taskKey) ?? 0) < 300_000
    )
      throw Error("报价服务暂不可用");
    const running = pending.get(taskKey);
    if (running) return running;
    const task = (async () => {
      const start = `${year}-01-01`;
      const from =
        current &&
        current.through >=
          dateOffset(new Date(clock()).toISOString().slice(0, 10), -8)
          ? [start, dateOffset(current.through, -7)].sort().at(-1)!
          : start;
      const query = new URLSearchParams({
        base,
        quotes: quote,
        from,
        to: through,
      });
      const response = await request(
        `https://api.frankfurter.dev/v2/rates?${query}`,
        {
          signal: AbortSignal.timeout(8000),
          credentials: "omit",
        },
      );
      if (response.status === 429) {
        const delay = Number(response.headers.get("Retry-After"));
        retryAfter = clock() + (delay > 0 ? delay * 1000 : 300_000);
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
        if (
          cacheFresh(latest, through, clock()) &&
          latest!.fetchedAt! > (current?.fetchedAt || 0)
        )
          return latest!;
        for (const row of latest?.quotes || [])
          if (!merged.has(row.date)) merged.set(row.date, row);
        const quotes = [...merged.values()].sort((a, b) =>
          a.date.localeCompare(b.date),
        );
        const result = {
          key,
          through:
            latest && latest.through > through ? latest.through : through,
          fetchedAt: clock(),
          latestQuoteDate: quotes.at(-1)?.date,
          quotes,
        };
        await years.put(result);
        return result;
      });
    })()
      .catch((error) => {
        failedAt.set(taskKey, clock());
        throw error;
      })
      .finally(() => pending.delete(taskKey));
    pending.set(taskKey, task);
    return task;
  }

  return { db, years, update, coolingDown: () => clock() < retryAfter };
}
