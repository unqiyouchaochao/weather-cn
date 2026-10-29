/* 主题插件那六道闸的离线测试 —— 纯 Node，不碰浏览器，`node tests/theme-pkg.test.mjs` 一秒跑完。
 *
 * 为什么单独有它：themePlugin.js 与 themeScan.js 现在**不在** tools/falsify/files.mjs 的 F 表里，
 * 变异表对这两个文件零命中 —— 也就是整条「导入时校验」的链子没有任何东西在盯。
 * 仓库纪律（README:71）是每条新断言都要配一处「改坏它」，但 falsify 靠 spawnSync 跑浏览器回归，
 * 那条通道目前被 0×0 的应用内面板卡死，改了也证明不了改对。所以先在这里造**能跑能红**的断言，
 * 等浏览器通道恢复再把它们登记进 F 表 —— 那时是干净尾巴，不是坑。
 *
 * 输出形状是**契约**，别照抄 tests/glass.test.mjs：
 *   falsify.mjs:70 数的是 (out.match(/^PASS/gm)||[]).length，而 glass.test 打的是小写 `pass`
 *     ⇒ 照抄会让总数算成 0，撞上「什么都没测却报全绿」那道闸（exit 93~98）。
 *   falsify.mjs:65 抓失败用的是 /^FAIL\s+(.+?)\s+⟵/，而 glass.test 打的是 `FAIL 名字   got=x`
 *     ⇒ 没有 `⟵` 就一条都匹配不到，变异永远「没回来」，那条断言等于摆设。
 * 所以这里固定打大写 PASS 行首，失败行是 `FAIL 名字 ⟵ 明细`。
 *
 * 基准包内联合成，不读 private/ —— 那目录是 gitignore 的个人版素材，测试不能依赖它。 */
import { validate } from '../weather-app/js/lib/themePlugin.js';
import { worstContrast, AA_LINE } from '../weather-app/js/lib/themeScan.js';

/* ---------- 基准包：一份形状全对、对比度有裕量的浅色骨架 ----------
 * 字色压在最暗的 storm 端点上也还有余量，这样「加一处缺陷就红」才说明是那一处的功劳。 */
const 基准 = () => ({
  format: 'weather-theme/1',
  id: 'probe',
  label: '验收探针',
  base: 'light',
  meta: '#f4f6f8',
  w: {
    clear: 'linear-gradient(160deg, #cfe6f7, #f4f6f8)',
    cloud: 'linear-gradient(160deg, #d5dfe8, #f1f4f7)',
    rain: 'linear-gradient(160deg, #b3c6d8, #e7edf3)',
    snow: 'linear-gradient(160deg, #e6f0fa, #f8fafd)',
    storm: 'linear-gradient(160deg, #8fa2b8, #c6d2de)',
    fog: 'linear-gradient(160deg, #dae3eb, #f3f6f9)'
  },
  glass: { a: 88, mix: 12, blur: 12 },
  lace: 0,
  tokens: {
    '--bg': '#f4f6f8', '--card': '#ffffff', '--ink': '#12192a', '--muted-base': '#404c60',
    '--line': '#e3e8ee', '--brand': '#2a5a8c', '--accent': '#1c4f7c', '--pop': '#1c4f7c',
    '--hero-ink': '#ffffff', '--field-bg': '#ffffff', '--hint-bg': '#eef2f7',
    '--hint-line': '#dde4ec', '--code-bg': '#e9eef5', '--veil': 'rgba(16, 24, 36, 0.5)',
    '--ok-bg': '#eaf4ee', '--ok-ink': '#2c6b3d', '--ok-line': '#cbe2cf',
    '--err-bg': '#fbecec', '--err-ink': '#a8291f', '--err-line': '#f3cdc7'
  }
});

let 通过 = 0, 失败 = 0;
function 断言(名, 判, 明细) {
  if (判 === true) { 通过++; console.log('PASS ' + 名); return; }
  失败++;
  console.log('FAIL ' + 名 + ' ⟵ ' + (判 === false ? (明细 || '没通过') : 明细 || '异常：' + 判));
}
/* 只回「因为什么拒的」，好让下面的断言能盯住具体那一道闸而不是「反正报错了」 */
function 拒因(pkg) {
  const v = validate(pkg);
  return v.ok ? null : v.errors.join(' | ');
}

/* ---------- ⓪ 基准 ----------
 * 这条不是闸，是地基：基准自己要是不合格，下面「加一处缺陷就该红」全都不成立。 */
断言('基准包本身可导入', (() => { const v = validate(基准()); return v.ok || v.errors.join(' | '); })());

/* ---------- ① 保留令牌拒收 ----------
 * --glass-* / --w-* / --lace / --surface / --muted 由应用运行期下发，插件写死就会和 applyTheme
 * 抢顺序，或直接绕过 --muted 的 AA 补偿链。 */
{
  const p = 基准();
  p.tokens['--glass-a'] = '#ffffff';
  const 因 = 拒因(p);
  断言('保留令牌 --glass-a 必须拒收', 因 && /保留令牌/.test(因), '实际：' + (因 || '居然放行了'));
}

/* ---------- ② CSS 作用域守卫 ----------
 * 插件的样式会注进真页面，一条不带 [data-theme] 的选择器就能把应用弄白屏。 */
{
  const p = 基准();
  p.css = 'body { display: none; }';
  const 因 = 拒因(p);
  断言('不锁作用域的 CSS 必须拒收', 因 && /没有锁定在/.test(因), '实际：' + (因 || '居然放行了'));
}

/* ---------- ③ 未声明素材必须拦（这一条是复刻历史 bug 的形状） ----------
 * 校验器早期把 url 检查写在 `if (pkg.assets !== undefined)` 里面，于是「一张图都没声明、
 * css 却 url(assets/x.png)」这一种最该拦的反而整个逃过检查。现在 assets 先归一化成
 * `pkg.assets || {}`，这一条就是钉住那个归一化别被「顺手加个 if」改回去。 */
{
  const p = 基准();
  p.css = 'body[data-theme="probe"]::before { background: url(assets/ghost.png); }';
  const 因 = 拒因(p);                       // 故意不给 pkg.assets
  断言('引用未声明素材必须拒收（无 assets 字段时也要查）', 因 && /未声明的素材/.test(因),
    '实际：' + (因 || '居然放行了'));
}

/* ---------- ④ AA 不达标必须拒 ---------- */
{
  const p = 基准();
  p.tokens['--muted-base'] = '#c3ccd6';      // 压到最暗的 storm 卡面上只剩 1.6 上下
  const 因 = 拒因(p);
  断言('文字对比度不达标必须拒收', 因 && /对比度不达标/.test(因), '实际：' + (因 || '居然放行了'));
}

/* ---------- ⑤ 缺 --veil 会静默少量一整族底 ----------
 * themeScan.js:110 那一支包在 catch 里、注释写的是「这套没有 --veil 就不量这一支」——
 * 缺 --veil 时「弹窗」那一族直接从验收里消失，而 validate 不强制它，
 * 于是包可以拿着一个「少算了一族」的 ≥5.0 过关。
 * 2026-10-04 就漏在这里：离线说每套 ≥5.0，真机正文只剩 4.53。 */
{
  const 带 = worstContrast(基准(), 基准().tokens);
  const 缺包 = 基准(); delete 缺包.tokens['--veil'];
  const 缺 = worstContrast(缺包, 缺包.tokens);
  断言('--veil 缺席会让「弹窗」那一族底消失',
    带.bgs.some(b => b.nm.startsWith('弹窗/')) && !缺.bgs.some(b => b.nm.startsWith('弹窗/')) && 缺.bgs.length < 带.bgs.length,
    '弹窗条数 带=' + 带.bgs.filter(b => b.nm.startsWith('弹窗/')).length + ' 缺=' + 缺.bgs.filter(b => b.nm.startsWith('弹窗/')).length +
      ' · 总底数 带=' + 带.bgs.length + ' 缺=' + 缺.bgs.length);
}

/* ---------- ⑥ 装饰那一维只有这把尺子在管 ----------
 * lace 画在卡面之上（满额）与之下（按 1−α 漏出），浏览器那条逐元素扫描看不见它：
 * color-mix 吐的是 color(srgb …/a)，伪元素也不在祖先链里。所以这一支删掉就再没人管。 */
{
  const 无 = worstContrast(基准(), 基准().tokens);
  const 花 = 基准(); 花.lace = 30;
  const 有 = worstContrast(花, 花.tokens);
  const 装饰 = 有.bgs.filter(b => b.nm.endsWith('+装饰'));
  const 变暗 = 装饰.some(d => {
    const 原 = 有.bgs.find(b => b.nm === d.nm.replace('+装饰', ''));
    return 原 && (d.bg[0] + d.bg[1] + d.bg[2]) < (原.bg[0] + 原.bg[1] + 原.bg[2]);
  });
  断言('lace > 0 时要生成「+装饰」那一族底、且真的朝 --brand 压暗',
    无.bgs.every(b => !b.nm.endsWith('+装饰')) && 装饰.length > 0 && 变暗,
    '装饰条数=' + 装饰.length + ' 变暗=' + 变暗 + ' · 最低比 无装饰=' + 无.min.toFixed(3) + ' 有装饰=' + 有.min.toFixed(3));
}

/* ---------- 收尾 ----------
 * 一条都没跑成也算失败：全绿但 0 条，和 falsify 那道「什么都没测却报全绿」是同一个观念。 */
if (通过 + 失败 === 0) { console.log('FAIL 计数归零 ⟵ 一条断言都没跑到'); 失败++; }
console.log('\n' + (失败 ? 失败 + ' 条失败' : '全绿 ' + 通过 + ' 条 · 达标线 ' + AA_LINE.toFixed(1)));
process.exit(失败);
