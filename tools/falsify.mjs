/* 逐条逼红：把每条新断言所依赖的实现各改坏一次，确认它真的会变红。
 * 为什么必须做：一条写错的断言（选择器打错、导出名取错、条件恒真）比没有断言更糟 —— 它会一直绿着骗人。
 * 这套改动（处数以开局打印为准）覆盖中国天气的选名与失败路径、站点映射与码表清洗、2026-09-29 那一轮
 * 「坐标点 → 地名 → 各家出处」新加的九条断言、v95「软件声明」那一组与 v96 它的位置，
 * 以及 v97 数据源体检的四条修复（城市榜匹配 / 繁简归一 / 国标六项 / 逐小时档位 / 检索没答）与 v98 那枚空的提示块，
 * 还有 v110 那一轮（主题切换两边对称、玻璃名单漂移、--pop 与界面符号的落色）
 * 与 v111/v112 的 S1+S2（天气底色搬进 themes.js、背景模块取消、玻璃参数改由主题下发）、
 * v113 的 S3（老配置升 v3 只清背景）与 v114 的 S5+S6（逐主题一档透出值、渐变复合底色过 AA、切主题同一帧换完）。
 * 每处改完立刻还原；末尾再跑一遍干净版，绿的才作数。
 * 用法：node tools/falsify.mjs [关键字过滤]   （只跑名字里带这个关键字的那几处）
 * 时间：一处 = 一整趟回归（约 60~75 秒），全量跑完按开局打印的处数算，**小时级**，别挂在会到点的超时上；要分批就用关键字过滤。
 *   2026-10-04 那晚就有一条被 10 分钟超时杀掉之后又被重放，同一时刻两条 falsify 活着，其中一条把 109 处
 *   全判成「跳过」（一处变异都没做）而末尾干净版照样报「124 条全绿」。三道闸是按**形状**堵的，不依赖根因（那次没查实）。
 * 三道开局/中途的闸（都是 2026-10-04~05 那晚一次「看起来全绿其实什么都没测」的跑批换来的）：
 *   97 = 已经有一批在跑（独占锁；它改源文件，两条并行两边都拿假结论）
 *   94 = 本次要跑的每一处锚点，`from` 必须在目标文件里恰好命中 1 次（0 次＝表过期或有别人的改坏态在文件里，>1 次＝会改错地方）
 *   95 = 上一轮的变异还留在源文件里
 *   96 = 某一处跑完之后**一条断言都没回来** —— 0 条不是绿，是通道坏了（中途也停，不再浪费时间往下跑）
 *   98 = 被改的那棵树与服务端吐的那棵树不是同一棵（量的必须是改的那一棵，见下面第四道闸）
 *   93 = 这一批一处变异都没匹配上（关键字打空，或整张表被版本号筛空）—— 空批次一处都没改，末尾那句「全绿」不是逼红的证据 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
/* 两张登记表都不再写在这份文件里：F（改哪个文件）在 tools/falsify/files.mjs，
 * 变异条目按族拆在 tools/falsify/mut/*.mjs（汇总口是 mut/index.mjs）。拆表的缘由写在那一族的文件头，
 * 一句话：两条改动线各加一条断言，抢的原本是同一个 ];。 */
import MUT from './falsify/mut/index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const filter = process.argv[2];

/* 独占锁（2026-10-05 补的，为的是堵住那一整批假绿）。
 * 这个工具**会改源文件**：两个进程并行时，后起的那个读到的是被前一个改坏的状态 ⇒ 每一处 `from`
 * 都匹配不上，于是 109 处全部「跳过」（一处变异都没做），末尾它自己那趟干净版照样「124 条全绿」，
 * 打印出来像跑完了两轮。**为什么每一处都失配 —— 没查实**（那条批的日志后来被当临时文件清了；并发只是当时
 * 唯一观测到的异常，"抢 CDP 端口"当时看着像解释，但解释不了 109 处同时失配：并行的那条同一秒只改坏一个文件）。
 * 判活：Windows 上 `process.kill(pid, 0)` 对存在的进程不会抛（或抛 EPERM），不存在才抛 ESRCH。
 * 被打断（SIGTERM）时 exit 钩子不跑，锁会留下 —— 那种锁按 PID 判活自动接管，并提示先查残留。 */
{
  const LOCK = join(tmpdir(), 'qoder-weather-falsify.lock');
  const 活着 = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  if (existsSync(LOCK)) {
    const 前人 = Number(String(readFileSync(LOCK, 'utf8')).trim());
    if (前人 && 活着(前人)) {
      console.log('已经有一批 falsify 在跑（PID ' + 前人 + '，锁：' + LOCK + '）。\n' +
        '两条并行会互相把源文件改成对方的「改坏态」，两边跑出来的都是假结论 —— 等它跑完，' +
        '或确认那个进程真不在了再删锁重跑。');
      process.exit(97);
    }
    console.log('（接管上一轮留下的陈旧锁：PID ' + 前人 + ' 已经不在了。它多半是被中途杀掉的 —— ' +
      '源文件可能还停在改坏的状态，下面的残留自查会把它挑出来。）');
  }
  writeFileSync(LOCK, String(process.pid));
  process.on('exit', () => {
    try { if (String(process.pid) === String(readFileSync(LOCK, 'utf8')).trim()) unlinkSync(LOCK); } catch (e) { /* 已经被接管或清掉了 */ }
  });
}
const run = () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'run-checks.mjs')],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CDP_PORT: '9420', CHECKS_BUDGET: '180000' }, shell: false });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = [...out.matchAll(/^FAIL\s+(.+?)\s+⟵/gm)].map(m => m[1]);
  /* 红条后面的那句「⟵ 实测…」是判据的来源：只有名字的话，一条抖动的计时敏感断言
   * 报出来永远是同一个名字，看不出是四个条件里哪一个没成立（2026-10-06 那条「候选列表被在途联想弹回来」
   * 就这么红过一次，现场没留下任何可判的信息）。干净版红的时候把明细一起打出来。 */
  const 明细 = [...out.matchAll(/^FAIL\s+(.+?)\s+⟵\s*(.*)$/gm)].map(m => m[1] + ' ⟵ ' + m[2]);
  const total = (out.match(/^PASS/gm) || []).length + fails.length;
  return { total, fails, 明细, out };
};

let bad = 0;

/* 先认一下**这棵树自己是哪一版**（读它自己的 sw.js，不读参数、不读 git）：
 * 隔离工作树、回看老提交、或者表比代码走得快的时候，都会出现「这条变异要改的那句在这棵树里压根没有」——
 * 那既不是失锚也不是残留，是**这条不属于这棵树**。2026-10-06 在 v114 的隔离树里就是这么撞上的：
 * v115 那条的 `to` 是一句写死的 `background: var(--brand);`，恰好是 v114 里合法存在的那一行，
 * 于是残留闸（`to` 在、`from` 不在）判成「上一轮没还原」并 `exit 95` —— 拦了个假现场。
 * 认法只按名字开头的 `vNNN `（表里条条是这个格式）；读不到版本号或名字里没版本号的，按适用处理，
 * 宁多跑不误跳过 —— 跳过的代价是那条断言没被逼过，比多跑一趟严重。 */
const 树版 = (() => {
  try {
    const s = readFileSync(join(ROOT, 'weather-app', 'sw.js'), 'utf8');
    const v = /CACHE\s*=\s*'weather-studio-v(\d+)'/.exec(s);
    return v ? Number(v[1]) : Infinity;
  } catch (e) { return Infinity; }
})();
const 适用 = m => { const v = /^v(\d+)\s/.exec(m.name); return !v || Number(v[1]) <= 树版; };
const 全表适用 = MUT.filter(适用);
const 比树新 = MUT.filter(m => !适用(m)).map(m => m.name);
const picked = filter ? 全表适用.filter(m => (m.name + m.expect).includes(filter)) : 全表适用;
/* 关键字打空了 = 这一批一处变异都没做，而末尾照样会跑一遍干净版、报「126 条全绿」、`exit 0`。
 * 2026-10-06 真撞上：过滤词写成「记账」，可它只出现在注释里、没有一条**名字**含它，
 * 那一批在日志里就是一段空白加一句全绿 —— 看着像跑过了。空批次必须当场停。 */
if (!picked.length) {
  console.log('本批一处变异都没匹配上' + (filter ? '（过滤词「' + filter + '」不在任何一条变异的名字或断言名里 —— 匹配的是 name+expect，注释不算）' : '（整张表被版本号筛空了？）') +
    '\n什么都没改、什么都没测，别把后面那句「全绿」当成逼红的证据。');
  process.exit(93);
}
console.log('本批要跑 ' + picked.length + ' 处。');
if (比树新.length) {
  console.log('（跳过 ' + 比树新.length + ' 条比这棵树（v' + 树版 + '）新的变异，它们要改的那句在本树里还不存在：\n  ' +
    比树新.join('\n  ') + '\n  这不是失锚、也不是残留 —— 等那一路的代码进来再跑它们。）');
}

/* 第四道闸：**量的必须是被改的那一棵树**。
 * 2026-10-06 栽的形状：起批那条命令把 `cd 隔离树 && …` 整段放进了 `&` 后面的后台列表里，
 * 于是 `node tools/falsify.mjs` 是在**主树**的 cwd 里起来的（ROOT 从 `import.meta.url` 推 ⇒ 主树），
 * 而 `SERVE_PORT` 指向隔离树的服务 ⇒ 改 A 树的文件、浏览器量 B 树的字节 ⇒ 每一处变异都「照样全绿」，
 * 33 处连着打印「这条断言是摆设」，而主树还被留下了一处变异残留（`geo.js` 的 蘭/銀）。
 * 版本号相同（比如两棵树都是 v120）时这道闸量不出来，但绝大多数错位会带着版本号一起错位；
 * 它真正的价值是**当场把「哪两棵树」说出来**，让人一眼看见自己起错了目录。 */
{
  const 端口 = Number(process.env.SERVE_PORT || 8169);
  const 问 = async p => {
    const r = await fetch(`http://127.0.0.1:${p}/weather-app/sw.js`);
    return /CACHE\s*=\s*'weather-studio-v(\d+)'/.exec(await r.text());
  };
  let 服务版;
  try {
    const m = await 问(端口);
    服务版 = m ? Number(m[1]) : NaN;
  } catch (e) {
    console.log('问不到 SERVE_PORT=' + 端口 + ' 上的 /weather-app/sw.js：' + e.message +
      '\n服务没起就别跑 —— 那一趟跑出来的是「页面 chrome-error、一条都不出」那种假象（exit 96 的前一张脸）。');
    process.exit(98);
  }
  if (服务版 !== 树版) {
    console.log('被改的树与服务端吐的树不是同一棵：本进程 ROOT（cwd 推出来的）是 v' + 树版 +
      '，而 SERVE_PORT=' + 端口 + ' 端出来的是 v' + (Number.isNaN(服务版) ? '（读不出 CACHE）' : 服务版) + '。' +
      '\n改 A 树、量 B 树 ⇒ 每一处都会报「这条断言是摆设」，那 113 个结论一个都不能要。' +
      '\n先核对两件事：这条命令的 cwd 是不是你想跑的那棵树、`python -m http.server -d` 指的是不是同一棵。');
    process.exit(98);
  }
  console.log('同一棵树确认：ROOT 与 SERVE_PORT=' + 端口 + ' 都是 v' + 树版 + '（' + ROOT + '）');
}

/* 开局先把**要跑的每一处锚点**对一遍：`from` 在目标文件里必须恰好命中 1 次。
 * 为什么要在这一步就停：锚点失配在主循环里只打印一行「跳过（没找到要改的那句）」，
 * 看着像「这条没轮到」，其实是那条断言从没被逼过 —— 2026-10-04 那晚就有一整批 **109 处全跳过**，
 * 一处变异都没做，末尾那趟干净版照样「124 条全绿」，`exit 0`。
 * ⚠ **那一批为什么全失配，没查实**：当时确有两个 falsify 活着（一个 23:19 起，一个是被超时杀掉后
 * 重放的同一个后台任务；23:2x 的 `Get-CimInstance` 同时看得到它们和各自的 run-checks），
 * "并行"只是唯一观测到的异常，不是已证的因果 —— 而那份日志后来被当临时文件清掉了，证据没了。
 * 所以这三道闸是**按形状防**，不依赖根因：并行起不来（97）、开局锚点不齐就停（94）、中途 0 条就停（96）。
 * 命中 0 次的来路有两种：表写错了，或者有别人的变异正停在源文件里；> 1 次是会改错地方。 */
{
  const 坏锚点 = [];
  for (const m of picked) {
    let orig;
    try { orig = readFileSync(join(ROOT, m.file), 'utf8'); } catch (e) { 坏锚点.push(m.name + ' ← 读不到 ' + m.file); continue; }
    const eol = orig.includes('\r\n') ? '\r\n' : '\n';
    const n = orig.split(m.from.replace(/\r?\n/g, eol)).length - 1;
    if (n !== 1) 坏锚点.push(m.name + ' ← ' + (n === 0 ? '源里没有那句（表过期，或有别的 falsify 正在改这个文件）' : '命中 ' + n + ' 次，会改错地方'));
  }
  if (坏锚点.length) {
    console.log('有 ' + 坏锚点.length + '/' + picked.length + ' 处的锚点不对，先修表再跑：\n  ' + 坏锚点.join('\n  '));
    process.exit(94);
  }
}

/* 上一轮跑批被中途打断时，它覆盖的那几个文件会**停在改坏的状态**（2026-10-01 真踩到：三个 falsify
 * 并发跑，杀掉之后 geo.js 少了两个字、hourly.js 整行换成 `void d;`、hwAqi.js 的段筛变成 `if (false)`，
 * 而回归当场报「繁体那串→张掖市」，看着像代码写错了，其实是变异残留）。
 * 开局先自查：某处 `to` 在文件里、而对应的 `from` 已经不在 —— 那就是残留，先把源修回来再跑。 */
{
  const 残留 = [];
  for (const m of 全表适用) {
    let orig;
    try { orig = readFileSync(join(ROOT, m.file), 'utf8'); } catch { continue; }
    const eol = orig.includes('\r\n') ? '\r\n' : '\n';
    const from = m.from.replace(/\r?\n/g, eol), to = m.to.replace(/\r?\n/g, eol);
    /* `to` 太短就别拿来当证据：' } }' 这种串满文件都是，源文件一改形状（比如给主题加了 glass 那一格）
     * 就会「from 不在、to 在」，报成残留其实是误报（2026-10-04 就这么被自己拦下过一次）。
     * 真要防的是「上一轮中途被打断」，那必然留下一段有辨识度的 to。 */
    if (to.length < 12) continue;
    if (to !== from && orig.includes(to) && !orig.includes(from)) 残留.push(m.file + ' ← ' + m.name);
  }
  if (残留.length) {
    console.log('检测到**上一轮改坏的内容还留在源文件里**（跑批被中途打断就是这样）：\n  ' +
      残留.join('\n  ') + '\n先把这些文件还原再跑，否则回归红的是变异、不是代码。');
    process.exit(95);
  }
}

for (const m of picked) {
  const p = join(ROOT, m.file);
  const orig = readFileSync(p, 'utf8');
  /* index.html 是 CRLF，其它文件是 LF：变异串里的换行必须跟着文件走，否则那种跨行的 `from`
   * 永远匹配不上，报出来的是「跳过」而不是「红 ✗」—— 看着像没跑到，其实是那条断言从没被逼过。 */
  const eol = orig.includes('\r\n') ? '\r\n' : '\n';
  const from = m.from.replace(/\r?\n/g, eol);
  const to = m.to.replace(/\r?\n/g, eol);
  if (!orig.includes(from)) { console.log('跳过（没找到要改的那句）：' + m.name); bad++; continue; }
  writeFileSync(p, orig.replace(from, to), 'utf8');
  let res;
  try { res = run(); } finally { writeFileSync(p, orig, 'utf8'); }
  /* 中途就量到 0 条 = 通道坏了（端口被另一条 falsify 占了 / 页面没起来 / 断言脚本抛错），
   * 继续跑下去只会把整批都判成「还是绿的」。停，把这一处的源还原干净再停。 */
  if (!res.total) {
    console.log('通道坏了：这一处改完之后**一条断言都没回来**（不是全绿）。' +
      '0 条的原因不唯一（页面没起来 / 服务端口不对 / 断言脚本抛错 / 有第二条在抢通道），先看下面这几行日志尾部。\n' +
      res.out.split('\n').filter(l => /THREW|EXC:|超时|没有|Error/.test(l)).slice(0, 6).join('\n'));
    process.exit(96);
  }
  const hit = res.fails.find(f => f.includes(m.expect));
  console.log((hit ? '红 ✓ ' : '红 ✗ ') + m.name + ' → 断言「' + m.expect + '」'
    + (hit ? '变红（共 ' + res.fails.length + ' 红 / ' + res.total + ' 条）'
           : '还是绿的！这条断言是摆设。共 ' + res.fails.length + ' 红 / ' + res.total + ' 条'
             + (res.fails.length ? '：' + res.fails.join('；') : '')));
  if (!hit) bad++;
}
console.log('\n还原后再跑一遍干净版：');
const clean = run();
/* 「一条都没出」不是全绿 —— 2026-10-01 就是这么被骗过一次：断言脚本里 `const disc` 重复声明，
 * SyntaxError 让整张表一行都不渲染，而这里只看 `fails.length`，于是报成"红 0（全绿）"。
 * 计数为 0 一定是通道坏了（脚本抛错 / 页面没起来 / 端口被占），必须非零退出。 */
if (!clean.total) {
  console.log('  一条断言都没出 —— 这不是绿，是测量通道坏了。日志尾部：\n'
    + clean.out.split('\n').filter(l => /THREW|EXC:|超时|没有/.test(l)).slice(0, 6).join('\n'));
  process.exit(bad + 101);
}
console.log('  ' + clean.total + ' 条，红 ' + clean.fails.length + (clean.fails.length ? ' → ' + clean.fails.join('；') : '（全绿）'));
if (clean.fails.length) console.log('  红的那几条的实测：\n    ' + clean.明细.join('\n    '));
process.exit(bad + (clean.fails.length ? 100 : 0));
