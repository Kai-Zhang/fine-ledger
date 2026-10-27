import { money, decimal, minor, balance, delta, suggestions, refundable, localMinute, normalize } from './domain.js';
import { loadBook, saveEntry, readDraft, writeDraft, exportBook } from './storage.js';

const paths = {
  accounts: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18m-5 5h2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  chart: '<path d="M4 3v17h17M9 15V9m5 6V5m5 10v-4"/>',
  settings: '<path d="m12 3 2 3 3-.2.2 3 3 2-3 2-.2 3-3-.2-2 3-2-3-3 .2-.2-3-3-2 3-2 .2-3L10 6Z"/><circle cx="12" cy="11" r="2.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m14 5-7 7 7 7M7 12h14"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  cup: '<path d="M5 8h12v7a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5Zm12 1h2a3 3 0 1 1 0 6h-2M8 3v2m5-2v2"/>',
  train: '<rect x="5" y="3" width="14" height="15" rx="4"/><path d="M5 10h14M8 21l2-3m6 3-2-3M8 14h1m6 0h1"/>',
  bag: '<path d="M5 8h14l1 13H4ZM8 8V6a4 4 0 0 1 8 0v2"/>',
  home: '<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  income: '<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  cash: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M5 12h.01M19 12h.01"/>',
  card: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="M2 9h20M6 15h4"/>',
  transfer: '<path d="M3 7h17l-4-4M21 17H4l4 4"/>',
  refund: '<path d="M4 10h10a6 6 0 0 1 0 12M4 10l6-6M4 10l6 6"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.list}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const app = document.querySelector('#app'), sheet = document.querySelector('#sheet');
let book, view = 'accounts', currentAccount = null, filter = 'all', search = '', hiddenAmounts = false;
let editor = null, focusBeforeSheet, saveBusy = false, suggestionIndex = -1, toastTimer, swReady = false;
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('fine-ledger-p0-review') : null;
const kindName = { expense: '支出', income: '收入', refund: '退款', transfer: '转账', adjustment: '余额调整' };
const category = id => { for (const g of book.categories) { const c = g.children.find(x => x.id === id); if (c) return { ...c, parent: g.name, icon: g.icon }; } return { name: '不计收支', parent: '', icon: 'transfer' }; };
const account = id => book.accounts.find(a => a.id === id);
const sorted = entries => [...entries].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.createdAt.localeCompare(a.createdAt));
const shownMoney = (v, c = 'CNY') => hiddenAmounts ? '••••••' : money(v, c);
const dateKey = iso => localMinute(new Date(iso)).slice(0, 10);
function dayLabel(iso) {
  const key = dateKey(iso), today = new Date(), yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (key === dateKey(today)) return '今天'; if (key === dateKey(yesterday)) return '昨天';
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}
const time = iso => new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
function totals() {
  const month = localMinute().slice(0, 7); const result = { income: 0n, expense: 0n, refund: 0n };
  book.entries.forEach(t => { if (account(t.accountId).currency === 'CNY' && dateKey(t.occurredAt).startsWith(month) && Object.hasOwn(result, t.kind)) result[t.kind] += BigInt(t.amountMinor); });
  return result;
}
function accountMark(a) { return `<span class="account-mark ${a.color}">${['card', 'cash'].includes(a.mark) ? icon(a.mark) : esc(a.mark)}</span>`; }
function navButton(id, name, ico) { return `<button class="nav-item ${view === id ? 'active' : ''}" data-view="${id}">${icon(ico)}<span>${name}</span>${view === id ? '<i></i>' : ''}</button>`; }
function render() {
  const a = currentAccount && account(currentAccount);
  app.innerHTML = `<aside class="sidebar">
    <a href="#accounts" class="brand" data-action="home"><span class="brand-icon">${icon('list')}</span><strong>厘序</strong><span class="brand-en">FINE LEDGER</span></a>
    <div class="book-label">我的账本 <span>个人</span></div>
    <nav aria-label="主导航">${navButton('accounts', '账户', 'accounts')}${navButton('transactions', '全部交易', 'list')}${navButton('insights', '收支概览', 'chart')}</nav>
    <div class="side-accounts"><div class="side-label">常用账户</div>${book.accounts.slice(0, 4).map(a => `<button class="side-account ${currentAccount === a.id ? 'selected' : ''}" data-account="${a.id}">${accountMark(a)}<span>${a.name}</span>${icon('arrow')}</button>`).join('')}</div>
    <div class="sidebar-bottom">${navButton('settings', '设置', 'settings')}<div class="profile"><span class="avatar">序</span><div>我的日常<small>一笔一笔，井然有序</small></div></div></div>
  </aside>
  <div class="workspace"><header class="topbar"><div class="breadcrumb">我的账本 <span>/</span> ${a ? esc(a.name) : ({ accounts: '账户', transactions: '全部交易', insights: '收支概览', settings: '设置' })[view]}</div><div class="topbar-right"><span class="sample-tag">示例账本</span><span class="today">${new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</span><button class="icon-button" data-action="privacy" aria-label="${hiddenAmounts ? '显示' : '隐藏'}金额" aria-pressed="${hiddenAmounts}">${icon('eye')}</button></div></header>
  <main id="main">${view === 'accounts' ? overview() : view === 'transactions' ? register() : view === 'insights' ? insights() : settings()}</main>
  <footer class="page-footer"><span>厘序 <span class="footer-dot">·</span> 记录生活的分寸</span><span>P0 / 交互原型</span></footer></div>
  <nav class="mobile-nav" aria-label="底部导航">${navButton('accounts', '账户', 'accounts')}${navButton('transactions', '交易', 'list')}${navButton('insights', '概览', 'chart')}${navButton('settings', '设置', 'settings')}</nav>`;
  if (view === 'transactions') document.querySelector('#transaction-search').value = search;
}
function overview() {
  const net = book.accounts.filter(a => a.currency === 'CNY').reduce((s, a) => s + BigInt(balance(book, a.id)), 0n);
  const sum = totals();
  return `<div class="page-heading"><div><p class="eyebrow">让每一笔，井然有序</p><h1>我的账户<span class="title-dot">.</span></h1></div><button class="button primary" data-action="new">${icon('plus')}记一笔</button></div>
  <section class="overview-summary" aria-label="本月账本摘要"><div class="net"><span class="summary-label">人民币净余额</span><strong class="net-value">${shownMoney(net.toString())}</strong><small>人民币账户合计 · 外币按原币单独展示</small><div class="summary-art" aria-hidden="true"><span></span><span></span><span></span><i>序</i></div></div><div class="month-summary"><span class="summary-label">${new Date().getMonth() + 1} 月收支 <span>仅人民币</span></span><div><p>本月支出<strong>${shownMoney(sum.expense.toString())}</strong></p><p>本月收入<strong class="income-text">${shownMoney(sum.income.toString())}</strong></p></div><span class="summary-note">退款 ${shownMoney(sum.refund.toString())} <span>·</span> 不计转账与余额调整</span></div></section>
  <section class="account-section"><div class="section-heading"><h2>现金与储蓄 <span>04</span></h2><span class="section-help">选择账户，查看交易</span></div><div class="account-grid">${book.accounts.filter(a => a.type !== 'credit').map(accountCard).join('')}</div></section>
  <section class="account-section credit-section"><div class="section-heading"><h2>信用卡 <span>02</span></h2><span class="section-help">负数表示待偿余额</span></div><div class="account-grid">${book.accounts.filter(a => a.type === 'credit').map(accountCard).join('')}</div></section>
  <section class="recent-section"><div class="section-heading"><h2>最近交易</h2><button class="text-button" data-view="transactions">查看全部 ${icon('arrow')}</button></div><div class="transaction-list compact">${sorted(book.entries).slice(0, 4).map(t => transactionRow(t)).join('')}</div></section>`;
}
function accountCard(a) {
  return `<article class="account-card"><button class="account-card-main" data-account="${a.id}" aria-label="查看${a.name}交易"><div class="account-card-top">${accountMark(a)}<span class="currency-tag">${a.currency}</span></div><h3>${a.name}</h3><p>${a.subtitle}</p><strong class="account-balance">${shownMoney(balance(book, a.id), a.currency)}</strong></button><div class="account-card-bottom"><button class="text-button" data-account="${a.id}">交易记录 ${icon('arrow')}</button><button class="quick-add" data-new-account="${a.id}" aria-label="用${a.name}记一笔">${icon('plus')}</button></div></article>`;
}
function transactionRow(t) {
  const a = account(t.accountId), c = category(t.categoryId);
  let negative = t.kind === 'expense' || (t.kind === 'transfer' && currentAccount !== t.toAccountId) || (t.kind === 'adjustment' && BigInt(t.amountMinor) < 0n);
  const v = BigInt(t.amountMinor); const absolute = (v < 0n ? -v : v).toString();
  const ico = t.kind === 'refund' ? 'refund' : ['transfer', 'adjustment'].includes(t.kind) ? 'transfer' : c.icon;
  const detail = t.kind === 'refund' ? `退款 · ${c.name}` : t.kind === 'transfer' ? `${a.name} → ${account(t.toAccountId).name}` : t.kind === 'adjustment' ? '余额调整 · 不计收支' : `${c.parent} / ${c.name}`;
  const refunded = t.kind === 'expense' && refundable(book, t.id) !== t.amountMinor;
  const refundLabel = refunded && BigInt(refundable(book, t.id)) > 0n ? '部分退款' : '已退款';
  return `<button class="transaction-row" data-transaction="${t.id}"><span class="transaction-icon ${t.kind === 'income' || t.kind === 'refund' ? 'positive-icon' : ''}">${icon(ico)}</span><span class="transaction-description"><strong>${esc(t.description)}${refunded ? `<em class="tiny-tag">${refundLabel}</em>` : ''}</strong><small>${esc(detail)}${t.project ? ` <span>· ${esc(t.project)}</span>` : ''}</small></span><span class="transaction-account">${esc(a.name)}<small>${dayLabel(t.occurredAt)} ${time(t.occurredAt)}</small></span><span class="transaction-amount ${t.kind === 'income' || t.kind === 'refund' ? 'income-text' : ''}">${hiddenAmounts ? '••••' : `${negative ? '−' : '+'}${money(absolute, a.currency)}`}<small>${a.currency}</small></span>${icon('arrow', 'row-arrow')}</button>`;
}
function visibleEntries() {
  return sorted(book.entries.filter(t => (!currentAccount || t.accountId === currentAccount || t.toAccountId === currentAccount) && (filter === 'all' || t.kind === filter) && (!search || normalize(`${t.description} ${t.note} ${t.project} ${category(t.categoryId).name}`).includes(normalize(search)))));
}
function register() {
  const a = currentAccount && account(currentAccount);
  return `<div class="page-heading"><div>${a ? '<button class="back-link" data-action="home">← 所有账户</button>' : '<p class="eyebrow">日常有迹可循</p>'}<h1>${a ? esc(a.name) : '全部交易'}<span class="title-dot">.</span></h1></div><div class="heading-actions">${a ? `<button class="icon-button outlined" data-action="account-menu" aria-label="账户更多操作">${icon('more')}</button>` : ''}<button class="button primary" data-action="new">${icon('plus')}记一笔</button></div></div>
  ${a ? `<div class="register-account">${accountMark(a)}<div><small>${esc(a.subtitle)} · ${a.currency}</small><strong>${shownMoney(balance(book, a.id), a.currency)}</strong></div><span>账户余额</span></div>` : ''}
  <div class="register-tools"><label class="search-field">${icon('search')}<input id="transaction-search" type="search" placeholder="搜索描述、类目或备注" aria-label="搜索交易"></label><span class="register-count">${visibleEntries().length} 笔交易</span></div>
  <div class="filter-tabs" role="group" aria-label="交易类型">${['all', 'expense', 'income', 'refund', 'transfer'].map(f => `<button class="${filter === f ? 'active' : ''}" data-filter="${f}" aria-pressed="${filter === f}">${f === 'all' ? '全部' : kindName[f]}</button>`).join('')}</div><div id="register-rows">${registerRows()}</div>`;
}
function registerRows() {
  const entries = visibleEntries(); let previous = '';
  if (!entries.length) return `<div class="empty-state">${icon('list')}<h3>这里还没有交易</h3><p>${search || filter !== 'all' ? '试试其他关键词或筛选条件。' : '从这个账户记下第一笔。'}</p></div>`;
  return entries.map(t => { const key = dateKey(t.occurredAt); const heading = key !== previous ? `<div class="day-heading"><strong>${dayLabel(t.occurredAt)}</strong><span>${key.replaceAll('-', '.')}</span></div>` : ''; previous = key; return heading + transactionRow(t); }).join('');
}
function insights() {
  const sum = totals(); const month = localMinute().slice(0, 7); const byCategory = new Map();
  book.entries.filter(t => ['expense', 'refund'].includes(t.kind) && account(t.accountId).currency === 'CNY' && dateKey(t.occurredAt).startsWith(month)).forEach(t => {
    const c = category(t.categoryId); const key = c.parent;
    byCategory.set(key, { name: key, icon: c.icon, value: (byCategory.get(key)?.value || 0n) + (t.kind === 'refund' ? -1n : 1n) * BigInt(t.amountMinor) });
  });
  const rows = [...byCategory.values()].sort((a, b) => a.value > b.value ? -1 : 1); const max = rows.reduce((m, r) => r.value > m ? r.value : m, 1n);
  return `<div class="page-heading"><div><p class="eyebrow">看见钱的去向</p><h1>收支概览<span class="title-dot">.</span></h1></div><span class="period-label">${icon('calendar')}${new Date().getFullYear()} 年 ${new Date().getMonth() + 1} 月</span></div><p class="view-description">当前示例账本 · 仅统计人民币交易，转账与余额调整不计收支。</p><div class="insight-cards">${[['支出', sum.expense], ['退款', sum.refund], ['净支出', sum.expense - sum.refund]].map(([label, n]) => `<article><small>${label}</small><strong>${shownMoney(n.toString())}</strong></article>`).join('')}</div><section class="panel"><div class="section-heading"><h2>分类净支出</h2><span>支出 − 退款</span></div>${rows.length ? rows.map(r => `<div class="category-stat"><span class="transaction-icon">${icon(r.icon)}</span><div><div><strong>${esc(r.name)}</strong><span>${shownMoney(r.value.toString())}</span></div><progress max="10000" value="${Number(r.value * 10000n / max)}" aria-label="${esc(r.name)}净支出占最大类目比例"></progress></div></div>`).join('') : '<p class="muted">本月还没有人民币支出。</p>'}</section><div class="footnote">${icon('chart')}外币账户仍按原币展示；本版不使用暂估汇率合并人民币报表。</div>`;
}
function settings() {
  return `<div class="page-heading"><div><p class="eyebrow">留一点空间，给自己的习惯</p><h1>设置<span class="title-dot">.</span></h1></div></div>
  <section class="settings-card"><div class="settings-title">${icon('accounts')}<h2>关于这个账本</h2></div><p>这是第一版交互原型，内含虚构账户与交易。新增记录保存在当前浏览器，供体验和讨论；尚未接入 NAS 同步。</p><div class="setting-row"><div><strong>导出示例账本</strong><small>包含本机记录与未完成的草稿</small></div><button class="button secondary" data-action="export">${icon('download')}导出 JSON</button></div></section>
  <section class="settings-card"><div class="settings-title">${icon('home')}<h2>添加到主屏幕</h2></div><p>iPhone：在 Safari 打开，选择「分享 → 添加到主屏幕」。首次打开需联网，之后可离线使用。真机安装需受信任的 HTTPS 地址。</p><button class="text-button" data-action="persist">允许浏览器保留账本 ${icon('arrow')}</button></section>
  <section class="settings-card"><div class="setting-row"><div><strong>开发者信息</strong><small>查看本地存储、离线资源及版本</small></div><label class="switch"><input type="checkbox" id="developer-toggle" ${getPreference('developer') ? 'checked' : ''} aria-label="显示开发者信息"><span></span></label></div><div id="developer-panel" ${getPreference('developer') ? '' : 'hidden'}>${developerPanel()}</div></section>
  <div class="settings-signature"><span class="brand-icon">${icon('list')}</span><strong>厘序</strong><span>把日常的账，记清楚。</span><small>P0 · 0.2.0</small></div>`;
}
function developerPanel() { return `<dl class="developer-info"><dt>本地账本</dt><dd>IndexedDB · schema 1</dd><dt>本机事务</dt><dd>账目与操作意图同事务提交</dd><dt>离线应用壳</dt><dd>${swReady ? '缓存已就绪' : '等待 Service Worker 就绪'}</dd><dt>NAS 同步</dt><dd>未实现 · P2</dd><dt>独立来源</dt><dd>${esc(location.origin)} / fine-ledger-p0-review-v1</dd><dt>金额与时间</dt><dd>整数最小单位 / UTC ISO 秒</dd></dl>`; }
function getPreference(key) { try { return localStorage.getItem('fine-ledger-p0-' + key) === 'true'; } catch { return false; } }
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3600); }
function showSheet(content, cls = '') {
  focusBeforeSheet = sheet.open ? focusBeforeSheet : document.activeElement;
  sheet.className = cls; sheet.innerHTML = content;
  if (!sheet.open) sheet.showModal(); document.body.classList.add('modal-open');
}
function sheetHeader(kicker, title) { return `<div class="sheet-header"><div><p class="eyebrow">${kicker}</p><h2 id="sheet-title">${title}</h2></div><button class="icon-button" data-action="close" aria-label="关闭">${icon('close')}</button></div>`; }
function closeSheet() { if (saveBusy) return; sheet.close(); editor = null; document.body.classList.remove('modal-open'); if (focusBeforeSheet?.isConnected) focusBeforeSheet.focus(); }
async function openEditor(accountId, kind = 'expense', restore = true) {
  const a = account(accountId);
  const draft = restore ? await readDraft(a.id) : null;
  editor = { mode: 'entry', accountId, kind, categoryId: '', occurredAt: localMinute(), description: '', amount: '', project: '', note: '', ...(draft || {}) };
  if (draft) kind = editor.kind;
  suggestionIndex = -1;
  showSheet(`${sheetHeader('记下此刻的日常', '记一笔')}<form id="entry-form" novalidate>
    <div class="sheet-content"><button type="button" class="editor-account" data-action="switch-account">${accountMark(a)}<span>${esc(a.name)}<small>${a.currency} · ${esc(a.subtitle)}</small></span>${icon('down')}</button>
    <div class="entry-kind">${['expense', 'income', 'transfer'].map(k => `<button type="button" data-kind="${k}" class="${kind === k ? 'active' : ''}">${kindName[k]}</button>`).join('')}</div>
    ${draft ? '<p class="draft-notice">已恢复这个账户上次未完成的草稿</p>' : ''}
    <label class="amount-field"><span>${kind === 'transfer' ? '转出金额' : '金额'} <small>${a.currency}</small></span><div><span>${a.currency === 'USD' ? '$' : '¥'}</span><input id="amount" name="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(editor.amount)}" aria-label="金额" required></div></label>
    <div class="form-field description-field"><label for="description">描述</label><input id="description" name="description" placeholder="记了什么？选一个最近描述也可以" value="${esc(editor.description)}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="description-suggestions" aria-expanded="true" maxlength="120"><div class="suggestion-heading"><span>${editor.description ? '匹配的描述' : '最近用过'}</span><small>选择后带入上次类目</small></div><div id="description-suggestions" class="suggestions" role="listbox" aria-label="描述补全">${suggestionHTML()}</div></div>
    ${kind === 'transfer' ? `<label class="form-field">转入账户<select id="to-account" name="toAccountId"><option value="">选择同币种账户</option>${book.accounts.filter(b => b.id !== a.id && b.currency === a.currency).map(b => `<option value="${b.id}" ${editor.toAccountId === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}</select><small>跨币种转账将在后续阶段开放</small></label>` : `<div class="form-field"><label>类目</label><button type="button" class="category-trigger" data-action="categories" aria-expanded="false"><span id="selected-category">${categoryLabel()}</span>${icon('down')}</button><div id="category-picker" class="category-picker" hidden>${categoryPicker()}</div><small id="category-hint">${editor.categoryId ? (editor.categorySource === 'manual' ? '保留手动选择的类目' : '沿用最近一次记录，可手动更改') : '选择描述可自动带入，也可手动选择'}</small></div>`}
    <label class="form-field time-field" for="occurred-at"><span>消费时间</span><input id="occurred-at" name="occurredAt" type="datetime-local" step="60" value="${esc(editor.occurredAt)}" required></label>
    <details class="optional-fields" ${editor.project || editor.note ? 'open' : ''}><summary>${icon('plus')}旅游项目、备注 <span>选填</span></summary><div><label class="form-field" for="project">旅游项目<select id="project" name="project"><option value="">不关联项目</option>${book.projects.map(p => `<option ${p === editor.project ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label><label class="form-field" for="note">备注<textarea id="note" name="note" rows="2" placeholder="还有什么想记下的？" maxlength="1000">${esc(editor.note)}</textarea></label></div></details>
    <p class="form-error" id="form-error" role="alert"></p></div>
    <div class="sheet-actions"><button type="button" class="button secondary" data-action="save-another">保存，再记一笔</button><button class="button primary" type="submit">${icon('check')}保存</button></div></form>`, 'editor-sheet');
}
function categoryLabel() { if (!editor.categoryId) return `${icon('accounts')}<span class="muted">选择类目</span>`; const c = category(editor.categoryId); return `${icon(c.icon)}${c.parent}<span class="category-slash">/</span>${c.name}`; }
function categoryPicker() { return book.categories.filter(g => g.kind === editor.kind).map(g => `<details class="category-group" ${g.children.some(c => c.id === editor.categoryId) ? 'open' : ''}><summary>${icon(g.icon)}${g.name}${icon('down')}</summary><div>${g.children.map(c => `<button type="button" data-category="${c.id}" class="${editor.categoryId === c.id ? 'chosen' : ''}">${c.name}${editor.categoryId === c.id ? icon('check') : ''}</button>`).join('')}</div></details>`).join(''); }
function suggestionHTML() {
  if (!editor) return '';
  const rows = suggestions(book.entries, editor.description, editor.kind);
  return rows.length ? rows.map((t, index) => `<button type="button" role="option" id="suggestion-${index}" aria-selected="false" data-suggestion="${t.id}"><strong>${esc(t.description)}</strong><small>${category(t.categoryId).name}</small></button>`).join('') : `<p class="suggestion-empty">${editor.description ? '还没有匹配描述，保存后会记住它' : '记下第一笔后，常用描述会出现在这里'}</p>`;
}
function collectEditor() {
  if (!editor || editor.mode !== 'entry') return;
  for (const [key, selector] of Object.entries({ amount: '#amount', description: '#description', occurredAt: '#occurred-at', project: '#project', note: '#note', toAccountId: '#to-account' })) { const field = sheet.querySelector(selector); if (field) editor[key] = field.value; }
}
async function rememberDraft() {
  if (!editor || editor.mode !== 'entry' || saveBusy) return;
  collectEditor(); const snapshot = { ...editor };
  try { await writeDraft(snapshot.accountId, snapshot); } catch { toast('草稿未能保存，请保留当前页面并导出账本'); }
}
async function submitEntry(another = false) {
  if (saveBusy || !editor) return;
  collectEditor(); const context = { ...editor };
  const error = sheet.querySelector('#form-error');
  try {
    const form = sheet.querySelector('form'); const data = Object.fromEntries(new FormData(form));
    const a = account(context.accountId);
    const occurredMinute = data.occurredAt || context.occurredAt;
    if (!occurredMinute) throw Error('请选择消费时间');
    const entry = { accountId: a.id, kind: context.kind, description: context.description?.trim(), amountMinor: context.mode === 'adjustment' ? '0' : minor(data.amount ?? context.amount, a.currency), categoryId: context.categoryId || '', occurredAt: new Date(occurredMinute + ':00').toISOString(), project: data.project || '', note: (data.note || '').trim() };
    if (context.mode === 'refund') { entry.originalId = context.originalId; entry.description = '退款 · ' + context.description; entry.project = context.project; }
    if (context.kind === 'transfer') { entry.toAccountId = data.toAccountId; entry.categoryId = ''; }
    if (context.mode === 'adjustment') { entry.description = data.reason?.trim(); if (!entry.description) throw Error('请填写调整原因'); entry.targetBalance = data.targetBalance; entry.amountMinor = '0'; }
    saveBusy = true; sheet.querySelectorAll('button').forEach(b => b.disabled = true);
    const result = await saveEntry(entry); book = result.book;
    channel?.postMessage('changed'); render();
    saveBusy = false;
    if (another && context.mode === 'entry') { await openEditor(a.id, context.kind, false); toast('已保存，继续用这个账户记账'); sheet.querySelector('#amount').focus(); }
    else { closeSheet(); toast(context.mode === 'refund' ? '退款已保存，原记录已关联' : context.mode === 'adjustment' ? '账户余额已调整' : '已保存'); }
  } catch (failure) {
    saveBusy = false; sheet.querySelectorAll('button').forEach(b => b.disabled = false);
    error.textContent = failure.message.includes('Invalid time') ? '请选择有效的消费时间' : failure.message;
  }
}
function showDetail(id) {
  editor = null; const t = book.entries.find(e => e.id === id), a = account(t.accountId), c = category(t.categoryId);
  const remaining = refundable(book, id); const refunds = book.entries.filter(e => e.originalId === id);
  showSheet(`${sheetHeader('交易详情', esc(t.description))}<div class="sheet-content"><div class="detail-amount ${['income', 'refund'].includes(t.kind) ? 'income-text' : ''}"><small>${kindName[t.kind]}</small>${shownMoney(t.amountMinor, a.currency)}<span>${a.currency}</span></div><dl class="detail-list"><dt>账户</dt><dd>${a.name}</dd><dt>时间</dt><dd>${dateKey(t.occurredAt)} ${time(t.occurredAt)}</dd><dt>类目</dt><dd>${c.parent ? c.parent + ' / ' : ''}${c.name}</dd>${t.toAccountId ? `<dt>转入账户</dt><dd>${account(t.toAccountId).name}</dd>` : ''}${t.project ? `<dt>旅游项目</dt><dd>${esc(t.project)}</dd>` : ''}${t.note ? `<dt>备注</dt><dd>${esc(t.note)}</dd>` : ''}${t.kind === 'refund' ? `<dt>关联消费</dt><dd><button class="text-button" data-transaction="${t.originalId}">${esc(book.entries.find(e => e.id === t.originalId)?.description)}</button></dd>` : ''}</dl>${refunds.length ? `<div class="refund-history"><h3>退款记录</h3>${refunds.map(r => `<button data-transaction="${r.id}"><span>${dayLabel(r.occurredAt)} ${time(r.occurredAt)}</span><strong>+${shownMoney(r.amountMinor, a.currency)}</strong>${icon('arrow')}</button>`).join('')}</div>` : ''}${t.kind === 'expense' ? `<div class="refundable-note">剩余可退 <strong>${shownMoney(remaining, a.currency)}</strong></div>` : ''}</div><div class="sheet-actions">${t.kind === 'expense' && BigInt(remaining) > 0n ? `<button class="button primary full" data-refund="${id}">${icon('refund')}记录退款</button>` : '<button class="button secondary full" data-action="close">关闭</button>'}</div>`, 'detail-sheet');
}
function showRefund(id) {
  const t = book.entries.find(e => e.id === id), a = account(t.accountId), c = category(t.categoryId);
  editor = { mode: 'refund', accountId: a.id, originalId: id, kind: 'refund', description: t.description, categoryId: t.categoryId, project: t.project };
  showSheet(`${sheetHeader('关联原消费', '记录退款')}<form id="entry-form" novalidate><div class="sheet-content"><div class="original-record"><span class="transaction-icon">${icon(c.icon)}</span><div><strong>${esc(t.description)}</strong><small>${a.name} · ${c.parent} / ${c.name}</small></div></div><p class="view-description">剩余可退 ${shownMoney(refundable(book, id), a.currency)}。支持部分或多次退款。</p><label class="amount-field"><span>实际退款金额 <small>${a.currency}</small></span><div><span>${a.currency === 'USD' ? '$' : '¥'}</span><input name="amount" inputmode="decimal" value="${decimal(refundable(book, id), a.currency)}" aria-label="退款金额"></div></label><label class="form-field">退款时间<input name="occurredAt" type="datetime-local" step="60" value="${localMinute()}" required></label><div class="inherited-category">${icon('check')}沿用原类目${t.project ? '与旅游项目' : ''}，冲减原消费</div><p class="footnote">P0 先退回原账户。其他账户及跨币种退款在 P3 实现。</p><p class="form-error" id="form-error" role="alert"></p></div><div class="sheet-actions"><button type="button" class="button secondary" data-transaction="${id}">返回原记录</button><button class="button primary" type="submit">保存退款</button></div></form>`, 'detail-sheet');
}
function showAccountMenu() {
  const a = account(currentAccount); editor = null;
  showSheet(`${sheetHeader('账户管理', a.name)}<div class="sheet-content"><div class="menu-account">${accountMark(a)}<strong>${shownMoney(balance(book, a.id), a.currency)}</strong></div><button class="account-menu-item" data-action="adjust">${icon('accounts')}<span>调整余额<small>核对后修正账户余额，不计入日常收支</small></span>${icon('arrow')}</button></div>`, 'small-sheet');
}
function showAdjustment() {
  const a = account(currentAccount); editor = { mode: 'adjustment', accountId: a.id, kind: 'adjustment' };
  showSheet(`${sheetHeader('账户管理', '调整余额')}<form id="entry-form" novalidate><div class="sheet-content"><div class="original-record">${accountMark(a)}<div><strong>${a.name}</strong><small>当前余额 ${shownMoney(balance(book, a.id), a.currency)}</small></div></div><label class="form-field">核对后的实际余额 (${a.currency})<input name="targetBalance" inputmode="text" value="${decimal(balance(book, a.id), a.currency)}" required><small>信用卡欠款填负数，存款或溢缴款填正数</small></label><label class="form-field">调整原因<input name="reason" placeholder="例如：核对期初余额" required maxlength="120"></label><label class="form-field">调整时间<input name="occurredAt" type="datetime-local" step="60" value="${localMinute()}" required></label><p class="footnote">保存一笔独立的余额调整，差额不计入日常收入或支出。</p><p class="form-error" id="form-error" role="alert"></p></div><div class="sheet-actions"><button type="button" class="button secondary" data-action="close">取消</button><button class="button primary" type="submit">确认调整</button></div></form>`, 'detail-sheet');
}
async function action(name) {
  if (name === 'close') return closeSheet();
  if (name === 'home') { view = 'accounts'; currentAccount = null; search = ''; filter = 'all'; render(); }
  if (name === 'privacy') { hiddenAmounts = !hiddenAmounts; render(); }
  if (name === 'new') await openEditor(currentAccount || 'cmb');
  if (name === 'account-menu') showAccountMenu();
  if (name === 'adjust') showAdjustment();
  if (name === 'save-another') await submitEntry(true);
  if (name === 'categories') { const el = sheet.querySelector('#category-picker'); el.hidden = !el.hidden; sheet.querySelector('.category-trigger').setAttribute('aria-expanded', String(!el.hidden)); }
  if (name === 'switch-account') {
    await rememberDraft(); const kind = editor.kind;
    showSheet(`${sheetHeader('为这笔交易选择', '记在哪个账户？')}<div class="sheet-content account-chooser">${book.accounts.map(a => `<button data-choose-account="${a.id}" data-choose-kind="${kind}">${accountMark(a)}<span><strong>${a.name}</strong><small>${a.currency} · ${esc(a.subtitle)}</small></span>${icon('arrow')}</button>`).join('')}</div>`, 'detail-sheet'); editor = null;
  }
  if (name === 'persist') {
    const allowed = await navigator.storage?.persist?.(); toast(allowed ? '浏览器已允许持久保留' : '浏览器未授予持久保留，可定期导出账本');
  }
  if (name === 'export') {
    const snapshot = await exportBook(); const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `fine-ledger-p0-${dateKey(new Date())}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('账本已导出');
  }
}
document.addEventListener('click', async event => {
  const el = event.target.closest('button, a[data-action]'); if (!el || el.disabled) return;
  try {
    if (el.dataset.action) { event.preventDefault(); await action(el.dataset.action); }
    if (el.dataset.view) { view = el.dataset.view; currentAccount = null; search = ''; filter = 'all'; render(); window.scrollTo(0, 0); }
    if (el.dataset.account) { currentAccount = el.dataset.account; view = 'transactions'; search = ''; filter = 'all'; render(); window.scrollTo(0, 0); }
    if (el.dataset.newAccount) await openEditor(el.dataset.newAccount);
    if (el.dataset.chooseAccount) await openEditor(el.dataset.chooseAccount, el.dataset.chooseKind);
    if (el.dataset.transaction) showDetail(el.dataset.transaction);
    if (el.dataset.refund) showRefund(el.dataset.refund);
    if (el.dataset.kind) { collectEditor(); editor.kind = el.dataset.kind; editor.categoryId = ''; await writeDraft(editor.accountId, { ...editor }); await openEditor(editor.accountId, editor.kind); }
    if (el.dataset.suggestion) {
      const t = book.entries.find(e => e.id === el.dataset.suggestion); editor.description = t.description; editor.categoryId = t.categoryId; editor.categorySource = 'history';
      sheet.querySelector('#description').value = t.description; if (sheet.querySelector('#selected-category')) { sheet.querySelector('#selected-category').innerHTML = categoryLabel(); sheet.querySelector('#category-hint').textContent = '已带入上次类目，可手动更改'; sheet.querySelector('#category-picker').innerHTML = categoryPicker(); }
      sheet.querySelector('#description-suggestions').innerHTML = suggestionHTML(); suggestionIndex = -1; await rememberDraft(); sheet.querySelector('#amount').focus();
    }
    if (el.dataset.category) { editor.categoryId = el.dataset.category; editor.categorySource = 'manual'; sheet.querySelector('#selected-category').innerHTML = categoryLabel(); sheet.querySelector('#category-picker').hidden = true; sheet.querySelector('.category-trigger').setAttribute('aria-expanded', 'false'); sheet.querySelector('#category-hint').textContent = '已选择类目'; await rememberDraft(); sheet.querySelector('.category-trigger').focus(); }
    if (el.dataset.filter) { filter = el.dataset.filter; render(); }
  } catch (error) { toast(error.message || '操作未完成，请重试'); }
});
document.addEventListener('input', event => {
  if (event.target.id === 'transaction-search') { search = event.target.value; document.querySelector('#register-rows').innerHTML = registerRows(); document.querySelector('.register-count').textContent = visibleEntries().length + ' 笔交易'; }
  if (event.target.id === 'description') {
    editor.description = event.target.value; if (editor.categorySource !== 'manual') editor.categoryId = ''; suggestionIndex = -1;
    const c = sheet.querySelector('#selected-category'); if (c) { c.innerHTML = categoryLabel(); sheet.querySelector('#category-hint').textContent = editor.categorySource === 'manual' ? '保留手动选择的类目' : '选择描述可自动带入，也可手动选择'; }
    sheet.querySelector('#description-suggestions').innerHTML = suggestionHTML();
    sheet.querySelector('.suggestion-heading > span').textContent = event.target.value ? '匹配的描述' : '最近用过';
    event.target.removeAttribute('aria-activedescendant');
  }
  if (sheet.contains(event.target)) void rememberDraft();
});
document.addEventListener('change', event => {
  if (event.target.id === 'developer-toggle') { try { localStorage.setItem('fine-ledger-p0-developer', String(event.target.checked)); } catch {} document.querySelector('#developer-panel').hidden = !event.target.checked; }
  if (sheet.contains(event.target)) void rememberDraft();
});
sheet.addEventListener('submit', event => { event.preventDefault(); void submitEntry(); });
sheet.addEventListener('cancel', event => { event.preventDefault(); closeSheet(); });
sheet.addEventListener('click', event => { if (event.target === sheet) { const r = sheet.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeSheet(); } });
sheet.addEventListener('keydown', event => {
  if (event.isComposing) return;
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submitEntry(); return; }
  if (event.target.id !== 'description') return;
  const options = [...sheet.querySelectorAll('[data-suggestion]')];
  if (['ArrowDown', 'ArrowUp'].includes(event.key) && options.length) { event.preventDefault(); suggestionIndex = (suggestionIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length; options.forEach((el, index) => { el.setAttribute('aria-selected', String(index === suggestionIndex)); }); event.target.setAttribute('aria-activedescendant', options[suggestionIndex].id); }
  if (event.key === 'Enter') { const exact = options.find(o => normalize(o.querySelector('strong').textContent) === normalize(event.target.value)); const option = options[suggestionIndex] || exact; if (option) { event.preventDefault(); option.click(); } else { event.preventDefault(); sheet.querySelector('#amount').focus(); } }
});
channel?.addEventListener('message', async () => { book = await loadBook(); render(); });
window.addEventListener('focus', async () => { if (book) { book = await loadBook(); render(); } });
try {
  book = await loadBook(); render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then(() => { swReady = true; const panel = document.querySelector('#developer-panel'); if (panel) panel.innerHTML = developerPanel(); }).catch(() => toast('离线资源尚未缓存，请联网后重试'));
} catch (error) { app.innerHTML = `<div class="startup"><strong>暂时无法打开账本</strong><p>浏览器存储不可用。请使用普通浏览模式，并保留此页面重试。</p><small>${esc(error.message)}</small><button class="button primary" id="retry">重新打开</button></div>`; document.querySelector('#retry').onclick = () => location.reload(); }
