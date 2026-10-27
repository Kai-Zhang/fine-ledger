import { resolve } from 'node:path';
import { createSnapshot, restoreArchive } from '../lib/recovery.mjs';
const [command,archive,snapshot,target]=process.argv.slice(2);
if(!archive || !snapshot) throw Error('用法：node scripts/recovery.mjs snapshot <恢复目录> <快照文件> 或 restore <恢复目录> <旧快照> <新数据库>');
if(command==='snapshot') console.log(JSON.stringify(createSnapshot(resolve(archive),resolve(snapshot)),null,2));
else if(command==='restore' && target) console.log(JSON.stringify(restoreArchive(resolve(archive),resolve(snapshot),resolve(target)),null,2));
else throw Error('无效命令；恢复只允许写入不存在的新数据库');
