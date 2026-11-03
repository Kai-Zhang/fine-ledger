import { dateOffset, localDate } from "./dates.ts";
import { digits } from "./money.ts";

export type ReferenceQuote = {
  date: string;
  base: string;
  quote: string;
  rate: number;
};

// Frankfurter returns quote currency per unit of base currency.
export function referenceRateLookup(
  quotes: readonly ReferenceQuote[],
  base: string,
  timeZone: string,
) {
  const byCurrency = new Map<string, ReferenceQuote[]>();
  for (const quote of quotes) {
    if (quote.base !== base) continue;
    const rows = byCurrency.get(quote.quote) || [];
    if (!byCurrency.has(quote.quote)) byCurrency.set(quote.quote, rows);
    rows.push(quote);
  }
  for (const rows of byCurrency.values())
    rows.sort((a, b) => a.date.localeCompare(b.date));
  const cache = new Map<
    string,
    { n: bigint; d: bigint; provisional: true } | null
  >();
  return (currency: string, at: string) => {
    const rows = byCurrency.get(currency);
    if (!rows?.length) return null;
    const day = localDate(at, timeZone),
      key = currency + day;
    if (cache.has(key)) return cache.get(key)!;
    let lo = 0,
      hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (rows[mid].date <= day) lo = mid + 1;
      else hi = mid;
    }
    const quote = rows[lo - 1];
    // Cover non-publication days without using future or arbitrarily old quotes.
    if (!quote || quote.date < dateOffset(day, -7)) {
      cache.set(key, null);
      return null;
    }
    const [coefficient, exponent = "0"] = String(quote.rate).split("e");
    const [whole, fraction = ""] = coefficient.split(".");
    const shift = Number(exponent) - fraction.length;
    const units = BigInt(whole + fraction);
    const rate = {
      n: 10n ** BigInt(digits(base) + Math.max(0, -shift)),
      d: units * 10n ** BigInt(digits(currency) + Math.max(0, shift)),
      provisional: true as const,
    };
    cache.set(key, rate);
    return rate;
  };
}
