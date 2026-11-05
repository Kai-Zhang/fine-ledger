import type { Account } from "./types.ts";

// Deleted transactions still establish the denomination of an account.
export function canChangeAccountCurrency(
  account: Account | undefined,
  hasTransactions: boolean,
) {
  return !account || (!hasTransactions && BigInt(account.openingMinor) === 0n);
}
