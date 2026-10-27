// Reuse the explicitly trusted test CA; keep the origin, DB, token and ports isolated.
import { mkdir, copyFile, chmod, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
const source=resolve('.local/iphone'),target=resolve('.local/reliability-iphone');
const command=process.argv[2]||'start';
if(!['start','stop','status','setup'].includes(command))throw Error('使用 start / stop / status / setup');
await mkdir(target,{recursive:true,mode:0o700});
for(const name of ['ca.pem','ca-key.pem','ca.cer','server.pem','server-key.pem']) {
 const dest=resolve(target,name);
 try{await access(dest);}catch{await copyFile(resolve(source,name),dest);await chmod(dest,0o600);}
}
const child=spawn(process.execPath,['scripts/iphone-demo.mjs',command],{env:{...process.env,IPHONE_DEMO_DIR:target,IPHONE_HTTPS_PORT:'8444',IPHONE_SETUP_PORT:'8181',IPHONE_BACKEND_PORT:'4176',LEDGER_RELIABILITY_TEST:'1',LEDGER_RECOVERY_DIR:resolve(target,'recovery-archive')},stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
child.once('exit',(code)=>process.exit(code??1));
