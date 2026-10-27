import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { uid, today } from '../public/domain.js';

test('SQLite sync: atomic aggregates, lost response retry, conflicts, cursor, restart and auth', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fine-ledger-test-'));
  const port = 24000 + Math.floor(Math.random() * 10000), url = `http://127.0.0.1:${port}`;
  let child;
  const start = async (token = '') => {
    child = spawn(process.execPath, ['server.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), LEDGER_DB: join(dir, 'nas.sqlite'), LEDGER_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', b => { stderr += b; });
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('server startup timed out: ' + stderr)), 5000); child.once('exit', code => { clearTimeout(timer); reject(Error(`server exited ${code}: ${stderr}`)); }); child.stdout.on('data', b => { if (String(b).includes('Fine Ledger demo:')) { clearTimeout(timer); resolve(); } }); });
  };
  const stop = async () => { if (child && child.exitCode === null) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; } };
  t.after(async () => { await stop(); await rm(dir, { recursive: true, force: true }); });
  await start();
  const snapshot = await (await fetch(url + '/api/snapshot')).json();
  const sync = async (operations, cursor = 0, deviceId = 'test-device') => {
    const response = await fetch(url + '/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operations, cursor, deviceId }) });
    assert.equal(response.status, 200); return response.json();
  };
  const old = snapshot.state.transactions.find(t => t.id === 'coffee-demo');
  const operation = { id: uid(), changes: [{ collection: 'transactions', baseRevision: old.revision, entity: { ...old, description: 'device A edit', revision: old.revision + 1 } }] };
  const first = await sync([operation]);
  assert.deepEqual(first.acknowledged, [operation.id]); assert.equal(first.conflicts.length, 0); assert.equal(first.changes.length, 1);
  const retry = await sync([operation], 0);
  assert.deepEqual(retry.acknowledged, [operation.id]); assert.equal(retry.cursor, first.cursor); assert.equal(retry.state.transactions.filter(t => t.id === old.id).length, 1);
  const conflictOp = { id: uid(), changes: [{ collection: 'transactions', baseRevision: old.revision, entity: { ...old, description: 'device B edit', revision: old.revision + 1 } }] };
  const conflict = await sync([conflictOp], first.cursor, 'device-B');
  assert.equal(conflict.conflicts.length, 1); assert.equal(conflict.state.transactions.find(t => t.id === old.id).description, 'device A edit');
  assert.equal(conflict.conflicts[0].changes[0].entity.description, 'device B edit'); assert.equal(conflict.changes.length, 0);
  const id = uid(), transfer = { id, type: 'transfer', amount: '72000', currency: 'CNY', description: 'atomic repayment', date: today(), state: 'posted', revision: 1, splits: [], postings: [{ id: uid(), accountId: 'bank-cny', amount: '-72000', date: today() }, { id: uid(), accountId: 'cc-usd', amount: '10000', date: today() }] };
  const source = { id: uid(), transactionId: id, accountId: 'cc-usd', currency: 'USD', principal: '10000', cny: '72000', revision: 1, allocations: [] };
  const invalid = { id: uid(), changes: [{ collection: 'transactions', baseRevision: 0, entity: transfer }, { collection: 'sources', baseRevision: 0, entity: { ...source, cny: '1' } }] };
  const rejected = await sync([invalid]);
  assert.equal(rejected.conflicts.length, 1); assert.equal(rejected.state.transactions.some(t => t.id === id), false); assert.equal(rejected.state.sources.some(s => s.id === source.id), false);
  const valid = { id: uid(), changes: [{ collection: 'transactions', baseRevision: 0, entity: transfer }, { collection: 'sources', baseRevision: 0, entity: source }] };
  const accepted = await sync([valid], first.cursor);
  assert.equal(accepted.conflicts.length, 0); assert.equal(accepted.changes.length, 2); assert.equal(accepted.state.transactions.find(t => t.id === id).postings.length, 2);
  await stop(); await start('test-only-token');
  assert.equal((await fetch(url + '/api/snapshot')).status, 401);
  const after = await (await fetch(url + '/api/snapshot', { headers: { Authorization: 'Bearer test-only-token' } })).json();
  assert.equal(after.state.transactions.find(t => t.id === id).postings[0].amount, '-72000'); assert.equal(after.cursor, accepted.cursor);
});
