/* 开局对锚点：把变异表里每一处 `from` 拿到目标文件里数一遍命中次数。
 * 用法：node tools/anchor-audit.mjs      （秒级，不跑回归；退出码＝失锚条数）
 * 为什么单独有它：falsify 自己那道 exit 94 只核对**本次要跑的那几处**（按关键字过滤时更是只看一小撮），
 * 而「改过 themes.js / ui.js / styles.css 之后其余一百多处还锚不锚得住」这件事，
 * 原本要等一整趟两小时的全量逼红才暴露。合并两条改动线之前先跑这个。
 * 判据与 falsify 一致：0 次＝失配（那条断言从没被逼过，比假绿更隐蔽），>1 次＝会改到别处去。 */
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
/* 表按族拆在 tools/falsify/mut/ 里（拆的缘由写在那一族的文件头），汇总口负责拼好并自查形状：
 * 缺字段、重名、表空了都在 import 的当刻抛，不会静默报「锚点总数 0」。 */
const { F } = await import('./falsify/files.mjs');
const MUT = (await import('./falsify/mut/index.mjs')).default;

const cache = new Map();
const text = rel => {
  if (!cache.has(rel)) cache.set(rel, readFileSync(new URL(rel, ROOT), 'utf8'));
  return cache.get(rel);
};
/* 变异串按**目标文件自己的行尾**归一（falsify 同一条规矩）：index.html 是 CRLF，
 * 表里跨行的 from 用 \n 写就永远匹配不上，那会被读成「这条没轮到跑」。 */
const countIn = (rel, from) => {
  const t = text(rel);
  const needle = t.includes('\r\n') ? from.replace(/\n/g, '\r\n') : from;
  if (!needle) return -1;
  let n = 0, i = 0;
  while ((i = t.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
  return n;
};

const 坏 = [];
for (const m of MUT) {
  const rel = m.file;   // MUT 表里存的是 F.xxx 的**值**（已经是相对路径），不是键名
  if (!rel) { 坏.push([m.name, '(F 表里没有这个键)', m.file]); continue; }
  let n;
  try { n = countIn(rel, m.from); } catch (e) { 坏.push([m.name, rel, '读不到文件：' + e.message]); continue; }
  if (n !== 1) 坏.push([m.name, rel, n + ' 次命中 ｜ ' + m.from.slice(0, 56).replace(/\s+/g, ' ')]);
}
console.log('锚点总数 ' + MUT.length + '，失锚 ' + 坏.length);
for (const [name, rel, why] of 坏) console.log('  ✗ ' + name + '  [' + rel + ']  ' + why);
process.exit(坏.length ? 1 : 0);
