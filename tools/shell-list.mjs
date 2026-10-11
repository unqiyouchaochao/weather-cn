/* SHELL 清单的**唯一算法**：什么算应用壳、什么刻意不进清单。
 * 单独一个文件是因为有两个用得上它：`tools/gen-shell.mjs`（按它重写 sw.js）与
 * `tools/shell-check.mjs`（拿它跟 sw.js 里现有的清单对一遍）。放一份实现是怕两个工具各算各的，
 * 判据一改就悄悄不一致 —— 而不一致的那个方向是「检查说自己对」。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const APP = path.join(ROOT, 'weather-app');
export const SW = path.join(APP, 'sw.js');
export const BEGIN = '/* SHELL:BEGIN 这份清单由 tools/gen-shell.mjs 生成，别手工增删 */';

// 壳本身那四件（'./' 是 index.html 的别名，两条都列：装壳时有人只认 './index.html'）
export const STATIC = ['index.html', 'styles.css', 'icon.svg', 'manifest.webmanifest'];

/* 刻意不进 SHELL 的文件与理由。判据是「不是开机就要、而且能自己按需拿到」：
 * nmc-stations.js（70KB 中国天气站点码表）由 chinaWeather.js 动态 import，只有真选了那个源才下载；
 * fetch 事件那条会把第一次拿到的那份顺手写进缓存，离线照用。新增这种文件请进这里并写明理由。 */
export const DYNAMIC = ['js/lib/nmc-stations.js'];

const walk = d => fs.readdirSync(d, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.relative(APP, path.join(d, e.name)).replace(/\\/g, '/')]);

export function shellList() {
  const js = walk(path.join(APP, 'js')).filter(f => f.endsWith('.js') && !DYNAMIC.includes(f));
  const imgDir = path.join(APP, 'img');
  const img = fs.existsSync(imgDir)
    ? walk(imgDir).filter(f => /\.(png|jpg|webp|gif)$/.test(f))
    : [];
  const isShellFile = p => /\.(html|css|svg|webmanifest)$/.test(p);
  // 清单里的每一项都写成 './xxx'：这是 sw.js 里沿用的形状，也是 tests/run.html 认的形状
  // （它按 /'\.\/[^']*'/ 抓这份清单去逐个 cache:'reload' 预热，写成 'xxx' 就抓不到了）。
  const all = ['./', ...STATIC, ...js, ...img].map(p => (p === './' ? p : './' + p)).sort((a, b) => {
    if (a === './') return -1;
    if (b === './') return 1;
    if (isShellFile(a) !== isShellFile(b)) return isShellFile(a) ? -1 : 1;   // 壳那四件在前，其余按路径字典序
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const 缺 = all.filter(p => p !== './' && !fs.existsSync(path.join(APP, p.slice(2))));
  if (缺.length) throw new Error('清单里有不存在的路径（cache.addAll 会整批失败）：' + 缺.join(' '));
  return all;
}

/** sw.js 里现在写着的那一份（只取 SHELL 那一段，躲开 sw.js 别处的 './index.html' 之类）。 */
export function listedSw(swText = fs.readFileSync(SW, 'utf8')) {
  const i = swText.indexOf(BEGIN);
  if (i < 0) throw new Error('sw.js 里找不到 SHELL 的 BEGIN 标记 —— 那份清单已经不再由 gen-shell 管了？');
  const seg = swText.slice(i, swText.indexOf('];', i));
  return [...seg.matchAll(/'(\.[^']*)'/g)].map(m => m[1]);
}
