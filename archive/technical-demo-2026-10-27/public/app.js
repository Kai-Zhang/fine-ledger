import * as D from './domain.js';
import * as DB from './storage.js';
import * as V from './validation.js';
const $ = s => document.querySelector(s);
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const attr = esc;
const icon = (name, size = 20) => {
  const paths = { plus: '<path d="M12 5v14M5 12h14"/>', book: '<path d="M4 4h6a3 3 0 0 1 2 1 3 3 0 0 1 2-1h6v15h-6a3 3 0 0 0-2 1 3 3 0 0 0-2-1H4zM12 5v15"/>', chart: '<path d="M4 4v16h17M8 16v-5m5 5V7m5 9V4"/>', settings: '<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>', arrow: '<path d="m9 5 7 7-7 7"/>', check: '<path d="m5 12 4 4L19 6"/>', sync: '<path d="M20 7a9 9 0 0 0-15-2L3 7m0-5v5h5M4 17a9 9 0 0 0 15 2l2-2m0 5v-5h-5"/>', wallet: '<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 8V5a2 2 0 0 1 2-2h12v2m4 6h-6v5h6"/>', search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>', down: '<path d="m6 9 6 6 6-6"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>', plane: '<path d="m3 13 7-2V4l2-2 2 2v7l7 2v2l-7-1v5l3 2H7l3-2v-5l-7 1z"/>', transfer: '<path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4"/>', download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>', shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>' };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.book}</svg>`;
};
const button = (action, text, style = '', data = '') => `<button type="button" class="btn ${style}" data-action="${action}" ${data}>${text}</button>`;
const badge = (text, style = '') => `<span class="badge ${style}">${esc(text)}</span>`;
const names = { record: '记一笔', ledger: '账单', reports: '报表', settings: '设置' };
let record, route = 'record', reportTab = 'overview', settingsTab = 'overview', selectedId = null;
let syncStatus = 'checking', syncMessage = '', localElapsed = null, deferredInstall, swReady = false, undoEntry, toastTimer;
let prefs = JSON.parse(localStorage.getItem('fine-ledger-prefs') || '{}');
let entrySaving = false;
let draft, filter = { search: '', account: '', type: '', state: '', cost: '', category: '', project: '', reconciliation: '', from: '', to: '', deleted: false };
const S = () => record.state;
const getName = (collection, id) => S()[collection].find(r => r.id === id)?.name || '未设置';
const accountName = id => getName('accounts', id);
const scopedReport = rows => D.report(S(), rows, {categoryId: filter.category, projectId: filter.project});
const includedSplit = split => D.matchesSplit(S(), split, {categoryId: filter.category, projectId: filter.project});
const categoryName = id => { const c = S().categories.find(r => r.id === id); return c ? `${c.parentId ? getName('categories', c.parentId) + ' / ' : ''}${c.name}` : '未分类'; };
const options = (items, value, label = r => r.name, empty = null) => `${empty !== null ? `<option value="">${esc(empty)}</option>` : ''}${items.map(r => `<option value="${attr(r.id)}" ${r.id === value ? 'selected' : ''}>${esc(label(r))}${r.archived ? '（已归档）' : ''}</option>`).join('')}`;
const accountOptions = value => options(S().accounts.filter(a => D.active(a) || a.id === value), value, a => `${a.name} · ${a.currency}`);
function defaultDraft(type = 'expense') {
  return { transactionId: D.uid(), type, date: D.today(), accountId: prefs.recentAccount || 'bank-cny', toAccountId: 'cc-usd', currency: 'CNY', amount: '', accountAmount: '', toAmount: '', description: '', notes: '', state: 'posted', postingDate: D.today(), estimatedCost: '', explicitCost: '', intermediate: '', intermediateCurrency: 'USD', projectId: '', sourceId: '', fee: '', feeAccountId: prefs.recentAccount || 'bank-cny', advanced: type === 'adjustment', continuous: false, splits: [{ id: D.uid(), amount: '', categoryId: type === 'income' ? 'salary' : 'meal', projectId: '' }], refunds: [] };
}
function notify(message, action) {
  clearTimeout(toastTimer);
  $('#toast').innerHTML = `<span>${esc(message)}</span>${action ? button(action.action, esc(action.label), 'toast-action') : ''}`;
  $('#toast').classList.add('show');
  if ($('#modal').open) {
    let feedback = $('#modal-feedback');
    if (!feedback) { feedback = document.createElement('div'); feedback.id = 'modal-feedback'; feedback.className = 'notice'; feedback.setAttribute('role', 'status'); $('#modal .modal-body').prepend(feedback); }
    feedback.textContent = message;
  }
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), action ? 10000 : 5500);
}
function showModal(title, content, wide = false) {
  const modal = $('#modal');
  modal.innerHTML = `<div class="modal-head"><h2 id="modal-title">${esc(title)}</h2>${button('close-modal', icon('close'), 'icon-btn', 'aria-label="关闭"')}</div><div class="modal-body">${content}</div>`;
  modal.classList.toggle('wide', wide);
  if (!modal.open) modal.showModal();
  modal.querySelector('input:not([type=checkbox]), select, button')?.focus();
}
function closeModal() { $('#modal').close(); }
async function refresh() { record = await DB.read(); }
async function saveChanges(changes, label, options = {}) {
  try {
    const result = await DB.commit(changes, label, options);
    localElapsed = result.elapsed;
    record = result.record;
    await refresh().catch(() => {});
    for (const c of changes.filter(c => c.collection === 'transactions')) await V.markSave(c.entity, { syncStatus, simulation: prefs.offline, elapsed: result.elapsed }).catch(() => {});
    render();
    channel?.postMessage({ type: "changed" });
    trySync();
    return true;
  } catch (e) {
    if (e.code === 'REOPEN' && !options.reopen) {
      showModal('重新打开相关对账批次', `<p>这次修改会改变已完成批次的余额。相关批次及其后的批次将标为「重新核验」，此前结论会保留在修订历史中。</p><p class="muted">原因：${esc(label)}</p><div class="actions">${button('confirm-reopen', '重新打开并保存', 'primary')}${button('close-modal', '取消')}</div>`);
      return new Promise(resolve => {
        cancelReopen = () => { pendingReopen = null; cancelReopen = null; resolve(false); };
        pendingReopen = async () => {
          const ok = await saveChanges(changes, label, { reopen: true });
          if (ok) { closeModal(); notify('已保存，相关批次需要重新核验'); }
          pendingReopen = null; cancelReopen = null; resolve(ok);
        };
      });
    } else notify(e.message);
    return false;
  }
}
let pendingReopen, cancelReopen;
async function trySync(manual = false) {
  syncStatus = 'checking'; renderStatus();
  try {
    const result = await DB.synchronize({ simulateOffline: prefs.offline, token: prefs.token });
    if (result?.busy) return;
    await refresh(); syncStatus = record.conflicts.length ? 'conflict' : 'online'; syncMessage = '';
    await V.markSync('reachable', prefs.offline).catch(() => {});
    if (manual) notify(record.conflicts.length ? '同步发现冲突，请到设置中选择版本' : '已与 NAS 同步');
  } catch (e) { syncStatus = 'offline'; syncMessage = ['TypeError', 'TimeoutError'].includes(e.name) ? 'NAS 暂不可达，记录已保存在本机' : e.message; await V.markSync(e.message.includes('认证') ? 'authentication-required' : 'unreachable', prefs.offline).catch(() => {}); if (manual) notify(syncMessage); }
  renderStatus();
  if (route === 'settings' || (route !== 'record' && !$('#modal').open)) render();
}
function renderStatus() {
  const el = $('#sync-status'); if (!el || !record) return;
  const status = record.conflicts.length ? 'conflict' : syncStatus;
  el.innerHTML = `<span class="status-dot ${status}"></span><span>${status === 'checking' ? '连接中' : status === 'conflict' ? `${record.conflicts.length} 个冲突` : status === 'online' ? 'NAS 已连接' : '本机模式'}${record.outbox.length ? ` · ${record.outbox.length} 项待同步` : ''}</span>${icon('sync', 15)}`;
  el.title = syncMessage || '点击立即同步；同步与本机保存分别确认';
  $('#local-status').textContent = `本机数据库已就绪${swReady ? ' · 离线资源已准备' : ' · 准备离线资源中'}`;
}
function render() {
  if (!record) return;
  const focused = document.activeElement?.getAttribute('data-field'), selection = document.activeElement?.selectionStart;
  $('#app').innerHTML = `<aside class="sidebar"><a class="brand" href="#record" aria-label="Fine Ledger 首页"><span class="brand-mark">F<span>·</span></span><span>Fine Ledger<small>个人账本 / INTERACTION DEMO</small></span></a><div class="nav-caption">我的账本</div><nav>${['record', 'ledger', 'reports', 'settings'].map((r, i) => `<button class="nav-item ${route === r ? 'active' : ''}" data-action="navigate" data-route="${r}">${icon(['plus', 'book', 'chart', 'settings'][i])}<span>${names[r]}</span>${r === 'record' ? '<kbd>N</kbd>' : ''}</button>`).join('')}</nav><div class="sidebar-bottom"><span class="demo-chip">DEMO · 合成数据</span><p>先记下来，<br>再从容核对。</p><small>本机优先 · CNY 主币种</small></div></aside><div class="workspace"><header class="topbar"><span class="breadcrumb">个人账本 <span>/</span> ${names[route]}</span><div class="topbar-right"><button class="sync-status" id="sync-status" data-action="sync"></button><button class="avatar" data-action="navigate" data-route="settings" aria-label="设置">K</button></div></header><main id="main">${route === 'record' ? renderRecord() : route === 'ledger' ? renderLedger() : route === 'reports' ? renderReports() : renderSettings()}</main><footer class="footer"><span id="local-status"></span><span>Fine Ledger · v0.1</span></footer></div><nav class="mobile-nav">${['record', 'ledger', 'reports', 'settings'].map((r, i) => `<button class="${route === r ? 'active' : ''}" data-action="navigate" data-route="${r}">${icon(['plus', 'book', 'chart', 'settings'][i])}<span>${names[r]}</span></button>`).join('')}</nav>`;
  renderStatus();
  if (route === 'settings') diagnostics();
  if (focused) { const input = document.querySelector(`[data-field="${focused}"]`); input?.focus(); if (selection != null && input?.setSelectionRange && ['text', 'search'].includes(input.type)) input.setSelectionRange(selection, selection); }
}
function heading(eyebrow, title, sub, actions = '') { return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${sub}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>`; }
function field(label, html, cls = '') { return `<label class="field ${cls}"><span>${label}</span>${html}</label>`; }
function inputField(label, name, value = '', type = 'text', extra = '') { return field(label, `<input data-field="${name}" name="${name}" type="${type}" value="${attr(value)}" ${extra}>`); }
function renderRecord() {
  const d = draft, a = D.account(S(), d.accountId) || S().accounts[0];
  const monthly = D.report(S(), D.transactions(S()).filter(t => t.date.startsWith(D.today().slice(0, 7))));
  const pending = D.transactions(S()).filter(t => t.state === 'pending');
  const recent = D.transactions(S()).filter(t => t.type !== 'adjustment').sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);
  return `${heading('DAILY ENTRY', d.editId ? '编辑这笔记录' : '把今天，记清楚。', '每一笔先保存到本机，网络恢复后再与 NAS 同步。', badge('交互验证版', 'neutral'))}<div class="entry-layout"><section class="card entry-card"><div class="type-tabs" role="group" aria-label="交易类型">${Object.entries(D.TYPES).map(([type, label]) => `<button type="button" data-action="entry-type" data-type="${type}" class="${d.type === type ? 'selected' : ''}">${label}</button>`).join('')}</div><form id="entry-form" novalidate><div class="amount-field"><label for="entry-amount">${d.type === 'transfer' ? '转出本金' : d.type === 'refund' ? '实际到账金额' : '交易原币金额'}</label><div><select aria-label="交易币种" data-field="currency">${Object.keys(D.DIGITS).map(c => `<option ${d.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select><input id="entry-amount" class="amount-input" data-field="amount" inputmode="decimal" autocomplete="off" placeholder="0${d.currency === 'JPY' ? '' : '.00'}" value="${attr(d.amount)}" aria-label="金额"></div><small>${d.type === 'adjustment' ? '正数增加余额，负数减少余额；必须填写调整原因' : d.currency === 'JPY' ? '日元按整数记账' : '请填写实际本金，手续费单独记录'}</small></div><div class="form-grid">${field(d.type === 'transfer' ? '转出账户' : '记账账户', `<select data-field="accountId">${accountOptions(d.accountId)}</select>`)}${inputField('消费 / 业务日期', 'date', d.date, 'date')}${d.type === 'transfer' ? renderTransferFields() : ''}${field('描述', `<input list="descriptions" data-field="description" placeholder="例如：午餐、旅行酒店" value="${attr(d.description)}" maxlength="120"><datalist id="descriptions">${[...new Set(S().transactions.map(t => t.description))].slice(-30).map(s => `<option value="${attr(s)}">`).join('')}</datalist>`, 'full')}${['expense', 'income'].includes(d.type) ? renderSplits() : ''}${d.type === 'refund' ? renderRefundFields() : ''}${d.type === 'expense' && a.type === 'credit' ? field('银行入账', `<select data-field="state"><option value="posted" ${d.state === 'posted' ? 'selected' : ''}>已入账</option><option value="pending" ${d.state === 'pending' ? 'selected' : ''}>待入账 · 最终金额可未知</option></select>`) : ''}${d.type !== 'transfer' && d.type !== 'refund' && (d.state === 'posted') && (a.currency !== d.currency || d.advanced) ? inputField(`账户正式金额（${a.currency}）`, 'accountAmount', d.accountAmount, 'text', `inputmode="decimal" placeholder="${a.currency === d.currency ? '默认等于原币金额' : '请输入银行记账金额'}"`) : ''}${d.state === 'pending' ? `<div class="notice full">${icon('clock', 18)}<span>待入账不计入正式余额。确认银行金额后更新同一笔交易，保留原币与中间折算历史。</span></div>` : ''}</div><button type="button" class="disclosure" data-action="toggle-advanced">${icon('plus', 15)} ${d.advanced ? '收起' : '展开'}备注、银行中间金额与成本</button>${d.advanced ? renderAdvanced(a) : ''}<div class="save-area"><label class="check-label"><input type="checkbox" data-field="continuous" ${d.continuous ? 'checked' : ''}> 保存后继续记账</label><div>${d.editId ? button('cancel-edit', '取消编辑') : ''}<button class="btn primary save-button" type="submit">${icon('check', 18)}${d.editId ? '保存修改' : '保存到本机'} <kbd>⌘ ↵</kbd></button></div></div><div class="save-caption">${icon('shield', 13)} 本机事务提交后才显示成功 · ${localElapsed !== null ? `最近保存 ${Math.round(localElapsed)} ms` : '草稿自动保存'}</div></form></section><aside class="entry-aside"><section class="card month-card"><div class="section-label">${D.today().slice(0, 7).replace('-', ' 年 ')} 月</div><p class="muted">本月净支出</p><div class="large-number"><span>¥</span> ${D.money(monthly.net)}</div><div class="mini-stats"><div><small>支出</small><strong>¥ ${D.money(monthly.expense)}</strong></div><div><small>退款</small><strong>¥ ${D.money(monthly.refund)}</strong></div></div><div class="cost-caption">${badge(`含暂估 ¥ ${D.money(monthly.estimated)}`, 'amber')}${monthly.unpriced.length ? badge('合计不完整', 'red') : ''}</div></section><section class="card tasks-card"><div class="section-head"><h3>待处理</h3>${badge(String(pending.length + record.conflicts.length), 'neutral')}</div>${button('show-pending', `${icon('clock')}<span><strong>${pending.length} 笔等待银行入账</strong><small>补填实际金额，沿用原记录</small></span>${icon('arrow', 16)}`, 'task-row')}${button('show-costs', `${icon('transfer')}<span><strong>确认外币消费成本</strong><small>用真实还款本金分配</small></span>${icon('arrow', 16)}`, 'task-row')}${button('show-reconcile', `${icon('check')}<span><strong>核对账户账单</strong><small>余额与明细一起核对</small></span>${icon('arrow', 16)}`, 'task-row')}</section><div class="tip"><span>01 / 快速验证</span><p>试着保存一笔，再开启「离线演练」。关闭页面后重新打开，记录和草稿仍在。</p>${button('toggle-offline', prefs.offline ? '结束离线演练 →' : '开启离线演练 →', 'text-btn')}</div></aside></div><section class="recent-section"><div class="section-head"><h2>最近记录</h2>${button('navigate', '全部账单 ' + icon('arrow', 15), 'text-btn', 'data-route="ledger"')}</div><div class="card">${recent.map(t => transactionRow(t, true)).join('')}</div></section>`;
}
function renderSplits() {
  const d = draft, cats = S().categories.filter(c => c.type === d.type && (!c.archived || d.splits.some(s => s.categoryId === c.id)));
  return `<div class="full splits"><div class="section-head"><label>${d.splits.length > 1 ? '分类拆分 · 合计必须等于原币金额' : '分类与旅游项目'}</label>${button('add-split', '＋ 拆分', 'text-btn')}</div>${d.splits.map((s, i) => `<div class="split-row"><select aria-label="第 ${i + 1} 项分类" data-split="${i}" data-prop="categoryId">${options(cats, s.categoryId, c => categoryName(c.id))}</select><select aria-label="第 ${i + 1} 项旅游项目" data-split="${i}" data-prop="projectId">${options(S().projects.filter(p => !p.archived || p.id === s.projectId), s.projectId, p => p.name, '无旅游项目')}</select>${d.splits.length > 1 ? `<input aria-label="第 ${i + 1} 项金额" inputmode="decimal" placeholder="${d.currency}" value="${attr(s.amount)}" data-split="${i}" data-prop="amount">${button('remove-split', icon('close', 16), 'icon-btn', `data-index="${i}" aria-label="移除拆分"`)}` : ''}</div>`).join('')}${d.splits.length > 1 ? `<small class="muted">各项使用 ${d.currency} 原币金额；成本按相同比例分配，人民币分值尾差保持总额一致。</small>` : ''}</div>`;
}
function renderTransferFields() {
  const d = draft, to = D.account(S(), d.toAccountId), from = D.account(S(), d.accountId);
  const sources = S().sources.filter(s => !s.deleted && s.accountId === from.id && BigInt(s.principal) > sourceUsed(s).principal);
  return `${field('转入账户 / 信用卡', `<select data-field="toAccountId">${accountOptions(d.toAccountId)}</select>`)}${inputField(`转入本金（${to?.currency || 'USD'}）`, 'toAmount', d.toAmount, 'text', 'inputmode="decimal" placeholder="两端均记录实际金额"')}${from.currency !== 'CNY' && to?.currency !== 'CNY' ? field('沿用已有 CNY 成本来源', `<select data-field="sourceId">${options(sources, d.sourceId, s => `${D.money(s.principal, s.currency)} ${s.currency} / ¥${D.money(s.cny)}`, '暂不确认 · 保留待核定')}</select>`, 'full') : ''}<div class="notice full">${icon('transfer', 18)}<span>${from.currency === 'CNY' && to?.currency !== 'CNY' ? '保存两端本金后生成实际成本来源，消费分配由你选择并确认。还款不再次计支出。' : '信用卡普通还款也是转账。本金不进入收支报表；手续费可在下方单列。'}</span></div>`;
}
function renderRefundFields() {
  const available = D.posted(S()).filter(t => t.type === 'expense').flatMap(t => t.splits.filter(s => D.refunded(S(), t.id, s.id, draft.editId) < BigInt(s.amount)).map(s => ({ id: s.id, tx: t, split: s })));
  return `<div class="full"><div class="section-head"><label>关联原支出拆分项</label>${button('add-refund', '＋ 关联一项', 'text-btn')}</div>${draft.refunds.length ? draft.refunds.map((r, i) => `<div class="refund-row">${field('原支出 / 分类', `<select data-refund="${i}" data-prop="splitId">${options(available, r.splitId, a => `${a.tx.description} / ${categoryName(a.split.categoryId)} · 可退 ${D.money(BigInt(a.split.amount) - D.refunded(S(), a.tx.id, a.split.id, draft.editId), a.tx.currency)} ${a.tx.currency}`, '选择原支出')}</select>`)}${field('对应原币退款量', `<input data-refund="${i}" data-prop="amount" inputmode="decimal" value="${attr(r.amount)}" placeholder="原交易币种">`)}${field(`分配到账量（${draft.currency}）`, `<input data-refund="${i}" data-prop="received" inputmode="decimal" value="${attr(r.received)}" placeholder="实际到账">`)}${button('remove-refund', '移除', 'text-btn', `data-index="${i}"`)}</div>`).join('') : '<p class="muted">请关联原支出，退款继承其分类与项目，不计作收入。</p>'}</div>`;
}
function renderAdvanced(a) {
  const d = draft;
  return `<div class="advanced-fields form-grid">${inputField(d.type === 'adjustment' ? '调整原因（必填）' : '备注', 'notes', d.notes)}${d.state === 'posted' ? inputField('银行记账日期', 'postingDate', d.postingDate, 'date') : ''}${d.type === 'expense' ? `${inputField('银行显示 USD 中间金额（可选）', 'intermediate', d.intermediate, 'text', 'inputmode="decimal"')}${inputField('暂估 CNY 成本（可选）', 'estimatedCost', d.estimatedCost, 'text', 'inputmode="decimal" placeholder="为空时使用原币参考汇率"')}<p class="muted small full">只使用一个暂估值。填写 USD 中间金额不会叠加成本；若按 USD 估算，请直接填写对应 CNY 暂估值。</p>` : ''}${['income', 'refund'].includes(d.type) && a.currency !== 'CNY' ? inputField(d.type === 'refund' ? '实际回收 CNY 成本（可选）' : '明确确认的 CNY 金额（可选）', 'explicitCost', d.explicitCost, 'text', 'inputmode="decimal" placeholder="为空则暂估 / 待核定"') : ''}${d.type === 'transfer' ? `${inputField('独立手续费（转出账户币种）', 'fee', d.fee, 'text', 'inputmode="decimal" placeholder="无则留空"')}<p class="muted small">会原子保存为关联费用记录，汇价内无法分离的价差无需再记。</p>` : ''}${d.editId ? '<p class="small muted full">编辑会保留修订历史；已有关联成本或退款的本金变更需先处理依赖。</p>' : ''}</div>`;
}
function matches(t, f = filter) {
  if (f.deleted ? !t.deleted : (t.deleted || t.state === 'voided')) return false;
  if (f.search && !`${t.description} ${t.notes} ${t.currency}`.toLowerCase().includes(f.search.toLowerCase())) return false;
  if (f.account && !t.postings.some(p => p.accountId === f.account)) return false;
  if (f.type && t.type !== f.type || f.state && t.state !== f.state || f.from && t.date < f.from || f.to && t.date > f.to) return false;
  if ((f.category || f.project) && ![...(t.splits || []), ...(t.refunds || [])].some(s => D.matchesSplit(S(), s, {categoryId:f.category, projectId:f.project}))) return false;
  const c = D.cost(S(), t);
  if (f.cost === 'unpriced' && !c.unpriced || f.cost === 'estimated' && (!BigInt(c.estimated) || c.unpriced) || f.cost === 'actual' && (BigInt(c.estimated) || c.unpriced || !BigInt(c.actual))) return false;
  if (f.reconciliation) {
    const reconciled = S().sessions.some(s => s.status === 'completed' && !s.needsReview && s.checked?.some(id => t.postings.some(p => p.id === id)));
    if ((f.reconciliation === 'yes') !== reconciled) return false;
  }
  return true;
}
function renderFilters(isReport = false) {
  return `<div class="filter-bar"><div class="search-input">${icon('search', 17)}<input aria-label="搜索描述、备注、币种" type="search" data-filter="search" placeholder="搜索描述、备注…" value="${attr(filter.search)}"></div><select aria-label="筛选账户" data-filter="account">${options(S().accounts, filter.account, a => a.name, '全部账户')}</select><select aria-label="筛选分类" data-filter="category">${options(S().categories, filter.category, c => categoryName(c.id), '全部分类')}</select><select aria-label="筛选项目" data-filter="project">${options(S().projects, filter.project, p => p.name, '全部项目')}</select>${button('toggle-filters', filter.expanded ? '收起筛选' : '更多筛选', 'subtle')}</div>${filter.expanded ? `<div class="expanded-filters">${field('开始日期', `<input type="date" data-filter="from" value="${attr(filter.from)}">`)}${field('截止日期', `<input type="date" data-filter="to" value="${attr(filter.to)}">`)}${field('业务类型', `<select data-filter="type"><option value="">全部类型</option>${Object.entries(D.TYPES).map(([k, v]) => `<option value="${k}" ${filter.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}${field('银行状态', `<select data-filter="state"><option value="">全部状态</option><option value="pending" ${filter.state === 'pending' ? 'selected' : ''}>待入账</option><option value="posted" ${filter.state === 'posted' ? 'selected' : ''}>已入账</option><option value="voided" ${filter.state === 'voided' ? 'selected' : ''}>已撤销</option></select>`)}${field('CNY 成本', `<select data-filter="cost"><option value="">全部成本状态</option><option value="actual" ${filter.cost === 'actual' ? 'selected' : ''}>已确定</option><option value="estimated" ${filter.cost === 'estimated' ? 'selected' : ''}>含暂估</option><option value="unpriced" ${filter.cost === 'unpriced' ? 'selected' : ''}>未定价</option></select>`)}${field('对账状态', `<select data-filter="reconciliation"><option value="">全部</option><option value="yes" ${filter.reconciliation === 'yes' ? 'selected' : ''}>已对账</option><option value="no" ${filter.reconciliation === 'no' ? 'selected' : ''}>未对账</option></select>`)}${!isReport ? `<label class="check-label"><input type="checkbox" data-filter="deleted" ${filter.deleted ? 'checked' : ''}> 回收站</label>` : ''}${button('clear-filters', '清除全部', 'text-btn')}</div>` : ''}`;
}
function txBadges(t) {
  const c = D.cost(S(), t), expense = ['expense', 'income', 'refund'].includes(t.type);
  const reconciled = S().sessions.some(s => s.status === 'completed' && !s.needsReview && s.checked?.some(id => t.postings.some(p => p.id === id)));
  return `${t.deleted ? badge('已删除', 'red') : t.state === 'pending' ? badge('待入账', 'amber') : t.state === 'voided' ? badge('已撤销', 'neutral') : badge('已入账', 'neutral')}${expense ? c.unpriced ? badge('未定价', 'red') : BigInt(c.estimated) ? badge(BigInt(c.actual) ? '部分确定' : '暂估', 'amber') : badge('成本确定', 'green') : ''}${reconciled ? badge('已对账', 'green') : ''}`;
}
function transactionRow(t, compact = false) {
  const p = t.postings[0], acc = D.account(S(), p.accountId), c = D.cost(S(), t), project = [...new Set([...(t.splits || []), ...(t.refunds || [])].map(s => s.projectId).filter(Boolean))];
  const cat = t.type === 'transfer' ? `${accountName(p.accountId)} → ${accountName(t.postings[1].accountId)}` : t.type === 'adjustment' ? '不计日常收支' : t.splits?.length > 1 ? `${t.splits.length} 项分类拆分` : categoryName(t.splits?.[0]?.categoryId || t.refunds?.[0]?.categoryId);
  return `<button type="button" class="transaction-row ${selectedId === t.id ? 'selected' : ''}" data-action="detail" data-id="${attr(t.id)}"><span class="tx-icon ${t.type}">${icon(t.type === 'transfer' ? 'transfer' : t.type === 'refund' ? 'sync' : t.type === 'income' ? 'down' : 'wallet', 19)}</span><span class="tx-main"><strong>${esc(t.description)}</strong><span>${esc(cat)}${project.length ? ` <span class="project-inline">${icon('plane', 12)} ${esc(getName('projects', project[0]))}${project.length > 1 ? ' 等' : ''}</span>` : ''}</span>${!compact ? `<span class="tx-badges">${txBadges(t)}</span>` : ''}</span><span class="tx-account">${esc(acc.name)}<small>${esc(t.date)}</small></span><span class="tx-amount ${['income', 'refund'].includes(t.type) ? 'positive' : ''}">${['income', 'refund'].includes(t.type) ? '+' : t.type === 'expense' ? '−' : ''}${D.money(t.amount, t.currency)} <small>${t.currency}</small><small>${['expense', 'income', 'refund'].includes(t.type) ? `${c.unpriced ? '未定价 · ' : BigInt(c.estimated) ? '约 ' : ''}¥ ${D.money(c.total)}` : t.type === 'transfer' ? `${D.money(t.postings[1].amount, D.account(S(), t.postings[1].accountId).currency)} ${D.account(S(), t.postings[1].accountId).currency}` : ''}</small></span></button>`;
}
function renderLedger() {
  const rows = S().transactions.filter(t => matches(t) || (!filter.deleted && filter.state === 'voided' && !t.deleted && t.state === 'voided' && matches({ ...t, state: 'posted' }, { ...filter, state: '' }))).sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
  const r = scopedReport(rows.filter(t => !t.deleted && t.state !== 'voided'));
  return `${heading('TRANSACTIONS', '每一笔，都有来处。', '按消费日期查看；入账、成本和对账状态各自独立。', button('navigate', icon('plus', 17) + ' 记一笔', 'primary', 'data-route="record"'))}<section class="card ledger-card">${renderFilters()}<div class="ledger-summary"><span><strong>${rows.length}</strong> 笔记录</span><span>支出 ¥ ${D.money(r.expense)} <i>退款 ¥ ${D.money(r.refund)}</i></span>${r.unpriced.length ? badge('合计不完整', 'red') : ''}</div>${rows.length ? rows.slice(0, filter.limit || 100).map(t => transactionRow(t)).join('') : empty('没有符合条件的记录', '调整筛选条件，或记下第一笔。')}${rows.length > (filter.limit || 100) ? `<div class="center">${button('more-rows', '加载更多记录')}</div>` : ''}</section><p class="footnote">列表金额是交易原币；人民币成本会随实际入账和结算修订。最近同步：${syncTime()}</p>`;
}
function empty(title, sub = '') { return `<div class="empty">${icon('book', 32)}<h3>${esc(title)}</h3><p>${esc(sub)}</p></div>`; }
function syncTime() { return record.lastSync ? new Date(record.lastSync).toLocaleString('zh-CN', { hour12: false }) : '尚未同步'; }
async function showIphoneCheck() {
  const evidence = await V.evidence(), assetsReady = await V.offlineAssetsReady(), latest = evidence.boots.at(-1);
  const offlineBoot = [...evidence.boots].reverse().find(b => b.standalone && !b.simulation && b.firstApiResult === 'unreachable');
  const sample = save => {
    const tx = S().transactions.find(t => t.id === save.transactionId);
    const pending = record.outbox.some(o => o.changes.some(c => c.entity.id === save.transactionId));
    const conflict = record.conflicts.some(o => o.changes.some(c => c.entity.id === save.transactionId));
    return `<div class="settings-row"><div><strong>${esc(tx?.description || save.transactionId)}</strong><small>${tx ? `¥ ${D.money(tx.amount)} · ` : ''}本机提交 ${save.localCommitMs} ms · ${save.standalone ? '主屏幕应用' : '浏览器'} · ${save.simulation ? '模拟离线' : save.syncStatus === 'offline' ? '保存时 API 不可达' : save.syncStatus === 'online' ? '保存时 API 可达' : '保存时连接状态未确认'}</small></div>${badge(conflict ? '有冲突' : pending ? '待同步' : tx && !tx.deleted ? '服务器回执已确认' : '需核实', conflict ? 'red' : pending ? 'amber' : 'green')}</div>`;
  };
  showModal('iPhone 完整流程验证', `<p class="small muted">当前来源 ${esc(location.origin)}。此来源的 Safari 与主屏幕应用都要分别检查初始化和缓存状态；不要混用 IP 与 Bonjour 地址。</p><div class="diagnostic"><span>受信任 HTTPS / 安全上下文</span>${badge(isSecureContext && location.protocol === 'https:' ? 'HTTPS 安全上下文' : '尚未在 HTTPS 中', isSecureContext && location.protocol === 'https:' ? 'green' : 'amber')}</div><div class="diagnostic"><span>从主屏幕独立打开</span>${badge(V.standalone() ? '已观测到独立应用' : '当前为浏览器', V.standalone() ? 'green' : 'amber')}</div><div class="diagnostic"><span>应用壳缓存 / 控制器</span>${badge(assetsReady && navigator.serviceWorker?.controller ? '完整且已接管页面' : '尚未就绪，请联网重开', assetsReady && navigator.serviceWorker?.controller ? 'green' : 'amber')}</div><div class="diagnostic"><span>本次可记账界面耗时</span><strong>${latest ? latest.readyMs + ' ms' : '暂无观测'}</strong></div><div class="diagnostic"><span>独立应用启动时 API 不可达</span>${badge(offlineBoot ? `已观测 ${new Date(offlineBoot.at).toLocaleTimeString('zh-CN')}` : '尚未观测', offlineBoot ? 'green' : 'amber')}</div><div class="diagnostic"><span>操作队列 / 冲突</span><strong>${record.outbox.length} / ${record.conflicts.length}</strong></div>${prefs.offline ? '<div class="notice amber">请先关闭「离线演练」。真机测试要使用飞行模式，并确认 Wi-Fi 也已关闭。</div>' : ''}<ol class="migration-steps"><li>在 Safari 联网打开，添加到主屏幕。<br>从主屏幕图标联网打开一次，等缓存完整且队列为零。</li><li>点「准备联网样例」，核对 ¥12.34 并保存。<br>回到本面板检查服务器回执。</li><li>开启飞行模式，确认 Wi-Fi 已关闭。<br>在应用切换器划掉本应用，再从主屏幕图标重开。</li><li>打开本面板，应观测到独立启动且 API 不可达。<br>准备 ¥56.78 离线样例并保存，等本机提交成功。<br>再划掉重开，确认记录与待同步数量仍在。</li><li>关闭飞行模式并接回家庭 Wi-Fi，恢复应用前台。<br>等待自动同步，回本面板核对两笔回执及队列归零。</li></ol><div class="actions wrap">${button('iphone-sample-online', '准备联网样例 ¥12.34', 'subtle')}${button('iphone-sample-offline', '准备离线样例 ¥56.78', 'subtle')}${button('iphone-report-sync', '刷新并同步验证信息', 'primary')}${button('iphone-report-export', '导出验证记录', 'text-btn')}</div><section class="detail-section"><h3>本设备样例提交记录</h3>${evidence.saves.slice().reverse().map(sample).join('') || '<p class="muted">还没有样例提交。</p>'}</section><p class="small muted">浏览器观测会随同步发送到这台 Mac 的验证接口，供服务端核对交易 ID。不会记录口令；“API 不可达”不等于已证明系统飞行模式，需要你按上述步骤操作确认。</p>`, true);
}
function stat(label, amount, note = '', style = '') { return `<div class="card stat-card"><small>${label}</small><strong class="${style}"><span>¥</span> ${D.money(amount)}</strong><p>${note}</p></div>`; }
function renderReports() {
  const rows = D.transactions(S()).filter(t => matches(t)), r = scopedReport(rows);
  return `${heading('INSIGHTS', '看见钱的方向。', '基于本机数据 · 人民币成本按消费日期归属 · 退款按退款日展示')}<div class="tabs report-tabs">${[['overview', '收支趋势'], ['categories', '分类收支'], ['projects', '旅游项目'], ['accounts', '账户与净资产'], ['pending', '待处理']].map(([k, v]) => button('report-tab', v, reportTab === k ? 'active' : '', `data-tab="${k}"`)).join('')}</div><section class="card filter-card">${renderFilters(true)}</section>${reportTab === 'accounts' ? renderAccountReport() : reportTab === 'pending' ? renderPending() : `<div class="stats-grid">${stat('总支出', r.expense, '含待入账 · 转账与调整排除')}${stat('关联退款', r.refund, '继承原分类与项目', 'positive')}${stat('净支出', r.net, `已扣除退款${r.unpriced.length ? ' · 合计不完整' : ''}`)}${stat('收入', r.income, '退款不计作收入')}</div><div class="notice cost-notice">${icon('shield', 18)}<div>已确定金额 ¥ ${D.money(r.actual)} <span class="divider">/</span> 暂估金额 ¥ ${D.money(r.estimated)}${r.unpriced.length ? `<br><strong>合计不完整：</strong>${r.unpriced.map(esc).join('；')}` : ''}<small>此处成本汇总包含收入；汇率、银行入账与还款分配可修订历史成本。</small></div></div>${reportTab === 'overview' ? renderTrend(rows) : reportTab === 'categories' ? renderCategoriesReport(rows) : renderProjectsReport(rows)}`}<p class="footnote">本机副本 · 最近同步 ${syncTime()} · 成本更新时间取各交易修订时间</p>`;
}
function renderTrend(rows) {
  const months = [...new Set(rows.map(t => t.date.slice(0, 7)))].sort();
  const summaries = months.map(m => ({ month: m, ...scopedReport(rows.filter(t => t.date.startsWith(m))) }));
  const max = summaries.reduce((v, r) => r.expense > v ? r.expense : v, 1n);
  const width = value => Number((value < 0n ? 0n : value) * 10000n / max) / 100;
  return `<div class="two-col"><section class="card padded"><div class="section-head"><h2>月度收支</h2><div class="legend"><i></i>支出 <i class="refund"></i>退款</div></div>${summaries.length ? summaries.map(r => `<button class="trend-row" data-action="month-detail" data-month="${r.month}"><span>${r.month}</span><div class="bar-track"><div class="bar" style="width:${width(r.expense)}%"></div><div class="bar refund" style="width:${width(r.refund)}%"></div></div><strong>¥ ${D.money(r.net)}</strong></button>`).join('') : empty('暂无收支记录') }<p class="small muted">点击月份查看明细。净支出 = 支出 − 退款。</p><div class="table-wrap"><table><thead><tr><th>季度</th><th>收入</th><th>支出</th><th>退款</th><th>净支出</th></tr></thead><tbody>${[...new Set(months.map(m => m.slice(0, 4) + '-Q' + Math.ceil(Number(m.slice(5)) / 3)))].map(q => { const r = scopedReport(rows.filter(t => t.date.slice(0, 4) + '-Q' + Math.ceil(Number(t.date.slice(5, 7)) / 3) === q)); return `<tr><td>${q}</td><td>${D.money(r.income)}</td><td>${D.money(r.expense)}</td><td>${D.money(r.refund)}</td><td>${D.money(r.net)}</td></tr>`; }).join('')}</tbody></table></div></section><section class="card padded"><h2>分类概览</h2>${categoryBreakdown(rows).slice(0, 6).map(r => `<button class="breakdown-row" data-action="category-detail" data-id="${r.id}"><span>${esc(r.name)}</span><strong>¥ ${D.money(r.amount)}</strong>${icon('arrow', 14)}</button>`).join('') || '<p class="muted">暂无分类支出</p>'}</section></div>`;
}
function categoryBreakdown(rows, projectId = null) {
  const totals = new Map();
  for (const t of rows.filter(t => ['expense', 'refund'].includes(t.type))) {
    const splits = t.type === 'refund' ? t.refunds : t.splits;
    const amounts = t.type === 'refund' ? t.refunds.map(r => String(BigInt(r.actualCost) + BigInt(r.estimatedCost))) : D.splitCosts(S(), t);
    splits.forEach((s, i) => { if (!includedSplit(s) || projectId && s.projectId !== projectId) return; const category = S().categories.find(c => c.id === s.categoryId), id = category?.parentId || category?.id; if (!id) return; totals.set(id, (totals.get(id) || 0n) + BigInt(amounts[i]) * (t.type === 'refund' ? -1n : 1n)); });
  }
  return [...totals].map(([id, amount]) => ({ id, name: getName('categories', id), amount })).sort((a, b) => a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1);
}
function renderCategoriesReport(rows) {
  return `<section class="card padded"><h2>按当前分类树汇总</h2>${categoryBreakdown(rows).map(r => `<details class="category-group"><summary><span>${esc(r.name)}</span><strong>净支出 ¥ ${D.money(r.amount)}</strong></summary>${S().categories.filter(c => c.id === r.id || c.parentId === r.id).map(c => { let amount = 0n, count = 0; for (const t of rows.filter(t => ['expense', 'refund'].includes(t.type))) { const splits = t.type === 'refund' ? t.refunds : t.splits, costs = t.type === 'refund' ? t.refunds.map(s => String(BigInt(s.actualCost) + BigInt(s.estimatedCost))) : D.splitCosts(S(), t); splits.forEach((s, i) => { if (s.categoryId === c.id && includedSplit(s)) { amount += BigInt(costs[i]) * (t.type === 'refund' ? -1n : 1n); count++; } }); } return count ? `<button class="breakdown-row" data-action="category-detail" data-id="${c.id}"><span>${esc(c.name)} <small>${count} 项</small></span><strong>¥ ${D.money(amount)}</strong>${icon('arrow', 14)}</button>` : ''; }).join('')}</details>`).join('') || empty('暂无分类收支') }<h3 class="spaced">收入分类</h3>${S().categories.filter(c => c.type === 'income').map(c => { const amount = rows.filter(t => t.type === 'income').reduce((v, t) => { const costs = D.splitCosts(S(), t); return v + D.sum(t.splits.map((s, i) => s.categoryId === c.id && includedSplit(s) ? costs[i] : '0')); }, 0n); return `<button class="breakdown-row" data-action="category-detail" data-id="${c.id}"><span>${esc(c.name)}</span><strong>¥ ${D.money(amount)}</strong></button>`; }).join('')}</section>`;
}
function projectFigures(rows, projectId) {
  let expense = 0n, refund = 0n, actual = 0n, estimated = 0n, unpriced = false;
  for (const t of rows.filter(t => ['expense', 'refund'].includes(t.type))) {
    if (t.type === 'refund') for (const s of t.refunds.filter(s => s.projectId === projectId && includedSplit(s))) { refund += BigInt(s.actualCost) + BigInt(s.estimatedCost); actual -= BigInt(s.actualCost); estimated -= BigInt(s.estimatedCost); unpriced ||= s.unpriced; }
    else { const c = D.cost(S(), t), acts = D.distribute(c.actual, t.splits.map(s => s.amount)), ests = D.distribute(c.estimated, t.splits.map(s => s.amount)); t.splits.forEach((s, i) => { if (s.projectId !== projectId || !includedSplit(s)) return; expense += BigInt(acts[i]) + BigInt(ests[i]); actual += BigInt(acts[i]); estimated += BigInt(ests[i]); unpriced ||= c.unpriced; }); }
  }
  return { expense, refund, actual, estimated, unpriced, net: expense - refund };
}
function renderProjectsReport(rows) {
  return `<div class="section-head"><h2>旅行与项目</h2>${button('manage-projects', '管理项目', 'subtle')}</div><div class="project-grid">${S().projects.filter(p => !p.deleted).map(p => { const r = projectFigures(rows, p.id); return `<section class="card padded project-card"><div class="section-head"><span class="project-symbol">${icon('plane', 24)}</span>${p.archived ? badge('已归档', 'neutral') : badge('旅游项目', 'green')}</div><h2>${esc(p.name)}</h2><p class="muted">${esc(p.start || '未设置起始日')} — ${esc(p.end || '未设置结束日')}</p><div class="large-number"><span>¥</span> ${D.money(r.net)}</div><small class="muted">累计净支出 ${r.unpriced ? ' · 合计不完整' : ''}</small><div class="mini-stats"><div><small>总支出</small><strong>¥ ${D.money(r.expense)}</strong></div><div><small>退款</small><strong>¥ ${D.money(r.refund)}</strong></div></div><p class="small muted">已确定 ¥ ${D.money(r.actual)} · 暂估 ¥ ${D.money(r.estimated)}</p>${categoryBreakdown(rows, p.id).map(c => `<div class="project-category"><span>${esc(c.name)}</span><span>¥ ${D.money(c.amount)}</span></div>`).join('')}${button('project-detail', '查看项目明细 ' + icon('arrow', 15), 'full-width', `data-id="${p.id}"`)}</section>`; }).join('')}</div>`;
}
function renderAccountReport() {
  let assets = 0n, liabilities = 0n; const missing = [];
  const cutoff = filter.to || D.today();
  const accounts = S().accounts.filter(a => !a.deleted && (!filter.account || a.id === filter.account));
  for (const a of accounts.filter(a => a.netWorth)) { const v = D.convertMinor(D.balance(S(), a.id, cutoff), a.currency, D.rateFor(S(), a.currency, cutoff)?.rate); if (v == null) { missing.push(a.name); continue; } if (BigInt(v) >= 0n) assets += BigInt(v); else liabilities -= BigInt(v); }
  return `<div class="stats-grid three">${stat('资产估值', assets, `截至 ${cutoff}`)}${stat('信用卡负债估值', liabilities, '仅采用已入账流水')}${stat('净资产估值', assets - liabilities, missing.length ? '估值不完整 · 缺少汇率' : '按所选参考汇率估值')}</div><div class="notice">${icon('shield', 18)}<span>净资产是余额估值，不改变消费成本。${missing.length ? `缺少汇率：${missing.map(esc).join('、')}` : '外币按截至日期最近的人工参考汇率换算。'}<small>${S().rates.filter(r => !r.deleted).map(r => `${r.currency} ${r.rate} · ${r.date} · ${esc(r.source)}`).join(' / ')}</small></span></div><section class="card padded"><div class="section-head"><h2>原币账户余额</h2>${button('manage-accounts', '管理账户', 'subtle')}</div>${accounts.map(a => { const b = D.balance(S(), a.id, cutoff), pending = D.transactions(S()).filter(t => t.state === 'pending' && t.postings.some(p => p.accountId === a.id)); return `<div class="account-row"><div class="tx-icon">${icon('wallet')}</div><div class="grow"><strong>${esc(a.name)}</strong><small>${esc(a.group)} · ${a.currency}${a.archived ? ' · 已归档' : ''}${!a.netWorth ? ' · 不计净资产' : ''}</small>${a.limit ? `<small>信用额度 ${D.money(a.limit, a.currency)} ${a.currency}</small>` : ''}</div><div class="align-right"><strong>${D.money(b, a.currency)} ${a.currency}</strong><small>${pending.length ? `${pending.length} 笔待入账未计入` : '正式已入账余额'}</small></div>${button('account-history', icon('arrow', 16), 'icon-btn', `data-id="${a.id}" aria-label="查看账户明细"`)}</div>`; }).join('')}</section><section class="card padded spaced"><h2>余额历史 · 各月月末原币</h2><div class="table-wrap"><table><thead><tr><th>账户 / 币种</th>${[...new Set(D.posted(S()).map(t => t.date.slice(0, 7)))].sort().map(m => `<th>${m}</th>`).join('')}</tr></thead><tbody>${accounts.map(a => `<tr><td>${esc(a.name)} / ${a.currency}</td>${[...new Set(D.posted(S()).map(t => t.date.slice(0, 7)))].sort().map(m => `<td>${D.money(D.balance(S(), a.id, `${m}-31`), a.currency)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
}
function renderPending() {
  const pending = D.transactions(S()).filter(t => t.state === 'pending'), uncertain = D.transactions(S()).filter(t => ['expense', 'income'].includes(t.type) && (D.cost(S(), t).unpriced || BigInt(D.cost(S(), t).estimated)));
  return `<div class="two-col"><section class="card padded"><h2>等待银行入账 <small>${pending.length} 笔</small></h2>${pending.map(t => `<div class="pending-item"><strong>${esc(t.description)}</strong><p>${t.date} · ${D.money(t.amount, t.currency)} ${t.currency}${t.observations?.map(o => ` · 银行显示 ${D.money(o.amount, o.currency)} ${o.currency}`).join('') || ''}</p>${badge('仅提示，绝不自动入账', 'amber')}${button('confirm-posting', '确认入账', 'subtle', `data-id="${t.id}"`)}</div>`).join('') || empty('没有待入账记录')}</section><section class="card padded"><div class="section-head"><h2>人民币成本待确定</h2>${button('show-costs', '成本来源', 'subtle')}</div>${uncertain.map(t => transactionRow(t, true)).join('') || empty('成本均已确定')}</section></div><section class="card padded spaced"><h2>其他待处理</h2><div class="settings-row"><span>同步冲突</span><strong>${record.conflicts.length} 个</strong>${button('show-conflicts', '处理', 'subtle')}</div><div class="settings-row"><span>未完成 / 待重核对账批次</span><strong>${S().sessions.filter(s => s.status !== 'completed' || s.needsReview).length} 个</strong>${button('show-reconcile', '查看', 'subtle')}</div><div class="settings-row"><span>尚未对账的已入账交易</span><strong>${D.posted(S()).filter(t => !S().sessions.some(s => s.status === 'completed' && !s.needsReview && s.checked?.some(id => t.postings.some(p => p.id === id)))).length} 笔</strong>${button('unreconciled', '筛选', 'subtle')}</div><div class="settings-row"><span>迁移待确认</span><strong>${S().legacy.filter(r => r.pending).length} 项</strong>${button('migration', '迁移预览', 'subtle')}</div></section>`;
}
function renderSettings() {
  return `${heading('YOUR LEDGER', '本机可靠，账目有据。', '管理账户、数据和连接，验证完整的使用流程。')}<div class="settings-layout"><section><div class="card padded"><div class="section-head"><h2>连接与本机状态</h2>${badge(prefs.offline ? '离线演练' : syncStatus === 'online' ? 'NAS 可达' : '本机模式', prefs.offline ? 'amber' : 'green')}</div><div class="settings-row"><div><strong>本机操作队列</strong><small>只有 NAS 提交确认后才移出队列</small></div><strong>${record.outbox.length} 项</strong>${button('sync', '立即同步', 'subtle')}</div><div class="settings-row"><div><strong>离线演练</strong><small>暂停 API 请求；用于验证本机保存、草稿和队列</small></div><button class="switch ${prefs.offline ? 'on' : ''}" role="switch" aria-checked="${!!prefs.offline}" aria-label="离线演练" data-action="toggle-offline"><span></span></button></div><div class="settings-row"><div><strong>最近同步</strong><small>${syncTime()}</small></div>${record.conflicts.length ? badge(`${record.conflicts.length} 个冲突`, 'red') : badge('无冲突', 'green')}</div><div class="settings-row"><div><strong>设备名称</strong><small>${esc(record.deviceName)} · ${record.deviceId.slice(0, 8)}</small></div>${button('device-name', '修改', 'text-btn')}</div><div class="settings-row"><div><strong>NAS 连接口令</strong><small>本地 demo 默认无需认证；配置 LEDGER_TOKEN 后使用</small></div>${button('set-token', prefs.token ? '更新口令' : '设置', 'text-btn')}</div>${record.devices?.length ? `<details class="devices"><summary>已连接设备 ${record.devices.length} 台</summary>${record.devices.map(d => `<p>${esc(d.name)} <small>${esc(d.id.slice(0, 8))} · ${esc(d.last_seen)}</small></p>`).join('')}<p class="small muted">NAS 只能知道已连接设备；无法证明离线设备没有待上传记录。</p></details>` : ''}</div>${renderConflictList()}<div class="card padded spaced"><h2>账本管理</h2>${[['manage-accounts', 'wallet', '账户与分组', `${S().accounts.filter(D.active).length} 个可用账户 · 原币余额与信用额度`], ['manage-categories', 'book', '分类管理', '收入 / 支出树 · 更名保留身份'], ['manage-projects', 'plane', '旅游项目', '项目与分类独立 · 拆分项逐项归属'], ['show-costs', 'transfer', '实际成本来源', '还款、购汇及资金来源传递'], ['show-reconcile', 'check', '账户对账', '余额、逐项确认与重新核验'], ['manage-rates', 'chart', '参考汇率', '人工维护 · 标明日期与来源']].map(([a, i, title, sub]) => button(a, `${icon(i)}<span class="grow"><strong>${title}</strong><small>${sub}</small></span>${icon('arrow', 16)}`, 'settings-link')).join('')}</div><div class="card padded spaced"><h2>备份与迁移</h2><p class="muted small">JSON 备份包括交易、关系、成本、历史归档、本机修订和未同步队列。JSON 仅补入缺失记录，不覆盖已有差异或删除较新记录；完整灾难恢复使用服务端快照加日志。</p><div class="actions wrap">${button('export', icon('download', 17) + ' 完整导出', 'subtle')}${button('restore', '预览与恢复备份', 'subtle')}${button('migration', 'MoneyWiz 迁移预览', 'subtle')}${button('history', '本机修订历史', 'text-btn')}</div><input id="backup-file" type="file" accept="application/json,.json" hidden><input id="migration-file" type="file" accept="application/json,.json" hidden></div></section><aside><section class="card padded"><h2>PWA 验证</h2><div class="diagnostic"><span>安全上下文</span>${badge(window.isSecureContext ? '满足' : '需要 HTTPS', window.isSecureContext ? 'green' : 'red')}</div><div class="diagnostic"><span>Service Worker</span>${badge(swReady ? '离线资源就绪' : '准备中', swReady ? 'green' : 'amber')}</div><div class="diagnostic"><span>显示模式</span>${badge(matchMedia('(display-mode: standalone)').matches || navigator.standalone ? '独立应用' : '浏览器', 'neutral')}</div><div class="diagnostic"><span>持久化存储</span><span id="persist-status">检查中</span></div><div class="diagnostic"><span>最近本地保存</span><strong>${localElapsed == null ? '尚未测量' : `${Math.round(localElapsed)} ms`}</strong></div><div class="diagnostic"><span>本机保存 P95</span><strong>${record.saveTimes.length ? `${Math.round([...record.saveTimes].sort((a, b) => a - b)[Math.ceil(record.saveTimes.length * .95) - 1])} ms` : '尚未测量'}</strong></div><p class="small muted">上述是此浏览器观测值。iPhone 真机离线冷启动与 P95 目标仍需现场验证。</p><div class="actions wrap">${button('install', '安装到主屏幕', 'primary')}${button('persist', '申请持久化存储', 'subtle')}${button('iphone-check', 'iPhone 完整流程验证', 'subtle')}</div></section><section class="tip"><span>02 / 核心验证路线</span><ol><li>记账 → 离线 → 关闭重开</li><li>酒店待入账 → 确认 ¥490</li><li>还 100 USD → 支付 ¥720</li><li>选定 40 / 60 USD 消费分配</li><li>部分退款 → 检查净支出</li><li>核对余额 → 完成对账</li><li>第二浏览器 → 制造版本冲突</li></ol></section><section class="card padded spaced"><h3>数据保护</h3><p class="small muted">${record.outbox.length ? `${record.outbox.length} 项仅保存在本机，最早 ${esc(record.outbox[0].createdAt || '未知')}；清空本机可能丢失。` : '本机队列已清空。'} NAS 恢复日志批次：${record.protection?.journalSequence ?? '待连接新版服务'}。跨机器备份：未配置。</p><h3>Demo 边界</h3><p class="small muted">当前实现用于流程验证。真实 MoneyWiz SQLite/WAL 转换、生产认证与证书、增量保留期限 / 快照换代、跨机器自动备份与日志保留策略尚未实现。服务端现有本机快照及增量恢复日志；没有后台同步承诺。</p><p class="small muted">还款分配是每次手工确认的方案，不代表已确定默认计价顺序。</p></section></aside></div>`;
}
function renderConflictList() {
  if (!record.conflicts.length) return '';
  return `<section class="card padded conflict-card spaced"><h2>同步冲突 · 请明确选择</h2>${record.conflicts.map(c => `<div class="conflict-item"><strong>${esc(c.reason)}</strong><p class="small muted">一次业务操作的两端和关联记录一起处理，不静默覆盖。</p>${c.changes.map(x => { const remote = record.remoteSnapshot?.[x.collection].find(r => r.id === x.entity.id); return `<div class="conflict-versions"><div><small>本机 v${x.entity.revision}</small><pre>${esc(JSON.stringify(x.entity, null, 2))}</pre></div><div><small>NAS v${remote?.revision || 0}</small><pre>${esc(JSON.stringify(remote || null, null, 2))}</pre></div></div>`; }).join('')}<div class="actions">${button('resolve-local', '保留本机并重新提交', 'primary', `data-id="${c.id}"`)}${button('resolve-remote', '采用 NAS 版本', '', `data-id="${c.id}"`)}</div></div>`).join('')}</section>`;
}
async function persistDraft() { await DB.update(() => structuredClone(draft), 'draft'); }
function toTransaction() {
  const d = draft, a = D.account(S(), d.accountId), old = S().transactions.find(t => t.id === (d.editId || d.transactionId));
  const amount = D.parseMoney(d.amount, d.currency, d.type === 'adjustment');
  const id = d.editId || d.transactionId || (d.transactionId = D.uid()), date = d.date;
  let postingAmount = d.state === 'pending' ? null : D.parseMoney(d.accountAmount || (a.currency === d.currency ? d.amount : ''), a.currency, d.type === 'adjustment');
  if (d.type === 'expense' && postingAmount != null) postingAmount = String(-BigInt(postingAmount));
  const tx = { ...(old || {}), id, type: d.type, date, description: d.description.trim(), notes: d.notes.trim(), currency: d.currency, amount, state: d.state, postings: [{ id: old?.postings[0].id || D.uid(), accountId: a.id, amount: postingAmount, date: d.state === 'pending' ? null : d.postingDate || date }], splits: [], observations: structuredClone(old?.observations || []) };
  if (['expense', 'income'].includes(d.type)) tx.splits = d.splits.map(s => ({ id: s.id, categoryId: s.categoryId, projectId: s.projectId || null, amount: D.parseMoney(d.splits.length === 1 ? d.amount : s.amount, d.currency) }));
  if (d.type === 'transfer') {
    tx.currency = a.currency; tx.amount = D.parseMoney(d.amount, a.currency);
    tx.postings[0].amount = String(-BigInt(tx.amount));
    const to = D.account(S(), d.toAccountId);
    tx.postings.push({ id: old?.postings[1]?.id || D.uid(), accountId: to.id, amount: D.parseMoney(d.toAmount || (to.currency === a.currency ? d.amount : ''), to.currency), date: d.postingDate || date });
  }
  if (d.intermediate && !tx.observations.some(o => o.currency === 'USD' && o.amount === D.parseMoney(d.intermediate, 'USD'))) tx.observations.push({ currency: 'USD', amount: D.parseMoney(d.intermediate, 'USD'), date: D.today(), source: '人工记录银行显示' });
  tx.estimatedCost = d.estimatedCost ? D.parseMoney(d.estimatedCost) : null;
  tx.explicitCost = d.explicitCost ? D.parseMoney(d.explicitCost) : null;
  tx.valuation = { currency: d.currency, rate: D.rateFor(S(), d.currency, date)?.rate || null, source: D.rateFor(S(), d.currency, date)?.source || null, effectiveDate: D.rateFor(S(), d.currency, date)?.date || null, at: new Date().toISOString() };
  if (d.type === 'refund') {
    if (old?.refunds?.length) throw Error('已关联退款请通过修订描述或新增退款处理；demo 不直接重算既有退款分配');
    tx.postings[0].amount = tx.amount;
    tx.refunds = [];
    const refundState = structuredClone(S());
    refundState.transactions.push({ ...tx, refunds: tx.refunds });
    for (const r of d.refunds) {
      const original = S().transactions.find(t => t.splits?.some(s => s.id === r.splitId));
      if (!original) throw Error('请选择原支出拆分项');
      const split = original.splits.find(s => s.id === r.splitId);
      tx.refunds.push(D.makeRefundPart(refundState, original, split, D.parseMoney(r.amount, original.currency), D.parseMoney(r.received, d.currency)));
    }
    const historical = D.sum(tx.refunds.map(r => String(BigInt(r.actualCost) + BigInt(r.estimatedCost))));
    const recovered = a.currency === 'CNY' ? tx.amount : tx.explicitCost;
    tx.currencyDifference = { amount: recovered != null ? String(BigInt(recovered) - historical) : null, status: recovered != null && !tx.refunds.some(r => r.unpriced || BigInt(r.estimatedCost)) ? 'confirmed' : 'pending', recovered, historical: String(historical) };
  }
  return tx;
}
function sourceUsed(source) {
  const children = S().sources.filter(s => !s.deleted && s.parentId === source.id);
  return { principal: D.sum([...(source.allocations || []).map(a => a.amount), ...children.map(s => s.principal)]), cny: D.sum([...(source.allocations || []).map(a => a.cny), ...children.map(s => s.cny)]) };
}
function sourceForTransfer(tx) {
  if (tx.type !== 'transfer' || S().sources.some(s => !s.deleted && s.transactionId === tx.id)) return null;
  const from = D.account(S(), tx.postings[0].accountId), to = D.account(S(), tx.postings[1].accountId);
  if (to.currency === 'CNY') return null;
  const principal = tx.postings[1].amount;
  let cny, parentId = null;
  if (from.currency === 'CNY') cny = String(D.abs(tx.postings[0].amount));
  else if (draft.sourceId) {
    const parent = S().sources.find(s => s.id === draft.sourceId), used = sourceUsed(parent);
    cny = String(D.roundRatio(BigInt(parent.cny) * (used.principal + BigInt(principal)), BigInt(parent.principal)) - used.cny);
    parentId = parent.id;
  } else return null;
  return { id: D.uid(), transactionId: tx.id, accountId: to.id, currency: to.currency, principal, cny, parentId, date: tx.date, allocations: [], basis: parentId ? '沿用已知购汇来源' : '实际 CNY 转出本金' };
}
async function submitEntry() {
  if (entrySaving) return;
  entrySaving = true;
  const submit = $('#entry-form [type="submit"]');
  if (submit) { submit.disabled = true; submit.textContent = "正在保存到本机…"; }
  try {
    const tx = toTransaction(), before = S().transactions.find(t => t.id === tx.id);
    const changes = [{ collection: 'transactions', entity: tx }], source = sourceForTransfer(tx);
    if (source) changes.push({ collection: 'sources', entity: source });
    if (draft.type === 'transfer' && draft.fee) {
      if (before) throw Error('编辑转账时请在关联手续费原记录上修改，避免重复录入');
      const fee = D.parseMoney(draft.fee, D.account(S(), draft.accountId).currency), id = D.uid();
      changes.push({ collection: 'transactions', entity: { id, type: 'expense', date: tx.date, amount: fee, currency: D.account(S(), draft.accountId).currency, description: `${tx.description} · 手续费`, notes: '转账独立手续费', state: 'posted', relatedTransactionId: tx.id, postings: [{ id: D.uid(), accountId: draft.accountId, amount: String(-BigInt(fee)), date: tx.date }], splits: [{ id: D.uid(), categoryId: 'fee', projectId: null, amount: fee }] } });
    }
    const ok = await saveChanges(changes, before ? '编辑交易' : `新增${D.TYPES[tx.type]}`);
    if (!ok) return;
    undoEntry = { before, tx, changes };
    prefs.recentAccount = tx.postings[0].accountId; try {savePrefs();} catch { /* Preferences cannot invalidate a committed save. */ }
    const continuous = draft.continuous, previous = draft;
    draft = defaultDraft(continuous ? previous.type : 'expense');
    if (continuous) { draft.continuous = true; draft.accountId = previous.accountId; draft.currency = previous.currency; draft.splits[0].categoryId = previous.splits[0]?.categoryId || 'meal'; }
    let draftWarning = '';
    try {await persistDraft();} catch {draftWarning=' · 新草稿未能写入，请留意重开后的输入';}
    render();
    notify(`已保存到本机 · ${Math.round(localElapsed)} ms${record.outbox.length ? ' · 等待同步确认' : ''}${draftWarning}`, { action: 'undo', label: '撤销' });
    if (source && D.account(S(), source.accountId).type === 'credit') showSourceAllocation(source.id);
  } catch (e) { notify(e.message); }
  finally { entrySaving = false; const submit = $('#entry-form [type="submit"]'); if (submit?.disabled) { submit.disabled = false; submit.innerHTML = `${icon("check", 18)}保存到本机`; } }
}
function editTransaction(id) {
  const t = S().transactions.find(t => t.id === id), p = t.postings[0], a = D.account(S(), p.accountId);
  if (t.type === 'refund') { showMetadataEdit(t); return; }
  draft = { ...defaultDraft(t.type), editId: t.id, type: t.type, date: t.date, amount: D.decimal(t.amount, t.currency), currency: t.currency, accountId: p.accountId, accountAmount: p.amount == null ? '' : D.decimal(t.type === 'adjustment' ? p.amount : D.abs(p.amount), a.currency), postingDate: p.date || t.date, description: t.description, notes: t.notes || '', state: t.state, estimatedCost: t.estimatedCost == null ? '' : D.decimal(t.estimatedCost), explicitCost: t.explicitCost == null ? '' : D.decimal(t.explicitCost), advanced: true, intermediate: t.observations?.length ? D.decimal(t.observations.at(-1).amount, t.observations.at(-1).currency) : '', splits: (t.splits?.length ? t.splits : defaultDraft(t.type).splits).map(s => ({ ...s, amount: D.decimal(s.amount || '0', t.currency), projectId: s.projectId || '' })) };
  if (t.type === 'transfer') { const to = D.account(S(), t.postings[1].accountId); draft.toAccountId = to.id; draft.toAmount = D.decimal(t.postings[1].amount, to.currency); }
  closeModal(); route = 'record'; persistDraft(); render(); window.scrollTo(0, 0);
}
function showMetadataEdit(t) {
  showModal('编辑退款说明', `<form data-form="metadata" data-id="${t.id}">${inputField('描述', 'description', t.description)}${inputField('备注', 'notes', t.notes)}<p class="small muted">退款本金与原拆分关联保持在同一聚合中，修订历史可追溯。</p><button class="btn primary" type="submit">保存到本机</button></form>`);
}
function detail(id) {
  selectedId = id;
  const t = S().transactions.find(t => t.id === id), c = D.cost(S(), t), relatedSources = S().sources.filter(s => !s.deleted && s.transactionId === id);
  const pending = t.state === 'pending', original = t.type === 'refund';
  showModal('交易详情', `<div class="detail-title"><div>${badge(D.TYPES[t.type], 'neutral')}<h2>${esc(t.description)}</h2><p>${t.date} · v${t.revision} · 更新 ${new Date(t.updatedAt).toLocaleString('zh-CN')}</p></div><div class="large-number">${D.money(t.amount, t.currency)} <small>${t.currency}</small></div></div><div class="detail-badges">${txBadges(t)}${record.outbox.some(o => o.changes.some(c => c.entity.id === t.id)) ? badge('本机已保存 · 待同步', 'amber') : badge('已同步到 NAS', 'green')}</div><div class="detail-grid">${t.postings.map(p => { const a = D.account(S(), p.accountId); return `<div><small>${esc(a.name)}</small><strong>${p.amount == null ? '最终金额未知' : D.money(p.amount, a.currency) + ' ' + a.currency}</strong><small>银行记账日期 ${esc(p.date || '待确认')}</small></div>`; }).join('')}${['expense', 'income', 'refund'].includes(t.type) ? `<div><small>CNY 报表成本</small><strong>¥ ${D.money(c.total)}${c.unpriced ? ' · 合计不完整' : ''}</strong><small>确定 ${D.money(c.actual)} / 暂估 ${D.money(c.estimated)}</small></div>` : ''}</div>${t.observations?.length ? `<section class="detail-section"><h3>银行中间金额历史</h3>${t.observations.map(o => `<p>${D.money(o.amount, o.currency)} ${o.currency} · ${esc(o.date)} · ${esc(o.source)}</p>`).join('')}<small class="muted">信息记录，不参与正式账户余额。</small></section>` : ''}${t.splits?.length ? `<section class="detail-section"><h3>分类与项目拆分</h3>${t.splits.map((s, i) => `<div class="breakdown-row"><span>${esc(categoryName(s.categoryId))}<small>${s.projectId ? esc(getName('projects', s.projectId)) : '无项目'}</small></span><span>${D.money(s.amount, t.currency)} ${t.currency}<small>¥ ${D.money(D.splitCosts(S(), t)[i])}</small></span></div>`).join('')}</section>` : ''}${original ? `<section class="detail-section"><h3>退款关联与汇兑差额</h3>${t.refunds.map(r => `<button class="breakdown-row" data-action="detail" data-id="${r.transactionId}"><span>${esc(S().transactions.find(x => x.id === r.transactionId)?.description)} / ${esc(categoryName(r.categoryId))}<small>${r.projectId ? esc(getName('projects', r.projectId)) : '无项目'}</small></span><span>${D.money(r.amount, r.originalCurrency)} ${r.originalCurrency}</span>${icon('arrow', 14)}</button>`).join('')}<p>历史成本冲减 ¥ ${D.money(c.total)}</p><p>汇兑差额 ${t.currencyDifference?.status === 'confirmed' ? '¥ ' + D.money(t.currencyDifference.amount) : '待核定'} <small class="muted">实际回收成本 − 历史成本冲减</small></p></section>` : ''}${relatedSources.map(s => `<section class="detail-section"><h3>实际成本来源</h3><p>${D.money(s.principal, s.currency)} ${s.currency} ↔ ¥ ${D.money(s.cny)} · ${esc(s.basis)}</p>${button('allocate', '查看 / 分配消费成本', 'subtle', `data-id="${s.id}"`)}</section>`).join('')}${t.notes ? `<p class="detail-section"><small>备注 / 调整原因</small>${esc(t.notes)}</p>` : ''}<div class="detail-section"><h3>修订记录</h3>${record.history.filter(h => h.changes?.some(c => c.after?.id === id)).slice(-5).reverse().map(h => `<p class="small">${esc(h.label)} · ${new Date(h.at).toLocaleString('zh-CN')}</p>`).join('') || '<p class="small muted">本设备无更早修订；NAS 保留服务端修订。</p>'}</div><div class="actions wrap">${!t.deleted && t.state !== 'voided' ? `${pending ? button('confirm-posting', '确认银行入账', 'primary', `data-id="${id}"`) : ''}${button('edit', '编辑', 'subtle', `data-id="${id}"`)}${t.type === 'expense' && t.state === 'posted' ? button('refund-from', '关联退款', '', `data-id="${id}"`) : ''}${pending ? button('void', '撤销待入账', 'danger-text', `data-id="${id}"`) : button('delete', '删除', 'danger-text', `data-id="${id}"`)}` : t.deleted ? button('restore-tx', '恢复此记录', 'primary', `data-id="${id}"`) : ''}</div>`, true);
}
function confirmPosting(id) {
  const t = S().transactions.find(t => t.id === id), a = D.account(S(), t.postings[0].accountId);
  showModal('确认银行实际入账', `<form data-form="posting" data-id="${id}"><div class="notice"><span>${esc(t.description)}<br>${t.date} · ${D.money(t.amount, t.currency)} ${t.currency}${t.observations?.map(o => `<br>银行显示 ${D.money(o.amount, o.currency)} ${o.currency}`).join('') || ''}</span></div>${inputField(`实际账户金额（${a.currency}）`, 'amount', '', 'text', 'inputmode="decimal" required placeholder="例如 490.00"')}${inputField('银行记账日期', 'date', D.today(), 'date', 'required')}<p class="small muted">保留消费日期、原币、拆分、项目和旧暂估值。${a.currency === 'CNY' ? '实际 CNY 金额会确定消费成本，后续还款不改变此成本。' : '外币正式余额确定，人民币成本可在实际还款后确认。'}</p><button class="btn primary" type="submit">更新原交易并保存</button></form>`);
}
function showSources() {
  showModal('实际人民币成本来源', `<div class="notice"><span>来自真实转账的 CNY 本金，不依赖市场汇率。消费集合和覆盖金额由你确认，已确认分配不因后来补记自动重排。</span></div>${S().sources.filter(s => !s.deleted).map(s => { const used = sourceUsed(s); return `<div class="source-row"><div><strong>${accountName(s.accountId)}</strong><p>${D.money(s.principal, s.currency)} ${s.currency} / ¥ ${D.money(s.cny)}</p><small>可用 ${D.money(BigInt(s.principal) - used.principal, s.currency)} ${s.currency} / ¥ ${D.money(BigInt(s.cny) - used.cny)}${s.parentId ? ' · 继承上游来源' : ''}</small></div>${button('allocate', '分配 / 查看', 'subtle', `data-id="${s.id}"`)}</div>`; }).join('') || empty('尚无实际成本来源', '记一笔 CNY → 外币账户 / 信用卡转账即可生成。')}<div class="actions">${button('new-repayment', '记跨币种还款', 'primary')}${button('new-exchange', '先购汇到外币账户', 'subtle')}</div>`, true);
}
function showSourceAllocation(id) {
  const source = S().sources.find(s => s.id === id), used = sourceUsed(source), a = D.account(S(), source.accountId);
  const candidates = D.posted(S()).filter(t => t.type === 'expense' && t.postings[0].accountId === source.accountId).map(t => ({ t, remaining: D.allocationLimit(S(), t) - D.sum(D.allocationsFor(S(), t.id).map(a => a.amount)) })).filter(r => r.remaining > 0n);
  showModal('选择消费，确认实际成本', `<div class="notice"><span>来源 ${D.money(source.principal, source.currency)} ${source.currency} / ¥ ${D.money(source.cny)}<br>剩余 ${D.money(BigInt(source.principal) - used.principal, source.currency)} ${source.currency} / ¥ ${D.money(BigInt(source.cny) - used.cny)}<small>不自动选择默认顺序。未分配资金保留；溢缴款不会强行摊入消费。</small></span></div>${source.allocations?.length ? `<h3>已确认的分配</h3>${source.allocations.map(a => `<div class="breakdown-row"><span>${esc(S().transactions.find(t => t.id === a.transactionId)?.description)}</span><span>${D.money(a.amount, source.currency)} ${source.currency} → ¥ ${D.money(a.cny)}</span></div>`).join('')}<p class="small muted">已确认分配保留，余款可继续追加分配，不会重排旧分配。</p>` : ''}${BigInt(source.principal) > used.principal ? `<form data-form="allocation" data-id="${id}">${candidates.length ? `<p class="small muted">手工输入本次覆盖量；留空表示不覆盖。分值尾差按稳定列表顺序分配。</p>${candidates.map(({ t, remaining }) => `<div class="allocation-row"><div><strong>${esc(t.description)}</strong><small>${t.postings[0].date} · 可结算 ${D.money(remaining, source.currency)} ${source.currency}</small></div><input aria-label="${attr(t.description)}覆盖金额" data-target="${t.id}" inputmode="decimal" placeholder="0.00" value=""><span>${source.currency}</span></div>`).join('')}<div id="allocation-preview" class="notice">输入覆盖金额后预览 CNY 分配。</div><label class="check-label"><input type="checkbox" name="confirmed" required> 我已核实消费集合与覆盖本金</label><button type="submit" class="btn primary spaced">确认分配，回填消费成本</button>` : `<p class="muted">${a.type !== 'credit' ? '可在转账表单选择此来源，将外币资金转入信用卡并传递原始 CNY 成本。' : '当前没有可结算消费。期初欠款、溢缴款保留，不会摊给其他消费。'}</p>`}</form>` : ''}`, true);
}
function allocationPlan(form, source) {
  const chosen = [...form.querySelectorAll('[data-target]')].filter(i => i.value.trim()).map(i => ({ transactionId: i.dataset.target, amount: D.parseMoney(i.value, source.currency) })).filter(a => BigInt(a.amount) > 0n);
  const total = D.sum(chosen.map(a => a.amount)), used = sourceUsed(source);
  if (!total) throw Error('至少填写一笔消费的覆盖金额');
  if (used.principal + total > BigInt(source.principal)) throw Error('覆盖本金超过来源可用金额');
  const cny = D.roundRatio(BigInt(source.cny) * (used.principal + total), BigInt(source.principal)) - used.cny;
  const amounts = D.distribute(cny, chosen.map(a => a.amount));
  return chosen.map((a, i) => ({ ...a, id: D.uid(), cny: amounts[i] }));
}
function showManager(kind) {
  const collection = { accounts: 'accounts', categories: 'categories', projects: 'projects', rates: 'rates' }[kind];
  const titles = { accounts: '账户与分组', categories: '分类管理', projects: '旅游项目', rates: '参考汇率' };
  showModal(titles[kind], `<div class="section-head"><p class="small muted">更名保留历史身份；归档后从新增记录常用列表中隐藏。</p>${button('new-entity', '＋ 新建', 'primary', `data-kind="${kind}"`)}</div>${S()[collection].filter(r => !r.deleted).map((r, index) => `<div class="manager-row"><div class="grow"><strong>${esc(kind === 'categories' ? categoryName(r.id) : kind === 'rates' ? `${r.currency} → CNY · ${r.rate}` : r.name)}</strong><small>${kind === 'accounts' ? `${esc(r.group || '未分组')} · ${r.currency} · 余额 ${D.money(D.balance(S(), r.id), r.currency)}${r.netWorth ? ' · 计入净资产' : ''}` : kind === 'rates' ? `${r.date} · ${esc(r.source)}` : kind === 'projects' ? `${esc(r.start || '')} — ${esc(r.end || '')}` : r.type === 'income' ? '收入分类' : '支出分类'}${r.archived ? ' · 已归档' : ''}</small></div>${kind === 'accounts' ? `${button('move-account', '↑', 'icon-btn', `data-index="${index}" data-dir="-1" aria-label="上移账户"`)}${button('move-account', '↓', 'icon-btn', `data-index="${index}" data-dir="1" aria-label="下移账户"`)}` : ''}${button('edit-entity', '编辑', 'text-btn', `data-kind="${kind}" data-id="${r.id}"`)}${kind !== 'rates' ? button('archive-entity', r.archived ? '取消归档' : '归档', 'text-btn', `data-kind="${kind}" data-id="${r.id}"`) : ''}</div>`).join('')}`, true);
}
function editEntity(kind, id) {
  const r = S()[kind].find(r => r.id === id) || {};
  showModal(id ? '编辑' : '新建', `<form data-form="entity" data-kind="${kind}" data-id="${id || ''}" class="entity-form">${kind !== 'rates' ? inputField('名称', 'name', r.name || '', 'text', 'required maxlength="80"') : ''}${kind === 'accounts' ? `${field('账户类型', `<select name="type">${[['bank', '银行账户'], ['cash', '现金'], ['credit', '信用卡']].map(([v, n]) => `<option value="${v}" ${r.type === v ? 'selected' : ''}>${n}</option>`).join('')}</select>`)}${field('币种', `<select name="currency">${Object.keys(D.DIGITS).map(c => `<option ${r.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select>`)}${inputField('账户分组', 'group', r.group || '日常资金')}${inputField('信用额度（账户币种，选填）', 'limit', r.limit ? D.decimal(r.limit, r.currency) : '', 'text', 'inputmode="decimal"')}${!id ? inputField('期初余额（负数表示欠款）', 'opening', '0', 'text', 'inputmode="decimal"') : ''}<label class="check-label"><input name="netWorth" type="checkbox" ${r.netWorth !== false ? 'checked' : ''}>计入净资产</label>` : ''}${kind === 'categories' ? `${field('分类类型', `<select name="type">${[['expense', '支出'], ['income', '收入']].map(([v, n]) => `<option value="${v}" ${r.type === v ? 'selected' : ''}>${n}</option>`).join('')}</select>`)}${field('父分类（选填）', `<select name="parentId">${options(S().categories.filter(c => c.id !== id), r.parentId, c => `${c.type === 'expense' ? '支出' : '收入'} · ${categoryName(c.id)}`, '顶级分类')}</select>`)}` : ''}${kind === 'projects' ? `${inputField('开始日期（选填）', 'start', r.start || '', 'date')}${inputField('结束日期（选填）', 'end', r.end || '', 'date')}${inputField('备注', 'notes', r.notes || '')}` : ''}${kind === 'rates' ? `${field('币种', `<select name="currency"><option ${r.currency === 'USD' ? 'selected' : ''}>USD</option><option ${r.currency === 'JPY' ? 'selected' : ''}>JPY</option></select>`)}${inputField('1 原币 = CNY', 'rate', r.rate || '', 'text', 'inputmode="decimal" required')}${inputField('生效日期', 'date', r.date || D.today(), 'date', 'required')}${inputField('汇率来源', 'source', r.source || '人工参考', 'text', 'required')}<p class="small muted">用于未结算消费暂估和余额估值，不改写已确定成本。</p>` : ''}<button class="btn primary" type="submit">保存到本机</button></form>`);
}
function showReconciliations() {
  showModal('账户对账', `<p class="muted">待入账单独列出，不参与正式余额和逐项确认。离线可准备草稿，正式完成需要同步成功。</p>${button('new-session', '＋ 新建对账草稿', 'primary')}${S().sessions.filter(s => !s.deleted).sort((a, b) => a.cutoff.localeCompare(b.cutoff)).map(s => `<div class="manager-row"><div class="grow"><strong>${esc(accountName(s.accountId))}</strong><small>截至 ${s.cutoff} · 外部余额 ${D.money(s.external, D.account(S(), s.accountId).currency)}</small></div>${badge(s.needsReview || s.status === 'reopened' ? '重新核验' : s.status === 'completed' ? '已完成' : '草稿', s.status === 'completed' && !s.needsReview ? 'green' : 'amber')}${button('open-session', '打开', 'subtle', `data-id="${s.id}"`)}</div>`).join('') || '<p class="small muted">尚无对账批次。</p>'}`, true);
}
function newSession() {
  showModal('新建对账草稿', `<form data-form="new-session">${field('账户', `<select name="accountId">${accountOptions('bank-cny')}</select>`)}${inputField('银行账单截止日', 'cutoff', D.today(), 'date', 'required')}${inputField('外部账单期末余额', 'external', '', 'text', 'required inputmode="decimal" placeholder="欠款请填负数"')}<button class="btn primary" type="submit">保存对账草稿</button></form>`);
}
function openSession(id) {
  const s = S().sessions.find(s => s.id === id), a = D.account(S(), s.accountId), f = D.sessionFigures(S(), s);
  const pending = D.transactions(S()).filter(t => t.state === 'pending' && t.postings[0].accountId === a.id), completed = s.status === 'completed' && !s.needsReview;
  showModal(`${a.name} · 对账`, `<form data-form="session" data-id="${id}"><div class="reconcile-stats">${[['起始确认余额', f.opening], ['期间变动', f.movement], ['计算期末余额', f.computed], ['外部期末余额', s.external], ['差额', f.difference]].map(([label, amount]) => `<div><small>${label}</small><strong class="${label === '差额' && amount !== '0' ? 'negative' : ''}">${D.money(amount, a.currency)} <small>${a.currency}</small></strong></div>`).join('')}</div><p class="small muted">截至 ${s.cutoff} · ${s.status === 'reopened' || s.needsReview ? '已重新打开，需要重新核验' : completed ? '已完成' : '草稿'} · 仅包含已入账流水</p><input class="session-search" type="search" placeholder="检索待核对的描述" aria-label="检索对账流水"><div class="reconcile-list">${f.rows.map(({ tx, posting }) => `<label class="reconcile-row" data-description="${attr(tx.description.toLowerCase())}"><input type="checkbox" name="checked" value="${posting.id}" ${s.checked?.includes(posting.id) ? 'checked' : ''} ${completed ? 'disabled' : ''}><span class="grow"><strong>${esc(tx.description)}</strong><small>${posting.date} · v${tx.revision}</small></span><strong>${D.money(posting.amount, a.currency)}</strong></label>`).join('')}</div>${pending.length ? `<div class="notice amber"><span>以下 ${pending.length} 笔待入账不参与余额：${pending.map(t => esc(t.description)).join('、')}</span></div>` : ''}${completed ? `<div class="actions">${button('reopen-session', '显式重新打开批次及后续批次', 'subtle', `data-id="${id}"`)}</div>` : `${inputField('外部期末余额', 'external', D.decimal(s.external, a.currency), 'text', 'inputmode="decimal" required')}<label class="check-label"><input name="devicesChecked" type="checkbox"> 我已核实其他设备没有未上传记录</label><p class="small muted">完成前将保存草稿并同步，要求队列清空且无冲突。NAS 无法替你确认仍离线的设备。</p><div class="actions wrap"><button type="submit" class="btn" name="intent" value="draft">保存草稿</button><button type="submit" class="btn primary" name="intent" value="complete">同步并完成对账</button>${button('adjustment', '新增注明原因的调整', 'text-btn', `data-id="${a.id}"`)}</div>`}</form>`, true);
}
function downloadJSON(data, filename) {
  const link = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
let pendingBackup;
function previewBackup(backup) {
  if (backup.format !== 'fine-ledger-backup' || backup.version !== 1) throw Error('请选择 Fine Ledger v1 JSON 备份');
  D.validateState(backup.state); pendingBackup = backup;
  showModal('备份恢复预览', `<div class="notice"><span>仅补入当前缺失的记录，并生成新修订同步。不会删除当前较新记录；与已有记录不同时将拒绝覆盖。完整旧版本恢复请使用独立账本的快照加增量日志。已有待同步操作或冲突时禁止补入。</span></div><p>导出时间 ${esc(backup.exportedAt)} · ${backup.state.transactions.length} 笔交易 · ${backup.state.accounts.length} 个账户 · ${backup.state.sources.length} 个成本来源</p><p class="small muted">备份含 ${backup.outbox?.length || 0} 项当时待同步操作；恢复时按完整业务快照生成新操作，不重复发送旧操作 ID。</p><table><thead><tr><th>账户</th><th>备份原币余额</th></tr></thead><tbody>${backup.state.accounts.map(a => `<tr><td>${esc(a.name)}</td><td>${D.money(D.balance(backup.state, a.id), a.currency)} ${a.currency}</td></tr>`).join('')}</tbody></table><div class="actions spaced">${button('confirm-restore', '补入缺失记录', 'primary')}${button('close-modal', '取消')}</div>`, true);
}
let migrationPreview;
function showMigration() {
  showModal('MoneyWiz 迁移 · 交互预览', `<div class="notice amber"><span><strong>此入口验证迁移流程，不读取真实 SQLite/WAL。</strong><br>真实转换器尚未实现；请勿上传含凭证的原始备份。可载入本 demo 的合成中间格式并预览校验。</span></div><ol class="migration-steps"><li>在副本上转换 → 保留原始备份</li><li>校验原币余额、关系、拆分和历史归档</li><li>逐个选择旧标签映射与金额分配</li><li>预览通过后确认，再人工核对历史月份</li></ol><div class="actions">${button('migration-sample', '载入合成迁移样例', 'primary')}${button('migration-upload', '选择中间格式 JSON', '')}</div>`, true);
}
function previewMigration(data) {
  if (data.format !== 'fine-ledger-migration-demo' || !data.batchId) throw Error('仅支持 fine-ledger-migration-demo 合成中间格式');
  D.validateState(data.state); migrationPreview = data;
  const state = data.state;
  const duplicates = S().legacy.some(l => l.id === data.batchId);
  showModal('迁移校验预览', `<div class="notice"><span>结构校验通过 · ${state.transactions.length} 笔业务交易 · ${state.accounts.length} 个账户<br>转账成对、拆分合计、退款上限、成本来源已校验。</span></div><p class="small muted">这是合成数据流程，不代表 MoneyWiz 真实迁移验收。</p><table><thead><tr><th>账户</th><th>原币余额</th></tr></thead><tbody>${state.accounts.map(a => `<tr><td>${esc(a.name)}</td><td>${D.money(D.balance(state, a.id), a.currency)} ${a.currency}</td></tr>`).join('')}</tbody></table><h3>旧标签「旅行旧标记」</h3><select id="legacy-tag-choice"><option value="history">仅保留历史标记</option><option value="project">映射到旅游项目（待分配，不复制金额）</option></select><p class="small muted">预算原始字段保留在历史归档，不进入实时收支。多标签映射项目在分配未确认前标为待处理。</p><div class="actions">${button('confirm-migration', duplicates ? '此批次已导入' : '确认导入样例', 'primary', duplicates ? 'disabled' : '')}${button('close-modal', '取消')}</div>`, true);
}
function savePrefs() { localStorage.setItem('fine-ledger-prefs', JSON.stringify(prefs)); }
function navigate(target) {
  route = target; filter.limit = 100; history.replaceState(null, '', `#${route}`); render(); window.scrollTo(0, 0);
  if (route === 'settings') diagnostics();
}
async function diagnostics() {
  const persisted = await navigator.storage?.persisted?.();
  const usage = await navigator.storage?.estimate?.();
  if ($('#persist-status')) $('#persist-status').innerHTML = `${badge(persisted ? '已持久化' : '由浏览器管理', persisted ? 'green' : 'amber')}<small>${usage ? `${Math.round(usage.usage / 1024)} KB 已用` : ''}</small>`;
}
document.addEventListener('click', async event => {
  const btn = event.target.closest('[data-action]');
  if (!btn || btn.disabled) return;
  const { action, id, kind } = btn.dataset;
  try {
    switch (action) {
      case 'navigate': navigate(btn.dataset.route); break;
      case 'close-modal': cancelReopen?.(); closeModal(); break;
      case 'sync': await trySync(true); break;
      case 'entry-type': {
        if (draft.editId) { notify('编辑中不能更换交易类型，请取消编辑后新建'); break; }
        const old = draft; draft = { ...defaultDraft(btn.dataset.type), accountId: old.accountId, date: old.date, postingDate: old.date, currency: D.account(S(), old.accountId).currency, continuous: old.continuous };
        if (draft.type === 'refund') draft.refunds = [{ splitId: '', amount: '', received: '' }];
        await persistDraft(); render(); break;
      }
      case 'toggle-advanced': draft.advanced = !draft.advanced; await persistDraft(); render(); break;
      case 'add-split': {
        if (draft.splits.length === 1 && !draft.splits[0].amount) draft.splits[0].amount = draft.amount;
        draft.splits.push({ id: D.uid(), categoryId: draft.type === 'income' ? 'salary' : 'meal', amount: '', projectId: '' }); await persistDraft(); render(); break;
      }
      case 'remove-split': draft.splits.splice(Number(btn.dataset.index), 1); await persistDraft(); render(); break;
      case 'add-refund': draft.refunds.push({ splitId: '', amount: '', received: '' }); await persistDraft(); render(); break;
      case 'remove-refund': draft.refunds.splice(Number(btn.dataset.index), 1); await persistDraft(); render(); break;
      case 'cancel-edit': draft = defaultDraft(); await persistDraft(); render(); break;
      case 'toggle-offline': prefs.offline = !prefs.offline; savePrefs(); notify(prefs.offline ? '离线演练已开启：本机记账继续，队列保留' : '离线演练已结束，正在同步'); render(); await trySync(); break;
      case 'detail': detail(id); break;
      case 'edit': editTransaction(id); break;
      case 'confirm-posting': confirmPosting(id); break;
      case 'confirm-reopen': await pendingReopen?.(); break;
      case 'delete': {
        const t = S().transactions.find(t => t.id === id);
        showModal('删除这笔记录？', `<p>${esc(t.description)} · ${D.money(t.amount, t.currency)} ${t.currency}</p><p class="muted">采用逻辑删除，历史保留，可从回收站恢复。有关联退款、成本或对账时会先检查依赖。</p>${button('confirm-delete', '确认删除', 'danger', `data-id="${id}"`)}`); break;
      }
      case 'confirm-delete': case 'restore-tx': case 'void': {
        const t = S().transactions.find(t => t.id === id), row = { ...t, ...(action === 'void' ? { state: 'voided' } : { deleted: action === 'confirm-delete' }) };
        if (await saveChanges([{ collection: 'transactions', entity: row }], action === 'void' ? '银行撤销待入账' : action === 'restore-tx' ? '恢复交易' : '逻辑删除交易')) { closeModal(); notify('已保存到本机，修订历史保留'); } break;
      }
      case 'undo': {
        if (!undoEntry) break;
        const changes = undoEntry.changes.map(c => ({ collection: c.collection, entity: c.collection === 'transactions' && c.entity.id === undoEntry.tx.id && undoEntry.before ? undoEntry.before : { ...S()[c.collection].find(r => r.id === c.entity.id), deleted: true } }));
        // Sources are tombstoned first so their own transfer may be undone atomically.
        changes.sort((a, b) => a.collection === 'sources' ? -1 : b.collection === 'sources' ? 1 : 0);
        if (await saveChanges(changes, '撤销上一次保存')) { undoEntry = null; notify('已撤销，历史保留'); } break;
      }
      case 'refund-from': {
        const t = S().transactions.find(t => t.id === id);
        draft = defaultDraft('refund'); draft.accountId = t.postings[0].accountId; draft.currency = D.account(S(), draft.accountId).currency; draft.description = `${t.description} · 退款`; draft.refunds = t.splits.filter(s => D.refunded(S(), t.id, s.id) < BigInt(s.amount)).map(s => ({ splitId: s.id, amount: '', received: '' })); closeModal(); await persistDraft(); navigate('record'); break;
      }
      case 'show-pending': filter = { ...filter, type: '', state: 'pending', expanded: true, deleted: false }; navigate('ledger'); break;
      case 'unreconciled': filter = { ...filter, reconciliation: 'no', state: 'posted', expanded: true }; navigate('ledger'); break;
      case 'show-conflicts': closeModal(); navigate('settings'); break;
      case 'toggle-filters': filter.expanded = !filter.expanded; render(); break;
      case 'clear-filters': filter = { search: '', account: '', category: '', project: '', from: '', to: '', state: '', type: '', cost: '', reconciliation: '', expanded: true, deleted: false }; render(); break;
      case 'more-rows': filter.limit = (filter.limit || 100) + 100; render(); break;
      case 'report-tab': reportTab = btn.dataset.tab; render(); break;
      case 'month-detail': filter.from = `${btn.dataset.month}-01`; filter.to = `${btn.dataset.month}-31`; filter.expanded = true; navigate('ledger'); break;
      case 'category-detail': filter.category = id; filter.type = ''; filter.cost = ''; navigate('ledger'); break;
      case 'project-detail': filter.project = id; filter.type = ''; navigate('ledger'); break;
      case 'account-history': filter.account = id; filter.type = ''; filter.state = 'posted'; filter.expanded = true; navigate('ledger'); break;
      case 'show-costs': showSources(); break;
      case 'allocate': showSourceAllocation(id); break;
      case 'new-repayment': case 'new-exchange': draft = defaultDraft('transfer'); draft.accountId = 'bank-cny'; draft.toAccountId = action === 'new-repayment' ? 'cc-usd' : 'bank-usd'; draft.description = action === 'new-repayment' ? '外币信用卡还款' : '购汇'; closeModal(); await persistDraft(); navigate('record'); break;
      case 'manage-accounts': showManager('accounts'); break;
      case 'manage-categories': showManager('categories'); break;
      case 'manage-projects': showManager('projects'); break;
      case 'manage-rates': showManager('rates'); break;
      case 'new-entity': editEntity(kind); break;
      case 'edit-entity': editEntity(kind, id); break;
      case 'archive-entity': { const r = S()[kind].find(r => r.id === id); if (await saveChanges([{ collection: kind, entity: { ...r, archived: !r.archived } }], r.archived ? '取消归档' : '归档')) showManager(kind); break; }
      case 'move-account': { const index = Number(btn.dataset.index), next = index + Number(btn.dataset.dir), list = S().accounts; if (next < 0 || next >= list.length) break; const changes = [{ collection: 'accounts', entity: { ...list[index], sort: next } }, { collection: 'accounts', entity: { ...list[next], sort: index } }]; if (await saveChanges(changes, '账户排序')) { await DB.update(r => ({ ...r, state: { ...r.state, accounts: r.state.accounts.sort((a, b) => (a.sort ?? list.findIndex(x => x.id === a.id)) - (b.sort ?? list.findIndex(x => x.id === b.id))) } })); await refresh(); showManager('accounts'); } break; }
      case 'show-reconcile': showReconciliations(); break;
      case 'new-session': newSession(); break;
      case 'open-session': openSession(id); break;
      case 'reopen-session': { const s = S().sessions.find(s => s.id === id), changes = S().sessions.filter(x => x.accountId === s.accountId && x.cutoff >= s.cutoff).map(x => ({ collection: 'sessions', entity: { ...x, status: 'reopened', needsReview: false } })); if (await saveChanges(changes, '显式重新打开对账链')) openSession(id); break; }
      case 'adjustment': draft = defaultDraft('adjustment'); draft.accountId = id; draft.currency = D.account(S(), id).currency; draft.advanced = true; draft.description = '对账差额调整'; closeModal(); await persistDraft(); navigate('record'); break;
      case 'device-name': showModal('设备名称', `<form data-form="device">${inputField('用于识别同步来源', 'name', record.deviceName, 'text', 'required maxlength="60"')}<button class="btn primary">保存</button></form>`); break;
      case 'set-token': showModal('NAS 连接口令', `<form data-form="token">${inputField('与服务端 LEDGER_TOKEN 一致', 'token', '', 'password', 'autocomplete="off"')}<p class="small muted">口令仅保存在本浏览器。认证失效不影响已初始化账本的本地记账。</p><button class="btn primary">更新并重试</button></form>`); break;
      case 'resolve-local': case 'resolve-remote': await DB.resolveConflict(id, action === 'resolve-local' ? 'local' : 'remote'); await refresh(); render(); trySync(); notify('已明确选择版本，双方内容保留在本机历史中'); break;
      case 'export': downloadJSON({ draft:await DB.read('draft'), format: 'fine-ledger-backup', version: 1, exportedAt: new Date().toISOString(), ...record }, `fine-ledger-${D.today()}.json`); notify('已导出完整本机备份'); break;
      case 'restore': $('#backup-file').click(); break;
      case 'confirm-restore': await DB.restoreBackup(pendingBackup); await refresh(); closeModal(); render(); notify('备份已恢复到本机，等待 NAS 确认'); trySync(); break;
      case 'history': showModal('本机修订历史', record.history.slice().reverse().map(h => `<details class="history-row"><summary>${esc(h.label)} · ${new Date(h.at).toLocaleString('zh-CN')}</summary><pre>${esc(JSON.stringify(h, null, 2))}</pre></details>`).join('') || empty('暂无本机修订'), true); break;
      case 'migration': showMigration(); break;
      case 'migration-sample': { const state = D.seedState(); previewMigration({ format: 'fine-ledger-migration-demo', batchId: 'synthetic-migration-001', state }); break; }
      case 'migration-upload': { let input = $('#migration-file'); if (!input) { input = document.createElement('input'); input.type = 'file'; input.id = 'migration-file'; input.accept = '.json'; input.hidden = true; document.body.append(input); } input.click(); break; }
      case 'confirm-migration': {
        const mapping = $('#legacy-tag-choice').value, data = migrationPreview;
        if (S().legacy.some(l => l.id === data.batchId)) throw Error('此批次已导入');
        // Synthetic sample shares stable IDs with the seeded ledger: preserve existing entities.
        const changes = D.COLLECTIONS.flatMap(collection => data.state[collection].filter(r => !S()[collection].some(x => x.id === r.id)).map(entity => ({ collection, entity })));
        changes.push({ collection: 'legacy', entity: { id: data.batchId, type: '迁移批次', name: '合成迁移样例', raw: data, mapping, pending: mapping === 'project', note: '旧标签映射项目时需后续确认金额分配；不复制金额' } });
        if (await saveChanges(changes, '确认合成迁移预览')) { closeModal(); notify('合成批次已保留；相同身份不重复导入'); } break;
      }
      case 'iphone-check': await showIphoneCheck(); break;
      case 'iphone-report-sync': await trySync(true); await showIphoneCheck(); break;
      case 'iphone-sample-online': case 'iphone-sample-offline': {
        const evidence = await V.evidence();
        draft = defaultDraft(); draft.accountId = 'bank-cny'; draft.amount = action === 'iphone-sample-online' ? '12.34' : '56.78'; draft.description = `iPhone验证 ${evidence.runId.slice(0, 8)} · ${action === 'iphone-sample-online' ? '联网' : '离线'}`;
        closeModal(); await persistDraft(); navigate('record'); break;
      }
      case 'iphone-report-export': downloadJSON({ ...(await V.evidence()), pendingOperations: record.outbox.length, origin: location.origin }, `iphone-pwa-check-${D.today()}.json`); break;
      case 'install': if (deferredInstall) { await deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; } else showModal('安装 Fine Ledger', `<p>iPhone / iPad：用 Safari 打开稳定 HTTPS 地址，点「分享」→「添加到主屏幕」。</p><p>Mac / Windows：在支持安装的浏览器地址栏或菜单中选择「安装应用」。</p><div class="notice"><span>先联网打开一次，等待设置页显示「离线资源就绪」，再测试断网冷启动。手机访问电脑的 HTTP 局域网 IP 不具备完整 PWA 能力；请通过可信 HTTPS 反向代理访问。</span></div>`); break;
      case 'persist': { const granted = await navigator.storage?.persist?.(); notify(granted ? '浏览器已授予持久化存储' : '浏览器暂未授予；请安装到主屏幕并保留独立备份'); diagnostics(); break; }
      case 'retry-init': await boot(); break;
    }
  } catch (e) { notify(e.message); }
});
document.addEventListener('input', async event => {
  const el = event.target;
  if (el.closest('#entry-form')) {
    if (el.dataset.field) draft[el.dataset.field] = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.split !== undefined) draft.splits[Number(el.dataset.split)][el.dataset.prop] = el.value;
    if (el.dataset.refund !== undefined) draft.refunds[Number(el.dataset.refund)][el.dataset.prop] = el.value;
    try { await persistDraft(); } catch { notify('草稿保存失败，请先不要关闭页面并导出数据'); }
  }
  if (el.matches('[data-filter]') && el.type === 'search') {
    filter[el.dataset.filter] = el.value;
    const pos = el.selectionStart; render(); const next = $('[data-filter="search"]'); next?.focus(); next?.setSelectionRange(pos, pos);
  }
  if (el.matches('[data-target]')) {
    const form = el.closest('form'), source = S().sources.find(s => s.id === form.dataset.id);
    try { const plan = allocationPlan(form, source); $('#allocation-preview').innerHTML = `<span>${plan.map(p => `${esc(S().transactions.find(t => t.id === p.transactionId).description)}：${D.money(p.amount, source.currency)} ${source.currency} → ¥ ${D.money(p.cny)}`).join('<br>')}<br><strong>合计 ¥ ${D.money(D.sum(plan.map(p => p.cny)))}</strong></span>`; } catch (e) { $('#allocation-preview').textContent = e.message; }
  }
  if (el.classList.contains('session-search')) for (const row of document.querySelectorAll('.reconcile-row')) row.hidden = !row.dataset.description.includes(el.value.toLowerCase());
});
document.addEventListener('change', async event => {
  const el = event.target;
  try {
    if (el.matches('[data-filter]')) { filter[el.dataset.filter] = el.type === 'checkbox' ? el.checked : el.value; render(); }
    if (el.closest('#entry-form') && ['accountId', 'toAccountId', 'currency', 'state'].includes(el.dataset.field)) {
      if (el.dataset.field === 'accountId') { const a = D.account(S(), draft.accountId); draft.currency = a.currency; draft.accountAmount = ''; if (a.type !== 'credit') draft.state = 'posted'; }
      if (draft.type === 'transfer') draft.currency = D.account(S(), draft.accountId).currency;
      await persistDraft(); render();
    }
    if (el.id === 'backup-file') { const file = el.files[0]; if (file) { if (file.size > 8e6) throw Error('Demo 备份文件不能超过 8MB'); previewBackup(JSON.parse(await file.text())); } el.value = ''; }
    if (el.id === 'migration-file') { const file = el.files[0]; if (file) { if (file.size > 8e6) throw Error('文件过大'); previewMigration(JSON.parse(await file.text())); } el.value = ''; }
  } catch (e) { notify(e.message); }
});
document.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  if (form.id === 'entry-form') { await submitEntry(); return; }
  const data = Object.fromEntries(new FormData(form));
  try {
    switch (form.dataset.form) {
      case 'posting': {
        const t = S().transactions.find(t => t.id === form.dataset.id), p = t.postings[0], a = D.account(S(), p.accountId), amount = D.parseMoney(data.amount, a.currency);
        if (BigInt(amount) <= 0n) throw Error('实际入账金额须大于零');
        const next = { ...t, state: 'posted', postings: [{ ...p, amount: String(-BigInt(amount)), date: data.date }] };
        if (await saveChanges([{ collection: 'transactions', entity: next }], '确认银行实际入账')) { closeModal(); notify('原交易已确认入账，未新增重复消费'); } break;
      }
      case 'metadata': { const t = S().transactions.find(t => t.id === form.dataset.id); if (await saveChanges([{ collection: 'transactions', entity: { ...t, description: data.description, notes: data.notes } }], '修改退款说明')) { closeModal(); notify('已保存到本机'); } break; }
      case 'allocation': { const source = S().sources.find(s => s.id === form.dataset.id); if (!data.confirmed) throw Error('请确认消费集合与覆盖本金'); const plan = allocationPlan(form, source); if (await saveChanges([{ collection: 'sources', entity: { ...source, allocations: [...(source.allocations || []), ...plan], confirmedAt: new Date().toISOString() } }], '确认还款消费分配')) { showSourceAllocation(source.id); notify('成本已分配到原消费；还款不计为新支出'); } break; }
      case 'entity': {
        const { kind, id } = form.dataset, old = S()[kind].find(r => r.id === id), entity = { ...(old || {}), ...data, id: id || D.uid() };
        if (kind === 'accounts') { entity.netWorth = !!data.netWorth; entity.limit = data.limit ? D.parseMoney(data.limit, data.currency) : null; entity.sort = old?.sort ?? S().accounts.length; }
        if (kind === 'categories') entity.parentId = data.parentId || null;
        const changes = [{ collection: kind, entity }];
        if (kind === 'accounts' && !old && data.opening && BigInt(D.parseMoney(data.opening, data.currency, true))) { const amount = D.parseMoney(data.opening, data.currency, true); changes.push({ collection: 'transactions', entity: { id: D.uid(), type: 'adjustment', amount, currency: data.currency, date: D.today(), description: `${data.name} · 期初余额`, notes: '明确登记期初余额；历史外币成本待核定', state: 'posted', postings: [{ id: D.uid(), accountId: entity.id, amount, date: D.today() }], splits: [] } }); }
        if (await saveChanges(changes, old ? '修改账本设置' : '新增账本设置')) showManager(kind); break;
      }
      case 'new-session': {
        const a = D.account(S(), data.accountId), previous = S().sessions.filter(s => s.accountId === a.id && s.status === 'completed' && s.cutoff < data.cutoff).sort((a, b) => b.cutoff.localeCompare(a.cutoff))[0];
        if (S().sessions.some(s => !s.deleted && s.accountId === a.id && s.cutoff === data.cutoff)) throw Error('此截止日已有批次，请打开已有批次');
        const entity = { id: D.uid(), accountId: data.accountId, cutoff: data.cutoff, start: previous?.cutoff || null, previousId: previous?.id || null, external: D.parseMoney(data.external, a.currency, true), status: 'draft', checked: [] };
        if (await saveChanges([{ collection: 'sessions', entity }], '新建对账草稿')) openSession(entity.id); break;
      }
      case 'session': {
        const old = S().sessions.find(s => s.id === form.dataset.id), a = D.account(S(), old.accountId), checked = new FormData(form).getAll('checked');
        const entity = { ...old, status: 'draft', needsReview: false, external: D.parseMoney(data.external, a.currency, true), checked };
        const intent = event.submitter?.value;
        if (!(await saveChanges([{ collection: 'sessions', entity }], '保存对账草稿'))) break;
        if (intent !== 'complete') { openSession(entity.id); notify('对账草稿已保存到本机'); break; }
        if (!data.devicesChecked) { openSession(entity.id); throw Error('完成前请核实其他设备未上传记录，并勾选确认'); }
        await trySync(); await refresh();
        if (syncStatus !== 'online' || record.outbox.length || record.conflicts.length) { openSession(entity.id); throw Error('当前同步未成功、队列未清空或存在冲突；草稿已保留'); }
        const current = S().sessions.find(s => s.id === entity.id);
        const figures = D.sessionFigures(S(), current);
        if (figures.difference !== '0' || figures.rows.some(r => !checked.includes(r.posting.id))) { openSession(entity.id); throw Error('差额必须为零，且期间已入账流水全部核对后才能完成'); }
        const next = { ...current, status: 'completed', completedAt: new Date().toISOString(), checkedRevisions: figures.rows.map(r => ({ postingId: r.posting.id, transactionRevision: r.tx.revision })) };
        if (await saveChanges([{ collection: 'sessions', entity: next }], '完成账户对账')) { openSession(next.id); notify('对账已完成；完成标记正在同步'); } break;
      }
      case 'device': await DB.update(r => ({ ...r, deviceName: data.name.trim() })); await refresh(); closeModal(); render(); trySync(); break;
      case 'token': prefs.token = data.token; savePrefs(); closeModal(); if (!record) await boot(); else await trySync(true); break;
      case 'init-token': prefs.token = data.token; savePrefs(); await boot(); break;
    }
  } catch (e) { notify(e.message); }
});
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { const form = $('#modal').open ? $('#modal form') : $('#entry-form'); if (form) { event.preventDefault(); form.requestSubmit(); } }
  if (event.key.toLowerCase() === 'n' && !event.metaKey && !event.ctrlKey && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName) && !$('#modal').open) navigate('record');
});
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
window.addEventListener('online', () => trySync());
window.addEventListener('fine-ledger-storage-blocked',event=>notify(event.detail));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && record) { refresh().then(() => { if (route !== 'record') render(); trySync(); }); } });
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('fine-ledger') : null;
channel?.addEventListener('message', async () => { await refresh(); if (route !== 'record') render(); else renderStatus(); });
async function boot() {
  try {
    record = await DB.initialize({token:prefs.token});
    draft = await DB.read('draft') || defaultDraft();
    const hash = location.hash.slice(1); if (names[hash]) route = hash;
    render(); await V.beginBoot(prefs.offline).catch(() => {}); await registerSW(); trySync();
    if (route === 'settings') diagnostics();
  } catch (e) {
    $('#app').innerHTML = `<main class="init-screen card padded"><div class="brand-mark">F·</div><h1>打开你的本机账本</h1><p>首次使用需要连接同源 NAS 服务，初始化合成演示数据和离线资源。已有数据不会因初始化失败被清除。</p><div class="notice amber">${esc(e.message)}</div>${button('retry-init', '重新连接并初始化', 'primary')}<form data-form="init-token" class="spaced">${inputField('NAS 连接口令（服务开启认证时）', 'token', '', 'password')}<button class="btn">用口令初始化</button></form></main>`;
  }
}
async function registerSW() {
  if (!('serviceWorker' in navigator) || !isSecureContext) return;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    swReady = await V.offlineAssetsReady(); renderStatus();
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (route === 'settings') render(); });
    registration.addEventListener('updatefound', () => { const worker = registration.installing; worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) notify('新版本已准备，关闭其他页面后重开即可更新；草稿和待同步队列保留'); }); });
  } catch (e) { notify(`离线资源准备失败：${e.message}。联网功能可继续使用`); }
}
setInterval(() => { if (record && document.visibilityState === 'visible' && syncStatus !== 'checking') trySync(); }, 30000);
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) { const r = $('#modal').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeModal(); } });
$('#modal').addEventListener('cancel', () => cancelReopen?.());
$('#modal').addEventListener('close', () => cancelReopen?.());
boot();
