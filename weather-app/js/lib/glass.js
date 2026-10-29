/* 材质数学 —— 颜色解析、WCAG 对比度、按底色挑字色。
 *
 * 2026-10-04 这一格里退掉了两样东西，都随「背景模块取消」一起走的（见 js/lib/themes.js 的 w / glass）：
 *   · glassFor(chip)：把滑杆那一档换算成 α / 提档比例 / 模糊半径。滑杆没了，三个量直接写在每套主题的
 *     glass 那一格里，换算层成了多余的一层间接。
 *   · solveFloor() 与 FLOOR_ALPHA=0.76：那是「对**任意一张**用户照片都够不够」的证明 ——
 *     复合色对 photo 单调，所以只需测纯黑/纯白两个端点。照片入口取消之后，
 *     底只剩主题自己的六个渐变，是**已知量**，于是那条证明失去了对象，改由逐主题逐渐变实测（S5）。
 * 留下来的这几个还是唯一真值：AA 门槛、sRGB 线性化、复合公式、徽章挑字色。
 * 一条来自 W3C 的事实值得记住：**F83/G18 里没有任何一条把「模糊」当作可读性手段**，
 * 判法是取背景里最亮/最暗的那块局部去和文字比 —— 所以这套数学从不指望 blur 救谁。 */

export const AA = 4.5;

/* ---------- 颜色 ---------- */
export function parse(c) {
  const s = String(c || '').trim();
  let m = /^#([\da-f]{3})$/i.exec(s);
  if (m) return [1, 2, 3].map(i => parseInt(m[1][i - 1].repeat(2), 16));
  m = /^#([\da-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (m) return [+m[1], +m[2], +m[3]];
  return [0, 0, 0];
}

function lin(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relLum(rgb) {
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

export function ratio(a, b) {
  const x = relLum(a), y = relLum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function mix(a, b, t) {
  return [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t));
}

/* ---------- 给「数据语义色」挑字色 ---------- */
/* AQI 等级色这类颜色是 inline 塞进 DOM 的，背后没有主题可依赖：写死白字压在中度污染那一档
 * 只剩 4.18、压在「良」那一档只剩 2.25（12px 要 4.5）。这里按底色取比值更高的那一端。
 * 不用 CSS 的 contrast-color()：它只保证大字 3:1，而且本机 WebView 114 与真机 131 都不支持。
 * 黑端用近黑 #12100f 而不是纯黑：界面上别处没有纯黑，一枚 100% 黑的字会在彩色徽章上形成一个
 * 与谁都不相邻的极值。换成纯黑只会让比值更高（黑端越暗比越光越大），所以这是观感选择，不是可达性选择。 */
export const INK_DARK = '#12100f';
export function inkFor(bg) {
  const b = parse(bg);
  return ratio(parse(INK_DARK), b) >= ratio([255, 255, 255], b) ? INK_DARK : '#ffffff';
}
