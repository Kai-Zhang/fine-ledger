import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceNames = ['app.js', 'domain.js', 'storage.js', 'seed.js', 'style.css'];
export function renderWorker(config) {
  return readFile(path.join(root, 'scripts/templates/service-worker.js'), 'utf8').then(template => template.replace('__FINE_LEDGER_SW_CONFIG__', JSON.stringify(config)));
}
async function atomicWrite(filename, content) {
  const temporary = filename + `.build-${process.pid}`;
  await writeFile(temporary, content);
  await rename(temporary, filename);
}
export async function buildPreview() {
  const sources = await Promise.all(sourceNames.map(name => readFile(path.join(root, 'public', name), 'utf8')));
  const [htmlTemplate, workerTemplate, packageText, manifest] = await Promise.all([
    readFile(path.join(root, 'scripts/templates/index.html'), 'utf8'),
    readFile(path.join(root, 'scripts/templates/service-worker.js'), 'utf8'),
    readFile(path.join(root, 'package.json'), 'utf8'),
    readFile(path.join(root, 'public/manifest.webmanifest'), 'utf8'),
  ]);
  const hash = createHash('sha256').update(JSON.stringify([...sources, htmlTemplate, workerTemplate, packageText, manifest])).digest('hex').slice(0, 16);
  const release = `${JSON.parse(packageText).version}-${hash}`;
  const assetRoot = `/assets/${release}/`;
  const directory = path.join(root, 'public', assetRoot);
  await mkdir(directory, { recursive: true });
  await Promise.all(sourceNames.map((name, i) => atomicWrite(path.join(directory, name), sources[i].replaceAll('__BUILD_ID__', release))));
  const html = htmlTemplate.replaceAll('__APP_CSS__', assetRoot + 'style.css').replaceAll('__APP_JS__', assetRoot + 'app.js').replaceAll('__BUILD_ID__', release);
  await atomicWrite(path.join(directory, 'index.html'), html);
  const assets = [assetRoot + 'index.html', ...sourceNames.map(name => assetRoot + name), '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];
  const config = { release, root: '/', shell: assetRoot + 'index.html', cachePrefix: 'fine-ledger-shell-', assets };
  const worker = workerTemplate.replace('__FINE_LEDGER_SW_CONFIG__', JSON.stringify(config));
  // Publish complete resources before replacing stable entry points.
  await atomicWrite(path.join(root, 'public/index.html'), html);
  await atomicWrite(path.join(root, 'public/sw.js'), worker);
  await atomicWrite(path.join(root, 'public/release.json'), JSON.stringify({ release, assets }, null, 2) + '\n');
  return { release, assets };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await buildPreview()));
}
