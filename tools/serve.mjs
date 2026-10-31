/* 本机静态服务：替代不可用的 Python http.server。
 * 用法：
 *   node tools/serve.mjs                     # 仓库根 · 8169 · 127.0.0.1（回归通道）
 *   node tools/serve.mjs weather-app 8150    # 应用目录 · 8150（日常预览）
 *   node tools/serve.mjs weather-app 8150 0.0.0.0  # 局域网预览
 * 一律 no-store：ES 模块与 sw.js 都不许被浏览器缓存端旧版本。 */
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(ROOT, process.argv[2] || '.');
const port = Number(process.argv[3] || process.env.SERVE_PORT || 8169);
const host = process.argv[4] || '127.0.0.1';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};

http.createServer(async (req, res) => {
  try {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let p = path.join(root, u);
    if (!p.startsWith(root)) { res.writeHead(403); return res.end('forbidden'); }
    let s = await stat(p).catch(() => null);
    if (s && s.isDirectory()) { p = path.join(p, 'index.html'); s = await stat(p).catch(() => null); }
    if (!s) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    createReadStream(p).pipe(res);
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
}).listen(port, host, () => console.log(`serving ${root} on http://${host}:${port}`));
