import https from 'node:https';
import { X509Certificate, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, open, unlink } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { serveStatic } from '../server.mjs';
import { buildPreview } from './build-preview.mjs';

const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), '..');
const certDir = path.resolve(process.env.IPHONE_CERT_DIR || path.join(root, '.local/iphone'));
const runtime = path.join(root, '.local/iphone-review');
const statePath = path.join(runtime, 'service.json');
const marker = 'p0-iphone-review';
const command = process.argv[2] || 'start';
async function config() {
  const previous = JSON.parse(await readFile(path.join(certDir, 'config.json'), 'utf8'));
  const [cert, key, ca] = await Promise.all(['server.pem', 'server-key.pem', 'ca.pem'].map(name => readFile(path.join(certDir, name))));
  const leaf = new X509Certificate(cert), authority = new X509Certificate(ca);
  if (!leaf.verify(authority.publicKey) || !leaf.checkHost(previous.dns) || !leaf.checkIP(previous.ip)) throw Error('原证书与配置不匹配，未修改证书，请检查原 HTTPS 配置');
  if (Date.parse(leaf.validFrom) > Date.now() || Date.parse(leaf.validTo) <= Date.now()) throw Error('原 HTTPS 证书尚未生效或已经过期');
  if (!Object.values(networkInterfaces()).flat().some(i => i.address === previous.ip && !i.internal)) throw Error('当前局域网 IP 与原证书配置不同，请先检查家庭网络');
  const port = Number(process.env.IPHONE_REVIEW_PORT || 8445);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || [8443, 8444].includes(port)) throw Error('新版端口需独立于旧 8443/8444，默认 8445');
  return { cert, key, ca, ip: previous.ip, dns: previous.dns, port, url: `https://${previous.dns}:${port}/`, ipUrl: `https://${previous.ip}:${port}/`, fingerprint: leaf.fingerprint256, validTo: leaf.validTo };
}
function request(c, pathname = '/') {
  return new Promise((resolve, reject) => {
    const req = https.get({ host: c.ip, servername: c.dns, port: c.port, path: pathname, ca: c.ca, timeout: 4000 }, response => {
      const chunks = [];
      const authorized = response.socket.authorized;
      const fingerprint = response.socket.getPeerCertificate().fingerprint256;
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString(), authorized, fingerprint }));
    });
    req.on('timeout', () => req.destroy(Error('HTTPS 连接超时')));
    req.on('error', reject);
  });
}
async function readState() { return JSON.parse(await readFile(statePath, 'utf8')); }
function assertResponse(c, result, runId) {
  if (result.status !== 200 || result.headers['x-fine-ledger-preview'] !== marker || (runId && result.headers['x-fine-ledger-run'] !== runId) || result.fingerprint !== c.fingerprint || !result.authorized) throw Error('端口未返回经过原 CA 验证的新版原型');
}
async function status(c) {
  const state = await readState(); const result = await request(c); assertResponse(c, result, state.runId);
  console.log(JSON.stringify({ running: true, pid: state.pid, url: c.url, ipUrl: c.ipUrl, certificateValidated: true, validTo: c.validTo }, null, 2));
}
async function start(c) {
  await buildPreview();
  try { const result = await request(c); assertResponse(c, result); await status(c); return; }
  catch (error) { if (!['ECONNREFUSED', 'EHOSTUNREACH'].includes(error.code)) throw error; }
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  const log = await open(path.join(runtime, 'service.log'), 'a', 0o600);
  const runId = randomUUID();
  const child = spawn(process.execPath, [script, 'serve', runId], { cwd: root, detached: true, stdio: ['ignore', log.fd, log.fd], env: process.env });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  await log.close(); child.unref();
  await writeFile(statePath, JSON.stringify({ pid: child.pid, runId, port: c.port, startedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  for (let attempt = 0; attempt < 30; attempt++) {
    await delay(150);
    try { const result = await request(c); assertResponse(c, result, runId); await status(c); return; }
    catch (error) { if (!['ECONNREFUSED'].includes(error.code)) throw error; }
  }
  throw Error('新版 HTTPS 未就绪，请检查 .local/iphone-review/service.log');
}
async function stop(c) {
  const state = await readState();
  const args = execFileSync('ps', ['-p', String(state.pid), '-o', 'args='], { encoding: 'utf8' });
  if (!args.includes(`${script} serve ${state.runId}`)) throw Error('PID 不属于新版原型，拒绝停止其他进程');
  const result = await request(c); assertResponse(c, result, state.runId);
  process.kill(state.pid, 'SIGTERM'); await unlink(statePath); console.log('新版 iPhone HTTPS 已停止；旧服务未操作');
}
try {
  const c = await config();
  if (command === 'serve') {
    const runId = process.argv[3];
    if (!runId) throw Error('缺少服务实例 ID');
    const server = https.createServer({ cert: c.cert, key: c.key, minVersion: 'TLSv1.2' }, (req, res) => {
      res.setHeader('X-Fine-Ledger-Preview', marker);
      res.setHeader('X-Fine-Ledger-Run', runId);
      void serveStatic(req, res);
    });
    server.on('error', error => { console.error(error.message); process.exitCode = 1; });
    server.listen(c.port, c.ip, () => console.log(`厘序 iPhone review · ${c.url}`));
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
    process.on('SIGINT', () => server.close(() => process.exit(0)));
  } else if (command === 'start') await start(c);
  else if (command === 'status') await status(c);
  else if (command === 'stop') await stop(c);
  else throw Error('用法：node scripts/iphone-review.mjs start|status|stop');
} catch (error) { console.error(error.message); process.exitCode = 1; }
