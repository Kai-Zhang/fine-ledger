import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, cp, readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fixtureOperations } from '../public/reliability-fixture.js';
import { createSnapshot, restoreArchive, loadArchive, digest, openLedger } from '../lib/recovery.mjs';

async function environment(t) {
 const dir=await mkdtemp(join(tmpdir(),'fine-ledger-reliability-')), dbPath=join(dir,'live.sqlite'),archive=join(dir,'archive');
 let child,url,stderr='';
 async function start(database=dbPath,recovery=archive) {
  stderr='';child=spawn(process.execPath,['server.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:'0',LEDGER_DB:database,LEDGER_RECOVERY_DIR:recovery,LEDGER_RELIABILITY_TEST:'1',LEDGER_TOKEN:''},stdio:['ignore','pipe','pipe']});
  child.stderr.on('data',b=>stderr+=b);
  await new Promise((r,j)=>{const timer=setTimeout(()=>j(Error(stderr||'启动超时')),8000);child.once('exit',code=>{clearTimeout(timer);j(Error(`退出 ${code}: ${stderr}`));});child.stdout.on('data',b=>{const m=String(b).match(/http:\/\/127\.0\.0\.1:(\d+)/);if(m){url=m[0];clearTimeout(timer);r();}});});
 }
 async function stop(signal='SIGTERM') {if(child && child.exitCode===null && child.signalCode===null){const exit=once(child,'exit');child.kill(signal);await exit;}}
 const request=async(path,data)=>fetch(url+path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 const snapshot=async()=>{const r=await request('/api/snapshot');assert.equal(r.status,200);return r.json();};
 const sync=async(operations,extra={})=>{const r=await request('/api/sync',{deviceId:'p0-synthetic',cursor:0,operations,...extra});assert.equal(r.status,200,await r.clone().text());return r.json();};
 const arm=async point=>{const r=await request('/api/reliability/fault',{point});assert.equal(r.status,200);};
 t.after(async()=>{await stop();await rm(dir,{recursive:true,force:true});});
 await start();return {dir,dbPath,archive,start,stop,request,snapshot,sync,arm,exit:()=>once(child,'exit')};
}
test('P0: 旧快照 + 增量日志在空数据库逐字段恢复；回执保留；SQLite 丢失可自动重放',async t=>{
 const e=await environment(t),initial=await e.snapshot(),f=fixtureOperations(initial.state,'restore');
 const snapshotFile=join(e.dir,'old.json');
 await e.sync([f.operations[0]]);createSnapshot(e.archive,snapshotFile);
 for(const op of f.operations.slice(1)) {const r=await e.sync([op]);assert.deepEqual(r.acknowledged,[op.id]);assert.deepEqual(r.conflicts,[]);}
 const live=await e.snapshot();assert.deepEqual(live.state,f.expected);
 await e.stop();
 const genesisTarget=join(e.dir,'genesis-restored.sqlite');
 const genesisResult=restoreArchive(e.archive,join(e.archive,'genesis.json'),genesisTarget);
 assert.equal(genesisResult.stateHash,digest(f.expected));
 const genesisDB=new DatabaseSync(genesisTarget,{readOnly:true});
 assert.deepEqual(JSON.parse(genesisDB.prepare('SELECT payload FROM ledger').get().payload),f.expected);
 assert.equal(genesisDB.prepare('SELECT COUNT(*) n FROM operations').get().n,4);genesisDB.close();
 const target=join(e.dir,'recovered.sqlite');
 const result=restoreArchive(e.archive,snapshotFile,target);assert.equal(result.seq,4);assert.equal(result.stateHash,digest(f.expected));
 const recovered=new DatabaseSync(target,{readOnly:true});
 assert.deepEqual(JSON.parse(recovered.prepare('SELECT payload FROM ledger').get().payload),f.expected);
 assert.equal(recovered.prepare('SELECT COUNT(*) n FROM operations').get().n,4);assert.equal(recovered.prepare('PRAGMA integrity_check').get().integrity_check,'ok');recovered.close();
 await e.start(target);const retry=await e.sync(f.operations);assert.equal(retry.cursor,live.cursor);assert.deepEqual(retry.state,f.expected);await e.stop();
 await Promise.all([rm(e.dbPath,{force:true}),rm(e.dbPath+'-wal',{force:true}),rm(e.dbPath+'-shm',{force:true})]);
 await e.start();assert.deepEqual((await e.snapshot()).state,f.expected);await e.stop();
 // A live DB restored to an old checkpoint is repaired before it can serve a stale snapshot.
 const oldDB=new DatabaseSync(e.dbPath);const snap=JSON.parse(await readFile(snapshotFile));
 oldDB.prepare('UPDATE ledger SET payload=? WHERE id=1').run(JSON.stringify(snap.image.state));
 oldDB.prepare('UPDATE recovery_meta SET payload=? WHERE id=1').run(JSON.stringify({bookId:snap.bookId,seq:snap.seq,hash:snap.headHash}));oldDB.close();
 await e.start();assert.deepEqual((await e.snapshot()).state,f.expected);
});
test('P0: SQLite 提交前/日志持久化后/数据库提交后 SIGKILL 与丢响应，重试仅一笔',async t=>{
 const e=await environment(t);
 for(const point of ['before-transaction','journal-durable','database-committed','response-lost']) {
  const before=await e.snapshot(),f=fixtureOperations(before.state,point),op=f.operations[0];
  await e.arm(point);
  const exit=point==='response-lost'?null:e.exit();
  await assert.rejects(e.request('/api/sync',{deviceId:'p0-synthetic',cursor:before.cursor,bookId:before.bookId,operations:[op]}));
  if(exit){await exit;await e.start();}
  const result=await e.sync([op]);assert.deepEqual(result.acknowledged,[op.id]);assert.equal(result.conflicts.length,0);
  const count=result.state.transactions.filter(x=>x.id===op.changes[0].entity.id).length;assert.equal(count,1);
  const db=new DatabaseSync(e.dbPath,{readOnly:true});assert.equal(db.prepare('SELECT COUNT(*) n FROM operations WHERE id=?').get(op.id).n,1);db.close();
 }
});
test('P0: 日志 ENOSPC 不回执且整批回滚；同操作 ID 不同内容拒绝；服务端回退/分叉不静默同步',async t=>{
 const e=await environment(t),before=await e.snapshot(),f=fixtureOperations(before.state,'failure');
 await e.arm('journal-write');const failed=await e.request('/api/sync',{deviceId:'synthetic',operations:[f.operations[0]],cursor:0});assert.notEqual(failed.status,200);
 const rolledBack=await e.snapshot();assert.deepEqual(rolledBack.state,before.state);assert.equal(rolledBack.journalSequence,0);assert.equal(rolledBack.cursor,0);
 await e.arm('database-readonly');
 const readOnly=await e.request('/api/sync',{deviceId:'synthetic',operations:[f.operations[0]],cursor:0});assert.notEqual(readOnly.status,200);assert.match(await readOnly.text(),/readonly/);
 assert.deepEqual((await e.snapshot()).state,before.state);await e.arm('');
 await e.sync([f.operations[0]]);
 const changed=structuredClone(f.operations[0]);changed.changes[0].entity.notes='同 ID 篡改';
 const mismatch=await e.request('/api/sync',{deviceId:'synthetic',cursor:0,operations:[changed]});assert.notEqual(mismatch.status,200);assert.match(await mismatch.text(),/内容不同/);
 for(const extra of [{cursor:100000},{bookId:'wrong-lineage'},{journalSequence:1,journalHead:'wrong-head'}]) {const r=await e.request('/api/sync',{deviceId:'synthetic',operations:[],cursor:0,...extra});assert.equal(r.status,409);}
});
test('P0: 恢复日志损坏/缺段/缺目录与错误快照 fail closed；不覆盖已有恢复目标',async t=>{
 const e=await environment(t),f=fixtureOperations((await e.snapshot()).state,'integrity');
 const snap=join(e.dir,'old.json');createSnapshot(e.archive,snap);for(const op of f.operations) await e.sync([op]);await e.stop();
 const broken=join(e.dir,'broken');await cp(e.archive,broken,{recursive:true});
 await unlink(join(broken,'000000000002.json'));assert.throws(()=>loadArchive(broken),/缺段/);
 await cp(e.archive,broken,{recursive:true});const path=join(broken,'000000000003.json');const entry=JSON.parse(await readFile(path));entry.operations[0].payload+=' ';await writeFile(path,JSON.stringify(entry));assert.throws(()=>loadArchive(broken),/校验/);
 const other=join(e.dir,'other');const otherStore=openLedger(join(e.dir,'other.sqlite'),other);otherStore.db.close();const wrong=join(e.dir,'wrong.json');createSnapshot(other,wrong);assert.throws(()=>restoreArchive(e.archive,wrong,join(e.dir,'wrong-target.sqlite')),/同一/);assert.throws(()=>restoreArchive(e.archive,join(other,'genesis.json'),join(e.dir,'wrong-genesis.sqlite')),/同一/);
 assert.throws(()=>restoreArchive(e.archive,snap,e.dbPath),/不存在/);
 await rm(e.archive,{recursive:true});assert.throws(()=>openLedger(e.dbPath,e.archive),/目录缺失/);
});
