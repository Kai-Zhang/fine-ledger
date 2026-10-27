import { mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { renderWorker } from './build-preview.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'public/__update-test');
const prefix = '/__update-test/';
const page = version => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>更新回归测试</title><h1>${version === 'old' ? '旧版缓存页面' : '新版页面'}</h1><p id="state" role="status">正在读取测试数据</p><button id="prepare">建立旧版缓存与草稿</button><button id="end">结束测试</button><script src="${prefix}client.js"></script></html>`;
const client = `
const prefix = '${prefix}';
function database() { return new Promise((resolve,reject)=>{ const request=indexedDB.open('fine-ledger-update-regression',1); request.onupgradeneeded=()=>request.result.createObjectStore('proof'); request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error); }); }
async function proof(write=false) { const db=await database(); return new Promise((resolve,reject)=>{const tx=db.transaction('proof',write?'readwrite':'readonly');const store=tx.objectStore('proof');const request=write?store.put({entry:'synthetic-transaction',amountMinor:'1234',draft:'保留草稿'},'marker'):store.get('marker');tx.oncomplete=()=>{db.close();resolve(request.result);};tx.onabort=()=>reject(tx.error);}); }
async function show() { const value=await proof(); document.querySelector('#state').textContent=value?'交易 1 · 草稿：'+value.draft+' · 金额 '+value.amountMinor:'尚未准备测试数据'; }
async function registration() { const reg=await navigator.serviceWorker.register(prefix+'sw.js',{scope:prefix,updateViaCache:'none'}); await reg.update(); return reg; }
document.querySelector('#prepare').onclick=async()=>{await proof(true); const reg=await registration(); if(!reg.active||reg.active.state!=='activated')await new Promise(resolve=>{const worker=reg.installing||reg.waiting; if(!worker)return resolve();worker.addEventListener('statechange',()=>{if(worker.state==='activated')resolve();});}); await show();};
document.querySelector('#end').onclick=async()=>{const reg=await navigator.serviceWorker.getRegistration(prefix);if(reg?.scope.endsWith(prefix))await reg.unregister();document.querySelector('#state').textContent='测试已结束';};
show(); registration().catch(error=>document.querySelector('#state').textContent=error.message);
`;
if (process.argv[2] === 'prepare') {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'index.html'), page('old'));
  await writeFile(path.join(directory, 'client.js'), client);
  await writeFile(path.join(directory, 'sw.js'), `const CACHE='fine-ledger-update-test-old';self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['${prefix}index.html','${prefix}client.js'])).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(e.request.method==='GET')e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));});`);
  console.log('Legacy cache-first fixture prepared at ' + prefix);
} else if (process.argv[2] === 'upgrade') {
  await writeFile(path.join(directory, 'index.html'), page('new'));
  await writeFile(path.join(directory, 'release.html'), page('new'));
  await writeFile(path.join(directory, 'sw.js'), await renderWorker({ release: 'regression-new', root: prefix + 'index.html', shell: prefix + 'release.html', cachePrefix: 'fine-ledger-update-test-', assets: [prefix + 'release.html', prefix + 'client.js'] }));
  console.log('Replacement prepared at exactly the same fixture URL');
} else if (process.argv[2] === 'cleanup') {
  await rm(directory, { recursive: true, force: true });
  console.log('Temporary public fixture removed');
} else throw Error('Use prepare|upgrade|cleanup');
