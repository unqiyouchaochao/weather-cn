/* 本地静态服务器：跑回归、出图、装机调试都要先有一个。
 *
 * 以前这一步写的是 `python -m http.server`，两个坑：① 本机根本没装 python
 * （2026-10-12 实测 `python -c` 直接弹 Microsoft Store 占位符），照着 README 敲第一条
 * 命令的人第一步就卡住；② 那条命令里还写死了一个已经作废的绝对路径。
 * node 是这仓库唯一的硬依赖（capacitor/cli 就要它），所以服务器也用它。
 *
 * 用法：node tools/serve.mjs [端口] [根目录] [绑定地址]
 *   端口默认 8169，根目录默认仓库根 —— 回归页要同时够得着 /weather-app/ 和 /tests/，
 *   所以检查用的那个服务器必须以仓库根为根，不能是 weather-app。
 *   起 Capacitor 热重载时给 `8150 weather-app`（webDir 得是它的根）。
 *
 * 绑定地址默认 127.0.0.1：这台机上别的进程不该能翻工程目录。真机走 Wi-Fi 调试时才
 * 显式给 0.0.0.0（npm run serve:lan），别把它当默认。 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 8169);
const BASE = path.resolve(ROOT, process.argv[3] || '.');
const BIND = process.argv[4] || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};

if (!BASE.startsWith(ROOT + path.sep) && BASE !== ROOT) {
  console.error(`根目录必须在仓库内：${BASE}`);
  process.exit(2);
}

http.createServer((req, res) => {
  const 请 = decodeURIComponent(req.url.split('?')[0]);
  const 真 = path.resolve(BASE, '.' + (请 === '/' ? '/index.html' : 请));
  // 带上分隔符比，否则 …/天气evil 这种同级目录能混过 startsWith
  if (!真.startsWith(BASE + path.sep) || !fs.existsSync(真) || fs.statSync(真).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('404 ' + 请);
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(真).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  fs.createReadStream(真).pipe(res);
}).listen(PORT, BIND, () => {
  console.log(`http://${BIND}:${PORT}/  ← ${path.relative(ROOT, BASE) || '.'}（Ctrl+C 停）`);
});
