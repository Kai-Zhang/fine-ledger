import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildPreview } from './scripts/build-preview.mjs';

const root = path.resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json; charset=utf-8' };
export async function serveStatic(req, res) {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store',
      ...(pathname === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {}),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.frankfurter.dev; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    }).end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404).end('Not found'); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildPreview();
  http.createServer(serveStatic).listen(Number(process.env.PORT || 4180), process.env.HOST || '127.0.0.1', () => {
    console.log(`厘序 · http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 4180}`);
  });
}
