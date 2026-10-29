/* 主题对比度判据 —— 一把尺子，两个地方用它量。
 *
 * 为什么单独一个文件：这套 AA 判据原先只活在 tools/theme-glass-scan.mjs 里。
 * 主题插件功能要在校验导入时量一遍同样的东西，如果各写一份，就会出现
 * 「离线工具说合格、应用里也显示合格，但两个算法其实不一样」—— 而这个项目最怕的就是
 * 读数判不动却被当成「那一支底不存在」（tools 里那段 rgba 被静默跳过的注释就是教训）。
 * 所以判据只这一份，Node 工具 import 它，浏览器也 import 它。
 *
 * 谁可以改我：改 AA 线、改「字底下会遇到哪些底」的取法，都只改这里。
 *
 * 判据本体：每套主题 × 自己的六个渐变 × 四个色标（主文字 / 次要文字 / --pop / --accent），
 * 次要文字按主题的 glass.mix 掺过 --ink 之后一起量。达标线 = AA(4.5) + MARGIN(0.5) = 5.0。
 * 留 0.5 的余量是因为真机上卡面底下是「模糊过的复合」，量到的不是这两个纯色标，压线过关不算过关。
 *
 * 字底下可能垫着的底分四支，少算任何一支都会「离线全绿、屏上不达」：
 * ① 悬在页面上的卡面：复合色 = α·card + (1−α)·底。底取页面 --bg 与六个渐变的两个端点
 *    （复合色对底单调 ⇒ 端点就包住了整条渐变，中间不会更坏，WCAG F83 的取法）。
 * ② 卡面里再垫的子面板（--hint-bg / --code-bg / --field-bg / --ok-bg / --err-bg）：
 *    它们自己半透在卡面上，但**不吃 α**，所以这一支只受提档 mix 影响。
 * ③ 弹窗那一支：面板 = α·card + (1−α)·遮罩，遮罩 = --veil 压在页面底上。
 *    少算这一支就会漏掉最坏的那一格：2026-10-04 离线说每套 ≥5.0，跑批里正文只剩 4.53。
 * ④ 装饰那一维（lace）：缎面画在卡面之上 ⇒ 满额一次；地纹画在卡面之下 ⇒ 只有 (1−α) 漏上来。
 *    浏览器那条逐元素扫描看不见它（color-mix 吐 color(srgb …/a)，伪元素也不在祖先链里），
 *    所以这一支只有这把尺子在管。 */

export const AA = 4.5;
export const AA_MARGIN = 0.5;
export const AA_LINE = AA + AA_MARGIN;
export const MIX_CAP = 62;          // 提档封顶：再多就把次要文字变成主文字了
export const SUB_PANELS = ['hint-bg', 'code-bg', 'field-bg', 'ok-bg', 'err-bg'];

/* ---------- 颜色读数 ----------
 * 两套写法都要吃下：十六进制（含 8 位带 alpha）与 rgb()/rgba()。
 * 读不出来一律抛错 —— 静默跳过等于把那一支底从验收里删掉。 */
export function parseColor(c) {
  const s = String(c).trim();
  const f = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (f) return [+f[1], +f[2], +f[3]];
  const h = s.replace('#', '');
  const g = h.length === 3 ? h.split('').map(x => x + x).join('') : h.slice(0, 6);
  const out = [0, 2, 4].map(i => parseInt(g.slice(i, i + 2), 16));
  if (out.some(Number.isNaN)) throw new Error('读不出这个颜色：' + c);
  return out;
}

/* 只有十六进制才谈得上「带 alpha 的 8 位」；rgba() 走另一条。读不出 alpha 就当不透明。 */
export function alphaOf(c) {
  const s = String(c).trim();
  const m = /^#[\da-fA-F]{8}$/.exec(s);
  if (m) return parseInt(s.slice(7, 9), 16) / 255;
  const r = /rgba?\(\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+\s*[,/]\s*([\d.]+)/.exec(s);
  return r ? parseFloat(r[1]) : 1;
}

export const toHex = rgb => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

function lin(v) { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
export const relLum = rgb => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);

export function contrast(a, b) {
  const x = relLum(a), y = relLum(b);
  if (Number.isNaN(x) || Number.isNaN(y)) throw new Error('读不出色：' + JSON.stringify([a, b]) + ' —— 不许把它当成「这一支底不存在」');
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export const mixRgb = (a, b, t) => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t));

/* 往「更安全」的那一端挪一步：浅底主题加深（朝黑插 2%），深底主题提亮（朝白插 2%）。
 * 朝极值插值在 RGB 里保色相角，所以改的是深浅与饱和，不会把它换成另一种颜色。 */
export const shiftLum = (rgb, dir) => mixRgb(rgb, dir < 0 ? [0, 0, 0] : [255, 255, 255], 0.02);

/* 毛玻璃半径跟着 α 走（越透越要糊得狠才压得住底纹），区间收在 6~18px。 */
export const blurFor = a => Math.max(6, Math.min(18, Math.round(4 + 14 * (100 - a) / 24)));

export const gradientStops = g => (String(g).match(/#[0-9a-fA-F]{3,8}\b/g) || []);

/* ---------- 令牌读取 ----------
 * tokens 是一套主题的 {'--card': '#ffffff', ...} 原样字符串表。
 * 内置主题由 tools 从 styles.css 刮出来喂进来，插件主题直接用它包里的 tokens。 */
function tok(tokens, name) {
  const v = tokens['--' + name];
  if (v === undefined) throw new Error('主题缺 --' + name);
  if (!/^#[0-9a-fA-F]{3,8}$/.test(String(v).trim())) throw new Error('--' + name + ' 不是十六进制，扫描器读不了：' + v);
  return String(v).trim();
}
function tokRaw(tokens, name) {
  const v = tokens['--' + name];
  if (v === undefined) throw new Error('主题缺 --' + name);
  return String(v).trim();
}

/* ---------- 底集：这套主题的字真会遇到的每一块底 ---------- */
export function backgroundsOf(theme, tokens, alpha) {
  const card = parseColor(tok(tokens, 'card'));
  const 页面 = [{ nm: 'bg', col: parseColor(tok(tokens, 'bg')) }];
  for (const [state, g] of Object.entries(theme.w))
    for (const s of gradientStops(g)) 页面.push({ nm: state + '@' + s, col: parseColor(s) });
  const out = 页面.map(p => ({ nm: p.nm, bg: mixRgb(card, p.col, 1 - alpha) }));

  for (const nm of SUB_PANELS) {
    let v;
    try { v = tokRaw(tokens, nm); } catch { continue; }
    const c = parseColor(v), a = alphaOf(v);
    out.push({ nm: '面板/' + nm, bg: a >= 1 ? c : mixRgb(c, card, 1 - a) });
  }

  try {
    const v = tokRaw(tokens, 'veil'), vc = parseColor(v), va = alphaOf(v);
    for (const p of 页面) out.push({ nm: '弹窗/' + p.nm, bg: mixRgb(card, mixRgb(vc, p.col, 1 - va), 1 - alpha) });
  } catch { /* 这套没有 --veil 就不量这一支（浏览器里那条真实配对扫描会兜住） */ }

  const lace = Number(theme.lace || 0) / 100;
  if (lace > 0) {
    const 墨 = parseColor(tok(tokens, 'brand'));
    const 叠 = (bg, 满, 漏) => mixRgb(mixRgb(bg, 墨, 满), 墨, 漏);
    for (const s of out.slice()) out.push({ nm: s.nm + '+装饰', bg: 叠(s.bg, s.nm.startsWith('弹窗/') ? 0 : lace, (1 - alpha) * lace) });
  }
  return out;
}

/* 四个被验收的字色。muted 是提档之后的那个 —— 屏幕上跑的就是它。 */
export function textColors(tokens, mixPct) {
  const ink = parseColor(tok(tokens, 'ink'));
  return {
    ink,
    muted: mixRgb(parseColor(tok(tokens, 'muted-base')), ink, (mixPct || 0) / 100),
    pop: parseColor(tok(tokens, 'pop')),
    accent: parseColor(tok(tokens, 'accent'))
  };
}

/* 一个色压在整套底上的最差读数。 */
export function worstOf(color, bgs) {
  let min = Infinity, at = '';
  for (const b of bgs) { const r = contrast(color, b.bg); if (r < min) { min = r; at = b.nm; } }
  return { min, at };
}

/* 整套主题的最差读数：{min, at, line, pass, bgs, colors}。
 * alpha 不传就用主题自己声明的 glass.a —— 校验一个现成的主题（含插件）走这条。 */
export function worstContrast(theme, tokens, alpha) {
  const a = alpha === undefined ? theme.glass.a / 100 : alpha;
  const bgs = backgroundsOf(theme, tokens, a);
  const colors = textColors(tokens, theme.glass.mix);
  let min = Infinity, at = '';
  for (const [nm, col] of Object.entries(colors)) {
    const w = worstOf(col, bgs);
    if (w.min < min) { min = w.min; at = nm + '@' + w.at; }
  }
  return { min, at, line: AA_LINE, pass: min >= AA_LINE, bgs, colors };
}
