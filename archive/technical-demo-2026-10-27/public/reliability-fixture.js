import { today, uid, makeRefundPart, validateState } from './domain.js';
// All values here are synthetic; exact receipt text is intentionally unreconstructable
// from a bank statement, so testing just balances cannot satisfy this oracle.
export function fixtureOperations(base, run='p0') {
  const date=today(), state=structuredClone(base), operations=[];
  function add(label,rows) {
    const changes=rows.map(([collection,entity])=>{
      const old=state[collection].find(x=>x.id===entity.id);
      return {collection,baseRevision:old?.revision||0,entity:{...entity,revision:(old?.revision||0)+1,updatedAt:'2026-10-27T00:00:00.000Z'}};
    });
    for(const c of changes) {const i=state[c.collection].findIndex(x=>x.id===c.entity.id);if(i<0)state[c.collection].push(c.entity);else state[c.collection][i]=c.entity;}
    validateState(state);
    const op={id:`${run}-op-${operations.length+1}`,deviceId:'synthetic-p0',createdAt:'2026-10-27T00:00:00.000Z',label,changes};operations.push(op);return op;
  }
  const expense={id:`${run}-receipt`,type:'expense',amount:'12345',currency:'CNY',date,description:'P0 合成票据采购',notes:'原始票据 #R-只有票据可见\n手写分类：餐食 23.45 + 工具 100.00\n商户：合成商户 / 🧾 café',state:'posted',postings:[{id:`${run}-posting`,accountId:'bank-cny',amount:'-12345',date}],splits:[{id:`${run}-s1`,amount:'2345',categoryId:'meal',projectId:'japan'},{id:`${run}-s2`,amount:'10000',categoryId:'daily',projectId:null}]};
  const foreign=['usd-40','usd-60'].map(id=>{const t=structuredClone(base.transactions.find(x=>x.id===id));t.id=`${run}-${id}`;t.notes='合成外币原始票据 '+run;t.postings=t.postings.map(p=>({...p,id:`${run}-${p.id}`}));t.splits=t.splits.map(p=>({...p,id:`${run}-${p.id}`}));return t;});
  add('票据完整字段', [['transactions',expense],...foreign.map(t=>['transactions',t])]);
  add('票据分类修正',[['transactions',{...state.transactions.find(x=>x.id===expense.id),notes:expense.notes+'\n修订：工具归属旅行项目',splits:[expense.splits[0],{...expense.splits[1],projectId:'japan'}]}]]);
  const transfer={id:`${run}-repayment`,type:'transfer',amount:'72000',currency:'CNY',date,description:'P0 外币还款',notes:'合成汇兑凭据',state:'posted',splits:[],postings:[{id:`${run}-from`,accountId:'bank-cny',amount:'-72000',date},{id:`${run}-to`,accountId:'cc-usd',amount:'10000',date}]};
  const source={id:`${run}-cost`,transactionId:transfer.id,accountId:'cc-usd',currency:'USD',principal:'10000',cny:'72000',date,allocations:[{transactionId:`${run}-usd-40`,amount:'4000',cny:'28800'},{transactionId:`${run}-usd-60`,amount:'6000',cny:'43200'}]};
  add('还款与成本原子聚合',[['transactions',transfer],['sources',source]]);
  const original=state.transactions.find(x=>x.id===expense.id);
  const refund={id:`${run}-refund`,type:'refund',amount:'1234',currency:'CNY',date,state:'posted',description:'P0 票据部分退款',notes:'退货凭据 #ONLY-RECEIPT-02',postings:[{id:`${run}-refund-p`,accountId:'bank-cny',amount:'1234',date}],splits:[],refunds:[makeRefundPart(state,original,original.splits[1],'1234','1234')]};
  add('退款关联与对账',[['transactions',refund],['sessions',{id:`${run}-session`,accountId:'bank-usd',cutoff:date,external:'0',status:'completed',checked:[],notes:'P0 对账原始结论'}],['legacy',{...state.legacy[0],deleted:true}]]);
  return {operations,expected:structuredClone(state),receiptId:expense.id};
}
export function newExpense(base, label='中断保存') {
 const t=structuredClone(base.transactions.find(t=>t.id==='coffee-demo'));
 t.id=uid();t.description='P0 '+label;t.notes='仅原始票据存在：'+uid();t.postings[0].id=uid();t.splits[0].id=uid();
 return t;
}
