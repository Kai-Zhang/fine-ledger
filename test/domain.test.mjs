import test from 'node:test';
import assert from 'node:assert/strict';
import { minor, decimal, money, balance, delta, suggestions, refundable, validateEntry, localMinute } from '../public/domain.js';
import { createBook } from '../public/seed.js';
const input = (overrides = {}) => ({ id: 'new', accountId: 'cmb', kind: 'expense', description: '测试消费', amountMinor: '100', categoryId: 'meal', occurredAt: '2026-10-27T10:20:00.000Z', project: '', note: '', ...overrides });

test('decimal parsing and addition stay exact beyond floating-point precision', () => {
  assert.equal((BigInt(minor('0.1')) + BigInt(minor('0.2'))).toString(), '30');
  assert.equal(minor('999999999999.99'), '99999999999999');
  assert.equal(decimal('-102'), '-1.02');
  assert.equal(money('123456789'), '¥1,234,567.89');
  assert.equal(minor('-0.01', 'CNY', true), '-1');
});
test('amount precision and invalid input are rejected rather than rounded', () => {
  for (const bad of ['', '1e3', '1.001', '-1', 'Infinity', '1,000', '1000000000000']) assert.throws(() => minor(bad));
  assert.equal(minor('123', 'JPY'), '123'); assert.throws(() => minor('1.1', 'JPY'));
});
test('empty descriptions show eight recent distinct descriptions', () => {
  const book = createBook(); const result = suggestions(book.entries);
  assert.equal(result.length, 8); assert.equal(new Set(result.map(t => t.description)).size, 8);
  assert.equal(result[0].description, 'Manner 咖啡');
});
test('substring matching ranks prefixes first without losing recency within rank', () => {
  const entries = ['街角咖啡', '咖啡工坊', '咖啡馆', '一杯咖啡'].map((description, i) => input({ id: String(i), description, occurredAt: `2026-10-${27 - i}T10:00:00.000Z` }));
  assert.deepEqual(suggestions(entries, '咖啡').map(t => t.description), ['咖啡工坊', '咖啡馆', '街角咖啡', '一杯咖啡']);
});
test('same description inherits the latest category, case and width insensitive', () => {
  const entries = [input({ description: 'ＭＡＮＮＥＲ', categoryId: 'meal', occurredAt: '2026-10-25T10:00:00.000Z' }), input({ description: 'Manner', categoryId: 'coffee', occurredAt: '2026-10-26T10:00:00.000Z' })];
  assert.equal(suggestions(entries, 'mAnNeR').length, 1); assert.equal(suggestions(entries)[0].categoryId, 'coffee');
});
test('income suggestions and categories stay separate from expense', () => {
  const book = createBook(); assert.equal(suggestions(book.entries, '', 'income')[0].description, '工资');
  assert.throws(() => validateEntry(book, input({ kind: 'income', categoryId: 'meal' })), /二级类目/);
});
test('linked partial refunds cannot exceed remaining amount or alter category/project', () => {
  const book = createBook(); const original = book.entries[0];
  const refund = input({ kind: 'refund', amountMinor: '1000', originalId: original.id, categoryId: original.categoryId });
  validateEntry(book, refund); book.entries.push(refund);
  assert.equal(refundable(book, original.id), '800');
  assert.throws(() => validateEntry(book, { ...refund, amountMinor: '801' }), /超过/);
  assert.throws(() => validateEntry(book, { ...refund, amountMinor: '1', categoryId: 'meal' }), /沿用/);
  assert.throws(() => validateEntry(book, { ...refund, amountMinor: '1', accountId: 'usd' }), /原账户/);
});
test('transfers conserve same-currency account totals and reject unsupported FX', () => {
  const book = createBook(); const t = input({ kind: 'transfer', toAccountId: 'alipay', categoryId: '' });
  validateEntry(book, t); assert.equal(delta(t, 'cmb') + delta(t, 'alipay'), 0n);
  assert.throws(() => validateEntry(book, { ...t, toAccountId: 'usd' }), /同币种/);
  assert.throws(() => validateEntry(book, { ...t, toAccountId: 'cmb' }), /另一个/);
});
test('balance reflects expense, refund, income and adjustment without mixing currencies', () => {
  const book = createBook(); const before = BigInt(balance(book, 'cmb')); const usd = balance(book, 'usd');
  book.entries.push(input(), input({ kind: 'refund', amountMinor: '30' }), input({ kind: 'income', amountMinor: '200', categoryId: 'salary' }), input({ kind: 'adjustment', amountMinor: '-10' }));
  assert.equal(BigInt(balance(book, 'cmb')), before + 120n); assert.equal(balance(book, 'usd'), usd);
});
test('stored occurrence times require ISO seconds, zero amounts and missing descriptions fail', () => {
  const book = createBook(); validateEntry(book, input());
  for (const overrides of [{ occurredAt: '2026-10-27T10:20' }, { amountMinor: '0' }, { description: '  ' }, { kind: 'unknown' }, { accountId: 'missing' }]) assert.throws(() => validateEntry(book, input(overrides)));
  assert.match(localMinute(new Date('2026-10-27T10:20:30Z')), /^2026-10-27T\d{2}:20$/);
});
