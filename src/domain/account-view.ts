import type { Book } from "./types.ts";
import { accountBalances } from "./ledger.ts";
import { compareTime } from "./dates.ts";

const snapshots = new WeakMap<
  Book,
  { at: string; until: string; balances: Map<string, bigint> }
>();
// UI books are immutable. Reuse across page remounts until the next future
// opening/posted endpoint takes effect; clock rollback forces recalculation.
export function currentAccountBalances(book: Book, at: string) {
  const cached = snapshots.get(book);
  if (
    cached &&
    compareTime(at, cached.at) >= 0 &&
    compareTime(at, cached.until) < 0
  )
    return cached.balances;
  let until = "9999";
  const balances = accountBalances(book, at, (date) => {
    if (compareTime(date, until) < 0) until = date;
  });
  snapshots.set(book, { at, until, balances });
  return balances;
}
