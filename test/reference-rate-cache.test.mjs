import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {cacheFresh,createReferenceRateCache} from '../src/reports/reference-rate-cache.ts';
const day='2026-11-05';
const quote=date=>({base:'CNY',quote:'USD',date,rate:0.14});
test('same-day cache retries later publication without discarding cached quotes',async t=>{
 let now=Date.parse(day+'T06:00:00Z'),calls=0;
 const cache=createReferenceRateCache('rates-'+crypto.randomUUID(),()=>now,async()=>{calls++;return new Response(JSON.stringify([quote(calls===1?'2026-11-04':day)]))});
 t.after(()=>cache.db.delete());
 const early=await cache.update('CNY','USD',2026,day);assert.equal(early.latestQuoteDate,'2026-11-04');
 await cache.update('CNY','USD',2026,day);assert.equal(calls,1);
 now+=3600001;
 const late=await cache.update('CNY','USD',2026,day);assert.equal(calls,2);assert.equal(late.latestQuoteDate,day);assert.equal(late.quotes.length,2);
});
test('empty responses, legacy rows and closed years have bounded freshness',()=>{
 const now=Date.parse(day+'T06:00:00Z'),row={key:'x',through:'2025-12-31',quotes:[quote('2025-12-31')],fetchedAt:now};
 assert(cacheFresh(row,row.through,now));assert(!cacheFresh(row,row.through,now+31*86400000));
 assert(!cacheFresh({...row,quotes:[]},row.through,now+3600001));
 assert(!cacheFresh({...row,fetchedAt:undefined},row.through,now));
 assert(!cacheFresh(row,row.through,now-1000));
});
test('concurrent refreshes share one request; 429 and offline preserve stored rates',async t=>{
 let now=Date.parse(day+'T06:00:00Z'),calls=0,mode='ok';
 const cache=createReferenceRateCache('rates-'+crypto.randomUUID(),()=>now,async()=>{calls++;if(mode==='offline')throw Error('offline');if(mode==='limited')return new Response('',{status:429,headers:{'Retry-After':'600'}});return new Response(JSON.stringify([quote('2026-11-04')]))});
 t.after(()=>cache.db.delete());
 await Promise.all([cache.update('CNY','USD',2026,day),cache.update('CNY','USD',2026,day)]);assert.equal(calls,1);
 now+=3600001;mode='limited';await assert.rejects(cache.update('CNY','USD',2026,day),/429/);
 await assert.rejects(cache.update('CNY','USD',2026,day),/暂不可用/);assert.equal(calls,2);
 now+=600001;mode='offline';await assert.rejects(cache.update('CNY','USD',2026,day),/offline/);
 assert.equal((await cache.years.get('CNY:USD:2026')).quotes.length,1);
});
