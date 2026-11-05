import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {LedgerDB,databases,exportBook} from '../src/storage/repository.ts';
import {pruneConfirmedRevisions} from '../src/storage/retention.ts';
import {encodeBackup,decodeBackup} from '../src/storage/archive.ts';
import {exampleBook} from '../src/domain/example.ts';
test('confirmed-history retention protects recent, pending and conflicted records and supports unlimited history',async t=>{
 const db=new LedgerDB('retention-'+crypto.randomUUID());t.after(()=>db.delete());
 await db.revisions.bulkPut(Array.from({length:1100},(_,i)=>({id:'r'+i,at:new Date(Date.parse('2025-01-01')+i*1000).toISOString(),changes:[]})));
 await db.outbox.put({id:'r0'});
 await db.transaction('rw',db.state,db.outbox,db.revisions,()=>pruneConfirmedRevisions(db));
 assert.equal(await db.revisions.count(),1001);assert(await db.revisions.get('r0'));
 await db.state.put({kind:'conflict'},'sync-issue');
 const count=await db.revisions.count();
 await db.transaction('rw',db.state,db.outbox,db.revisions,()=>pruneConfirmedRevisions(db));assert.equal(await db.revisions.count(),count);
 await db.state.delete('sync-issue');await db.state.put({days:0,minimum:1000},'revision-retention');
 await db.transaction('rw',db.state,db.outbox,db.revisions,()=>pruneConfirmedRevisions(db));assert.equal(await db.revisions.count(),count);
});
test('current backup excludes historical archives without changing live state, pending work or drafts',async t=>{
 const previous=databases.personal,db=new LedgerDB('current-backup-'+crypto.randomUUID());databases.personal=db;t.after(async()=>{databases.personal=previous;await db.delete()});
 const book=exampleBook();await db.state.put(book,'book');await db.state.put({book},'before-file-restore');await db.revisions.put({id:'old',at:'2020-01-01',changes:[]});await db.outbox.put({id:'pending',bookId:book.id});await db.drafts.put({text:'unsaved'},'draft');
 const data=await exportBook('personal',false),roundtrip=await decodeBackup(await encodeBackup(data));
 assert.deepEqual(roundtrip.book,book);assert.equal(roundtrip.operations.length,1);assert.equal(roundtrip.draftRecords[0].value.text,'unsaved');assert.equal(roundtrip.revisions.length,0);assert.equal(roundtrip.beforeFileRestore,undefined);
 assert.equal(await db.revisions.count(),1);assert(await db.state.get('before-file-restore'));
});
