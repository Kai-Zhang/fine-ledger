// All stored amounts are decimal strings of integer minor units. Never use floats for money.
export const COLLECTIONS = ['accounts', 'categories', 'projects', 'transactions', 'sources', 'sessions', 'rates', 'legacy'];
export const DIGITS = { CNY: 2, USD: 2, JPY: 0 };
export const TYPES = { expense: '支出', income: '收入', transfer: '转账', refund: '退款', adjustment: '余额调整' };
export const uid = () => crypto.randomUUID();
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const abs = value => BigInt(value) < 0n ? -BigInt(value) : BigInt(value);
export const sum = values => values.reduce((a, b) => a + BigInt(b), 0n);
export const active = row => !row.deleted && !row.archived;
export function money(value, currency = 'CNY') {
  if (value === null || value === undefined) return '待确认';
  const n = BigInt(value), d = DIGITS[currency], divisor = 10n ** BigInt(d);
  return `${n < 0n ? '−' : ''}${(abs(n) / divisor).toLocaleString('zh-CN')}${d ? '.' + String(abs(n) % divisor).padStart(d, '0') : ''}`;
}
export function decimal(value, currency = 'CNY') {
  const n = BigInt(value), d = DIGITS[currency], divisor = 10n ** BigInt(d);
  return `${n < 0n ? '-' : ''}${abs(n) / divisor}${d ? '.' + String(abs(n) % divisor).padStart(d, '0') : ''}`;
}
export function parseMoney(input, currency = 'CNY', signed = false) {
  if (!(currency in DIGITS)) throw Error('不支持的币种');
  const text = String(input).trim(), digits = DIGITS[currency];
  if (!new RegExp(`^${signed ? '-?' : ''}\\d+(?:\\.\\d{1,${digits || 1}})?$`).test(text) || (!digits && text.includes('.'))) throw Error(`${currency} 金额最多 ${digits} 位小数，请输入完整数字`);
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const value = (BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || 0)) * (text.startsWith('-') ? -1n : 1n);
  if (abs(value) > 999999999999999999n) throw Error('金额过大');
  return String(value);
}
export function roundRatio(numerator, denominator) {
  if (denominator <= 0n) throw Error('分配分母必须大于零');
  const sign = numerator < 0n ? -1n : 1n;
  return sign * ((abs(numerator) + denominator / 2n) / denominator);
}
// Largest remainder, ties broken by stable input order. Sum is exactly total.
export function distribute(total, weights) {
  const t = BigInt(total), ws = weights.map(BigInt), denominator = sum(ws);
  if (ws.some(w => w < 0n) || t < 0n || denominator <= 0n) throw Error('分配金额无效');
  const rows = ws.map((w, i) => ({ i, v: t * w / denominator, r: t * w % denominator }));
  let remainder = t - sum(rows.map(r => r.v));
  for (const row of [...rows].sort((a, b) => a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1)) {
    if (remainder-- > 0n) row.v++;
  }
  return rows.map(r => String(r.v));
}
export function convertMinor(amount, currency, rate) {
  if (currency === 'CNY') return String(amount);
  if (!rate || !/^\d+(\.\d{1,8})?$/.test(rate) || Number(rate) <= 0) return null;
  const [a, b = ''] = rate.split('.');
  return String(roundRatio(BigInt(amount) * BigInt(a + b) * 100n, 10n ** BigInt(b.length + DIGITS[currency])));
}
export function rateFor(state, currency, date = today()) {
  return state.rates.filter(r => active(r) && r.currency === currency && r.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0];
}
export const account = (s, id) => s.accounts.find(a => a.id === id);
export const transactions = s => s.transactions.filter(t => !t.deleted && t.state !== 'voided');
export const posted = s => transactions(s).filter(t => t.state === 'posted');
export function balance(state, id, cutoff = '9999-12-31') {
  return String(sum(posted(state).flatMap(t => (t.postings || []).filter(p => p.accountId === id && p.date <= cutoff).map(p => p.amount))));
}
export function refunded(state, transactionId, splitId, exceptId) {
  return sum(transactions(state).filter(t => t.type === 'refund' && t.id !== exceptId).flatMap(t => t.refunds || []).filter(r => r.transactionId === transactionId && (!splitId || r.splitId === splitId)).map(r => r.amount));
}
export function allocationsFor(state, transactionId) {
  return state.sources.filter(s => !s.deleted).flatMap(s => s.allocations || []).filter(a => a.transactionId === transactionId);
}
export function allocationLimit(state, tx) {
  const principal = abs(tx.postings[0].amount || 0);
  const parts = transactions(state).filter(t => t.type === 'refund').flatMap(t => t.refunds || []).filter(r => r.transactionId === tx.id);
  // Only refunds of unsettled debt reduce future allocation capacity. Historical
  // allocations of already settled debt stay attached to their original source.
  const unpaidRefund = sum(parts.map(r => r.unsettledAccountAmount ?? String(roundRatio(principal * BigInt(r.amount), BigInt(tx.amount)))));
  return principal - unpaidRefund;
}
export function cost(state, tx) {
  if (tx.type === 'refund') {
    let actual = 0n, estimated = 0n, unpriced = false;
    for (const r of tx.refunds) { actual += BigInt(r.actualCost); estimated += BigInt(r.estimatedCost); unpriced ||= r.unpriced; }
    return { actual: String(actual), estimated: String(estimated), unpriced, total: String(actual + estimated) };
  }
  if (tx.type === 'transfer' || tx.type === 'adjustment') return { actual: '0', estimated: '0', total: '0', unpriced: false };
  const p = tx.postings[0], a = account(state, p.accountId);
  if (tx.state === 'posted' && a.currency === 'CNY') return { actual: String(abs(p.amount)), estimated: '0', total: String(abs(p.amount)), unpriced: false };
  if (tx.explicitCost != null) return { actual: tx.explicitCost, estimated: '0', total: tx.explicitCost, unpriced: false };
  const allocations = allocationsFor(state, tx.id), actual = sum(allocations.map(a => a.cny));
  const covered = sum(allocations.map(a => a.amount));
  const principal = tx.state === 'posted' ? abs(p.amount) : 0n;
  let estimate = tx.estimatedCost;
  if (estimate == null) estimate = convertMinor(tx.amount, tx.currency, tx.valuation?.rate || rateFor(state, tx.currency, tx.date)?.rate);
  const remaining = principal ? (principal > covered ? principal - covered : 0n) : 1n;
  const estimated = estimate != null ? (principal ? roundRatio(BigInt(estimate) * remaining, principal) : BigInt(estimate)) : 0n;
  return { actual: String(actual), estimated: String(estimated), total: String(actual + estimated), unpriced: estimate == null && remaining > 0n };
}
export function splitCosts(state, tx) {
  const c = cost(state, tx), weights = tx.splits.map(s => s.amount);
  return distribute(c.total, weights);
}
export function matchesSplit(state, split, scope = {}) {
  if (scope.projectId && split.projectId !== scope.projectId) return false;
  if (scope.categoryId) {
    let id = split.categoryId, found = false;
    while (id) { if (id === scope.categoryId) { found = true; break; } id = state.categories.find(c => c.id === id)?.parentId; }
    if (!found) return false;
  }
  return true;
}
export function report(state, rows, scope = {}) {
  const result = { income: 0n, expense: 0n, refund: 0n, actual: 0n, estimated: 0n, unpriced: [] };
  for (const tx of rows) {
    if (!['expense', 'income', 'refund'].includes(tx.type)) continue;
    let c = cost(state, tx);
    const sign = tx.type === 'refund' ? -1n : 1n;
    if (scope.categoryId || scope.projectId) {
      const splits = tx.type === 'refund' ? tx.refunds : tx.splits;
      const ids = splits.map((s, i) => matchesSplit(state, s, scope) ? i : -1).filter(i => i >= 0);
      if (!ids.length) continue;
      const actuals = tx.type === 'refund' ? splits.map(s => s.actualCost) : distribute(c.actual, splits.map(s => s.amount));
      const estimates = tx.type === 'refund' ? splits.map(s => s.estimatedCost) : distribute(c.estimated, splits.map(s => s.amount));
      const actual = sum(ids.map(i => actuals[i])), estimated = sum(ids.map(i => estimates[i]));
      c = { ...c, actual: String(actual), estimated: String(estimated), total: String(actual + estimated) };
    }
    result[tx.type] += BigInt(c.total);
    result.actual += sign * BigInt(c.actual);
    result.estimated += sign * BigInt(c.estimated);
    if (c.unpriced) result.unpriced.push(`${money(tx.amount, tx.currency)} ${tx.currency} · ${tx.description}`);
  }
  result.net = result.expense - result.refund;
  return result;
}
export function sessionRows(state, session) {
  const used = new Set(state.sessions.filter(s => !s.deleted && s.id !== session.id && s.accountId === session.accountId && s.status === 'completed').flatMap(s => s.checked || []));
  return posted(state).flatMap(t => t.postings.filter(p => p.accountId === session.accountId && p.date <= session.cutoff && p.date > (session.start || '0000-00-00') && !used.has(p.id)).map(p => ({ tx: t, posting: p })));
}
export function sessionFigures(state, session) {
  const rows = sessionRows(state, session), computed = BigInt(balance(state, session.accountId, session.cutoff));
  return { rows, opening: String(computed - sum(rows.map(r => r.posting.amount))), movement: String(sum(rows.map(r => r.posting.amount))), computed: String(computed), difference: String(computed - BigInt(session.external)) };
}
export function affectedSessions(state, before, after) {
  const shape = t => JSON.stringify({ deleted: t?.deleted, state: t?.state, postings: t?.postings });
  if (before && shape(before) === shape(after)) return [];
  const ps = [...(before?.postings || []), ...(after?.postings || [])];
  return state.sessions.filter(s => !s.deleted && s.status === 'completed' && ps.some(p => p.amount != null && p.accountId === s.accountId && p.date <= s.cutoff));
}
function validAmount(v, positive = false) { return typeof v === 'string' && /^-?\d{1,18}$/.test(v) && (!positive || BigInt(v) > 0n); }
export function validateEntity(state, collection, row, before = null) {
  if (!COLLECTIONS.includes(collection) || typeof row.id !== 'string') throw Error('无效的数据对象');
  if (row.deleted) {
    if (collection === 'transactions' && before && (allocationsFor(state, row.id).length || state.sources.some(s => !s.deleted && s.transactionId === row.id) || transactions(state).some(t => t.type === 'refund' && t.refunds?.some(r => r.transactionId === row.id)))) throw Error('该交易已有关联退款或成本来源，请先处理依赖');
    return true;
  }
  if (collection === 'accounts') {
    if (!row.name?.trim() || !(row.currency in DIGITS) || !['cash', 'bank', 'credit'].includes(row.type)) throw Error('请检查账户名称、类型与币种');
    if (before?.currency !== row.currency && before && state.transactions.some(t => t.postings.some(p => p.accountId === row.id))) throw Error('已有流水的账户不能切换币种');
    if (row.limit && !validAmount(row.limit)) throw Error('额度无效');
  }
  if (collection === 'categories') {
    if (!row.name?.trim() || !['expense', 'income'].includes(row.type)) throw Error('分类信息无效');
    let parent = row.parentId, visited = new Set([row.id]);
    while (parent) {
      if (visited.has(parent)) throw Error('分类层级不能形成循环');
      visited.add(parent);
      const p = state.categories.find(c => c.id === parent);
      if (!p || p.type !== row.type) throw Error('父分类必须存在且类型相同');
      parent = p.parentId;
    }
  }
  if (collection === 'projects' && !row.name?.trim()) throw Error('请填写项目名称');
  if (collection === 'rates' && (!['USD', 'JPY'].includes(row.currency) || convertMinor('1', row.currency, row.rate) === null || !row.source?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(row.date))) throw Error('请填写有效汇率、日期和来源');
  if (collection === 'transactions') {
    if (!TYPES[row.type] || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !row.description?.trim() || !(row.currency in DIGITS) || !validAmount(row.amount, row.type !== 'adjustment') || !['pending', 'posted', 'voided'].includes(row.state)) throw Error('请填写完整交易信息');
    if (!Array.isArray(row.postings) || row.postings.length !== (row.type === 'transfer' ? 2 : 1)) throw Error('交易流水数量无效');
    for (const p of row.postings) {
      if (!account(state, p.accountId) || account(state, p.accountId).deleted) throw Error('账户不存在');
      if (row.state === 'posted' && (!validAmount(p.amount) || !/^\d{4}-\d{2}-\d{2}$/.test(p.date))) throw Error('已入账必须填写正式金额与入账日期');
      if (p.amount != null && !validAmount(p.amount)) throw Error('账户金额无效');
    }
    const first = row.postings[0];
    if (row.state === 'posted' && ((row.type === 'expense' && BigInt(first.amount) >= 0n) || (['income', 'refund'].includes(row.type) && BigInt(first.amount) <= 0n))) throw Error('账户流水的收支方向不正确');
    if (row.type === 'transfer') {
      const [a, b] = row.postings;
      if (row.state !== 'posted' || a.accountId === b.accountId || BigInt(a.amount) >= 0n || BigInt(b.amount) <= 0n) throw Error('请选择不同的转出、转入账户并填写本金');
      if (account(state, a.accountId).currency === account(state, b.accountId).currency && abs(a.amount) !== abs(b.amount)) throw Error('同币种转账的两端本金必须相等');
    }
    if (row.state === 'pending' && (row.type !== 'expense' || account(state, first.accountId).type !== 'credit')) throw Error('待入账仅用于信用卡消费');
    if (row.state === 'voided' && (row.type !== 'expense' || before?.state === 'posted')) throw Error('只能撤销尚未入账的消费');
    if (['expense', 'income'].includes(row.type)) {
      if (!row.splits?.length || sum(row.splits.map(s => s.amount)) !== BigInt(row.amount)) throw Error('拆分合计必须精确等于交易本金');
      for (const split of row.splits) {
        const c = state.categories.find(c => c.id === split.categoryId);
        if (!validAmount(split.amount, true) || !c || c.deleted || c.type !== row.type) throw Error('请选择正确类型的分类与拆分金额');
        if (split.projectId && !state.projects.some(p => p.id === split.projectId && !p.deleted)) throw Error('项目不存在');
      }
    }
    if (row.type === 'adjustment' && !row.notes?.trim()) throw Error('余额调整必须填写原因');
    if (row.type === 'refund') {
      if (!row.refunds?.length || row.state !== 'posted') throw Error('退款必须关联原支出拆分项');
      const seen = new Set();
      for (const r of row.refunds) {
        const original = state.transactions.find(t => t.id === r.transactionId && !t.deleted && t.state === 'posted' && t.type === 'expense');
        const split = original?.splits.find(s => s.id === r.splitId);
        if (!split || !validAmount(r.amount, true) || seen.has(r.splitId)) throw Error('请选择有效且不重复的原支出拆分项');
        seen.add(r.splitId);
        if (refunded(state, original.id, split.id, row.id) + BigInt(r.amount) > BigInt(split.amount)) throw Error('退款超过原拆分项的可退金额');
        if (!validAmount(r.received, true) || !validAmount(r.actualCost) || !validAmount(r.estimatedCost)) throw Error('退款分配无效');
      }
      if (sum(row.refunds.map(r => r.received)) !== BigInt(row.amount) || first.amount !== row.amount || account(state, first.accountId).currency !== row.currency) throw Error('到账分配合计必须等于实际退款金额');
    }
    if (row.estimatedCost != null && !validAmount(row.estimatedCost)) throw Error('暂估成本无效');
    if (row.explicitCost != null && !validAmount(row.explicitCost)) throw Error('确认成本无效');
    if (before) {
      const dependentRefunds = state.transactions.some(t => !t.deleted && t.type === 'refund' && t.refunds.some(r => r.transactionId === row.id));
      const dependentCost = allocationsFor(state, row.id).length || state.sources.some(s => !s.deleted && s.transactionId === row.id);
      const economic = t => JSON.stringify({ type: t.type, currency: t.currency, amount: t.amount, state: t.state, postings: t.postings, splits: t.splits?.map(s => ({ id: s.id, amount: s.amount })), deleted: !!t.deleted });
      if ((dependentRefunds || dependentCost) && economic(before) !== economic(row)) throw Error('该交易已关联退款或成本来源；请先处理依赖。可编辑分类、项目和备注');
    }
  }
  if (collection === 'sources' && !row.deleted) {
    const tx = state.transactions.find(t => t.id === row.transactionId && !t.deleted && t.type === 'transfer');
    if (!tx || !validAmount(row.principal, true) || !validAmount(row.cny, true)) throw Error('成本来源必须关联真实转账及两端本金');
    const to = tx.postings[1], from = tx.postings[0];
    if (to.accountId !== row.accountId || to.amount !== row.principal || account(state, to.accountId).currency === 'CNY' || row.currency !== account(state, to.accountId).currency) throw Error('成本来源与转入流水不一致');
    if (!row.parentId && (account(state, from.accountId).currency !== 'CNY' || String(abs(from.amount)) !== row.cny)) throw Error('直接成本来源必须使用实际人民币本金');
    if (row.parentId) {
      const visited = new Set([row.id]);
      let ancestor = row.parentId;
      while (ancestor) { if (visited.has(ancestor)) throw Error('成本来源不能形成循环'); visited.add(ancestor); ancestor = state.sources.find(s => s.id === ancestor)?.parentId; }
      const parent = state.sources.find(s => s.id === row.parentId && !s.deleted);
      if (!parent || parent.accountId !== from.accountId || parent.currency !== row.currency || account(state, from.accountId).currency !== row.currency || abs(from.amount) !== BigInt(row.principal)) throw Error('资金路径与上游成本来源不符');
      const children = state.sources.filter(s => !s.deleted && s.parentId === parent.id && s.id !== row.id);
      const spent = sum(children.map(s => s.principal)) + sum((parent.allocations || []).map(a => a.amount));
      if (spent + BigInt(row.principal) > BigInt(parent.principal)) throw Error('上游来源的外币本金不足');
      const expected = roundRatio(BigInt(parent.cny) * (spent + BigInt(row.principal)), BigInt(parent.principal)) - roundRatio(BigInt(parent.cny) * spent, BigInt(parent.principal));
      if (BigInt(row.cny) !== expected) throw Error('下游成本必须沿用上游人民币成本');
    }
    const all = row.allocations || [], children = state.sources.filter(s => !s.deleted && s.parentId === row.id);
    const used = sum(all.map(a => a.amount)) + sum(children.map(s => s.principal));
    const usedCost = sum(all.map(a => a.cny)) + sum(children.map(s => s.cny));
    if (used > BigInt(row.principal) || usedCost > BigInt(row.cny)) throw Error('成本来源不能超额使用');
    if (usedCost !== roundRatio(BigInt(row.cny) * used, BigInt(row.principal))) throw Error('已分配成本与来源实际本金比例不一致');
    const seen = new Set();
    for (const a of all) {
      const target = state.transactions.find(t => t.id === a.transactionId && !t.deleted && t.state === 'posted' && t.type === 'expense');
      const allocationId = a.id || a.transactionId;
      if (!target || target.postings[0].accountId !== row.accountId || !validAmount(a.amount, true) || !validAmount(a.cny) || seen.has(allocationId)) throw Error('消费分配无效或重复');
      seen.add(allocationId);
      const other = state.sources.filter(s => !s.deleted && s.id !== row.id).flatMap(s => s.allocations || []).filter(x => x.transactionId === target.id);
      if (sum(other.map(x => x.amount)) + sum(all.filter(x => x.transactionId === target.id).map(x => x.amount)) > allocationLimit(state, target)) throw Error('分配超过未退款、未结算的消费本金');
    }
    if (before && JSON.stringify(before.allocations || []) !== JSON.stringify(all.slice(0, (before.allocations || []).length))) throw Error('已确认分配不可静默重排或改写；允许追加新分配');
  }
  if (collection === 'sessions') {
    if (!account(state, row.accountId) || !/^\d{4}-\d{2}-\d{2}$/.test(row.cutoff) || !validAmount(row.external)) throw Error('对账信息不完整');
    if (row.status === 'completed') {
      const f = sessionFigures(state, row);
      if (f.difference !== '0' || f.rows.some(r => !(row.checked || []).includes(r.posting.id))) throw Error('差额为零且逐项核对后才能完成');
    }
  }
  return true;
}
export function validateState(state) {
  if (!state || COLLECTIONS.some(k => !Array.isArray(state[k]))) throw Error('备份结构不完整');
  for (const key of COLLECTIONS) {
    if (new Set(state[key].map(r => r.id)).size !== state[key].length) throw Error('备份包含重复 ID');
    for (const row of state[key]) validateEntity(state, key, row);
  }
  const usedPostings = new Set();
  for (const session of state.sessions.filter(s => !s.deleted && s.status === 'completed')) {
    for (const postingId of session.checked || []) {
      const p = posted(state).flatMap(t => t.postings).find(p => p.id === postingId);
      if (!p || p.accountId !== session.accountId || p.date > session.cutoff || p.date <= (session.start || '0000-00-00')) throw Error('对账明细必须是该账户、该期间的已入账流水');
      if (usedPostings.has(postingId)) throw Error('同一流水不能归入多个有效对账批次');
      usedPostings.add(postingId);
    }
  }
  return true;
}
export function makeRefundPart(state, original, split, amount, received) {
  const c = cost(state, original), principal = abs(original.postings[0].amount), originalAmount = BigInt(original.amount);
  const prior = transactions(state).filter(t => t.type === 'refund').flatMap(t => t.refunds).filter(r => r.transactionId === original.id);
  const previousQuantity = sum(prior.map(r => r.amount));
  const accountQuantity = roundRatio(principal * (previousQuantity + BigInt(amount)), originalAmount) - roundRatio(principal * previousQuantity, originalAmount);
  const a = account(state, original.postings[0].accountId);
  const covered = a.currency === 'CNY' || original.explicitCost != null ? principal : sum(allocationsFor(state, original.id).map(a => a.amount));
  const priorUnsettled = sum(prior.map(r => r.unsettledAccountAmount || '0')), priorSettled = sum(prior.map(r => r.settledAccountAmount || '0'));
  const unpaid = principal - covered - priorUnsettled;
  const unsettled = unpaid > accountQuantity ? accountQuantity : unpaid > 0n ? unpaid : 0n, settled = accountQuantity - unsettled;
  const actualCost = covered ? roundRatio(BigInt(c.actual) * (priorSettled + settled), covered) - roundRatio(BigInt(c.actual) * priorSettled, covered) : 0n;
  const unallocated = principal - covered;
  const estimatedCost = unallocated ? roundRatio(BigInt(c.estimated) * (priorUnsettled + unsettled), unallocated) - roundRatio(BigInt(c.estimated) * priorUnsettled, unallocated) : 0n;
  return { transactionId: original.id, splitId: split.id, amount, received, categoryId: split.categoryId, projectId: split.projectId, actualCost: String(actualCost), estimatedCost: String(estimatedCost), unsettledAccountAmount: String(unsettled), settledAccountAmount: String(settled), unpriced: c.unpriced, originalCurrency: original.currency };
}
export function seedState() {
  const day = today(), month = day.slice(0, 7), dt = n => `${month}-${String(Math.min(Number(day.slice(8)), n)).padStart(2, '0')}`;
  const accounts = [
    { id: 'bank-cny', name: '招商银行 · 储蓄卡', type: 'bank', currency: 'CNY', group: '日常资金', netWorth: true },
    { id: 'cash-cny', name: '日常现金', type: 'cash', currency: 'CNY', group: '日常资金', netWorth: true },
    { id: 'cc-cny', name: '招商信用卡 · 人民币', type: 'credit', currency: 'CNY', group: '信用卡', limit: '5000000', netWorth: true },
    { id: 'cc-usd', name: '海外信用卡 · 美元', type: 'credit', currency: 'USD', group: '信用卡', limit: '1000000', netWorth: true },
    { id: 'bank-usd', name: '外币储蓄 · 美元', type: 'bank', currency: 'USD', group: '外币资金', netWorth: true },
    { id: 'cash-jpy', name: '旅行现金 · 日元', type: 'cash', currency: 'JPY', group: '外币资金', netWorth: true }
  ];
  const categories = [
    { id: 'food', name: '餐饮', type: 'expense' }, { id: 'coffee', name: '咖啡茶饮', type: 'expense', parentId: 'food' }, { id: 'meal', name: '三餐', type: 'expense', parentId: 'food' },
    { id: 'travel', name: '交通住宿', type: 'expense' }, { id: 'hotel', name: '住宿', type: 'expense', parentId: 'travel' }, { id: 'transport', name: '交通', type: 'expense', parentId: 'travel' },
    { id: 'shopping', name: '购物', type: 'expense' }, { id: 'daily', name: '生活日用', type: 'expense', parentId: 'shopping' }, { id: 'digital', name: '数码订阅', type: 'expense', parentId: 'shopping' },
    { id: 'fee', name: '手续费', type: 'expense' }, { id: 'salary', name: '工资薪金', type: 'income' }, { id: 'other-income', name: '其他收入', type: 'income' }
  ];
  const state = { schemaVersion: 1, accounts, categories, projects: [{ id: 'japan', name: '京都秋日旅行', start: `${month}-01`, end: `${month}-31`, notes: '合成样例 · 预订和退款可在旅行日期之外' }], transactions: [], sources: [], sessions: [], rates: [ { id: 'usd-ref', currency: 'USD', rate: '7.20', date: `${month}-01`, source: 'Demo 人工参考汇率' }, { id: 'jpy-ref', currency: 'JPY', rate: '0.048', date: `${month}-01`, source: 'Demo 人工参考汇率' } ], legacy: [{ id: 'legacy-budget', type: '预算历史示例', name: '演示预算（仅归档）', raw: { limit: '200000', currency: 'CNY', tags: ['旧旅行标签'], note: '合成占位记录，不是真实 MoneyWiz 数据' } }] };
  const add = (id, type, amount, currency, accountId, description, categoryId, date, extra = {}) => {
    const signed = ['expense'].includes(type) ? String(-BigInt(amount)) : amount;
    state.transactions.push({ id, type, amount, currency, date, description, notes: '', state: 'posted', postings: [{ id: `${id}-p`, accountId, amount: signed, date }], splits: ['expense', 'income'].includes(type) ? [{ id: `${id}-s`, amount, categoryId, projectId: null }] : [], ...extra });
  };
  add('opening-bank', 'adjustment', '2800000', 'CNY', 'bank-cny', '期初余额', null, `${month}-01`, { notes: '演示账本期初资金' });
  add('opening-cash', 'adjustment', '50000', 'CNY', 'cash-cny', '期初余额', null, `${month}-01`, { notes: '演示现金期初' });
  add('opening-jpy', 'adjustment', '20000', 'JPY', 'cash-jpy', '旅行现金期初', null, `${month}-01`, { notes: '期初资产，CNY 成本待核定' });
  add('salary-demo', 'income', '1800000', 'CNY', 'bank-cny', '本月工资', 'salary', dt(10));
  add('hotel-demo', 'expense', '10000', 'JPY', 'cc-cny', '京都酒店 · 待银行确认', 'hotel', dt(19), { state: 'pending', estimatedCost: '48240', observations: [{ currency: 'USD', amount: '6700', date: dt(19), source: '银行 App 显示' }], postings: [{ id: 'hotel-demo-p', accountId: 'cc-cny', amount: null, date: null }], splits: [{ id: 'hotel-demo-s', amount: '10000', categoryId: 'hotel', projectId: 'japan' }] });
  add('usd-40', 'expense', '4000', 'USD', 'cc-usd', '海外订阅 · 工作软件', 'digital', dt(12));
  add('usd-60', 'expense', '6000', 'USD', 'cc-usd', '旅行用品 · 海外订单', 'daily', dt(14), { splits: [{ id: 'usd-60-s', amount: '6000', categoryId: 'daily', projectId: 'japan' }] });
  add('daily-split', 'expense', '12880', 'CNY', 'bank-cny', '超市采购', 'daily', dt(23), { splits: [{ id: 'split-food', amount: '4880', categoryId: 'meal', projectId: null }, { id: 'split-daily', amount: '8000', categoryId: 'daily', projectId: null }] });
  add('coffee-demo', 'expense', '2800', 'CNY', 'bank-cny', '街角咖啡', 'coffee', day);
  const original = state.transactions.find(t => t.id === 'daily-split');
  add('refund-demo', 'refund', '2000', 'CNY', 'bank-cny', '超市退货', null, dt(24), { refunds: [makeRefundPart(state, original, original.splits[1], '2000', '2000')] });
  for (const k of COLLECTIONS) for (const row of state[k]) { row.revision = 1; row.updatedAt = new Date().toISOString(); }
  return state;
}
