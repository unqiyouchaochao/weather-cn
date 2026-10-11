/* 主题与底（一体，不分家）：2026-10-04 起「背景」不再是一个独立模块 —— 六条天气渐变与卡面透出值
 * 都住在 lib/themes.js 那一格里，这里只负责把它下发到 body 上。
 * 谁可以改我：只有改「主题怎么落地」的人。加一套新主题改 lib/themes.js，不动这里。 */
import { el } from '../lib/dom.js';
import { svgIcon } from '../lib/icons.js';
import { BG_STATE } from '../lib/weather.js';
import { themeById, WEATHER_BG } from '../lib/themes.js';
import { get as pluginRecord, assetUrls, cachedAssetUrls, applyAssetUrls } from '../lib/themePlugin.js';

let lastIcon = 'sun';
export function applyBg(icon) {
  if (icon) lastIcon = icon;
  /* 只写一个属性，不再整体重写 body.className —— 以前那一行把 body 的类名变成了天气态独占，
   * 别处想给 body 加个类都会被下一次刷新抹掉（styles.css 里那条注释就是被这事逼出来的）。 */
  document.body.dataset.weather = BG_STATE[lastIcon] || 'clear';
}

/* ---------- 插件主题那一层 ----------
 * 内置主题的令牌住在 styles.css 的 body[data-theme="x"] 块里，插件没有构建期产物，
 * 所以它的令牌要内联写到 body 上、装饰 CSS 要注进一个 <style>。
 * 两件事都必须可回收：切回内置主题或换另一个插件时，上一个的残留要清干净，
 * 否则会出现「删掉的插件的配色还赖在屏上」这种查都没法查的状态。 */
let pluginTokensOn = [];
const STYLE_ID = 'plugin-theme-css';

function clearPluginLayer() {
  for (const n of pluginTokensOn) document.body.style.removeProperty(n);
  pluginTokensOn = [];
  const s = document.getElementById(STYLE_ID);
  if (s) s.remove();
}

/* urls 缺省时先按「图还没有」画出去（applyAssetUrls 会换成 1px 透明图，
 * 而不是留一个会去联网请求的坏地址），素材到了再补一次。 */
function paintPlugin(t, urls) {
  const rec = pluginRecord(t.id);
  if (!rec) { clearPluginLayer(); return; }
  clearPluginLayer();
  for (const [name, val] of Object.entries(rec.tokens || {})) {
    document.body.style.setProperty(name, val);
    pluginTokensOn.push(name);
  }
  if (rec.css) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = applyAssetUrls(rec.css, urls || {});
    document.head.appendChild(style);
  }
}

/* 图片素材是 IDB 异步活。applyTheme 是同步的（渲染路径上到处在调它），
 * 所以这里不 await：先用已缓存的画，没缓存就起一个取，回来时确认还是这一套主题才补画。 */
function ensurePluginAssets(t) {
  if (cachedAssetUrls(t.id)) return;
  assetUrls(t.id).then(urls => {
    if (document.body.dataset.theme === t.id && themeById(t.id).plugin) paintPlugin(t, urls);
  }).catch(() => { /* 取不到图就是没装饰，配色与渐变已经在屏上了 */ });
}

/* ---------- 主题落地（写盘由调用方负责，这里只同步界面） ---------- */
export function applyTheme(id) {
  const t = themeById(id);
  /* 插件层先铺，再下发 --w-* 与 --glass-* 那几样：它们是应用自己算的，
   * 排在后面才保证插件哪怕写了同名值也盖不掉（校验层已经拒了保留名，这是第二道）。 */
  if (t.plugin) { paintPlugin(t, cachedAssetUrls(t.id) || {}); ensurePluginAssets(t); }
  else clearPluginLayer();
  document.body.dataset.theme = t.id;
  /* 天气态底色跟着主题一起走。按 WEATHER_BG 那张固定清单下发，不是遍历 t.w ——
   * 漏写一个键时遍历会静默跳过（屏幕上还是上一套主题的渐变，谁也发现不了）；
   * 走固定清单则会下发 undefined，自定义属性照单收下，var() 一展开 background 就整个塌掉，
   * 断言和肉眼当场看见。失败要响，不能哑。 */
  for (const k of WEATHER_BG) document.body.style.setProperty('--w-' + k, t.w[k]);
  /* 卡面透出值也是主题的设计值（以前它由那根全局滑杆给，见 lib/themes.js 里 glass 那一格的注释）。
   * 三个量一起下发，不许只动 α：--surface 半透之后 --muted 必须朝 --ink 提档，否则次要文字跌破 AA。 */
  document.body.style.setProperty('--glass-a', t.glass.a + '%');
  document.body.style.setProperty('--glass-mix', t.glass.mix + '%');
  document.body.style.setProperty('--glass-blur', t.glass.blur + 'px');
  document.body.style.setProperty('--lace', (t.lace || 0) + '%');
  // 开关的两态要一眼分得开：dark-mode/light-mode 那两张只差「半个圆填不填」，19px 下看不出区别；
  // 改用 ☀（太阳）/🌙（月牙），都是 fill=currentColor，第二参强制走墨色分支跟着按钮字色走。
  el.darkBtn.innerHTML = '<span class="ic">' + svgIcon(t.base === 'dark' ? 'sun' : 'night', true) + '</span>';
  el.darkBtn.title = t.base === 'dark' ? '切到浅色主题' : '切到深色主题';
  if (el.themeSel) el.themeSel.value = t.id;
  // 状态栏/地址栏跟着变色，深色主题下不再是一条刺眼的蓝
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t.meta);
  applyBg();
}
