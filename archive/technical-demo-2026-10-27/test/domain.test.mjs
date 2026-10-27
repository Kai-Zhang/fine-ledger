import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../public/domain.js';
const fixture = () => structuredClone(D.seedState());
const tx = (s, id) => s.transactions.find(t => t.id === id);
function repayment(s, amount = '72000', principal = '10000', to = 'cc-usd', from = 'bank-cny') {
  const id = D.uid();
  const transaction = { id, type: 'transfer', currency: D.account(s, from).currency, amount, description: '还款测试', notes: '', date: D.today(), state: 'posted', postings: [{ id: D.uid(), accountId: from, amount: String(-BigInt(amount)), date: D.today() }, { id: D.uid(), accountId: to, amount: principal, date: D.today() }], splits: [] };
  s.transactions.push(transaction);
  const source = { id: D.uid(), transactionId: id, accountId: to, currency: D.account(s, to).currency, principal, cny: amount, allocations: [], date: D.today() };
  s.sources.push(source); return source;
}
test('seed is valid and pending amount is null, not zero; adjustments excluded from report', () => {
  const s = fixture(); assert.equal(D.validateState(s), true);
  assert.equal(D.balance(s, 'cc-cny'), '0'); assert.equal(tx(s, 'hotel-demo').postings[0].amount, null);
  assert.equal(D.report(s, D.transactions(s)).income, 1800000n);
});
test('money parses exactly, JPY forbids decimals, and very large integers round trip', () => {
  assert.equal(D.parseMoney('1234567891234567.89'), '123456789123456789');
  assert.equal(D.decimal('123456789123456789'), '1234567891234567.89');
  assert.equal(D.parseMoney('10000', 'JPY'), '10000');
  assert.throws(() => D.parseMoney('100.5', 'JPY'));
  for (const value of ['1.001', '1e3', 'NaN', '-1', '1,000']) assert.throws(() => D.parseMoney(value));
});
test('deterministic remainder conserves every CNY cent', () => {
  assert.deepEqual(D.distribute('100', ['1', '1', '1']), ['34', '33', '33']);
  for (let n = 1; n < 100; n++) assert.equal(D.sum(D.distribute(String(n), ['13', '17', '71'])), BigInt(n));
});
test('same pending JPY transaction updates to actual CNY 490 without double count; USD observation preserved', () => {
  const s = fixture(), t = tx(s, 'hotel-demo'), before = D.cost(s, t);
  assert.equal(before.total, '48240');
  t.state = 'posted'; t.postings[0].amount = '-49000'; t.postings[0].date = D.today();
  D.validateState(s); assert.equal(D.cost(s, t).actual, '49000'); assert.equal(D.cost(s, t).estimated, '0');
  assert.equal(D.balance(s, 'cc-cny'), '-49000'); assert.equal(t.amount, '10000'); assert.equal(t.observations[0].amount, '6700');
  assert.equal(s.transactions.filter(x => x.id === t.id).length, 1);
  const r = repayment(s, '49000', '49000', 'cc-cny'); s.sources = s.sources.filter(x => x.id !== r.id);
  assert.equal(D.cost(s, t).actual, '49000'); assert.equal(D.balance(s, 'cc-cny'), '0');
});
test('pending void removes expense estimate and creates no refund; posted void rejected', () => {
  const s = fixture(), t = tx(s, 'hotel-demo'); t.state = 'voided';
  D.validateState(s); assert.equal(D.transactions(s).some(x => x.id === t.id), false); assert.equal(s.transactions.filter(t => t.type === 'refund').length, 1);
  assert.throws(() => D.validateEntity(s, 'transactions', { ...tx(s, 'usd-40'), state: 'voided' }, tx(s, 'usd-40')));
});
test('splits must balance exactly, category cycles rejected, account currency immutable after posting', () => {
  const s = fixture(), t = structuredClone(tx(s, 'daily-split')); t.splits[0].amount = '4881';
  assert.throws(() => D.validateEntity(s, 'transactions', t));
  assert.throws(() => D.validateEntity(s, 'categories', { ...s.categories.find(c => c.id === 'food'), parentId: 'coffee' }));
  const a = s.accounts[0]; assert.throws(() => D.validateEntity(s, 'accounts', { ...a, currency: 'USD' }, a));
});
test('100 USD / 720 CNY repayment allocates 288 + 432 without adding an expense', () => {
  const s = fixture(), initial = D.report(s, D.transactions(s)).expense, source = repayment(s);
  source.allocations = [{ transactionId: 'usd-40', amount: '4000', cny: '28800' }, { transactionId: 'usd-60', amount: '6000', cny: '43200' }];
  D.validateState(s); assert.equal(D.cost(s, tx(s, 'usd-40')).actual, '28800'); assert.equal(D.cost(s, tx(s, 'usd-60')).actual, '43200');
  assert.equal(D.report(s, D.transactions(s)).expense, initial); assert.equal(D.balance(s, 'cc-usd'), '0');
});
test('partial settlement preserves first confirmed cost; second source adds actual cost', () => {
  const s = fixture(); s.transactions = s.transactions.filter(t => t.id !== 'usd-60');
  const t = tx(s, 'usd-40'); t.amount = '10000'; t.postings[0].amount = '-10000'; t.splits[0].amount = '10000';
  const a = repayment(s, '28800', '4000'); a.allocations = [{ transactionId: t.id, amount: '4000', cny: '28800' }];
  assert.deepEqual(D.cost(s, t), { actual: '28800', estimated: '43200', total: '72000', unpriced: false });
  const b = repayment(s, '44400', '6000'); b.allocations = [{ transactionId: t.id, amount: '6000', cny: '44400' }];
  D.validateState(s); assert.equal(D.cost(s, t).actual, '73200'); assert.equal(D.cost(s, t).estimated, '0');
});
test('linked partial refunds inherit category/project, enforce cap and retain settlement allocations', () => {
  const s = fixture(), t = tx(s, 'usd-60'), source = repayment(s, '43200', '6000');
  source.allocations = [{ transactionId: t.id, amount: '6000', cny: '43200' }];
  const part = D.makeRefundPart(s, t, t.splits[0], '2000', '14400');
  const refund = { id: D.uid(), type: 'refund', currency: 'CNY', amount: '14400', description: '跨币种退款', date: D.today(), state: 'posted', postings: [{ id: D.uid(), accountId: 'bank-cny', amount: '14400', date: D.today() }], splits: [], refunds: [part] };
  s.transactions.push(refund); D.validateState(s);
  assert.equal(part.actualCost, '14400'); assert.equal(part.projectId, 'japan'); assert.equal(D.cost(s, t).actual, '43200');
  refund.refunds[0].amount = '6001'; assert.throws(() => D.validateState(s));
});
test('unsettled refund prevents repayment allocation to refunded debt', () => {
  const s = fixture(), t = tx(s, 'usd-60');
  const refund = { id: D.uid(), type: 'refund', currency: 'USD', amount: '2000', description: '尚未结算退款', date: D.today(), state: 'posted', postings: [{ id: D.uid(), accountId: 'cc-usd', amount: '2000', date: D.today() }], splits: [], refunds: [D.makeRefundPart(s, t, t.splits[0], '2000', '2000')] };
  s.transactions.push(refund); assert.equal(D.allocationLimit(s, t), 4000n);
  const source = repayment(s, '43200', '6000'); source.allocations = [{ transactionId: t.id, amount: '6000', cny: '43200' }];
  assert.throws(() => D.validateState(s));
});
test('FX purchase then repayment passes original cost source exactly once', () => {
  const s = fixture(), parent = repayment(s, '72000', '10000', 'bank-usd');
  const id = D.uid();
  s.transactions.push({ id, type: 'transfer', currency: 'USD', amount: '10000', description: '外币储蓄还款', date: D.today(), state: 'posted', splits: [], postings: [{ id: D.uid(), accountId: 'bank-usd', amount: '-10000', date: D.today() }, { id: D.uid(), accountId: 'cc-usd', amount: '10000', date: D.today() }] });
  s.sources.push({ id: D.uid(), transactionId: id, accountId: 'cc-usd', currency: 'USD', principal: '10000', cny: '72000', parentId: parent.id, allocations: [{ transactionId: 'usd-40', amount: '4000', cny: '28800' }, { transactionId: 'usd-60', amount: '6000', cny: '43200' }] });
  D.validateState(s); assert.equal(D.balance(s, 'bank-usd'), '0');
  parent.allocations.push({ transactionId: 'usd-40', amount: '1', cny: '7' }); assert.throws(() => D.validateState(s));
});
test('unpriced amount marks report incomplete instead of quietly counting as zero', () => {
  const s = fixture(); s.rates = []; const t = tx(s, 'usd-40');
  assert.equal(D.cost(s, t).unpriced, true); assert.ok(D.report(s, [t]).unpriced.length);
  assert.equal(D.convertMinor('10000', 'USD', '7.20'), '72000'); assert.equal(D.convertMinor('10000', 'JPY', '.048'), null); assert.equal(D.convertMinor('10000', 'JPY', '0.048'), '48000');
});
test('reconciliation excludes pending, rejects nonzero difference and catches late bank posting date', () => {
  const s = fixture(), session = { id: 'session', accountId: 'cc-cny', cutoff: D.today(), external: '0', status: 'completed', checked: [] };
  s.sessions.push(session); assert.equal(D.sessionFigures(s, session).rows.length, 0); D.validateState(s);
  assert.throws(() => D.validateEntity(s, 'sessions', { ...session, external: '1' }));
  const t = tx(s, 'hotel-demo'), next = { ...t, state: 'posted', postings: [{ ...t.postings[0], amount: '-49000', date: D.today() }] };
  assert.equal(D.affectedSessions(s, t, next).length, 1);
  next.postings[0].date = '2099-01-01'; assert.equal(D.affectedSessions(s, t, next).length, 0);
});
test('completed reconciliations reject pending, unknown or duplicate postings', () => {
  const s = fixture();
  const session = { id: 'cash-session', accountId: 'cash-cny', cutoff: D.today(), external: '50000', status: 'completed', checked: ['opening-cash-p'] };
  s.sessions.push(session); D.validateState(s);
  s.sessions.push({ ...session, id: 'duplicate-session' }); assert.throws(() => D.validateState(s));
  s.sessions.pop(); session.checked.push('hotel-demo-p'); assert.throws(() => D.validateState(s));
});
test('linked originals cannot be deleted and tombstones do not break backup state validation', () => {
  const s = fixture(), original = tx(s, 'daily-split');
  assert.throws(() => D.validateEntity(s, 'transactions', { ...original, deleted: true }, original));
  tx(s, 'refund-demo').deleted = true; original.deleted = true; D.validateState(s);
});
test('category and project filters count matching split amounts, never the full transaction twice', () => {
  const s = fixture(), t = tx(s, 'daily-split');
  t.splits[1].projectId = 'japan';
  assert.equal(D.report(s, [t], { categoryId: 'food' }).expense, 4880n);
  assert.equal(D.report(s, [t], { projectId: 'japan' }).expense, 8000n);
  assert.equal(D.report(s, [t], { projectId: 'japan', categoryId: 'food' }).expense, 0n);
  assert.equal(D.report(s, [t], { projectId: 'japan', categoryId: 'shopping' }).expense, 8000n);
});
