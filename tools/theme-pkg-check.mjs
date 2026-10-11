/* 主题插件包离线验收 —— 一条命令，不需要浏览器。
 * 用法：node tools/theme-pkg-check.mjs <包.json> [--explain|--fix|--all]
 * 开关全表、退出码、--fix 的搜索边界、环境变量旋钮、以及「它不管什么」—— 见 theme-pkg-check.md。
 *
 * 为什么单独有它：主题插件的验收里有一大半是纯算术（形状、作用域、资源、对比度），
 * 本可以交给「改 JSON → 跑命令 → 读结果 → 再改」的闭环，但之前只有 主题插件开发范式.md §2
 * 里那段一次性的 node -e：不可复用、没有退出码、还会混进一条 loader 警告。
 * 观感那一半仍然要人看（应用内浏览器面板是 0×0 隐藏页、CSS 动画整体冻结，量出来的不作数，
 * 能信的真机截图只有 adb 一条路），所以这个工具只管算术可判的那一半，并把它管严。
 *
 * 判据绝不抄第二份：校验走 themePlugin.validate，对比度走 themeScan.worstContrast，
 * 连走 css 块结构都用 themePlugin 导出的 matchBrace。这里只做 IO、拆解和外壳。
 *
 * 只读不改文件。--fix 打印的是「在允许范围内怎么改才过线」的候选值，落盘由人做 ——
 * 与 theme-glass-scan.mjs（全文没有 writeFileSync）、shell-check.mjs「只查不改」同一条纪律。
 *
 * 一条噪音先说清：跑这条命令时 stderr 会先来一行 MODULE_TYPELESS_PACKAGE_JSON，
 * 那是 node 的 loader 在抱怨 weather-app/js/*.js 没声明模块类型，**不是这个工具说的话**。
 * 别为它给 package.json 加 "type":"module"（会把全仓 .js 的解析规则一起改掉），
 * 也别把它计入退出码。 */
import fs from 'node:fs';
import path from 'node:path';
import { validate, matchBrace } from '../weather-app/js/lib/themePlugin.js';
import {
  AA_LINE, SUB_PANELS, parseColor, alphaOf, toHex, contrast, shiftLum, blurFor, worstContrast
} from '../weather-app/js/lib/themeScan.js';

/* 阈值走环境变量，不走 argv（照 theme-glass-scan.mjs:29-31 的写法） */
const MIX_LIMIT = Number(process.env.MIX_LIMIT ?? 40);   // 工具建议的提档上限，比 themeScan 的 MIX_CAP=62 严
const COST_CAP = Number(process.env.COST_CAP ?? 8);      // 挪字色的总步数预算
const A_FLOOR = Number(process.env.A_FLOOR ?? 55);       // glass.a 的下限（与 validate 一致）
const CSS_WARN_MAX = Number(process.env.CSS_WARN_MAX ?? 6);
const 枚举上限 = Number(process.env.SCAN_CAP ?? 20000);  // --fix 最多试多少档

const 码 = { 可导入: 0, 读不到: 81, 解析失败: 82, 量不了: 83, 零条底: 84, 无解: 85, 开关错: 86 };

/* ---------- 退出码 ----------
 * 0 过线 · 1..80 错误条数 · 81 读不到 · 82 JSON 坏 · 83 判据抛错 · 84 量出 0 条底
 * · 85 --fix 无解 · 86 不认识开关。90+ 归 run-checks、93~98 归 falsify，不复用。 */
function 收场(错误, 特殊) {
  if (特殊 !== undefined) process.exit(特殊);
  process.exit(Math.max(0, Math.min(80, 错误)));
}

function 读包(p) {
  const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  let text;
  try { text = fs.readFileSync(abs, 'utf8'); }
  catch (e) { console.log('✗ 读不到包文件：' + abs + '（' + (e.code || e.message) + '）'); 收场(0, 码.读不到); }
  try { return JSON.parse(text); }
  catch (e) { console.log('✗ 不是合法 JSON：' + e.message); 收场(0, 码.解析失败); }
}

/* 量一遍。抛错和「量出 0 条底」都必须非零退出：
 * 0 条底不等于合格，它等于判据什么都没看到就报了个绿。 */
function 量(pkg) {
  let r;
  try { r = worstContrast(pkg, pkg.tokens); }
  catch (e) { console.log('✗ 对比度量不出来：' + e.message); 收场(0, 码.量不了); }
  if (!r.bgs || !r.bgs.length) { console.log('✗ 量出来 0 条底 —— 这不是合格，是判据没看到任何东西'); 收场(0, 码.零条底); }
  return r;
}

/* ---------- 覆盖缺口：判据没量到的地方 ----------
 * 这一段的优先级比任何 css 启发式都高，因为它零误报，而且漏过的是一次有案可查的事故：
 * themeScan.js:110 把「弹窗」那一族整支包在 catch 里，缺 --veil 就静默不量，
 * 而 validate 不强制 --veil —— 于是包可以拿着一个「少算了一族底」的 ≥5.0 过关。
 * 2026-10-04 就是这么漏的：离线说每套 ≥5.0，真机正文只剩 4.53。
 * 报的是 r.bgs 里**实际缺了哪一族**，不是去猜令牌给没给，所以不会和判据走样。 */
function 覆盖缺口(pkg, r) {
  const 缺 = [];
  const 有 = pref => r.bgs.some(b => b.nm.startsWith(pref));
  const 数 = pref => r.bgs.filter(b => b.nm.startsWith(pref)).length;
  if (!有('弹窗/'))
    缺.push('「弹窗」那一族底整支没量到（多半是包里没给 --veil，themeScan 就把这一支 catch 掉跳过了）。'
      + '历史上漏的正是这一支：2026-10-04 离线说每套 ≥5.0，真机正文只剩 4.53。补一个 --veil 再重量。');
  const 面板 = r.bgs.filter(b => b.nm.startsWith('面板/')).map(b => b.nm.slice(3));
  const 缺面板 = SUB_PANELS.filter(n => !面板.includes(n));
  if (缺面板.length)
    缺.push('子面板底缺 ' + 缺面板.length + ' 块（' + 缺面板.join('/') + '）—— 这几块上压的字没进验收。'
      + '注意它们不吃 glass.a，只能靠字色本身过线。');
  if (Number(pkg.lace || 0) > 0 && !r.bgs.some(b => b.nm.endsWith('+装饰')))
    缺.push('声明了 lace=' + pkg.lace + ' 却没生成「+装饰」那一族底 —— 装饰这一维只有这把尺子在管，'
      + '浏览器那条逐元素扫描看不见它（color-mix 吐 color(srgb …/a)，伪元素也不在祖先链里）。');
  return 缺;
}

/* ---------- css 盲区扫描（警告级，不计入退出码） ----------
 * 为什么不进 validate().warns：settings/themePlugins.js:71 是
 * `r.warns && r.warns.length ? r.warns[0] : '已导入「X」，在「主题」里选它'` ——
 * 塞进去会把导入成功的提示语顶掉，用户看到的是警告而不是「装好了」。所以只在 CLI 里报。
 *
 * 只看**规则主体**（最后一个复合选择器）落在 body / .app 上的整屏层：
 * 那种每条选择器都以 `body[data-theme=...] ` 开头的长清单，用「含 body 就算」会一路刷屏，
 * 而 `.current-card::after`、`.gear::after` 这些其实只有几十 px，报出来只是稀释信号。 */
function css扫描(css) {
  const src = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
  const 报 = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const close = matchBrace(src, open);
    if (close < 0) break;
    const prelude = src.slice(i, open).trim();
    const body = src.slice(open + 1, close);
    if (prelude.startsWith('@')) { i = open + 1; continue; }   // 条件块：进去继续走里面的规则
    i = close + 1;
    if (!prelude) continue;
    for (const sel of prelude.split(',')) {
      const s = sel.trim();
      if (!s) continue;
      const 主体 = s.split(/[\s>+~]+/).pop() || '';
      if (!/(^|[^-\w.])body\b/.test(主体) && !/\.app\b/.test(主体)) continue;
      const 中 = [];
      for (const m of body.matchAll(/(background|background-image|mask-image|-webkit-mask-image|backdrop-filter)\s*:\s*([^;}]+)/gi)) {
        const alphas = [...m[2].matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)].map(x => alphaOf(x[0]));
        const 最大 = alphas.length ? Math.max(...alphas) : 0;
        if (最大 >= 0.3) 中.push(m[1] + ' 色值不透明度最高 ' + 最大.toFixed(2));
      }
      for (const m of body.matchAll(/(?:^|[;\s])opacity\s*:\s*([\d.]+)/g)) {
        const v = parseFloat(m[1]);
        if (v > 0.6) 中.push('opacity ' + v);
      }
      if (中.length) 报.push(s.slice(0, 60) + ' —— ' + 中.join('、'));
    }
  }
  return 报;
}

/* ---------- 无效轴提示 ----------
 * 这是本轮最容易做错的地方。themeScan.js:100-105 的「面板/」一族**完全不吃 α**
 * （注释在 19-20 行就写明），所以「α 越大越安全」对它不成立；而 CSS 里只有 --muted
 * 吃 glass.mix，pop/accent 根本不吃 —— theme-glass-scan.mjs:94-97 为同一形状的坑记过一次账
 * （第一版把 mix 一路加到封顶去救 pop，六套浅色主题全报 mix=45，其实是 pop@storm 在拖）。
 * 所以先说清哪几条轴对这一格无效，再谈改什么。 */
function 无效轴(at) {
  const 隔 = at.indexOf('@');
  const 角色 = at.slice(0, 隔), 底 = at.slice(隔 + 1);
  const 出 = [];
  if (底.startsWith('面板/')) 出.push('抬 glass.a 对它无效 —— 「面板/」那一族底不吃 α');
  if (角色 !== 'muted') 出.push('调 glass.mix 对它无效 —— CSS 里只有 --muted 吃 mix，现在最差的是 ' + 角色);
  if (!底.endsWith('+装饰')) 出.push('降 lace 对它无效 —— 这一格底下没压装饰层');
  return 出;
}

/* ---------- --explain：把 at 拆成人话 ----------
 * at 形如 `muted@弹窗/storm@#8fa2b8+装饰`，底名由 themeScan.js:93-118 拼出，四段可剥。
 * 终点色只从 r.bgs 按 nm 查（**不在这里重算复合**，否则 --explain 就成了第二套真值）；
 * 查不到就说明拆解和判据对不上，退 83。 */
function 解释(pkg, r) {
  const at = r.at, 隔 = at.indexOf('@');
  const 角色 = at.slice(0, 隔), 底名 = at.slice(隔 + 1);
  const 行 = [];
  const b = r.bgs.find(x => x.nm === 底名);
  if (!b) { console.log('✗ 拆解与判据不一致：at 里的底名 "' + 底名 + '" 在 bgs 里找不到'); 收场(0, 码.量不了); }

  const 色 = toHex(r.colors[角色]);
  行.push('最差那一格：' + 角色 + ' 压「' + 底名 + '」= ' + r.min.toFixed(3) + '（达标线 ' + AA_LINE.toFixed(1) + '）');
  行.push('  字色  ' + 角色 + ' = ' + 色 +
    (角色 === 'muted' ? '（--muted-base ' + pkg.tokens['--muted-base'] + ' 掺 --ink ' + pkg.glass.mix + '% 之后的实测值）'
      : '（直接取 ' + (pkg.tokens['--' + (角色 === 'ink' ? 'ink' : 角色)]) + '）'));

  let 剩 = 底名, 链 = [];
  const 装饰 = 剩.endsWith('+装饰'); if (装饰) 剩 = 剩.slice(0, -3);
  const 弹窗 = 剩.startsWith('弹窗/'); if (弹窗) 剩 = 剩.slice(3);
  const 面板 = 剩.startsWith('面板/'); if (面板) { 链.push('子面板 ' + 剩.slice(3) + '（不吃 glass.a）'); 剩 = ''; }
  if (!面板) {
    // 从最底下往上念：页面底 → 遮罩压它 → 卡面压那个 → 装饰再压一层
    链.push(剩 === 'bg' ? '页面底 = --bg ' + pkg.tokens['--bg']
      : '页面底 = ' + 剩.split('@')[0] + ' 渐变的端点 ' + 剩.split('@')[1]);
    if (弹窗) 链.push('--veil ' + pkg.tokens['--veil'] + ' 压住它');
    链.push('卡面 α=' + (pkg.glass.a / 100).toFixed(2) + ' 的 --card ' + pkg.tokens['--card'] + ' 压住那层');
  }
  if (装饰) {
    const lace = Number(pkg.lace || 0);
    链.push('装饰朝 --brand ' + pkg.tokens['--brand'] +
      (弹窗 ? ' 只漏上 (1−α)·' + lace + '% = ' + ((1 - pkg.glass.a / 100) * lace).toFixed(1) + '%'
            : ' 满额 ' + lace + '% 再叠 (1−α)·' + lace + '% 漏出'));
  }
  行.push('  底  ' + toHex(b.bg) + ' ← ' + 链.join(' ← '));
  行.push('  比值 ' + contrast(r.colors[角色], b.bg).toFixed(3));

  const 同底 = Object.entries(r.colors).map(([k, c]) => '    ' + k.padEnd(7) + toHex(c) + ' 压这块底 = ' + contrast(c, b.bg).toFixed(3));
  行.push('  同一块底上四个角色（看是字色的问题还是底的问题）：\n' + 同底.join('\n'));
  return 行;
}

/* ---------- --fix：全枚举解算器 ----------
 * 不假设任何单调性 —— 上面「无效轴」那一段就是它必须成立的理由。
 * 照 theme-glass-scan.mjs:130-132 的「第一个有解就 break」移植过来，
 * 在「面板/」那一格上会给出一个并不过线的建议，比不给建议更糟。
 * 做法：把 (a, mix, lace) 铺成网格，按**改动代价**排序，best-first 逐个喂给同一个
 * worstContrast；第一个过线的就是代价最小的解。零代价档全失败才上付费档（挪字色）。 */
function 试(pkg, a, mix, lace, tokens) {
  const p = { ...pkg, lace, tokens: tokens || pkg.tokens, glass: { ...pkg.glass, a, mix } };
  try { return worstContrast(p, p.tokens); } catch { return null; }
}

function 挪字色(pkg, a, mix, lace) {
  const 方向 = pkg.base === 'light' ? -1 : 1;      // 浅底朝黑挪、深底朝白挪
  const tokens = { ...pkg.tokens };
  const 可动 = { 'muted-base': 0, pop: 0, accent: 0 };   // --ink 是整套的脸，绝不动
  const 原色 = { 'muted-base': tokens['--muted-base'], pop: tokens['--pop'], accent: tokens['--accent'] };
  for (let g = 0; g < 600; g++) {
    const r = 试(pkg, a, mix, lace, tokens);
    if (!r) return null;
    if (r.min >= AA_LINE) {
      const 改 = Object.keys(可动).filter(k => 可动[k]).map(k => ({ 令牌: '--' + k, 原: 原色[k], 新: tokens['--' + k], 步: 可动[k] }));
      return { a, mix, lace, 改, 步数: Object.values(可动).reduce((x, y) => x + y, 0), r };
    }
    const 角色 = r.at.slice(0, r.at.indexOf('@'));
    const 键 = 角色 === 'muted' ? 'muted-base' : 角色;
    if (角色 === 'ink' || !(键 in 可动)) return null;   // 判停①：最差格落在 ink
    if (可动[键] >= 12) return null;                     // 判停②：单个 token 挪够 12 步（24%）就不叫微调
    tokens['--' + 键] = toHex(shiftLum(parseColor(tokens['--' + 键]), 方向));
    可动[键]++;
    if (Object.values(可动).reduce((x, y) => x + y, 0) > COST_CAP) return null;   // 判停③：总代价超预算
  }
  return null;
}

function 候选(pkg) {
  const a0 = pkg.glass.a, mix0 = pkg.glass.mix, lace0 = Math.round(Number(pkg.lace || 0));
  const 距 = (a, mix, lace) => Math.abs(a - a0) / 10 + Math.abs(mix - mix0) + Math.abs(lace - lace0);
  const 格 = [];
  for (let a = Math.max(A_FLOOR, Math.min(a0, 100)); a <= 100; a++)
    for (let mix = 0; mix <= MIX_LIMIT; mix++)
      for (let lace = 0; lace <= lace0; lace++)
        格.push({ a, mix, lace, 代价: 距(a, mix, lace) });
  格.sort((x, y) => x.代价 - y.代价);

  let 命中 = null, 试数 = 0;
  for (const g of 格) {
    if (++试数 > 枚举上限) break;
    const r = 试(pkg, g.a, g.mix, g.lace);
    if (r && r.min >= AA_LINE) { 命中 = { ...g, 改: [], 步数: 0, r, 扫了: 试数 }; break; }
  }
  if (命中) return 命中;

  // 零代价档全灭，才在几个锚点上试挪字色
  const 锚 = [[a0, mix0, lace0], [100, mix0, lace0], [100, MIX_LIMIT, 0], [a0, MIX_LIMIT, lace0]];
  let 最省 = null;
  for (const [a, mix, lace] of 锚) {
    const got = 挪字色(pkg, a, mix, lace);
    if (!got) continue;
    got.总代价 = 距(a, mix, lace) + got.步数;
    if (!最省 || got.总代价 < 最省.总代价) 最省 = got;
  }
  if (最省) { 最省.扫了 = 格.length; return 最省; }
  return { 无解: true, 扫了: 试数, 格数: 格.length };
}

function 报候选(pkg, c) {
  const 行 = [];
  const 动 = (名, 旧, 新) => 名 + ' ' + 旧 + '→' + 新 + (String(旧) === String(新) ? '（不动）' : '');
  行.push('  候选：' + 动('glass.a', pkg.glass.a, c.a) + ' · ' + 动('glass.mix', pkg.glass.mix, c.mix)
    + ' · ' + 动('lace', Number(pkg.lace || 0), c.lace) + ' · blur 不搜，由 a 派生 = ' + blurFor(c.a));
  if (c.改 && c.改.length)
    行.push('  字色：' + c.改.map(x => x.令牌 + ' ' + x.原 + '→' + x.新 + '（' + x.步 + ' 步）').join(' · '));
  行.push('  最低比 ' + c.r.min.toFixed(3) + ' @ ' + c.r.at + '  ✓过线（达标线 ' + AA_LINE.toFixed(1) + '）');
  行.push('  代价：α 抬 ' + (c.a - pkg.glass.a) + ' 档 · mix 变 ' + (c.mix - pkg.glass.mix) + ' · lace 变 '
    + (c.lace - Number(pkg.lace || 0)) + ' · 字色挪 ' + (c.步数 || 0) + ' 步　（搜了 ' + c.扫了 + ' 档）');
  /* 候选顶到 mix 上限 = 算术上过线了，但代价是把两级文字压成一级。这不算建议成功。 */
  if (c.mix >= MIX_LIMIT)
    行.push('  ⚠ 这个候选把 glass.mix 顶到了上限 ' + MIX_LIMIT + '。mix 再高 --muted 就和 --ink 同色了'
      + '（应用允许到 62 才拒，但层次也是设计，不是免费的）—— 与其照抄，不如改深 --muted-base 本身或换掉那块底。');
  行.push('  ⚠ 这只证明算术过线。落盘后仍要按 主题插件开发范式.md §9 走真机截图看观感。');
  return 行;
}

/* ---------- 主流程 ---------- */
const 文件 = process.argv[2];
const 模式 = process.argv[3] || '';
if (!文件) { console.log('用法：node tools/theme-pkg-check.mjs <包.json> [--explain|--fix|--all]'); 收场(0, 码.读不到); }
if (['--explain', '--fix', '--all', ''].indexOf(模式) < 0) { console.log('✗ 不认识的模式开关：' + 模式 + '（可给 --explain / --fix / --all）'); 收场(0, 码.开关错); }
const 要解释 = 模式 === '--explain' || 模式 === '--all';
const 要候选 = 模式 === '--fix' || 模式 === '--all';

const pkg = 读包(文件);
const v = validate(pkg);
/* 形状错与对比度错要分开看：validate 把 AA 也算一条 error，于是「唯一的问题是读不清」的包
 * 会在形状闸那里就被挡掉 —— 那正好是 --fix 唯一要救的那种包。所以只有形状错才提前收场，
 * AA 错照常往下量、往下给候选。 */
const AA错 = v.errors.filter(e => /对比度不达标/.test(e));
const 形状错 = v.errors.filter(e => !/对比度不达标/.test(e));

if (形状错.length) {
  console.log('✗ 不能导入（形状 ' + 形状错.length + ' 条）：');
  for (const e of 形状错) console.log('  · ' + e);
  if (AA错.length) console.log('  · （另有一条对比度的事，等形状修完再量）');
  console.log('\n形状没过的时候不量对比度 —— 判据会在一堆无关错误上抛异常（与 validate 内部同一个顺序）。');
  收场(v.errors.length);
}

const r = 量(pkg);
console.log('✓ 形状合格 · 素材 ' + (v.assetBytes / 1024).toFixed(0) + 'KB · '
  + Object.keys(pkg.tokens).length + ' 令牌 · CSS ' + ((pkg.css || '').length / 1024).toFixed(1) + 'KB');
console.log('  最低比 ' + r.min.toFixed(3) + ' @ ' + r.at + ' · 达标线 ' + AA_LINE.toFixed(1) + ' · '
  + (r.pass ? '✓ 过线' : '✗ 不过线'));
if (!r.pass) {
  console.log('✗ 不能导入（1 条）：');
  for (const e of AA错) console.log('  · ' + e);
  /* 先说哪几条轴对这一格无效，再谈改什么 —— 不看 at 就顺手抬 a 或加 mix，是这一类工具
   * 最容易给出的那种「看着像建议」的废话。theme-glass-scan.mjs:94-97 为同一个坑记过账。 */
  for (const s of 无效轴(r.at)) console.log('  ⚠ ' + s);
}

const 缺 = 覆盖缺口(pkg, r);
if (缺.length) {
  console.log('\n【判据没量到的地方】这几条不是错误，但会让上面那个读数偏乐观：');
  for (const s of 缺) console.log('  ! ' + s);
}

if (pkg.css) {
  const 中 = css扫描(pkg.css);
  if (中.length) {
    console.log('\n【css 里判据量不到的大面积规则】以下 ' + 中.length + ' 处**没被量过**，不是说它们有问题；'
      + '要确认只能走真机截图（警告不计入退出码）：');
    for (const s of 中.slice(0, CSS_WARN_MAX)) console.log('  ~ ' + s);
    if (中.length > CSS_WARN_MAX) console.log('  ~ …另有 ' + (中.length - CSS_WARN_MAX) + ' 处同类');
  }
}

if (pkg.glass.mix > MIX_LIMIT && pkg.glass.mix <= 62)
  console.log('\n  ⓘ glass.mix=' + pkg.glass.mix + '：应用允许到 62，所以能装；但工具建议 ≤' + MIX_LIMIT
    + '，这段里 --muted 会开始和 --ink 同色，两级文字没层次。');

if (要解释) { console.log(''); for (const l of 解释(pkg, r)) console.log(l); }

if (!r.pass && 要候选) {
  const c = 候选(pkg);
  console.log('');
  if (c.无解) {
    console.log('✗ 在允许范围内无解：扫了 ' + c.扫了 + ' 档（网格 ' + c.格数 + ' 档），挪字色也救不回来。'
      + '\n  要么改深字色本身（超出本工具的预算）、要么换掉那块底、要么这主题就不该过 —— 三个都是设计决定，不是工具能替你定的。');
    收场(1, 码.无解);
  }
  for (const l of 报候选(pkg, c)) console.log(l);
} else if (r.pass && 要候选) {
  console.log('\n  已经过线，不需要候选。');
}

/* 退出码就是「还差几条」：过线 0，不过线 1。--fix 找到候选也不改这个数 ——
 * 包本身还是装不进去，AI 的闭环应当是「把候选填回去 → 重跑 → 拿到 0」。 */
收场(r.pass ? 0 : 1);
