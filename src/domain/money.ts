export const currencies = [
  "CNY",
  "USD",
  "JPY",
  "EUR",
  "GBP",
  "HKD",
  "TWD",
  "AUD",
  "CAD",
  "SGD",
  "KRW",
  "CHF",
];
export function digits(currency: string) {
  return (
    new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}
export function minor(value: string, currency: string): string {
  const text = value.trim().replaceAll(",", "");
  const places = digits(currency);
  if (!new RegExp(`^-?\\d+(?:\\.\\d{0,${places}})?$`).test(text))
    throw Error(`金额最多支持 ${places} 位小数`);
  const negative = text.startsWith("-"),
    [a, b = ""] = text.replace("-", "").split(".");
  return (
    (BigInt(a) * 10n ** BigInt(places) + BigInt(b.padEnd(places, "0") || "0")) *
    (negative ? -1n : 1n)
  ).toString();
}
export function decimal(value: string, currency: string) {
  const n = BigInt(value),
    d = digits(currency),
    a = (n < 0n ? -n : n).toString().padStart(d + 1, "0");
  return `${n < 0n ? "-" : ""}${d ? a.slice(0, -d) + "." + a.slice(-d) : a}`;
}
export function money(
  value: string | bigint,
  currency: string,
  withCurrency = false,
): string {
  const s = decimal(value.toString(), currency),
    [a, b] = s.split(".");
  return `${a.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${b !== undefined ? "." + b : ""}${withCurrency ? " " + currency : ""}`;
}
export const sum = (values: string[]) =>
  values.reduce((a, n) => a + BigInt(n), 0n);
export function roundedRatio(
  amount: bigint,
  numerator: bigint,
  denominator: bigint,
) {
  if (denominator <= 0n) throw Error("无效汇率");
  const sign = amount < 0n ? -1n : 1n,
    n = (amount < 0n ? -amount : amount) * numerator;
  return sign * ((n + denominator / 2n) / denominator);
}
export function rateText(
  baseMinor: string,
  foreignMinor: string,
  base: string,
  foreign: string,
) {
  const numerator =
      BigInt(foreignMinor) * 10n ** BigInt(digits(base)) * 1000000n,
    denominator = BigInt(baseMinor) * 10n ** BigInt(digits(foreign));
  if (denominator === 0n) return "—";
  const r = numerator / denominator;
  return `${r / 1000000n}.${(r % 1000000n).toString().padStart(6, "0")}`.replace(
    /\.?0+$/,
    "",
  );
}
