// A durable, hash-chained recovery decision log, separate from the live SQLite DB.
// Files must live on a local filesystem. A second directory is NOT an off-machine backup.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync, renameSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { seedState, validateState } from '../public/domain.js';
export const canonical = x => JSON.stringify(sort(x));
function sort(x) { return Array.isArray(x) ? x.map(sort) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sort(x[k])])) : x; }
export const digest = x => createHash('sha256').update(canonical(x)).digest('hex');
const schema = `PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS ledger(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,payload TEXT NOT NULL,device TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS changes(cursor INTEGER PRIMARY KEY AUTOINCREMENT,payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY AUTOINCREMENT,payload TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,name TEXT,last_seen TEXT);
CREATE TABLE IF NOT EXISTS pwa_verifications(device_id TEXT PRIMARY KEY,payload TEXT NOT NULL,last_seen TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recovery_meta(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL);`;
export function atomicJSON(path, value) {
  mkdirSync(dirname(path), {recursive:true, mode:0o700});
  const temp = path + '.' + randomUUID() + '.tmp';
  writeFileSync(temp, JSON.stringify(value), {mode:0o600, flag:'wx'});
  const fd = openSync(temp, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path);
  const dir = openSync(dirname(path), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
}
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
const stateOf = db => JSON.parse(db.prepare('SELECT payload FROM ledger WHERE id=1').get().payload);
const metaOf = db => { const row = db.prepare('SELECT payload FROM recovery_meta WHERE id=1').get(); return row && JSON.parse(row.payload); };
const putMeta = (db, m) => db.prepare('INSERT OR REPLACE INTO recovery_meta VALUES(1,?)').run(JSON.stringify(m));
function imageOf(db) {
  return {state:stateOf(db), operations:db.prepare('SELECT * FROM operations ORDER BY rowid').all(), changes:db.prepare('SELECT * FROM changes ORDER BY cursor').all(), revisions:db.prepare('SELECT * FROM revisions ORDER BY id').all()};
}
function installImage(db, image) {
  validateState(image.state);
  db.prepare('INSERT OR REPLACE INTO ledger VALUES(1,?)').run(JSON.stringify(image.state));
  for (const table of ['operations','changes','revisions']) db.exec(`DELETE FROM ${table}`);
  for (const r of image.operations) db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run(r.id,r.payload,r.device,r.created_at);
  for (const r of image.changes) db.prepare('INSERT INTO changes(cursor,payload) VALUES(?,?)').run(r.cursor,r.payload);
  for (const r of image.revisions) db.prepare('INSERT INTO revisions(id,payload,created_at) VALUES(?,?,?)').run(r.id,r.payload,r.created_at);
}
function verifyEnvelope(value) { const {hash,...body}=value; if (digest(body)!==hash) throw Error('恢复文件校验失败'); return body; }
function envelope(body) { return {...body,hash:digest(body)}; }
export function loadArchive(directory, snapshotPath) {
  const root=readJSON(join(directory,'genesis.json')); verifyEnvelope(root);
  let image=structuredClone(root.image), seq=0, hash=root.hash;
  const entries=[];
  for (const name of readdirSync(directory).filter(n=>/^\d{12}\.json$/.test(n)).sort()) {
    const e=readJSON(join(directory,name)); verifyEnvelope(e);
    if (e.seq!==seq+1 || e.previousHash!==hash || e.bookId!==root.bookId || Number(name.slice(0,12))!==e.seq) throw Error('增量日志缺段或链不一致');
    entries.push(e); seq=e.seq; hash=e.hash;
  }
  let start=0;
  if (snapshotPath) {
    const snap=readJSON(snapshotPath); verifyEnvelope(snap);
    if(snap.format==='fine-ledger-recovery-v1') {
      // The original immutable genesis is also an old, complete baseline snapshot.
      if(snap.bookId!==root.bookId || snap.hash!==root.hash)throw Error('基线快照与日志不属于同一条恢复链');
      image=snap.image;start=0;
    } else {
      if(snap.format!=='fine-ledger-snapshot-v1' || !Number.isSafeInteger(snap.seq) || snap.seq<0 || snap.bookId!==root.bookId || snap.seq>entries.length || snap.headHash!==(snap.seq ? entries[snap.seq-1].hash : root.hash)) throw Error('快照与日志不属于同一条恢复链');
      image=snap.image;start=snap.seq;
    }
    if (digest(image.state)!==(start ? entries[start-1].stateHash : digest(root.image.state))) throw Error('快照状态不匹配');
  }
  for (const entry of entries.slice(start)) replayImage(image,entry);
  validateState(image.state);
  return {bookId:root.bookId,seq,hash,image,entries,root};
}
function replayImage(image, entry) {
  for (const r of entry.operations) {
    if (image.operations.some(x=>x.id===r.id)) throw Error('恢复日志包含重复操作');
    const op=JSON.parse(r.payload), previous=structuredClone(image.state);
    for (const c of op.changes) {
      const rows=image.state[c.collection], i=rows.findIndex(x=>x.id===c.entity.id);
      if ((rows[i]?.revision||0)!==c.baseRevision || c.entity.revision!==c.baseRevision+1) throw Error('恢复日志版本不连续');
      if(i<0) rows.push(c.entity); else rows[i]=c.entity;
      image.changes.push({cursor:(image.changes.at(-1)?.cursor||0)+1,payload:JSON.stringify(c)});
    }
    image.operations.push(r);
    image.revisions.push({id:(image.revisions.at(-1)?.id||0)+1,payload:JSON.stringify({operation:op,previous}),created_at:r.created_at});
  }
  if(digest(image.state)!==entry.stateHash || (image.changes.at(-1)?.cursor||0)!==entry.cursor) throw Error('重放结果与日志校验不一致');
}
export function openLedger(dbPath, directory= dbPath+'.recovery') {
  dbPath=resolve(dbPath); directory=resolve(directory);
  mkdirSync(dirname(dbPath),{recursive:true}); mkdirSync(directory,{recursive:true,mode:0o700});
  const existed=existsSync(dbPath), genesis=join(directory,'genesis.json');
  const db=new DatabaseSync(dbPath); db.exec(schema);
  try {
    let meta=metaOf(db);
    if (!existsSync(genesis)) {
      if(meta) throw Error('增量恢复目录缺失，拒绝用现有数据库静默重建日志');
      if(!db.prepare('SELECT id FROM ledger WHERE id=1').get()) {
        if(existed || readdirSync(directory).length) throw Error('账本缺失或恢复目录不完整，拒绝初始化新账本');
        db.prepare('INSERT INTO ledger VALUES(1,?)').run(JSON.stringify(seedState()));
      }
      const root=envelope({format:'fine-ledger-recovery-v1',bookId:randomUUID(),image:imageOf(db)});
      atomicJSON(genesis,root);
    }
    const archive=loadArchive(directory);
    if(meta && (meta.bookId!==archive.bookId || meta.seq>archive.seq || meta.hash!==(meta.seq ? archive.entries[meta.seq-1]?.hash : archive.root.hash))) throw Error('数据库与恢复日志分叉，拒绝覆盖');
    // Compare same-head content too: an unlogged or corrupt DB must not be accepted.
    if(meta?.seq===archive.seq && digest(imageOf(db))!==digest(archive.image)) throw Error('数据库内容与恢复链不一致');
    if(!meta || meta.seq<archive.seq || !db.prepare('SELECT id FROM ledger WHERE id=1').get()) {
      db.exec('BEGIN IMMEDIATE'); try { installImage(db,archive.image); putMeta(db,{bookId:archive.bookId,seq:archive.seq,hash:archive.hash}); db.exec('COMMIT'); } catch(e) {db.exec('ROLLBACK'); throw e;}
    }
    return {db,directory,uncertain:false,verifyCheckpoint(input) {
      const meta=metaOf(db);
      if(input.journalSequence===undefined) return true;
      if(!Number.isSafeInteger(input.journalSequence) || input.journalSequence<0 || input.journalSequence>meta.seq) return false;
      const entry=readJSON(join(directory,input.journalSequence ? String(input.journalSequence).padStart(12,'0')+'.json' : 'genesis.json'));
      return !input.journalHead || input.journalHead===entry.hash;
    },commitDecision(operations,state,cursor, fault=()=>{}) {
      const before=metaOf(db);
      if(!operations.length) return before;
      const entry=envelope({seq:before.seq+1,bookId:before.bookId,previousHash:before.hash,at:new Date().toISOString(),operations,stateHash:digest(state),cursor});
      fault('journal-write');
      this.uncertain=true;
      atomicJSON(join(directory,String(entry.seq).padStart(12,'0')+'.json'),entry);
      fault('journal-durable');
      const next={bookId:entry.bookId,seq:entry.seq,hash:entry.hash}; putMeta(db,next); this.uncertain=false; return next;
    },status() {const m=metaOf(db);return {bookId:m.bookId,journalSequence:m.seq,journalHead:m.hash,journal:'fsynced-local-directory',offMachineBackup:false};}};
  } catch(e) {db.close();throw e;}
}
export function createSnapshot(directory, destination) {
  const a=loadArchive(directory);
  const snap=envelope({format:'fine-ledger-snapshot-v1',bookId:a.bookId,seq:a.seq,headHash:a.hash,createdAt:new Date().toISOString(),image:a.image});
  atomicJSON(destination,snap); return {bookId:a.bookId,seq:a.seq,stateHash:digest(a.image.state)};
}
export function restoreArchive(directory,snapshotPath,targetDB) {
  if(existsSync(targetDB)) throw Error('恢复目标必须是不存在的新数据库');
  const a=loadArchive(directory,snapshotPath);
  mkdirSync(dirname(resolve(targetDB)),{recursive:true});
  const db=new DatabaseSync(targetDB);db.exec(schema);
  try {db.exec('BEGIN IMMEDIATE');installImage(db,a.image);putMeta(db,{bookId:a.bookId,seq:a.seq,hash:a.hash});db.exec('COMMIT');return {bookId:a.bookId,seq:a.seq,stateHash:digest(a.image.state),operations:a.image.operations.length};} finally {db.close();}
}
