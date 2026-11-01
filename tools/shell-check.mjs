/* 查 weather-app/sw.js：清单与磁盘对不对得上、这份脚本还编不编得过（`node tools/shell-check.mjs`，秒级）。
 * 为什么单独有它：gen-shell 会重写 sw.js，而「重写」这件事本身可以出错 —— 2026-10-06 第一版就同时
 * 撞了两样：生成的条目丢了开头的 `./`（tests/run.html 按「以 ./ 开头的引号串」抓清单去预热，
 * 抓不到就是不预热），以及顶部注释被插到块注释的收尾之后（sw.js 当场不是合法 JS，
 * 而它只在装壳/离线那条路上才被解析）。
 * 这两种都不会让回归变红：回归那一趟把 sw.js 当一个文本去 fetch。所以这一处必须单独问一句。
 * 退出码 = 问题条数（0 = 干净）。只查不改；要改清单跑 gen-shell。 */
import vm from 'node:vm';
import { BEGIN, SW, listedSw, shellList } from './shell-list.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(SW, 'utf8');
const 题 = [];

// ① 能不能编译（不执行：SW 里全是 self.*，执行需要浏览器）
try { new vm.Script(src, { filename: 'sw.js' }); }
catch (e) { 题.push('sw.js 语法不过：' + e.message); }

// ② 生成口认不认得出这一段
if (!src.includes(BEGIN)) 题.push('sw.js 里缺少 SHELL 的 BEGIN 标记，gen-shell 写不进去');

// ③ 清单 ↔ 磁盘，两个方向都要问
let want = [];
try { want = shellList(); } catch (e) { 题.push('算不出应有的清单：' + e.message); }
if (want.length) {
  const have = listedSw(src);
  const H = new Set(have), W = new Set(want);
  const 漏 = want.filter(p => !H.has(p));
  const 多 = have.filter(p => !W.has(p));
  const 形状 = have.filter(p => p !== './' && !p.startsWith('./'));
  if (漏.length) 题.push('磁盘上有、清单里没有（离线打开就是白屏）：' + 漏.join(' '));
  if (多.length) 题.push('清单里写着、磁盘上没有（cache.addAll 整批失败）：' + 多.join(' '));
  if (形状.length) 题.push("条目不是 './xxx' 这个形状（tests/run.html 的预热抓不到）：" + 形状.join(' '));
  const 版 = (/CACHE = 'weather-studio-v(\d+)'/.exec(src) || [])[1];
  if (!版) 题.push("读不出 CACHE 的形如 'weather-studio-vNNN'（falsify 靠它认这棵树是哪一版）");
  console.log('SHELL ' + have.length + ' 项 · 应该 ' + want.length + ' 项 · CACHE v' + (版 || '?'));
}
// ④ 样式产物漂没漂：weather-app/styles.css 必须由 src/styles/*.css 拼得出来。
//    这一条查的是「有人直接改了产物」或「改了分片忘了重拼」—— 两种都会让磁盘上的 CSS 与
//    分片各自表达一份真值，而 falsify 表里那批 `file: F.css` 的变异（数量随表漂移，不写死）、
//    回归里那两条名单漂移检查问的都是产物。
//    parts() 里还带着**全局件闸与编号闸**（见 gen-styles.mjs 那段注释），所以这一句同时也把
//    「删片带走了全局基座」那种只有出图才看得见的事故拦在出包之前。
//    老树（分片之前那一版）没有 src/styles，跳过但要打印，别让它变成静默漏检。
const fs = await import('node:fs');
const 有分片 = existsSync(join(SW, '..', '..', 'src', 'styles'));
if (有分片) {
  const { parts, OUT, LF } = await import('./gen-styles.mjs');
  try {
    const { 名, 文本 } = parts();
    const 现 = LF(readFileSync(OUT, 'utf8'));   // 行尾不算漂移：autocrlf 会把产物 smudge 成 CRLF
    if (现 !== 文本) {
      let i = 0; while (i < Math.min(现.length, 文本.length) && 现[i] === 文本[i]) i++;
      题.push('styles.css 与分片的内容对不上（第 ' + i + ' 个字符起分叉，共 ' + 名.length +
        ' 片）：要么有人手改了产物，要么改了分片没重拼 —— 跑 `node tools/gen-styles.mjs`');
    } else console.log('styles.css = ' + 名.length + ' 片拼出来的（' + Buffer.byteLength(文本) + ' 字节）');
  } catch (e) { 题.push('分片拼不出产物：' + e.message); }
} else console.log('（这一版还没有 src/styles 分片，跳过样式漂移检查）');

console.log(题.length ? 题.map(t => '✗ ' + t).join('\n') : '干净：清单与磁盘一致，sw.js 编得过');
process.exit(题.length);
