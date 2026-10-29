export interface AllocationRow {
  id: string;
  amountMinor: string;
  locked?: boolean;
}
export function allocateSplits(
  total: bigint,
  rows: AllocationRow[],
  editedId?: string,
): string[] {
  if (rows.some((row) => BigInt(row.amountMinor || "0") < 0n))
    throw Error("类目金额不能为负数");
  if (total < 0n) throw Error("总金额不能为负数");
  const fixed = rows.reduce(
    (sum, row) =>
      sum +
      (row.locked || row.id === editedId ? BigInt(row.amountMinor || "0") : 0n),
    0n,
  );
  const free = rows.filter((row) => !row.locked && row.id !== editedId),
    remaining = total - fixed;
  if (remaining < 0n) throw Error("锁定或手动金额超过总金额");
  if (!free.length && remaining !== 0n)
    throw Error("没有可分配的类目，请解除锁定或调整金额");
  const each = free.length ? remaining / BigInt(free.length) : 0n;
  let remainder = free.length ? remaining % BigInt(free.length) : 0n;
  return rows.map((row) => {
    if (row.locked || row.id === editedId) return row.amountMinor;
    const amount = each + (remainder > 0n ? 1n : 0n);
    if (remainder > 0n) remainder--;
    return amount.toString();
  });
}
