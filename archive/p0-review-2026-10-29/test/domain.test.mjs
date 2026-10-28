import test from 'node:test';
import assert from 'node:assert/strict';
import { minor, decimal, money, balance, delta, suggestions, refundable, validateEntry, localMinute, activeEntries, accountGroups, setEntryDeleted } from '../public/domain.js';
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

test('account groups include every account once and keep totals in each original currency', () => {
  const book = createBook(), groups = accountGroups(book);
  assert.equal(new Set(groups.flatMap(g => g.accounts.map(a => a.id))).size, book.accounts.length);
  const credit = groups.find(g => g.id === 'credit');
  assert.deepEqual(credit.totals, { CNY: balance(book, 'credit'), USD: balance(book, 'usd') });
  for (const group of groups) for (const [currency, total] of Object.entries(group.totals)) assert.equal(total, group.accounts.filter(a => a.currency === currency).reduce((sum, a) => sum + BigInt(balance(book, a.id)), 0n).toString());
});
test('deleting and restoring every transaction type reverses exactly its account postings', () => {
  for (const kind of ['expense', 'income', 'transfer', 'adjustment']) {
    const original = createBook(); original.entries.push(input({ id: 'delete-me', kind, amountMinor: kind === 'adjustment' ? '-150' : '150', categoryId: kind === 'income' ? 'salary' : 'meal', toAccountId: kind === 'transfer' ? 'alipay' : undefined }));
    const before = new Map(original.accounts.map(a => [a.id, BigInt(balance(original, a.id))]));
    const result = setEntryDeleted(original, 'delete-me', true);
    for (const a of original.accounts) assert.equal(BigInt(balance(result.book, a.id)), before.get(a.id) - delta(original.entries.at(-1), a.id));
    const restored = setEntryDeleted(result.book, 'delete-me', false);
    for (const a of original.accounts) assert.equal(BigInt(balance(restored.book, a.id)), before.get(a.id));
    assert.equal(original.entries.at(-1).deletedAt, undefined);
    assert.equal(result.entry.revision, 2); assert.equal(restored.entry.revision, 3);
  }
});
test('deleting a refund releases its remaining allowance and never orphans an active refund', () => {
  const book = createBook(), expense = book.entries[0];
  const refund = input({ id: 'refund', kind: 'refund', categoryId: expense.categoryId, originalId: expense.id, amountMinor: '800' });
  book.entries.push(refund);
  assert.throws(() => setEntryDeleted(book, expense.id, true), /先删除退款/);
  const removedRefund = setEntryDeleted(book, refund.id, true).book;
  assert.equal(refundable(removedRefund, expense.id), expense.amountMinor);
  const removedExpense = setEntryDeleted(removedRefund, expense.id, true).book;
  assert.throws(() => setEntryDeleted(removedExpense, refund.id, false), /有效消费/);
  const restoredExpense = setEntryDeleted(removedExpense, expense.id, false).book;
  assert.equal(refundable(setEntryDeleted(restoredExpense, refund.id, false).book, expense.id), '1000');
});
test('refund restore checks the latest allowance after a replacement refund', () => {
  const book = createBook(), expense = book.entries[0];
  book.entries.push(input({ id: 'refund-old', kind: 'refund', categoryId: expense.categoryId, originalId: expense.id, amountMinor: '1000' }));
  const removed = setEntryDeleted(book, 'refund-old', true).book;
  removed.entries.push(input({ id: 'refund-new', kind: 'refund', categoryId: expense.categoryId, originalId: expense.id, amountMinor: '1200' }));
  assert.throws(() => setEntryDeleted(removed, 'refund-old', false), /超过/);
  assert(removed.entries.find(e => e.id === 'refund-old').deletedAt);
});
test('deleted transactions leave lists and description suggestions and stay in exportable history', () => {
  const book = createBook(); const id = book.entries[0].id;
  const deleted = setEntryDeleted(book, id, true).book;
  assert.equal(deleted.entries.length, book.entries.length);
  assert.equal(activeEntries(deleted).length, book.entries.length - 1);
  assert.equal(suggestions(deleted.entries, 'Manner').length, 0);
  assert.equal(suggestions(setEntryDeleted(deleted, id, false).book.entries, 'Manner').length, 1);
});
test('repeated deletion is idempotent and a missing ID fails without a new revision', () => {
  const book = createBook(); const first = setEntryDeleted(book, book.entries[0].id, true);
  const again = setEntryDeleted(first.book, first.entry.id, true);
  assert.equal(again.changed, false); assert.equal(again.entry.revision, 2);
  assert.throws(() => setEntryDeleted(book, 'missing-id', true), /找不到/);
});
