#!/usr/bin/env node
/* 公开版主题包工具：init 起一套工作目录，build 打成 .themepkg.json 并立刻过闸。
 * 用法：node tools/theme-make.mjs init <id> [显示名] [--root=<工作目录父层>] [--out=<单个包路径>]
 *       node tools/theme-make.mjs build <id> [--root=<工作目录父层>]
 *
 * 为什么公开线要有这一份：包格式的判据只有一份（themePlugin.validate / themeScan.worstContrast），
 * 但「从零手抄一份能过闸的底」这件事本身会出错 —— 2026-10-10 那轮手抄漏过 --ok-bg / --err-bg，
 * 缺了它「面板」那一族底就少量两块，而读数照样是绿的。所以这里的底**直接从 主题插件开发范式.md §0
 * 那个 ```json 块里刮**：文档改了起盘点跟着改，仓库里不会出现第二份底。
 *
 * 这里刻意不做的事：
 *   不校验 id 格式、不算素材预算、不量对比度 —— 那些都在闸里，两处各量一次迟早「一处放行一处拒」。
 *   id 只当目录名用，不合规由 theme-pkg-check 当场拒，并原样念出原因。
 * 唯一的硬闸是文件系统的：id 不许含路径分隔符或 `..`，否则一个「主题名」就能写到目录外面去。
 *
 * 默认工作目录落在**仓库外**（<仓库根>/../theme-work）。这不是洁癖：包文件里是 base64 图片，
 * 留在仓内一次 `git add .` 就可能把素材连包塞进公开仓库。真要放在仓内得显式加 --allow-in-repo，
 * 并自己保证那条路径已被 ignore。 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/* 认根：同时看得见范式文档与离线闸的那个目录。先从 cwd 往上找，再从脚本自己往上找。 */
function 找根(from) {
  let 当前 = from;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(当前, '主题插件开发范式.md')) &&
        fs.existsSync(path.join(当前, 'tools', 'theme-pkg-check.mjs'))) return 当前;
    const 上 = path.dirname(当前);
    if (上 === 当前) break;
    当前 = 上;
  }
  return null;
}
const 根 = 找根(process.cwd()) || 找根(path.resolve(import.meta.dirname, '..'));
const 说 = (...a) => console.log(...a);
const 错 = (...a) => console.error(...a);
if (!根) {
  错('✗ 没找到仓库根（要看得到 主题插件开发范式.md 与 tools/theme-pkg-check.mjs）。在仓库里跑这条命令。');
  process.exit(2);
}

const 参数 = process.argv.slice(2);
const 子命令 = 参数.shift();
const 取值 = 名 => {
  const 带等号 = 参数.find(a => a.startsWith('--' + 名 + '='));
  if (带等号) return 带等号.slice(名.length + 3);
  const 位 = 参数.indexOf('--' + 名);
  return 位 >= 0 ? 参数[位 + 1] : null;
};
const 位置 = 参数.filter(a => !a.startsWith('--'));
const id = 位置[0];
const 显示名 = 位置[1] || null;
const 单个包 = 取值('out');
const 允许在仓内 = 参数.includes('--allow-in-repo');

const 用法 = () => {
  说('用法：node tools/theme-make.mjs init <id> [显示名] [--root=<目录>] [--out=<包路径>]');
  说('      node tools/theme-make.mjs build <id> [--root=<目录>]');
  说('  --root 是「放各套主题的父目录」，默认 <仓库根>/../theme-work（在仓库外）。');
};

if (!子命令 || !id || 子命令 === '--help' || 子命令 === '-h') { 用法(); process.exit(子命令 ? 2 : 0); }
if (子命令 !== 'init' && 子命令 !== 'build') { 错('✗ 不认识的子命令：' + 子命令); 用法(); process.exit(2); }
if (!id || /[\\/]/.test(id) || id.includes('..') || id === '.' || id.startsWith('.')) {
  错('✗ id 不能当目录名用：' + JSON.stringify(id) + '（不许含 / \\ .. 或以 . 开头；包格式里的 id 规则由闸判）');
  process.exit(2);
}

const 工作 = path.resolve(取值('root') || path.join(根, '..', 'theme-work'));
if (!允许在仓内 && (工作 === 根 || 工作.startsWith(根 + path.sep))) {
  错('✗ 工作目录在仓库里：' + 工作);
  错('  包文件里是 base64 素材，留在仓内一次 `git add .` 就可能把它塞进公开仓库。');
  错('  换一个 --root（默认就在仓库外），确实要放仓内再加 --allow-in-repo 并自行 ignore 那条路径。');
  process.exit(2);
}
const 座 = path.join(工作, id);
const 真值 = path.join(座, 'src', 'tokens.json');
const 包 = path.join(座, 'build', id + '.themepkg.json');
const 相对 = p => path.relative(process.cwd(), p).replace(/\\/g, '/') || '.';

const 跑闸 = 包路径 => {
  const 闸 = spawnSync(process.execPath, [path.join(根, 'tools', 'theme-pkg-check.mjs'), 包路径],
    { cwd: 根, encoding: 'utf8' });
  const 输出 = ((闸.stdout || '') + (闸.stderr || '')).split('\n')
    .filter(l => l.trim() && !/MODULE_TYPELESS_PACKAGE_JSON|Reparsing as ES module|trace-warnings|type.*module.*package\.json/.test(l));
  说('\n' + 输出.join('\n'));
  return 闸.status === 0;
};

/* ---------- build：src + assets → build/<id>.themepkg.json ---------- */
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

function 打包() {
  if (!fs.existsSync(真值)) {
    错('✗ 读不到 ' + 相对(真值) + ' —— 这套还没起手：node tools/theme-make.mjs init ' + id + ' --root ' + 相对(工作));
    process.exit(2);
  }
  const src = JSON.parse(fs.readFileSync(真值, 'utf8'));
  if (src.id !== id) {
    错('✗ tokens.json 里的 id=' + src.id + ' 与目录名 ' + id + ' 不一致 —— 包会装到另一个名字下，而你以为在改手上这套');
    process.exit(2);
  }
  const 素材 = {};
  const 素材目录 = path.join(座, 'assets');
  if (fs.existsSync(素材目录)) for (const f of fs.readdirSync(素材目录).sort()) {
    const 类型 = MIME[path.extname(f).toLowerCase()];
    if (!类型) continue;
    素材[f] = 'data:' + 类型 + ';base64,' + fs.readFileSync(path.join(素材目录, f)).toString('base64');
  }
  /* 装饰层按文件名顺序拼（编号即叠放顺序），剥注释省体积也不把源码注释带进用户可见的包。
   * url(img/x) 改写成 url(assets/x)：包里没有构建期，图片只有包内素材这一个来源。 */
  const 层 = fs.existsSync(path.join(座, 'src'))
    ? fs.readdirSync(path.join(座, 'src')).filter(f => f.endsWith('.css')).sort() : [];
  const css = 层.map(f => fs.readFileSync(path.join(座, 'src', f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/url\(\s*(['"]?)img\/([^'")]+)\1\s*\)/g, 'url($1assets/$2$1)')
    .trim()).filter(Boolean).join('\n\n');

  const pkg = {
    format: 'weather-theme/1',
    id: src.id, label: src.label, base: src.base,
    meta: src.tokens['--bg'],
    tokens: src.tokens, w: src.w, glass: src.glass, lace: src.lace,
    css, assets: 素材
  };
  fs.mkdirSync(path.join(座, 'build'), { recursive: true });
  const 旧 = fs.existsSync(包) ? fs.readFileSync(包, 'utf8') : null;
  const 新 = JSON.stringify(pkg);
  fs.writeFileSync(包, 新);
  const KB = n => (n / 1024).toFixed(0) + 'KB';
  说('✓ 已生成 ' + 相对(包));
  说('  令牌 ' + Object.keys(src.tokens).length + ' 个 · 渐变 ' + Object.keys(src.w).length + ' 条 · 素材 ' + Object.keys(素材).length + ' 张');
  说('  装饰 CSS ' + KB(css.length) + '（' + 层.length + ' 层：' + (层.join(' + ') || '无') + '）· 整包 ' + KB(fs.statSync(包).size));
  说('  ' + (旧 === null ? '（这一版还没有旧包可比）' : 旧 === 新 ? '与旧包逐字节相同' : '⚠ 与旧包不同 —— 改动确实落进包里了'));
}

/* ---------- init：从 §0 那份量过的底起一套工作目录 ---------- */
function 起盘() {
  const 文档 = fs.readFileSync(path.join(根, '主题插件开发范式.md'), 'utf8');
  /* 开栏按 \r?\n 认：这份文档在 Windows 检出是 CRLF，写死 '```json\n' 会一路刮不到底（内部那份 scaffold 就栽过）。 */
  const 开 = /```json\r?\n/.exec(文档);
  const 起 = 开 ? 开.index + 开[0].length : -1;
  const 止 = 起 < 0 ? -1 : 文档.indexOf('\n```', 起);
  if (止 < 0) { 错('✗ 范式文档 §0 那个 ```json 块没找到 —— 底换了，先修文档别手抄。'); process.exit(3); }
  let 底;
  try { 底 = JSON.parse(文档.slice(起, 止).replace(/\r\n/g, '\n')); }
  catch (e) { 错('✗ §0 那份底不是合法 JSON：' + e.message); process.exit(3); }
  底.id = id;
  底.label = 显示名 || id;

  if (单个包) {
    const 目标 = path.resolve(单个包.endsWith('.json') ? 单个包 : path.join(单个包, id + '.themepkg.json'));
    if (fs.existsSync(目标)) { 错('✗ 已经存在，不覆盖：' + 相对(目标)); process.exit(4); }
    fs.mkdirSync(path.dirname(目标), { recursive: true });
    fs.writeFileSync(目标, JSON.stringify(底, null, 2) + '\n');
    说('✓ 起了一个单文件包：' + 相对(目标) + '（产物形状，没有设计真值来源；要做长期一套请走默认那条）');
    process.exit(跑闸(目标) ? 0 : 1);
  }
  if (fs.existsSync(真值)) { 错('✗ 已经起过，不覆盖：' + 相对(真值)); process.exit(4); }
  const { format, css, assets, ...设计 } = 底;   // 包字段 ≠ 真值字段：css 走 src/*.css，素材走 assets/
  for (const 目 of ['src', 'assets', 'build']) fs.mkdirSync(path.join(座, 目), { recursive: true });
  fs.writeFileSync(真值, JSON.stringify(设计, null, 2) + '\n');
  说('✓ 工作目录已建：' + 相对(座) + '/{src,assets,build}');
  说('  src/tokens.json 令牌 ' + Object.keys(设计.tokens).length + ' 个 · glass ' + JSON.stringify(设计.glass) +
    ' · 没有 lace / 装饰层 / 素材（按 §9 的顺序往上加，每加一处大面积装饰就重量一次）');
  说('  装饰层写 src/20-' + id + '.css（每条选择器都要含 [data-theme="' + id + '"]），图片丢 assets/');
  打包();
  process.exit(跑闸(包) ? 0 : 1);
}

/* 打包本身不判成败（写不出来会直接抛），成不成只看闸 —— 判据只有一份。 */
if (子命令 === 'init') 起盘();
else { 打包(); process.exit(跑闸(包) ? 0 : 1); }
