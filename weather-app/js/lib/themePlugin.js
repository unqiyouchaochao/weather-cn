/* 主题插件 —— 用户可导入的 DIY 主题包（单文件 JSON）。
 *
 * 与内置主题的分工：内置那几套住在 lib/themes.js + styles.css，构建期就定死，
 * 由 tools/theme-glass-scan.mjs 验收；插件是运行期导入的，不进构建产物、不进版本库。
 * 两边共用同一把 AA 尺子（lib/themeScan.js），所以「工具说合格」和「应用说合格」是同一件事。
 *
 * 三件事必须一起看，缺一条这个功能就是漏洞而不是特性：
 * ① **不执行代码**。包里没有 JS，只有令牌、渐变、一段受约束的 CSS 和若干图片。
 *    解析全靠 JSON.parse，任何想「让主题跑点逻辑」的请求都应该拒绝 —— 那等于把 XSS 面开进来。
 * ② **CSS 必须限定在自己那一套**。插件的样式会被注进真页面，不锁作用域的话
 *    `body{display:none}` 一行就能把应用弄白屏。这里要求每条选择器都带 [data-theme="<id>"]，
 *    @keyframes 的名字必须含插件 id（免得跟内置的动画抢名字）。
 * ③ **不许引外部资源**。url() 只认包内声明过的 assets/<名字> 与 data:，
 *    远程 URL 一律拒 —— 一是离线是这个 PWA 的核心卖点，二是导入一个会偷偷联网的东西不该是「主题」。
 *
 * 存储分两处（理由见 lib/idb.js 顶部）：轻量的令牌/渐变/CSS 进 localStorage，
 * 图片以 Blob 进 IndexedDB。IDB 打不开时不假装能兜住，退化成「配色能用、图片没有」并如实报出来。 */
import { WEATHER_BG, THEMES, setPluginThemes, pluginThemes } from './themes.js';
import { AA_LINE, worstContrast } from './themeScan.js';
import { idbGet, idbSet, idbDel } from './idb.js';

export const PLUGIN_FORMAT = 'weather-theme/1';
export const LS_KEY = 'weather-theme-plugins';
const STORE = 'plugin-assets';

export const LIMITS = {
  id: /^[a-z][a-z0-9_-]{1,31}$/,
  maxCss: 64 * 1024,
  maxAsset: 1.5 * 1024 * 1024,
  maxTotal: 6 * 1024 * 1024,
  maxAssets: 24,
  maxTokens: 64
};
const TOKEN_RE = /^--[\w-]+$/;
/* applyTheme 运行期往 body 上写这几类属性（--w-* 六条、--glass-a/mix/blur、--lace），
 * 插件若在同名令牌里塞一个值，就会和那次下发抢顺序 —— 谁赢取决于谁后跑，这是隐性 bug 的温床。
 * --surface/--muted 更不行：它们由 17-glass.css 从 --card/--muted-base 派生，
 * 插件直接写死就等于绕过整条 AA 补偿链。所以这些名字一律不收，而不是收下来再排优先级。 */
export const RESERVED_TOKENS = [/^--w-/, /^--glass-/, /^--lace$/, /^--surface$/, /^--muted$/];
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const DATA_URI_RE = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

/* ---------- 校验 ----------
 * 返回 {ok, errors[], warns[]}。errors 非空就不许装 —— 这个项目的纪律是
 * 「文字读不清的主题不该能用」，宁可在导入框里把是哪对配色、比值多少写清楚。 */
export function validate(pkg) {
  const errors = [], warns = [];
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) { errors.push('插件得是一个 JSON 对象'); return { ok: false, errors, warns }; }

  if (pkg.format !== PLUGIN_FORMAT) errors.push('格式不认识：期望 "' + PLUGIN_FORMAT + '"，实际 "' + pkg.format + '"');

  const id = pkg.id;
  if (typeof id !== 'string' || !LIMITS.id.test(id))
    errors.push('id 要小写字母开头、2~32 位，只用 a-z 0-9 _ -（现在的值：' + JSON.stringify(id) + '）');
  else if (THEMES.some(t => t.id === id))
    errors.push('id "' + id + '" 和内置主题撞名了 —— 插件不许顶掉内置主题，否则「切回默认」会切到一个你看不见的定义');

  if (pkg.base !== 'light' && pkg.base !== 'dark') errors.push('base 只能是 "light" 或 "dark"');
  if (typeof pkg.label !== 'string' || !pkg.label.trim()) errors.push('label（主题在下拉里显示的名字）不能空');
  if (typeof pkg.meta !== 'string' || !HEX_RE.test(pkg.meta)) errors.push('meta（状态栏色）要一个十六进制色，如 #f2f7fb');

  /* --- 六条天气渐变：缺一个键就会悄悄继承上一套主题的底色，所以按固定清单逐条查 --- */
  if (!pkg.w || typeof pkg.w !== 'object') errors.push('缺 w（六条天气渐变）');
  else {
    const keys = Object.keys(pkg.w);
    for (const k of WEATHER_BG) {
      const g = pkg.w[k];
      if (typeof g !== 'string' || !g.trim()) { errors.push('w.' + k + ' 缺失或不是一条渐变'); continue; }
      if (!/#[0-9a-fA-F]{3,8}/.test(g)) errors.push('w.' + k + ' 里找不到十六进制色标，判据量不了它');
    }
    for (const k of keys) if (!WEATHER_BG.includes(k)) errors.push('w 里有不认识的天气态 "' + k + '"（只收 ' + WEATHER_BG.join('/') + '）');
  }

  /* --- glass：α 与提档必须一起定，只降 α 不补字色会跌破 AA --- */
  const g = pkg.glass;
  if (!g || typeof g !== 'object') errors.push('缺 glass（卡面透出值）');
  else {
    if (!(Number(g.a) >= 55 && Number(g.a) <= 100)) errors.push('glass.a（不透明度 %）要在 55~100，现在 ' + g.a);
    if (!(Number(g.mix) >= 0 && Number(g.mix) <= 62)) errors.push('glass.mix（次要文字提档 %）要在 0~62 —— 掺过头两级文字就没层次了，现在 ' + g.mix);
    if (!(Number(g.blur) >= 0 && Number(g.blur) <= 18)) errors.push('glass.blur（毛玻璃半径 px）要在 0~18，现在 ' + g.blur);
  }
  if (pkg.lace !== undefined && !(Number(pkg.lace) >= 0 && Number(pkg.lace) <= 40))
    errors.push('lace（装饰强度 %）若给，要在 0~40：再高就不是点缀而是在吃对比度了');

  /* --- 令牌 --- */
  if (!pkg.tokens || typeof pkg.tokens !== 'object') errors.push('缺 tokens（那套 CSS 自定义属性）');
  else {
    const names = Object.keys(pkg.tokens);
    if (names.length > LIMITS.maxTokens) errors.push('令牌太多（' + names.length + ' > ' + LIMITS.maxTokens + '）');
    for (const n of names) {
      if (!TOKEN_RE.test(n)) { errors.push('令牌名要写成 --xxx 的样子：' + n); continue; }
      if (RESERVED_TOKENS.some(re => re.test(n)))
        errors.push(n + ' 是应用自己下发的保留令牌，插件不能声明（写了就会和 applyTheme 抢顺序，或绕过 --muted 的 AA 补偿链）');
    }
    for (const n of ['--bg', '--card', '--ink', '--muted-base', '--pop', '--accent'])
      if (!HEX_RE.test(String(pkg.tokens['--' + n.slice(2)] ?? ''))) errors.push('令牌 ' + n + ' 缺失或不是十六进制色，AA 判据读不了它');
    if (Number(pkg.lace || 0) > 0 && !HEX_RE.test(String(pkg.tokens['--brand'] ?? '')))
      errors.push('声明了 lace 就必须给 --brand（装饰朝它派生）');
  }

  /* --- CSS 作用域与资源 ---
   * assets 先归一化：包里一张图都没声明、css 却 url(assets/x.png) 是最该拦的一种，
   * 但把它写成 if (pkg.assets) 才查，恰好放过这种。 */
  const assets = pkg.assets || {};
  const css = pkg.css;
  if (css !== undefined && typeof css !== 'string') errors.push('css 要给字符串或不给');
  else if (typeof css === 'string' && css.length) {
    if (css.length > LIMITS.maxCss) errors.push('css 超过 ' + LIMITS.maxCss + ' 字节');
    for (const e of checkCssScope(css, id)) errors.push(e);
    for (const e of checkCssUrls(css, assets)) errors.push(e);
  }

  /* --- 素材 --- */
  let total = 0;
  if (pkg.assets !== undefined && (typeof pkg.assets !== 'object' || !pkg.assets || Array.isArray(pkg.assets))) {
    errors.push('assets 要给 {名字: data URI} 或不给');
  } else {
    const names = Object.keys(assets);
    if (names.length > LIMITS.maxAssets) errors.push('素材太多（' + names.length + ' > ' + LIMITS.maxAssets + '）');
    for (const n of names) {
      if (!/^[\w.-]{1,64}$/.test(n) || n.includes('..')) { errors.push('素材名不合法：' + JSON.stringify(n)); continue; }
      const m = DATA_URI_RE.exec(String(assets[n] || ''));
      if (!m) { errors.push('素材 ' + n + ' 不是 png/jpeg/webp/gif 的 base64 data URI'); continue; }
      const bytes = Math.floor(m[3].length * 3 / 4);
      if (bytes > LIMITS.maxAsset) errors.push('素材 ' + n + ' 超过 ' + (LIMITS.maxAsset / 1048576).toFixed(1) + 'MB');
      total += bytes;
    }
    if (total > LIMITS.maxTotal) errors.push('素材合计 ' + (total / 1048576).toFixed(1) + 'MB，超过上限 ' + (LIMITS.maxTotal / 1048576).toFixed(0) + 'MB');
  }

  /* --- AA：形状全对了才量，否则判据会在一堆无关错误上抛异常 --- */
  if (!errors.length) {
    let r;
    try { r = worstContrast(pkg, pkg.tokens); }
    catch (e) { errors.push('对比度量不出来：' + e.message); }
    if (r && !r.pass)
      errors.push('文字对比度不达标：最低 ' + r.min.toFixed(2) + '，要求 ≥ ' + AA_LINE.toFixed(1) +
        '（出问题的组合：' + r.at + '）。改深字色或提高 glass.a 再导。');
  }

  return { ok: errors.length === 0, errors, warns, assetBytes: total };
}

/* 每条选择器都必须带 [data-theme="<id>"]。
 * 逐块走：@media/@supports/@layer/@scope 只是包一层的条件，进去继续查里面的规则；
 * @keyframes 里面是 0%/from/to 这种帧名，不适用选择器规则，改为要求动画名含 id 后整块跳过；
 * @font-face/@property 没有选择器，整块跳过。 */
function checkCssScope(css, id) {
  const bad = [];
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const guard = '[data-theme="' + id + '"]';
  let i = 0, guardCount = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const close = matchBrace(src, open);
    if (close < 0) { bad.push('css 的括号没有配平，不敢注入'); break; }
    const prelude = src.slice(i, open).trim();

    if (/^@(import|charset|namespace)\b/i.test(prelude)) {
      bad.push('css 里不许用 @import / @charset / @namespace（资源只能走包内 assets）');
    } else if (/^@keyframes\b/i.test(prelude)) {
      const nm = prelude.replace(/^@keyframes\s+/i, '').trim();
      if (id && !nm.includes(id)) bad.push('@keyframes 名字必须含插件 id "' + id + '"（现在是 ' + nm + '），否则会和内置动画抢名字');
    } else if (/^@(media|supports|layer|scope)\b/i.test(prelude)) {
      i = open + 1;                                   // 条件块：进去继续查里面的规则
      continue;
    } else if (/^@(font-face|property)\b/i.test(prelude)) {
      /* 放行，但字体源同样受下面那道 url() 检查的管 */
    } else if (prelude.startsWith('@')) {
      bad.push('不认识的 at 规则：' + prelude.split(/[\s{]/)[0]);
    } else if (prelude) {
      for (const sel of prelude.split(',')) {
        const s = sel.trim();
        if (!s) continue;
        if (s.includes(guard)) guardCount++;
        else bad.push('选择器没有锁定在 ' + guard + ' 上：' + s.slice(0, 72));
      }
    }
    i = close + 1;
  }
  if (!bad.length && !guardCount) bad.push('css 里一条 ' + guard + ' 规则都没有，那它其实什么都没做');
  if (/\bexpression\s*\(/i.test(css)) bad.push('css 里有可疑构造');
  return bad;
}

/* 从 open 处那个 { 找配平的 }。字符串里的花括号不算数。
 * 导出给 tools/theme-pkg-check.mjs 用：它扫 css 找大面积装饰规则要走同一套块结构。
 * 不导出的话工具就得自己再写一个配对器，那两个走样时没人知道 —— 判据只一份，走块的方式也只一份。 */
export function matchBrace(s, open) {
  let depth = 0, i = open, q = null;
  for (; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/* url() 只认两种：包内 assets/<名字>、以及 data:。远程一律拒。
 * 素材没声明时 assets 是空对象，于是任何 assets/<名字> 都会报「未声明」—— 正是要的行为。 */
function checkCssUrls(css, assets) {
  const bad = [];
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
    const u = m[2];
    if (u.startsWith('data:')) continue;
    const mm = /^assets\/([\w.-]+)$/.exec(u);
    if (!mm) { bad.push('url() 只能指包内 assets/<名字> 或 data:，现在是：' + u.slice(0, 60)); continue; }
    if (!(mm[1] in assets)) bad.push('url() 引用了未声明的素材：' + mm[1]);
  }
  return bad;
}

/* ---------- 存储 ----------
 * localStorage 只放轻的（不含图片），IndexedDB 放 Blob。 */
function readIndex() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}
function writeIndex(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); return true; }
  catch { return false; }   // 配额 / 无痕：调用方负责报出来，不静默
}

/* 把插件的轻量部分转成 themes.js 认识的那一格（applyTheme 与下拉都吃这个形状）。
 * 刻意不带 assets：图片是异步取的，混进这一格会让「主题定义」掺进可变状态。 */
export function toTheme(record) {
  const t = { id: record.id, label: record.label, base: record.base, meta: record.meta,
    w: record.w, glass: record.glass, plugin: true };
  if (record.lace) t.lace = record.lace;
  return t;
}

export function list() { return readIndex(); }
export function listThemes() { return readIndex().map(toTheme); }
export function has(id) { return readIndex().some(p => p.id === id); }
export function get(id) { return readIndex().find(p => p.id === id) || null; }

/* 把 localStorage 里那份轻量索引同步推进 themes.js 的注册表。
 * 必须同步、必须能被 config.js 在「查无此 id 就换默认」那一步之前调用 ——
 * 慢一步，用户导入的主题就会在启动时被当成不认识而抹掉，而且抹得无声无息。
 * 图片素材不在这条路径上（那是 IDB 的异步活），这里只管「这个 id 存在」。 */
export function refreshPluginIndex() {
  setPluginThemes(listThemes());
  return pluginThemes();
}

/* 导入。校验通过才落盘；图片写 IDB 失败不回滚整个主题 —— 配色是可用的，
 * 只把「图片没存进去」如实报出来，让用户自己决定要不要删。 */
export async function importPkg(pkg) {
  const v = validate(pkg);
  if (!v.ok) return v;

  const record = {
    id: pkg.id, label: pkg.label, base: pkg.base, meta: pkg.meta,
    tokens: pkg.tokens, w: pkg.w, glass: pkg.glass,
    lace: pkg.lace || 0, css: pkg.css || '',
    assetNames: pkg.assets ? Object.keys(pkg.assets) : [],
    installedAt: Date.now()
  };
  const list = readIndex().filter(p => p.id !== record.id);   // 同 id 覆盖重装
  list.push(record);
  if (!writeIndex(list)) return { ok: false, errors: ['本地存储写不进去（配额满了或处于无痕模式），主题没装上'] };

  let assetWarn = '';
  if (record.assetNames.length) {
    try {
      const blobs = {};
      for (const n of record.assetNames) blobs[n] = dataUriToBlob(pkg.assets[n]);
      await idbSet(STORE, record.id, blobs);
    } catch (e) {
      assetWarn = '主题装上了，但图片没能存进本地存储（' + e.message + '）—— 配色与渐变照常，装饰图会缺。';
    }
  }
  urlCache.delete(record.id);
  return { ...v, warns: assetWarn ? [...v.warns, assetWarn] : v.warns, record };
}

export async function remove(id) {
  const list = readIndex().filter(p => p.id !== id);
  const wrote = writeIndex(list);
  try { await idbDel(STORE, id); } catch { /* 图片本来就没存进去过，删不掉就算了 */ }
  urlCache.delete(id);
  return wrote;
}

/* ---------- 素材取用 ----------
 * Blob → object URL，按插件缓存一份，切主题时复用而不是每次重新造
 * （createObjectURL 不 revoke 会漏）。 */
const urlCache = new Map();
export async function assetUrls(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  let blobs = {};
  try { blobs = (await idbGet(STORE, id)) || {}; } catch { blobs = {}; }
  const map = {};
  for (const [n, b] of Object.entries(blobs)) {
    try { map[n] = URL.createObjectURL(b); } catch { /* 没有 Blob URL 的环境：这张图就是缺 */ }
  }
  urlCache.set(id, map);
  return map;
}
/* 已经取到过的才给 —— applyTheme 是同步的，它先用缓存把这一帧画出来，
 * 图片到了之后再补一次。没有这一层的话首屏要么卡在 IDB 上，要么图永远缺。 */
export function cachedAssetUrls(id) { return urlCache.get(id) || null; }

/* 把 css 里的 assets/<名字> 换成真实的 object URL。没取到的换成 1px 透明图，
 * 宁可缺图也不要留一个会去联网请求的坏 URL。 */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
export function applyAssetUrls(css, urls) {
  return String(css).replace(/url\(\s*(['"]?)assets\/([\w.-]+)\1\s*\)/g,
    (_full, _q, name) => 'url(' + (urls[name] || BLANK) + ')');
}

function dataUriToBlob(uri) {
  const m = DATA_URI_RE.exec(String(uri));
  if (!m) throw new Error('不是支持的图片 data URI');
  const bin = atob(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

/* ---------- 预置插件（个人版安装包内嵌） ----------
 * 安装包可以自带若干主题包，首次启动时播进插件区，之后与用户自己导入的完全等价 ——
 * 包括「能删」。开源包里没这个文件，fetch 拿 404 就直接返回，不报错也不播。
 *
 * 墓碑是这段的全部要点：SEED_FLAG 记的是「这个包我们.offer 过一次」，不是「它在不在」。
 * 少记这一笔，用户删掉预置主题后下次启动又被播回来，那「提供删除选项」就是句假话。
 * 失败也照样记：一个装不进去的包不该每次开机都重试一遍、每次都往状态栏挤一条报错。
 * 要换包就升安装包 —— 新的 id 或者新的文件名会被当成没播过的东西。 */
const SEED_FLAG = 'weather-theme-seeded';
const SEED_MANIFEST = 'seed-plugins/manifest.json';

function seededIds() {
  try { const v = JSON.parse(localStorage.getItem(SEED_FLAG) || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function markSeeded(id) {
  const s = new Set(seededIds()); s.add(id);
  try { localStorage.setItem(SEED_FLAG, JSON.stringify([...s])); } catch { /* 写不下就这一轮会重播，不影响正确性 */ }
}

export async function seedFromBundled() {
  let entries;
  try {
    const res = await fetch(SEED_MANIFEST, { cache: 'no-store' });
    if (!res.ok) return { seeded: [], note: '安装包未自带主题' };
    const j = await res.json();
    entries = Array.isArray(j) ? j : [];
  } catch { return { seeded: [], note: '安装包未自带主题' }; }

  const done = new Set(seededIds());
  const seeded = [], failed = [];
  for (const e of entries) {
    if (!e || typeof e.id !== 'string' || typeof e.file !== 'string') continue;
    if (done.has(e.id)) continue;                       // 播过就不再碰，删了也不回来
    markSeeded(e.id);                                   // 先落墓碑：下面无论成败都不该重播
    try {
      const res = await fetch('seed-plugins/' + encodeURIComponent(e.file), { cache: 'no-store' });
      if (!res.ok) { failed.push(e.id + '：包文件读不到（HTTP ' + res.status + '）'); continue; }
      const r = await importPkg(await res.json());
      if (r.ok) seeded.push(e.id);
      else failed.push(e.id + '：' + r.errors[0]);
    } catch (err) { failed.push(e.id + '：' + err.message); }
  }
  if (seeded.length) refreshPluginIndex();
  return { seeded, failed };
}
