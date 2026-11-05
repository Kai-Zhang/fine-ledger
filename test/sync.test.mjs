import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../server/app.ts';
import {loadConfig} from '../server/config.ts';
import {setPassword} from '../server/auth.ts';
import {LedgerDB,databases,mutate} from '../src/storage/repository.ts';
import {exampleBook} from '../src/domain/example.ts';
import {balance,blankBook} from '../src/domain/ledger.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {changesBetween,keyOf,commandFor} from '../src/sync/model.ts';
const origin='https://ledger.example';
const password='Synthetic-sync-password-123';
async function setup(t,{empty=false}={}){
  const directory=await mkdtemp(path.join(os.tmpdir(),'fine-ledger-sync-'));
  const service=await createService(loadConfig({FINE_LEDGER_DATA_DIR:directory,FINE_LEDGER_PUBLIC_ORIGIN:origin}),{initialPassword:password,timers:false});
  if(!empty)service.store.initialize(exampleBook(),crypto.randomUUID(),service.store.epoch,'fixture');
  const clients=[];
  t.after(async()=>{for(const c of clients)await c.db.delete();await service.app.close();await rm(directory,{recursive:true,force:true});});
  async function client(name){
    const db=new LedgerDB('sync-test-'+crypto.randomUUID());await db.open();
    let cookie,offline=false,dropNext=false,delay;
    const sent=[];
    async function login(p=password){const r=await service.app.inject({method:'POST',url:'/api/v1/session',headers:{origin},payload:{password:p,deviceName:name}});assert.equal(r.statusCode,200,r.body);cookie=r.headers['set-cookie'].split(';')[0];return r.json();}
    await login();
    async function request(route,options={}){
      if(offline)throw Object.assign(Error('offline'),{code:'NETWORK_ERROR'});
      if(route==='sync/push')sent.push(structuredClone(options.data.commands[0]));
      const response=await service.app.inject({method:options.method||'GET',url:'/api/v1/'+route,headers:{origin,cookie,'x-csrf-token':options.csrf||'','content-type':'application/json'},...(options.data!==undefined?{payload:options.data}:{})});
      if(route==='sync/push'&&delay)await delay();
      if(route==='sync/push'&&dropNext){dropNext=false;throw Object.assign(Error('response lost'),{code:'NETWORK_ERROR'});}
      const body=response.json();if(response.statusCode!==200)throw Object.assign(Error(body.message),{status:response.statusCode,code:body.code});return body;
    }
    if(service.store.book()){
      const s=service.store.snapshot();
      await db.state.put(s.book,'book');await db.state.put({origin,ledgerId:s.book.id,serverEpoch:s.serverEpoch,cursor:s.cursor,versions:s.versions,checksum:s.checksum,book:s.book,restoredAt:new Date().toISOString()},'remote-baseline');
    }
    await db.state.put(true,'sync-enabled');
    const engine=new SyncEngine('personal',{origin,request,db});
    const c={db,engine,login,sent,setOffline:v=>offline=v,drop:()=>dropNext=true,delay:fn=>delay=fn,async edit(action,fn){const previous=databases.personal;databases.personal=db;try{return await mutate('personal',action,fn);}finally{databases.personal=previous;}},book:()=>db.state.get('book'),status:()=>db.state.get('sync-status')};
    clients.push(c);return c;
  }
  return {...service,client};
}
const changeName=(b,name)=>{b.name=name;};

test('two devices upload and incrementally pull local records and precise balances without whole-book replacement',async t=>{
  const s=await setup(t),a=await s.client('A'),b=await s.client('B');
  await a.edit('本机重命名',book=>changeName(book,'同步后的账本'));
  await a.engine.run(true);assert.equal((await a.status()).phase,'idle');
  assert.equal(s.store.book().name,'同步后的账本');
  await b.engine.run(true);assert.equal((await b.book()).name,'同步后的账本');
  assert.equal(await a.db.outbox.count(),0);assert.equal(await b.db.outbox.count(),0);
  for(const account of s.store.book().accounts)assert.equal(balance(await b.book(),account.id),balance(s.store.book(),account.id));
});

test('a committed response lost in transit retries the identical frozen command after restart and preserves a newer local edit',async t=>{
  const s=await setup(t),a=await s.client('A');
  await a.edit('第一次修改',book=>{book.entries[0].description='第一次';});a.drop();
  await a.engine.run(true);assert.equal((await a.status()).phase,'offline');
  const frozen=await a.db.state.get('sync-flight');assert(frozen&&!frozen.receipt);
  await a.edit('更新的本机修改',book=>{book.entries[0].description='更新的本机内容';});
  await a.engine.run(true);
  assert.deepEqual(a.sent[0],a.sent[1]);
  assert.equal(s.store.book().entries.find(e=>e.id===frozen.command.changes[0].id).description,'更新的本机内容');
  assert.equal((await a.status()).phase,'idle');assert.equal(await a.db.outbox.count(),0);
  assert.equal(s.store.cursor,3);
});

test('independent offline edits merge, while competing money edits stop for three-way resolution',async t=>{
  const s=await setup(t),a=await s.client('A'),b=await s.client('B');
  await a.edit('名称',book=>{book.name='A 的账本名';});
  await b.edit('项目',book=>{book.projects.push({id:'new-project',name:'B 的项目',archived:false});});
  await a.engine.run(true);await b.engine.run(true);await a.engine.run(true);
  assert.equal((await b.book()).name,'A 的账本名');assert.equal((await a.book()).projects.at(-1).name,'B 的项目');
  const accountId=s.store.book().accounts[0].id;
  await a.edit('期初余额 A',book=>{book.accounts.find(x=>x.id===accountId).openingMinor='9007199254740993';});
  await b.edit('期初余额 B',book=>{book.accounts.find(x=>x.id===accountId).openingMinor='9007199254740994';});
  await a.engine.run(true);await b.engine.run(true);
  const issue=await b.db.state.get('sync-issue');assert.equal(issue.kind,'conflict');
  assert.equal((await b.status()).phase,'conflict');
  assert.equal((await b.book()).accounts.find(x=>x.id===accountId).openingMinor,'9007199254740994');
  const choices=Object.fromEntries(issue.items.map(i=>[keyOf(i.collection,i.id),'local']));
  await b.engine.resolve(choices);await b.engine.run(true);await a.engine.run(true);
  assert.equal(s.store.book().accounts.find(x=>x.id===accountId).openingMinor,'9007199254740994');
  assert.equal((await a.book()).accounts.find(x=>x.id===accountId).openingMinor,'9007199254740994');
  assert(await b.db.state.get('sync-archive'));
});

test('keeping a remote conflict version preserves unrelated local changes and never replays remote updates as local intent',async t=>{
  const s=await setup(t),a=await s.client('A'),b=await s.client('B');
  await a.edit('名称 A',book=>{book.name='远端名称';});
  await b.edit('名称 B 与项目',book=>{book.name='本机名称';book.projects.push({id:'kept-project',name:'本机独立项目',archived:false});});
  await a.engine.run(true);await b.engine.run(true);
  const issue=await b.db.state.get('sync-issue');
  await b.engine.resolve(Object.fromEntries(issue.items.map(i=>[keyOf(i.collection,i.id),'remote'])));
  await b.engine.run(true);
  assert.equal(s.store.book().name,'远端名称');assert(s.store.book().projects.some(p=>p.id==='kept-project'));
});

test('more than 200 independent changes are submitted in valid dependency-ordered chunks',async t=>{
  const s=await setup(t),a=await s.client('A');
  await a.edit('新增大量项目',book=>{for(let i=0;i<450;i++)book.projects.push({id:'bulk-'+i,name:'合成项目 '+i,archived:false});});
  await a.engine.run(true);
  assert.equal((await a.status()).phase,'idle');assert.equal(s.store.book().projects.length,451);
  assert(a.sent.length>=3);assert(a.sent.every(c=>c.changes.length<=200));
  assert.equal(a.sent[1].dependsOn[0],a.sent[0].operationId);
  assert.equal(await a.db.outbox.count(),0);
});

test('two tab coordinators cannot upload simultaneously and replaying a pull does not duplicate money',async t=>{
  const s=await setup(t),a=await s.client('A');
  await a.edit('名称',book=>{book.name='单次提交';});
  let release,started;const wait=new Promise(r=>release=r),ready=new Promise(r=>started=r);
  a.delay(async()=>{started();await wait;});
  const first=a.engine.run(true);await ready;
  const second=new SyncEngine('personal',{origin,db:a.db,request:async()=>{throw Error('第二标签不应发请求');}});
  await second.run(true);release();await first;
  assert.equal(s.store.cursor,2);assert.equal(a.sent.length,1);
  const cursor=(await a.db.state.get('remote-baseline')).cursor;
  await a.engine.run(true);assert.equal((await a.db.state.get('remote-baseline')).cursor,cursor);
});

test('server epoch changes stop the frozen old request and recovery can restore already-confirmed data missing from a backup',async t=>{
  const s=await setup(t),a=await s.client('A');
  await a.edit('已确认新项目',book=>{book.projects.push({id:'after-backup',name:'备份后已确认',archived:false});});await a.engine.run(true);
  await a.edit('尚未确认的新修改',book=>{book.name='本机最新名称';});
  // Model a verified old backup restored by the server management command.
  s.store.db.prepare('DELETE FROM projects WHERE id=?').run('after-backup');
  s.store.db.prepare("DELETE FROM versions WHERE collection='projects' AND id=?").run('after-backup');
  s.store.setMeta('epoch',crypto.randomUUID());await setPassword(s.store,password);
  await a.engine.run(true);assert.equal((await a.status()).phase,'auth-required');
  await a.login();await a.engine.run(true);
  assert.equal((await a.status()).phase,'recovery');assert.equal(a.sent.length,1);
  const issue=await a.db.state.get('sync-issue');
  assert(issue.items.some(i=>i.id==='after-backup'));
  await a.engine.resolve(Object.fromEntries(issue.items.map(i=>[keyOf(i.collection,i.id),'local'])));await a.engine.run(true);
  assert.equal(s.store.book().name,'本机最新名称');assert(s.store.book().projects.some(p=>p.id==='after-backup'));
});

test('an empty service can be initialized from local state; edits made during initialization remain pending and then sync',async t=>{
  const s=await setup(t,{empty:true}),a=await s.client('A');
  await a.db.state.put(blankBook(),'book');
  await a.engine.publish();await a.edit('初始化后的修改',book=>{book.name='完整本机账本';});await a.engine.run(true);
  assert.equal(s.store.book().name,'完整本机账本');assert.equal((await a.status()).phase,'idle');
});

test('a stale account editor cannot overwrite another saved change but unrelated changes merge safely',async t=>{
  const s=await setup(t),a=await s.client('A');const original=structuredClone(await a.book());
  await a.edit('另一个页面保存',book=>{book.accounts[0].openingMinor='12345';});
  const previous=databases.personal;databases.personal=a.db;
  try{await assert.rejects(mutate('personal','过期编辑',book=>{book.accounts[0].name='旧表单';},original),/编辑期间/);}
  finally{databases.personal=previous;}
  assert.equal((await a.book()).accounts[0].openingMinor,'12345');
});


test('review refresh includes a newly competing local record and requires confirmation again',async t=>{
  const s=await setup(t),a=await s.client('A'),b=await s.client('B');
  await b.edit('本机两项修改',book=>{book.name='B';book.accounts[0].openingMinor='98765';});
  await a.edit('远端名称',book=>{book.name='A';});await a.engine.run(true);await b.engine.run(true);
  const original=await b.db.state.get('sync-issue');assert.equal(original.items.length,1);
  await a.edit('远端余额',book=>{book.accounts[0].openingMinor='54321';});await a.engine.run(true);
  await assert.rejects(b.engine.resolve(Object.fromEntries(original.items.map(i=>[keyOf(i.collection,i.id),'remote']))),/远端又有变化/);
  const fresh=await b.db.state.get('sync-issue');assert(fresh.items.some(i=>i.collection==='accounts'));
  assert.equal((await b.book()).accounts[0].openingMinor,'98765');
  await assert.rejects(b.engine.resolve(Object.fromEntries(original.items.map(i=>[keyOf(i.collection,i.id),'remote']))),/每项差异/);
  await b.engine.resolve(Object.fromEntries(fresh.items.map(i=>[keyOf(i.collection,i.id),'remote'])));await b.engine.run(true);
  assert.equal((await b.book()).accounts[0].openingMinor,'54321');
});

test('expired authentication keeps local edits, then reauthentication resumes without duplicate transactions',async t=>{
  const s=await setup(t),a=await s.client('A');
  await a.edit('离线修改',book=>{book.entries[0].description='过期后仍保留';});
  await setPassword(s.store,password);await a.engine.run(true);
  assert.equal((await a.status()).phase,'auth-required');assert.equal(await a.db.outbox.count(),1);
  await a.login();await a.engine.run(true);assert.equal((await a.status()).phase,'idle');
  assert.equal(s.store.book().entries.length,28);assert.equal(s.store.book().entries[0].description,'过期后仍保留');
});

test('failed incremental IndexedDB commit never advances the baseline or loses pending work',async t=>{
  const s=await setup(t),a=await s.client('A'),b=await s.client('B');
  await a.edit('远端修改',book=>{book.name='等待原子应用';});await a.engine.run(true);
  const before=await b.db.state.get('remote-baseline');
  const original=b.db.state.put.bind(b.db.state);b.db.state.put=async(v,k)=>{if(k==='book')throw Error('simulated disk failure');return original(v,k);};
  await b.engine.run(true);assert.deepEqual(await b.db.state.get('remote-baseline'),before);assert.notEqual((await b.book()).name,'等待原子应用');
  b.db.state.put=original;await b.engine.run(true);assert.equal((await b.book()).name,'等待原子应用');assert.equal((await b.status()).phase,'idle');
});

test('rejected commands preserve local work and do not loop on automatic or forced retries',async t=>{
 const s=await setup(t),a=await s.client('A');await a.edit('需人工处理',b=>{b.name='待核对修改';});
 const transport=a.engine.options.request;let pushes=0;a.engine.options.request=async(route,opt)=>{if(route==='sync/push'){pushes++;return{results:[{operationId:opt.data.commands[0].operationId,status:'rejected',message:'合成业务拒绝'}]};}return transport(route,opt);};
 await a.engine.run(true);await a.engine.run();await a.engine.run(true);
 assert.equal(pushes,1);assert.equal((await a.db.state.get('sync-issue')).kind,'rejected');assert.equal((await a.book()).name,'待核对修改');assert.equal(await a.db.outbox.count(),1);assert.equal(s.store.cursor,1);
});

test('an expired tab lease cannot apply a late response after another owner has completed its command',async t=>{
 const s=await setup(t),a=await s.client('A');await a.edit('单笔变更',b=>{b.name='新租约接管';});
 let release,started;const wait=new Promise(r=>release=r),ready=new Promise(r=>started=r);a.delay(async()=>{started();await wait;});
 const first=a.engine.run(true);await ready;await a.db.state.put({owner:'expired-owner',until:Date.now()-1},'sync-lease');
 a.delay(null);const second=new SyncEngine('personal',{origin,db:a.db,request:a.engine.options.request});await second.run(true);
 const baseline=await a.db.state.get('remote-baseline');release();await first;
 assert.deepEqual(await a.db.state.get('remote-baseline'),baseline);assert.equal(s.store.cursor,2);assert.equal(await a.db.outbox.count(),0);assert.equal((await a.status()).phase,'idle');
});

test('lost initialization responses retry the same persisted identity and retain newer local edits',async t=>{
 const s=await setup(t,{empty:true}),a=await s.client('A');await a.db.state.put(blankBook(),'book');
 const transport=a.engine.options.request;let drop=true;const ids=[];a.engine.options.request=async(route,opt)=>{const result=await transport(route,opt);if(route==='ledger/initialize'){ids.push(opt.data.operationId);if(drop){drop=false;throw Error('initial response lost');}}return result;};
 await assert.rejects(a.engine.publish(),/response lost/);assert(await a.db.state.get('sync-init'));
 await a.edit('新的本机修改',b=>{b.name='初始化后继续记账';});await a.engine.run(true);
 assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.equal(s.store.book().name,'初始化后继续记账');assert.equal((await a.status()).phase,'idle');
});

test('a missing commit in a pull page cannot silently skip money by advancing the watermark',async t=>{
 const s=await setup(t),a=await s.client('A'),b=await s.client('B');
 await a.edit('第一批修改',book=>{book.accounts[0].openingMinor='77777';});await a.engine.run(true);
 await a.edit('第二批修改',book=>{book.projects.push({id:'after-gap',name:'不能越过前一批',archived:false});});await a.engine.run(true);
 const transport=b.engine.options.request;const before=await b.db.state.get('remote-baseline');
 b.engine.options.request=async(route,opt)=>{const response=await transport(route,opt);return route.startsWith('sync/pull?')?{...response,batches:response.batches.slice(1)}:response;};
 await b.engine.run(true);assert.deepEqual(await b.db.state.get('remote-baseline'),before);assert(!(await b.book()).projects.some(p=>p.id==='after-gap'));
 b.engine.options.request=transport;await b.engine.run(true);assert.equal((await b.book()).accounts[0].openingMinor,'77777');assert.equal((await b.status()).phase,'idle');
});

test('idle synchronization does not invalidate the observed empty queue and trigger another foreground run',async t=>{
 const {liveQuery}=await import('dexie');const s=await setup(t),a=await s.client('A');
 let ready,notifications=0;const started=new Promise(r=>ready=r);
 const sub=liveQuery(()=>a.db.outbox.count()).subscribe(()=>{notifications++;ready();});t.after(()=>sub.unsubscribe());await started;
 await a.engine.run(true);await a.engine.run(true);await new Promise(r=>setTimeout(r,30));
 assert.equal(notifications,1);assert.equal(s.store.cursor,1);assert.equal((await a.status()).phase,'idle');
});

test('shared overview state follows queued edits and synchronization, and drops metadata after a local reset', async t => {
 const {readLocalSyncState}=await import('../src/sync/local-view.ts');
 const s=await setup(t),a=await s.client('overview');
 await a.engine.run(true);
 const initial=await readLocalSyncState(a.db);
 assert.equal(initial.pending,0);assert.equal(initial.status.phase,'idle');assert.equal(initial.baseline.ledgerId,s.store.book().id);
 await a.edit('概览测试',b=>{b.name='概览同步测试';});
 const queued=await readLocalSyncState(a.db);assert.equal(queued.pending,1);assert.equal(queued.baseline.cursor,initial.baseline.cursor);
 await a.engine.run(true);
 const synced=await readLocalSyncState(a.db);assert.equal(synced.pending,0);assert.equal(synced.status.phase,'idle');assert(synced.baseline.cursor>initial.baseline.cursor);
 assert.equal(synced.baseline.book.name,'概览同步测试');
 await a.db.transaction('rw',a.db.state,a.db.outbox,async()=>{
  await a.db.state.bulkDelete(['remote-baseline','sync-status','sync-issue']);await a.db.outbox.clear();
 });
 assert.deepEqual(await readLocalSyncState(a.db),{baseline:undefined,status:undefined,issue:undefined,pending:0});
 assert.equal((await a.book()).name,'概览同步测试');
});

test('new excess and cross-currency refunds sync between two independent local stores without changing amounts or links',async t=>{
 const s=await setup(t),a=await s.client('refund-A'),b=await s.client('refund-B');
 const before=await a.book();const original=before.entries.find(e=>e.kind==='expense'&&e.posted&&!e.deletedAt&&before.accounts.find(x=>x.id===e.accountId).currency==='CNY');
 const jpy=before.accounts.find(x=>x.currency==='JPY');
 const make=(id,accountId,amountMinor)=>({...original,id,kind:'refund',accountId,amountMinor,originalId:original.id,revision:0,splits:[{id:id+'-split',categoryId:original.splits[0].categoryId,amountMinor}]});
 const excess=make(crypto.randomUUID(),original.accountId,(BigInt(original.amountMinor)+12345n).toString());
 const foreign=make(crypto.randomUUID(),jpy.id,'6789');
 const oldNative=balance(before,jpy.id);
 await a.edit('超额和跨币种退款',book=>book.entries.push(excess,foreign));
 await a.engine.run(true);await b.engine.run(true);
 assert.equal((await a.status()).phase,'idle');assert.equal((await b.status()).phase,'idle');
 for(const expected of [excess,foreign]){
  const actual=(await b.book()).entries.find(e=>e.id===expected.id);assert.equal(actual.originalId,original.id);assert.equal(actual.amountMinor,expected.amountMinor);assert.equal(actual.accountId,expected.accountId);
 }
 assert.equal(balance(await b.book(),jpy.id),oldNative+6789n);
 assert.equal(await a.db.outbox.count(),0);
});

test('file import can publish to an empty server and finish its first sync, then restore on a second device',async t=>{
 const {importLocalBackup}=await import('../src/storage/archive.ts');
 const {readRestoreTarget,restoreRemoteBook}=await import('../src/storage/repository.ts');
 const s=await setup(t,{empty:true}),a=await s.client('first-device');
 const source=exampleBook();
 const old=databases.personal;databases.personal=a.db;
 try{await importLocalBackup('personal',{format:'fine-ledger-backup',version:3,book:source,operations:[],revisions:[],legacy:{drafts:[]}},(await readRestoreTarget('personal')).token);}finally{databases.personal=old;}
 assert.equal(await a.db.state.get('sync-enabled'),false);
 assert.equal(await a.db.state.get('sync-import-review'),true);
 await a.engine.publish();await a.engine.run(true);
 assert.equal((await a.status()).phase,'idle');assert.equal(await a.db.state.get('sync-import-review'),undefined);assert.equal(await a.db.state.get('sync-issue'),undefined);
 const b=await s.client('second-device'),snapshot=s.store.snapshot();
 const previous=databases.personal;databases.personal=b.db;
 try{await restoreRemoteBook('personal',snapshot,{origin,expectedTarget:(await readRestoreTarget('personal')).token,ledgerId:source.id,serverEpoch:s.store.epoch});}finally{databases.personal=previous;}
 await b.engine.run(true);assert.equal((await b.status()).phase,'idle');
 assert.equal((await b.book()).entries.length,source.entries.length);
 for(const account of source.accounts)assert.equal(balance(await b.book(),account.id),balance(source,account.id));
});

test('deleting a group atomically relocates active and archived accounts and syncs the retained history to another device',async t=>{
  const {removeGroup}=await import('../src/domain/organization.ts');
  const s=await setup(t),a=await s.client('A'),b=await s.client('B');
  const before=await a.book(),source=before.accounts[0].groupId;
  assert(source);
  const members=before.accounts.filter(x=>x.groupId===source);
  await a.edit('归档合成账户',book=>{book.accounts.find(x=>x.id===members[0].id).archived=true;});
  await a.engine.run(true);await b.engine.run(true);
  await a.edit('删除分组并保留账户',book=>removeGroup(book,source,''));
  await a.engine.run(true);await b.engine.run(true);
  for(const book of [s.store.book(),await a.book(),await b.book()]){
    assert(!book.groups.some(g=>g.id===source));
    assert.equal(book.accounts.length,before.accounts.length);
    for(const old of members){
      assert.equal(book.accounts.find(x=>x.id===old.id).groupId,'');
      assert.equal(balance(book,old.id),balance(before,old.id));
    }
    assert(book.accounts.find(x=>x.id===members[0].id).archived);
    assert.deepEqual(book.entries,before.entries);
  }
  assert.equal((await a.status()).phase,'idle');assert.equal((await b.status()).phase,'idle');
  assert.equal(await a.db.outbox.count(),0);
});

test('P3 foreign-only entry syncs and competing confirmations preserve both actual amounts for explicit resolution',async t=>{
 const {upsertEntry}=await import('../src/domain/ledger.ts');const {confirmPosting}=await import('../src/domain/posting.ts');
 const s=await setup(t),a=await s.client('P3 A'),b=await s.client('P3 B');
 const account=s.store.book().accounts.find(x=>x.currency==='CNY'&&!x.archived);const at='2026-10-15T01:02:03.123456Z';
 const e={id:'p3-foreign',kind:'expense',accountId:account.id,amountMinor:'10000',amountCurrency:'JPY',originalAmount:{currency:'JPY',amountMinor:'10000'},description:'合成原币',occurredAt:at,posted:false,splits:[{id:'p3-s',categoryId:'food-0',amountMinor:'10000'}],createdAt:at,updatedAt:at,revision:0};
 const before=balance(s.store.book(),account.id);
 await a.edit('录入原币',book=>upsertEntry(book,e));await a.engine.run(true);await b.engine.run(true);
 assert.equal((await b.book()).schema,4);assert.equal(balance(await b.book(),account.id),before);
 await a.edit('确认490',book=>confirmPosting(book,structuredClone(book.entries.find(x=>x.id===e.id)),'49000'));
 await b.edit('确认495',book=>confirmPosting(book,structuredClone(book.entries.find(x=>x.id===e.id)),'49500'));
 await a.engine.run(true);await b.engine.run(true);
 const issue=await b.db.state.get('sync-issue');assert.equal(issue.kind,'conflict');
 const item=issue.items.find(x=>x.id===e.id);assert.equal(item.local.amountMinor,'49500');assert.equal(item.remote.amountMinor,'49000');
 assert.deepEqual(item.remote.originalAmount,e.originalAmount);
 await b.engine.resolve(Object.fromEntries(issue.items.map(i=>[keyOf(i.collection,i.id),'remote'])));await b.engine.run(true);await a.engine.run(true);
 assert.equal(s.store.book().entries.filter(x=>x.id===e.id).length,1);assert.equal(balance(await b.book(),account.id),before-49000n);
});

test('P3 transfer and linked fee publish together, exact amounts and credit limit survive second-device restore',async t=>{
 const {upsertEntry}=await import('../src/domain/ledger.ts');const s=await setup(t),a=await s.client('Fee A'),b=await s.client('Fee B');
 await a.edit('转账和手续费',book=>{
  book.schema=4;book.accounts.find(x=>x.id==='card').creditLimitMinor='5000000';
  const transfer={...book.entries.find(x=>x.kind==='transfer'),id:'p3-transfer',revision:0};upsertEntry(book,transfer);
  upsertEntry(book,{...book.entries.find(x=>x.kind==='expense'&&x.posted&&!x.deletedAt),id:'p3-fee',accountId:transfer.accountId,amountMinor:'123',splits:[{id:'fee-split',categoryId:'food-0',amountMinor:'123'}],transferId:transfer.id,revision:0});
 });
 await a.engine.run(true);assert.equal((await a.status()).phase,'idle');await b.engine.run(true);
 assert.equal((await b.book()).entries.find(x=>x.id==='p3-fee').transferId,'p3-transfer');assert.equal((await b.book()).accounts.find(x=>x.id==='card').creditLimitMinor,'5000000');
});


test('new report types retain all calendar grains, project scopes, metrics and chart styles across two synchronized clients',async t=>{
 const s=await setup(t),a=await s.client('report-A'),b=await s.client('report-B');
 await a.edit('完整报表条件',book=>{book.settings.savedReports.push({id:'project-report',name:'项目分期',type:'income-trend',days:'all',from:'2024-01-01',to:'2024-12-31',accountIds:book.accounts.map(a=>a.id),categoryIds:[],projectIds:[book.projects[0]?.id||'none'],grain:'quarter',metric:'net',chart:'line'});});
 await a.engine.run(true);await b.engine.run(true);
 assert.deepEqual((await b.book()).settings.savedReports,(await a.book()).settings.savedReports);
 const r=(await b.book()).settings.savedReports.at(-1);assert.equal(r.grain,'quarter');assert.equal(r.chart,'line');assert.equal(r.type,'income-trend');assert.equal(await a.db.outbox.count(),0);
});


test('initialization keeps its own cursor and rebases concurrent remote edits, including a lost response', async t => {
  for (const loseResponse of [false, true]) {
    const s = await setup(t, {empty:true}), a = await s.client('publisher');
    const book = blankBook(); await a.db.state.put(book, 'book');
    const transport = a.engine.options.request; let first = true;
    a.engine.options.request = async (route, options) => {
      const result = await transport(route, options);
      if (route === 'ledger/initialize' && first) {
        first = false;
        const snapshot = s.store.snapshot(), next = structuredClone(snapshot.book);
        next.name = '另一设备已保存';
        s.store.push(commandFor(snapshot.book,next,snapshot.versions,snapshot.serverEpoch),'other');
        await a.edit('初始化期间本机独立修改', b => b.projects.push({id:'local-project',name:'本机项目',archived:false}));
        if (loseResponse) throw Error('lost initialization response');
      }
      return result;
    };
    if (loseResponse) await assert.rejects(a.engine.publish(), /lost/);
    else await a.engine.publish();
    await a.engine.run(true);
    assert.equal((await a.book()).name, '另一设备已保存');
    assert.equal(s.store.book().name, '另一设备已保存');
    assert(s.store.book().projects.some(p => p.id === 'local-project'));
    assert.equal((await a.status()).phase, 'idle');
  }
});

test('competing names during initialization require review instead of silently overwriting', async t => {
  const s = await setup(t,{empty:true}), a = await s.client('publisher');
  await a.db.state.put(blankBook(),'book');
  const transport = a.engine.options.request;
  a.engine.options.request = async (route, options) => {
    const result = await transport(route,options);
    if(route === 'ledger/initialize') {
      const snap=s.store.snapshot(), next=structuredClone(snap.book);next.name='远端修改';
      s.store.push(commandFor(snap.book,next,snap.versions,snap.serverEpoch),'other');
      await a.edit('本机修改',b=>{b.name='本机修改'});
    }
    return result;
  };
  await a.engine.publish();await a.engine.run(true);
  assert.equal((await a.status()).phase,'conflict');
  assert.equal(s.store.book().name,'远端修改');
  assert.equal((await a.book()).name,'本机修改');
});
