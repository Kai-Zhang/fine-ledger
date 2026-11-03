import type { Entry } from "./types.ts";
import { roundedRatio } from "./money.ts";

// Convert the whole transaction once. Largest remainders allocate each minor
// unit to a stable split ID before any category/project filter is applied.
export function convertedSplits(entry: Entry, n: bigint, d: bigint): bigint[] {
  const parts = entry.splits.map((s, i) => ({
    i,
    id: s.id,
    value: (BigInt(s.amountMinor) * n) / d,
    remainder: (BigInt(s.amountMinor) * n) % d,
  }));
  const native = entry.splits.reduce(
    (sum, s) => sum + BigInt(s.amountMinor),
    0n,
  );
  let left =
    roundedRatio(native, n, d) - parts.reduce((sum, p) => sum + p.value, 0n);
  for (const p of [...parts].sort((a, b) =>
    a.remainder === b.remainder
      ? a.id.localeCompare(b.id)
      : a.remainder > b.remainder
        ? -1
        : 1,
  )) {
    if (left <= 0n) break;
    p.value++;
    left--;
  }
  return parts.map((p) => p.value);
}
