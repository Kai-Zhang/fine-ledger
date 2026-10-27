import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { openLedger, canonical, atomicJSON } from './lib/recovery.mjs';
import { COLLECTIONS, validateState, validateEntity, affectedSessions } from './public/domain.js';
const root = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.LEDGER_DB || resolve(root, 'data/nas.sqlite');
await mkdir(dirname(dbPath), { recursive: true });
const laboratory = process.env.LEDGER_RELIABILITY_TEST === '1';
if (laboratory && !dbPath.includes('reliability')) throw Error('故障注入仅允许 reliability 独立账本');
const store = openLedger(dbPath, process.env.LEDGER_RECOVERY_DIR);
const db = store.db;
let armedFault = '';
function fault(point) {
  if (!laboratory || armedFault !== point) return;
  armedFault = '';
  if(point === 'journal-write') throw Error('测试：恢复日志写入失败（ENOSPC）');
  if(point === 'response-lost') return true;
  process.kill(process.pid, 'SIGKILL');
}
const getState = () => JSON.parse(db.prepare('SELECT payload FROM ledger WHERE id=1').get().payload);
const cursor = () => db.prepare('SELECT COALESCE(MAX(cursor),0) AS c FROM changes').get().c;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
function auth(req) {
  if (!process.env.LEDGER_TOKEN) return true;
  const supplied = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${process.env.LEDGER_TOKEN}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
async function body(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 8e6) throw Error('请求过大'); }
  return JSON.parse(text);
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (url.pathname.startsWith('/api/')) {
      if (!auth(req)) return json(res, 401, { error: '需要 NAS 连接口令' });
      if (req.method === 'GET' && url.pathname === '/api/snapshot') return json(res, 200, { state: getState(), cursor: cursor(), ...store.status(), laboratory });
      if (req.method === 'GET' && url.pathname === '/api/verification') {
        const state = getState();
        const reports = db.prepare('SELECT * FROM pwa_verifications ORDER BY last_seen DESC').all().map(row => {
          const clientEvidence = JSON.parse(row.payload);
          const sampleIds = new Set((clientEvidence.saves || []).map(s => s.transactionId));
          return { deviceId: row.device_id, lastSeen: row.last_seen, clientEvidence, serverConfirmed: state.transactions.filter(t => !t.deleted && sampleIds.has(t.id) && t.description.startsWith('iPhone验证 ')).map(t => ({ id: t.id, description: t.description, amount: t.amount, currency: t.currency, revision: t.revision })) };
        });
        return json(res, 200, { devices: db.prepare('SELECT * FROM devices ORDER BY last_seen DESC').all(), reports });
      }
      if (laboratory && url.pathname === '/api/reliability/evidence') {
        const file=resolve(store.directory,'browser-evidence.json');
        if(req.method === 'GET') return json(res,200,await readFile(file,'utf8').then(JSON.parse,()=>({})));
        if(req.method === 'POST') {
          if(req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res,403,{error:'仅支持同源请求'});
          const evidence=await body(req);atomicJSON(file,{...evidence,serverReceivedAt:new Date().toISOString()});return json(res,200,{saved:true});
        }
      }
      if (laboratory && url.pathname === '/api/reliability/fault' && req.method === 'POST') {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res,403,{error:'仅支持同源请求'});
        const input = await body(req);
        if (!['','before-transaction','journal-write','journal-durable','database-committed','response-lost','database-readonly'].includes(input.point)) return json(res,400,{error:'未知测试故障'});
        db.exec(input.point === 'database-readonly' ? 'PRAGMA query_only=ON' : 'PRAGMA query_only=OFF');
        armedFault=input.point; return json(res,200,{armed:armedFault});
      }
      if (req.method !== 'POST' || url.pathname !== '/api/sync') return json(res, 404, { error: '未知接口' });
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res, 403, { error: '仅支持同源请求' });
      const input = await body(req);
      if (!Array.isArray(input.operations) || input.operations.length > 2000 || typeof input.deviceId !== 'string') return json(res, 400, { error: '同步请求无效' });
      if ((input.bookId && input.bookId !== store.status().bookId) || input.cursor > cursor() || !store.verifyCheckpoint(input)) return json(res,409,{error:'服务端恢复链或游标回退，本机数据和队列已保留；请恢复服务端完整日志后重试'});
      fault('before-transaction');
      const acknowledged = [], conflicts = [], acceptedRows = [];
      let decided = false;
      db.exec('BEGIN IMMEDIATE');
      try {
        let state = getState();
        db.prepare('INSERT OR REPLACE INTO devices VALUES(?,?,?)').run(input.deviceId, String(input.deviceName || '浏览器设备').slice(0, 80), new Date().toISOString());
        for (const op of input.operations) {
          if (typeof op.id !== 'string' || !Array.isArray(op.changes) || !op.changes.length) throw Error('操作结构无效');
          const prior = db.prepare('SELECT payload FROM operations WHERE id=?').get(op.id);
          if (prior) {
            if(canonical(JSON.parse(prior.payload)) !== canonical(op)) throw Error('同一操作 ID 的内容不同，拒绝重试');
            acknowledged.push(op.id); continue;
          }
          const next = structuredClone(state);
          db.exec('SAVEPOINT aggregate_op');
          try {
            for (const c of op.changes) {
              if (!COLLECTIONS.includes(c.collection)) throw Error('未知业务集合');
              const before = state[c.collection].find(r => r.id === c.entity.id);
              if ((before?.revision || 0) !== c.baseRevision) throw Error('同一对象已在其他设备修改');
              if (c.entity.revision !== c.baseRevision + 1) throw Error('修订版本无效');
              const i = next[c.collection].findIndex(r => r.id === c.entity.id);
              if (i < 0) next[c.collection].push(c.entity); else next[c.collection][i] = c.entity;
            }
            for (const c of op.changes) {
              const before = state[c.collection].find(r => r.id === c.entity.id);
              if (!op.restore) validateEntity(next, c.collection, c.entity, before);
              if (c.collection === 'transactions') for (const session of affectedSessions(state, before, c.entity)) {
                if (next.sessions.find(s => s.id === session.id)?.status === 'completed') throw Error('余额修改需显式重新打开已完成批次');
              }
            }
            validateState(next);
            for (const c of op.changes) db.prepare('INSERT INTO changes(payload) VALUES(?)').run(JSON.stringify(c));
            const receivedAt = new Date().toISOString();
            db.prepare('INSERT INTO revisions(payload,created_at) VALUES(?,?)').run(JSON.stringify({ operation: op, previous: state }), receivedAt);
            db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run(op.id, JSON.stringify(op), input.deviceId, receivedAt);
            acceptedRows.push({id:op.id,payload:JSON.stringify(op),device:input.deviceId,created_at:receivedAt});
            db.exec('RELEASE aggregate_op');
            state = next; acknowledged.push(op.id);
          } catch (e) {
            db.exec('ROLLBACK TO aggregate_op'); db.exec('RELEASE aggregate_op');
            conflicts.push({ id: op.id, changes: op.changes, reason: e.message, remote: op.changes.map(c => ({ collection: c.collection, entity: state[c.collection]?.find(r => r.id === c.entity.id) || null })), at: new Date().toISOString() });
          }
        }
        db.prepare('UPDATE ledger SET payload=? WHERE id=1').run(JSON.stringify(state));
        if (input.verification && typeof input.verification === 'object' && input.verification.schemaVersion === 1) {
          const evidence = JSON.stringify(input.verification);
          if (Buffer.byteLength(evidence) <= 20000) db.prepare('INSERT OR REPLACE INTO pwa_verifications VALUES(?,?,?)').run(input.deviceId, evidence, new Date().toISOString());
        }
        const changes = db.prepare('SELECT payload FROM changes WHERE cursor>? ORDER BY cursor').all(Number.isSafeInteger(input.cursor) && input.cursor >= 0 ? input.cursor : 0).map(r => JSON.parse(r.payload));
        store.commitDecision(acceptedRows, state, cursor(), fault); decided = acceptedRows.length > 0;
        const result = { acknowledged, conflicts, changes, state, cursor: cursor(), ...store.status(), devices: db.prepare('SELECT * FROM devices ORDER BY last_seen DESC').all() };
        db.exec('COMMIT');
        fault('database-committed');
        if(fault('response-lost')) {res.destroy();return;}
        return json(res, 200, result);
      } catch (e) {
        try {db.exec('ROLLBACK');} catch {}
        // Once a recovery decision is durable, only startup replay may resume writes.
        if(decided || store.uncertain) {console.error('恢复决定已持久化，停止服务以便重放');process.exit(1);}
        throw e;
      }
    }
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
    if (!laboratory && /^\/reliability[./-]/.test(url.pathname)) return json(res,404,{error:'仅独立可靠性环境提供此页面'});
    const path = resolve(root, 'public', '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(resolve(root, 'public') + '/')) return json(res, 403, { error: 'Forbidden' });
    const content = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...(path.endsWith('/sw.js') ? { 'Service-Worker-Allowed': '/' } : {}) });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (e) { json(res, e.code === 'ENOENT' ? 404 : 400, { error: e.code === 'ENOENT' ? 'Not found' : e.message }); }
});
const port = Number(process.env.PORT || 4173), host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => console.log(`Fine Ledger demo: http://${host}:${server.address().port}\nSQLite: ${dbPath}\n${process.env.LEDGER_TOKEN ? 'NAS token enabled' : 'Local demo: authentication disabled; use a trusted local network only.'}`));
process.on('SIGTERM', () => server.close(() => { db.close(); process.exit(0); }));
