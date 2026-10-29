/* 桌面图标切换的真机回归 —— 浏览器那 77 条断言看不到这一层。
 * 插件调的是 PackageManager：只有真机能回答「四个 activity-alias 的 enabled 真的翻过来了吗、
 * 桌面上是不是恰好只有一个入口」。
 *
 * 为什么必须有它（2026-09-29）：用户报「换图标显示失败」，量出来是 `setIcon` 每次都抛
 *   Component class IconSun does not exist in com.weatherstudio.app
 * —— 传给 `setComponentEnabledSetting` 的是没展开的短类名，而 PackageManager 比对的是全限定名。
 * 坑在**读的那一路不报错**：`getComponentEnabledSetting` 拿短名查不到记录只回 DEFAULT，
 * 于是 `getIcon()` 永远客气地回「default」，界面上、控制台里都看不出任何异常。
 * 「写失败 + 读装作成功」这一类，只有把按钮真按一次、再去问系统才暴露得出来。
 *
 *   node tests/icon-switch.mjs [serial]
 * 前置：一台真机装着本应用、应用在前台（WebView CDP 要活着）、屏幕已解锁。
 * 没有可用设备就 exit 3（别把「量不到」当成「通过」）。 */
import { execFileSync } from 'node:child_process';

const A = process.env.ADB || 'adb';
const PKG = 'com.weatherstudio.app';
const ALIAS = { default: 'IconDefault', sun: 'IconSun', night: 'IconNight', bloom: 'IconBloom' };
const IDS = Object.keys(ALIAS);

const ser = process.argv[2] || (() => {
  const out = execFileSync(A, ['devices'], { encoding: 'utf8' });
  const m = out.split('\n').slice(1).map(l => l.trim()).filter(l => /\tdevice$/.test(l));
  if (!m.length) { console.error('没有可用的设备（adb devices 为空）。这一项只能在真机上量。'); process.exit(3); }
  return m[0].split('\t')[0];
})();
const sh = (...args) => execFileSync(A, ['-s', ser, ...args], { encoding: 'utf8' });
/* 页面里抛错时 cdp-eval 是非零退出 —— 别让它把整张表带走（一行都不出的红看着像工具坏了）。
 * 所以所有调用都在表达式里 try/catch 成 {ok} / {err}，让失败以「一条 FAIL + 原文」的形状出来。 */
const ev = expr => {
  try { return JSON.parse(execFileSync(process.execPath, ['tests/cdp-eval.mjs', expr],
    { encoding: 'utf8', cwd: process.cwd() })); }
  catch (e) { return { err: 'CDP 通道失败：' + String(e && e.message || e).split('\n')[0] }; }
};
const plug = (m, arg) => ev('const W = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.WeatherIcon;' +
  'if (!W) return { err: "(壳里没有 WeatherIcon 插件)" };' +
  'try { const r = await W.' + m + '(' + arg + '); return { ok: (r && r.icon) || null }; }' +
  'catch (e) { return { err: String(e && e.message || e) }; }');

/* 先把 CDP 端口接到当前渲染进程的 socket 上（每次重启应用 pid 都会变） */
const sock = (sh('shell', 'cat', '/proc/net/unix').match(/webview_devtools_remote_(\d+)/) || [])[1];
if (!sock) { console.error('找不到 WebView 调试 socket —— 应用没在前台，或屏幕锁着。'); process.exit(3); }
sh('forward', 'tcp:9222', 'localabstract:webview_devtools_remote_' + sock);

if (/mIsShowing=true/.test(sh('shell', 'dumpsys', 'window'))) {
  console.error('锁屏中：应用进不了前台，CDP 连不上。请先解锁。'); process.exit(3);
}

const launcherEntry = () => {
  const out = sh('shell', 'cmd', 'package', 'resolve-activity', '-c', 'android.intent.category.LAUNCHER', PKG);
  return ((out.match(/^ +name=(\S+)/m) || [])[1] || '').split('.').pop();
};
const launcherCount = () => Number((sh('shell', 'cmd', 'package', 'query-activities',
  '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', '--brief')
  .match(new RegExp(PKG.replace(/\./g, '\\.') + '/\\.', 'g')) || []).length);

const g0 = plug('getIcon');
if (g0.err) { console.error('连「现在是哪一套」都问不出来：' + g0.err); process.exit(3); }
const start = g0.ok;
let bad = 0;
const say = (ok, name, detail) => { if (!ok) bad++; console.log((ok ? '  ok   ' : '  FAIL ') + name + '  ⟵ ' + detail); };

console.log('设备 ' + ser + '，起始图标=' + start + '（跑完会还原到这一个）');
for (const id of IDS) {
  const r = plug('setIcon', '{ name: ' + JSON.stringify(id) + ' }');
  say(r.ok === id, 'setIcon(' + id + ') 原生回的就是这一个', JSON.stringify(r));
  /* 系统侧必须真的换到那一个 alias：这是「写成功」的唯一硬证据，界面上的提示不算 */
  const got = launcherEntry();
  say(got === ALIAS[id], 'PackageManager 把桌面入口解析到 ' + ALIAS[id], '实际=' + (got || '(无)'));
  /* 两个入口同时开着 = 桌面上出现两枚图标（清单里 MainActivity 刻意不挂 LAUNCHER 就是为了这个） */
  const n = launcherCount();
  say(n === 1, '同一时刻只有一个 LAUNCHER 入口', '数到 ' + n + ' 个');
}
const back = plug('setIcon', '{ name: ' + JSON.stringify(start) + ' }');
say(back.ok === start, '还原到起始图标', JSON.stringify(back));
say(launcherEntry() === ALIAS[start], '还原后系统侧也对得上', '实际=' + launcherEntry());

console.log(bad ? '\n' + bad + ' 条不通过' : '\n四套预设全部切换成功，且桌面入口始终恰好一个');
process.exit(bad ? 1 : 0);
