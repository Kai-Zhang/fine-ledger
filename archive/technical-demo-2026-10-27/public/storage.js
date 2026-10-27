import { COLLECTIONS, seedState, uid, validateEntity, validateState, affectedSessions } from './domain.js';
let DB_NAME = 'fine-ledger-demo-v1';
let testFault = () => {};
let testConfigured = false;
export function configureReliability({ name, fault = () => {} }) {
  if (globalThis.location?.pathname !== '/reliability.html' || !name.startsWith('fine-ledger-reliability-')) throw Error('仅独立可靠性页面可配置测试数据库');
  if(database || opening || clearing) throw Error('请先关闭数据库');
  DB_NAME = name; testFault = fault; testConfigured = true;
}
let database, opening, clearing, connectionVersion = 0;
export function closeDB() { connectionVersion++; database?.close(); database = null; }
export async function clearReliabilityDB({onBlocked = () => {}} = {}) {
  if(!testConfigured) throw Error('禁止清空普通账本');
  if(clearing) return clearing;
  // Finish in-flight opens before closing, so no connection escapes the cache.
  const pendingOpen=opening;
  const task=(async()=>{
    if(pendingOpen) await pendingOpen.catch(()=>{});
    closeDB();
    await new Promise((resolve,reject)=>{
      const req=indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess=resolve;req.onerror=()=>reject(req.error);
      // `blocked` is progress, not failure: the request still exists and cannot
      // be cancelled. Rejecting here lets it delete a newly reopened DB later.
      req.onblocked=()=>onBlocked('正在等待其他实验室页面关闭数据库。请关闭 Safari 中的实验室标签，只保留当前「厘序 P0」，清空会自动继续。');
    });
  })();
  clearing=task;
  try {await task;} finally {if(clearing===task)clearing=null;}
}
export async function openDB() {
  if(clearing) throw Error('实验室清空尚未完成，请关闭其他实验室页面后等待');
  if(database) return database;
  if(opening) return opening;
  const version=connectionVersion;
  const task=new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>req.result.createObjectStore('kv');
    req.onsuccess=()=>{
      const connection=req.result;
      if(version!==connectionVersion){connection.close();reject(Error('本机连接已关闭，请重试'));return;}
      // Bind the handler to this exact handle, never to a mutable global.
      connection.onversionchange=()=>{connection.close();if(database===connection)database=null;};
      database=connection;resolve(connection);
    };
    req.onerror=()=>reject(req.error);
    req.onblocked=()=>globalThis.dispatchEvent?.(new CustomEvent('fine-ledger-storage-blocked',{detail:'数据库操作正在等待其他页面关闭，请关闭其他账本标签后重试'}));
  });
  opening=task;
  try{return await task;}finally{if(opening===task)opening=null;}
}
export async function read(key = 'ledger') {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly'), req = tx.objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
export async function update(fn, key = 'ledger') {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite', {durability:'strict'}), store = tx.objectStore('kv'), req = store.get(key);
    let result, failure;
    req.onsuccess = () => {
      try { result = fn(req.result); store.put(result, key); if(key==='ledger') testFault('local-before-commit'); }
      catch (e) { failure = e; tx.abort(); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(failure || tx.error || Error('本地数据库写入失败，输入已保留'));
    tx.onabort = () => reject(failure || tx.error || Error('本地事务未提交'));
  });
}
export async function initialize({ token = '' } = {}) {
  let record = await read();
  if (record) return record;
  const response = await fetch('/api/snapshot', { headers: token ? {Authorization:`Bearer ${token}`} : {}, cache: 'no-store', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw Error('首次初始化需要连接服务，请启动本地服务后重试');
  const remote = await response.json();
  validateState(remote.state);
  record = await update(existing => existing || ({ bookId: remote.bookId, protection: {journalSequence:remote.journalSequence,journalHead:remote.journalHead, offMachineBackup:remote.offMachineBackup}, state: remote.state, outbox: [], conflicts: [], cursor: remote.cursor, lastSync: new Date().toISOString(), deviceId: uid(), deviceName: /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'iPhone / iPad 测试设备' : '浏览器设备', history: [], saveTimes: [] }));
  return record;
}
export async function commit(changes, label, { reopen = false } = {}) {
  const start = performance.now();
  const result = await update(record => {
    const state = structuredClone(record.state), normalized = [], history = [];
    for (const { collection, entity } of changes) {
      const old = state[collection]?.find(r => r.id === entity.id), row = structuredClone(entity);
      if (record.conflicts.some(c => c.changes.some(x => x.collection === collection && x.entity.id === row.id))) throw Error('请先在设置中解决此对象的同步冲突');
      if (collection === 'transactions') {
        const affected = affectedSessions(state, old, row);
        if (affected.length && !reopen) throw Object.assign(Error('此修改影响已完成对账，需要重新打开相关批次及后续批次'), { code: 'REOPEN' });
        for (const s of affected) {
          if (!normalized.some(c => c.collection === 'sessions' && c.entity.id === s.id)) {
            const next = { ...s, status: 'reopened', revision: s.revision + 1, updatedAt: new Date().toISOString(), reason: label };
            normalized.push({ collection: 'sessions', entity: next, baseRevision: s.revision });
            state.sessions[state.sessions.findIndex(x => x.id === s.id)] = next;
            history.push({ collection: 'sessions', before: s, after: next });
          }
        }
      }
      validateEntity(state, collection, row, old);
      row.revision = (old?.revision || 0) + 1; row.updatedAt = new Date().toISOString();
      const index = state[collection].findIndex(r => r.id === row.id);
      if (index < 0) state[collection].push(row); else state[collection][index] = row;
      normalized.push({ collection, entity: row, baseRevision: old?.revision || 0 });
      history.push({ collection, before: old || null, after: row });
    }
    validateState(state);
    const operation = { id: uid(), deviceId: record.deviceId, changes: normalized, label, createdAt: new Date().toISOString() };
    return { ...record, state, outbox: [...record.outbox, operation], history: [...record.history, { id: operation.id, label, at: operation.createdAt, changes: history }].slice(-500) };
  });
  testFault('local-after-commit');
  const elapsed = performance.now() - start;
  // Metrics cannot turn an already committed business save into a failure.
  await update(record => { testFault('metrics-write'); return {...record, saveTimes:[...(record.saveTimes||[]),elapsed].slice(-100)}; }).catch(() => {});
  return { record: result, elapsed };
}
let activeSync = null;
export async function synchronize(options = {}) {
  // Completion of reconciliation awaits a real sync, including newly queued operations.
  while (activeSync) { try { await activeSync; } catch { /* retry with this caller's options */ } }
  const task = performSync(options);
  activeSync = task;
  try { return await task; } finally { if (activeSync === task) activeSync = null; }
}
async function performSync({ simulateOffline = false, token = '' } = {}) {
  if (simulateOffline) throw Error('离线演练已开启，操作继续保存在本机');
  {
    const before = await read();
    const verification = await read('pwa-validation');
    const blocked = new Set(before.conflicts.map(c => c.id));
    const response = await fetch('/api/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ deviceId: before.deviceId, deviceName: before.deviceName, cursor: before.cursor, bookId:before.bookId, journalSequence:before.protection?.journalSequence,journalHead:before.protection?.journalHead, operations: before.outbox.filter(o => !blocked.has(o.id)), verification }),
      signal: AbortSignal.timeout(8000), cache: 'no-store'
    });
    if (response.status === 409) throw Error((await response.json()).error);
    if (!response.ok) throw Error(response.status === 401 ? 'NAS 认证已过期；本机记账可继续，请更新连接口令' : 'NAS 暂不可达，稍后自动重试');
    const remote = await response.json();
    if ((before.bookId && remote.bookId !== before.bookId) || remote.cursor < before.cursor) throw Error('服务端恢复链或游标回退，本机数据已保留');
    validateState(remote.state);
    testFault('sync-before-apply');
    const result = await update(current => {
      const ack = new Set(remote.acknowledged), outbox = current.outbox.filter(o => !ack.has(o.id));
      const mergedConflicts = [...current.conflicts.filter(c => !ack.has(c.id)), ...remote.conflicts.filter(c => !current.conflicts.some(x => x.id === c.id))];
      const dirty = new Set(outbox.flatMap(o => o.changes.map(c => `${c.collection}/${c.entity.id}`)));
      const state = structuredClone(current.state);
      for (const change of remote.changes) {
        if (dirty.has(`${change.collection}/${change.entity.id}`)) continue;
        const i = state[change.collection].findIndex(r => r.id === change.entity.id);
        if (i < 0) state[change.collection].push(change.entity); else state[change.collection][i] = change.entity;
      }
      // Late postings must never silently preserve a completed reconciliation conclusion.
      for (const change of remote.changes.filter(c => c.collection === 'transactions')) {
        const old = current.state.transactions.find(t => t.id === change.entity.id);
        for (const s of affectedSessions(current.state, old, change.entity)) {
          const local = state.sessions.find(x => x.id === s.id);
          if (local?.status === 'completed') local.needsReview = true;
        }
      }
      return { ...current, bookId: remote.bookId, protection:{journalSequence:remote.journalSequence,journalHead:remote.journalHead,offMachineBackup:remote.offMachineBackup}, state, outbox, conflicts: mergedConflicts, cursor: remote.cursor, lastSync: new Date().toISOString(), devices: remote.devices, remoteSnapshot: remote.state };
    });
    testFault('sync-after-apply');
    return result;
  }
}
export async function resolveConflict(id, choice) {
  await update(record => {
    const conflict = record.conflicts.find(c => c.id === id);
    if (!conflict) throw Error('冲突已处理');
    const keys = new Set(conflict.changes.map(c => `${c.collection}/${c.entity.id}`));
    // Drop dependent local versions of the same aggregate; never replay stale base revisions.
    const removed = record.outbox.filter(o => o.changes.some(c => keys.has(`${c.collection}/${c.entity.id}`)));
    for (const o of removed) for (const c of o.changes) keys.add(`${c.collection}/${c.entity.id}`);
    const state = structuredClone(record.state), localRows = [];
    for (const key of keys) {
      const [collection, entityId] = key.split('/');
      const local = state[collection].find(x => x.id === entityId);
      const remote = record.remoteSnapshot[collection].find(x => x.id === entityId);
      state[collection] = state[collection].filter(x => x.id !== entityId);
      if (remote) state[collection].push(structuredClone(remote));
      if (local) localRows.push({ collection, entity: local, baseRevision: remote?.revision || 0 });
    }
    const outbox = record.outbox.filter(o => !removed.some(r => r.id === o.id));
    if (choice === 'local') {
      for (const change of localRows) {
        const before = state[change.collection].find(x => x.id === change.entity.id);
        change.entity.revision = change.baseRevision + 1;
        validateEntity(state, change.collection, change.entity, before);
        state[change.collection] = [...state[change.collection].filter(x => x.id !== change.entity.id), change.entity];
      }
      outbox.push({ id: uid(), deviceId: record.deviceId, changes: localRows, label: '显式保留本机版本', createdAt: new Date().toISOString() });
    }
    validateState(state);
    return { ...record, state, outbox, conflicts: record.conflicts.filter(c => !removed.some(o => o.id === c.id)), history: [...record.history, { id: uid(), at: new Date().toISOString(), label: `解决冲突：${choice === 'local' ? '本机' : 'NAS'}版本`, changes: [], preserved: { conflict, localRows } }] };
  });
}
export async function restoreBackup(backup) {
  if (backup.format !== 'fine-ledger-backup' || backup.version !== 1) throw Error('不是支持的 Fine Ledger v1 备份');
  validateState(backup.state);
  await update(record => {
    const txCount = record.state.transactions.length;
    if (record.outbox.length || record.conflicts.length) throw Error('恢复前请先同步并解决冲突，防止丢失本机操作');
    // Import missing aggregates only. An old snapshot must never delete newer rows.
    const changes = [];
    for (const collection of COLLECTIONS) for (const row of backup.state[collection]) {
      const old = record.state[collection].find(r => r.id === row.id);
      if(old) {
        const content = r => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !['revision','updatedAt'].includes(k)).sort(([a],[b]) => a.localeCompare(b))));
        if(content(old)!==content(row)) throw Error('备份与现有账目不同；为保护较新数据，请在独立账本中执行快照加日志恢复');
      } else changes.push({collection,entity:{...row,revision:1},baseRevision:0});
    }
    if(!changes.length) return record;
    for(const c of changes.filter(c=>c.collection==='transactions')) if(affectedSessions(record.state,null,c.entity).length) throw Error('补入记录影响已完成对账，请先显式重新打开相关批次，或在独立账本中恢复');
    const state = structuredClone(record.state);
    for (const c of changes) state[c.collection] = [...state[c.collection].filter(x => x.id !== c.entity.id), c.entity];
    for (const c of changes.filter(c=>c.collection==='sessions')) if(c.entity.status==='completed') {c.entity.status='reopened';c.entity.reason='备份补入后重新核验';}
    for (const c of changes.filter(c => c.collection === 'sessions')) c.entity = state.sessions.find(s => s.id === c.entity.id);
    validateState(state);
    return { ...record, state, outbox: [{ id: uid(), deviceId: record.deviceId, changes, label: '从备份恢复', restore: true }], history: [...record.history, { id: uid(), at: new Date().toISOString(), label: `从备份恢复（原 ${txCount} 笔）`, changes: [], preserved: record.state }] };
  });
}
