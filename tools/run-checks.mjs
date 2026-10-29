/* 回归检查的头无头跑批通道。
 *
 * 为什么要有它：应用内浏览器（Qoder 的那个 WebView）常年没有可见表面，visibilityState=hidden，
 * Chrome 的省电节流把宏任务压到**每分钟一个** —— setTimeout 和 MessageChannel 一样挨压
 * （上一轮以为 postMessage 能躲开，实测躲不开）。52 条断言里二十几个 sleep，
 * 于是整套要跑几十分钟，看板上就是「卡死」。
 * 头无头 Edge 的页面按可见算，配 --disable-*-throttling 后按墙上时钟正常跑完（约 150s）。
 *
 * 用法：node tools/run-checks.mjs [url]     输出每条断言的名字/结果/实测，退出码 = 失败条数
 */
import { spawn, execSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/* EdgeCore 的目录名带版本号，写死会在下次系统更新后突然「找不到浏览器」。
 * EDGE_BIN 显式指定优先；否则挑 EdgeCore 下版本号最大的那个 msedge.exe。 */
function findEdge() {
  if (process.env.EDGE_BIN) return process.env.EDGE_BIN;
  const base = 'C:\\Program Files (x86)\\Microsoft\\EdgeCore';
  try {
    const v = readdirSync(base).filter(d => /^\d+\./.test(d)).sort((a, b) =>
      a.split('.').map(Number).reduce((p, c) => p * 1e5 + c, 0) - b.split('.').map(Number).reduce((p, c) => p * 1e5 + c, 0));
    for (const dir of v.reverse()) { const p = join(base, dir, 'msedge.exe'); if (existsSync(p)) return p; }
  } catch {}
  for (const p of ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']) if (existsSync(p)) return p;
  return null;
}
const EDGE = findEdge();
const PORT = +(process.env.CDP_PORT || 9333);
const URL = process.argv[2] || `http://127.0.0.1:${process.env.SERVE_PORT || 8169}/tests/run.html`;
const BUDGET_MS = +(process.env.CHECKS_BUDGET || 420000);
/* 配置文件目录放系统 temp：它只活这一次，留在仓库里就是 git status 里一堆噪音 */
const PROFILE = join(tmpdir(), 'weather-checks-' + process.pid);

/* 上一轮被硬杀时 profile 会留下；按 PID 判活，只清死进程的目录，活进程的不碰。 */
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code !== 'ESRCH'; }
}
function sweepStaleProfiles() {
  let names = [];
  try { names = readdirSync(tmpdir()); } catch { return; }
  for (const name of names) {
    const m = /^weather-checks-(\d+)$/.exec(name);
    if (!m) continue;
    const dir = join(tmpdir(), name);
    const pid = Number(m[1]);
    let old = false;
    try { old = Date.now() - statSync(dir).mtimeMs > 6 * 3600 * 1000; } catch { continue; }
    /* PID 会被系统复用：不能只看进程活不活；超过 6 小时的 profile 一定不属于本轮跑批
       （run-checks 的墙钟硬顶是 600s），按年龄也清掉。 */
    if (!old && (!pid || pid === process.pid || pidAlive(pid))) continue;
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}
sweepStaleProfiles();

if (!EDGE) { console.error('找不到 Edge/Chrome（EDGE_BIN 可以显式指定路径）'); process.exit(90); }
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(PROFILE, { recursive: true });

const chrome = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-features=IntensiveWakeUpThrottling',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank',
], { stdio: 'ignore' });

let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  /* 只杀自己启动的这棵进程树。原先写的是 /IM msedge.exe：它依赖一个从未 import 的
     execSync，实际是死代码；就算补上 import，也会把同机其它 Edge / 跑批一起带走。 */
  if (process.platform === 'win32' && chrome.pid) {
    try { execSync(`taskkill /F /PID ${chrome.pid} /T`, { stdio: 'ignore' }); } catch {}
  }
  try { chrome.kill(); } catch {}
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch {}
};
process.on('exit', stop);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch {}
    await sleep(500);
  }
  throw new Error('CDP 端口没起来：' + PORT);
}

const t = await target();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0;
const waiting = new Map();
const logs = [];
/* 浏览器 wedged / 被别的跑批的 teardown 杀掉时，ws 会先关掉，而那时挂着的 send() 没人接：
 * 2026-10-06 一整批 falsify 就这么停在第一处变异上 35 分钟（源文件还留着改坏的那一行，
 * 而父进程 spawnSync 没有超时，谁也走不到「还原」那一步）。连接一断就把待办全判负，
 * 顶层 await 抛出 ⇒ 进程退出 ⇒ 父进程拿到 0 条，走它自己的 exit 96 并当场还原。 */
const 断开 = ev => { const e = new Error('CDP 连接断了（' + ((ev && ev.code) || '?') + '）'); for (const { rej } of waiting.values()) rej(e); waiting.clear(); };
ws.onclose = 断开;
ws.onerror = 断开;
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && waiting.has(m.id)) { const { res, rej } = waiting.get(m.id); waiting.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  if (m.method === 'Runtime.consoleAPICalled') logs.push((m.params.type) + ': ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' '));
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === 'Log.entryAdded') logs.push('log: [' + (m.params.entry.url || '?') + '] ' + m.params.entry.text);
  if (m.method === 'Network.loadingFailed') logs.push('netfail: ' + (m.params.errorText || '') + ' ' + ((m.params.blockedReason || '') + (m.request ? '' : '')));
};
const send = (method, params) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
  if (r.exceptionDetails) throw new Error('页内抛错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
};
/* 带 awaitPromise 的那一种：用来把「模块顶层 await 里抛那个错」原样拿回来。
 * 顶层抛错的模块脚本在 CDP 里未必落成 Runtime.exceptionThrown，光看日志会以为它还在跑。 */
const evaluateAwait = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: BUDGET_MS });
  if (r.exceptionDetails) return 'EVAL-EXC: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.navigate', { url: URL });

const t0 = Date.now();
/* 看门狗：连接还开着、浏览器却不再回话（今天就是这个形状 —— 进程活着，/json/list 已经拒了），
 * 上面那两个 handler 一个都不会触发，send() 的 promise 永不落地，整批 falsify 停在第一处变异上
 * 35 分钟，而那一处的源文件还留着改坏的那一行（父进程 spawnSync 没有超时，走不到 finally 的还原）。
 * 给整趟一个墙钟硬顶，到点就退 —— 宁可父进程判「0 条＝通道坏了」并还原源文件，也不要挂着不动。 */
const 硬顶 = Math.min(BUDGET_MS * 3, 600000);
setTimeout(() => {
  console.log('看门狗：' + (硬顶 / 1000) + 's 到点，这趟没出结果，硬退（上层按「通道坏了」处理，源文件由它自己还原）。');
  stop(); process.exit(92);
}, 硬顶);
let last = '', checks = null;
const STATE = `(() => {
  const f = document.querySelector('iframe');
  const o = { top: location.href, primed: (document.getElementById('primed')||{}).textContent,
              hasFrame: !!f, src: f && f.getAttribute('src') };
  try { const w = f.contentWindow, d = w.document;
    o.frame = d.readyState; o.url = w.location.href;
    o.scripts = [...d.querySelectorAll('script')].map(s => s.src);
    o.days = d.querySelectorAll('.day').length;
    o.p = w.__P || null; o.n = w.__CHECKS__ ? w.__CHECKS__.length : 0;
    o.vis = d.visibilityState; o.stage = w.__S || null;
    o.sw = !!w.navigator.serviceWorker?.controller;
  } catch (e) { o.frameErr = e.message; }
  return o;
})()`;
let tick = 0;
while (Date.now() - t0 < BUDGET_MS) {
  await sleep(2000);
  const st = await evaluate(`(() => { const f = document.querySelector('iframe');
    if (!f || !f.contentWindow) return null; let w; try { w = f.contentWindow; } catch { return null; }
    return { p: w.__P || '(还没出第一条)', n: w.__CHECKS__ ? w.__CHECKS__.length : 0 }; })()`);
  if (st && st.p !== last) { last = st.p; console.log('  +' + String(Math.round((Date.now() - t0) / 1000)) + 's  ' + st.p); }
  if (++tick % 10 === 0) {   // 每 20s 报一次现场：光看针不知道是被测页没画出来还是断言在等
    const s = await evaluate(STATE);
    console.log('    ·' + Math.round((Date.now() - t0) / 1000) + 's 现场：iframe=' + s.frame
      + ' .day=' + s.days + ' 可见=' + (s.vis || '?') + ' 针=' + (s.p || 'null'));
  }
  if (st && st.n) { checks = await evaluate(`document.querySelector('iframe').contentWindow.__CHECKS__`); break; }
}
if (!checks) {
  console.log('超时或没结果。停在：' + (last || '(一条都没出)'));
  console.log('现场：' + JSON.stringify(await evaluate(STATE), null, 1));
  console.log('重跑一遍断言模块、把抛出的错拿回来：');
  console.log('  ' + await evaluateAwait(
    `import('/tests/app.checks.mjs?probe=' + Date.now()).then(() => '跑完了（说明第一次是别的原因）', e => 'THREW: ' + (e && (e.stack || e.message) || String(e)))`));
  console.error(logs.slice(-25).join('\n'));
  stop(); process.exit(91);
}

const fails = checks.filter(c => !c.ok);
for (const c of checks) console.log((c.ok ? 'PASS  ' : 'FAIL  ') + c.name + '   ⟵ ' + c.detail);
console.log('\n合计 ' + checks.length + ' 条，红 ' + fails.length + ' 条，用时 ' + Math.round((Date.now() - t0) / 1000) + 's');
if (logs.length) console.log('\n页内消息：\n' + logs.slice(-20).join('\n'));
ws.close(); stop();
process.exit(fails.length);
