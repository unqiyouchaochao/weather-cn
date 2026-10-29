/* 排名浮层滚动的 GPU 代价：reset gfxinfo → 24 次固定手势 → 抓关键计数。
 * 只用于「毛玻璃层数」这类改动的真机 A/B：同一台、同一串手势才可比。
 *   node tests/gfx-rank-scroll.mjs <标签> <serial>（或设置 ANDROID_SERIAL）
 * 前置条件都是踩过坑才写死在这里的：
 * 1) 屏幕必须已解锁且通知栏收起 —— 锁屏时 input swipe 落到 keyguard 上，一帧都不呈现，
 *    于是 jank 0%、GPU 直方图全 0，看着像「修好了」，其实什么都没测（2026-09-24 就中招了）。
 * 2) 测量前后各查一次排名浮层真的开着、且 scrollTop 动了，否则这份数不是「滚动排名」的数。 */
const A = process.env.ADB || 'adb';
const SER = process.argv[3] || process.env.ANDROID_SERIAL;
if (!SER) { console.error('用法：node tests/gfx-rank-scroll.mjs <标签> <serial>（或设置 ANDROID_SERIAL）'); process.exit(2); }
const PKG = 'com.weatherstudio.app', N = 24;
const { execFileSync } = await import('node:child_process');
const { writeFileSync, mkdirSync } = await import('node:fs');
const LABEL = process.argv[2] || 'run';
const sh = (...args) => execFileSync(A, ['-s', SER, ...args], { encoding: 'utf8' });

const viewState = () => JSON.parse(execFileSync(process.execPath, ['tests/cdp-eval.mjs',
  'return {open: !document.getElementById("rankView").hidden,' +
  ' rows: document.querySelectorAll("#rankView .rank-row, #rankView li").length,' +
  ' scrollTop: Math.round(document.getElementById("rankScroll").scrollTop)}'],
  { encoding: 'utf8', cwd: process.cwd() }));
/* 测量前必须回顶部：上一次跑到一半崩了的话，浮层停在底部，再往上滑就是零位移零帧 —— 0.10% 抖动
 * 这种数看着比"修好了"还好，其实是什么都没测（2026-09-24 就是这么被拦下一次）。
 * 量的那一层是 v107 之后的唯一滚动容器 #rankScroll（.sheet 自己不滚了，头部留在外面）。 */
const scrollToTop = () => execFileSync(process.execPath, ['tests/cdp-eval.mjs',
  'document.getElementById("rankScroll").scrollTop = 0;' +
  'return {scrollTop: Math.round(document.getElementById("rankScroll").scrollTop)}'],
  { encoding: 'utf8', cwd: process.cwd() });

if (/mIsShowing=true/.test(sh('shell', 'dumpsys', 'window'))) {
  throw new Error('锁屏中：手势不会落到应用上，测出来必然是 0 帧。请先解锁并收起通知栏。');
}
sh('shell', 'svc', 'power', 'stayon', 'usb');
scrollToTop();
const st0 = viewState();
if (!st0.open) throw new Error('排名浮层没开着（先 node tests/cdp-eval.mjs 里 rank.open()）');
if (st0.scrollTop !== 0) throw new Error('回顶部失败，scrollTop=' + st0.scrollTop + '，这一轮不可比');
sh('shell', 'dumpsys', 'gfxinfo', PKG, 'reset');
/* 来回各一半：单向 24 下会从中间就撞底，撞底之后手势不再产生位移，样本量与对照组就不等了。
 * 手指从下往上（2200→700）才是「往下翻」，别搞反 —— 搞反了第一段位移为 0，判空会误报。 */
for (let i = 0; i < N / 2; i++) sh('shell', 'input', 'swipe', '720', '2200', '720', '700', '260');
const stMid = viewState();
for (let i = 0; i < N / 2; i++) sh('shell', 'input', 'swipe', '720', '700', '720', '2200', '260');
await new Promise(r => setTimeout(r, 1200));
const st1 = viewState();
const out = sh('shell', 'dumpsys', 'gfxinfo', PKG);
mkdirSync('_probe', { recursive: true });   // 原始 dump 落在临时目录，仓库里没有也不报错
writeFileSync('_probe/gfx-' + LABEL + '.txt', out);

/* 格式是这台机器（Android 15 / HyperOS）上 dumpsys gfxinfo 的原样，逐条对过 _probe/gfx-*.txt：
 *   Total frames rendered: 1071 / Janky frames: 3 (0.28%) / 50th percentile: 7ms
 *   Number Slow UI thread: 3 / 99th gpu percentile: 4ms
 *   GPU HISTOGRAM: 1ms=28 2ms=331 … 4950ms=0   ← 全在一行、空格分隔，早先用「每行一个」的锚定正则
 *   解析出来恒为 0 帧，把一次真跑（1071 帧）判成了「手势没落到页面上」。判空的数自己先得是对的了。 */
const pick = re => (out.match(re) || ['n/a'])[0];
const hist = (/GPU HISTOGRAM: (.*)/.exec(out) || [])[1] || '';
const buckets = [...hist.matchAll(/([\d.]+)ms=(\d+)/g)].map(m => ({ ms: +m[1], n: +m[2] }));
const presented = buckets.reduce((s, b) => s + b.n, 0);
const jank = /Janky frames: (\d+) \(([\d.]+)%\)/.exec(out);
const tot = /Total frames rendered: (\d+)/.exec(out);
const heavy = buckets.filter(b => b.ms >= 700 && b.n > 0).map(b => b.ms + 'ms=' + b.n);
const res = {
  label: LABEL, swipes: N, stateBefore: st0, stateAtBottom: stMid, stateAfter: st1,
  total: tot ? tot[1] : 'n/a', framesInHistogram: presented,
  janky: jank ? jank[1] + ' (' + jank[2] + '%)' : 'n/a',
  cpuPercentiles: ['50th', '90th', '95th', '99th'].map(k => pick(new RegExp(k + ' percentile: [\\d.]+ms'))),
  gpuPercentiles: ['50th', '90th', '95th', '99th'].map(k => pick(new RegExp(k + ' gpu percentile: [\\d.]+ms'))),
  gpuHeavyFrames: heavy.length ? heavy : 'none ≥700ms',
  slowUiThread: pick(/Number Slow UI thread: \d+/),
  slowDraw: pick(/Number Slow issue draw commands: \d+/)
};
console.log(JSON.stringify(res, null, 2));
/* 判空：0 帧 / 压根没位移 ⇒ 通道坏了，不是性能好。显式喊出来，别让 0.10% 冒充结论。 */
if (!presented || stMid.scrollTop === st0.scrollTop) {
  console.error('⚠ 这份数不可信：呈现帧数 ' + presented + '，scrollTop ' +
    st0.scrollTop + '→' + stMid.scrollTop + '（手势多半没落到页面上）');
  process.exitCode = 3;
}
