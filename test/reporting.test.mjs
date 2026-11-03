import test from 'node:test';
import assert from 'node:assert/strict';
import {blankBook,balance,netWorth,rateFor,categoryStats} from '../src/domain/ledger.ts';
import {endOfDay,startOfDay,dateOffset} from '../src/domain/dates.ts';
import {reportIndex,calculateReport,reportRange,reportRangeLabel,reportAccounts} from '../src/domain/reporting.ts';
function fixture(){
 const book=blankBook();book.timeZone='America/New_York';
 book.accounts=['CNY','JPY','USD','EUR'].map((currency,i)=>({id:currency,name:currency,currency,groupId:i%2?'credit':'daily',type:'bank',openingAt:'2024-03-01T00:00:00Z',openingMinor:i?'0':'9007199254740993123',icon:'Wallet',order:i,archived:i===1,netWorth:true}));
 const row=(id,kind,accountId,amountMinor,occurredAt,extra={})=>({id,kind,accountId,amountMinor,occurredAt,createdAt:occurredAt,updatedAt:occurredAt,description:id,posted:true,revision:0,splits:kind==='expense'||kind==='refund'?[{id:id+'s',categoryId:'food-0',amountMinor}]:[],...extra});
 book.entries=[
 row('anchor1','transfer','CNY','10000','2024-03-09T00:00:00Z',{toAccountId:'JPY',receivedMinor:'2000',receivedAt:'2024-03-10T07:00:00.000001Z'}),
 row('chain','transfer','JPY','400','2024-03-11T12:00:00Z',{toAccountId:'USD',receivedMinor:'200'}),
 row('expense','expense','JPY','500','2024-03-10T07:00:00.000002Z'),
 row('refund','refund','USD','100','2024-03-12T12:00:00Z',{originalId:'expense'}),
 row('anchor2','transfer','CNY','12000','2024-03-15T00:00:00Z',{toAccountId:'JPY',receivedMinor:'2000'}),
 row('unpriced','income','EUR','100','2024-03-15T00:00:00Z'),
 row('pending','expense','CNY','500','2024-03-13T00:00:00Z',{posted:false}),
 row('removed','expense','CNY','500','2024-03-13T00:00:00Z',{deletedAt:'2024-03-14T00:00:00Z'}),
 row('adjust','adjustment','CNY','-123','2024-03-13T00:00:00Z'),
 ];return book;
}
function equalNet(index,book,at){const ids=book.accounts.map(a=>a.id),expected=netWorth(book,at,ids),actual=index.netAt(ids,at);assert.equal(actual.total,expected.total);assert.equal(actual.provisional,expected.provisional);assert.deepEqual(actual.missing,expected.missing.map(m=>({accountId:m.account.id,amount:m.amount})));for(const a of book.accounts){assert.equal(actual.balances[a.id],balance(book,a.id,at));assert.deepEqual(index.rate(a.id,at),rateFor(book,a.id,at));}}
test('indexed reports retain exact ledger rules across DST, microseconds, pending/deleted entries, adjustments, chained rates and unpriced balances',()=>{
 const b=fixture(),copy=structuredClone(b),index=reportIndex(b);
 for(const at of ['2024-02-28T00:00:00Z','2024-03-10T07:00:00Z','2024-03-10T07:00:00.000001Z','2024-03-10T07:00:00.000002Z','2024-03-16T00:00:00Z'])equalNet(index,b,at);
 for(let d='2024-03-01';d<='2024-03-31';d=dateOffset(d,1))equalNet(index,b,endOfDay(d,b.timeZone));
 assert.deepEqual(b,copy);
});
test('indexed rates preserve cycle detection and skip an unusable future anchor before using the last fallback',()=>{
 const b=fixture();b.entries=b.entries.filter(e=>e.kind!=='transfer');
 const anchor=(id,from,to,date)=>({id,kind:'transfer',accountId:from,toAccountId:to,amountMinor:'100',receivedMinor:'100',occurredAt:date,posted:true});
 b.entries.push(anchor('cycle1','JPY','USD','2024-03-01T00:00:00Z'),anchor('cycle2','USD','JPY','2024-03-02T00:00:00Z'),anchor('valid','CNY','JPY','2024-03-03T00:00:00Z'));
 const index=reportIndex(b);for(const at of ['2024-02-01T00:00:00Z','2024-03-02T00:00:00Z','2024-04-01T00:00:00Z'])equalNet(index,b,at);
});
test('daily points use local end-of-day, current instant today and a separate pre-range baseline; expense totals match the ledger',()=>{
 const b=fixture(),ids=b.accounts.map(a=>a.id),now='2024-03-16T12:00:00Z';
 const request={book:b,type:'net',from:'2024-03-09',to:'2024-03-16',ids,categoryIds:[],now};
 const r=calculateReport(request);assert.equal(r.points.length,8);assert.equal(r.baseline,netWorth(b,endOfDay('2024-03-08',b.timeZone),ids).total);
 for(const p of r.points)assert.equal(p.total,netWorth(b,p.date==='2024-03-16'?now:endOfDay(p.date,b.timeZone),ids).total);
 const e=calculateReport({...request,type:'expense'});assert.deepEqual(e.stats,categoryStats(b,startOfDay(request.from,b.timeZone),endOfDay(request.to,b.timeZone),ids,[]));
 assert.throws(()=>calculateReport({...request,from:'2025-01-01'}),/结束日期/);
});
test('calendar presets include leap dates, last calendar year and earliest history in book timezone',()=>{
 const b=fixture();b.timeZone='Asia/Shanghai';const now='2024-03-31T16:30:00Z';
 assert.deepEqual(reportRange(b,'6months',now),{from:'2023-10-02',to:'2024-04-01'});
 assert.deepEqual(reportRange(b,'12months',now),{from:'2023-04-02',to:'2024-04-01'});
 assert.deepEqual(reportRange(b,'lastYear',now),{from:'2023-01-01',to:'2023-12-31'});
 assert.deepEqual(reportRange(b,'all',now),{from:'2024-03-01',to:'2024-04-01'});
 assert.equal(reportRange(b,'6months','2024-08-31T00:00:00Z').from,'2024-03-01');
 for(const [value,label] of [['6months','近 6 个月'],['12months','近 12 个月'],['lastYear','去年'],['all','所有时间']])assert.equal(reportRangeLabel(value),label);
});
test('report account selection follows home group/order while placing every archived account last',()=>{
 const b=fixture();b.accounts[3].archived=true;b.accounts[2].groupId='';const copy=structuredClone(b.accounts);
 assert.deepEqual(reportAccounts(b).map(a=>a.id),['USD','CNY','JPY','EUR']);assert.deepEqual(b.accounts,copy);
});
test('ten years of daily reports retain all daily values for 16000 source rows',()=>{
 const b=fixture();b.accounts=b.accounts.slice(0,1);b.accounts[0].openingMinor='100000';b.accounts[0].openingAt='2016-11-01T00:00:00Z';
 b.entries=Array.from({length:16000},(_,i)=>({id:String(i),kind:'income',accountId:'CNY',amountMinor:'1',occurredAt:new Date(Date.UTC(2016,10,1)+Math.floor(i/5)*86400000).toISOString(),posted:true,splits:[]}));
 const r=calculateReport({book:b,type:'net',from:'2016-11-01',to:'2026-11-01',ids:['CNY'],categoryIds:[],now:'2026-11-02T00:00:00Z'});
 assert.equal(r.points.length,3653);assert.equal(r.points.at(-1).total,116000n);assert.equal(r.points[0].total,balance(b,'CNY',endOfDay('2016-11-01',b.timeZone)));
});
