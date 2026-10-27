// Browser and Node share the acceptance rules. No browser deletion is performed here.
export const canonical = value => JSON.stringify(sort(value));
function sort(value) {return Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])):value;}
export async function fingerprint(state) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(state)));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
export function verifyReinstallation(baseline,current,observations=[]) {
  if(current.pageSessionId===baseline.pageSessionId)throw Error('请完成删除和重新安装，再从新的主屏幕实例核验');
  if(current.origin!==baseline.origin)throw Error('来源已改变，请使用删除前完全相同的 HTTPS 地址');
  if(!current.standalone)throw Error('请从重新添加的主屏幕图标打开后核验');
  if(current.after.bookId!==baseline.bookId)throw Error('连接的账本身份不同');
  if(current.after.stateHash!==baseline.stateHash||current.remoteHash!==baseline.stateHash)throw Error('完整字段与删除前基准不一致');
  if(current.after.pending||current.after.conflicts)throw Error('本机仍有待同步或冲突，不能判为完成');
  let storageEffect='undetermined';
  if(!current.before.ledgerPresent)storageEffect='fresh-local-recovery';
  else if(current.before.marker===baseline.marker&&current.before.deviceId===baseline.deviceId)storageEffect='retained-local-data';
  else if(observations.some(o=>o.origin===baseline.origin&&o.startedAt>baseline.preparedAt&&!o.before.ledgerPresent&&o.after.stateHash===baseline.stateHash))storageEffect='recovery-through-new-context';
  return {businessStateMatched:true,storageEffect,observedAt:current.startedAt,pageSessionId:current.pageSessionId,stateHash:current.after.stateHash,systemDeletionRequiresHumanConfirmation:true};
}
