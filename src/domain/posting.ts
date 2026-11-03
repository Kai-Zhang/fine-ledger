import type { Book, Entry } from "./types.ts";
import { entryCurrency, needsSettlement, upsertEntry } from "./ledger.ts";

// Largest remainders, with stable split order resolving ties. Never use FX floats.
export function proportionalAmounts(
  total: bigint,
  weights: string[],
): string[] {
  if (
    total <= 0n ||
    !weights.length ||
    weights.some((w) => !/^\d+$/.test(w) || BigInt(w) <= 0n)
  )
    throw Error("请填写有效的金额与类目比例");
  const sum = weights.reduce((n, w) => n + BigInt(w), 0n);
  const parts = weights.map((w, i) => ({
    i,
    n: (total * BigInt(w)) / sum,
    r: (total * BigInt(w)) % sum,
  }));
  let left = total - parts.reduce((n, p) => n + p.n, 0n);
  for (const p of [...parts].sort((a, b) =>
    a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1,
  )) {
    if (!left) break;
    p.n++;
    left--;
  }
  return parts.map((p) => p.n.toString());
}

export function postingPreview(
  book: Book,
  source: Entry,
  amountMinor: string,
): Entry {
  if (source.posted || source.deletedAt)
    throw Error("请重新打开尚未入账的交易");
  if (!/^\d+$/.test(amountMinor) || BigInt(amountMinor) <= 0n)
    throw Error("请填写实际入账金额");
  const account = book.accounts.find((a) => a.id === source.accountId);
  if (!account) throw Error("账户不存在");
  const amounts = source.splits.length
    ? proportionalAmounts(
        BigInt(amountMinor),
        source.splits.map((x) => x.amountMinor),
      )
    : [];
  return {
    ...structuredClone(source),
    amountMinor,
    amountCurrency: account.currency,
    posted: true,
    originalAmount:
      source.originalAmount ||
      (needsSettlement(book, source)
        ? {
            currency: entryCurrency(book, source),
            amountMinor: source.amountMinor,
          }
        : undefined),
    splits: source.splits.map((s, i) => ({ ...s, amountMinor: amounts[i] })),
  };
}

export function confirmPosting(
  book: Book,
  source: Entry,
  amountMinor: string,
  splits?: string[],
) {
  const current = book.entries.find((e) => e.id === source.id);
  if (!current || current.revision !== source.revision)
    throw Error("这笔交易已更新，请重新打开确认");
  const next = postingPreview(book, current, amountMinor);
  if (splits) {
    if (splits.length !== next.splits.length) throw Error("类目数量已变化");
    next.splits.forEach((s, i) => {
      s.amountMinor = splits[i];
    });
  }
  upsertEntry(book, next);
}
