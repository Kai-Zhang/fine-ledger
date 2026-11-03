import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,unzipSync,strToU8} from 'fflate';
import {encodeBackup,decodeBackup,importLocalBackup} from '../src/storage/archive.ts';
import {LedgerDB,databases,exportBook,readRestoreTarget,mutate} from '../src/storage/repository.ts';
import {exampleBook} from '../src/domain/example.ts';
async function setup(t){
 const previous=databases.personal,db=new LedgerDB('archive-test-'+crypto.randomUUID());databases.personal=db;await db.open();await db.state.put(exampleBook(),'book');
 t.after(async()=>{databases.personal=previous;await db.delete();});return db;
}
test('complete ZIP roundtrip preserves exact book, pending work, draft keys and recovery archives; original JSON remains readable',async t=>{
 const db=await setup(t);await mutate('personal','合成修改',b=>{b.accounts[0].openingMinor='9007199254740993';});
 await db.drafts.put({text:'兼容草稿'},'original-draft');await db.state.put({book:exampleBook(),reason:'合成副本'},'sync-archive');
 const source=await exportBook('personal'),encoded=await encodeBackup(source),decoded=await decodeBackup(encoded);
 assert.deepEqual(decoded,JSON.parse(JSON.stringify(source)));assert.deepEqual(await decodeBackup(strToU8(JSON.stringify(source))),decoded);
 await mutate('personal','恢复前新修改',b=>{b.name='恢复前';});const target=await readRestoreTarget('personal');
 await importLocalBackup('personal',decoded,target.token);
 assert.deepEqual(await db.state.get('book'),decoded.book);assert.equal(await db.outbox.count(),1);assert.deepEqual(await db.drafts.get('original-draft'),{text:'兼容草稿'});
 assert.equal(await db.state.get('sync-enabled'),false);assert.equal(await db.state.get('sync-import-review'),true);assert.equal((await db.state.get('before-file-restore')).book.name,'恢复前');
});
test('corrupt ZIP payload, unsafe paths and invalid relationships are rejected without modifying local data',async t=>{
 const db=await setup(t),before=await exportBook('personal'),bytes=await encodeBackup(before),files=unzipSync(bytes);
 files['ledger.json'][files['ledger.json'].length-3]^=1;await assert.rejects(decodeBackup(zipSync(files)),/校验失败/);
 await assert.rejects(decodeBackup(zipSync({'../ledger.json':strToU8('{}')})),/备份包内容/);
 const invalid=structuredClone(before);invalid.book.entries[0].accountId='missing-account';await assert.rejects(decodeBackup(strToU8(JSON.stringify(invalid))));
 assert.deepEqual(await db.state.get('book'),before.book);
});
test('file restore detects stale previews and rolls back a failure after replacing the working book',async t=>{
 const db=await setup(t),backup=await decodeBackup(await encodeBackup(await exportBook('personal'))),target=await readRestoreTarget('personal');
 await mutate('personal','预览后修改',b=>{b.name='不能被覆盖';});await assert.rejects(importLocalBackup('personal',backup,target.token),/预览后变化/);
 const fresh=await readRestoreTarget('personal'),before=await exportBook('personal'),put=db.state.put.bind(db.state);
 db.state.put=async(v,k)=>{if(k==='source-backup')throw Error('simulated storage failure');return put(v,k);};
 await assert.rejects(importLocalBackup('personal',backup,fresh.token),/storage failure/);db.state.put=put;
 assert.deepEqual(await db.state.get('book'),before.book);assert.deepEqual(await db.outbox.toArray(),before.operations);assert.equal(await db.state.get('before-file-restore'),undefined);
});

test('schema 4 foreign-only records restore into IndexedDB without legacy remapping or invented account amounts',async t=>{
 const {upsertEntry}=await import('../src/domain/ledger.ts');const {confirmPosting}=await import('../src/domain/posting.ts');
 const {readBook}=await import('../src/storage/repository.ts');const db=await setup(t);
 await mutate('personal','原币',book=>{const account=book.accounts.find(a=>a.currency==='CNY'&&!a.archived);const at='2026-10-15T01:02:03.123456Z';upsertEntry(book,{id:'restored-fx',kind:'expense',accountId:account.id,amountMinor:'10000',amountCurrency:'JPY',originalAmount:{currency:'JPY',amountMinor:'10000'},description:'恢复原币',occurredAt:at,posted:false,splits:[{id:'rfx-s',categoryId:'food-0',amountMinor:'10000'}],createdAt:at,updatedAt:at,revision:0});});
 const exported=await exportBook('personal'),backup=await decodeBackup(await encodeBackup(exported));
 await importLocalBackup('personal',backup,(await readRestoreTarget('personal')).token);
 const restored=await readBook('personal');assert.equal(restored.schema,4);assert.deepEqual(restored,exported.book);
 await mutate('personal','恢复后确认',book=>confirmPosting(book,book.entries.find(e=>e.id==='restored-fx'),'49000'));
 const after=await readBook('personal');assert.equal(after.entries.find(e=>e.id==='restored-fx').amountMinor,'49000');assert.equal(after.entries.find(e=>e.id==='restored-fx').originalAmount.amountMinor,'10000');
});


test('complete ZIP restore retains new report conditions and source archives without losing legacy saved reports',async t=>{
 const db=await setup(t);
 await mutate('personal','报表条件',book=>{book.settings.savedReports=[{id:'legacy',name:'旧净值',type:'net',days:'30',from:'2024-01-01',to:'2024-01-31',accountIds:[],categoryIds:[]},{id:'new',name:'项目支出',type:'project',days:'all',from:'2024-01-01',to:'2024-12-31',accountIds:[book.accounts[0].id],categoryIds:[],projectIds:[book.projects[0]?.id||'none'],grain:'year',metric:'refund',chart:'line'}];});
 await db.state.put({source:'synthetic-legacy',reconciliationFlags:[true,false]},'legacy-book-v2');
 const source=await exportBook('personal'),decoded=await decodeBackup(await encodeBackup(source));
 await mutate('personal','更改条件',book=>{book.settings.savedReports=[];});
 await importLocalBackup('personal',decoded,(await readRestoreTarget('personal')).token);
 assert.deepEqual((await db.state.get('book')).settings.savedReports,source.book.settings.savedReports);
 assert.deepEqual(await db.state.get('legacy-book-v2'),source.legacy.book);
});
