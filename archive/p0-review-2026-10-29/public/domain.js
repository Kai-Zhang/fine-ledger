export const SCHEMA = 1;
export const currencySymbol = { CNY: '¥', USD: '$', JPY: '¥' };
const digits = c => c === 'JPY' ? 0 : 2;
export function minor(value, currency = 'CNY', signed = false) {
  const raw = String(value).trim();
  const d = digits(currency);
  if (!(signed ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/).test(raw)) throw Error('请填写有效金额');
  const negative = raw.startsWith('-');
  const [whole, fraction = ''] = raw.replace('-', '').split('.');
  if (fraction.length > d) throw Error(d ? '金额最多保留两位小数' : '日元金额不含小数');
  const amount = BigInt(whole) * 10n ** BigInt(d) + BigInt(fraction.padEnd(d, '0') || 0);
  if (amount > 99999999999999n) throw Error('金额超出支持范围');
  return (negative ? -amount : amount).toString();
}
export function decimal(value, currency = 'CNY') {
  const n = BigInt(value); const d = digits(currency); const a = n < 0n ? -n : n;
  const s = a.toString().padStart(d + 1, '0');
  return `${n < 0n ? '-' : ''}${d ? s.slice(0, -d) + '.' + s.slice(-d) : s}`;
}
export function money(value, currency = 'CNY', symbol = true) {
  const s = decimal(value, currency); const [integer, fraction] = s.replace('-', '').split('.');
  return `${s.startsWith('-') ? '−' : ''}${symbol ? currencySymbol[currency] || currency : ''}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction === undefined ? '' : '.' + fraction}`;
}
export function delta(entry, accountId) {
  if (entry.deletedAt) return 0n;
  const n = BigInt(entry.amountMinor);
  if (entry.kind === 'transfer') return entry.accountId === accountId ? -n : entry.toAccountId === accountId ? n : 0n;
  if (entry.accountId !== accountId) return 0n;
  return entry.kind === 'expense' ? -n : n;
}
export function balance(book, accountId) {
  const account = book.accounts.find(a => a.id === accountId);
  return book.entries.reduce((sum, t) => sum + delta(t, accountId), BigInt(account.openingMinor)).toString();
}
export function refundable(book, id) {
  const t = book.entries.find(e => e.id === id);
  if (!t || t.deletedAt || t.kind !== 'expense') return '0';
  return (BigInt(t.amountMinor) - book.entries.filter(e => !e.deletedAt && e.kind === 'refund' && e.originalId === id).reduce((s, e) => s + BigInt(e.amountMinor), 0n)).toString();
}
export const activeEntries = book => book.entries.filter(entry => !entry.deletedAt);
export function accountGroups(book) {
  const definitions = [{ id: 'savings', name: '现金与储蓄' }, { id: 'wallets', name: '日常支付' }, { id: 'credit', name: '信用卡' }];
  return definitions.map(group => {
    const accounts = book.accounts.filter(a => (a.type === 'credit' ? 'credit' : a.type === 'wallet' ? 'wallets' : 'savings') === group.id);
    const totals = {};
    for (const a of accounts) totals[a.currency] = ((BigInt(totals[a.currency] || '0')) + BigInt(balance(book, a.id))).toString();
    return { ...group, accounts, totals };
  }).filter(group => group.accounts.length);
}
export function setEntryDeleted(book, id, deleted, timestamp = new Date().toISOString()) {
  const index = book.entries.findIndex(entry => entry.id === id);
  if (index < 0) throw Error('找不到这笔记录');
  const entry = book.entries[index];
  if (Boolean(entry.deletedAt) === deleted) return { book, entry, changed: false };
  if (deleted && entry.kind === 'expense' && book.entries.some(e => !e.deletedAt && e.kind === 'refund' && e.originalId === id)) throw Error('这笔消费有关联退款，请先删除退款记录');
  const revised = { ...entry, revision: (entry.revision || 1) + 1, updatedAt: timestamp, deletedAt: deleted ? timestamp : null };
  if (!deleted) validateEntry(book, revised);
  const entries = [...book.entries]; entries[index] = revised;
  return { book: { ...book, entries }, entry: revised, changed: true };
}
export const normalize = v => v.normalize('NFKC').trim().toLocaleLowerCase();
export function suggestions(entries, query = '', kind = 'expense', limit = 8) {
  const q = normalize(query); const unique = new Map();
  [...entries].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || (b.createdAt || '').localeCompare(a.createdAt || '')).forEach(e => {
    const key = normalize(e.description);
    if (!e.deletedAt && e.kind === kind && key && !unique.has(key)) unique.set(key, e);
  });
  return [...unique.values()].filter(e => normalize(e.description).includes(q)).sort((a, b) => Number(normalize(b.description).startsWith(q)) - Number(normalize(a.description).startsWith(q))).slice(0, limit);
}
export function localMinute(date = new Date()) {
  const part = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
}
export function validateEntry(book, entry) {
  const account = book.accounts.find(a => a.id === entry.accountId);
  if (!account) throw Error('请选择账户');
  if (!['expense', 'income', 'transfer', 'refund', 'adjustment'].includes(entry.kind)) throw Error('交易类型无效');
  if (!/^-?\d+$/.test(entry.amountMinor)) throw Error('金额格式无效');
  const n = BigInt(entry.amountMinor);
  if (entry.kind !== 'adjustment' && n <= 0n) throw Error('金额需要大于 0');
  if (!entry.description?.trim()) throw Error('请填写描述');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(entry.occurredAt) || !Number.isFinite(Date.parse(entry.occurredAt))) throw Error('请选择有效时间');
  if (['expense', 'income'].includes(entry.kind) && !book.categories.some(g => g.kind === entry.kind && g.children.some(c => c.id === entry.categoryId))) throw Error('请选择对应的二级类目');
  if (entry.kind === 'refund') {
    const original = book.entries.find(e => !e.deletedAt && e.id === entry.originalId && e.kind === 'expense');
    if (!original || original.accountId !== entry.accountId) throw Error('退款需关联有效消费并退回原账户');
    if (n > BigInt(refundable(book, original.id))) throw Error('退款金额超过剩余可退金额');
    if (entry.categoryId !== original.categoryId || entry.project !== original.project) throw Error('退款应沿用原记录的类目和项目');
  }
  if (entry.kind === 'transfer') {
    const target = book.accounts.find(a => a.id === entry.toAccountId);
    if (!target || target.id === account.id) throw Error('请选择另一个转入账户');
    if (target.currency !== account.currency) throw Error('请选择同币种转入账户');
  }
  return entry;
}
