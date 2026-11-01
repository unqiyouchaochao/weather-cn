/* 材质数学的回归测试：`node tests/glass.test.mjs`
 *
 * 为什么能在 Node 跑：这个模块只算颜色与对比度，不碰 DOM，颜色一律从参数进来。
 * 期望值要么来自外部已知事实（#767676 对白 4.54 是 WCAG 圈公认的「刚好过 AA」边界色），
 * 要么是我按 sRGB 亮度公式手推出来的区间，不是「跑一遍把结果抄回去」。
 *
 * 2026-10-04：滑杆换算（glassFor）与「对任意照片都够」的下限求解（solveFloor / FLOOR_ALPHA）
 * 随背景模块一起退场，这一份少 10 条（27 → 17，按 `git diff d2574e6..41bbdbe` 数出来的 `ok(` 行数）。
 * 「透出值够不够」现在按**已知量**逐主题实测，在 tests/app.checks.mjs 的那条渐变 AA 扫描里。 */
import { parse, relLum, ratio, mix, AA, inkFor, INK_DARK } from '../weather-app/js/lib/glass.js';

let fail = 0;
const ok = (name, cond, got) => {
  if (!cond) { fail++; console.log('FAIL  ' + name + '   got=' + got); }
  else console.log('pass  ' + name);
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;

/* ---------- 解析 ---------- */
ok('parse 十六进制', JSON.stringify(parse('#ffffff')) === '[255,255,255]', JSON.stringify(parse('#ffffff')));
ok('parse 三位缩写', JSON.stringify(parse('#fff')) === '[255,255,255]', JSON.stringify(parse('#fff')));
ok('parse rgb()', JSON.stringify(parse('rgb(31, 42, 55)')) === '[31,42,55]', JSON.stringify(parse('rgb(31, 42, 55)')));
ok('parse rgba 只取前三通道', JSON.stringify(parse('rgba(10, 20, 30, 0.5)')) === '[10,20,30]', JSON.stringify(parse('rgba(10, 20, 30, 0.5)')));

/* ---------- 亮度与对比度：拿外部已知事实钉住 ---------- */
ok('relLum 白 = 1', near(relLum(parse('#ffffff')), 1, 1e-9), relLum(parse('#ffffff')));
ok('relLum 黑 = 0', near(relLum(parse('#000000')), 0, 1e-9), relLum(parse('#000000')));
ok('ratio 黑白 = 21', near(ratio(parse('#000000'), parse('#ffffff')), 21, 1e-6), ratio(parse('#000000'), parse('#ffffff')));
ok('ratio #767676/#fff ≈ 4.54 且过 AA', near(ratio(parse('#767676'), parse('#ffffff')), 4.54, 0.01)
  && ratio(parse('#767676'), parse('#ffffff')) >= AA, ratio(parse('#767676'), parse('#ffffff')));
ok('ratio #777777/#fff 差一点、不过 AA', ratio(parse('#777777'), parse('#ffffff')) < AA, ratio(parse('#777777'), parse('#ffffff')));
ok('ratio 与顺序无关', near(ratio(parse('#767676'), parse('#ffffff')), ratio(parse('#ffffff'), parse('#767676')), 1e-12), 'symmetric');

/* ---------- 混合 ---------- */
ok('mix t=0 取第一色', JSON.stringify(mix(parse('#102030'), parse('#ffffff'), 0)) === '[16,32,48]', JSON.stringify(mix(parse('#102030'), parse('#ffffff'), 0)));
ok('mix t=1 取第二色', JSON.stringify(mix(parse('#102030'), parse('#ffffff'), 1)) === '[255,255,255]', JSON.stringify(mix(parse('#102030'), parse('#ffffff'), 1)));
ok('mix t=0.5 是通道中点', JSON.stringify(mix(parse('#000000'), parse('#ffffff'), 0.5)) === '[128,128,128]', JSON.stringify(mix(parse('#000000'), parse('#ffffff'), 0.5)));

/* ---------- inkFor：给数据语义色挑字色 ----------
 * 六档等级色是从 lib/weather.js 直接取的，不在测试里抄第二份色值 ——
 * 抄了的话，将来有人调等级色而 inkFor 不再适用，这条照样绿。 */
const LV = (await import('../weather-app/js/lib/weather.js')).AQI_LEVELS;
/* inkFor 返回的是 CSS 颜色字符串（要塞进 style），而 ratio 收的是 [r,g,b] —— 两边都得 parse。
 * 第一次跑就是把字符串直接喂给 ratio，relLum 里 undefined 一路算成 NaN，`NaN >= 4.5` 恒假 ⇒
 * 看着像实现坏了，其实是断言自己写错。这条形状以后再改 inkFor 时要记得。 */
const inkRatio = bg => ratio(parse(inkFor(bg)), parse(bg));
ok('AQI 六档等级色配 inkFor 给的字色全部过 AA', LV.every(l => inkRatio(l.color) >= AA),
  LV.map(l => l.label + ' ' + inkRatio(l.color).toFixed(2)).join(' · '));
ok('亮档（良 #d9a514）挑近黑、暗档（严重污染 #7b1f2b）挑白', inkFor('#d9a514') === INK_DARK && inkFor('#7b1f2b') === '#ffffff',
  '良→' + inkFor('#d9a514') + '，严重→' + inkFor('#7b1f2b'));
/* 外部已知事实：黑与白这两个候选之间，白底上必输、黑底上必赢。这条与上面那条不同源，
 * 防的是「把两个分支写反」—— 反了的话六档里总有几档仍 ≥4.5，只有这两张极端底能当场抓住。 */
ok('纯白底必得近黑、纯黑底必得白', inkFor('#ffffff') === INK_DARK && inkFor('#000000') === '#ffffff',
  inkFor('#ffffff') + ' / ' + inkFor('#000000'));
ok('inkFor 只会从黑/白里挑，不产第三种颜色', LV.concat([{ color: '#808080' }, { color: '#123456' }])
  .every(l => inkFor(l.color) === INK_DARK || inkFor(l.color) === '#ffffff'),
  LV.map(l => inkFor(l.color)).join(' '));

console.log(fail ? `\n${fail} 条失败` : '\n全绿');
process.exit(fail ? 1 : 0);
