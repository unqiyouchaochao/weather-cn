/* 真机回归：常驻通知「正文没变就不重发」这一条，只有在**没有重启**的一拍里才量得准。
 *
 * 为什么要等满一小时：这条分支在小时门限之后（`runTick` 里 `last-live` 满 WEATHER_MS 才往下走），
 * 而任何把门限强行拧旧的办法都会顺手把通知重发一次 —— 杀掉进程 → 系统按 START_STICKY 重启服务 →
 * `onStartCommand` 里那句 `startForeground(...)` 本身就发一次通知、刷一次 `when`；而改 prefs 文件
 * 需要一个"没有进程活着"的窗口，那个窗口一开就正好是上面那次重启。两条路都把要量的东西污染了。
 * 所以这里只做一件事：**读现场，等自然到的那一拍**，然后按正文变没变来判定该不该重发。
 *
 * 用法：
 *   ANDROID_SERIAL=<serial> node tests/notify-dedup.mjs            # 只打基线（现在是什么）
 *   ANDROID_SERIAL=<serial> node tests/notify-dedup.mjs --wait     # 等门限打开后的第一拍，出判定（最长 75 分钟）
 * 期间**别打开这个应用**：前台每次刷新也会写 last-live 并重发一条，那样这一轮就测不到后台那一拍。
 * 屏幕可以熄，线可以插着。退出码 0=通过 / 2=不通过 / 3=没测成（被重启或超时）。
 */
import { execSync } from 'node:child_process';

const SERIAL = process.env.ANDROID_SERIAL;
if (!SERIAL) { console.error('需要设备序列号：ANDROID_SERIAL=<serial> node tests/notify-dedup.mjs [--wait]'); process.exit(2); }
const PKG = 'com.weatherstudio.app';
const GATE_MS = 60 * 60 * 1000;
const sh = c => {
  try { return execSync('adb -s ' + SERIAL + ' shell ' + c, { encoding: 'utf8' }); }
  catch (e) { return ''; }
};
const now = () => +((sh('date +%s%3N').match(/\d+/) || [0])[0]);
const unesc = s => String(s).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function 现场() {
  const p = sh('run-as ' + PKG + ' cat shared_prefs/weather-keep-alive.xml');
  const num = k => +((new RegExp('name="' + k + '" value="(\\d+)"').exec(p) || [0, 0])[1]);
  const text = (/<string name="live-text">([\s\S]*?)<\/string>/.exec(p) || [0, ''])[1];
  const title = (/<string name="live-title">([\s\S]*?)<\/string>/.exec(p) || [0, ''])[1];
  const n = sh('dumpsys notification --noredact');
  const L = n.split(/\r?\n/);
  const i = L.findIndex(l => /NotificationRecord\(.*pkg=com\.weatherstudio\.app/.test(l));
  const blk = i < 0 ? '' : L.slice(i, i + 40).join('\n');
  return {
    现在: now(),
    进程: (sh('pidof ' + PKG).match(/\d+/) || [0])[0],
    通知挂着: i >= 0,
    when: +((/when=(\d+)/.exec(blk) || [0, 0])[1]),
    last_live: num('last-live'),
    tick_at: num('tick-at'),
    标题: unesc(title), 正文: unesc(text),
    有配方: /name="recipe"/.test(p)
  };
}

const 等 = ms => new Promise(r => setTimeout(r, ms));
const 打 = (t, s) => console.log(t.padEnd(10) + ' when=' + s.when + '  last-live=' + s.last_live +
  '  正文=' + (s.正文 || '(空)') + (s.进程 ? '' : '  【进程不在，下一拍会冷启动】'));

const a = 现场();
if (!a.有配方 || !a.通知挂着) {
  console.log('前置不满足：常驻通知这条链现在没在跑（有配方=' + a.有配方 + '，通知挂着=' + a.通知挂着 + '）。');
  console.log('先去设置里把「通知栏天气」打开，让常驻那条落下来，再跑本脚本。');
  process.exit(3);
}
打('基线', a);
console.log('门限还有 ' + Math.round((a.last_live + GATE_MS - a.现在) / 60000) + ' 分钟打开；闹钟那一拍还有 ' +
  Math.round((a.tick_at - a.现在) / 60000) + ' 分钟。');
if (!process.argv.includes('--wait')) { console.log('（只看了基线；加 --wait 才等那一拍并判定）'); process.exit(0); }

const 截止 = Date.now() + 75 * 60000;
let b = a, 报过 = false;
while (Date.now() < 截止) {
  await 等(30000);
  b = 现场();
  if (b.进程 !== a.进程 && b.进程) {
    console.log('进程换过（' + a.进程 + ' → ' + b.进程 + '）：服务被重启过，重启会自己发一条通知刷 when，这一轮测不准。');
    process.exit(3);
  }
  if (b.last_live > a.last_live + 60000) break;          // 门限之后真的评估过一次
  if (!报过 && Date.now() % 300000 < 30000) { 报过 = true; 打('等…', b); }
}
if (b.last_live <= a.last_live + 60000) {
  console.log('超时 75 分钟没等到那一拍（闹钟被省电策略推迟，或设备休眠）。这一轮不作数。');
  process.exit(3);
}
打('结果', b);
const 正文变了 = b.正文 !== a.正文 || b.标题 !== a.标题;
const 重发了 = b.when !== a.when;
console.log('正文' + (正文变了 ? '变了（' + a.正文 + ' → ' + b.正文 + '）' : '一个字没变') +
  '；通知' + (重发了 ? '重发了（when 前进 ' + (b.when - a.when) + 'ms）' : '没动（when 不变）'));
if (正文变了 && !重发了) { console.log('不通过：内容变了却没重发，通知会一直停在旧文字。'); process.exit(2); }
if (!正文变了 && 重发了) { console.log('不通过：内容没变还重发，这一拍白刷了一次 SystemUI。'); process.exit(2); }
/* 结论必须说清"这一轮量到的是哪一支"。两轮都跑过一次才发现：正文恰好变了的那一轮，
 * 证的是「该重发的重发」（这条本来就有），而本轮新加的「没变就不重发」那一支压根没被走到 ——
 * 一句"通过"把两件事混成一件，和这个项目一直在防的"看着像结论"是同一个毛病。 */
console.log(正文变了
  ? '这一轮量到的是「正文变了 → 重发」这一支（通过）。新加的「没变 → 不重发」那一支**没有被走到**，要再等一拍正文恰好没变的。'
  : '通过：这一轮量到的正是新加的那一支 —— 正文一个字没变，通知没有重发。');
process.exit(0);
