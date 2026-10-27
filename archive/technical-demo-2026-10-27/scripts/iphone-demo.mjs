import http from 'node:http';
import https from 'node:https';
import { networkInterfaces, hostname } from 'node:os';
import { readFile, writeFile, mkdir, chmod, stat, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, X509Certificate } from 'node:crypto';
import { once } from 'node:events';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(process.env.IPHONE_DEMO_DIR || resolve(root, '.local/iphone'));
const file = name => resolve(dir, name);
const openssl = process.env.OPENSSL || 'openssl';
const tlsPort = Number(process.env.IPHONE_HTTPS_PORT || 8443);
const setupPort = Number(process.env.IPHONE_SETUP_PORT || 8180);
const backendPort = Number(process.env.IPHONE_BACKEND_PORT || 4174);
const command = process.argv[2] || 'start';
const readJSON = async name => JSON.parse(await readFile(file(name), 'utf8'));
const exists = async name => stat(file(name)).then(() => true, () => false);
const secretWrite = async (name, value) => { await writeFile(file(name), value, { mode: 0o600 }); await chmod(file(name), 0o600); };
const run = args => execFileSync(openssl, args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
function chooseAddress() {
  if (process.env.IPHONE_LAN_IP) {
    const ip = process.env.IPHONE_LAN_IP;
    if (!Object.values(networkInterfaces()).flat().some(r => r?.address === ip && r.family === 'IPv4' && !r.internal)) throw Error('IPHONE_LAN_IP 必须是本机实际的 IPv4 局域网地址');
    return ip;
  }
  const candidates = Object.entries(networkInterfaces()).flatMap(([name, rows]) => rows.filter(r => r.family === 'IPv4' && !r.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(r.address)).map(r => ({ ...r, name })));
  const chosen = candidates.find(r => r.name === 'en0') || candidates.find(r => !/^(bridge|utun|vmenet|docker|veth)/.test(r.name));
  if (!chosen) throw Error('未发现家庭网络地址，请连接网络后重试，或指定 IPHONE_LAN_IP');
  return chosen.address;
}
function localName() {
  let name = hostname().replace(/\.local$/, '');
  if (process.platform === 'darwin') { try { name = execFileSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' }).trim(); } catch {} }
  if (!/^[a-z0-9-]+$/i.test(name)) throw Error('Mac 的 Bonjour 名称无效');
  return name.toLowerCase() + '.local';
}
export async function setup() {
  await mkdir(dir, { recursive: true, mode: 0o700 }); await chmod(dir, 0o700);
  const ip = chooseAddress(), dns = localName();
  if (!(await exists('ca.pem'))) {
    const suffix = randomBytes(3).toString('hex');
    run(['req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-sha256', '-days', '365', '-keyout', 'ca-key.pem', '-out', 'ca.pem', '-subj', `/CN=Fine Ledger iPhone Demo CA ${suffix}/O=Fine Ledger Local Demo`, '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
    await chmod(file('ca-key.pem'), 0o600);
  }
  const ca = new X509Certificate(await readFile(file('ca.pem')));
  if (Date.parse(ca.validTo) < Date.now() + 2 * 86400000) throw Error('测试根证书即将到期；请明确安排证书更换，不会静默替换根证书');
  const old = await readJSON('config.json').catch(() => ({}));
  let leaf = await readFile(file('server.pem')).then(b => new X509Certificate(b), () => null);
  if (!leaf?.checkHost(dns) || !leaf?.checkIP(ip) || Date.parse(leaf.validTo) < Date.now() + 86400000) {
    await secretWrite('server.ext', `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${dns},DNS:localhost,IP:${ip},IP:127.0.0.1\n`);
    run(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server-key.pem', '-out', 'server.csr', '-subj', `/CN=${dns}/O=Fine Ledger Local Demo`]);
    run(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca-key.pem', '-CAcreateserial', '-out', 'server.pem', '-days', '30', '-sha256', '-extfile', 'server.ext']);
    await chmod(file('server-key.pem'), 0o600);
    leaf = new X509Certificate(await readFile(file('server.pem')));
  }
  run(['x509', '-in', 'ca.pem', '-outform', 'DER', '-out', 'ca.cer']);
  run(['verify', '-CAfile', 'ca.pem', '-verify_hostname', dns, 'server.pem']);
  if (!(await exists('token.txt'))) await secretWrite('token.txt', randomBytes(8).toString('hex').match(/.{4}/g).join('-'));
  const config = { ...old, ip, dns, tlsPort, setupPort, backendPort, url: `https://${dns}:${tlsPort}`, ipUrl: `https://${ip}:${tlsPort}`, certificateUrl: `http://${ip}:${setupPort}/ca.cer`, caName: ca.subject.split('\n').find(s => s.startsWith('CN='))?.slice(3), caFingerprint: ca.fingerprint256, validTo: leaf.validTo, database: file('iphone-demo.sqlite'), configuredAt: new Date().toISOString() };
  await secretWrite('config.json', JSON.stringify(config, null, 2));
  await secretWrite('connection.txt', `Fine Ledger iPhone HTTPS Demo\n\n同一家庭 Wi-Fi 下使用 Safari：\n证书说明与下载：http://${ip}:${setupPort}/\n主访问地址：${config.url}/\n备用地址：${config.ipUrl}/\n\n首次初始化连接口令：${(await readFile(file('token.txt'), 'utf8')).trim()}\n\n根证书名称：${config.caName}\nSHA-256 指纹：${config.caFingerprint}\n服务器证书有效至：${config.validTo}\n\n主地址和 IP 备用地址属于不同来源，请选定一个后始终沿用。\n独立测试账本：${config.database}\n不要把 ca-key.pem、server-key.pem 或本连接口令发布、提交或传给其他人。\n`);
  return config;
}
function banner(c) {
  console.log(`iPhone HTTPS: ${c.url}/\nIP fallback: ${c.ipUrl}/\nCertificate setup: http://${c.ip}:${c.setupPort}/\nCA: ${c.caName}\nSHA-256: ${c.caFingerprint}\n连接口令只保存在 ${file('connection.txt')}\n测试账本: ${c.database}`);
}
function proxy(req, res, c) {
  // Preserve the browser-facing Host and Origin so the backend can check same-origin.
  const headers = { ...req.headers };
  delete headers['x-forwarded-host']; delete headers['x-forwarded-proto']; delete headers['forwarded'];
  const upstream = http.request({ hostname: '127.0.0.1', port: c.backendPort, path: req.url, method: req.method, headers }, response => {
    res.writeHead(response.statusCode, { ...response.headers, 'Cache-Control': req.url.startsWith('/api/') ? 'no-store' : 'no-cache' }); response.pipe(res);
  });
  upstream.setTimeout(10000, () => upstream.destroy(Error('backend timeout')));
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: '演示服务暂不可达，本机记录仍可保存' })); });
  req.on('aborted', () => upstream.destroy()); req.pipe(upstream);
}
function onboarding(c) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fine Ledger · iPhone HTTPS 配置</title><style>body{font:16px/1.8 system-ui;max-width:620px;padding:25px;margin:auto;color:#263a32}a{color:#214e40}code{overflow-wrap:anywhere;font-size:12px}li{margin:14px 0}.note{background:#f4f6ed;padding:15px;border-radius:8px}h1{font-size:25px}</style><h1>iPhone HTTPS 配置</h1><p>连接同一家庭 Wi-Fi，使用 Safari。只在这次测试中安装以下根证书，并先比对 Mac 上显示的名称和 SHA-256 指纹。</p><div class="note"><strong>${c.caName}</strong><br><code>${c.caFingerprint}</code></div><ol><li><a href="/ca.cer">下载测试根证书</a>。这是公开证书，私钥留在 Mac 上。</li><li>由你在设置中安装已下载的证书描述文件，再到「通用 → 关于本机 → 证书信任设置」开启该证书的完全信任。</li><li>信任根证书会扩大手机接受的证书范围；请只安装已核对指纹的这张测试证书。若 Safari 仍出现证书警告，停在该页检查，不要继续绕过。</li><li>打开 <a href="${c.url}/">${c.url}/</a>，首次初始化时填写 Mac 本地「connection.txt」里的口令。若 Bonjour 名称不能解析，可选择 <a href="${c.ipUrl}/">IP 地址</a>，之后始终使用选定的来源。</li><li>设置页等到离线资源就绪，再分享 → 添加到主屏幕；若有「作为网页 App 打开」，保持开启。之后从主屏幕图标再联网打开一次，确认独立应用自己的数据和离线资源。</li></ol><p>测试结束后，在「设置 → 通用 → VPN 与设备管理」移除这张测试证书描述文件。</p><p><a href="https://support.apple.com/zh-cn/102390">Apple：手动信任证书</a> · <a href="https://support.apple.com/zh-cn/guide/iphone/iphea86e5236/ios">Apple：添加到主屏幕</a></p></html>`;
}
async function start() {
  const running = await readJSON('running.json').catch(() => null);
  if (running) {
    let alive = false;
    try { process.kill(running.pid, 0); alive = true; } catch {}
    if (alive) throw Error('iPhone 演示已在运行，请先用 iphone:status 检查，或 iphone:stop 后重启');
  }
  const c = await setup(), token = (await readFile(file('token.txt'), 'utf8')).trim();
  const child = spawn(process.execPath, [resolve(root, 'server.mjs')], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(c.backendPort), LEDGER_DB: c.database, LEDGER_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', data => process.stderr.write(data));
  const ready = new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(Error('后端启动超时')), 8000);
    child.once('exit', code => { clearTimeout(timer); reject(Error(`后端退出 ${code}`)); });
    child.stdout.on('data', data => { if (String(data).includes('Fine Ledger demo:')) { clearTimeout(timer); resolveReady(); } });
  });
  let secure, download, stopping = false;
  const cleanup = async () => {
    secure?.close(); secure?.closeAllConnections(); download?.close(); download?.closeAllConnections();
    if (child.exitCode === null) { const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended; }
    const current = await readJSON('running.json').catch(() => null);
    if (current?.pid === process.pid) await unlink(file('running.json')).catch(() => {});
  };
  try {
    await ready;
    secure = https.createServer({ cert: await readFile(file('server.pem')), key: await readFile(file('server-key.pem')), minVersion: 'TLSv1.2' }, (req, res) => proxy(req, res, c));
    download = http.createServer(async (req, res) => {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method !== 'GET' || !['/', '/ca.cer'].includes(path)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': path === '/' ? 'text/html; charset=utf-8' : 'application/pkix-cert', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(path === '/ca.cer' ? { 'Content-Disposition': 'attachment; filename="fine-ledger-demo-ca.cer"' } : {}) });
      res.end(path === '/' ? onboarding(c) : await readFile(file('ca.cer')));
    });
    for (const [server, port] of [[secure, c.tlsPort], [download, c.setupPort]]) await new Promise((r, j) => { server.once('error', j); server.listen(port, c.ip, r); });
    await secretWrite('running.json', JSON.stringify({ pid: process.pid, backendPid: child.pid, at: new Date().toISOString(), url: c.url }));
    banner(c);
    const stop = code => { if (stopping) return; stopping = true; cleanup().then(() => process.exit(code)); };
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop(0));
    child.once('exit', () => stop(1));
  } catch (e) { await cleanup(); throw e; }
}
async function status() {
  const c = await readJSON('config.json'), ca = await readFile(file('ca.pem')), token = (await readFile(file('token.txt'), 'utf8')).trim();
  const request = path => new Promise((r, j) => {
    const req = https.get({ hostname: c.ip, servername: c.dns, port: c.tlsPort, path, ca, headers: { Host: `${c.dns}:${c.tlsPort}`, Authorization: `Bearer ${token}` }, timeout: 5000 }, response => { let body = ''; response.on('data', b => body += b); response.on('end', () => r({ status: response.statusCode, body, protocol: response.socket?.getProtocol?.() })); });
    req.on('error', j); req.on('timeout', () => req.destroy(Error('HTTPS 请求超时')));
  });
  const page = await request('/'), verification = await request('/api/verification');
  if (page.status !== 200 || verification.status !== 200) throw Error(`HTTPS / API 检查失败：${page.status} / ${verification.status}`);
  console.log(JSON.stringify({ url: c.url, certificateValidated: true, ...JSON.parse(verification.body) }, null, 2));
}
if (command === 'setup') banner(await setup());
else if (command === 'start') await start();
else if (command === 'status') await status();
else if (command === 'stop') {
  const state = await readJSON('running.json');
  const args = execFileSync('ps', ['-p', String(state.pid), '-o', 'command='], { encoding: 'utf8' });
  if (!args.includes('scripts/iphone-demo.mjs') || !args.includes('start')) throw Error('PID 与本演示服务不匹配，拒绝停止其他进程');
  process.kill(state.pid, 'SIGTERM'); console.log('已请求停止 iPhone 演示服务；本机与 SQLite 数据保留。');
} else throw Error('可用命令：setup / start / status / stop');
