import { decimal, digits } from "./money.ts";

export class IncompleteAmountExpressionError extends Error {
  constructor() {
    super("请补全算式");
    this.name = "IncompleteAmountExpressionError";
  }
}

type Fraction = { n: bigint; d: bigint };
const gcd = (a: bigint, b: bigint): bigint => (b ? gcd(b, a % b) : a);
function fraction(n: bigint, d: bigint): Fraction {
  if (!d) throw Error("除数不能为 0");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const common = gcd(n < 0n ? -n : n, d);
  return { n: n / common, d: d / common };
}

/** Exact decimal arithmetic; round only the final result to the currency unit. */
export function calculateAmount(
  expression: string,
  currency: string,
  allowNegative = false,
): string {
  const text = expression
    .replaceAll(" ", "")
    .replaceAll("×", "*")
    .replaceAll("÷", "/")
    .replaceAll("−", "-");
  if (!text) return "";
  if (text.length > 128) throw Error("算式过长，请先计算结果");
  let at = 0;
  function number(): Fraction {
    let sign = 1n;
    if (text[at] === "-") {
      sign = -1n;
      at++;
    }
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(text.slice(at));
    if (!match) throw new IncompleteAmountExpressionError();
    at += match[0].length;
    const [whole, part = ""] = match[0].split(".");
    return fraction(
      sign * BigInt((whole || "0") + part),
      10n ** BigInt(part.length),
    );
  }
  function product(): Fraction {
    let left = number();
    while (text[at] === "*" || text[at] === "/") {
      const op = text[at++],
        right = number();
      left =
        op === "*"
          ? fraction(left.n * right.n, left.d * right.d)
          : fraction(left.n * right.d, left.d * right.n);
    }
    return left;
  }
  let value = product();
  while (text[at] === "+" || text[at] === "-") {
    const op = text[at++],
      right = product();
    value = fraction(
      value.n * right.d + (op === "+" ? right.n : -right.n) * value.d,
      value.d * right.d,
    );
  }
  if (at !== text.length) throw Error("请检查算式");
  if (value.n < 0n && !allowNegative) throw Error("金额不能为负数");
  const absolute = value.n < 0n ? -value.n : value.n;
  const scaled = absolute * 10n ** BigInt(digits(currency));
  const rounded = (scaled * 2n + value.d) / (value.d * 2n);
  return decimal((value.n < 0n ? -rounded : rounded).toString(), currency);
}

export function appendAmountKey(
  expression: string,
  key: string,
  replace: boolean,
): string {
  if (/^\d$/.test(key)) return replace ? key : expression + key;
  if (key === ".") {
    const current = replace ? "" : expression;
    const term = current.split(/[+−×÷]/).at(-1) || "";
    return term.includes(".") ? current : current + (term ? "." : "0.");
  }
  if (/^[+−×÷]$/.test(key)) {
    if (!expression) return key === "−" ? "−" : "0" + key;
    return expression.replace(/[+−×÷]+$/, "") + key;
  }
  return expression;
}
