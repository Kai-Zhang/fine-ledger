import test from 'node:test';
import assert from 'node:assert/strict';
import {blankBook, balance, categoryStats} from '../src/domain/ledger.ts';
import {calculateReport, reportPeriods, reportRows, reportGrains} from '../src/domain/reporting.ts';
import {startOfDay,endOfDay} from '../src/domain/dates.ts';
import {validateBook} from '../src/sync/protocol.ts';
import {exampleBook} from '../src/domain/example.ts';
function fixture(){
 const b=blankBook(); b.timeZone='Asia/Shanghai';
 b.accounts=['CNY','JPY','EUR'].map((currency,i)=>({id:currency,name:currency,currency,type:i===1?'credit':'bank',groupId:'daily',openingMinor:i?'0':'1000000',openingAt:'2023-12-31T00:00:00Z',icon:'Wallet',order:i,archived:false,netWorth:true}));
 b.projects=[{id:'A',name:'日本之旅',archived:false},{id:'B',name:'其他旅行',archived:true}];
 const row=(id,kind,amount,day,extra={})=>({id,kind,accountId:'CNY',amountMinor:String(amount),description:id,occurredAt:day,posted:true,createdAt:day,updatedAt:day,revision:0,splits:[{id:id+'-s',categoryId:kind==='income'?'earning-0':'food-0',amountMinor:String(amount),projectId:'A'}],...extra});
 b.entries=[row('flight','expense',300000,'2024-01-05T00:00:00Z'),row('hotel','expense',200000,'2024-02-05T00:00:00Z'),row('food','expense',100000,'2024-02-06T00:00:00Z'),row('refund','refund',50000,'2024-03-05T00:00:00Z',{originalId:'hotel'}),row('salary','income',2000000,'2024-02-01T00:00:00Z'),row('pending','expense',10000,'2024-02-02T00:00:00Z',{posted:false}),row('deleted','expense',10000,'2024-02-02T00:00:00Z',{deletedAt:'2024-02-03T00:00:00Z'}),row('adjust','adjustment',123,'2024-02-03T00:00:00Z',{splits:[]}),row('transfer','transfer',10000,'2024-02-04T00:00:00Z',{toAccountId:'JPY',receivedMinor:'2000',receivedAt:'2024-02-05T00:00:00Z',splits:[]})];
 return b;
}
const request=(b,type,extra={})=>({book:b,type,from:'2024-01-01',to:'2024-03-31',ids:b.accounts.map(a=>a.id),categoryIds:[],now:'2025-01-01T00:00:00Z',...extra});
test('all calendar grains clip both ends, weeks begin Monday and cross-year weeks retain dates',()=>{
 assert.deepEqual(reportPeriods('2023-12-31','2024-01-03','week'),[{from:'2023-12-31',to:'2023-12-31',label:'2023-12-31'},{from:'2024-01-01',to:'2024-01-03',label:'2024-01-01 — 2024-01-03'}]);
 for(const [grain,count] of [['day',39],['week',7],['month',2],['quarter',1],['year',1]]){
  const p=reportPeriods('2024-02-03','2024-03-12',grain); assert.equal(p.length,count,grain); assert.equal(p[0].from,'2024-02-03');assert.equal(p.at(-1).to,'2024-03-12');
 }
 assert.equal(reportPeriods('2024-02-28','2024-03-01','day').length,3);
 assert.throws(()=>reportPeriods('2025-01-01','2024-01-01','month'),/结束日期/);
});
test('every flow report uses every grain and conserves income, expense, refunds and selected-range totals',()=>{
 const b=fixture(),copy=structuredClone(b);
 for(const type of ['income-trend','expense-trend','cashflow'])for(const {value:grain} of reportGrains){
  const r=calculateReport(request(b,type,{grain}));
  for(const key of ['expense','refund','income','net','surplus'])assert.equal(r.periods.reduce((n,p)=>n+p[key],0n),r.summary[key],`${type}/${grain}/${key}`);
  assert.equal(r.summary.expense,type==='income-trend'?0n:600000n);assert.equal(r.summary.refund,type==='income-trend'?0n:50000n);
  assert.equal(r.summary.income,type==='income-trend'||type==='cashflow'?2000000n:0n);
 }
 assert.deepEqual(b,copy);
});
test('project all-time refunds, multiple-project splits, category intersection and unassigned refund warnings do not double count',()=>{
 const b=fixture(); b.entries.push({...b.entries[0],id:'split',amountMinor:'100000',splits:[{id:'a',categoryId:'food-0',amountMinor:'60000',projectId:'A'},{id:'b',categoryId:'shopping-0',amountMinor:'40000',projectId:'B'}]});
 b.entries.push({...b.entries.find(e=>e.id==='refund'),id:'unknown',splits:[{id:'u',categoryId:'food-0',amountMinor:'50000'}]});
 const overview=calculateReport(request(b,'project',{grain:'month'}));assert.equal(overview.projects.get('A').net,610000n);assert.equal(overview.projects.get('B').net,40000n);
 const a=calculateReport(request(b,'project',{projectIds:['A'],grain:'month'}));assert.equal(a.summary.net,610000n);assert.deepEqual(a.unresolvedRefunds,['unknown']);
 assert.equal(calculateReport(request(b,'project',{projectIds:['A'],categoryIds:['shopping']})).summary.net,0n);
 assert.equal(calculateReport(request(b,'project',{projectIds:['A'],to:'2024-02-29'})).summary.refund,0n);
});
test('FX rounds the whole transaction once before filtering splits and uses the same allocation in category/project/trend/drilldown',()=>{
 const b=fixture();b.entries=[{...b.entries.find(e=>e.id==='transfer'),id:'anchor',amountMinor:'1',receivedMinor:'2'}, {...b.entries[0],id:'tiny',accountId:'JPY',amountMinor:'2',splits:[{id:'a',categoryId:'food-0',amountMinor:'1',projectId:'A'},{id:'b',categoryId:'shopping-0',amountMinor:'1',projectId:'B'}]}];
 for(const type of ['expense','expense-trend','project']){
  const all=calculateReport(request(b,type));assert.equal(all.summary.expense,1n);
  const a=calculateReport(request(b,type,{projectIds:['A']})),c=calculateReport(request(b,type,{projectIds:['B']}));assert.equal(a.summary.expense+c.summary.expense,1n);assert.equal(a.summary.expense,1n);assert.equal(c.summary.expense,0n);
  assert.equal(reportRows(request(b,type,{projectIds:['A']}))[0].amount,1n);
 }
 const s=categoryStats(b,startOfDay('2024-01-01',b.timeZone),endOfDay('2024-03-31',b.timeZone),['JPY'],[]);assert.equal(s.expense,1n);assert.equal([...s.values.values()].reduce((n,v)=>n+v,0n),1n);
 b.entries[1].splits.reverse();assert.equal(calculateReport(request(b,'project',{projectIds:['A']})).summary.expense,1n);
});
test('CNY-settled foreign purchases are counted once at actual account amount; missing rates never pretend to be zero',()=>{
 const b=fixture();b.entries=[{...b.entries[0],amountMinor:'10000',originalAmount:{currency:'JPY',amountMinor:'2000'},splits:[{id:'s',categoryId:'food-0',amountMinor:'10000'}]}, {...b.entries[0],id:'missing',accountId:'EUR',amountMinor:'12345',splits:[{id:'m',categoryId:'food-0',amountMinor:'12345'}]}];
 const r=calculateReport(request(b,'expense-trend',{grain:'month'}));assert.equal(r.summary.expense,10000n);assert.equal(r.summary.missingCount,1);assert.equal(r.periods[0].missingCount,1);assert.equal(r.missingCurrencies.get('EUR'),12345n);assert.equal(r.summary.missingExpenseCount,1);assert.equal(r.summary.missingIncomeCount,0);
 b.entries.push({...fixture().entries.find(e=>e.id==='transfer'),id:'price',toAccountId:'EUR',amountMinor:'20000',receivedMinor:'10000'});
 const repriced=calculateReport(request(b,'expense-trend'));assert.equal(repriced.summary.missingCount,0);assert.equal(repriced.summary.expense,34690n);
});
test('balance and net worth sample each period end instead of summing daily snapshots, with precise incoming transfer times',()=>{
 const b=fixture();for(const {value:grain} of reportGrains){
  const r=calculateReport(request(b,'balance',{ids:['JPY'],grain}));
  for(const p of r.periods)assert.equal(p.total,balance(b,'JPY',endOfDay(p.to,b.timeZone)));
  assert.equal(r.periods.at(-1).total,2000n);assert.equal(r.periods.at(-1).missingCount,0);
  const n=calculateReport(request(b,'net',{grain}));assert.equal(n.periods.length,r.periods.length);assert.equal(n.points.at(-1).date,'2024-03-31');
 }
 assert.throws(()=>calculateReport(request(b,'balance')),/一个账户/);
});
test('calendar buckets respect local midnight and DST rather than UTC days or 24-hour arithmetic',()=>{
 const b=fixture();b.timeZone='America/New_York';b.entries=[{...b.entries[0],occurredAt:'2024-03-10T04:59:59.999999Z',amountMinor:'100',splits:[{id:'a',categoryId:'food-0',amountMinor:'100'}]}, {...b.entries[0],id:'later',occurredAt:'2024-03-10T05:00:00Z',amountMinor:'200',splits:[{id:'b',categoryId:'food-0',amountMinor:'200'}]}];
 const r=calculateReport(request(b,'expense-trend',{from:'2024-03-09',to:'2024-03-11',grain:'day'}));assert.deepEqual(r.periods.map(p=>p.expense),[100n,200n,0n]);
});
test('refund-only periods retain negative net expense, empty periods zero, partial months and arbitrary huge integers stay exact',()=>{
 const b=fixture();b.entries=b.entries.filter(e=>e.kind==='refund');b.entries[0].amountMinor='9007199254740993123';b.entries[0].splits[0].amountMinor=b.entries[0].amountMinor;
 const r=calculateReport(request(b,'expense-trend',{from:'2024-02-03',to:'2024-03-12',grain:'month'}));assert.equal(r.periods[0].net,0n);assert.equal(r.periods[1].net,-9007199254740993123n);assert.equal(r.periods[1].to,'2024-03-12');assert.equal(r.summary.net,r.periods[1].net);assert.equal(r.periods[1].expenseCount,0);assert.equal(r.periods[1].refundCount,1);
});
test('new saved report fields validate precisely while old report configurations remain accepted',()=>{
 const b=exampleBook(),base={id:'report',name:'精确报表',type:'project',days:'all',from:'2024-01-01',to:'2024-12-31',accountIds:[b.accounts[0].id],categoryIds:[],projectIds:[b.projects[0]?.id||'none'],grain:'quarter',metric:'net',chart:'line'};
 b.settings.savedReports=[base];validateBook(b);
 for(const patch of [{grain:'decade'},{metric:'balance'},{chart:'pie'},{projectIds:'bad'},{type:'balance',accountIds:[]}])assert.throws(()=>validateBook({...b,settings:{...b.settings,savedReports:[{...base,...patch}]}}));
 b.settings.savedReports=[{id:'old',name:'旧报表',type:'net',days:'30',from:'2024-01-01',to:'2024-01-31',accountIds:[],categoryIds:[]}];validateBook(b);
});

test('stock reports do not duplicate accounts or project today into future periods',()=>{
 const b=fixture(),now='2024-02-06T12:00:00Z';
 const one=calculateReport(request(b,'net',{ids:['CNY'],now,grain:'month'}));
 const duplicate=calculateReport(request(b,'net',{ids:['CNY','CNY'],now,grain:'month'}));
 assert.equal(duplicate.points.at(-1).total,one.points.at(-1).total);
 assert.equal(one.periods.at(-1).to,'2024-02-06');assert.equal(one.periods.length,2);
 const future=calculateReport(request(b,'balance',{ids:['CNY'],from:'2024-04-01',to:'2024-04-30',now}));assert.equal(future.periods.length,0);
});

test('category and project reports keep the selected-range summary without time buckets, income trend includes only income',()=>{
 const b=fixture();
 for(const type of ['expense','income','project']){
  const month=calculateReport(request(b,type,{grain:'month'}));
  const day=calculateReport(request(b,type,{grain:'day'}));
  assert.deepEqual(day.periods,[]);
  assert.deepEqual(day.summary,month.summary);
  assert.ok(day.stats.values.size);
 }
 const trend=calculateReport(request(b,'income-trend',{grain:'quarter'}));
 assert.equal(trend.periods[0].income,2000000n);
 assert.equal(trend.periods[0].expense,0n);
 assert.equal(trend.periods[0].refund,0n);
});
