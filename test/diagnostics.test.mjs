import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnostic} from '../server/diagnostics.ts';
test('diagnostics retain storage error codes and source frames without messages or secrets',()=>{
 const error=Object.assign(Error('password private financial SQL'),{code:'ENOSPC',errcode:13,stack:'Error: secret-token\n at fail (/app/server/store.ts:70:4)\n at /private/user-folder/secret.js:3:4',cookie:'sensitive',sql:'secret'});
 const record=diagnostic(error,{operation:'request',requestId:'req-1',route:'/api/v1/sync/push'});
 assert.equal(record.code,'ENOSPC');assert.equal(record.sqliteCode,13);assert.deepEqual(record.frames,['/server/store.ts:70:4']);
 const text=JSON.stringify(record);for(const secret of ['password','financial','secret','cookie','private'])assert(!text.includes(secret));
 assert.equal(diagnostic({code:'user secret'},{operation:'backup-create'}).code,'UNEXPECTED_ERROR');
});
