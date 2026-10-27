import * as DB from './storage.js';
let bootId;
export const requiredAssets = ['/', '/index.html', '/style.css', '/app.js', '/domain.js', '/storage.js', '/validation.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];
export const standalone = () => !!(matchMedia('(display-mode: standalone)').matches || navigator.standalone);
const defaults = () => ({ schemaVersion: 1, runId: crypto.randomUUID(), boots: [], saves: [] });
export async function beginBoot(simulation) {
  bootId = crypto.randomUUID();
  return DB.update(previous => {
    const evidence = previous || defaults();
    evidence.boots = [...evidence.boots, { id: bootId, at: new Date().toISOString(), readyMs: Math.round(performance.now()), secureContext: isSecureContext, standalone: standalone(), simulation: !!simulation, firstApiResult: 'pending' }].slice(-10);
    return evidence;
  }, 'pwa-validation');
}
export async function markSync(result, simulation = false) {
  return DB.update(previous => {
    const evidence = previous || defaults(), boot = evidence.boots.find(b => b.id === bootId);
    if (boot && boot.firstApiResult === 'pending') boot.firstApiResult = simulation ? 'simulation' : result;
    evidence.lastApiResult = result; evidence.lastApiAt = new Date().toISOString();
    return evidence;
  }, 'pwa-validation');
}
export async function markSave(transaction, { syncStatus, simulation, elapsed }) {
  if (!transaction.description?.startsWith('iPhone验证 ')) return;
  await DB.update(previous => {
    const evidence = previous || defaults();
    evidence.saves = [...evidence.saves.filter(s => s.transactionId !== transaction.id), { transactionId: transaction.id, at: new Date().toISOString(), bootId, syncStatus, simulation: !!simulation, localCommitMs: Math.round(elapsed), standalone: standalone() }].slice(-20);
    return evidence;
  }, 'pwa-validation');
}
export async function evidence() { return await DB.read('pwa-validation') || defaults(); }
export async function offlineAssetsReady() {
  if (!('caches' in window)) return false;
  for (const name of (await caches.keys()).filter(n => n.startsWith('fine-ledger-shell-'))) {
    const cache = await caches.open(name);
    if ((await Promise.all(requiredAssets.map(path => cache.match(path)))).every(Boolean)) return true;
  }
  return false;
}
