/* 注入到被测页面自己的 realm 里跑的断言（由 tests/run.html 以 <script type="module"> 塞进 iframe）。
 *
 * 为什么在页面里跑而不是在 Node 里读文件：这一轮的卡死根因是「computed style 与实际图层数」，
 * 只有真 DOM + 真 CSS + 真模块能回答。断言一律走公开入口（模块导出、DOM 事件），不碰内部实现。
 *
 * 用绝对路径 import：被测页是 /weather-app/index.html，它经 js/main.js 一路 import 到
 * /weather-app/js/ui/rank.js，这里写同一个 URL 拿到的就是同一个模块实例（状态共享，不是第二份）。 */

const R = [];
const push = (name, ok, detail) => { R.push({ name, ok: !!ok, detail: String(detail) }); window.__P = R.length + ' ' + name; };   // 卡住时唯一能看出停在哪一条的针
/* 第一条断言之前的那几十行（等首屏、开玻璃、等榜单）一步卡住，光看 __P 会以为「一条都没跑」，
 * 其实是跑到第 0 步就停了。所以起步阶段单独留一个针。 */
const mark = s => { window.__S = s; };
/* 等位要用两条腿走：
 *   · setTimeout 单独用不行 —— 回归页常年开在后台标签里，Chrome 的省电节流把定时器压到每分钟一次
 *     （实测 sleep(300) 实跑 1009ms），二十几个 sleep 就是二十几分钟，看板上和「代码卡死」一模一样。
 *   · MessageChannel 单独用也不行 —— 头无头 Edge（EdgeCore 精简版）里 port 的 onmessage 根本不派发
 *     （实测注入的外链模块只跑到第一个 await 就再也不往下），只认这条腿的 sleep 在那里永久不返回。
 * 两条腿一起挂，谁先到点谁算，两边都能跑。 */
const sleep = ms => new Promise(res => {
  const t0 = performance.now();
  let ch;
  const done = () => { clearTimeout(id); if (ch) { try { ch.port1.close(); } catch {} } res(); };
  const id = setTimeout(done, ms);
  ch = new MessageChannel();
  ch.port1.onmessage = () => { if (performance.now() - t0 >= ms) done(); else ch.port1.postMessage(0); };
  ch.port1.postMessage(0);
});

mark('import 两个 lib 之前');
/* 原先这里还 import 了 lib/backgrounds.js 用来开玻璃/选图 —— 那个模块 2026-10-04 整个删了，
 * 玻璃现在恒开（值由主题给），harness 不再需要任何开关。 */
const rank = await import('/weather-app/js/ui/rank.js');
const glass = await import('/weather-app/js/lib/glass.js');
mark('两个 lib 都到手');

const blurLayers = root => {
  let n = 0;
  for (const e of (root || document).querySelectorAll('*')) {
    const s = getComputedStyle(e);
    if (s.backdropFilter && s.backdropFilter !== 'none') n++;
  }
  return n;
};
/* 计算值有三种写法都要吃下：rgb()（三分量=实底）、rgba()，以及 color-mix 在 Chromium 里实际吐出的
 * `color(srgb 1 1 1 / 0.76)`。这里踩过两次：只判 rgba 会把「半透」读成「实底」，
 * 而贪婪地取最后一个数字又会把 rgb(255,255,255) 读成 alpha=255。断言写空比没断言更糟。 */
const alphaOf = sel => {
  const n = document.querySelector(sel);
  if (!n) return null;
  const s = getComputedStyle(n).backgroundColor;
  const slash = /\/\s*([\d.]+)\s*\)/.exec(s);
  if (slash) return parseFloat(slash[1]);
  const four = /^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/.exec(s);
  if (four) return parseFloat(four[1]);
  return 1;
};

/* ---------- 计算色的读数（全文件共用一把） ----------
 * 写法比想象多：#hex / rgb() / rgba(…, a) / 现代空格语法 rgb(255 255 255 / .9) /
 * color-mix 在 Chromium 里吐成 `color(srgb 1 1 1 / 0.892)` / 掺了 ink 补偿的 --muted 直接吐 `oklab(…)`。
 * 这一把梭踩过两次：v110 为图标（glass.parse 读不出 color(srgb) 就当成纯黑，11 套 × 全部图标报成 1.12），
 * v112 为玻璃合成器（S2 之后玻璃恒开，.modal-card 那层 color-mix 因为「读不出来」被整个**跳过**，
 * 于是拿遮罩色去比面板里的字，报出一场假红）。
 * 规矩没变：判不动就返回 null，绝不拿黑当读数 —— 当成黑会把「通道坏了」伪装成「配色不行」。 */
const oklabToRgb = (L, A, B) => {
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = L - 0.0894841775 * A - 1.2914855480 * B;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const f = c => { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.round(Math.max(0, Math.min(1, v)) * 255); };
  return [f(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    f(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    f(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)];
};
const α = x => (x === undefined || x === null ? 1
  : (String(x).indexOf('%') >= 0 ? parseFloat(x) / 100 : parseFloat(x)));
const 读色 = s => {
  s = String(s == null ? '' : s).trim();
  let m = /^#([\da-f]{6})([\da-f]{2})?$/i.exec(s);
  if (m) return { col: [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)), a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  m = /^#([\da-f]{3})$/i.exec(s);
  if (m) return { col: m[1].split('').map(c => parseInt(c + c, 16)), a: 1 };
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i.exec(s);
  if (m) return { col: [+m[1], +m[2], +m[3]], a: α(m[4]) };
  m = /^color\(\s*srgb\s+([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/i.exec(s);
  if (m) return { col: [m[1], m[2], m[3]].map(x => Math.round(Math.max(0, Math.min(1, +x)) * 255)), a: α(m[4]) };
  m = /^oklab\(\s*([\d.]+%?)[\s,]+(-?[\d.]+%?)[\s,]+(-?[\d.]+%?)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/i.exec(s);
  if (m) {
    const n = x => (x.indexOf('%') >= 0 ? parseFloat(x) / 100 : parseFloat(x));
    /* oklab 的 L 是 0~1（或百分数），a/b 是 -0.4~0.4（百分数时要除 100）；三个分量走同一个口子 */
    return { col: oklabToRgb(n(m[1]), n(m[2]), n(m[3])), a: α(m[4]) };
  }
  return null;
};
const 色 = s => { const r = 读色(s); return r ? r.col : null; };
/* 问一个 token 是什么颜色，不能直接读它的计算值：没注册的自定义属性只把 var() 展开，
 * `color-mix(...)` 会**原样留在计算值里不求值**（S2 之后 --muted/--surface 就是这种形状，于是读成 null，
 * 三场 AA 扫描的「这是不是主题给的字色」判据当场失去对象，覆盖数从 200+ 掉到 88 —— 又是通道，不是配色）。
 * 所以过一道真元素：写在 color 上，Chromium 就会把整串算成 rgb()/color(srgb …) 给你。 */
const 探针 = document.createElement('span');
探针.style.cssText = 'position:absolute;left:-9999px;width:0;height:0;overflow:hidden';
const token色 = name => {
  document.body.appendChild(探针);
  探针.style.color = 'var(' + name + ')';
  const out = 色(getComputedStyle(探针).color);
  探针.remove();
  return out;
};

/* 等首屏真的画出来，否则 .day 还不存在，后面全是空断言
   （以前探的是 .chart，那张趋势图整块已在 2026-09-26 删掉） */
mark('等首屏 .day');
for (let i = 0; i < 40 && !document.querySelector('.day'); i++) { await sleep(250); mark('等首屏 .day ' + (i + 1) + '/40'); }
mark('首屏到手，先验玻璃真的开着');

/* 玻璃不需要「打开」了：2026-10-04 起它恒开，α 由当前主题的 glass.a 那一格给（原来是拉满的 chip=0
 * ⇒ α76%/blur18px 这一档最贵；现在是逐主题 64%~89%，见 js/lib/themes.js 的 glass）。
 * alpha 仍要等一帧才落，同一 task 里读会读到旧值 —— 实测读到过「blur 已经挂上 72 层、alpha 却仍是 1」
 * 的假红。等到真生效再数层数；始终不生效则循环走完照样红。 */
let heroA = alphaOf('.day');
for (let i = 0; i < 30 && !(heroA < 1); i++) { await sleep(100); heroA = alphaOf('.day'); mark('等 alpha 落帧 ' + (i + 1) + '/30'); }
mark('数全页模糊层');
const glassOn = blurLayers(document);
push('主页卡面确实是玻璃（别一刀切掉）', heroA != null && heroA < 1 && glassOn > 0,
  '.day alpha=' + heroA + '，全页模糊层=' + glassOn);

/* 空气排名：360 行 */
rank.open('北京');
for (let i = 0; i < 40 && document.querySelectorAll('#rankList .rank-row').length < 100; i++) { await sleep(250); mark('等排名整榜 ' + (i + 1) + '/40'); }
const rows = document.querySelectorAll('#rankView .rank-row').length;
const rankLayers = blurLayers(document.getElementById('rankView'));
/* 必须先确认真的建出了 360 行，再谈「层数 ≤32」：数据没到 ⇒ 0 行 ⇒ 0 层 ⇒ 这条自己就绿了。
 * 同一形状的假绿这轮在真机上也踩过一次（锁屏时 gfxinfo 全 0）。 */
push('排名真的建出了整榜（后面那条 ≤32 才有意义）', rows >= 300, '建出 ' + rows + ' 行');
push('排名浮层的模糊层数有上限（≤32）', rows >= 300 && rankLayers <= 32,
  '行 ' + rows + ' 条，浮层内模糊层 ' + rankLayers + ' 层（浮层自己是不透明底，糊它零收益）');
const rowA = alphaOf('#rankView .rank-row');
push('浮层内卡面是实底（半透会改掉量过的 AA 配对）', rowA === 1, '#rankView .rank-row alpha=' + rowA);

/* 关闭路径：动画 promise 永不 settle 时，也必须落回 hidden —— 否则 body 的 overflow:hidden 永久锁住，
   表现就是用户说的「应用卡死」：界面在，滚不动、点不动。 */
const realAnimate = Element.prototype.animate;
Element.prototype.animate = function () { return { finished: new Promise(() => {}), cancel() {} }; };
rank.close();
await sleep(500);
Element.prototype.animate = realAnimate;
const view = document.getElementById('rankView');
push('动画 promise 不 settle 时浮层仍会关闭', view.hidden === true, 'hidden=' + view.hidden);
push('关掉后背景滚动锁解除', !document.body.dataset.sheet && getComputedStyle(document.body).overflow !== 'hidden',
  'data-sheet=' + (document.body.dataset.sheet || '(none)') + ' overflow=' + getComputedStyle(document.body).overflow);
/* 「设了 hidden 就真的不上屏」——2026-10-06 出图时抓出来的：那条全局 `[hidden]{display:none!important}`
 * 原先住在样式表**最末尾**（分片之后那是花嫁一片的最后一行），删花嫁时顺手带走了。
 * 症状不报错、不红，是**首页一打开就被一张空的排名榜盖住**：#rankView 自己有 `display:flex`，
 * UA 那条顶不过它。上面两条判的都是 `.hidden` 这个属性，属性对、渲染错，它们照样绿 ——
 * 所以这一条判的是**算出来的 display**，并且只在这时候问（榜刚关掉，正好在手上）。 */
{
  const 收着 = [...document.querySelectorAll('[hidden]')];
  const 还画着 = 收着.filter(n => getComputedStyle(n).display !== 'none');
  push('带 hidden 的节点算出来的 display 真的是 none（全局那条 !important 不许被板块里的 display 顶掉）',
    收着.length >= 1 && 还画着.length === 0 && view.hidden === true,
    还画着.length ? '关了却还画着的 ' + 还画着.length + '/' + 收着.length + ' 个：' +
      还画着.slice(0, 5).map(n => '#' + (n.id || n.className)).join(' ')
      : '量了 ' + 收着.length + ' 个带 hidden 的节点全部 display:none（含刚关掉的 #rankView）');
}

const rafIdle = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

/* 背景模块取消（2026-10-04 S2）。原来这三条钉的是那根滑杆：拖 40 下恰好落盘 1 次（rAF 合帧）、
 * 终值真的生效且渲染与落盘同一个数、21 个离散档不许连续。滑杆没了就把它测的东西一起删掉会留盲区 ——
 * 「applyTheme 忘了下发 --glass-*」从此没人管，所以头两条换成下面这一条 + 主题那一格里那条：
 * 这一条钉「控件不许复活」，那条钉「值从主题那一格到 body 上，中间不许多一个换算层」。
 * 顺带说为什么是「整节点不在」而不是「不许可见」：藏着的那几个 id 后人会当成没接线的功能捡回来。 */
const 背景控件 = ['bgLayer', 'bgMode', 'bgGrid', 'bgPhotoRow', 'bgPhoto', 'bgClear', 'bgInfo',
  'bgChipRow', 'bgChip', 'bgChipVal'];
const 还在的 = 背景控件.filter(id => document.getElementById(id));
push('背景那一栏的十个控件与 #bgLayer 整节点不在 DOM 里（是删掉了，不是藏起来）', 还在的.length === 0,
  还在的.length ? '还找得到：#' + 还在的.join('、#') : '一个都不在');

/* ---------- 老配置的一次性迁移（S3） ----------
 * 背景取消之后要清两样：配置里那一格 cfg.bg，和单独存的照片键 weather-bg-photo。
 * 这一条真正要钉的其实是**另一半**：迁移不许动用户挑过的东西。
 * 那块代码原先是无条件重跑 `cache.provider = 默认`，谁给 DEF_VER 升一次版，所有人的数据源选择
 * 就被顺手打回默认（2026-10-04 加 v3 的时候发现的，差点把用户挑的墨迹抹掉）。
 * 所以两种来路各测一遍：v2 老用户（只清背景、源要留着）与从没迁移过的 v1（源该跟着换默认）。 */
{
  const KEY = 'weather-studio-config', PHOTO = 'weather-bg-photo';
  const 原样 = localStorage.getItem(KEY), 原本照片 = localStorage.getItem(PHOTO);
  /* 每个场景都要**另起一份 config 模块**：loadConfig 有模块内缓存（第一行 `if (cache) return cache`），
   * 同一个实例跑第二个场景时根本不会再读 localStorage —— 我第一版就是拿同一个实例连跑三遍，
   * 结果 v1 与新装那两跑读回来的是 v2 的缓存，看着像测了三条分支，其实一条没走。 */
  const 跑一遍 = async (存进去) => {
    if (存进去 === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, JSON.stringify(存进去));
    if (存进去 && 存进去.defVer !== undefined) localStorage.setItem(PHOTO, 'data:image/jpeg;base64,RESIDUE');
    else localStorage.removeItem(PHOTO);
    const m = await import('/weather-app/js/lib/config.js?s3=' + Date.now() + '.' + Math.random());
    const c = m.loadConfig();
    return { m, c, 落盘: JSON.parse(localStorage.getItem(KEY) || 'null') || {},
      照片还在: localStorage.getItem(PHOTO) !== null };
  };
  const v2 = await 跑一遍({ defVer: 2, provider: 'open-meteo', theme: 'dark', key: 'abc-123', units: { temp: 'F' },
    bg: { mode: 'photo', id: 'dusk', chip: 12 } });
  const v1 = await 跑一遍({ defVer: 1, provider: 'open-meteo', theme: 'mint' });
  const 新装 = await 跑一遍(null);
  /* 2026-10-06 主题从 11 套收到 2 套，老用户存的 id 有可能已经不存在了。这两跑用的 defVer 已经到位
   * （不会再走上面那一刀、也不会 saveConfig），所以判的是 **loadConfig 返回的那份**，不是落盘的字节：
   * 这一支修复每次都跑、不落盘，也不该落盘 —— 它只把「查无此 id」换成同侧默认，用户挑过且还在的原样留。
   * 上面 v2 那一跑的 theme 因此换成了还活着的 'dark'：它才是「挑过的没被动」那一条该用的样子，
   * 拿一个已经不存在的 id 来验「没被动」，验的是迁移会不会偷偷改写，而不是它改对了没有。 */
  const 删过的深 = await 跑一遍({ defVer: 3, provider: 'wttr-in', theme: 'ocean', darkTheme: 'oled', lightTheme: 'sunset' });
  const 删过的浅 = await 跑一遍({ defVer: 3, theme: 'bridal', lightTheme: 'paper' });
  const 老墨迹 = await 跑一遍({ defVer: 3, provider: 'moji' });
  const 默认源 = v2.m.DEFAULT_CFG.provider;
  const 默认版本 = v2.m.DEFAULT_CFG.defVer;
  const 挑过的没被动 = v2.落盘.provider === 'open-meteo' && v2.落盘.theme === 'dark' && v2.落盘.key === 'abc-123' &&
    v2.c.units.temp === 'F';
  const 背景清干净 = v2.c.bg === undefined && !('bg' in v2.落盘) && v2.照片还在 === false;
  const 该吃默认的时候才吃 = v1.落盘.provider === 默认源 && 新装.落盘.provider === 默认源 &&
    v2.落盘.defVer === 默认版本 && v1.落盘.defVer === 默认版本;
  /* 复原现场：这套 localStorage 是跑批与用户共用的，别把假城市留给后面的断言 */
  if (原样 === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, 原样);
  if (原本照片 === null) localStorage.removeItem(PHOTO); else localStorage.setItem(PHOTO, 原本照片);
  push('迁移到 v5：清背景、下架墨迹源，用户还活着的选择一个字都不许动',
    挑过的没被动 && 背景清干净 && 该吃默认的时候才吃,
    'v2 老用户：源=' + v2.落盘.provider + ' 主题=' + v2.落盘.theme + ' 密钥=' + (v2.落盘.key || '(丢)') +
    ' 单位=' + v2.c.units.temp + '｜cfg.bg=' + JSON.stringify(v2.c.bg) + ' 落盘还留 bg=' + ('bg' in v2.落盘) +
    ' 照片键还在=' + v2.照片还在 + '｜v1→源=' + v1.落盘.provider + '，新装→源=' + 新装.落盘.provider +
    '（默认 ' + 默认源 + '），defVer=' + v2.落盘.defVer + '/' + v1.落盘.defVer);
  push('已下架的墨迹源在迁移时落回默认源，设置面板不回填一个不存在的选项',
    老墨迹.c.provider === 默认源,
    '墨迹→' + 老墨迹.c.provider + '（默认 ' + 默认源 + '）');
  /* 这一条钉的是上面那一步「查无此 id 就换同侧默认」：深色侧删过的不许一觉醒来变成浅色，
   * 记账位（darkTheme/lightTheme）跟着清空，否则 ☀/ 第一下会跳去一个已经不存在的配色。 */
  push('存过的主题 id 已不在清单里：落到同明暗侧的默认套，记账位清空，用户还活着的选择不受影响',
    删过的深.c.theme === 'dark' && 删过的深.c.darkTheme === null && 删过的深.c.lightTheme === null &&
    删过的浅.c.theme === 'mint' && 删过的浅.c.lightTheme === null &&
    删过的深.c.provider === 'wttr-in' && v2.c.theme === 'dark',
    'ocean→' + 删过的深.c.theme + '（记账 ' + 删过的深.c.darkTheme + '/' + 删过的深.c.lightTheme + '）' +
    '｜bridal→' + 删过的浅.c.theme + '｜还活着的 dark→' + v2.c.theme +
    '｜源没被顺手打回默认：' + 删过的深.c.provider);
}

/* 两份名单的漂移检查：卡面用 var(--surface)，玻璃用 backdrop-filter 名单，本来就要一一对应。
   上一轮就是把 360 行的 .rank-row 塞进名单时没问一句「它背后有没有东西可透」，才糊出一场卡死。 */
const css = (await (await fetch('/weather-app/styles.css')).text()).replace(/\/\*[\s\S]*?\*\//g, '');
const cls = s => new Set((s.match(/\.[a-zA-Z][\w-]*/g) || []).map(x => x.slice(1)));
const surface = new Set();
const re = /([^{}]+)\{([^{}]*)\}/g;
let mm;
while ((mm = re.exec(css))) { if (/background[^;]*var\(--surface\)/.test(mm[2])) for (const c of cls(mm[1])) surface.add(c); }
/* 名单现在挂在 `body :is(...)` 上（以前是 body:not([data-bg="auto"]) :is(...)，玻璃有个开关）。
 * 这条正则跟着改了，但它真正要防的东西没变：卡面名单与玻璃名单是两份清单，各自漂移过一次就糊出过卡死。 */
const blurSel = /(?:^|\s)body\s*:is\(([^)]*)\)/.exec(css);
const blurList = blurSel ? cls(blurSel[1]) : new Set();
const drift = Array.from(surface).filter(c => !blurList.has(c));
push('用 --surface 的卡面与玻璃名单一一对应', drift.length === 0 && blurList.size > 0,
  '卡面 ' + surface.size + ' 个 / 名单 ' + blurList.size + ' 个，漂移：' + (drift.join(', ') || '无'));

/* --pop 是 11px 的正文（.hr-pop 那行降水小字），不是图表线。上一轮把它折成 --cool（图形色，
 * 当初只按 3:1 挑），light 4.06 / mono 3.45 当场跌破文字门槛。
 * 这一条**从 CSS 文本量**，不靠屏上那会儿刚好有没有降水字 —— 上面那场全表 AA 就是靠运气：
 * 同一份 CSS，一次绿一次红（漏测的那个节点平时是空的）。 */
{
  const 清单 = (await import('/weather-app/js/lib/themes.js')).THEMES;   // 下面那个 themes 常量还没初始化，就地取一份
  const 块 = id => {
    const i = css.indexOf('body[data-theme="' + id + '"]');
    if (i < 0) return '';
    const a = css.indexOf('{', i);
    let d = 0, b = a;
    for (; b < css.length; b++) { if (css[b] === '{') d++; else if (css[b] === '}') { d--; if (!d) break; } }
    return css.slice(a, b);
  };
  const 坏 = [];
  for (const t of 清单) {
    const blk = 块(t.id);
    const pop = /--pop:\s*(#[\da-fA-F]{3,8})/.exec(blk);
    const card = /--card:\s*(#[\da-fA-F]{3,8})/.exec(blk);
    if (!pop || !card) { 坏.push(t.id + ' 缺 --pop/--card 声明'); continue; }
    const r = glass.ratio(glass.parse(pop[1]), glass.parse(card[1]));
    if (r < glass.AA) 坏.push(t.id + ' ' + r.toFixed(2));
  }
  push('--pop（逐小时降水小字）压在卡面上，' + 清单.length + ' 套全部过 AA(4.5)',
    坏.length === 0, 坏.join(' · ') || 清单.length + '/' + 清单.length + ' 过');
}

/* 界面符号（.ic-ink 那一类）必须跟着主题墨色走。图标不是文字，上面那场「带字节点」的 AA
 * 扫描压根量不到它 —— 2026-10-04 上机才抓出来：`.loc-btn` 从来没写过 color（里面原先是自带
 * 颜色的 📍 emoji），换成 fill="currentColor" 的矢量之后，按钮的 UA 默认字色（黑）就直接落进
 * 图标里，纯黑主题下量到 1.07：黑压黑，那颗定位钮在屏上根本找不到。
 * 门槛按图形算（3:1，不是文字的 4.5）：这些是图标，不承担正文。 */
{
  const 清单 = (await import('/weather-app/js/lib/themes.js')).THEMES;
  const ui = await import('/weather-app/js/ui.js');
  /* 计算色的写法比想象多：rgb() / rgba() / 开玻璃后 color-mix 吐 `color(srgb …)` /
   * 掺了 ink 补偿的 --muted 直接吐 `oklab(…)`。glass.parse 只认前两种，会把读不出来的当成纯黑 ——
   * 第一版据此把 11 套主题 × 全部图标报成 1.12，第二版报成「读不出色」60 处，两次都是通道坏了不是设计坏了。
   * 判不动就明说 unparsed，绝不拿黑当读数。 */
  const 读色 = 色;      /* 这一处只要 RGB，不要 α：α 已经由 color-mix 落在计算值里了 */

  const 起始主题 = document.body.dataset.theme;
  const 坏 = [];
  for (const t of 清单) {
    ui.applyTheme(t.id);
    await rafIdle(); await rafIdle();
    const card = getComputedStyle(document.body).getPropertyValue('--card').trim();
    document.querySelectorAll('.ic-ink').forEach(sp => {
      const host = sp.closest('button, .tab, a, [role="button"]') || sp;
      const 串 = getComputedStyle(host).color;
      const col = 读色(串);
      const bg = 读色(card);
      const nm = ((host.id || (host.className || '') || (sp.parentElement.dataset.iconName || '')) + '').split(' ')[0];
      if (!col || !bg) { 坏.push(t.id + '/' + nm + ' 读不出色「' + (col ? card : 串) + '」'); return; }
      const r = glass.ratio(col, bg);
      if (r < 3) 坏.push(t.id + '/' + nm + ' ' + r.toFixed(2));
    });
  }
  ui.applyTheme(起始主题);
  push('每一套主题下，界面符号的落色压在卡面上都 ≥3:1（图标走 currentColor，不许退回 UA 默认黑）',
    坏.length === 0, 坏.length ? 坏.slice(0, 8).join(' · ') + (坏.length > 8 ? ' …共 ' + 坏.length + ' 处' : '') : 清单.length + ' 套 × 全部图标过');
}

/* ---------- 逐主题 × 逐渐变的 AA 扫描（2026-10-04 S5，换掉那条「76% 对任意照片都够」） ----------
 * 旧证法的前提是「底可以是用户选的**任何一张**照片」⇒ 复合色对 photo 单调 ⇒ 只测纯黑/纯白两个端点。
 * 照片入口取消之后，底只剩每套主题自己的六个渐变 —— 已知量，就逐个真量，不再拿端点去包住。
 * 量的是 themes.js 的 glass 那一格与 styles.css 那块色板**配出来的复合底色**：
 *   底 = α·--card + (1−α)·色标（六个渐变各两个端点，再加页面 --bg，共 13 块），
 *   字色 = --ink / --muted / --pop / --accent —— 其中只有 --muted 会被 glass.mix 提档
 *   （CSS 里 mix 就作用在它身上），所以 --pop 那几套压不住的，只能改色，提档救不了 ——
 *   这一轮就是照这个结论加深了六个 token（见 themes.js 顶上那段注释）。
 * 判红用 AA(4.5)，同时把本轮定的设计线 5.0 一起打出来：过 4.5 但不到 5.0 的在 detail 里点名。
 * 为什么在浏览器里量而不是只跑 Node：色值住在 CSS，token 的计算值要过一层 color-mix 才出来，
 *  那正是 v112 三场假红的来源 —— 所以读数用文件顶部那把 读色（能认 oklab/color(srgb)），不用 glass.parse。 */
const themes = (await import('/weather-app/js/lib/themes.js')).THEMES;
const prevTheme = document.body.dataset.theme;
const 渐变AA = [];
{
  const ui = await import('/weather-app/js/ui.js');
  const 线 = glass.AA, 设计线 = glass.AA + 0.5;
  const 不达 = [], 压线 = [];
  let 组数 = 0;
  for (const t of themes) {
    ui.applyTheme(t.id);
    await rafIdle();
    const card = token色('--card'), bg = token色('--bg');
    const 字 = { ink: token色('--ink'), muted: token色('--muted'), pop: token色('--pop'), accent: token色('--accent') };
    if (!card || !bg || Object.values(字).some(c => !c)) { 不达.push(t.id + ' 读不出色（通道坏了，不是配色坏了）'); continue; }
    const 色标 = [['bg', bg]];
    for (const [st, g] of Object.entries(t.w))
      for (const hex of (String(g).match(/#[0-9a-fA-F]{3,8}\b/g) || [])) 色标.push([st + '@' + hex, glass.parse(hex)]);
    let min = Infinity, at = '';
    for (const [nm, col] of Object.entries(字))
      for (const [sn, stop] of 色标) {
        const 面 = glass.mix(card, stop, 1 - t.glass.a / 100);
        const r = glass.ratio(col, 面);
        组数++;
        if (r < min) { min = r; at = nm + '×' + sn; }
        if (r < 线) 不达.push(t.id + ' ' + nm + '×' + sn + ' ' + r.toFixed(2));
        else if (r < 设计线) 压线.push(t.id + ' ' + nm + '×' + sn + ' ' + r.toFixed(2));
      }
    渐变AA.push(t.id + ' ' + min.toFixed(2));
  }
  ui.applyTheme(prevTheme);
  const 最紧 = Math.min(...渐变AA.map(s => parseFloat(s.split(' ')[1])));
  push(themes.length + ' 套主题 × 各自六个渐变的复合底色 × 四种字色（' + 组数 + ' 组）全部过 AA(4.5)',
    不达.length === 0,
    '全场最低 ' + 最紧.toFixed(2) + ' ｜ 每套主题的最低比：' + 渐变AA.join(' · ') +
    ' ｜ 过线但没到设计线 5.0 的 ' + 压线.length + ' 组' + (压线.length ? '：' + 压线.slice(0, 6).join('、') : '') +
    (不达.length ? ' ｜不达：' + 不达.slice(0, 8).join('、') + (不达.length > 8 ? ' …共 ' + 不达.length + ' 组' : '') : ''));

  /* 这一条钉的是②的**形状**而不是数字：透出值必须是「每套主题一个」，不许有人图省事改回一个全局常量。
   * （原先那根滑杆就是全局的，任何一套主题想更透都得把别人一起拖透。） */
  const 各个a = themes.map(t => t.glass.a);
  const 重复 = 各个a.filter((v, i) => 各个a.indexOf(v) !== i);
  push(themes.length + ' 套主题的 glass.a 是 ' + themes.length + ' 个独立值（不是抄来的同一个数）',
    new Set(各个a).size === themes.length,
    '不同值 ' + new Set(各个a).size + '/' + themes.length + (重复.length ? '，重复：' + Array.from(new Set(重复)).join('/') : '') +
    ' ｜ ' + themes.map(t => t.id + ' ' + t.glass.a).join(' · '));
}

/* ---------- 切主题那一帧：底、卡面、字色、状态栏色一起换（验收 3） ----------
 * 「流畅」在这里是**可判的**：applyTheme 只改一个主题，屏上却同时有六样东西跟着动
 * （data-theme、六个 --w-* 渐变、三个 --glass-*、body 画出来的底、卡面色、<meta theme-color>）。
 * 只要有任何一样是「异步补的」或者写在另一条路径上，就会出现一帧「主题已是新的、底还是旧的」——
 * 用户看到的就是一闪而过的花屏。改前确实有这种三条书写者并存的结构（主题走 data-theme、
 * 背景走 #bgLayer.style、天气态走 body.className），这一条就是钉它不许回来。
 * 先掐掉 transition 再采：卡面色本来有 .25s/.45s 缓动，那一帧读到的是两套配色之间的插值
 * （项目老规矩：ocean 下读出 bridal 的 #2a2530 就是这么来的），量不到「有没有换」只量到「换到一半」。 */
{
  const TM = await import('/weather-app/js/lib/themes.js');
  const ui = await import('/weather-app/js/ui.js');
  const kill = document.createElement('style');
  kill.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
  document.head.appendChild(kill);
  const 起始 = document.body.dataset.theme, 起始态 = document.body.dataset.weather;
  const 下一套 = TM.THEMES.find(t => t.id !== 起始).id;
  const 新渐变 = TM.themeById(下一套).w.clear;
  const 采 = () => ({
    主题: document.body.dataset.theme,
    渐变属性: document.body.style.getPropertyValue('--w-clear').trim(),
    玻璃: ['--glass-a', '--glass-mix', '--glass-blur'].map(n => document.body.style.getPropertyValue(n).trim()).join('/'),
    画出来的底: getComputedStyle(document.body).backgroundImage,
    卡面: getComputedStyle(document.querySelector('.day')).backgroundColor,
    状态栏: document.querySelector('meta[name="theme-color"]').getAttribute('content')
  });
  const 半新半旧 = [];
  /* 一次点击 = 一个宏任务，里面把主题换掉；换完之后的**第一帧**就把六样都读一遍。
   * 读两帧是因为自定义属性要等样式重算才落到 used value（只读一帧量到过「属性已更新、渲染值还没跟上」）。 */
  for (let 轮 = 0; 轮 < 3; 轮++) {
    ui.applyTheme(下一套);
    ui.applyBg('sun');          // applyBg 收的是**图标名**（BG_STATE 那张表），不是态名：写 'clear' 会静默落回 clear 那一档
    for (const 帧 of [0, 1]) {
      await new Promise(r => requestAnimationFrame(r));
      const s = 采();
      if (s.主题 !== 下一套) continue;                 // 这一帧主题还没换过去，不算这一条的事
      const 旧 = [];
      if (s.渐变属性 !== 新渐变) 旧.push('底纹还是「' + s.渐变属性.slice(0, 34) + '…」');
      if (!/linear-gradient/.test(s.画出来的底)) 旧.push('画不出底');
      if (s.玻璃.split('/')[0] !== TM.themeById(下一套).glass.a + '%') 旧.push('透出度没跟上（' + s.玻璃 + '）');
      if (s.状态栏 !== TM.themeById(下一套).meta) 旧.push('状态栏还是 ' + s.状态栏);
      if (!s.卡面 || s.卡面 === 'rgba(0, 0, 0, 0)') 旧.push('卡面读不到色');
      if (旧.length) 半新半旧.push('第' + (帧 + 1) + '帧 ' + 旧.join('、'));
    }
    ui.applyTheme(起始);                              // 换回来再测下一轮，免得三轮都测同一个方向
    await new Promise(r => requestAnimationFrame(r));
  }
  /* 顺带把验收 4 量出来（观察值，不是断言）：body 上那条 `transition: background .45s`
   * 对 linear-gradient 到底生不生效？切一次天气态，逐帧读 backgroundImage。
   * applyBg 收的是**图标名**（BG_STATE 那张表），不是态名：写 'storm' 会查不到而悄悄落回 clear，
   * 于是「一帧跳完」量的是「底压根没换」—— 第一版就是这么把一条编出来的观察值挂在 PASS 后面的。 */
  const 缓动 = [];
  ui.applyBg('sun');
  await new Promise(r => requestAnimationFrame(r));
  const 前 = getComputedStyle(document.body).backgroundImage;
  ui.applyBg('thunderstorm');
  let 第几帧 = -1;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => requestAnimationFrame(r));
    const 后 = getComputedStyle(document.body).backgroundImage;
    缓动.push(后 === 前 ? '旧' : (后.includes('color-mix') || /oklab|srgb .*,/.test(后) ? '插值' : '新'));
    if (后 !== 前 && 第几帧 < 0) 第几帧 = i + 1;
  }
  const 换过 = 第几帧 > 0;
  ui.applyBg();
  document.body.dataset.weather = 起始态;
  ui.applyTheme(起始);
  kill.remove();
  const 形态 = 缓动.filter(x => x === '插值').length;
  /* 采不到变化一律判负，不许把「探针没工作」读成「没有中间帧」：
   * 第一版这里写的就是「插值帧=0 ⇒ 硬切」，而 0 是因为 applyBg('storm') 传的是**态名**、
   * BG_STATE 查不到就悄悄落回 clear ⇒ 底压根没换过，那条观察值整个是编的。 */
  push('切主题的那一帧不许出现「主题新、底旧」：底纹、透出度、卡面、状态栏同一帧一起改完',
    半新半旧.length === 0 && 换过 === true,
    半新半旧.length ? 半新半旧.join(' ｜ ') : '3 轮 × 2 帧都是同一帧换完' +
    ' ‖ 顺带量（验收 4）：body 上那条 transition: background .45s 对 linear-gradient' +
    (形态 ? '有插值形态（中间帧 ' + 形态 + ' 个 ⇒ 是过渡不是硬切）' : '帮不上忙 ⇒ clear→storm 在第 ' + 第几帧 + ' 帧一步跳完，本就是硬切') +
    '；采到的形态：' + 缓动.join(''));
}

/* ② 每套主题的**实际渲染配对**都要过 AA。
 * 为什么不是「拿两堆 CSS 变量两两相除」：那测的是变量之间存不存在配对关系，不是界面。
 * 这条一开始就是变量版，它把 muted×code-bg 报成 5 套主题不达 —— 一查 `.hint code` 确实继承了
 * 外层 --muted 又自己铺 --code-bg，是真配对、真不达（3.58~4.47），已把 code 的字色改成 --ink；
 * 但改完之后变量版仍旧报同样的数，因为它不知道界面上已经没有这一对了。所以这里改成
 * 逐元素量：字色 vs 往上合成出来的真实底色（渐变按每个色标各算一次，取最坏，即 WCAG F83）。
 * 覆盖三个板块（切 data-tab 只是改 CSS 可见性，不用真的导航），背景固定成主题的 --bg
 * （去掉 body[data-weather] 那层天气渐变，否则底是渐变而不是纯色 —— 玻璃那一层另有 ① 在管）。
 * 还有两个细节，少一个就是假数字：
 *   · 先注入 `*{transition:none!important}`。body 上有 color .25s / background .45s 过渡，
 *     换主题那一刻读到的是**两套配色之间的插值**（实测在 ocean 下读出 bridal 的 #2a2530、
 *     在 dark 下读出 rgb(0,0,0)），整份表全废。这是项目老规矩，我这次漏了一次立刻中招。
 *   · 断言只管「主题给的文字色」。AQI 徽章那种白字压污染等级色（实测 white on rgb(226,128,31) = 2.86）
 *     是数据语义色、与主题无关，混进来会让每一档都被它单独拉红；它作为观察值一起打印。 */
const killTrans = document.createElement('style');
killTrans.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
document.head.appendChild(killTrans);
const INK_VARS = ['--ink', '--muted', '--muted-base', '--accent', '--pop', '--hero-ink', '--err-ink', '--ok-ink', '--osm'];
const BG_VARS = ['--card', '--bg', '--surface', '--hint-bg', '--code-bg', '--field-bg',
  '--brand', '--brand-2', '--err-bg', '--ok-bg', '--tint', '--wash'];
const key = c => c.map(Math.round).join(',');
const over = (fg, a, bg) => bg.map((c, i) => Math.round(c + (fg[i] - c) * a));
/* 共用那把（见文件顶部的 读色）：color(srgb …) 与 oklab(…) 都在这里吃下。
 * 老实现只认 rgb()/rgba()，读不出来返回 null —— 而调用方把 null 当成「这一层没有底色」直接跳过，
 * 于是玻璃那层白被抹掉、拿它下面的遮罩色去比字。S2 那一场假红就是这么来的。 */
const rgbaOf = 读色;
/* 渐变的色标要带着它自己的 alpha 一起合成，并且**全透明的色标不参与判定**。
 * 以前这里一律当实底（over(s, 1, b)）：一道 5% 的雾被当成整块 --brand，而 `transparent` 这个关键字
 * 在 computed 里是 `rgba(0, 0, 0, 0)` —— 它既不是主题给的底、也不挡住任何东西，于是被判成
 * 「链上出现了一个非主题色」，花嫁的缎面就这样把主卡那 9 处文字从这场扫描里挤了出去
 * （实测 bridal 覆盖 80 → 71，而 min 那半照样绿）。这是测量通道的病，不是配色的病。 */
const stopsOf = img => (img && img !== 'none' ? (img.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]+\)/gi) || [])
  .map(x => 读色(x)).filter(s => s && s.a > 0) : []);
/* 底色链合成 + 「这一路是不是全部由主题变量铺出来的」判定。
 * 为什么要判定：AQI 徽章是白字压污染等级色（JS 直接塞的 inline style，与主题无关），
 * 而白字同时也是主题的 --hero-ink —— 只按字色分类会把这两件事混成一件。
 * 判据用「每一层原始 rgb 是否等于某个主题底色变量」，不用合成结果比：--tint/--brand 渐变
 * 合成后是个新颜色，比不出来的。 */
function bgInfo(n, themeBgs) {
  const chain = [];
  for (let e = n; e && e.nodeType === 1; e = e.parentElement) chain.push(e);
  chain.reverse();
  let cands = [], themeOnly = true;
  for (const e of chain) {
    const cs = getComputedStyle(e);
    const stops = stopsOf(cs.backgroundImage);
    const solid = rgbaOf(cs.backgroundColor);
    if (stops.length) {
      const base = cands.length ? cands : [[255, 255, 255]];
      cands = [];
      for (const b of base) for (const s of stops) cands.push(over(s.col, s.a, b));
      for (const s of stops) if (!themeBgs.has(key(s.col))) themeOnly = false;
    } else if (solid && solid.a > 0) {
      cands = cands.length ? cands.map(b => over(solid.col, solid.a, b))
        : [solid.a >= 1 ? solid.col : over(solid.col, solid.a, [255, 255, 255])];
      if (!themeBgs.has(key(solid.col))) themeOnly = false;
    }
  }
  return { cands: cands.length ? cands : [[255, 255, 255]], themeOnly };
}
function worstTextPair(inks, themeBgs) {
  let min = Infinity, at = '', checked = 0, otherMin = Infinity, otherAt = '';
  for (const n of document.querySelectorAll('body *')) {
    /* 只量「真的有字」的节点：📍/☀/‹ 这类纯符号节点算进去会得到毫无意义的高对比
     * （emoji 自带颜色，不受 color 影响；它也不是承载信息的文字，aria-label 才是）。 */
    const hasText = [...n.childNodes].some(c => c.nodeType === 3 && /[\p{L}\p{N}]/u.test(c.textContent));
    if (!hasText || !n.getClientRects().length) continue;
    const cs = getComputedStyle(n);
    if (cs.visibility === 'hidden' || +cs.opacity === 0 || parseFloat(cs.fontSize) < 9) continue;
    const fg = rgbaOf(cs.color);
    if (!fg) continue;
    const isInk = inks.has(key(fg.col));
    const bg = bgInfo(n, themeBgs);
    for (const b of bg.cands) {
      const r = glass.ratio(fg.col, b);
      const where = (n.className || n.tagName) + ' ' + cs.color + ' on rgb(' + b + ')';
      if (isInk && bg.themeOnly) {
        checked++;
        if (r < min) { min = r; at = where; }
      } else if (r < otherMin) { otherMin = r; otherAt = where; }
    }
  }
  return { min, at, checked, otherMin, otherAt };
}
const prevTab = document.body.dataset.tab, prevWeather = document.body.dataset.weather;
document.body.removeAttribute('data-weather');
const aa = [], 节点表 = [];
let sampleNodes = 0, 总节点 = 0;
const worstOther = { min: Infinity, at: '' };
const ui2 = await import('/weather-app/js/ui.js');
for (const t of themes) {
  /* 必须走 ui.applyTheme，不能只写 dataset.theme：S1/S2 之后 --glass-* 与 --w-* 是 applyTheme
   * **内联写进 body 的**，只改 data-theme 的话 CSS 变量跟着换了、那三个内联量还停在上一套主题上，
   * 量出来的就是「A 套的字色 × B 套的透出度」这种没人用得上的组合。 */
  ui2.applyTheme(t.id);
  /* applyTheme 末尾会调 applyBg()，把 data-weather 又写回来 —— 那就得在 it 之后清，写在前面等于没清。
   * 第一版就栽在这里：底变成了主题的渐变，而渐变那两个色标不在 BG_VARS 里，
   * 于是 bgInfo 的「这一路全是主题给的底」对每个节点都成立不了，整套扫描静默量到 0 个节点
   * （minAA=Infinity，`Infinity >= 4.5` 恒真 ⇒ 一条**假绿**，靠下面那个节点数下限才抓住）。
   * 天气渐变那一维由上面 S5 那条扫描专管，这一条管的是「屏上真实渲染出来的配对」。 */
  document.body.removeAttribute('data-weather');
  await rafIdle();
  const inks = new Set(INK_VARS.map(v => key(token色(v) || [])));
  const themeBgs = new Set(BG_VARS.map(v => key(token色(v) || [])));
  let min = Infinity, at = '', nodes = 0;
  for (const tab of ['weather', 'fortune', 'news']) {
    document.body.dataset.tab = tab;
    const w = worstTextPair(inks, themeBgs);
    nodes += w.checked;
    if (w.min < min) { min = w.min; at = tab + ' › ' + w.at; }
    if (w.otherMin < worstOther.min) { worstOther.min = w.otherMin; worstOther.at = tab + ' › ' + w.otherAt; }
  }
  sampleNodes = nodes;
  总节点 += nodes;
  aa.push(t.id + ' ' + (Number.isFinite(min) ? min.toFixed(2) : '没有量到任何一个节点') + (min >= glass.AA ? '' : ' @' + at));
  节点表.push(t.id + ':' + nodes);
}
ui2.applyTheme(prevTheme);
document.body.dataset.tab = prevTab;
document.body.dataset.weather = prevWeather;
killTrans.remove();
const minAA = Math.min(...aa.map(s => parseFloat(s.split(' ')[1])));
/* 节点数下限是这条的**通道闸**：扫描看不见任何带字节点时 minAA 会是 Infinity，
 * 而 `Infinity >= 4.5` 恒真 —— 不加这道闸，一个坏掉的测量代码就是一张全绿的假条。 */
push(themes.length + ' 套主题 × 3 个板块，主题给的每一种文字色压在真实底色上都过 AA(4.5)（且真量到了节点）',
  minAA >= glass.AA && 总节点 >= themes.length * 3 * 20,
  '全场最低 ' + minAA.toFixed(2) + '（每套最后一个板块量 ' + sampleNodes + ' 个，三板块合计 ' + 总节点 + ' 个）｜ ' +
  aa.join(' · ') + ' ‖ 非主题的数据色最低 ' + worstOther.min.toFixed(2) + ' @' + worstOther.at);

/* 上面那条的**通道闸另一半**：它按「字色属不属于主题给的九种 + 底链全不由主题变量铺出」筛节点，
 * 而装饰层（花嫁那几段 color-mix / 伪元素）恰好能同时破坏这两半 —— 一旦某块底的色标长得像
 * 「一个主题变量之外的色」，那一处文字就从这场扫描里**悄悄出局**，min 照样绿、覆盖却瘦了。
 * 两套用的是同一份 DOM，覆盖到的节点数因此必须一样；不一样就是有人被挤出去了。
 * （这条和被它拦住的那类缺陷一样，只在「新画了一层底」的时候才有意义 —— 所以是这一轮加的。） */
{
  const 数 = 节点表.map(s => +/:(-?\d+)$/.exec(s)[1]);
  const 不齐 = 节点表.filter(s => +/:(-?\d+)$/.exec(s)[1] !== 数[0]);
  push(themes.length + ' 套主题在同一份 DOM 上覆盖到的带字节点数一致（不许有一套把文字挤出上面那场扫描）',
    节点表.length === themes.length && 数[0] > 0 && 不齐.length === 0,
    不齐.length ? '每套覆盖：' + 节点表.join(' · ') : '每套都量到 ' + 数[0] + ' 个 ｜ 装饰层没有把任何一处文字摘出去');
}

/* ---------- 天气底色：一份值 + 四处名单（2026-10-04 S1 搬进来之后新增） ----------
 * 渐变原先抄在 styles.css 的十个主题块里（一份真值抄十遍，漏写的那套会静默继承 :root 的蓝白底）。
 * 现在值只住在 themes.js，由 applyTheme 下发成 --w-*，CSS 只留六条 body[data-weather] 规则。
 * 于是「有哪些天气态」这件事分四处各写了一遍：WEATHER_BG、每套主题的 w 键、那六条规则、
 * lib/weather.js 的 BG_STATE（图标名 → 态）。四处对不齐的结果不是报错，是**某个天气下整个界面没底**，
 * 所以逐处对齐，并且真的下一次发看它到没到 body 上。 */
{
  const TM = await import('/weather-app/js/lib/themes.js');
  const { WEATHER_BG, THEMES: 清单 } = TM;
  const ui = await import('/weather-app/js/ui.js');
  const { BG_STATE } = await import('/weather-app/js/lib/weather.js');
  const 规则态 = new Set((css.match(/body\[data-weather="([a-z]+)"\]/g) || [])
    .map(s => /"([a-z]+)"/.exec(s)[1]));
  const 缺值 = 清单.filter(t => WEATHER_BG.some(k => !/^linear-gradient\(/.test(String((t.w || {})[k]))));
  const 键数不对 = 清单.filter(t => Object.keys(t.w || {}).length !== WEATHER_BG.length);
  const 无规则 = WEATHER_BG.filter(k => !规则态.has(k));
  const 多规则 = Array.from(规则态).filter(k => WEATHER_BG.indexOf(k) < 0);
  const 指错态 = Object.keys(BG_STATE).filter(k => WEATHER_BG.indexOf(BG_STATE[k]) < 0);
  push('天气底色四处名单对齐：WEATHER_BG / 每套主题的 w / CSS 那六条规则 / 图标表，谁都不许多谁不许少',
    缺值.length === 0 && 键数不对.length === 0 && 无规则.length === 0 && 多规则.length === 0 && 指错态.length === 0,
    '态：' + WEATHER_BG.join('/') + '｜缺值：' + (缺值.map(t => t.id).join(',') || '无') +
    '｜键数不对：' + (键数不对.map(t => t.id + ':' + Object.keys(t.w).length).join(',') || '无') +
    '｜没有规则的态：' + (无规则.join(',') || '无') + '｜多出的规则：' + (多规则.join(',') || '无') +
    '｜图标表指到不存在的态：' + (指错态.join(',') || '无'));

  /* 落地接线。上面那条只证明「文件里值齐」，这一条才证明「真的下发到了屏上」：
   * 值在 themes.js 里躺着、applyTheme 忘了搬，界面同样是没底。 */
  const 起始主题 = document.body.dataset.theme, 起始态 = document.body.dataset.weather;
  const 夜航 = TM.themeById('dark');
  ui.applyTheme('dark');
  const 下发 = WEATHER_BG.map(k => document.body.style.getPropertyValue('--w-' + k).trim());
  const 一个不落 = 下发.every((v, i) => v === 夜航.w[WEATHER_BG[i]]);
  ui.applyBg('thunderstorm');
  const 画出来了 = /^linear-gradient\(/.test(getComputedStyle(document.body).backgroundImage);
  const 走的是属性 = document.body.dataset.weather === 'storm' && document.body.className === '';
  /* 换天气态不许动底色之外的东西：卡面、字色都只跟 data-theme 有关 */
  const 底色 = getComputedStyle(document.body).backgroundImage;
  ui.applyBg('snowy');
  const 会跟着变 = 底色 !== getComputedStyle(document.body).backgroundImage;
  document.body.removeAttribute('data-weather');
  const 无态则回实底 = !document.body.dataset.weather &&
    getComputedStyle(document.body).backgroundImage === 'none';
  ui.applyTheme(起始主题); ui.applyBg();
  document.body.dataset.weather = 起始态;
  push('换主题会把六个渐变全下发到 body，天气态走 data-weather（不再整体重写 body.className）',
    一个不落 && 画出来了 && 走的是属性 && 会跟着变 && 无态则回实底,
    '下发齐=' + 一个不落 + ' 画得出=' + 画出来了 + ' 属性路线=' + 走的是属性 +
    ' 换态会跟着变=' + 会跟着变 + ' 无态回实底=' + 无态则回实底);

  /* 透出值也是主题那一格定的（S2 起那根全局滑杆没了）。三个量一起读：只落下 α 不补 mix，
   * 次要文字就会在半透卡面上跌破 AA —— 少一个比少三个更危险，因为它看着是好的。
   * 两套各自的数不一样（浅 85/深 72），所以这条既钉下发链路，也顺带就是「谁都没被写成别人的值」那一条。 */
  const 读玻璃 = () => {
    const cs = getComputedStyle(document.body);
    return ['--glass-a', '--glass-mix', '--glass-blur'].map(n => cs.getPropertyValue(n).trim()).join(' | ');
  };
  const 不符 = [];
  for (const t of 清单) {
    ui.applyTheme(t.id);
    const 应 = t.glass.a + '% | ' + t.glass.mix + '% | ' + t.glass.blur + 'px';
    const 实 = 读玻璃();
    if (应 !== 实) 不符.push(t.id + '：应 ' + 应 + '，实 ' + (实 || '(全空)'));
  }
  ui.applyTheme(起始主题);
  push(清单.length + ' 套主题各自的下发：--glass-a / -mix / -blur 的读数就是主题那一格里写的那三个数',
    不符.length === 0, 不符.join('；') || 清单.length + '/' + 清单.length + ' 对上');
}

/* 读数那把自己也要有人看着（v112 这一轮就是被它骗的）：我新写的那一版把 α 的捕获下标取错，
 * 于是 `rgba(0, 0, 0, 0)` 读成「不透明纯黑」，每一层透明背景都往底上刷一层黑，三场 AA 扫描一起塌到 1.14 ——
 * 报出来像配色坏了，其实是通道坏了。这种错只会污染**所有**按颜色判的断言，所以拿一条最小的把它钉住。 */
push('计算色读数：透明要读成 α=0、color(srgb)/oklab 要读成对的 RGB、读不懂必须给 null（不许当黑）',
  读色('rgba(0, 0, 0, 0)').a === 0 &&
  读色('rgb(0, 0, 0)').a === 1 &&
  读色('color(srgb 1 1 1 / 0.892)').col.join() === '255,255,255' &&
  读色('color(srgb 1 1 1 / 0.892)').a === 0.892 &&
  读色('#e9e9ec').col.join() === '233,233,236' &&
  读色('oklab(1 0 0)').col.join() === '255,255,255' &&
  读色('color-mix(in srgb, #fff 89%, transparent)') === null &&
  读色('') === null,
  'rgba(0,0,0,0).a=' + 读色('rgba(0, 0, 0, 0)').a + '，color(srgb 1 1 1 / .892)=' +
  JSON.stringify(读色('color(srgb 1 1 1 / 0.892)')) + '，oklab(1 0 0)=' + JSON.stringify(读色('oklab(1 0 0)').col) +
  '，未求值的 color-mix 文本=' + JSON.stringify(读色('color-mix(in srgb, #fff 89%, transparent)')));

/* ---------- AQI 徽章：字色由底色决定 ----------
 * 上面那条 AA 扫描按**底色链**把徽章分给了观察值（它的底是 JS 塞的污染等级色，与主题无关），
 * 所以徽章自己看不清时那条不会红。这一条专管它：量的是真节点的计算样式，
 * 于是「CSS 里写回 color:#fff」「某处 markup 漏下发 color」都会当场红 —— 纯测 inkFor 抓不到这两层。 */
rank.open('北京');
for (let i = 0; i < 40 && document.querySelectorAll('#rankList .rank-row').length < 100; i++) await sleep(250);
for (let i = 0; i < 40 && !document.querySelector('#air .air-badge'); i++) await sleep(250);
const badNodes = [...document.querySelectorAll('#air .air-badge, #rankView .air-badge')];
let badMin = Infinity, badAt = '', badAir = 0, badWrong = 0;
const seenLv = new Set();
for (const b of badNodes) {
  const cs = getComputedStyle(b);
  const fg = rgbaOf(cs.color), bgc = rgbaOf(cs.backgroundColor);
  if (!fg || !bgc) continue;
  if (b.closest('#air')) badAir++;
  seenLv.add(b.textContent.trim());
  /* 不只量「够不够 4.5」，还钉死「必须就是 inkFor(这个底色) 那一个值」：
   * 只卡阈值的话，把 inline color 摘掉、字色掉回继承来的 --ink，在多数主题上照样 ≥4.5，
   * 这条就白写了 —— 它要防的恰恰是「某一处 markup 忘了下发字色」。 */
  const want = glass.parse(glass.inkFor(cs.backgroundColor));
  const bkey = want.map(Math.round).join(',');
  if (bkey !== fg.col.map(Math.round).join(',')) badWrong++;
  const r = glass.ratio(fg.col, bgc.col);
  if (r < badMin) { badMin = r; badAt = b.textContent + ' ' + cs.color + ' on ' + cs.backgroundColor; }
}
push('AQI 徽章的字色就是 inkFor(底色)，实测每枚都过 AA（空气卡 + 整榜）',
  badAir >= 1 && badNodes.length >= 300 && badMin >= glass.AA && badWrong === 0,
  '量了 ' + badNodes.length + ' 枚（空气卡 ' + badAir + ' 枚，等级 ' + seenLv.size + ' 种），最低 ' +
  badMin.toFixed(2) + ' @' + badAt + '，与 inkFor 不符 ' + badWrong + ' 枚');
rank.close();
await sleep(400);

/* ---------- 温度趋势图整块已删除：这一条只钉「删净」----------
 * 那张大图与下面的「未来预报」逐日卡、逐小时浮层报同一批数，2026-09-26 按要求删掉。
 * 少删一处就红一次：DOM 里的容器、骨架里的占位、charts.js 的导出，三处都不该再留着。
 * 原来盯着「降水这一维说不说得出口」的三条断言随图一起走了；那个判据现在只剩逐日卡的
 * 「N mm」一行（ui.js 的 dayCard），而它写的是 `precip > 0` 才出声 —— 「真没下」与
 * 「源没给字段」在这一行重新变回了同一张脸，是删图的代价，记在这里。 */
const charts = await import('/weather-app/js/ui/charts.js');
push('温度趋势图已删净：DOM / 骨架 / 导出三处都不再留着它',
  !document.getElementById('chart') && !document.getElementById('chartTitle') &&
    !document.querySelector('.sk-chart') && charts.tempChart === undefined &&
    charts.rainDim === undefined && typeof charts.miniChart === 'function',
  '#chart=' + !!document.getElementById('chart') + ' #chartTitle=' + !!document.getElementById('chartTitle') +
    ' .sk-chart=' + !!document.querySelector('.sk-chart') + ' tempChart/rainDim 导出=' +
    (typeof charts.tempChart) + '/' + (typeof charts.rainDim) + ' miniChart=' + (typeof charts.miniChart));

/* ---------- 中国天气的预报窗口首日 ----------
 * 这份日预报的窗口经常从**昨天**开始：20:00 那版产品上线前、以及零点之后到下一版之间，真机都拿到过
 * 「窗口首日 = 昨天」（09-25 00:09 红米：窗口 09-24~09-30，「未来预报」第一张卡是「周四 22°/11°」打头，
 * 主卡的最高/最低与常驻通知那一段跟着一起是昨天的数）。
 * ⚠ 这一条以前是**假绿**：合成报文把 publish_time 写成 2026-02-01、detail[0] 写成 2026-01-31，
 * 于是「下限 = publish_time」那一刀刚好砍掉一条，测试绿了；可真实报文里 publish_time 的日期
 * **恒等于 detail[0].date**（20:00 那版覆盖的就是当天），那一刀整天都砍不掉任何东西。
 * 现在日期全部相对**跑测试这天**算，且 publish_time 与 detail[0] 同日 —— 与真机同形，
 * 下限必须看本地今天才砍得动（把实现改回只按 publish_time，这一条立刻红）。 */
const cw = (await import('/weather-app/js/providers/chinaWeather.js')).chinaWeather;
const ymd = dt => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
const shiftDay = n => { const x = new Date(); x.setDate(x.getDate() + n); return ymd(x); };
const D_Y = shiftDay(-1), D_T = shiftDay(0), D_T1 = shiftDay(1);
const slash = s => s.replace(/-/g, '/');
const slot = (date, t) => ({
  date: date,
  day: { weather: { temperature: String(t), info: '晴', img: '0' } },
  night: { weather: { temperature: '2', info: '晴', img: '0' } },
  precipitation: 0
});
const cwRaw = { data: {
  real: { publish_time: D_T + ' 08:00', weather: { temperature: '5', info: '晴' },
    sunriseSunset: { sunrise: D_T + ' 07:10', sunset: D_T + ' 18:20' } },
  // publish_time 与 detail[0] 同日，就是真机那份的形状（窗口首日已经是昨天了）
  predict: { publish_time: D_Y + ' 20:00', detail: [slot(D_Y, 9), slot(D_T, 10), slot(D_T1, 11)] }
} };
const nd = cw.normalize(cwRaw).daily;
push('窗口首日就是昨天时，预报也要从当天开始（日出日落跟到剩下第一天）',
  nd.length === 2 && nd[0].date === D_T && !!nd[0].sunrise && nd[1].sunrise == null,
  '昨天=' + D_Y + ' 今天=' + D_T + ' → ' +
    JSON.stringify(nd.map(d => d.date + ' 日出=' + (d.sunrise || '(无)') + ' 最高=' + d.tmax)));
/* 同一刀的两个副作用也要钉住：① 该源日期两种写法都出现过（斜杠形式见 Java 端 normDate），
 *    下限或「今天」这一侧不跟着归一就会让 '2026-09-25' >= '2026/09/25' 恒假 ⇒ 整份预报被掐空；
 * ② 真掐空时（设备时钟跑得太前、报文整段都是过去的）必须退回没过滤的那份，
 *    而不是让预报、当日高/低、通知那一段一起消失。 */
const rawWith = (pub, dates) => ({ data: {
  real: cwRaw.data.real,
  predict: { publish_time: pub, detail: dates.map((dt, i) => slot(dt, 9 + i)) }
} });
const slashed = cw.normalize(rawWith(slash(D_Y) + ' 20:00', [D_Y, D_T, D_T1].map(slash))).daily;
const starved = cw.normalize(rawWith(slash(shiftDay(-40)) + ' 20:00', [shiftDay(-40), shiftDay(-39)])).daily;
push('下限按日期写法不挑，判据掐空时退回未过滤的那份',
  slashed.length === 2 && slashed[0].date === D_T &&
    starved.length === 2 && starved[0].date === shiftDay(-40) && !!starved[0].sunrise,
  '斜杠报文 → ' + JSON.stringify(slashed.map(d => d.date)) + '；下限晚于全部条目 → ' + JSON.stringify(starved.map(d => d.date)));
/* 后台存活那条通知（android/…/WeatherKeepAliveService.java）是在没有 WebView 的进程里按
 * 这份「配方」的路径自己取数的，而它的 resolve() 认 [字段={today}] 这种按日期匹配。
 * 界面既然已经改成「当天那一条才算今天」，配方里就不许再留 predict.detail[0] 这种位置寻址 ——
 * 否则 20 点前后两边取的不是同一条，界面显示今日、通知端出昨日。 */
cwRaw.__url = 'https://www.nmc.cn/rest/weather?stationid=fixture';
const rp = cw.normalize(cwRaw).recipe.paths;
const rpTxt = JSON.stringify(rp);
push('配方里预报那一段按日期取，不留位置下标（通知与界面同一条）',
  rp.tmax[0].indexOf('detail[date={today}]') >= 0 && !/detail\[0\]/.test(rpTxt),
  'tmax=' + rp.tmax[0] + '，tmin=' + rp.tmin[0] + '，整份配方里含 "[0]"：' + /detail\[0\]/.test(rpTxt));



/* 系统的「增加对比度」要能一票否决主题定的那个透出值 —— 这条是防被后人当冗余删掉。
 * 原先只是在 CSS 文本里搜 `@media (prefers-contrast: more)` 这串字符：规则写了但**选择器写错、
 * 少一条声明、或者排到了 @supports 玻璃名单之前**（那样就被后面那条覆盖掉，等于没写），
 * 三种情况它都照样绿。改成读 CSSOM，把「否决了什么、排在谁后面」一条条验。 */
const sheets = [];
for (const sh of document.styleSheets) {
  let rs; try { rs = sh.cssRules; } catch (e) { continue; }   // 跨源表读不到，跳过而不是当失败
  for (let i = 0; i < rs.length; i++) sheets.push({ rule: rs[i], i });
}
const media = sheets.find(x => x.rule.type === CSSRule.MEDIA_RULE &&
  /prefers-contrast/.test(x.rule.conditionText || String(x.rule.media.mediaText)));
const supports = sheets.find(x => x.rule.type === CSSRule.SUPPORTS_RULE &&
  /backdrop-filter/.test(x.rule.conditionText || ''));
let pcDecl = null, pcSel = '';
if (media) for (const r of media.rule.cssRules) {
  const fx = r.style && r.style.getPropertyValue('--glass-fx');
  if (fx === 'none') { pcDecl = { fx, surface: r.style.getPropertyValue('--surface'), muted: r.style.getPropertyValue('--muted') }; pcSel = r.selectorText || ''; }
}
push('prefers-contrast: more 真的否决玻璃（读 CSSOM，不是搜字符串）',
  !!media && !!pcDecl && pcSel.trim() === 'body' && pcDecl.surface.includes('var(--card)') &&
    pcDecl.muted.includes('muted-base') && !!supports && media.i > supports.i,
  '媒体规则=' + (media ? '有' : '无') + '，排在 @supports 之后=' + (media && supports ? media.i > supports.i : 'n/a') +
  '，选择器=' + (pcSel || '无') + '（玻璃不再分模式，就该是 body），退回值=' + JSON.stringify(pcDecl));



/* ---------- 以下三条放在最后：它们会改搜索框、当前城市与 AQI 卡，不能污染前面的断言 ---------- */

/* ① 定位落点的沿用判据（lib/locate.js 的 freshFix）。
 * 这条以前是 main.js 里手写的 `Date.now() - lf.at < FIX_KEEP_MS`，而且「系统定位开关关着」那一支
 * 根本没走它 —— 同一个问题两处答案不同。现在两处共用一个函数，判据本身要能单测。 */
const loc = await import('/weather-app/js/lib/locate.js');
const T0 = 1770000000000;
const fix = (over) => Object.assign({ lat: 23.1, lon: 113.2, at: T0 }, over);
const ff = c => loc.freshFix({ locFix: c }, T0 + 1000);
push('freshFix：29 分 59 秒内沿用、到点就作废，脏数据一律 null',
  loc.KEEP_FIX_MS === 30 * 60000 &&
    !!ff(fix()) && !!ff(fix({ at: T0 + 1000 - (loc.KEEP_FIX_MS - 1) })) &&
    ff(fix({ at: T0 + 1000 - loc.KEEP_FIX_MS })) === null &&
    ff(null) === null && ff({ lat: 'x', lon: 1, at: T0 }) === null && ff({ lat: 0, lon: 0, at: T0 }) === null,
  '窗口 ' + loc.KEEP_FIX_MS / 60000 + ' 分钟；到点值=' + ff(fix({ at: T0 + 1000 - loc.KEEP_FIX_MS })) +
  '；(0,0)=' + ff({ lat: 0, lon: 0, at: T0 }));

/* ② AQI 卡：徽章要写出这组数来自哪座城/哪个站，而且**过期的一律不许画**。
 * 用桩 provider 打两次：第一次慢、地名「甲城」，第二次快、地名「乙城」——
 * 没有令牌的话甲城那发晚回来会盖在乙城的卡上（正是「拿别的城市糊弄」的形状）。 */
const uiMod = await import('/weather-app/js/ui.js');
const stubProvider = (name, v, ms) => ({
  id: 'stub-' + name, airLabel: '国控站实测', airStd: 'cn', cap: { air: true },
  airQuality: () => new Promise(r => setTimeout(() => r({ current: { us_aqi: v, pm2_5: null, pm10: null, ozone: null } }), ms))
});
uiMod.loadAir(stubProvider('slow', 88, 900), 23.1, 113.2, false, '甲城市');
uiMod.loadAir(stubProvider('fast', 31, 60), 39.9, 116.4, false, '北京市');
await sleep(1400);
const srcTxt = (document.querySelector('#air .cur-src') || {}).textContent || '';
const numTxt = (document.querySelector('#air .air-num') || {}).textContent || '';
push('AQI 卡写出对应城市，且慢回来的上一城不许盖到新卡上',
  srcTxt.indexOf('北京市 国控站实测') >= 0 && srcTxt.indexOf('甲城市') < 0 && numTxt.indexOf('31') === 0,
  '徽章「' + srcTxt + '」，数值「' + numTxt + '」');
/* 定位/网络定位这类不是地名的标题，不许被当成出处（写了就是假出处） */
uiMod.loadAir(stubProvider('bare', 45, 30), 23.1, 113.2, false, '我的位置');
await sleep(500);
const bareTxt = (document.querySelector('#air .cur-src') || {}).textContent || '';
push('标题不是地名时不硬凑出处', bareTxt.indexOf('我的位置') < 0 && bareTxt.indexOf('国控站实测') >= 0, '徽章「' + bareTxt + '」');

/* ③ 搜索完成后联想列表不许被过期响应弹回来（用户反馈：搜完了候选框还挂在下面）。
 * 形状要先复现：输入 → 260ms 防抖起跳、联想那一发还在路上 → 这时回车 → hideSuggest 收了列表，
 * 但晚到的响应一看 seq 没变，判定「结果仍有效」，于是**结果都画完了列表又弹回来**
 * （实测：标题已是「开封 · 中国」，#suggest 还挂着 8 项）。
 * 两个必须处理的不确定性：① 检索结果按词缓存在 localStorage，命中就秒回、没有在途窗口 —— 先把这个词摘掉；
 * ② 迟到的响应到底有没有回来 —— 光看「最后列表是收着的」会把它写成空断言（第一版就是这么假绿的：
 *   给 fetch 垫 700ms 反而让联想超时失败，什么都没测到还报 PASS）。
 *   正向对照钉在「这份假报文真的被应用读掉了」上（`.json()` 被调用才算），不靠真网络也不靠标题 ——
 *   原来那版拿标题当对照是空的，2026-10-06 被 falsify 第 113 处当场判成摆设，细节写在下面那段。 */
const inp = document.getElementById('cityInput'), sug = document.getElementById('suggest');
const TERM = '开封';
try {
  const g = JSON.parse(localStorage.getItem('weather-studio-geo') || '{}');
  delete g[TERM];
  localStorage.setItem('weather-studio-geo', JSON.stringify(g));
} catch (e) { /* 缓存读不动就算了，最坏是这一发命中缓存 */ }
const realFetch = window.fetch;
/* 这一发的响应**不打真网络**：桩里直接给一份假报文，而且**故意不理 signal**。
 * 为什么非这样不可（2026-10-06 用变异量出来的）：原来那版拿「首页标题变成开封」当正向对照，
 * 可中国天气那一路查「开封」先命中自带站点码表、一发外部检索都不打 ⇒ 标题跟联想那一发**没关系**；
 * 于是把 `hideSuggest` 的两道闸（seq++ 与 abort）一起撤掉，联想照样不弹，整套 126 条全绿 ——
 * **这条断言当时是摆设**（falsify 表里第 113 处把它抓出来的）。
 * 现在对照钉死在两件事上：① `fetchJson` 会先取 `.ok` 再 `.json()`，所以这份假 Response 的 json()
 * 被调用 = 那一发真的 resolve 到了 `fetchSuggest` 手里，拦得住列表的只剩它那两道闸；
 * ② 不理 signal —— 真 abort 会让它 reject，那就只剩「网络被掐了」一种解释，seq 那一半永远测不到。
 * 坐标用开封真值（34.797, 114.353），万一落进码表缓存也不至于把别条断言喂成脏数据。 */
let 被读 = 0;
const 假报文 = 数据 => ({ ok: true, json: () => { 被读++; return Promise.resolve(数据); } });
const OM假 = { results: [{ name: TERM, latitude: 34.797, longitude: 114.353, feature_code: 'PPLA2', country_code: 'CN', admin1: '河南省' }] };
window.fetch = function (u) {
  const s = String(u);
  if (s.indexOf('geocoding-api.open-meteo.com') >= 0) return new Promise(r => setTimeout(() => r(假报文(OM假)), 900));
  if (s.indexOf('photon.komoot.io') >= 0) return new Promise(r => setTimeout(() => r(假报文({ features: [] })), 900));
  return realFetch.apply(this, arguments);
};
inp.focus();
inp.value = TERM;
inp.dispatchEvent(new Event('input', { bubbles: true }));
await sleep(330);                                     // 防抖（260ms）已起跳，假报文要 900ms 才回
const inFlight = sug.hidden;                          // 此刻列表应当还没弹出来
/* 「弹回来」要看得见：250ms 的采样会漏掉一闪而过的 re-open，所以直接盯属性变化。
 * 这比原来更强 —— 哪怕只露一帧也算数。 */
let everVisible = false;
const 看 = new MutationObserver(() => { if (!sug.hidden) everVisible = true; });
看.observe(sug, { attributes: true, attributeFilter: ['hidden'] });
inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
let 落地在 = -1;
for (let i = 0; i < 24; i++) {                        // 上限 6s：假报文 900ms 必回，用不到网络那一档
  if (落地在 < 0) { if (被读 > 0) 落地在 = i; }
  else if (i > 落地在 + 8) break;                     // 落地之后再给 2s 让「迟到的列表」露出来
  await sleep(250);
}
看.disconnect();
window.fetch = realFetch;
push('回车搜索完成后，候选列表不被在途的联想重新弹出',
  inFlight && 落地在 >= 0 && !everVisible && sug.hidden === true,
  '回车时列表在途=' + inFlight + '，假报文被应用读掉=' + 被读 + ' 发（落地于第 ' + 落地在 + ' 拍）' +
  '，迟到响应弹出过列表=' + everVisible + '，结束时 hidden=' + sug.hidden + '、' + sug.children.length + ' 项');


/* ---------- 浮层退场不留「透明面板」（2026-09-27 用户报：设置界面偶发卡死，快速切换、多次点击之后点不动滚不动）
 * 根因两条，都在 lib/sheet.js，浏览器里逐条量过：
 *   ① closeSheet 用 fill:'forwards' 播退场，跑完之后那个动画**一直挂在元素上**，computed opacity 就此钉死在 0。
 *      下一次打开只是 hidden=false，透明度还留着 —— `.modal` 是 position:fixed; inset:0; z-index:50，
 *      于是面板看不见却盖满整屏、吃掉每一个点击：界面正常，就是点不动。
 *   ② 退场途中重新打开，先前那一趟的 done() 照样执行，把刚打开的面板又 hidden 掉（快速切换那一下）。
 * 断言走真实入口（点 #openSettings / #closeSettings），不碰 sheet.js 内部。 */
{
  const modal = document.getElementById('settingsModal');
  const openBtn = document.getElementById('openSettings');
  const closeBtn = document.getElementById('closeSettings');
  const cardCenter = () => {
    const r = modal.getBoundingClientRect();
    return document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
  };
  const pushAnims = () => { modal.getAnimations().forEach(a => { try { a.finish(); } catch (e) { /* 已废 */ } }); };
  /* 收场必须走真实入口（点 ✕）而不是 `modal.hidden = true`：背景滚动锁归 sheet.js 管，
   * 直接改 hidden 会把这一层永远留在"在场"里，后面那条"关掉排名浮层后锁该解除"就红在它身上
   * （2026-10-01 第一次把锁收进 sheet.js 时就是这个现象）。270ms 的硬超时保证它一定落定。 */
  const reset = async () => {
    if (!modal.hidden) closeBtn.click();
    modal.getAnimations().forEach(a => { try { a.cancel(); } catch (e) { /* 本来就废了 */ } });
    await sleep(420);
  };

  await reset();
  /* ① 开 → 关 → 让那一趟真跑到终点（后台标签里时间线不推进，所以手动推，与真机自然到点同一条提交路径）→ 再开 */
  openBtn.click();
  closeBtn.click();
  await sleep(420);                      // closeSheet 的硬超时是 270ms，先让它落定
  pushAnims();
  await sleep(60);
  openBtn.click();
  await sleep(300);                      // v152 的 .modal 有 220ms 的 overlay-in，等它跑完再读透明度
  const opA = getComputedStyle(modal).opacity;
  const hitA = cardCenter();
  push('关一次之后再打开，面板不是透明的（退场动画的 fill 不能留在元素上）',
    modal.hidden === false && opA === '1' && !!hitA && modal.contains(hitA),
    'hidden=' + modal.hidden + '，opacity=' + opA + '，面板中央命中的是 ' +
    (hitA ? (hitA.id ? '#' + hitA.id : hitA.tagName + '.' + hitA.className) : 'null') +
    '，挂着的动画=' + modal.getAnimations().length + ' 个');

  /* ② 退场还在途就重开：那一趟不该把刚打开的面板藏掉 */
  await reset();
  openBtn.click();
  closeBtn.click();
  openBtn.click();                       // 真机上是那 150ms 里的一下
  await sleep(500);
  const hitB = cardCenter();
  push('退场途中重新打开，先前那一趟不把它藏掉（快速切换那一下）',
    modal.hidden === false && getComputedStyle(modal).opacity === '1' && !!hitB && modal.contains(hitB),
    'hidden=' + modal.hidden + '，opacity=' + getComputedStyle(modal).opacity +
    '，命中=' + (hitB ? hitB.tagName + '.' + hitB.className : 'null'));

  await reset();                         // 别把打开的浮层留给后面的断言

  /* ③ 排名浮层走的是同一个 helper，但它带 after（解除 body[data-sheet] 的滚动锁）。
   *    重开时那一趟被作废，after 就**不该**跑 —— 否则锁没了、面板还开着，页面又开始滚。 */
  const rv = document.getElementById('rankView');
  const closeRank = async () => { rank.close(); for (let i = 0; i < 20 && (rv.hidden === false || document.body.hasAttribute('data-sheet')); i++) await sleep(60); };
  await closeRank();
  rank.open('云浮');
  await sleep(80);
  rank.close();
  rank.open('云浮');                     // 退场还在途
  await sleep(500);
  push('排名浮层退场途中重开，背景滚动锁不被那一趟解除（after 只在真关掉时跑）',
    rv.hidden === false && document.body.hasAttribute('data-sheet'),
    '重开后 hidden=' + rv.hidden + '，data-sheet=' + (document.body.dataset.sheet || '(无)'));
  await closeRank();
  push('收尾：正常关掉排名浮层后滚动锁解除',
    rv.hidden === true && !document.body.hasAttribute('data-sheet'),
    'hidden=' + rv.hidden + '，data-sheet=' + (document.body.dataset.sheet || '(无)'));
}

/* ---------- 今日天气（今天 00–23 时逐小时，2026-09-27 新增）
 * 要盯住的是三件事：默认源「中国天气」根本没有逐小时（cap.hourly:false，报文里 passedchart
 * 那 24 格是过去 24 小时实测），所以这张卡靠的是 lib/hourly.js 的退路 —— 退到别家就**必须**把出处
 * 写在卡上（宁缺勿错）；两边都给不出就整块收起，不许留空卡；「现在/已过」必须按**该地**时刻标，
 * 拿浏览器时钟去标别处会整排标错。 */
{
  const hw = document.getElementById('hourlyWrap');
  const air = document.getElementById('airWrap');
  const src = document.getElementById('hourlySrc');
  const hrs = () => [].slice.call(hw.querySelectorAll('.hr'));
  const label = n => (n ? n.querySelector('.hr-t').textContent : '');
  const q = await import('/weather-app/js/query.js');
  const 有格子 = () => !hw.hidden && hrs().length > 0;
  for (let i = 0; i < 40 && !有格子(); i++) await sleep(400);
  if (!有格子()) {           // 首屏那一发整个失败了（真实网络会这样）：自己查一次，别把后面五条用例一起吊死
    q.query({ lat: 22.71, lon: 112.25, name: '新兴', label: '新兴（测试用）' });
    for (let i = 0; i < 40 && !有格子(); i++) await sleep(400);
  }
  const cells = hrs();
  const nowIdx = cells.findIndex(n => n.classList.contains('now'));
  const title = hw.querySelector('.forecast-title').textContent.replace(/\s+/g, ' ').trim();

  push('今日天气排在空气质量之后，标题与窗口按「今天 00–23 时」写',
    !hw.hidden && (hw.compareDocumentPosition(air) & Node.DOCUMENT_POSITION_PRECEDING) !== 0 &&
      /^今日天气/.test(title) && document.getElementById('hourlyScope').textContent === '今天 00–23 时',
    'hidden=' + hw.hidden + '，空气质量在它之前=' + ((hw.compareDocumentPosition(air) & 2) !== 0) + '，标题=' + title.slice(0, 24));
  push('默认源没有逐小时，这张卡靠退路填满 24 格，每格都有温度与天气现象',
    cells.length === 24 && cells.every(n => /°/.test(n.querySelector('.hr-temp').textContent)) &&
      cells.every(n => n.querySelector('.hr-desc').textContent.length > 0),
    '格数=' + cells.length + '，首格=' + label(cells[0]) + '，末格=' + label(cells[23]) +
    '，源=' + (JSON.parse(localStorage.getItem('weather-studio-config') || '{}').provider || '?'));
  push('走了退路就把出处写在卡上（不能拿别家的数冒充中国天气）',
    !src.hidden && /Open-Meteo/.test(src.textContent), '徽章=' + (src.hidden ? '(未显示)' : src.textContent));
  /* 这一条原来写的是 `nowIdx > 0`，于是零点后头一个钟头必然假红 —— 而那时候的状态其实是对的：
   * 「现在」就是第 0 格，前面一格都没有，已过 0 格。真正的不变量是**已过恰好是「现在」之前那一段，
   * 连续、一格不多一格不少**，与几点钟无关。按下标列一遍，顺带把「中间跳着标」「现在之后还标」
   * 两种错也一起拦掉（原写法这两种都拦不住，只要总数对上就绿）。 */
  const pastAt = cells.map((n, i) => n.classList.contains('past') ? i : -1).filter(i => i >= 0);
  push('已过去的格子恰好排在「现在」之前（顺序与标记互相对得上）',
    nowIdx >= 0 && pastAt.length === nowIdx && pastAt.every((v, k) => v === k),
    '现在在第 ' + nowIdx + ' 格，标了已过 ' + pastAt.length + ' 格' +
    (pastAt.length ? '，下标 ' + pastAt.join('') : '') +
    (pastAt.length > 0 && pastAt[0] !== 0 ? '（第一格就被标成已过）' : ''));

  /* 逐日卡下钻：点某天 → 格子换成那天全天 + 返回按钮出现；点返回 → 回到今天 */
  const drill = document.querySelector('#forecast .day.act');
  if (drill) {
    drill.click();
    await sleep(400);
    const inDay = /全天/.test(document.getElementById('hourlyScope').textContent) &&
      !document.getElementById('hourlyBack').hidden;
    document.getElementById('hourlyBack').click();
    await sleep(400);
    push('点日卡看当天逐小时、再返回今日天气，两态都跟手',
      inDay && document.getElementById('hourlyScope').textContent === '今天 00–23 时',
      '下钻态=' + inDay + '，返回后窗口=' + document.getElementById('hourlyScope').textContent);
  } else {
    push('点日卡看当天逐小时、再返回今日天气，两态都跟手', false, '未来预报里没有可下钻的日卡');
  }

  /* 退路也拿不到 → 整块收起。换坐标是为了绕开 lib/hourly.js 那 30 分钟缓存（同坐标会直接命中缓存，
   * 掐掉 fetch 也照样画得出格子，那就测不到这一条了）。 */
  const realFetch2 = window.fetch;
  window.fetch = (u, o) => (String(u).indexOf('api.open-meteo.com') >= 0
    ? Promise.reject(new Error('测试：掐掉逐小时退路')) : realFetch2.call(window, u, o));
  q.query({ lat: 23.13, lon: 113.26, name: '广州', label: '广州（测试用）' });
  await sleep(400);
  /* 原来这里问的是 `!hw.hidden`，第一次跑绿、第二次就红：换目标时应用是把**整个结果区**交给骨架屏
   * （query.js:60 → ui.showSkeleton 里 el.result.hidden = true），#hourlyWrap 自己的 hidden 还是 false，
   * 于是这一条实际上变成了「网络有没有在 400ms 内跑完」——测的是竞态，不是行为。
   * 要防的是「屏幕上还露着上一座城的格子」，那就得按可见性问（祖先收掉 ⇒ 没有 client rect）。 */
  const 在屏上 = n => !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length);
  const 换城市瞬间没收 = 在屏上(hw);              // 上一座城的格子必须立刻收掉，不能留在屏幕上
  for (let i = 0; i < 20 && !hw.hidden; i++) await sleep(400);
  window.fetch = realFetch2;
  push('当前源与退路都给不出逐小时时整块隐藏，不留空卡、也不留上一座城的格子',
    !换城市瞬间没收 && hw.hidden, '换城市瞬间在屏上=' + 换城市瞬间没收 + '，退路被掐后 hidden=' + hw.hidden);

  /* 再查一次同一座城：这一回 render() 建日卡时 hourlyByDay 还是空的（上一发刚被掐掉），
   * 格子晚一步才回来 —— 所以「哪些日卡能点」必须在格子到位之后重盖一次章。
   * 少了那一步，首屏每张日卡都点不动，要等下一次查询才「自己好了」（第一版就是这样）。 */
  q.query({ lat: 23.13, lon: 113.26, name: '广州', label: '广州（测试用）' });
  for (let i = 0; i < 30 && (hw.hidden || !hrs().length); i++) await sleep(400);
  const dayCards = [].slice.call(document.querySelectorAll('#forecast .day'));
  push('逐小时晚到一步之后，日卡「可看当天」的状态当场跟上（不等下一次查询）',
    dayCards.length >= 2 && dayCards.every(d => d.classList.contains('act')),
    dayCards.length + ' 张日卡，可点 ' + dayCards.filter(d => d.classList.contains('act')).length +
    ' 张，格子 ' + hrs().length + ' 格');

  /* 「现在」按该地时刻标。这一步同时验两件事：换成 Open-Meteo 当数据源时它自己就给得出逐小时，
   * 所以**不该**再挂退路徽章；而东京那一格的时刻要等于平台时区库算出的东京此刻
   * （期望值取自 Intl，不是应用自己算的，否则就是自己证自己）。 */
  // 必须走 saveConfig：loadConfig 在内存里 memo 了一份，直接写 localStorage 应用看不见
  //（第一版就是这么踩的：换源没生效，东京那一发打到中国天气上，而那套站点码表里没有外国站）
  const cfgApi = await import('/weather-app/js/lib/config.js');
  const cfgT = cfgApi.loadConfig();
  cfgApi.saveConfig(Object.assign({}, cfgT, { provider: 'open-meteo' }));
  q.query({ lat: 35.68, lon: 139.69, name: '东京', label: '东京（测试用）' });
  const 到了东京 = () => document.getElementById('locName').textContent.indexOf('东京') >= 0 && hrs().length >= 24;
  for (let i = 0; i < 30 && !到了东京(); i++) await sleep(400);
  /* 格子按 00–23 排，所以「第几格是现在」就是当地的几点 —— 不能拿标签比（那一格写着「现在」）。
   * 本机是 UTC+8、东京是 UTC+9，两者恒差一小时：要是实现用了浏览器时钟，标出来的会是第 tk-1 格，
   * 这条就红。期望值取自平台时区库（Intl），不是应用自己算的，否则就是自己证自己。 */
  const tk = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false }).format(new Date()));
  const nowAt = hrs().findIndex(n => n.classList.contains('now'));
  push('「现在」按该地时刻标（查东京标的是东京的此刻，不是本机 +8），且当前源给得出时不再挂退路徽章',
    nowAt === tk && src.hidden,
    '东京此刻应为第 ' + tk + ' 格，实际「现在」落在第 ' + nowAt + ' 格（本机时刻是第 ' +
    Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false }).format(new Date())) +
    ' 格），徽章=' + (src.hidden ? '未显示' : src.textContent));
  cfgApi.saveConfig(Object.assign({}, cfgApi.loadConfig(), { provider: 'nmc' }));
}

/* ---------- 逐日卡的降水三态（2026-09-27 补回）----------
 * 2026-09-26 删温度趋势大图时，「真没下」与「源没给这个字段」的判据随图一起走了，逐日卡只剩
 * `precip > 0` 才出声 —— 两种情形在屏幕上重新变成同一张脸。
 * 三态要摆齐只能自己造：合成数据直接喂 render()。真机此刻那份 nmc 报文确实是 2.1 / 0.0×3 / ''×2
 * 三种都有（已逐张卡看过），但那是当天的天气，明天就换一副 —— 拿它当期望值，用例第二天就红了。 */
{
  const cases = [
    { tmax: 20, tmin: 10, precip: 3.5, precipProb: 60 },   // 有量，且同时给了概率
    { tmax: 21, tmin: 11, precip: 0 },                     // 源明确说没下
    { tmax: 22, tmin: 12 },                                // 源没给这个字段
    { tmax: 23, tmin: 13, precip: 12.6 },                  // ≥10 收成整数
    { tmax: 24, tmin: 14, precip: '' },                    // 自定义源的空串
    { tmax: 25, tmin: 15, precip: '0.0' },                 // 字符串零
    { tmax: 26, tmin: 16, precip: 'abc' }                  // 怪值
  ].map((x, i) => Object.assign({ date: shiftDay(i), desc: '测试' }, x));
  uiMod.render({ current: { temp: 18, desc: '小雨', icon: 'rain' }, daily: cases },
    '降水三态（测试用）', 'nmc', null, false);
  await sleep(120);
  const cards = [].slice.call(document.querySelectorAll('#forecast .day'));
  const mm = c => { const n = c && c.querySelector('.d-mm'); return n ? n.textContent : '(不画)'; };
  const got = cards.map(mm);
  const want = ['3.5 mm', '0 mm', '(不画)', '13 mm', '(不画)', '0 mm', '(不画)'];
  push('降水三态各归各位：有量报 mm、明确 0 说「0 mm」、源没给就一行都不画',
    cards.length === 7 && got.join('｜') === want.join('｜'),
    want.map((w, i) => i + ':' + w + '/' + got[i]).join(' '));

  /* 第二态不许借 --pop（那是「有雨」的颜色），也不能反过来把第一态压成哑色。
   * 参照物取同卡上已在用的节点：.d-name 就是 --muted，.d-pop 就是 --pop —— 不解析 CSS 变量，
   * 免得测试和应用用同一份解析逻辑自己证自己。 */
  const col = n => (n ? getComputedStyle(n).color : '(没有这个节点)');
  const popRef = col(cards[0].querySelector('.d-pop'));
  const mutedRef = col(cards[0].querySelector('.d-name'));
  const cSome = col(cards[0].querySelector('.d-mm')), cNone = col(cards[1].querySelector('.d-mm'));
  push('「0 mm」用静音色，「N mm」仍是降水色（两态在屏幕上必须是两件事）',
    popRef !== mutedRef && cSome === popRef && cNone === mutedRef,
    '有雨=' + cSome + '（--pop=' + popRef + '），没下=' + cNone + '（--muted=' + mutedRef + '）');

  const qq = await import('/weather-app/js/query.js');
  qq.query({ lat: 22.71, lon: 112.25, name: '新兴', label: '新兴（测试用）' });
  await sleep(600);
}

/* ---------- 通知配方：没送达不许记账（2026-09-27）----------
 * 真机上见过「界面在郑州、通知还在按新兴的配方每小时刷新」：pushRecipe 在调用之前就把这次
 * 记成「这份发过了」，失败又被 catch 吞掉，于是同一份配方整个会话再不重发。这里拿假插件
 * 钉住两侧：被拒之后每一轮都要补发（少补一次就是那条永久分家），送达之后同一份不许再刷。 */
{
  const notify = await import('/weather-app/js/lib/notify.js');
  const tries = [];
  let mode = 'fail';
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: { WeatherNotify: {
      keepAlive: o => { tries.push(o.recipe.url || '(on:false)'); return mode === 'fail' ? Promise.reject(new Error('测试：原生没收到')) : Promise.resolve({}); },
      show: () => Promise.resolve({}), clear: () => Promise.resolve({}), alert: () => Promise.resolve({})
    } }
  };
  const tick = () => { notify.resync(); };
  // 先让应用自己的那一发落地（上面刚查过新兴），再数「我主动催的这五次里补发了几次」
  await sleep(300);
  const n0 = tries.length;
  for (let i = 0; i < 5; i++) { tick(); await sleep(60); }
  const 补发 = tries.length - n0;
  const n1 = tries.length;
  mode = 'ok';
  tick();
  await sleep(120);
  const 送达那发 = tries.length - n1;
  const n2 = tries.length;
  for (let i = 0; i < 3; i++) { tick(); await sleep(60); }
  push('配方被原生拒过一次之后必须补发（不许「以为发过了」就沉默一整个会话）',
    补发 >= 5 && 送达那发 === 1,
    '催 5 次补发 ' + 补发 + ' 次（失败不记账就该每次都重发）；改成功后催 1 次发了 ' + 送达那发 + ' 次');
  push('送达之后同一份配方不再重发（别每轮刷新都惊动原生一次）',
    tries.length - n2 === 0, '成功后又催 3 次，原生额外收到 ' + (tries.length - n2) + ' 次');
  delete window.Capacitor;
}

/* ---------- 桌面图标（2026-09-27 新增，只在壳里出现）----------
 * 图标是编译期资源，运行时只能在打进 APK 的几套之间换，所以界面上只给预设、不给相册入口。
 * 这一组要钉住的是「谁说了算」：浏览器里没有插件 → 整组不出现；壳里 → 打开设置问一次原生，
 * 点一枚把名字交出去，**选中态跟原生回的那个名字走**（原生回的不是我点的那个时也得跟原生）。 */
{
  const grp = document.getElementById('iconGroup');
  const grid = document.getElementById('iconGrid');
  const thumbs = () => [].slice.call(grid.querySelectorAll('.ic-thumb'));
  const onIds = () => thumbs().filter(n => n.classList.contains('on')).map(n => n.dataset.id).join(',');
  push('没有 WeatherIcon 插件（浏览器）时，设置里「桌面图标」这一组不出现',
    grp.hidden === true && thumbs().length === 0,
    'hidden=' + grp.hidden + '，预览 ' + thumbs().length + ' 枚');

  const calls = [];
  let echo = null;                       // 非空时，原生故意回一个与请求不同的名字
  window.Capacitor = { isNativePlatform: () => true, Plugins: { WeatherIcon: {
    getIcon: () => Promise.resolve({ icon: 'night' }),
    setIcon: o => { calls.push(o.name); return Promise.resolve({ icon: echo || o.name }); }
  } } };
  document.getElementById('openSettings').click();
  await sleep(400);
  push('挂上插件后打开设置：四枚预设都在，且当前生效的那套被标出来',
    !grp.hidden && thumbs().length === 4 && onIds() === 'night',
    'hidden=' + grp.hidden + '，枚数=' + thumbs().length + '，选中=' + (onIds() || '(无)'));

  thumbs().find(n => n.dataset.id === 'sun').click();
  await sleep(300);
  push('点一枚就把名字交给原生，并按原生回的名字更新选中态',
    calls.join(',') === 'sun' && onIds() === 'sun',
    '交给原生的=' + (calls.join(',') || '(没调用)') + '，选中=' + (onIds() || '(无)'));

  echo = 'bloom';                        // 原生说「其实生效的是花嫁」（例如被 ROM 改过）
  thumbs().find(n => n.dataset.id === 'night').click();
  await sleep(300);
  push('原生回的名字与点的不一样时，界面跟原生走（不许自己画一个选中态）',
    calls.join(',') === 'sun,night' && onIds() === 'bloom',
    '交给原生的=' + calls.join(',') + '，选中=' + (onIds() || '(无)'));

  document.getElementById('closeSettings').click();
  await sleep(400);
  delete window.Capacitor;
}

/* ---------- 占位标题不是地名 ----------
 * 「我的位置」「网络定位」只当标题占位符；拿它去问只认地名的源必然「没有收录」。
 * v152 下墨迹源已整源下架，反查链不再需要 placeCandidates，只留这条仍然生效的判据。 */
{
  const geo = await import('/weather-app/js/lib/geo.js');
  push('占位标题只有那两种，别的名字不许当占位符（否则搜出来的城市会被再反查一次改掉标题）',
    geo.isPlaceName('我的位置') === true && geo.isPlaceName('网络定位') === true &&
    geo.isPlaceName('新兴县') === false && geo.isPlaceName('') === false,
    '我的位置=' + geo.isPlaceName('我的位置') + '，新兴县=' + geo.isPlaceName('新兴县'));
}

/* ---------- 中文城市检索：用户写明「X县」时，类别必须参与排序 ----------
 * 历史复现（打「新兴县」回车）屏上标题是「Xinxing · Jilin Province」，
 * 广东那座真·新兴县排到第 10。根因不在检索源，在 `lib/geo.js` 的排序：Photon 在手机上回的是**英文名**
 *（同一句在桌面端回「新兴县」），同名加分一律 0，于是只剩行政等级说话，而等级表把 county(50)
 * 永远压在 city(80) 与 Open-Meteo 的 PPLA3(70) 下面 —— 用户点名要的那一类注定排最后。
 * 喂的字节是合成夹具（`tests/fixtures/xinxing-search-shapes.json`，四发：Photon×2 + Open-Meteo×2；坐标已整体平移、设备信息已移除）。
 * 吉林那条不在抓回来的这一份里（Photon 公共实例两次请求给的不一样，实测如此），照那次看到的形状补进表里，
 * 补的那一条在下面 `JILIN` 处单独标出。 */
{
  const geoApi = await import('/weather-app/js/lib/geo.js');
  const shapes = JSON.parse(await (await fetch('/tests/fixtures/xinxing-search-shapes.json')).text());
  const JILIN = { type: 'city', osm_key: 'place', osm_value: 'city', name: 'Xinxing',
    state: 'Jilin Province', country: 'China', geometry: { coordinates: [122.8425794, 44.7245784] } };
  shapes.photon_xinxing.body.features = [JILIN].concat(shapes.photon_xinxing.body.features || []);
  const realFetch = window.fetch;
  window.fetch = function (url) {
    const u = String(url);
    const q = decodeURIComponent((u.match(/[?&](?:q|name)=([^&]*)/) || [])[1] || '');
    const hit = u.indexOf('photon.') >= 0 ? (q === '新兴县' ? shapes.photon_xinxingxian : shapes.photon_xinxing)
      : u.indexOf('geocoding-api') >= 0 ? (q === '新兴县' ? shapes.openmeteo_xinxingxian : shapes.openmeteo_xinxing)
      : null;
    if (!hit) return realFetch.apply(window, arguments);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(hit.body) });
  };
  let cands = [], err = '';
  try { cands = await geoApi.searchCities('新兴县', new AbortController().signal); }
  catch (e) { err = String(e && e.message || e); }
  finally { window.fetch = realFetch; }
  const top = cands[0] || {};
  const fmt = c => [c.name, c.admin, c.src, 'rank' + c.rank, 'score' + c.score,
    (c.lat || 0).toFixed(3) + ',' + (c.lon || 0).toFixed(3)].join('/');
  push('搜「新兴县」必须落在广东那座县上：用户写明了类别，就不许被别省同名的高级别点顶掉',
    !err && Math.abs((top.lat || 0) - 25.6350852) < 1e-4 && Math.abs((top.lon || 0) - 120.1968457) < 1e-4,
    err ? '抛错：' + err : '首位=' + fmt(top) + '；被它压下去的依次是 ' + cands.slice(1, 4).map(fmt).join(' 、 '));
}

/* ---------- 站点映射：坐标 → 到底是哪个站 ----------
 * 拿错站不是「数值差一点」，是拿几百公里外那个省的天气当用户这里的，而且界面上看不出来。
 * 2026-09-27 由墨迹对照抓出：郑州的坐标被一个重名「河南」站（内蒙古）顶掉，码表里它俩同坐标。 */
{
  const { chinaWeather: cw } = await import('/weather-app/js/providers/chinaWeather.js');
  const at = (la, lo, c) => cw.stationFor(la, lo, c).then(s => s ? s.name + '|' + s.code : '（返回空，没有站）', e => '抛错：' + e.message);
  const zz = await at(34.758, 113.665, '郑州');
  push('郑州的坐标问回郑州那个站（曾被重名「河南」站顶掉，那是内蒙古的站）',
    zz === '郑州|YVItN', zz);

  /* 上面那条挑不出「码表清洗」的功劳：城市名一给，平局按名字也能挑对。
   * 这一条故意不给名字 —— 只剩坐标可依靠，逼系统回答「那个坐标上到底站着一个谁」。
   * 脏坐标一旦回到表里（它在 郑州 之前一行），这里就会翻回内蒙古的河南站。 */
  const blind = await at(34.758, 113.665, '');
  push('只给坐标、不给城市名时也只能问回郑州那个站（这条才真的靠码表清洗）',
    blind === '郑州|YVItN', blind);

  /* 站太远时必须报不出站，而不是就近抓一个顶上的。这条管的是清洗之外的那半套防线：
   * 码表里漏网的脏坐标（或用户跑到海上、边境）都该走到「查无此站」，让界面明说拿不到。 */
  const far = await at(0, 0, '');
  push('离任何站都上千公里时必须是「报不出站」，不许就近拿一个顶上的',
    far.indexOf('抛错') === 0, far);

  const lv = await at(37.524, 111.134, '吕梁');
  const ls = await at(37.524, 111.134, '离石');
  push('两个站共用一个中心点时按所查城市名选，不许看表里的行序',
    lv === '吕梁|EQQRH' && ls === '离石|lOfKI', '吕梁→' + lv + '，离石→' + ls);

  const byName = await at(null, null, '郑州');
  push('没有坐标、只有城市名时仍查到同一个站', byName === '郑州|YVItN', byName);
}

/* ---------- 设置面板里不许再写死长段说明 ----------
 * 2026-09-30 用户要求删掉那四条（背景滑杆、桌面图标、轮播、localStorage）。它们原本是给
 * 开发者自己看的实测叙述，堆在界面上就是噪音。保留的只有两类：按数据源现算的动态提示
 * （notifyHint / alertHint 那两枚带 id 的），和自定义源那一格的 URL 语法。
 * （原来这里还数着 providerNote 与 #bgInfo：前者搬进了「软件声明」那一组，后者随背景模块删除。）
 * 所以判据是「没有 id、又不在 #customFields 里的 .hint」必须为 0 条 —— 谁再往面板里塞
 * 一段解释，这条就红。 */
{
  const stray = [...document.querySelectorAll('#settingsModal .hint')]
    .filter(e => !e.id && !e.closest('#customFields'));
  push('设置面板里不许再写死长段说明（要解释写进 README，界面上只留动态提示）',
    stray.length === 0,
    stray.length ? stray.map(e => (e.textContent || '').trim().slice(0, 20) + '…').join(' 、 ')
      : '写死的 .hint 0 条；带 id 的动态提示 ' +
        [...document.querySelectorAll('#settingsModal .hint')].filter(e => e.id).length + ' 条');
}

/* 上一条只拦「没有 id 的写死说明」，于是留下一个洞：**带 id 但已经没人写的死元素**照样过关。
 * 2026-10-01 就是这么留出来的 —— `#providerNote` 搬进「软件声明」之后 markup 里那一段没删，
 * JS 侧早就不碰它了，而 `.hint` 自带 padding + 边框 + 底色，空着也会在面板里画出一条实心小色块。
 * 用户第一反应是「软件声明我没在设置里面看见」，一半责任在这一块噪声上。
 * 判据按**画出来的形状**问，不按谁写它问：面板里每一条 .hint，要么有字，要么压根没高度。 */
{
  document.getElementById('openSettings').click();
  await sleep(600);
  /* 只量「当前配置下看得见」的那些 .hint 会漏：有几枚藏在按状态才显示的行里
   * （以前就是 `#bgInfo` 那一枚，只在背景模式=相册图时出现 —— 那个模式 2026-10-04 删了，
   * 但这一手不删：下一个「只在某状态下出现的提示块」还是同一形状）。
   * 先把带 .hint 的隐藏行临时掀开，量完原样收回。 */
  const rows = [...document.querySelectorAll('#settingsModal [hidden]')].filter(e => e.querySelector('.hint'));
  const 收回 = rows.map(r => r.hidden);
  rows.forEach(r => { r.hidden = false; });
  const empties = [...document.querySelectorAll('#settingsModal .hint')]
    .filter(e => !String(e.textContent || '').trim() && e.getBoundingClientRect().height > 0);
  rows.forEach((r, i) => { r.hidden = 收回[i]; });
  document.getElementById('closeSettings').click();
  await sleep(400);
  push('设置面板里不许留着「画得出框、却没字」的提示块（含按状态才显示的那几行）', empties.length === 0,
    empties.length ? empties.map(e => '#' + (e.id || '?') + ' 高 ' + Math.round(e.getBoundingClientRect().height) + 'px').join('、')
      : '带 id 的动态提示 ' + [...document.querySelectorAll('#settingsModal .hint')].filter(e => e.id).length +
        ' 条，全都有字（临时掀开的状态行 ' + rows.length + ' 个：' + rows.map(r => '#' + r.id).join(' ') + '）');
}

/* ---------- 软件声明这一组：必须跟着「面板里当前选中的那一家 + 当前口径」走 ----------
 * 这一段是这一轮新增模块的守卫。它防的不是「文字写错」，是**声明与实际分家**：
 * 选了不给空气的源却写着空气有、换了口径第一条还在讲上一套标准 —— 那比没有声明更糟。
 * 所以判据一律从注册表独立推一遍（同一份 cap，两条路径），而不是拿渲染结果自己比自己。 */
{
  const sel = document.getElementById('providerSel');
  const std = document.getElementById('aqiStdSel');
  const prevProvider = sel.value, prevStd = std.value;
  document.getElementById('openSettings').click();
  await sleep(700);
  const disc = id => document.querySelector('#discList .disc[data-d="' + id + '"]');
  const txt = id => { const d = disc(id); return d ? d.textContent.replace(/\s+/g, ' ') : '(没有这一条)'; };
  const { getProvider, providerLabel } = await import('/weather-app/js/providers/index.js');

  const ids = ['open-meteo', 'nmc', 'wttr-in', 'custom'];
  const bad = [], titles = [];
  /* 用**和面板一样的那份输入**推 cap：自定义那一家的能力是从用户填的映射里长出来的，
   * 而映射没填好时 getProvider 是会抛的 —— 面板选中「自定义 API」正是这种时候（第一版
   * 就是在这里当场炸掉整组渲染）。所以这里读 loadConfig().custom 而不是硬写 {}，
   * 免得测试与页面拿的是两份数据、比出来的绿没有意义。 */
  const { loadConfig } = await import('/weather-app/js/lib/config.js');
  const cu = loadConfig().custom;
  for (const id of ids) {
    sel.value = id; sel.dispatchEvent(new Event('change'));
    await sleep(120);
    let pr = null, c = null, threw = '';
    try { pr = getProvider({ provider: id, custom: cu }); c = (pr || {}).cap || {}; }
    catch (e) { threw = String((e && e.message) || e); }
    const body = txt('source');
    if (threw) {
      /* 推不出来就必须照实说推不出来，并且把原因带上 —— 编一套能力矩阵比没有更糟 */
      if (body.indexOf('推不出来') < 0 || body.indexOf(threw) < 0) bad.push(id + ' 映射不全会抛（' + threw + '），声明却没说「推不出来」');
    } else {
      /* 「逐小时 给」后面可能带档位（wttr.in 是 3 小时一档）—— 期望值要按注册表自己算一遍，
       * 不能写死「逐小时 给」，否则这一条会在源改口之后变成假红。 */
      const step = Number(pr && pr.hourlyStep) || 1;
      const want = ['实况 给', '逐日 ' + (c.daily ? '给' : '不给'),
        '逐小时 ' + (c.hourly ? '给' + (step > 1 ? '（' + step + ' 小时一档）' : '') : '不给'),
        '空气质量 ' + (c.air ? '给' : '不给'), '气象预警 ' + (c.alert ? '给' : '不给'),
        '划掉后自取 ' + (c.background ? '给' : '不给')].join(' · ');
      if (body.indexOf(want) < 0) bad.push(id + ' 的能力行不是从 cap 推的（缺「' + want + '」）');
      /* 署名那一栏的「谁补哪一格」也必须是 cap 推出来的，不是写死的。这一条是本轮改出来的：
       * 第一版把「华为天气接口只在壳里用」「国控站与预警来自 nmc.cn」写死在句子里，前者与
       * MEMORY 里的实测相反，后者对墨迹/自定义根本不成立 —— 挂错上游名字等于伪造出处。
       * 判据按 cap 独立推：没有逐小时的才许说「另取 Open-Meteo」，有逐小时的不许说。 */
      const up = txt('upstream');
      if (!c.hourly && up.indexOf('逐小时另取 Open-Meteo') < 0) bad.push(id + ' 不给逐小时，署名里却没写往哪补');
      if (c.hourly && up.indexOf('逐小时另取 Open-Meteo') >= 0) bad.push(id + ' 自己给得出逐小时，署名里还挂着别家');
      if (!c.air && up.indexOf('全国城市榜') < 0) bad.push(id + ' 不给空气质量，署名里却没写降级链');
      if (up.indexOf('只在壳里用') >= 0) bad.push(id + ' 的署名里又出现了那句写死的「只在壳里用」');
    }
    const t = disc('source') ? disc('source').querySelector('summary').textContent.trim() : '';
    if (t !== '数据源 · ' + providerLabel(id)) bad.push(id + ' 的标题是「' + t + '」');
    titles.push(t);
  }
  push('四家源逐个选中：能力那一行与标题都跟着注册表改口（声明不许挂着别家的话）',
    bad.length === 0 && titles.length === 4 && new Set(titles).size === 4,
    bad.length ? bad.join('；') : ids.map(i => providerLabel(i)).join(' / ') + '，四份标题互不相同');

  /* 上面那五条走的是默认映射（含 current），永远不会抛 —— try/catch 那条分支得单独压。
   * 直调 disclosures() 喂一份缺 current 的映射：它必须**不抛**（抛了就是把设置面板带崩，
   * 第一版就是这么炸的），并且照实说推不出来。 */
  const { disclosures } = await import('/weather-app/js/lib/disclosures.js');
  let broke = '';
  try {
    const l = disclosures('custom', 'auto', false, { map: { codes: 'wmo' } });
    const s = (l[0] || {}).lines || [];
    if (!s.some(t => /推不出来/.test(t))) broke = '没写「推不出来」：' + s.join(' / ').slice(0, 60);
    if (l.length !== 7) broke += '｜只有 ' + l.length + ' 条';
  } catch (e) { broke = '自己抛了：' + String((e && e.message) || e); }
  push('映射填得不全时：声明不崩，且承认「现在推不出来、所以不猜」', !broke, broke || '七条都在，能力那句换成承认拿不到');

  /* 口径那一栏：第二条要说清「当前是哪一套」。三个选项各切一次，三句都得出现过。 */
  const seen = [];
  for (const v of ['auto', 'us', 'cn']) {
    std.value = v; std.dispatchEvent(new Event('change'));
    await sleep(120);
    const lbl = (await import('/weather-app/js/lib/aqi.js')).AQI_STDS.filter(s => s.id === v)[0].label;
    if (txt('air').indexOf(lbl) >= 0) seen.push(v + '→' + lbl);
  }
  push('换空气质量口径，第二条声明跟着改口（三档都量到）', seen.length === 3, seen.join(' 、 ') || '一条都没跟上：' + txt('air').slice(0, 40));

  sel.value = prevProvider; sel.dispatchEvent(new Event('change'));
  std.value = prevStd; std.dispatchEvent(new Event('change'));
  await sleep(150);
  const all = [...document.querySelectorAll('#discList .disc')];
  /* 位置也是要求（2026-10-01 用户「软件声明放到最下面」）：这一组是「要查才查」的东西，不该压在
   * 换单位、换背景这些天天要碰的项前面。判据按 DOM 顺序问，不按像素问 —— 像素随面板高度与滚动变，
   * 「它后面不许再有别的分组」才是这条要求的本体。 */
  const groups = [...document.querySelectorAll('#settingsModal fieldset.group')];
  const discEl = document.getElementById('discGroup');
  push('这一组排在设置面板所有分组的最下面',
    groups[groups.length - 1] === discEl &&
      discEl.compareDocumentPosition(document.querySelector('.modal-actions')) === Node.DOCUMENT_POSITION_FOLLOWING,
    '面板里 ' + groups.length + ' 个分组，最后一组是「' +
    (groups[groups.length - 1] ? groups[groups.length - 1].querySelector('legend').textContent : '?') +
    '」，按钮在它之后=' + (discEl.compareDocumentPosition(document.querySelector('.modal-actions')) === 4));
  /* 原来这里硬卡「每条正文 ≥3 行」，第一次跑就红了：选中的是中国天气，它有预警也能后台自取，
   * 第一条本来就只剩两句（note + 能力行）—— 行数跟着这一家的能力变，卡死数字是把文案长度
   * 当成了不变量。这一条该防的是**渲染丢段**（innerHTML 拼错、某条没画出来），所以拿同一份输入
   * 直调 disclosures() 对一遍：顺序、id、每条行数都得逐个对上。 */
  const want = disclosures(prevProvider, prevStd, false, loadConfig().custom);
  const 对得上 = all.length === want.length && all.every((d, i) =>
    d.dataset.d === want[i].id && d.querySelectorAll('.disc-body p').length === want[i].lines.length);
  push('这一组默认全收起，且正文一段都不许在渲染时丢掉',
    all.length === 7 && all.every(d => !d.open) && 对得上 && want.every(w => w.lines.length >= 2),
    all.length + ' 条 · 展开的 ' + all.filter(d => d.open).length + ' 条 · 页面行数 ' +
    all.map(d => d.querySelectorAll('.disc-body p').length).join('/') +
    ' vs 模块给的 ' + want.map(w => w.lines.length).join('/') + '（id ' + want.map(w => w.id).join(' ') + '）');

  /* 弹窗没打开时上面那套逐主题 AA 扫描看不见这些节点（getClientRects 为空就跳过），
   * 所以这里把四条全展开、逐主题量**它们自己**的字色压在真实底色上。
   * 这是新配对进扫描盲区的老规矩（桌面图标缩略图那一组同一形状）。 */
  const kill = document.createElement('style');
  kill.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
  document.head.appendChild(kill);
  all.forEach(d => { d.open = true; });
  const nodes = [...document.querySelectorAll('#discList .disc summary, #discList .disc-body p')];
  let min = Infinity, at = '', measured = 0;
  const 起始 = document.body.dataset.theme;
  const 每套 = [];
  const ui3 = await import('/weather-app/js/ui.js');
  for (const t of themes) {
    ui3.applyTheme(t.id);
    /* applyTheme 末尾会调 applyBg() 把 data-weather 写回来，所以要在它之后清；
     * 而「清掉」这件事本身也是测量条件的一部分：--glass-* 现在是每套主题内联下发的，
     * 只改 dataset.theme（上一版就是这么写的）量到的是「A 套的字色 × B 套的透出度」。 */
    document.body.removeAttribute('data-weather');
    await rafIdle();
    const bgs = new Set(BG_VARS.map(v => key(token色(v) || [])));
    const inks = new Set(['--ink', '--muted', '--muted-base'].map(v => key(token色(v) || [])));
    let 这一套 = 0;
    for (const n of nodes) {
      const fgc = rgbaOf(getComputedStyle(n).color);
      if (!fgc || !inks.has(key(fgc.col))) continue;
      for (const b of bgInfo(n, bgs).cands) {
        const r = glass.ratio(fgc.col, b);
        measured++; 这一套++;
        if (r < min) { min = r; at = t.id + ' › ' + (n.className || n.tagName) + ' ' + n.textContent.trim().slice(0, 10) + ' on rgb(' + b + ')'; }
      }
    }
    每套.push(这一套);
  }
  ui3.applyTheme(起始);
  all.forEach(d => { d.open = false; });
  kill.remove();
  document.getElementById('closeSettings').click();
  await sleep(500);
  /* 每套 18 对 = 6 个带字节点 × 弹窗那一条底链（面板/遮罩/页面底），这个数掉了就说明节点筛空了：
   * 这一套扫描按「字色属不属于主题」筛节点，筛不出来的话 min 停在 Infinity，
   * 而 `Infinity >= 4.5` 恒真 —— 和上面那条同一形状的坑，所以闸落在**配对数**上而不是只比大小。 */
  push('软件声明展开后：字色压在弹窗真实底色上，' + themes.length + ' 套主题全过 AA(4.5)（且每套都量到了配对）',
    min >= glass.AA && 每套.length === themes.length && 每套.every(n => n >= 12),
    '量了 ' + measured + ' 对（每套 ' + 每套.join('/') + '），最低 ' + min.toFixed(2) + ' @' + at);
}

/* ---------- 2026-10-01 数据源体检的四条修复（#101 城市榜匹配 / #102 国标六项 / #103 逐小时档位 / #104 检索没答） ----------
 * 这四条各管一种「声明比实际宽」或「拿别处的数顶这里的数」。判据全部按**量出来的形状**写：
 * 繁体市名、路名段、报文里的 time 字段、URL 里请求了哪几项 —— 都是能对着真字节核的东西。 */
{
  const { matchCity } = await import('/weather-app/js/lib/hwAqi.js');
  const { toSimplified } = await import('/weather-app/js/lib/geo.js');
  const 榜 = [
    { city: '兰州市', prov: '甘肃', aqi: 62 }, { city: '张掖市', prov: '甘肃', aqi: 92 },
    { city: '酒泉市', prov: '甘肃', aqi: 40 }, { city: '北京市', prov: '北京', aqi: 12 },
    { city: '朝阳市', prov: '辽宁', aqi: 55 }, { city: '银川市', prov: '宁夏', aqi: 44 },
    { city: '济南市', prov: '山东', aqi: 88 }, { city: '三亚市', prov: '海南', aqi: 21 },
    { city: '嘉峪关市', prov: '甘肃', aqi: 51 }, { city: '齐齐哈尔市', prov: '黑龙江', aqi: 33 },
    { city: '吐鲁番市', prov: '新疆', aqi: 77 }, { city: '海西蒙古族藏族自治州', prov: '青海', aqi: 30 }
  ];
  const who = a => { const h = matchCity(榜, a); return h ? h.city : '（匹配不上，让链子降级到模型值）'; };
  /* 兰州那一晚的真实现场：徽章写着「张掖市 全市 · 全国第 349/360 位」给了 92，而兰州国控站是 62。
   * 本级市名当时是繁体「蘭州市」对不上榜，整串扫描就让路名里的「张掖」赢了。 */
  const 简体串 = who('兰州市 · 城关区 · 张掖路街道 · 酒泉路');
  const 繁体串 = who('蘭州市 · 城关区 · 张掖路街道');
  const 只有路 = who('张掖路街道 · 酒泉路');
  push('城市榜只在行政那几段里找市名：路名不许顶掉本级市，拿不准就不如没有',
    简体串 === '兰州市' && 繁体串.indexOf('张掖') < 0 && 只有路.indexOf('张掖') < 0,
    '「兰州市 · 城关区 · 张掖路街道 · 酒泉路」→' + 简体串 + '；繁体那串→' + 繁体串 + '；只剩路名→' + 只有路);
}

/* 繁体那一半：2026-10-01 逐个问过 BDC（24 个地级市），8 个市名回的是繁体。
 * 不归一的后果不是显示难看，是**榜匹配不上 → 空气质量掉到模型值**，所以这条测的是取数链。
 * 判法用真榜的形状（简体市名）+ 真地址串（繁体），问的是「归一之后挑不挑得着自己」。 */
{
  const { matchCity } = await import('/weather-app/js/lib/hwAqi.js');
  const { toSimplified } = await import('/weather-app/js/lib/geo.js');
  const 繁体 = [['蘭州市', '兰州市'], ['銀川市', '银川市'], ['濟南市', '济南市'], ['嘉峪關市', '嘉峪关市'],
    ['齊齊哈爾市', '齐齐哈尔市'], ['三亞市', '三亚市'], ['吐魯番市', '吐鲁番市'], ['克孜勒蘇柯爾克孜自治州', '克孜勒苏柯尔克孜自治州']];
  const 没转 = 繁体.filter(([t, s]) => toSimplified(t) !== s).map(([t, s]) => t + '→' + toSimplified(t) + '（应为 ' + s + '）');
  /* 榜里就放这七个真在华为榜上的市（克孜勒苏那个自治州榜内名字不同，只测归一不测匹配）。
   * 地址串带上路名段 —— 归一之后还要能在这一串里挑回本市，才算真的接上了取数链。 */
  const 榜 = 繁体.slice(0, 7).map(([, s]) => ({ city: s, prov: 'x', aqi: 50 }));
  const 挑不中 = 繁体.slice(0, 7).filter(([t, s]) => {
    const hit = matchCity(榜, toSimplified(t) + ' · 城关区 · 张掖路街道');
    return !hit || hit.city !== s;
  }).map(([t]) => t);
  push('量出来的 8 个繁体市名逐个归一，且归一之后城市榜能挑回本市（否则空气质量会白降到模型值）',
    没转.length === 0 && 挑不中.length === 0,
    (没转.length ? 没转.join('；') : '八个全转成简体') + '｜' +
    (挑不中.length ? 挑不中.join('、') + ' 归一后仍挑不到自己' : '归一后带榜的七个全部挑回本市'));
}

/* #102：界面吃的六项，请求里就必须真的问到。
 * 第一版 URL 只有 us_aqi,pm2_5,pm10,ozone，而 lib/aqi.js 的 cnAqi 读六项 —— 那三项永远是 undefined，
 * 被 `.filter(p => p[1] != null)` 静默丢掉，于是「国标」其实只由三项算出，README 却写着六项。 */
{
  const { openMeteo } = await import('/weather-app/js/providers/openMeteo.js');
  const { cnAqi } = await import('/weather-app/js/lib/aqi.js');
  const real = window.fetch;
  let asked = '';
  window.fetch = (u) => { asked = String(u); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ current: {} }) }); };
  let threw = '';
  try { await openMeteo.airQuality(36.06, 103.83); } catch (e) { threw = String(e && e.message || e); }
  finally { window.fetch = real; }
  const 要 = ['us_aqi', 'pm2_5', 'pm10', 'ozone', 'nitrogen_dioxide', 'sulphur_dioxide', 'carbon_monoxide'];
  const 缺 = 要.filter(k => asked.indexOf(k) < 0);
  push('空气质量那一问真的把六项浓度都要了（少一项，"国标"就悄悄变成三项算的）',
    !threw && asked.indexOf('https://air-quality-api.open-meteo.com') === 0 && 缺.length === 0,
    threw ? '抛错：' + threw : (缺.length ? 'URL 里缺 ' + 缺.join(',') : 'current= 里 ' + 要.length + ' 项全在'));
  /* 消费端也得核一遍：六项齐全时 NO₂ 能当上首要污染物，摘掉它就换人 —— 证明那一项不是摆设。 */
  const 全 = { pm2_5: 10, pm10: 20, ozone: 30, nitrogen_dioxide: 800, sulphur_dioxide: 20, carbon_monoxide: 500 };
  const 摘 = Object.assign({}, 全); delete 摘.nitrogen_dioxide;
  const a = cnAqi(全), b = cnAqi(摘);
  push('cnAqi 真在吃这六项：NO₂ 拉满时首要污染物是它，摘掉 NO₂ 首要就换人',
    !!a && a.首要 === 'NO₂' && !!b && b.首要 !== 'NO₂' && b.v < a.v,
    '六项 →' + (a || {}).首要 + ' ' + Math.round((a || {}).v) + '；摘掉 NO₂ →' + (b || {}).首要 + ' ' + Math.round((b || {}).v));
}

/* #103：wttr.in 的「逐小时」是每天 8 档、3 小时一档。栏目写「今天 00–23 时」、声明写「逐小时 给」
 * 都是把栏目写得比内容宽。这里对着**真报文**（tests/fixtures/wttr-j1.json，2026-10-01 抓的兰州 j1）量一遍间隔，
 * 再核注册表那句声明与界面那行标题是否都跟着改口。 */
{
  const { wttrIn } = await import('/weather-app/js/providers/wttrIn.js');
  const { todayHours } = await import('/weather-app/js/lib/hourly.js');
  const raw = JSON.parse(await (await fetch('/tests/fixtures/wttr-j1.json')).text());
  const data = wttrIn.normalize(raw);
  const res = await todayHours('wttr-in', null, null, data);
  const times = res ? res.hours.map(h => String(h.time).slice(11, 13)) : [];
  push('注册表声明的逐小时档位与真报文实算的一致（wttr 是 3 小时一档，不是 24 格）',
    !!res && res.step === 3 && Number(wttrIn.hourlyStep) === 3 && res.hours.length === 8,
    '报文 ' + times.length + ' 档 @' + times.join(',') + '；实算间隔 ' + (res || {}).step + '；注册表写 ' + wttrIn.hourlyStep);
  const ui = await import('/weather-app/js/ui.js');
  ui.loadToday('wttr-in', null, null, data, false);
  await sleep(400);
  const scope = document.getElementById('hourlyScope').textContent;
  push('格子只有 8 档时，窗口标题写明「每 3 小时一档」（24 格那一版仍写「今天 00–23 时」，见上面那条）',
    /每 3 小时一档/.test(scope) && !/今天 00–23 时$/.test(scope.trim()), '窗口=' + scope);
  ui.clearToday();
}

/* #104：两家公共检索实例会**整轮不答**（同一句「新兴县」连问 5 次，前两次两源都空、后三次正常）。
 * 那种情况报「未找到，可试试加上市/县后缀」是把上游没答说成用户词写得不对。 */
{
  const geoApi = await import('/weather-app/js/lib/geo.js');
  const real = window.fetch;
  const 都答但空 = () => {
    window.fetch = (u) => Promise.resolve({ ok: true, status: 200,
      json: () => Promise.resolve(String(u).indexOf('photon.') >= 0 ? { features: [] } : { results: [] }) });
  };
  let silentFlag = null, errSilent = '', errEmpty = '', t0 = Date.now(), 发了 = 0;
  const 全断 = () => { window.fetch = () => { 发了++; return Promise.reject(new Error('Failed to fetch')); }; };
  try {
    全断();
    const l = await geoApi.searchCities('整轮都不答甲', new AbortController().signal);
    silentFlag = l.length === 0 && l.silent === true;
    const 一轮 = 发了;                       // 甲那一轮问了几发：四个变体 + Photon，主源没命中时再补变体回问
    await geoApi.bestCity('整轮都不答乙').catch(e => { errSilent = String(e && e.message || e); });
    /* 重试那一发必须真的发出去 —— 光改文案不算修好：公共实例的「不答」是按轮次的，
     * 而 searchCities 会把同一个词共享 10 秒，第一版就是被这份共享挡住，重试拿回同一个空数组。
     * 判据是「乙这一趟花的发数 ≥ 两轮」（先问一轮、没答再问一轮）；第一版写成 `发了 - 一轮 < 一轮`，
     * 把乙自己的第一轮也算进了左边的账，于是不管有没有重试都恒不成立 —— 是 falsify 把这条抓出来的。 */
    if (发了 - 一轮 < 一轮 * 2) errSilent += '｜没有重新问，第二发都没发出去';
    都答但空();
    try { await geoApi.bestCity('查无此地丙'); } catch (e) { errEmpty = String(e && e.message || e); }
  } finally { window.fetch = real; }
  push('两源都没答时说「检索源这一轮没有回答」并重试一发，不再怪用户用词；真查无此名才保留原措辞',
    silentFlag === true && /检索源这一轮没有回答/.test(errSilent) && /加上市\/县后缀/.test(errSilent) === false &&
      /没有重新问/.test(errSilent) === false &&
      /未找到「查无此地丙」/.test(errEmpty) && /加上市\/县后缀/.test(errEmpty) && Date.now() - t0 < 12000,
    'silent 标记=' + silentFlag + '；没答时报的=' + (errSilent.slice(0, 46) || '(没报错)') +
    '；查无时报的=' + (errEmpty.slice(0, 26) || '(没报错)'));
}

/* ---------- 2026-10-01 省电这一轮（1 后台闸门 / 2 通知去重 / 5 两处白跑的网络） ---------- */
{
  /* ① 自动刷新那条计时器必须有「屏幕不在前台就什么都不做」的闸门。
   *    这一条只能按源码形状问：计时器回调没有对外把手，行为级断言要真等 30 秒、
   *    而这台跑批通道上「等 30 秒」测到的又是节流而不是代码（见 MEMORY 里回归通道那条）。
   *    所以判据钉在「setInterval 的回调头两行之内必须有 document.hidden」，
   *    并且和 locateTimer 那道已有的闸门成对出现 —— 少了任何一个都红。
   *    2026-10-06 分区之后这两个函数分家了（js/refresh.js 与 js/locate.js），各读各的文件；
   *    以前那种「从 main.js 里按函数名切一段」的写法跟着一起没了 —— 切不到就返回空串，
   *    空串永远匹配不上，所以这条不会因为换文件而静默变绿，只会红。 */
  const refresh = await (await fetch('/weather-app/js/refresh.js')).text();
  const locate = await (await fetch('/weather-app/js/locate.js')).text();
  /* 要钉的是**那句判断**，不是「document.hidden 这几个字」—— 第一版写成裸的 `document\.hidden`，
   * 结果我自己写在回调里的那句解释（"上面 locateTimer 那道 document.hidden 闸门…"）就把断言喂绿了，
   * 把闸门整行删掉照样不红。是 falsify 抓出来的。 */
  const 有闸门 = t => /setInterval\(\(\)\s*=>\s*\{[\s\S]{0,600}?if \(document\.hidden/.test(t);
  /* v152 起自动刷新的计时器直接挂 refreshTick（不再写内联箭头函数），闸门在函数体第一句。 */
  const 刷新有闸门 = t => /function refreshTick\s*\(\)\s*\{[\s\S]{0,800}?if \(document\.hidden\)/.test(t) &&
    /setInterval\(refreshTick,/.test(t);
  push('后台不跑无谓的活：自动刷新与自动定位两条计时器都必须先问 document.hidden',
    刷新有闸门(refresh) && 有闸门(locate),
    '自动刷新那一拍有闸门=' + 刷新有闸门(refresh) + '，自动定位=' + 有闸门(locate) +
    '（常驻前台服务会把进程钉住，没闸门就是后台每 30/60/300 秒整屏重绘 + 写盘 + 敲原生桥）');

  /* ② 常驻通知满一小时重建之前，要先比一下正文有没有真的变。
   *    Java 侧的东西在浏览器里没有可观察面，所以这里同样按形状钉：runTick 里 notify 之前
   *    必须出现「与 KEY_LIVE_TEXT 比」那一步，并且比较不成立时要把门限推走
   *    （不推的话每 10 分钟那一拍都会回来重比一次，白干活）。 */
  const java = await (await fetch('/android/app/src/main/java/com/weatherstudio/app/WeatherKeepAliveService.java')).text();
  const tick = java.slice(java.indexOf('static void runTick'), java.indexOf('/* ---------------- 取报文'));
  const 比过 = /getString\(KEY_LIVE_TEXT/.test(tick) && /getString\(KEY_LIVE_TITLE/.test(tick);
  const 先比后发 = tick.indexOf('KEY_LIVE_TEXT') < tick.indexOf('notify(ctx, liveNotification');
  const 推门限 = /putLong\(KEY_LAST_LIVE/.test(tick.slice(0, tick.indexOf('notify(ctx, liveNotification')));
  push('通知正文没变就不许重发：runTick 里必须比过上一次的字，并且跳过时把一小时门限推走',
    比过 && 先比后发 && 推门限,
    '比过标题与正文=' + 比过 + '，比较在 notify 之前=' + 先比后发 + '，跳过时推门限=' + 推门限);

  /* ③ 两处网络：Open-Meteo 空气质量按坐标缓存 30 分钟 + 并发合并；城市榜 TTL 从 10 分钟提到 30 分钟。
   *    这两条都是行为级的 —— 数请求发了几发，不看源码。 */
  const { openMeteo } = await import('/weather-app/js/providers/openMeteo.js');
  const real = window.fetch;
  let 发了 = 0;
  window.fetch = () => { 发了++; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ current: { us_aqi: 42 } }) }); };
  /* 坐标用一座应用永远不会查的点：缓存按坐标分键，蹭到真城市那个键上就会量出「0 发」，
   * 那条绿测的是"前面有人问过了"，不是"缓存生效"。 */
  const LA = 12.3456, LO = 98.7654;
  let 三次几发 = -1, 补问几发 = -1, 换坐标几发 = -1, 值 = null;
  try {
    发了 = 0;
    await Promise.all([openMeteo.airQuality(LA, LO), openMeteo.airQuality(LA, LO), openMeteo.airQuality(LA, LO)]);
    三次几发 = 发了;
    发了 = 0;
    值 = (await openMeteo.airQuality(LA, LO)).current.us_aqi;   // 这一发量的是「缓存真的接住了」
    补问几发 = 发了;
    发了 = 0;
    await openMeteo.airQuality(34.7580, 113.6650);
    换坐标几发 = 发了;
  } finally { window.fetch = real; }
  push('空气质量那一问按坐标缓存 30 分钟并合并并发（三发并发只出一发、同坐标补问 0 发、换城市才重新问）',
    三次几发 === 1 && 补问几发 === 0 && 换坐标几发 === 1 && 值 === 42,
    '并发三发出网 ' + 三次几发 + ' 发；已缓存后再问出网 ' + 补问几发 + ' 发（要 0）；换城市 ' + 换坐标几发 + ' 发');

  const 榜 = [{ city: '云浮市', prov: '广东', aqi: 30, order: 10, total: 360 }];
  const LS = 'weather-hw-rank';
  /* 每次都用**全新的模块实例**：`fetchRank` 还有一层进程内的 `mem`，前面那些断言早就把真榜取回来过，
   * 直接 import 同一个实例的话量到的是那份内存，跟 TTL 无关（症状是"31 分钟也没出网"，假绿的反面 —— 假红）。 */
  const 测TTL = async (mins) => {
    localStorage.setItem(LS, JSON.stringify({ at: Date.now() - mins * 60000, list: 榜 }));
    const f = window.fetch;
    let n = 0;
    window.fetch = () => { n++; return Promise.reject(new Error('这一发本不该出去')); };
    try {
      const mod = await import('/weather-app/js/lib/hwAqi.js?ttl=' + mins + '&v=' + Date.now());
      const l = await mod.rankList();
      return { n, 条: l.length };
    } finally { window.fetch = f; localStorage.removeItem(LS); }
  };
  const 十一分 = await 测TTL(11), 三一分 = await 测TTL(31);
  push('城市榜（一发 43KB）的 TTL 是 30 分钟：11 分钟前那份还能用，31 分钟前才重新拉',
    十一分.n === 0 && 十一分.条 === 1 && 三一分.n === 1,
    '11 分钟：出网 ' + 十一分.n + ' 发（读到 ' + 十一分.条 + ' 条）；31 分钟：出网 ' + 三一分.n + ' 发');
}

/* ---------- 设置抽屉的滚动结构（2026-10-01，用户「标题一直钉在最上方，滑到顶/到底还会带着天气页一起滚」） ----------
 * 两条各拦一种形状：① 卡片里只能有一个滚动容器，标题与按钮条是 flex 的两端、不再 sticky 刷异色带；
 * ② 背景滚动锁归 lib/sheet.js 统一管（以前只有 rank.js 自己摸 dataset，设置弹窗压根没上锁）。 */
{
  const card = document.querySelector('#settingsModal .modal-card');
  const body = document.getElementById('modalBody');
  const cs = n => getComputedStyle(n);
  const 透明 = n => /rgba\(0, 0, 0, 0\)|transparent/.test(cs(n).backgroundColor);
  const 头 = document.querySelector('#settingsModal .modal-head');
  const 尾 = document.querySelector('#settingsModal .modal-actions');
  document.getElementById('openSettings').click();
  await sleep(600);
  /* 判"卡片自己不再滚"要看 computed overflow，不能看 scrollHeight>clientHeight ——
   * 后者在视口塌成 0 高的通道里恒真（应用内浏览器/锁屏就是这个样子），会把断言变成随机红。 */
  const 卡片不滚 = !/auto|scroll/.test(cs(card).overflowY);
  push('设置里只有一个滚动容器：.modal-body 会滚且拦住链式滚动，卡片本身不滚、标题与按钮条不再 sticky',
    !!body && cs(body).overflowY === 'auto' && /contain/.test(cs(body).overscrollBehaviorY || cs(body).overscrollBehavior) &&
      卡片不滚 && cs(头).position !== 'sticky' && cs(尾).position !== 'sticky' && 透明(头) && 透明(尾),
    'body overflowY=' + (body ? cs(body).overflowY : '没有 #modalBody') +
    '，overscroll=' + (body ? (cs(body).overscrollBehaviorY || cs(body).overscrollBehavior) : '-') +
    '，卡片 overflowY=' + cs(card).overflowY + '，标题 ' + cs(头).position + '/' + cs(头).backgroundColor +
    '，按钮条 ' + cs(尾).position + '/' + cs(尾).backgroundColor);

  /* 锁的判据：根元素与 body 都挂上标记，且**根元素的 computed overflow 是 hidden**
   * —— 只有根上那条会传播给视口，body 那条单独用不成立（body 没有固定高度，盒子跟内容一样高）。
   * 这里原本还想"真的去推一把 scrollTop 看它动不动"，那是个错的探针：
   * `overflow:hidden` 的盒子**仍然可以被脚本滚**（它照旧是滚动容器，只是用户滚不动），
   * 所以推得动推不动量不到这条锁。用户侧滚不动由 overscroll-behavior:contain 那一刀保证（见上一条）。 */
  const 分项 = {
    body: !!document.body.dataset.sheet,
    html: !!document.documentElement.dataset.sheet,
    根溢出: cs(document.documentElement).overflow
  };
  const 锁着 = 分项.body && 分项.html && 分项.根溢出 === 'hidden';
  document.getElementById('closeSettings').click();
  await sleep(500);
  const 放开了 = !document.body.dataset.sheet && !document.documentElement.dataset.sheet;
  push('打开设置就把背景锁住、关掉就放开（锁由 sheet.js 统一上，设置弹窗以前根本没上）',
    锁着 && 放开了,
    '开着时：body[data-sheet]=' + (分项.body ? 'open' : '(无)') + ' html[data-sheet]=' + (分项.html ? 'open' : '(无)') +
    ' html 的 overflow=' + 分项.根溢出 + '；关掉后两处标记都清了=' + 放开了);

  /* 保存那条出口也必须走同一个把手：`saveSettings()` 原来是直接 `el.modal.hidden = true`，
   * 那样面板收掉了却把这一层留在"在场"里，锁再也解不开（本轮把锁收进 sheet.js 之后红出来的）。 */
  document.getElementById('openSettings').click();
  await sleep(500);
  document.getElementById('saveBtn').click();
  await sleep(700);
  push('点「保存并应用」关面板走的是同一个出口：面板收掉、动画退场、锁一起解',
    modal2Hidden() && !document.body.dataset.sheet && !document.documentElement.dataset.sheet,
    '保存后 hidden=' + modal2Hidden() + '，body 锁=' + (document.body.dataset.sheet || '(无)') +
    '，html 锁=' + (document.documentElement.dataset.sheet || '(无)'));
  function modal2Hidden() { return document.getElementById('settingsModal').hidden; }

  /* 退场在途时重开：那一趟要作废，锁必须留着 —— 这条管的是「面板回来了但背景已经解锁」这种半开状态 */
  document.getElementById('openSettings').click();
  await sleep(400);
  document.getElementById('closeSettings').click();
  await sleep(60);
  document.getElementById('openSettings').click();
  await sleep(700);
  const 重开后 = { 在场: !document.getElementById('settingsModal').hidden, 锁: !!document.body.dataset.sheet };
  document.getElementById('closeSettings').click();
  await sleep(500);
  push('退场动画在途时重新打开：面板留在场、背景锁也留着，关掉之后才解',
    重开后.在场 && 重开后.锁 && !document.body.dataset.sheet,
    '重开后面板在场=' + 重开后.在场 + ' 锁还在=' + 重开后.锁 + '，最终关闭后锁=' + (document.body.dataset.sheet ? '还挂着' : '已解'));

  /* 重开该从头看起：v100 之后整张卡片不再自己滚，只有 .modal-body 滚，而面板 DOM 一直活着 ——
   * 谁都没归零过它，于是滚到底关掉再开，直接落在最下面那组（2026-10-02 红米装机看到的：
   * 重开之后屏上是「软件声明」，标题下面第一行却是通知栏天气的说明中段）。
   * 这一条要求滚动区真的能滚（能量 > 0）：量不到溢出就等于没测，宁可红也不要假绿。 */
  document.getElementById('openSettings').click();
  await sleep(500);
  const 滚区 = document.getElementById('modalBody');
  const 能量 = 滚区.scrollHeight - 滚区.clientHeight;
  滚区.scrollTop = 99999;                       // 滚到底（脚本滚得动 ≠ 用户滚得动，这里要的就是它真能落位）
  await sleep(150);
  const 到底 = 滚区.scrollTop;
  document.getElementById('closeSettings').click();
  await sleep(600);
  document.getElementById('openSettings').click();
  await sleep(600);
  const 重开位置 = document.getElementById('modalBody').scrollTop;
  document.getElementById('closeSettings').click();
  await sleep(500);
  push('设置滚到底、关掉再重开：面板回到从头看起，不是停在上次的位置',
    能量 > 0 && 到底 > 0 && 重开位置 === 0,
    '可滚高度=' + Math.round(能量) + '，滚到底 scrollTop=' + Math.round(到底) + '，重开之后 scrollTop=' + Math.round(重开位置));

  /* 排名浮层走的是同一个把手：它不再自己摸 dataset，锁的有无只能由 openSheet/closeSheet 决定 */
  const rank = await import('/weather-app/js/ui/rank.js');
  rank.open('云浮市');
  await sleep(400);
  const 排名锁上 = !!document.body.dataset.sheet;
  rank.close();
  await sleep(500);
  push('排名浮层与设置共用同一把锁（rank.js 不再自己写 body.dataset）',
    排名锁上 && !document.body.dataset.sheet,
    '打开排名时锁上=' + 排名锁上 + '，关掉后=' + (document.body.dataset.sheet ? '还挂着（解不掉）' : '已解'));

  /* 重开也要从头看起（v106；华为实测滚到 4000、关掉再点开还是 4000）。
   * 这里**不能让榜单从网络回来**：真取一次的话 .then 落在后面那一帧，中间那一帧内容是
   * 「正在加载…」那一行，scrollTop 被浏览器自己夹回 0，改没改都绿 —— 所以先喂一份新鲜缓存
   * （TTL 30 分钟内），让 rank.open 走同步命中、同一帧把整榜填回去，那才是量得到的形状。 */
  const 榜视图 = document.getElementById('rankScroll');
  localStorage.setItem('weather-hw-rank', JSON.stringify({ at: Date.now(),
    list: Array.from({ length: 200 }, (_, i) => ({ city: '城' + (i + 1), prov: '省', aqi: 200 - i, order: i + 1, total: 200 })) }));
  rank.open('城7');
  await sleep(500);
  const 榜行数 = document.querySelectorAll('#rankList .rank-row').length;
  const 榜可滚 = 榜视图.scrollHeight - 榜视图.clientHeight;
  榜视图.scrollTop = 3000;
  await sleep(150);
  const 榜深处 = 榜视图.scrollTop;
  rank.close();
  await sleep(600);
  rank.open('城7');
  await sleep(600);
  const 榜重开 = 榜视图.scrollTop;
  rank.close();
  await sleep(500);
  localStorage.removeItem('weather-hw-rank');
  push('空气质量榜重开也回到顶部，不是停在上次翻到的那一行',
    榜行数 > 50 && 榜可滚 > 1500 && 榜深处 > 1000 && 榜重开 === 0,
    '行数 ' + 榜行数 + '，可滚 ' + Math.round(榜可滚) + '，滚到 ' + Math.round(榜深处) + '，重开之后 ' + Math.round(榜重开) +
    (榜行数 > 50 && 榜深处 > 1000 ? '' : '（榜没铺满 / 滚不动 ⇒ 这一跑量不到，别当绿）'));

  /* 三段式（v107）：榜滚到深处，标题那一行与返回钮必须还在原处。
   * 起因是 2026-10-02 在华为上实测到的：滚到第 68 名那一屏，屏上没有任何出口，
   * 只能滚回顶部或按系统返回 —— 因为 .sheet 自己就是滚动容器，头部躺在里面跟着走。
   * 判据走行为级：真的把滚动区推 6000 像素，回头看头部动没动（比读 CSS 可靠 ——
   * 「#rankView 的 overflow 不是 auto」那种写法在默认值 visible 下也成立，是摆设）。 */
  rank.open('云浮市');
  await sleep(600);
  const 头部 = document.querySelector('#rankView .sheet-head');
  const 出口 = document.getElementById('rankBack');
  const 头顶 = Math.round(头部.getBoundingClientRect().top);
  const 头高 = Math.round(头部.getBoundingClientRect().height);
  document.getElementById('rankScroll').scrollTop = 6000;
  await sleep(250);
  const 滚后 = { 头: Math.round(头部.getBoundingClientRect().top), 钮: Math.round(出口.getBoundingClientRect().top),
    滚了: Math.round(document.getElementById('rankScroll').scrollTop),
    只有一层: getComputedStyle(document.getElementById('rankScroll')).overflowY === 'auto',
    // 滚动区自己的盒子必须在视口内：漏了 min-height:0 那一刀时它会撑到两万像素高，
    // scrollTop 照样设得动、头部照样不动，但用户根本滑不到榜的底下。
    装得下: document.getElementById('rankScroll').clientHeight <= innerHeight };
  rank.close();
  await sleep(500);
  push('榜滚到第 68 名那一屏，标题与返回钮还在原处：整个浮层只有 .sheet-body 会滚',
    头高 > 0 && 滚后.头 === 头顶 && 滚后.钮 >= 0 && 滚后.滚了 > 3000 && 滚后.只有一层 && 滚后.装得下,
    '头部 top ' + 头顶 + ' → 滚后 ' + 滚后.头 + '（高 ' + 头高 + '），返回钮滚后 top=' + 滚后.钮 +
    '，滚动区 scrollTop=' + 滚后.滚了 + '，overflowY=auto=' + 滚后.只有一层 + '，装得下=' + 滚后.装得下);

  /* 页头那一行不许写死（v108）：榜只有国标口径，而「空气质量口径」那一档可以选美标 ——
   * markup 里钉一句「口径为国标」，选了美标之后就会让人以为整应用在说国标。
   * 两半各拦一种改坏：把句子塞回 markup / open() 忘了现推那一行。 */
  const 榜模块 = await import('/weather-app/js/ui/rank.js?note=' + Date.now());
  const 页头 = document.getElementById('rankNote');
  const 原始 = await (await fetch('/weather-app/index.html')).text();
  const 写死在markup = /class="sheet-note"[^>]*>[^<]*国标/.test(原始);
  rank.open('云浮市');
  await sleep(500);
  const 屏上 = 页头.textContent.trim();
  rank.close();
  await sleep(400);
  const 该是 = 榜模块.noteText('auto');
  push('榜页头那一行是现推的：markup 里没写死，屏上那句等于按当前口径推出来的那句',
    !写死在markup && 屏上.includes('国标') && 屏上 === 该是,
    'markup 里写死=' + 写死在markup + '；屏上「' + 屏上 + '」；该是「' + 该是 + '」');
  const 美标句 = 榜模块.noteText('us'), 国标句 = 榜模块.noteText('cn');
  push('口径选到美标时那句要改口（说清这榜换不过去），选国标/跟随时不许提美标',
    美标句.includes('美标') && 美标句.includes('国标') && !国标句.includes('美标') && !该是.includes('美标'),
    '美标那句「' + 美标句 + '」；国标那句「' + 国标句 + '」');
}

/* ---------- ☀/ 快捷按钮的往返（2026-10-04 用户「暗夜模式的主题切换存在问题」）
 * 实测到的原始现场：theme=paper 连点两下 → dark → **light**，用户挑的「宣纸」被快捷按钮
 * 偷偷换掉了。2026-09-21 那次只修了深色方向（切去深色时记住用户挑的那套），浅色方向仍写死。
 * 逻辑已抽成 lib/themes.js 的纯函数，所以这里既喂参数遍历每一套，也真点一次按钮验接线。
 * 2026-10-06 清单收到两套（一深一浅）之后，原来那条「两边都挑过（深海/暖阳）各回各套」删了：
 * 一边只剩一套时，「记住用户挑的那套」和「落到列表默认」是同一个值，那条断言再也逼不红，
 * 留着就是一张假条。记账那一半仍然有牙 —— 把 next.lightTheme = cur.id 写成 null，
 * 上面这条的「浅色记账错」立刻红，所以 toggleTheme 里那两行不是没人管的死码。 */
{
  const th = await import('/weather-app/js/lib/themes.js');
  const baseOf = id => th.themeById(id).base;
  const 坏例 = [];
  for (const t of th.THEMES) {
    let c = { theme: t.id, darkTheme: null, lightTheme: null };
    c = Object.assign({}, c, th.toggleTheme(c));
    if (baseOf(c.theme) === t.base) 坏例.push(t.id + ' 第一下没换边（→' + c.theme + '）');
    if (c.darkTheme !== (t.base === 'dark' ? t.id : null)) 坏例.push(t.id + ' 深色记账错（=' + c.darkTheme + '）');
    if (c.lightTheme !== (t.base === 'light' ? t.id : null)) 坏例.push(t.id + ' 浅色记账错（=' + c.lightTheme + '）');
    const 回来 = Object.assign({}, c, th.toggleTheme(c));
    if (回来.theme !== t.id) 坏例.push(t.id + '→' + c.theme + '→' + 回来.theme);
  }
  push(th.THEMES.length + ' 套主题各自连点两下都回到原来那套，且第一下确实换了明暗边',
    坏例.length === 0, 坏例.length ? 坏例.join('；') : th.THEMES.length + '/' + th.THEMES.length + ' 往返闭合');

  // 真点按钮那一枪：验的是接线（处理器 → saveConfig → applyTheme），不是纯函数自己
  const 钮 = document.querySelector('#darkBtn');
  const 形 = () => { const s = 钮.querySelector('svg'); return s ? s.getAttribute('viewBox') : ''; };
  const 起始 = { theme: document.body.dataset.theme, vb: 形() };
  钮.click();
  const 中转 = { theme: document.body.dataset.theme, vb: 形() };
  钮.click();
  const 终了 = { theme: document.body.dataset.theme, vb: 形() };
  push('屏上真点两下：主题回到起始那套，且两态用的不是同一枚图形（19px 下要看得出是开关）',
    终了.theme === 起始.theme && 中转.theme !== 起始.theme &&
      起始.vb !== 中转.vb && 终了.vb === 起始.vb && !!起始.vb,
    起始.theme + '(' + 起始.vb + ') → ' + 中转.theme + '(' + 中转.vb + ') → ' + 终了.theme + '(' + 终了.vb + ')');
}

/* ---------- 收藏这一格：三处写点必须共用同一对重画（2026-10-07 收进 js/favorite.js 时补）
 * 以前星那颗钮、收藏栏上那枚 ✕、设置里「恢复默认」各写一遍「落盘 + renderFav + setStar」，
 * 而这三处**一条断言都没盯**。少跟一处的表现是「栏里还挂着那枚标签、星已经灭了」，
 * 而且下一发查询重画之后就看不出来了 —— 所以这里既问账（localStorage），也问屏（那一排 + 那颗星）。 */
{
  const fav = await import('/weather-app/js/favorite.js');
  const cfgm = await import('/weather-app/js/lib/config.js');
  const q = await import('/weather-app/js/query.js');
  const 键 = q.currentKey();
  const 原样 = (cfgm.loadConfig().favorites || []).slice();
  const 栏 = () => document.querySelectorAll('#favBar .chip').length;
  const 星 = () => document.getElementById('starBtn').classList.contains('on');
  const 账 = () => (cfgm.loadConfig().favorites || []);
  const 坏 = [];
  if (!键) 坏.push('当前没有查询目标，这一条量不到东西');
  else {
    // 起点归零：从「这一座没收藏」开始，免得用户已有的收藏把计数读成噪声
    if (账().indexOf(键) >= 0) { fav.remove(键); }
    const 起栏 = 栏(), 起星 = 星();
    document.getElementById('starBtn').click();
    if (账().indexOf(键) < 0) 坏.push('点星之后账里没有它（没落盘）');
    if (栏() !== 起栏 + 1) 坏.push('落盘了但栏没多一枚：' + 起栏 + '→' + 栏());
    if (!星()) 坏.push('栏里有了、星没亮');
    // 按 dataset 找那一枚，不拿键去拼选择器：收藏键长这样「名称@纬度,经度」，
    // 名字里出现引号或反斜杠就会把选择器打断（打断之后是找不到，不是报错，最容易蒙过去）
    const 枚 = Array.prototype.find.call(document.querySelectorAll('#favBar .chip'), n => n.dataset.key === 键);
    const 叉 = 枚 && 枚.querySelector('.x');
    if (!叉) 坏.push('找不到那一枚 ✕（data-key 没跟着收藏键走）');
    else {
      叉.click();
      if (账().indexOf(键) >= 0) 坏.push('点 ✕ 之后账里还留着它');
      if (栏() !== 起栏) 坏.push('删掉了但栏没少：' + 栏() + ' ≠ ' + 起栏);
      if (星() !== 起星) 坏.push('栏回到原样、星却换了态（两处不是同一对重画）');
    }
  }
  // 还原：后面的判据默认「屏上已经有数据」，别把用户的收藏本改脏
  const c = cfgm.loadConfig(); c.favorites = 原样; cfgm.saveConfig(c); fav.repaintFav();
  push('收藏的加与删都同时改到「账 / 那一排 / 那颗星」三处（js/favorite.js 是这一对重画的唯一出口）',
    坏.length === 0, 坏.length ? 坏.join('；') : '加一枚 → 账·栏·星三处齐变，点 ✕ → 三处齐回原样');
}

/* ---------- 查不到时首页要说得清，而且自己再试两轮（#109，2026-10-02）
 * 华为上实测的原始现场：断网冷启动三发请求全成 net::ERR_NAME_NOT_RESOLVED，首页停在
 * index.html 那套「--°」占位上（#result 一直 hidden），状态行被钉住的「已先用网络定位顶着」
 * 占着、连唯一的重试入口都看不见；之后网络恢复，静置 45 秒 + 退后台再回前台，页面一动不动。
 * 下面按这四条各堵一道：三态都有落点、报错不被顶掉、失败自动补两轮、后台不白跑。 */
{
  const q = await import('/weather-app/js/query.js');
  const ui = await import('/weather-app/js/ui.js');
  const 结果区 = document.getElementById('result');
  const 骨架区 = document.getElementById('loading');
  const 空态 = document.getElementById('emptyState');
  const 空态字 = document.getElementById('emptyMsg');
  const 空态钮 = document.getElementById('emptyRetry');
  const 状态行 = document.getElementById('status');
  const 标题 = () => document.getElementById('locName').textContent;
  const 温度 = () => document.getElementById('curTemp').textContent;
  const 在屏上 = n => !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length);
  const 首页有几块 = () => [在屏上(骨架区), 在屏上(结果区), 在屏上(空态)].filter(Boolean).length;

  /* 「这一屏从来没查到过东西」那一态在活页面上够不着：hasData 一旦为真就回不去，
   * 而这块屏在首屏就渲染成功过。以前这里换的是一个 `ui.js?v101` 的模块实例 —— 视图层拆成
   * 多个文件之后那招会**静默失效**（带 query 只重建那一个模块，它 import 的邻居仍是旧实例，
   * 于是拿到的还是 hasData=true）。改成走 home.js 明给的复位口：跑的仍是同一段真代码，
   * 只是它眼里屏上还没有数据。 */
  const 收回 = ui.resetHome();
  ui.renderError('网络不通（测试造的）', () => {});
  const 空态样 = {
    块数: 首页有几块(), 是空态: 在屏上(空态), 有钮: 在屏上(空态钮),
    文字: 空态字.textContent, 状态行空着: 状态行.hidden
  };
  push('什么都没查到时首页落在空状态卡上：有原因、有重试，不再是整页留白',
    空态样.块数 === 1 && 空态样.是空态 && 空态样.有钮 &&
      /没取到天气/.test(空态样.文字) && /测试造的/.test(空态样.文字) && 空态样.状态行空着,
    '屏上可见的首页块数=' + 空态样.块数 + '，空状态卡=' + 空态样.是空态 +
    '，文字=' + 空态样.文字.slice(0, 24) + '，重试钮=' + 空态样.有钮 +
    '，状态行让出来了=' + 空态样.状态行空着);

  /* 「数据源：—」这种没内容的标签在空状态下面只会误导（读起来像"这家的数据就是空的"）。 */
  push('空状态那一态下「数据源」那一行跟着收起',
    !在屏上(document.getElementById('providerTag')),
    'providerTag 在屏上=' + 在屏上(document.getElementById('providerTag')));

  /* 这张卡是新铺的一块底（--ok-bg 压在页面背景上）配一种字色（--ok-ink），按规矩得逐主题量 AA。
   * 全场那条主题扫描够不到它 —— 扫描跑的时候这张卡是 hidden 的，所以这里单独掀开量一遍。 */
  {
    const 原主题 = document.body.dataset.theme;
    const 杀动画 = document.createElement('style');
    杀动画.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
    document.head.appendChild(杀动画);
    空态字.textContent = '没取到天气：这一张卡的底色与字色都要过 AA';
    空态.hidden = false;
    let 最低 = Infinity, 在哪 = '', 对数 = 0;
    for (const t of themes) {
      document.body.dataset.theme = t.id;
      const cs = getComputedStyle(document.body);
      const bgs = new Set(BG_VARS.map(v => key(token色(v) || [])));
      for (const n of [空态字, 空态钮]) {
        const fgc = rgbaOf(getComputedStyle(n).color);
        if (!fgc) continue;
        for (const b of bgInfo(n, bgs).cands) {
          const r = glass.ratio(fgc.col, b);
          对数++;
          if (r < 最低) { 最低 = r; 在哪 = t.id + ' › #' + n.id + ' ' + getComputedStyle(n).color + ' on rgb(' + b + ')'; }
        }
      }
    }
    杀动画.remove();
    document.body.dataset.theme = 原主题;
    空态.hidden = true;
    push('空状态卡那一对配色在全部 ' + themes.length + ' 套主题上都过 AA(4.5)',
      最低 >= glass.AA && 对数 >= themes.length * 2,
      '量了 ' + 对数 + ' 对，最低 ' + 最低.toFixed(2) + ' @' + 在哪);
  }
  /* 复位只服务上面那两条。下面那组「换城市查砸了 / 失败自动补一轮」的前提是屏上已经有数据，
   * 不把 home/hasData 还回去，它们量到的就是我留下的那个空屏（三条一起假红）。 */
  收回();

  // 只拦中国天气那一路，其余照常放行；计数只看它，量的是「补了几发」。
  const 原fetch = window.fetch;
  let 拦全部 = false, 拦几发 = 0, 慢回 = false, 天气发数 = 0;
  window.fetch = (u, o) => {
    if (/www\.nmc\.cn/.test(String(u))) {
      天气发数++;
      if (拦全部 || 拦几发-- > 0) return Promise.reject(new Error('测试：掐掉中国天气这一发'));
      // 成功那一批发故意慢 1.6 秒回：重试期间「屏上是什么」才有够长的窗口量（真网络几百毫秒起）
      if (慢回) return new Promise(res => setTimeout(() => res(原fetch.call(window, u, o)), 1600));
    }
    return 原fetch.call(window, u, o);
  };

  /* 屏上已经有旧数字时，失败不该把整页撤空（v95 那条管的是「换城市不留上一座城的逐小时格子」，
   * 这一条管的是「换城市那一发查砸了也别撤走当前卡」）。必须换一个**没查过的**坐标：
   * 同一目标会被 providers/chinaWeather.js 的那份缓存接住，压根不出网，也就掐不掉。 */
  拦几发 = 1;
  q.query({ lat: 22.5431, lon: 114.0579, name: '深圳', label: '深圳（失败留旧）' });
  await sleep(1400);
  const 原地失败 = {
    结果还在: 在屏上(结果区), 空态: 在屏上(空态), 温度: 温度(), 标题: 标题(),
    报错: 状态行.hidden ? '' : 状态行.textContent, 有重试: !!document.getElementById('statusRetry')
  };
  push('屏上有数据时换城市查砸了：整页不撤空，报错带重试进状态行',
    原地失败.结果还在 && !原地失败.空态 && /\d/.test(原地失败.温度) &&
      /查询失败/.test(原地失败.报错) && 原地失败.有重试 && !/深圳/.test(原地失败.标题),
    '结果区在屏上=' + 原地失败.结果还在 + '，空状态卡=' + 原地失败.空态 +
    '，温度=' + 原地失败.温度 + '，标题=' + 原地失败.标题.slice(0, 16) +
    '，状态行=' + 原地失败.报错.slice(0, 30));

  /* 状态行只有一格，报错与钉住的提示抢它 —— #109 里就是钉住行把「查询失败 + 重试」整条顶掉的。
   * 现在的规矩是报错优先、钉住的等它让位；等下一次查询开头 hideStatus 清掉报错，钉住的再回来。 */
  ui.pinStatus('测试：钉住一条', { label: '去开启定位服务', onClick: () => {} });
  const 抢过后 = { 文字: 状态行.textContent, 钮还在: !!document.getElementById('statusRetry') };
  ui.hideStatus();
  const 让位后 = 状态行.textContent;
  /* 再钉第二条：报错已经让过位了，这条该立刻上屏。这一问盯的是 hideStatus 有没有真把那条报错
   * 记下来当「已过时」——没清的话 pinStatus 还以为屏幕上挂着错误，第二条永远排在队外
   * （第一条能被 hideStatus 救回来，光看那一处是量不出来的）。 */
  ui.pinStatus('测试：钉住第二条', { label: '去开启定位服务', onClick: () => {} });
  const 第二条 = 状态行.textContent;
  ui.unpinStatus();
  push('钉住的提示不许盖掉正在显示的报错；报错清掉后它自己回来、后续也能换得动',
    /查询失败/.test(抢过后.文字) && 抢过后.钮还在 && /钉住一条/.test(让位后) && /钉住第二条/.test(第二条),
    '钉住之后屏上=' + 抢过后.文字.slice(0, 24) + '（重试钮=' + 抢过后.钮还在 + '），报错清掉后=' +
    让位后.slice(0, 20) + '，再钉第二条=' + 第二条.slice(0, 20));

  /* 另外两笔账，都是「这一行到底归谁」的：
   * ① 解过钉之后必须真的空着 —— 旧记录没清干净的话，下一次 hideStatus 会把那条顶回来（每次查询
   *    开头都调 hideStatus，于是屏幕上永远挂着一条用户已经关掉的提示）。
   * ② 屏幕空着时新钉上的那条要**立刻**上屏 —— 这一刻 errLine 还挂着上一条报错，放行靠的是
   *    pinStatus 里 `el.status.hidden` 那一半判据。少了它，报错之后钉住的东西就再也上不来了。 */
  ui.hideStatus();
  const 解钉后 = 状态行.hidden;
  ui.showStatus('测试：又一条报错', true, () => {});
  ui.hideStatus();
  ui.pinStatus('测试：第三条', { label: '去开启定位服务', onClick: () => {} });
  const 空着时上屏 = !状态行.hidden && /第三条/.test(状态行.textContent);
  ui.unpinStatus();
  push('解过钉之后状态行该真的空着；屏幕空着时新钉上的那条要立刻上屏',
    解钉后 && 空着时上屏 && 状态行.hidden,
    '解钉后再问一次 hideStatus：还空着=' + 解钉后 + '；屏幕空着时钉第三条：上屏=' + 空着时上屏 +
    '（报错记录还挂着，靠的是「屏幕已经空着」那一半判据）');

  /* 自愈第一轮：4 秒后自动补一发，这一发不再被拦 —— 首页该自己填回来，不等用户重搜。
   * 补的是同一个目标，必须走「原地刷新」（只亮右上角小转圈）：每四秒把整页撤成骨架屏，
   * 比多等四秒更烦。判据是重试期间 结果区一刻没断、骨架屏一次没出现 —— 采样 300ms 一档，
   * 靠上面那 1.6 秒慢回把窗口拉长，不然量到的是竞态不是行为（这条一开始就是这么漏掉变异的）。
   * 换城市用佛山（前面几条用例已经用过广州那组坐标，同目标会被判成原地刷新）。 */
  拦几发 = 1; 天气发数 = 0; 慢回 = true;
  const 佛山 = { lat: 23.0215, lon: 113.1214, name: '佛山', label: '佛山（自愈测试）' };
  q.query(佛山);
  await sleep(1200);
  const 首轮 = { 报错: /查询失败/.test(状态行.textContent), 发数: 天气发数,
    结果: 在屏上(结果区), 骨架: 在屏上(骨架区) };
  let 撤成骨架 = false, 旧卡断过 = false;
  for (let i = 0; i < 30 && !/佛山/.test(标题()); i++) {
    if (在屏上(骨架区)) 撤成骨架 = true;
    if (!在屏上(结果区)) 旧卡断过 = true;
    await sleep(300);
  }
  慢回 = false;
  const 补上后 = { 发数: 天气发数, 标题: 标题(), 温度: 温度(), 在屏: 在屏上(结果区) };
  push('冷启动那一发失败之后自动补一轮：首页自己填回来，且重试不闪整页',
    首轮.报错 && 首轮.发数 === 1 && !首轮.骨架 && 首轮.结果 &&
      /佛山/.test(补上后.标题) && /\d/.test(补上后.温度) && 补上后.在屏 &&
      补上后.发数 === 2 && !撤成骨架 && !旧卡断过,
    '首轮=' + 首轮.发数 + '发（报错=' + 首轮.报错 + '，骨架=' + 首轮.骨架 + '），恢复后=' +
    补上后.发数 + '发，标题=' + 补上后.标题.slice(0, 16) + '，温度=' + 补上后.温度 +
    '，重试期间撤成骨架屏=' + 撤成骨架 + '，旧卡断过=' + 旧卡断过);

  /* 屏幕不在前台时这一枪不发（省电，也是用户要抠的无谓开销），回前台由 retryOnResume 补。
   * document.hidden 是 Document.prototype 上的 getter，这里在实例上盖一个假的，用完 delete 掉。 */
  拦全部 = true; 天气发数 = 0;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  q.query({ lat: 22.517, lon: 113.391, name: '中山', label: '中山（后台测试）' });
  await sleep(1200);
  await sleep(5200);            // 越过 4 秒那一档：这一发绝不该在后台打出去
  const 后台 = { 发数: 天气发数 };
  delete document.hidden;
  q.retryOnResume();
  await sleep(1400);
  const 补发 = { 发数: 天气发数 };
  拦全部 = false;
  push('后台不白发这一枪，回到前台才补上',
    后台.发数 === 1 && 补发.发数 === 2,
    '后台等待 6.4 秒后发了 ' + 后台.发数 + ' 发，retryOnResume 之后 ' + 补发.发数 + ' 发');

  /* 只补两轮就收手。连打三发（后两发走「自动重试」那一路，不许把计次清零）：
   * 第一发排 4 秒、第二发排 30 秒、第三发该**什么都不排** —— 于是 4 秒过去也不见第四发。
   * 封顶一被拆，RETRY_MS[2] 取到 undefined ⇒ setTimeout 当成 0 毫秒，立刻再来一发，
   * 两秒内就能看见数字往上蹿，比等 30 秒那一档又快又稳（等窗口那种写法第一次就漏掉了这条变异）。 */
  拦全部 = true; 天气发数 = 0;
  const 珠海 = { lat: 22.271, lon: 113.576, name: '珠海', label: '珠海（封顶测试）' };
  q.query(珠海);
  await sleep(700);
  q.query(珠海, { auto: true });
  await sleep(700);
  q.query(珠海, { auto: true });
  await sleep(700);
  const 三发后 = 天气发数;
  await sleep(6000);            // 必须越过 4 秒那一档：没有计时器在排，这里就该停在 3
  const 再等 = 天气发数;
  拦全部 = false;
  window.fetch = 原fetch;
  push('失败只补两轮就收手，第三发之后不再排任何计时器',
    三发后 === 3 && 再等 === 3,
    '三连发=' + 三发后 + ' 发，再等 6 秒=' + 再等 + ' 发（都要 3；等不满 4 秒那一档量不到「计次被清零」这种改坏）');

  /* 收尾把首页查回正常态：上面这几发失败已经把数据打回旧城市了（宁缺勿错，报错时不换标题）。 */
  q.query({ lat: 23.13, lon: 113.26, name: '广州', label: '广州（收尾）' });
  for (let i = 0; i < 25 && !/广州/.test(标题()); i++) await sleep(400);
  push('收尾：屏上重新有一座城的天气，三态里只剩结果区可见',
    /\d/.test(温度()) && 首页有几块() === 1 && 在屏上(结果区),
    '温度=' + 温度() + '，可见块数=' + 首页有几块() + '，标题=' + 标题().slice(0, 18));
}

window.__CHECKS__ = R;
