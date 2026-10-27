import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprint,verifyReinstallation} from '../public/reinstall.js';
const baseline={pageSessionId:'old-page',preparedAt:'2026-10-27T12:00:00Z',origin:'https://lab.example:8444',bookId:'book',stateHash:'full-payload',deviceId:'original-device',marker:'original-marker'};
const boot=()=>({pageSessionId:'new-page',startedAt:'2026-10-27T12:02:00Z',origin:baseline.origin,standalone:true,before:{ledgerPresent:false},after:{bookId:'book',stateHash:'full-payload',pending:0,conflicts:0},remoteHash:'full-payload'});
test('reinstall: exact nested state fingerprint includes receipt notes and is stable across object-key ordering',async()=>{
 assert.equal(await fingerprint({receipt:{notes:'票据原文',category:'c'},amount:'100'}),await fingerprint({amount:'100',receipt:{category:'c',notes:'票据原文'}}));
 assert.notEqual(await fingerprint({notes:'票据原文',amount:'100'}),await fingerprint({notes:'票据原文丢失',amount:'100'}));
});
test('reinstall: distinguish genuine fresh initialization from retained original local data',()=>{
 assert.equal(verifyReinstallation(baseline,boot()).storageEffect,'fresh-local-recovery');
 const kept=boot();kept.before={ledgerPresent:true,deviceId:'original-device',marker:'original-marker'};
 assert.equal(verifyReinstallation(baseline,kept).storageEffect,'retained-local-data');
 const unknown=boot();unknown.before={ledgerPresent:true,deviceId:'other',marker:'other'};
 assert.equal(verifyReinstallation(baseline,unknown).storageEffect,'undetermined');
 assert.equal(verifyReinstallation(baseline,unknown,[boot()]).storageEffect,'recovery-through-new-context');
});
test('reinstall: icon/relaunch alone, wrong origin/book, missing receipt payload or unsent queue cannot pass',()=>{
 for(const patch of [{pageSessionId:'old-page'},{origin:'https://lab.example:8443'},{standalone:false},{after:{...boot().after,bookId:'other'}},{after:{...boot().after,stateHash:'lost-note'}},{remoteHash:'different'},{after:{...boot().after,pending:1}},{after:{...boot().after,conflicts:1}}])assert.throws(()=>verifyReinstallation(baseline,{...boot(),...patch}));
});
