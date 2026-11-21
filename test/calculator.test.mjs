import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateAmount,
  appendAmountKey,
  IncompleteAmountExpressionError,
} from "../src/domain/calculator.ts";

test("exact calculator handles decimals and multiplication/division precedence", () => {
  for (const [expression, expected] of [
    ["12.8+8.9×2", "30.60"],
    ["0.1+0.2", "0.30"],
    ["1÷3×3", "1.00"],
    ["10−2×3+4÷2", "6.00"],
    ["10000000000000000.01+0.02", "10000000000000000.03"],
    [".5+1.", "1.50"],
    ["1−−2", "3.00"],
    ["", ""],
  ])
    assert.equal(calculateAmount(expression, "CNY"), expected, expression);
});
test("round only final result to the currency precision, including negative balances", () => {
  assert.equal(calculateAmount("1÷8", "CNY"), "0.13");
  assert.equal(calculateAmount("−1÷8", "CNY", true), "-0.13");
  assert.equal(calculateAmount("1.5", "JPY"), "2");
  assert.equal(calculateAmount("1÷8", "KWD"), "0.125");
  assert.equal(calculateAmount("1÷3+1÷3+1÷3", "CNY"), "1.00");
  assert.throws(() => calculateAmount("1−2", "CNY"), /负数/);
});
test("reject invalid, incomplete, zero-divisor, and excessively long expressions", () => {
  for (const expression of [
    "1÷0",
    "0÷0",
    "2+",
    "−",
    ".",
    "1.2.3",
    "1e6",
    "alert(1)",
    "2**3",
    "9".repeat(129),
  ])
    assert.throws(
      () => calculateAmount(expression, "CNY"),
      undefined,
      expression,
    );
});
test("unfinished expressions are distinguishable from real arithmetic errors", () => {
  for (const expression of ["100+", "2×", "1÷", "−"])
    assert.throws(
      () => calculateAmount(expression, "CNY"),
      IncompleteAmountExpressionError,
    );
  assert.throws(
    () => calculateAmount("1÷0", "CNY"),
    (error) =>
      !(error instanceof IncompleteAmountExpressionError) &&
      /除数/.test(error.message),
  );
});
test("keypad replaces selected values, appends operators, and avoids duplicate decimal points", () => {
  assert.equal(appendAmountKey("50.00", "2", true), "2");
  assert.equal(appendAmountKey("50.00", "+", true), "50.00+");
  assert.equal(appendAmountKey("5+", "×", false), "5×");
  assert.equal(appendAmountKey("5+", ".", false), "5+0.");
  assert.equal(appendAmountKey("5.2", ".", false), "5.2");
  assert.equal(appendAmountKey("5", ".", true), "0.");
});
