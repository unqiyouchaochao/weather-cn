/* 把 src/styles/NN-*.css 按文件名顺序拼成 weather-app/styles.css。
 * 为什么是「拼一份产物」而不是「页面里挂 21 个 <link>」：
 *  ① stylesheet 请求是 render-blocking 的，多挂 20 个链接要把 FCP 往后拖（分区唯一已经量到的代价
 *     就在模块图那 +15ms，不能再往看得见的地方加）；
 *  ② 有一批按**这一份文件的文本**问问题的东西（falsify 表里那些 `file: F.css` 的变异、
 *     tests/app.checks.mjs 里那两条名单漂移检查、tools/theme-glass-scan.mjs 找 `body[data-theme="X"]`
 *     那一段）；拆成多文件等于把这些锚点全搬一遍，搬错一处就是假绿。数量会随表漂移，这里不写死。
 * 所以：源片按归属分（一个板块一个文件，新功能加一片就完事），产物的**内容**与切分之前一致。
 * 顺序 = 文件名顺序（`NN-` 两位前缀就是为这个），**层叠顺序由文件名表达，别靠改顺序解决冲突**。
 *
 * 行尾这件事（2026-10-06 撞上的，别再去追一个不存在的等式）：本机 `core.autocrlf=true` 且没有
 * .gitattributes，`git checkout` 会把这份 LF 文件 smudge 成 CRLF —— 一次 `git checkout -- styles.css`
 * 就从 73415 字节变成 74941 字节（每行多个 CR），而 `git status` 还说干净。所以这里比的是**内容**
 * （两边都先归一成 LF），产物一律写成 LF。「拼回去逐字节等于切分之前」这个承诺只对 LF 成立，
 * 别拿工作树里那份 CRLF 的去 cmp。
 *
 * 规矩：
 *  · `weather-app/styles.css` 是产物，别手改；要改样式就改对应那片，然后跑本脚本。
 *  · 分片里不要加文件头注释 —— 拼装不加一个字节，加了就没法证明「这次切分与内容无关」。
 *  · 分片必须落在 `src/styles/`，不许落进 `weather-app/`（那会被 cap sync 打进 APK、也会被 SHELL 清单收走）。
 * 用法：node tools/gen-styles.mjs     （npm run apk 的第一句，出包前必然对齐）
 *       node tools/shell-check.mjs    （只查不改：样式漂没漂、SHELL 清单、sw.js 编不经得过） */
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DIR = join(ROOT, 'src', 'styles');
export const OUT = join(ROOT, 'weather-app', 'styles.css');
export const LF = s => s.replace(/\r\n/g, '\n');

/* 分片的顺序与完整性都在这查（查的就是下面这五件：目录在不在、有没有被塞进会被打包的地方、
 * 空不空、编号重没重、每片末尾有没有换行 —— 别把这句注释当成"什么都查了"），报错要说清是哪一片 */
export function parts() {
  if (!fs.existsSync(DIR)) throw new Error('找不到分片目录：' + DIR);
  if (fs.existsSync(join(ROOT, 'weather-app', 'styles'))) {
    throw new Error('`weather-app/styles/` 里有东西：分片不许放进会被打包的目录（cap sync 会把它装进 APK，gen-shell 也会把它收进 SHELL）');
  }
  const 名 = fs.readdirSync(DIR).filter(f => f.endsWith('.css')).sort();
  if (!名.length) throw new Error('分片目录是空的：' + DIR);
  const 号 = 名.map(f => /^(\d\d)-/.exec(f) ? /^(\d\d)-/.exec(f)[1] : '??');
  const 重 = 号.filter((v, i) => v !== '??' && 号.indexOf(v) !== i);
  if (重.length) throw new Error('编号重复：' + [...new Set(重)].map(v => v + '-').join(' ') +
    ' —— 层叠顺序由文件名表达，同一个号的两片谁先谁后变成了后缀的字典序，这是隐式的调顺序');
  const 体 = 名.map(f => {
    const s = LF(fs.readFileSync(join(DIR, f), 'utf8'));
    if (!s.endsWith('\n')) throw new Error('片 ' + f + ' 末尾没有换行 —— 拼下去的那一片会和它粘在同一行上');
    return s;
  });
  查全局件(名, 体);
  return { 名, 文本: 体.join('') };
}

/* ---------- 全局件闸 ----------
 * 「全局件」= 不带板块/主题/属性限定的顶层选择器（`*`、`[hidden]`、裸 `body`、`html`、`:root`）。
 * 为什么要钉住它住在哪一片：2026-10-06 删最后那一片（20-bridal）时，挂在**片尾**的一条与花嫁无关的
 * 全局基座 `[hidden]{display:none!important}` 跟着一起没了 —— 属性写着对、渲染是错的，回归全绿
 * （判的是 `.hidden` 那个属性），只有出图看得见，首页被一张关掉的空排名榜盖住。
 * 从那以后规矩是「删片前先找全局基座并搬走」，可那是一条**只有人记得才成立**的规矩。
 * 下面这张表把它变成闸：每片该有几条全局件是**当下真值的快照**，多一条、少一条、搬去别片都会红，
 * 要过就得连表一起改 —— 目的是让人在改的那一刻看见自己动了什么，不是替它放行。 */
export const 全局件期望 = {
  '00-theme.css': 5,     // :root（清亮那套令牌）· * · [role="button"] · [hidden] · body —— 全局基座的家
  '13-transition.css': 1, // html —— 板块推入动画那 22px 的横向溢出只能挂在根元素上裁（overflow-x: clip）
  '17-glass.css': 4,     // 三条 @supports 里的裸 body（玻璃开/关/退回实底）+ 一条给裸文字垫底的 body .news-disc
};

const 去注释 = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
export function 全局件(体) {
  const 出 = [];
  for (const 行 of 去注释(体).split('\n')) {
    const s = 行.trim();
    const 花 = s.indexOf('{');
    if (花 < 0 || s.startsWith('@')) continue;
    const 头 = s.slice(0, 花).trim();
    // 前半截必须像选择器：不带 ; } 也不以逗号收尾（那是跨行选择器的中间段）
    if (!头 || /[;}]/.test(头) || 头.endsWith(',')) continue;
    for (const 段 of 头.split(',')) {
      const p = 段.trim();
      /* 「全局件」= 无条件作用到整页的那一类：`*`、属性选择器、`:root`，以及**裸的** `body`/`html`
       * （后面直接结束、或跟后代/子代组合符）。`body[data-theme=…]`、`body.dark`、`body:not(…)`
       * 这些带着状态限定的不算 —— 它们只在某一档下才咬，删了不会把整页基座抽走。 */
      const 裸 = /^(\*|\[|:root)/.test(p) || /^(body|html)(\s|$|>)/.test(p);
      if (裸) 出.push(p + ' {');
    }
  }
  return 出;
}

function 查全局件(名, 体) {
  const 报 = [];
  名.forEach((f, i) => {
    const 实 = 全局件(体[i]);
    const 期 = 全局件期望[f] || 0;
    if (实.length !== 期) 报.push('片 ' + f + ' 里有 ' + 实.length + ' 条全局件，表里写的是 ' + 期 +
      (实.length ? '（' + [...new Set(实)].slice(0, 4).join(' / ') + '）' : '') +
      (实.length > 期 ? ' —— 新增全局件要写明为什么不能收进板块选择器，并把它记进 全局件期望' : ' —— 有人删了全局件？先确认它没有被搬去别的片'));
  });
  const 无家 = Object.keys(全局件期望).filter(f => !名.includes(f) && 全局件期望[f]);
  if (无家.length) 报.push('表里还期望 ' + 无家.join(' ') + ' 有全局件，可这些片已经不在了 —— 全局基座要么搬进了别片并改表，要么真的丢了');
  const 末 = 名[名.length - 1];
  if (末 && 全局件(体[体.length - 1]).length) 报.push('最后一片（' + 末 + '）里挂着全局件 —— 这正是 2026-10-06 那个形状：删末尾片会把它一起带走。先搬进 00-theme.css 再删');
  if (报.length) throw new Error(报.join('\n  '));
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/gen-styles.mjs')) {
  const { 名, 文本 } = parts();
  const 现 = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  const 字节 = Buffer.byteLength(文本);
  if (现 === null) {
    fs.writeFileSync(OUT, 文本, 'utf8');
    console.log('styles.css 已生成（产物原本不存在）：' + 名.length + ' 片 · ' + 字节 + ' 字节');
  } else if (LF(现) === 文本) {
    if (现 === 文本) console.log('styles.css 没变（' + 名.length + ' 片 · ' + 字节 + ' 字节）');
    else {
      fs.writeFileSync(OUT, 文本, 'utf8');
      console.log('styles.css 内容没变，只是行尾被 git 的 autocrlf 换过 —— 已拼回 LF（' + 字节 + ' 字节）');
    }
  } else {
    fs.writeFileSync(OUT, 文本, 'utf8');
    const 旧 = LF(现);
    let i = 0; while (i < Math.min(旧.length, 文本.length) && 旧[i] === 文本[i]) i++;
    console.log('styles.css 已重写：' + 名.length + ' 片 · ' + 字节 + ' 字节（旧 ' + Buffer.byteLength(现) +
      ' 字节，第 ' + i + ' 个字符起分叉）' +
      '\n  ⚠ 样式变了 —— 按规矩要升一次 CACHE，改动还要过两套主题的 AA 复验。');
  }
}
