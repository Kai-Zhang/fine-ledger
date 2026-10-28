import { createBook } from './seed.js';
import { validateEntry, balance, minor, setEntryDeleted } from './domain.js';
export const DB_NAME = 'fine-ledger-p0-review-v1';
export const DB_VERSION = 2;
let handle;
function db() {
  if (!handle) handle = new Promise((resolve, reject) => {
    let abandoned = false;
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const result = request.result;
      if (!result.objectStoreNames.contains('state')) result.createObjectStore('state');
      if (!result.objectStoreNames.contains('outbox')) result.createObjectStore('outbox', { keyPath: 'id' });
      if (!result.objectStoreNames.contains('drafts')) result.createObjectStore('drafts');
    };
    request.onsuccess = () => { const result = request.result; if (abandoned) { result.close(); return; } result.onversionchange = () => { result.close(); handle = null; }; resolve(result); };
    request.onerror = () => { handle = null; reject(request.error); };
    request.onblocked = () => { abandoned = true; handle = null; reject(Error('请关闭其他旧版厘序页面后重试')); };
  });
  return handle;
}
export async function loadBook() {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('state', 'readwrite'); const store = tx.objectStore('state'); let book;
    const request = store.get('book');
    request.onsuccess = () => { book = request.result || createBook(); if (!request.result) store.put(book, 'book'); };
    tx.oncomplete = () => resolve(book); tx.onabort = () => reject(tx.error || Error('读取账本失败'));
  });
}
export async function saveEntry(input) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['state', 'outbox', 'drafts'], 'readwrite'); let book, entry, failure;
    const request = tx.objectStore('state').get('book');
    request.onsuccess = () => {
      try {
        book = request.result; entry = { ...input, id: crypto.randomUUID(), revision: 1, createdAt: new Date().toISOString() };
        if (entry.kind === 'adjustment') entry.amountMinor = (BigInt(minor(entry.targetBalance, book.accounts.find(a => a.id === entry.accountId).currency, true)) - BigInt(balance(book, entry.accountId))).toString();
        delete entry.targetBalance;
        validateEntry(book, entry);
        book.entries.push(entry);
        tx.objectStore('state').put(book, 'book');
        tx.objectStore('outbox').put({ id: crypto.randomUUID(), kind: 'create-entry', schema: 1, entry, createdAt: entry.createdAt });
        if (['expense', 'income', 'transfer'].includes(entry.kind)) tx.objectStore('drafts').delete(entry.accountId);
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve({ book, entry });
    tx.onabort = () => reject(failure || tx.error || Error('保存失败，输入已保留，请重试'));
  });
}
export async function changeEntryDeleted(id, deleted) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['state', 'outbox'], 'readwrite'); let result, failure;
    const request = tx.objectStore('state').get('book');
    request.onsuccess = () => {
      try {
        const timestamp = new Date().toISOString();
        result = setEntryDeleted(request.result, id, deleted, timestamp);
        if (result.changed) {
          tx.objectStore('state').put(result.book, 'book');
          tx.objectStore('outbox').put({ id: crypto.randomUUID(), kind: deleted ? 'delete-entry' : 'restore-entry', schema: 1, entry: result.entry, createdAt: timestamp });
        }
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure || tx.error || Error('记录未能修改，请重试'));
  });
}
async function draftOperation(accountId, value, write) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('drafts', write ? 'readwrite' : 'readonly'); const store = tx.objectStore('drafts');
    const request = write ? (value === null ? store.delete(accountId) : store.put(value, accountId)) : store.get(accountId);
    tx.oncomplete = () => resolve(request.result); tx.onabort = () => reject(tx.error || Error('草稿保存失败'));
  });
}
export const readDraft = accountId => draftOperation(accountId, undefined, false);
export const writeDraft = (accountId, draft) => draftOperation(accountId, draft, true);
export async function exportBook() {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['state', 'outbox', 'drafts'], 'readonly'); const requests = [tx.objectStore('state').get('book'), tx.objectStore('outbox').getAll(), tx.objectStore('drafts').getAll(), tx.objectStore('drafts').getAllKeys()];
    tx.oncomplete = () => resolve({ schema: 1, exportedAt: new Date().toISOString(), prototype: true, book: requests[0].result, outbox: requests[1].result, drafts: requests[2].result.map((value, i) => ({ accountId: requests[3].result[i], value })) });
    tx.onabort = () => reject(tx.error || Error('导出失败'));
  });
}
