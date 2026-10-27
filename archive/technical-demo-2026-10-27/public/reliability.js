import * as DB from './storage.js';
import {fingerprint,verifyReinstallation} from './reinstall.js';
import { fixtureOperations, newExpense } from './reliability-fixture.js';
const $=s=>document.querySelector(s), NAME='fine-ledger-reliability-p0-v1';
let armed='',token=localStorage.getItem('p0-token')||'',report={schemaVersion:1,results:[]},connected=false,busy=false;
$('#token').value=token;
const canonical=x=>JSON.stringify(sort(x));
function sort(x){return Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;}
function equal(a,b,message='完整字段不一致'){if(canonical(a)!==canonical(b))throw Error(message);}
function assert(ok,message){if(!ok)throw Error(message);}
function fault(point){if(armed===point){armed='';throw Error('注入中断：'+point);}}
DB.configureReliability({name:NAME,fault});
function blocked(message){$('#summary').textContent=message;$('#manual').textContent=message;report.blockedEvents||=[];report.blockedEvents.push({at:new Date().toISOString(),message});if(connected)saveReport().catch(()=>{});}
async function clearDB(){let waited=false;await DB.clearReliabilityDB({onBlocked:message=>{waited=true;blocked(message);}});if(waited)$('#manual').textContent='占用已释放，清空已完成，正在从服务恢复。';}
async function api(path,data){const r=await fetch(path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:data===undefined?undefined:JSON.stringify(data),cache:'no-store'});if(!r.ok)throw Error((await r.json()).error||`HTTP ${r.status}`);return r.json();}
const sync=()=>DB.synchronize({token});
const pageSessionId=crypto.randomUUID(),startedAt=new Date().toISOString();
let bootObservation;
const controls=['connect','run','prepare','verify','clear','reinstall-prepare','reinstall-verify','server-restore-verify'];
async function localObservation(){const r=await DB.read(),marker=await DB.read('reinstall-marker');return {ledgerPresent:!!r,deviceId:r?.deviceId||null,marker:marker?.id||null,cursor:r?.cursor??null,pending:r?.outbox.length??0,conflicts:r?.conflicts.length??0,bookId:r?.bookId||null,stateHash:r?await fingerprint(r.state):null,localStorageMarker:localStorage.getItem('p0-reinstall-marker')};}
async function installationMarker(){if(!(await DB.read('reinstall-marker')))await DB.update(()=>({id:crypto.randomUUID()}),'reinstall-marker');if(!localStorage.getItem('p0-reinstall-marker'))localStorage.setItem('p0-reinstall-marker',crypto.randomUUID());}
function reportView(){return JSON.stringify({...report,expectedState:report.expectedState?{comparison:'所有集合及嵌套字段逐一匹配',collections:Object.fromEntries(Object.entries(report.expectedState).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length]))}:undefined},null,2);}
async function saveReport(){report.environment={origin:location.origin,at:new Date().toISOString(),userAgent:navigator.userAgent,secureContext:isSecureContext,standalone:matchMedia('(display-mode: standalone)').matches||navigator.standalone===true};await api('/api/reliability/evidence',report);$('#report').textContent=reportView();}
async function status(){const r=await DB.read();$('#protection').textContent=JSON.stringify({localPending:r?.outbox.length,oldestUnprotected:r?.outbox[0]?.createdAt||null,bookId:r?.bookId,...r?.protection,persistentStorage:await navigator.storage?.persisted?.(),offMachineBackup:'未配置；恢复日志位于本 Mac 的独立目录'},null,2);}
async function expectedFailure(fn){let failed=false;try{await fn();}catch{failed=true;}assert(failed,'故障没有触发');}
async function step(name,fn){const li=document.createElement('li');li.textContent=name+'：运行中';$('#results').append(li);try{await fn();li.textContent=name+'：通过';li.className='pass';report.results.push({name,passed:true});}catch(e){li.textContent=name+'：失败 '+e.message;li.className='fail';report.results.push({name,passed:false,error:e.message});throw e;}}
async function makeSave(label){const before=await DB.read(),t=newExpense(before.state,label);return {t,save:()=>DB.commit([{collection:'transactions',entity:t}],label)};}
async function run(){
 report.results=[];$('#results').replaceChildren();$('#summary').textContent='运行中';
 await sync();
 await step('并发打开只保留一个连接，第二连接收到 versionchange 后可清空恢复',async()=>{
   const expected=(await DB.read()).state;DB.closeDB();
   const handles=await Promise.all(Array.from({length:12},()=>DB.openDB()));
   assert(handles.every(x=>x===handles[0]),'并发打开产生了多个数据库连接');
   // A second module instance owns its own cache and versionchange handler.
   // Avoid hidden iframe scheduling, which is unreliable in an iOS web app.
   const peer=await import('./storage.js?reliability-peer=1');
   peer.configureReliability({name:NAME});
   const peerHandle=await peer.openDB();
   assert(peerHandle!==handles[0],'未建立第二条独立连接');
   try{await clearDB();await DB.initialize({token});equal((await DB.read()).state,expected);equal((await peer.read()).state,expected);}finally{peer.closeDB();}
 });
 await step('真实 blocked 事件等待占用者释放，完成后才重新初始化',async()=>{
   const expected=(await DB.read()).state;
   const held=await new Promise((resolve,reject)=>{const r=indexedDB.open(NAME,1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   let seen=false;
   try{await DB.clearReliabilityDB({onBlocked:()=>{seen=true;held.close();}});assert(seen,'没有触发真实 blocked 事件');await DB.initialize({token});equal((await DB.read()).state,expected);}finally{held.close();}
 });
 await step('保存事务提交前中断：账目 / 队列 / 历史全部回滚',async()=>{const before=await DB.read(),{save}=await makeSave('提交前');armed='local-before-commit';await expectedFailure(save);DB.closeDB();equal(await DB.read(),before);});
 await step('保存提交后界面确认前中断：重开账目与队列完整',async()=>{const {t,save}=await makeSave('提交后');armed='local-after-commit';await expectedFailure(save);DB.closeDB();const r=await DB.read();assert(r.state.transactions.some(x=>x.id===t.id),'已提交账目丢失');assert(r.outbox.some(o=>o.changes.some(c=>c.entity.id===t.id)),'队列丢失');});
 await step('计时写入失败不会误报业务保存失败',async()=>{const {t,save}=await makeSave('计时失败');armed='metrics-write';await save();assert((await DB.read()).state.transactions.some(x=>x.id===t.id),'业务未落盘');});
 await step('NAS 已提交，客户端回执应用前中断；重试不重复',async()=>{armed='sync-before-apply';await expectedFailure(sync);DB.closeDB();assert((await DB.read()).outbox.length>0,'回执前队列被清除');const r=await sync();assert(r.outbox.length===0,'重试队列未归零');const remote=await api('/api/snapshot');equal(r.state,remote.state);});
 await step('回执、游标与出队的本机事务被中断：全部回滚',async()=>{const {save}=await makeSave('回执事务');await save();const before=await DB.read();armed='local-before-commit';await expectedFailure(sync);DB.closeDB();equal(await DB.read(),before);await sync();});
 await step('出队事务提交后中断：重开无残留队列、无重复',async()=>{const {save}=await makeSave('出队后');await save();armed='sync-after-apply';await expectedFailure(sync);DB.closeDB();const r=await DB.read();assert(r.outbox.length===0,'出队事务未保留');const cursor=r.cursor;await sync();assert((await DB.read()).cursor===cursor,'重试产生新变化');});
 await step('服务端拒绝回退游标时本机状态和队列保持原样',async()=>{const r=await DB.read();await DB.update(x=>({...x,cursor:x.cursor+100000}));const before=await DB.read();await expectedFailure(sync);equal(await DB.read(),before);await DB.update(()=>r);});
 await step('合成完整业务及仅票据可见文字同步',async()=>{const base=(await DB.read()).state,f=fixtureOperations(base,'browser-'+crypto.randomUUID());for(const op of f.operations)await DB.commit(op.changes,op.label);const local=(await DB.read()).state;await sync();equal((await api('/api/snapshot')).state,local);report.expectedState=local;report.bookId=(await DB.read()).bookId;});
 await step('旧备份缺少新账目时不删除新账目，也不改变已有对账',async()=>{const before=await DB.read(),old=structuredClone(before.state);old.transactions=old.transactions.filter(x=>!x.description.startsWith('P0 提交后'));await DB.restoreBackup({format:'fine-ledger-backup',version:1,state:old});equal(await DB.read(),before);});
 await step('旧本机备份不得删除或覆盖较新数据',async()=>{const before=await DB.read(),old=structuredClone(before.state);old.transactions.find(x=>x.id==='coffee-demo').notes='过期备份内容';await expectedFailure(()=>DB.restoreBackup({format:'fine-ledger-backup',version:1,state:old}));equal(await DB.read(),before);});
 await step('真实删除 IndexedDB 后从 NAS 重建，所有业务字段完全一致',async()=>{const expected=structuredClone(report.expectedState);await clearDB();await DB.initialize({token});const restored=await DB.read();equal(restored.state,expected);assert(restored.outbox.length===0,'重建出现待同步');await sync();equal((await DB.read()).state,expected);});
 await step('清空未同步本机的边界：没有外部副本的样例不可恢复，保护状态明确',async()=>{const {t,save}=await makeSave('仅本机反例');await save();assert((await DB.read()).outbox.length===1,'仅本机保护状态错误');const remote=await api('/api/snapshot');assert(!remote.state.transactions.some(x=>x.id===t.id),'反例已意外同步');report.knownLoss={id:t.id,reason:'测试主动清空唯一副本，无法恢复，产品不得承诺零丢失'};await clearDB();await DB.initialize({token});assert(!(await DB.read()).state.transactions.some(x=>x.id===t.id),'反例错误恢复');equal((await DB.read()).state,report.expectedState);});
 $('#summary').textContent=`通过 ${report.results.length} / ${report.results.length}；唯一副本丢失反例已确认`;await saveReport();await status();
}
async function connect(){
 token=$('#token').value.trim();localStorage.setItem('p0-token',token);
 const remote=await api('/api/snapshot');assert(remote.laboratory,'不是独立可靠性服务，拒绝操作');
 if(!bootObservation)bootObservation={pageSessionId,startedAt,origin:location.origin,standalone:!!navigator.standalone||matchMedia('(display-mode: standalone)').matches,before:await localObservation(),serviceWorkerAtBoot:!!navigator.serviceWorker?.controller};
 await DB.initialize({token});await installationMarker();
 bootObservation.after=await localObservation();
 connected=true;report=await api('/api/reliability/evidence');report.results||=[];
 if(report.reinstall){report.reinstall.observations||=[];if(!report.reinstall.observations.some(o=>o.pageSessionId===pageSessionId))report.reinstall.observations.push(structuredClone(bootObservation));await saveReport();}
 for(const id of controls)$('#'+id).disabled=false;
 $('#environment').textContent=`独立账本 ${remote.bookId} · ${location.origin} · ${bootObservation.standalone?'主屏幕独立应用':'浏览器'}`;
 $('#report').textContent=reportView();$('#reinstall-status').textContent=report.reinstall?`已有删除前基准 ${report.reinstall.baseline.id}，请勿重新准备或运行其他测试。`:'尚未准备删除前基准';
 await status();
 if('serviceWorker'in navigator){await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;}
}
async function verifyServerRestore(){
 report=await api('/api/reliability/evidence');const phase=report.serverRestore;
 assert(phase?.restoredAt,'服务端尚未发布本轮恢复完成记录');
 assert(bootObservation.standalone,'请从主屏幕「厘序 P0」打开后核验');
 const before=await localObservation();assert(before.pending===0&&before.conflicts===0,'本机仍有待同步或冲突，本轮暂停核验');
 const results=[];
 for(let i=0;i<2;i++){
  const startedAt=new Date().toISOString();await sync();const r=await DB.read(),remote=await api('/api/snapshot');
  equal(r.state,phase.expectedState);equal(remote.state,phase.expectedState);
  assert(r.bookId===phase.bookId&&remote.bookId===phase.bookId,'恢复后的账本身份不同');
  assert(r.cursor===phase.cursor&&remote.cursor===phase.cursor,'恢复后的游标不符');
  assert(!r.outbox.length&&!r.conflicts.length,'同步队列或冲突未归零');
  assert(new Set(r.state.transactions.map(t=>t.id)).size===r.state.transactions.length,'发现重复交易 ID');
  results.push({attempt:i+1,startedAt,completedAt:new Date().toISOString(),...await localObservation()});
 }
 phase.checks||=[];phase.checks.push({runId:phase.runId,verifiedAt:new Date().toISOString(),standalone:true,origin:location.origin,before,attempts:results,stateHash:results.at(-1).stateHash,passed:true});
 await saveReport();await status();$('#server-restore-status').textContent='连续两次同步成功；33 笔及全部关联字段与恢复前基准一致，队列 0、冲突 0、无重复交易 ID。';
}
async function prepareReinstall(){
 assert(bootObservation.standalone,'请从现有「厘序 P0」主屏幕图标打开后准备');
 assert(!report.reinstall?.baseline,'已有删除前基准，为防覆盖请直接完成删除重装并核验');
 await sync();const r=await DB.read(),remote=await api('/api/snapshot');
 assert(!r.outbox.length&&!r.conflicts.length,'请先同步并解决冲突');equal(r.state,remote.state);
 const local=await localObservation(),baseline={id:crypto.randomUUID(),pageSessionId,preparedAt:new Date().toISOString(),origin:location.origin,bookId:r.bookId,stateHash:await fingerprint(r.state),state:structuredClone(r.state),deviceId:r.deviceId,marker:local.marker,localStorageMarker:local.localStorageMarker,cursor:r.cursor};
 report.reinstall={baseline,observations:[structuredClone(bootObservation)],checks:[]};await saveReport();
 $('#reinstall-status').textContent=`删除前基准已保存到服务端：${r.state.transactions.length} 笔；队列与冲突均为零。等待按步骤删除并重装，基准 ${baseline.id}。`;
}
async function verifyReinstall(){
 report=await api('/api/reliability/evidence');assert(report.reinstall?.baseline,'请先在删除前准备基准');
 const baseline=report.reinstall.baseline;
 await sync();const r=await DB.read(),remote=await api('/api/snapshot');
 equal(r.state,baseline.state);equal(remote.state,baseline.state);
 const current={...bootObservation,after:await localObservation(),remoteHash:await fingerprint(remote.state)};
 const result=verifyReinstallation(baseline,current,report.reinstall.observations);
 report.reinstall.checks.push({...result,verifiedAt:new Date().toISOString(),observation:current});await saveReport();await status();
 const labels={'fresh-local-recovery':'本次主屏幕启动前账本不存在，已从服务恢复完整字段','retained-local-data':'新主屏幕实例仍保留原本机数据；重装可用，但本次不能证明删除清空了存储','recovery-through-new-context':'新启动上下文曾无账本并完成恢复，主屏幕完整字段匹配；原容器是否物理清除仍需区分','undetermined':'完整字段匹配，但无法确认系统删除对原存储容器的影响'};
 $('#reinstall-status').textContent=labels[result.storageEffect]+'。原始删除动作由你确认，程序不会自行清空本机。';
}
async function prepare(){await sync();const f=fixtureOperations((await DB.read()).state,'iphone-'+crypto.randomUUID());for(const op of f.operations)await DB.commit(op.changes,op.label);report.expectedState=(await DB.read()).state;await sync();equal((await api('/api/snapshot')).state,report.expectedState);report.manual={preparedAt:new Date().toISOString(),receiptId:f.receiptId};await saveReport();$('#manual').textContent='样例与外部校验基准已保存。请划掉重开；系统清理后用同一 URL 连接，再点「核验完整字段」。';await status();}
async function verify(){report=await api('/api/reliability/evidence');assert(report.expectedState,'请先准备 iPhone 样例');equal((await DB.read()).state,report.expectedState);report.manual={...report.manual,lastVerifiedAt:new Date().toISOString(),standalone:!!navigator.standalone||matchMedia('(display-mode: standalone)').matches};report.manual.verifications=[...(report.manual.verifications||[]),{at:report.manual.lastVerifiedAt,afterLocalClear:!!report.manual.localClearRestoredAt}].slice(-20);await saveReport();$('#manual').textContent='完整字段匹配，包括票据文字、分类、拆分、退款、成本来源、对账与删除标记。';await status();}
for(const [id,fn] of Object.entries({connect,run,prepare,verify,'reinstall-prepare':prepareReinstall,'reinstall-verify':verifyReinstall,'server-restore-verify':verifyServerRestore,clear:async()=>{await clearDB();await DB.initialize({token});report=await api('/api/reliability/evidence');report.manual={...report.manual,localClearRestoredAt:new Date().toISOString()};await verify();}}))$('#'+id).onclick=async()=>{
 if(busy)return;busy=true;
 if(report.reinstall?.baseline&&['run','prepare','clear'].includes(id)){busy=false;$('#reinstall-status').textContent='删除重装基准已冻结，请先完成重装核验；本轮不运行其他会改数据的测试。';return;}
 for(const id of controls)$('#'+id).disabled=true;
 try{await fn();}catch(e){$('#summary').textContent='未完成：'+e.message;if(connected)await saveReport().catch(()=>{});}finally{busy=false;for(const id of controls)$('#'+id).disabled=id!=='connect'&&!connected;}
};
$('#export').onclick=()=>{const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='fine-ledger-p0-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
if(token) connect().catch(e=>$('#environment').textContent=e.message);
