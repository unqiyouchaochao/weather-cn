/* 审一个提交里有没有**夹着 falsify 的变异**（默认 HEAD；`node tools/commit-carry.mjs <rev>` 可指任何一个）。
 *
 * 为什么单独有它：falsify 把源文件改坏的那一两分钟里工作区是脏的，这时任何一次 `git add` 都会把
 * 「改坏的那一行」收进索引 —— 跑批随后自己还原了工作区，提交里却留着那一行。2026-10-06 真栽过一次：
 * 另一条会话提交 v115 时正好撞进我这一发的变异窗口，于是 `HEAD` 里的 `applyBg` 成了
 * `document.body.dataset.weather = 'clear'`（天气态永远画成晴天），而工作区看着一切正常、回归 128 条全绿。
 * falsify 的独占锁拦不住它（不是两个 falsify 在抢），规矩也拦不住（谁也不知道别人正在跑批）
 * —— 所以事后必须能一秒钟查出来。
 *
 * 判据与 falsify 的残留自查同形，只是问的对象从工作区换成提交：某处变异的 `to` 在该提交里、`from` 不在
 * ⇒ 这一行是变异。**只读 git，不碰工作区**，所以跑批期间也能安全地跑它。
 *
 * 两类会报错的来路，都靠「按那个提交自己的版本号筛」挡掉（与 falsify 同一条规矩）：
 * ① 表比树新 —— 拿 v115 的表去审 v114 的提交，那条变异的 `to`（一句写死的 `background: var(--brand);`）
 *    恰好是 v114 里合法存在的那一行；② 审的提交**早于那次修复** —— 比如 v113 那条的 `to` 就是 v110 时代
 *    `config.js` 本来的样子（迁移不看版本号），报出来是「这行当时确实长这样」，不是夹带。
 * 所以它报的是「去看一眼这一行」，判它只要 `git show <rev>:<文件>`。 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('../', import.meta.url);
const repoDir = () => decodeURIComponent(ROOT.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', cwd: repoDir(), maxBuffer: 64 * 1024 * 1024 });

/* 变异表现在是 export 出来的模块（tools/falsify/mut/*.mjs，汇总口 mut/index.mjs），直接 import。
 * 以前这里是「从 falsify.mjs 源码里截一段 eval」，那份表没有 export；拆表之后形状不再是隐性依赖，
 * 但**开局就抛**这条还在：mut/index.mjs 自己查缺字段与重名，表空了/坏了这两个工具都跑不起来，
 * 不会静默数出 0 条（0 条正是「通道坏了」那一类假绿的脸）。 */
const { F } = await import('./falsify/files.mjs');
const MUT = (await import('./falsify/mut/index.mjs')).default;

let rev = process.argv[2] || 'HEAD';
try { rev = git('rev-parse', '--short', rev).trim(); }
catch (e) { console.error('认不出这个 rev：' + (process.argv[2] || 'HEAD')); process.exit(2); }

/* 这个提交自己是哪一版：读它那份 sw.js。读不到（老提交没这个文件、或格式不同）就当 Infinity —— 宁可多审。 */
const 树版 = (() => {
  const s = (() => { try { return git('show', rev + ':weather-app/sw.js'); } catch (e) { return ''; } })();
  const v = /CACHE\s*=\s*'weather-studio-v(\d+)'/.exec(s);
  return v ? Number(v[1]) : Infinity;
})();
const 适用 = m => { const v = /^v(\d+)\s/.exec(m.name); return !v || Number(v[1]) <= 树版; };
const 审 = MUT.filter(适用);
const 没审 = MUT.length - 审.length;

const 缓存 = new Map();
const 提交里 = rel => {
  if (!缓存.has(rel)) {
    let t = null;
    try { t = git('show', rev + ':' + rel); } catch (e) { t = null; }  // 该提交里没这个文件 ⇒ 不参与判定
    缓存.set(rel, t);
  }
  return 缓存.get(rel);
};

const 夹带 = [], 读不到 = new Set();
for (const m of 审) {
  const rel = m.file;
  if (!rel) continue;
  const t = 提交里(rel);
  if (t === null) { 读不到.add(rel); continue; }
  const eol = t.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  const from = m.from.replace(/\r?\n/g, eol), to = m.to.replace(/\r?\n/g, eol);
  if (to !== from && to.length >= 12 && t.indexOf(to) >= 0 && t.indexOf(from) < 0) {
    夹带.push(rel + ' ← ' + m.name);
  }
}
console.log('审 ' + rev + '（v' + (树版 === Infinity ? '?' : 树版) + '）：表里 ' + MUT.length +
  ' 处，本树适用 ' + 审.length + '，夹带 ' + 夹带.length + (夹带.length ? '' : '（干净）'));
for (const s of 夹带) console.log('  ✗ ' + s);
if (没审) console.log('（跳过 ' + 没审 + ' 条比这个提交新的变异 —— 它们的 to 可能就是当时的正常代码）');
if (读不到.size) console.log('（这些文件在该提交里读不到，没参与判定：' + [...读不到].join(' ') + '）');
if (夹带.length) console.log('  → 判它只要一句：git show ' + rev + ':' + 夹带[0].split(' ← ')[0] + ' 里那一行');
process.exit(夹带.length ? 1 : 0);
