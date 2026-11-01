/* S5：逐主题定「卡面透出值」。`node tools/theme-glass-scan.mjs`
 *
 * 判据本体在 weather-app/js/lib/themeScan.js —— 那里同时是浏览器校验主题插件时用的那一把尺子，
 * 所以「离线说合格、应用里也说合格」必须是同一个算法，不许在这里再抄一份。
 * 这个文件只留工具自己的两件事：
 *   ① 从 styles.css 把内置主题的令牌刮出来，喂给共享判据；
 *   ② 在 α 轴上搜「最透的合格档」并记代价账 —— 这是设计探索，不是验收。
 *
 * 两条目标，按先后排：
 * ① 达标线 = AA(4.5) + MARGIN。真机上卡面底下是「模糊过的复合」，量到的不是这两个纯色标，
 *    所以只压线过关不算过关。MARGIN 默认 0.5（即最低 5.0）。
 * ② 设计档 = 满足 ① 的**最透**的 α，但允许改主题自己的字色来换通透度（spec 里「不达标的单独加深」），
 *    改动要有代价账：把 --pop/--muted-base/--accent 沿 HSL 明度往更安全方向挪一步记 1 分，
 *    单套主题总账 ≤ COST_CAP 才采纳；--ink 是整套主题的脸，不许动。
 *    没有这条代价账的话：暗色四套字色富余，全被顶到 FLOOR 变成同一个数；浅色几套为了压住 storm
 *    那一档最深的渐变，会被逼到接近实底 —— 两边都不是「每套主题自己的设计值」。
 *
 * 值从两处读：渐变在 js/lib/themes.js 的 w，卡面/墨色/次要字/--pop/--accent 在 styles.css 的主题块里。
 * 两处都是现成的真值，这里不抄第二份色值。输出是**候选表**，落进 themes.js 前还要用
 * tools/shot-themes.mjs 出图看过观感，改完色值后由 tests/app.checks.mjs 那条渐变 AA 扫描复测。 */
import { readFileSync } from 'node:fs';
import { THEMES } from '../weather-app/js/lib/themes.js';
import {
  AA, AA_MARGIN,
  parseColor, toHex, mixRgb, shiftLum, blurFor, contrast,
  backgroundsOf, worstOf
} from '../weather-app/js/lib/themeScan.js';

const MARGIN = Number(process.env.MARGIN ?? AA_MARGIN);
const COST_CAP = Number(process.env.COST_CAP ?? 8);
const FLOOR = Number(process.env.FLOOR ?? 55);
const css = readFileSync(new URL('../weather-app/styles.css', import.meta.url), 'utf8');

/* 把 body[data-theme="id"] 那一整块刮成 {'--card': '#ffffff', ...}，交给共享判据去读。
 * 刮取放宽到「十六进制或 rgba()」，让判据那边自己按 token 决定收不收 ——
 * 收紧在这里做的话，--veil 那种 rgba 会在刮的阶段就消失，判据连「它存在但读不了」都看不到。 */
const 块文 = id => {
  const i = css.indexOf('body[data-theme="' + id + '"]');
  if (i < 0) throw new Error('styles.css 里找不到 ' + id + ' 的主题块');
  return css.slice(css.indexOf('{', i), css.indexOf('}', i));
};
function tokensOf(id) {
  const t = {};
  for (const m of 块文(id).matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g)) t[m[1]] = m[2];
  return t;
}

/* 在给定 α 下求「最小代价的解」：先给提档 mix（不花钱），不够再挪字色明度（每步 1 分）。 */
const MIX_LIMIT = Number(process.env.MIX_LIMIT ?? 40);
function 解(t, a) {
  const alpha = a / 100;
  const tokens = tokensOf(t.id);
  const ink = parseColor(tokens['--ink']);
  const 表 = { muted: parseColor(tokens['--muted-base']), pop: parseColor(tokens['--pop']), accent: parseColor(tokens['--accent']) };
  const 步数 = { muted: 0, pop: 0, accent: 0 };
  const 方向 = t.base === 'light' ? -1 : 1;    // 浅底往深挪、深底往浅挪，都是往对比更大的那边走
  const 底 = backgroundsOf(t, tokens, alpha);
  let mixNeed = 0;
  const 最差 = () => {
    let min = Infinity, at = '';
    const cands = { ink, muted: mixRgb(表.muted, ink, mixNeed / 100), pop: 表.pop, accent: 表.accent };
    for (const [nm, col] of Object.entries(cands))
      for (const s of 底) {
        const r = contrast(col, s.bg);
        if (r < min) { min = r; at = nm + '@' + s.nm; }
      }
    return { min, at };
  };
  /* 提档优先（不花钱），但上限另设一条：掺到 62% 时 muted 与 ink 已经几乎同色，
   * 两级文字层次就没了 —— 层次也是设计，不是免费的。 */
  let 提档够 = false;
  for (let m = 0; m <= MIX_LIMIT; m++) { mixNeed = m; if (最差().min >= AA + MARGIN) { 提档够 = true; break; } }
  if (!提档够) mixNeed = MIX_LIMIT;
  for (let guard = 0; guard < 600; guard++) {
    const w = 最差();
    if (w.min >= AA + MARGIN) break;
    const nm = w.at.split('@')[0];
    if (nm === 'ink' || 步数[nm] >= 12) return null;   // 主文字不许动；单 token 朝极值挪过 24% 就不叫微调
    表[nm] = shiftLum(表[nm], 方向);
    步数[nm]++;
    if (Object.values(步数).reduce((x, y) => x + y, 0) > COST_CAP) return null;
  }
  const w = 最差();
  if (w.min < AA + MARGIN) return null;
  return { a, mix: mixNeed, blur: blurFor(a), min: w.min, at: w.at,
    代价: Object.values(步数).reduce((x, y) => x + y, 0),
    改色: Object.fromEntries(Object.entries(步数).filter(([, v]) => v).map(([k]) => [k, toHex(表[k])])) };
}

const rows = [];
if (process.argv[2] === '--fix') {
  /* --fix：α 已按设计定在 themes.js 里，这一档回答「这个 α 要配什么才站得住」。
   * 三个 token 分开解，因为 CSS 里只有 --muted 会被 glass.mix 提档
   * （--muted: color-mix(--muted-base, --ink, glass-mix)），--pop / --accent 提不到，
   * 所以「把 mix 一路加到封顶」对那两个一点用都没有 —— 第一版就是这么错的：
   * 六套浅色主题全报 mix=45，其实是 pop@storm 在拖，而 mix 根本管不着它。
   * 规格里的「不达标的单独加深」落到这里就是：够不了线的，把那个 token 朝极值挪几步。 */
  for (const t of THEMES) {
    const tokens = tokensOf(t.id);
    const ink = parseColor(tokens['--ink']);
    const 底 = backgroundsOf(t, tokens, t.glass.a / 100);
    const 方向 = t.base === 'light' ? -1 : 1;
    const 线 = AA + MARGIN;
    const 量 = col => worstOf(col, 底);
    let mixNeed = 0, 提档够 = false;
    for (; mixNeed <= MIX_LIMIT; mixNeed++) {
      if (量(mixRgb(parseColor(tokens['--muted-base']), ink, mixNeed / 100)).min >= 线) { 提档够 = true; break; }
    }
    if (!提档够) mixNeed = MIX_LIMIT;
    const 挪 = name => {
      const 起 = parseColor(tokens['--' + name]);
      let col = 起, steps = 0;
      while (量(col).min < 线 && steps < 12) { col = shiftLum(col, 方向); steps++; }
      return { name, 起, steps, hex: steps ? toHex(col) : '', 不改: 量(起).min, 改后: 量(col).min };
    };
    const 改 = [挪('pop'), 挪('accent')];
    const 全部 = [['ink', 量(ink)], ['muted', 量(mixRgb(parseColor(tokens['--muted-base']), ink, mixNeed / 100))],
      ['pop', 量(改[0].steps ? parseColor(改[0].hex) : 改[0].起)], ['accent', 量(改[1].steps ? parseColor(改[1].hex) : 改[1].起)]];
    const 最差 = 全部.reduce((a, b) => (b[1].min < a[1].min ? b : a));
    console.log(t.id.padEnd(6), 'a=' + String(t.glass.a).padStart(5), 'blur=' + String(t.glass.blur).padStart(2),
      'mix=' + String(mixNeed).padStart(2) + (提档够 ? '' : '(提档到顶仍不够)'),
      '｜改色', 改.filter(x => x.steps).map(x => '--' + x.name + ':' + x.hex + '(' + x.steps + '步)').join(' ') || '不用动',
      '｜最低 ' + 最差[1].min.toFixed(2) + ' @' + 最差[0] + ':' + 最差[1].at,
      最差[1].min >= 线 ? (最差[1].min >= AA + 1 ? '✓余量足' : '✓达标') : (最差[1].min >= AA ? '△压线' : '✗不达'),
      '｜不改色 ' + 改.filter(x => x.steps).map(x => x.name + ' ' + x.不改.toFixed(2)).join(' '));
  }
} else {
  for (const t of THEMES) {
    let best = null;
    for (let a = FLOOR; a <= 100; a += 0.5) {
      best = 解(t, a);
      if (best) break;                       // α 越大越安全 ⇒ 第一个有解的就是最透的合格档
    }
    if (!best) best = { a: 100, mix: MIX_LIMIT, blur: 6, min: NaN, at: '(扫不到解)', 代价: '-', 改色: {} };
    rows.push({ t, best });
  }
  console.log('主题       现值 a/mix/blur      建议 a/mix/blur     最低比 @在哪       代价  改色');
  for (const { t, best } of rows) {
    const 改 = Object.entries(best.改色).map(([k, v]) => '--' + (k === 'muted' ? 'muted-base' : k) + ':' + v).join('  ') || '—';
    console.log(t.id.padEnd(9),
      (t.glass.a + '/' + t.glass.mix + '/' + t.glass.blur).padEnd(18),
      (best.a + '/' + best.mix + '/' + best.blur).padEnd(18),
      (Number.isNaN(best.min) ? '—' : best.min.toFixed(2)) + ' @' + String(best.at).padEnd(14),
      String(best.代价).padStart(3), ' ', 改);
  }
}
