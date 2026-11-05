import test from 'node:test';
import assert from 'node:assert/strict';
import {same,business,applyChanges,changesBetween} from '../src/sync/model.ts';
import {canonical,validateBook} from '../src/sync/protocol.ts';
import {exampleBook} from '../src/domain/example.ts';
import {descriptions,accountBalances} from '../src/domain/ledger.ts';
import {descriptionSuggestions} from '../src/domain/description-view.ts';
import {currentAccountBalances} from '../src/domain/account-view.ts';
import {transactionSelection,transactionOrder} from '../src/domain/transaction-view.ts';
import {emptyFilter,filterEntries} from '../src/domain/filters.ts';
test('direct business comparison preserves wire equality and nested revision semantics',()=>{
 const values=[null,undefined,0,'0',false,[],[undefined],[null],{}, {a:undefined},{a:null},{a:1,revision:9},{revision:1,a:1},{x:{revision:1}},{x:{revision:2}}, {splits:[{id:'s',amountMinor:'9007199254740993'}]}];
 for(const a of values)for(const b of values)assert.equal(same(a,b),canonical(business(a))===canonical(business(b)));
});
test('structural changes preserve immutable inputs and revalidate changed relationships',()=>{
 const before=exampleBook(),snapshot=structuredClone(before),e=before.entries.find(e=>e.kind==='expense');
 const value={...e,description:'changed'};
 const after=applyChanges(before,[{collection:'entries',id:e.id,value}]);
 assert.deepEqual(before,snapshot);assert.equal(after.entries.find(x=>x.id===e.id).description,'changed');
 value.description='later caller mutation';assert.equal(after.entries.find(x=>x.id===e.id).description,'changed');
 assert.equal(changesBetween(before,after).length,1);validateBook(after,before);
 const category=before.categories.find(c=>c.id===e.splits[0].categoryId);
 const broken=applyChanges(before,[{collection:'categories',id:category.id,value:{...category,kind:'income'}}]);
 assert.throws(()=>validateBook(broken,before));
});
test('description cache matches recent unique prefix/substrings and invalidates on a new snapshot',()=>{
 const b=exampleBook();
 for(const kind of ['expense','income','refund','transfer'])for(const q of ['', '咖啡','a',' '])assert.deepEqual(descriptionSuggestions(b,kind,q),descriptions(b,kind,q));
 const next=applyChanges(b,[{collection:'entries',id:b.entries[0].id,value:{...b.entries[0],description:'fresh',updatedAt:'2099-01-01T00:00:00Z'}}]);
 assert.deepEqual(descriptionSuggestions(next,b.entries[0].kind,'fresh'),descriptions(next,b.entries[0].kind,'fresh'));
});
test('account view respects future endpoints, clock rollback and immutable edits',()=>{
 const b=exampleBook();
 for(const at of ['2020-01-01T00:00:00Z','2030-01-01T00:00:00Z','2026-01-01T00:00:00Z','2099-01-01T00:00:00Z'])assert.deepEqual(currentAccountBalances(b,at),accountBalances(b,at));
 const next=applyChanges(b,[{collection:'accounts',id:b.accounts[0].id,value:{...b.accounts[0],openingMinor:'123456'}}]);
 assert.deepEqual(currentAccountBalances(next,'2099-01-01T00:00:00Z'),accountBalances(next,'2099-01-01T00:00:00Z'));
});
test('transaction views preserve filters and incoming transfer order across remounts and changes',()=>{
 const b=exampleBook(),f=emptyFilter();
 for(const filter of [f,{...f,status:'posted'},{...f,kinds:['expense']},{...f,categories:['food']}]) {
  const selected=transactionSelection(b,{page:'transactions'},filter,'');
  assert.deepEqual(selected,filterEntries(b,b.entries.filter(e=>!e.deletedAt),filter));
  assert.equal(selected,transactionSelection(b,{page:'transactions'},filter,''));
 }
 const transfer=b.entries.find(e=>e.kind==='transfer');
 const ordered=transactionOrder(b,[transfer],transfer.toAccountId);
 assert.equal(ordered[0].occurredAt,transfer.receivedAt||transfer.occurredAt);
 const all=transactionSelection(b,{page:'transactions'},f);
 const next=applyChanges(b,[{collection:'entries',id:b.entries[0].id,value:{...b.entries[0],deletedAt:new Date().toISOString()}}]);
 assert.equal(transactionSelection(next,{page:'transactions'},f).length,all.length-1);
});
test('relative date filters invalidate cached selections at the next local day',()=>{
 const b=exampleBook();b.timeZone='Asia/Shanghai';
 const e=b.entries.find(e=>e.kind==='expense');b.entries=[{...e,occurredAt:'2026-11-05T23:59:00+08:00'},{...e,id:'next-day',occurredAt:'2026-11-06T00:01:00+08:00'}];
 const f={...emptyFilter(),period:'month'};
 const before=new Date('2026-11-05T23:59:30+08:00'),after=new Date('2026-11-06T00:02:00+08:00');
 assert.equal(transactionSelection(b,{page:'transactions'},f,'',before).length,1);
 assert.equal(transactionSelection(b,{page:'transactions'},f,'',after).length,2);
});
