/* Agent 闭环：把「改 JSON → 装进真页面 → 听 App 自己怎么说 → 出一张图」这条链交给机器跑。
 * 用法：node tools/theme-agent-loop.mjs <包.json> [--channel=headless|device] [--device=<串行号>]
 *                                            [--no-shot] [--keep-theme] [--json]
 *
 * 为什么现在才做这一步：工具箱（theme-pkg-check.mjs）先把「算术可判」那一半全接了过去，
 * 这条链剩下的部分才值得自动化 —— 而它真正的价值不是「省几次点击」，是**漂移检测**：
 * 离线闸说合格、App 说不合格（或反过来），是这套设计最不能容忍的事。两边 import 的本来是
 * 同一个 themePlugin.validate，一旦哪天有人改了一边而另一边的测试没跟上，只有真跑一次才暴露得出来。
 * 所以第 6 阶段那条 206 是这个工具存在的理由，其它阶段都是把它送到那儿的路。
 *
 * 两条通道，默认 headless：
 *   headless —— 自己起一个无头 Edge（同 tools/run-checks.mjs 那套：应用内浏览器面板是 0×0 隐藏页、
 *               CSS 动画整体冻结，在它里面量出来的一切都不作数），再自己起一个静态服务。
 *               **不需要手机、不需要有人解锁**，所以 agent 能一个人跑完。
 *   device   —— adb 推到真机 + 连 WebView 自己的 CDP。多了真机那一层（MIUI、真 GPU、真实视口），
 *               但要有人在旁边把屏幕解锁，锁屏时截图那一格不可信（208 会说明）。
 *
 * 两条通道都不绕过任何一道闸：导入走的是 `#pluginFile` 那个真实 change 事件，
 * 切主题走的是 `#themeSel` + `#saveBtn` 的真实 click。绕过的话这轮验证就等于没做。
 *
 * 写盘纪律：仓库里只往 tests/shots/（已 gitignore）落截图；device 通道往 /data/local/tmp 推一个包，
 * 结束时删掉并撤掉 forward。跑完默认把环境放回原样：主题切回去、这次**新引进来**的包删掉
 * （--keep-theme 两样都留着）。本来就在清单里的包不动 —— 那是使用者的东西，不是这条链的临时产物。
 *
 * 退出码（200 段是本工具专属，与 81~86 的 pkg-check、90+ 的 run-checks、93~98 的 falsify 都不撞）：
 *   0 全链路通过 · 1..80 离线闸就没过（条数，原样透传 pkg-check）
 *   200 用法/参数错 · 201 没有在线设备 · 202 应用起不来 · 203 CDP 连不上
 *   204 包送不进页面（推包失败 / 路径读不到）· 205 页面上找不到 #pluginFile
 *   206 App 拒绝了离线闸放行的包 —— 两把尺子漂移，最高优先级
 *   207 装上了但切不过去 / 令牌没下发 · 208 截图拿不到可信画面（多半是锁屏挡着）
 *   209 头无头通道起不来（找不到 Edge，或端口被占）
 *   210 链路中途抛了未归类的异常（页面侧或 CDP 侧）—— 出成一条阶段，不丢裸栈给调用方
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const 包文件 = argv[0];
const 取值 = (名, 缺) => { const a = argv.find(s => s === '--' + 名); const e = argv.find(s => s.startsWith('--' + 名 + '=')); return (a && argv[argv.indexOf(a) + 1]) || (e && e.split('=')[1]) || 缺; };
const 旗 = 名 => argv.includes('--' + 名);
if (!包文件) { console.log('用法：node tools/theme-agent-loop.mjs <包.json> [--channel=headless|device] [--device=<串行号>] [--no-shot] [--keep-theme] [--json]'); process.exit(200); }
const 认得 = new Set(['--channel', '--device', '--no-shot', '--keep-theme', '--json']);
const 未认 = argv.slice(1).filter(s => s.startsWith('--') && !认得.has(s.split('=')[0]));
if (未认.length) { console.log('✗ 不认识的开关：' + 未认.join(' ')); process.exit(200); }

const PKG = 'com.weatherstudio.app';
const 通道名 = 取值('channel', 'headless');
const 端口 = Number(process.env.CDP_PORT || 9444);
const 服务端口 = Number(process.env.SERVE_PORT || 8177);
const 超时 = Number(process.env.LOOP_TIMEOUT || 20000);
const node = process.execPath;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const 结果 = { 包: path.basename(包文件), 通道: 通道名, 阶段: [], 通过: false };
const 记 = (名, ok, 明细) => { 结果.阶段.push({ 名, ok, 明细: 明细 || '' }); console.log((ok ? '✓ ' : '✗ ') + 名 + (明细 ? ' —— ' + 明细 : '')); };
function 收场(码, 话) { if (话) console.log(话); if (旗('json')) console.log(JSON.stringify(结果)); process.exit(码); }

/* ---------- 1. 离线闸：原封不动交给 pkg-check，不在这里重抄判据 ---------- */
let pkg;
try { pkg = JSON.parse(fs.readFileSync(包文件, 'utf8')); }
catch (e) { 记('读包', false, e.message); 收场(200); }
const 闸 = spawnSync(node, [path.join(ROOT, 'tools', 'theme-pkg-check.mjs'), 包文件], { encoding: 'utf8' });
const 出 = (闸.stdout || '').trim();
const 比 = /最低比 ([\d.]+) @ (\S+)/.exec(出);
if (闸.status !== 0) {
  记('离线闸', false, '退出码 ' + 闸.status + '（' + (比 ? '最低比 ' + 比[1] + ' @ ' + 比[2] : '形状没过') + '）');
  console.log('\n' + 出.split('\n').map(l => '  | ' + l).join('\n'));
  收场(闸.status, '\n离线闸就没过 —— 不碰页面。按 tools/theme-pkg-check.md 改完 JSON 再来（--fix 给候选）。');
}
记('离线闸', true, '最低比 ' + (比 ? 比[1] : '?') + (比 ? ' @ ' + 比[2] : '') + ' · 可导入');

/* ---------- 2. CDP 客户端（两条通道共用） ---------- */
let ws, seq = 0;
const 待 = new Map();
const 发 = (method, params) => new Promise((res, rej) => {
  const i = ++seq; 待.set(i, { res, rej, method });
  ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  setTimeout(() => { if (待.has(i)) { 待.delete(i); rej(new Error(method + ' 超时')); } }, 20000);
});
const 断 = ev => { const e = new Error('CDP 连接断了（' + (ev?.code ?? ev?.message ?? '?') + '）'); for (const { rej } of 待.values()) rej(e); 待.clear(); };
const 评 = async expr => {
  const r = await 发('Runtime.evaluate', { expression: '(async()=>{' + expr + '})()', awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || '页面里抛错').split('\n')[0]);
  return r.result?.value;
};
async function 接(url) {
  let 页 = null;
  for (let i = 0; i < 30 && !页; i++) {
    try { const l = await (await fetch('http://127.0.0.1:' + 端口 + '/json')).json(); 页 = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }
    catch { await sleep(500); }
  }
  if (!页) throw new Error('/json 里没有 page（' + url + '）');
  ws = new WebSocket(页.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WebSocket 连不上')); });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (!m.id || !待.has(m.id)) return;
    const { res, rej, method } = 待.get(m.id); 待.delete(m.id);
    if (m.error) rej(new Error(method + ' 回了错误：' + m.error.message)); else res(m.result ?? {});
  };
  ws.onclose = ws.onerror = 断;
  await 发('Runtime.enable'); await 发('DOM.enable');
  return 页;
}

/* ---------- 3. 起通道 ---------- */
let ADB = null, 串行 = '', 设备路径 = '', chrome = null, 服务 = null, PROFILE = '', 送 = '';
/* 模块前缀：无头那条通道由本工具自己的服务吐文件，应用在 /weather-app 下；
 * 壳里 Capacitor 把 webDir 拷成站点根，所以同一条 import 在两边差一段路径。 */
let 前缀 = '';
function 找adb() {
  const 候 = [process.env.ADB, path.join(ROOT, '.toolchain', 'android-sdk', 'platform-tools', 'adb' + (process.platform === 'win32' ? '.exe' : '')), 'adb'];
  for (const c of 候) if (c && spawnSync(c, ['version'], { encoding: 'utf8' }).status === 0) return c;
  return null;
}
const adb = (...a) => spawnSync(ADB, a, { encoding: 'utf8' });
const 壳 = cmd => (adb('-s', 串行, 'shell', cmd).stdout || '').replace(/\r/g, '');
function 找Edge() {
  if (process.env.EDGE_BIN) return process.env.EDGE_BIN;
  const 基 = 'C:\\Program Files (x86)\\Microsoft\\EdgeCore';
  try {
    const v = fs.readdirSync(基).filter(d => /^\d+\./.test(d)).sort((a, b) =>
      a.split('.').map(Number).reduce((p, c) => p * 1e5 + c, 0) - b.split('.').map(Number).reduce((p, c) => p * 1e5 + c, 0));
    for (const d of v.reverse()) { const p = path.join(基, d, 'msedge.exe'); if (fs.existsSync(p)) return p; }
  } catch { }
  for (const p of ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']) if (fs.existsSync(p)) return p;
  return null;
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
function 起服务() {
  return new Promise((res, rej) => {
    const s = http.createServer((req, r) => {
      const 请 = decodeURIComponent(req.url.split('?')[0]);
      const 件 = path.join(ROOT, 请 === '/' ? '/weather-app/index.html' : 请);
      const 真 = path.resolve(件);
      if (!真.startsWith(ROOT + path.sep)) { r.writeHead(403); return r.end(); }  // 只许出仓库内的文件（带上分隔符，免得 天气evil 这种同级目录混过去）
      fs.readFile(真, (e, b) => {
        if (e) { r.writeHead(404); return r.end('404'); }
        r.writeHead(200, { 'content-type': MIME[path.extname(真)] || 'application/octet-stream', 'cache-control': 'no-store' });
        r.end(b);
      });
    });
    s.on('error', rej); s.listen(服务端口, '127.0.0.1', () => res(s));
  });
}
const 关通道 = () => {
  try { if (ws && ws.readyState === 1) ws.close(); } catch { }
  if (ADB && 串行) { try { adb('-s', 串行, 'shell', 'rm', '-f', 设备路径); } catch { } try { adb('-s', 串行, 'forward', '--remove', 'tcp:' + 端口); } catch { } }
  try { if (chrome) chrome.kill(); } catch { }
  try { if (服务) 服务.close(); } catch { }
  try { if (PROFILE) fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { }
};
process.on('exit', 关通道);
/* 页面侧或 CDP 侧冒出来的未归类异常：出成一条阶段 + 退出码，别把裸栈丢给调用方 ——
 * 这条链是给 agent 吃的，一段 stack trace 既不可判定也浪费上下文。 */
process.on('uncaughtException', e => { 记('链路中断', false, (e.message || String(e)).split('\n')[0]); 收场(210); });

try {
  if (通道名 === 'device') {
    ADB = 找adb();
    if (!ADB) { 记('找 adb', false, 'PATH 与 .toolchain 里都没有 —— 给 ADB=<路径> 指一个'); 收场(200); }
    串行 = 取值('device', '') || process.env.SERIAL || '';
    if (!串行) {
      const 线 = adb('devices').stdout.replace(/\r/g, '').split('\n').slice(1).filter(l => /\tdevice$/.test(l)).map(l => l.split('\t')[0]);
      if (!线.length) { 记('找设备', false, 'adb 没看到任何在线设备（换 --channel=headless 可以不要手机）'); 收场(201); }
      if (线.length > 1 && !process.env.SERIAL) { 记('找设备', false, '同时在线 ' + 线.length + ' 台（' + 线.join(' / ') + '），要 --device=<串行号>'); 收场(201); }
      串行 = 线[0];
    }
    记('找设备', true, 串行 + ' · ' + 壳('getprop ro.product.model').trim());
    /* 每次都真的 am start，不能只看 pidof —— 2026-10-10 在这台红米上踩到：`install -r` 之后
     * HyperOS 留着进程（pidof 有值）而把 Activity 收掉了，于是 WebView 的调试套接字根本不存在，
     * loop 卡在「/json 里没有 page」。am start 对已经在前台的场合是幂等的，没什么代价。 */
    const 件 = 壳('cmd package resolve-activity --brief ' + PKG).trim().split('\n').pop();
    adb('-s', 串行, 'shell', 'am', 'start', '-W', '-n', 件.includes('/') ? 件 : PKG + '/.IconDefault');
    let pid = '';
    for (let i = 0; i < 24 && !pid; i++) { await sleep(500); pid = 壳('pidof ' + PKG).trim().split(/\s+/)[0]; }
    if (!pid) { 记('起应用', false, 'am start 之后 12s 还没有进程（包没装？被 MIUI 后台限制拦了？）'); 收场(202); }
    const 在前 = 壳('dumpsys window | grep -oE "mCurrentFocus=.*"').includes(PKG);
    记('起应用', true, 'pid ' + pid + (在前 ? ' · 已在前台' : ' · ⚠ 焦点不在它身上（锁屏或被人盖住了），截图那一格可能不可信'));
    adb('-s', 串行, 'forward', 'tcp:' + 端口, 'localabstract:webview_devtools_remote_' + pid);
    const 页 = await 接('真机 WebView').catch(e => {
      记('连 CDP', false, e.message + ' —— debug 包才有这个套接字；release 包上这条链走不通');
      收场(203);
    });
    记('连 CDP', true, 页.url);
    设备路径 = '/data/local/tmp/' + pkg.id + '.themepkg.json';
    const 推 = adb('push', 包文件, 设备路径);
    if (推.status !== 0) { 记('推包', false, (推.stderr || 推.stdout || '').trim().split('\n').pop()); 收场(204); }
    结果.送包 = 设备路径;
    记('推包', true, 设备路径 + ' · ' + (fs.statSync(包文件).size / 1024).toFixed(0) + 'KB');
    送 = 设备路径;
  } else {
    const EDGE = 找Edge();
    if (!EDGE) { 记('找浏览器', false, '没找到 Edge/Chrome（EDGE_BIN 可以显式指定）'); 收场(209); }
    服务 = await 起服务().catch(e => { 记('起服务', false, e.message + '（端口 ' + 服务端口 + ' 被占？）'); 收场(209); });
    PROFILE = path.join(tmpdir(), 'weather-agent-' + process.pid);
    fs.rmSync(PROFILE, { recursive: true, force: true }); fs.mkdirSync(PROFILE, { recursive: true });
    chrome = spawn(EDGE, ['--headless=new', '--no-first-run', '--no-default-browser-check',
      ...(process.env.HEADLESS_GPU ? [] : ['--disable-gpu']),   // HEADLESS_GPU=1 时带上 GPU：backdrop-filter 才像真机
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
      '--disable-features=IntensiveWakeUpThrottling', '--remote-allow-origins=*',
      '--remote-debugging-port=' + 端口,
      '--user-data-dir=' + PROFILE, 'about:blank'], { stdio: 'ignore' });
    const 页 = await 接('无头 Edge').catch(e => { 记('连 CDP', false, e.message); 收场(209); });
    await 发('Page.enable');
    await 发('Emulation.setDeviceMetricsOverride', { width: 411, height: 914, deviceScaleFactor: 3, mobile: true });
/* 现场：加载失败时把「页面到底走到哪一步了」倒出来。没有这一段的话，
 * 「页面没起来」这种红只能靠人再手跑一遍探针才知道是 404、是权限弹窗、还是 boot 卡在哪儿。 */
const 现场 = async () => {
  try {
    return await 评(`return JSON.stringify({href:location.href.slice(0,60),ready:document.readyState,
      file:!!document.getElementById('pluginFile'),gear:!!document.getElementById('openSettings'),
      theme:document.body?.dataset?.theme||null,
      status:(document.querySelector('#status,.status')?.innerText||'').slice(0,60),
      vis:document.visibilityState,w:innerWidth,h:innerHeight});`);
  } catch (e) { return '现场也拿不到：' + e.message; }
};
    await 发('Page.navigate', { url: 'http://127.0.0.1:' + 服务端口 + '/weather-app/index.html' });
    let 卡 = '';
    for (let i = 0; i < 40; i++) {
      await sleep(400);
      let 好 = false;
      try { 好 = await 评(`return !!document.getElementById('pluginFile') && !!document.body.dataset.theme;`); }
      catch (e) { 卡 = e.message; }
      if (好) break;
      if (i === 39) { 记('加载应用', false, '等 16s 页面还没起来。' + (卡 ? '最后一次抛错：' + 卡 : '现场 ' + await 现场())); 收场(209); }
    }
    记('无头通道', true, 页.title + ' · 411×914 dpr3（视口是 Emulation 出来的，不是真屏）');
    前缀 = '/weather-app';
    送 = path.resolve(包文件);
  }
} catch (e) { 记('通道', false, e.message); 收场(209); }

/* 两条通道量的不是同一份代码：无头量的是工作树，device 量的是装进壳里那一份。
 * 版本号从页面里 fetch 出来，不看仓库里的 sw.js —— 不然「装没装上」这件事永远是猜的。 */
const 版本 = await 评(`return (await fetch('${前缀}/sw.js?n='+Date.now())).text().then(t=>(t.match(/weather-studio-v\\d+/)||['?'])[0]);`).catch(() => '?');
结果.版本 = 版本;
记('被测代码', true, (通道名 === 'device' ? '壳里那一份' : '工作树') + ' · CACHE ' + 版本);

/* ---------- 4. 走真实的 change 事件导入 ---------- */
const 原主题 = await 评(`return (await import('${前缀}/js/lib/config.js')).loadConfig().theme;`) || '';
const 读态 = `const m=await import('${前缀}/js/lib/themePlugin.js');const e=document.querySelector('.plugin-err');
  return JSON.stringify({ids:m.list().map(p=>p.id),err:e?e.innerText.replace(/\\s+/g,' ').trim():''});`;
const 旧 = JSON.parse(await 评(读态));
const { root } = await 发('DOM.getDocument', { depth: 1 });
const { nodeId } = await 发('DOM.querySelector', { nodeId: root.nodeId, selector: '#pluginFile' });
if (!nodeId) { 记('找导入控件', false, '页面上没有 #pluginFile'); 收场(205); }
await 发('DOM.setFileInputFiles', { files: [送], nodeId });
let 状 = null;
const 起点 = Date.now();
while (Date.now() - 起点 < 超时) {
  await sleep(600);
  状 = JSON.parse(await 评(读态));
  if (状.ids.includes(pkg.id)) break;
  if (状.err && 状.err !== 旧.err) break;
}
if (!状 || (!状.ids.includes(pkg.id) && 状.err === 旧.err)) {
  记('导入', false, '等 ' + (超时 / 1000) + 's 没等到结果 —— change 事件没落地，或那个路径页面读不到');
  收场(204);
}
if (!状.ids.includes(pkg.id)) {
  记('离线闸 ↔ App 一致性', false, 'App 拒了，而离线闸放行：' + 状.err);
  console.log('\n这就是这条链要抓的东西：两边 import 的是同一个 validate，出现漂移说明有一边被改坏了。');
  console.log('先跑 node tests/theme-pkg.test.mjs，再 diff 一下 validate 与离线闸之间还剩下什么。');
  收场(206);
}
记('离线闸 ↔ App 一致性', true, '「' + pkg.label + '」两边都说可导入');

/* ---------- 5. 切到它（真实的 select + 保存按钮） ---------- */
await 评(`document.getElementById('openSettings').click(); return 1;`);
await sleep(700);
const 有项 = await 评(`return [...document.getElementById('themeSel').options].some(o=>o.value==='${pkg.id}');`);
if (!有项) { 记('切主题', false, '下拉里没有这一项 —— refreshPluginIndex / rebuildThemeOptions 那条顺序被动过'); 收场(207); }
await 评(`const s=document.getElementById('themeSel');s.value='${pkg.id}';s.dispatchEvent(new Event('change',{bubbles:true}));
  document.getElementById('saveBtn').click(); return 1;`);
await sleep(1400);
const 现 = JSON.parse(await 评(`return JSON.stringify({t:document.body.dataset.theme,card:getComputedStyle(document.body).getPropertyValue('--card').trim(),veil:getComputedStyle(document.body).getPropertyValue('--veil').trim(),css:(document.getElementById('plugin-theme-css')?.textContent||'').length});`));
if (现.t !== pkg.id) { 记('切主题', false, 'data-theme 还是 ' + 现.t + ' —— 保存被别的分组校验挡了？'); 收场(207); }
记('切主题', true, 'data-theme=' + 现.t + ' · --card ' + (现.card || '（包里没有）') + ' · --veil ' + (现.veil || '（包里没有）') +
  ' · 装饰 CSS ' + 现.css + ' 字节' + (pkg.css && !现.css ? '（⚠ 包里有 css 却没注进去）' : ''));

/* ---------- 6. 出图 ---------- */
let 图 = '';
if (!旗('no-shot')) {
  /* 先等内容落地再按快门：壳里冷启动那一拍常常还压在骨架屏上，抓下来的图看着完整、其实一片灰块
   * （2026-10-10 华为那张就是这样）。#result 隐藏 = 还没有数据，见 ui/home.js 的 paintHome。 */
  let 内容 = false;
  for (let i = 0; i < 25 && !内容; i++) {
    内容 = await 评(`const r=document.getElementById('result');return !!r && !r.hidden;`).catch(() => false);
    if (!内容) await sleep(600);
  }
  const 锁 = ADB && /isKeyguardShowing=true/.test(壳('dumpsys window'));
  const r = await 发('Page.captureScreenshot', { format: 'png' });
  const buf = r.data ? Buffer.from(r.data, 'base64') : null;
  if (!buf || buf.length < 20000) {
    记('截图', false, (buf ? '只有 ' + buf.length + ' 字节，多半是空白帧' : '没拿到帧') + (锁 ? ' —— 而且设备正锁屏' : ''));
    收场(208);
  }
  fs.mkdirSync(path.join(ROOT, 'tests', 'shots'), { recursive: true });
  图 = path.join('tests', 'shots', 'agent-' + pkg.id + '-' + Date.now() + '.png');
  fs.writeFileSync(path.join(ROOT, 图), buf);
  记('截图', true, 图 + ' · ' + (buf.length / 1024).toFixed(0) + 'KB · '
    + (内容 ? '数据已落地' : '⚠ 等了 15s 还没数据，这张是骨架屏（判令牌与装饰够用，判观感不够）')
    + (锁 ? ' · ⚠ 设备在锁屏，画面可能被 keyguard 挡着' : ''));
  结果.截图 = 图;
}

/* ---------- 7. 复原 ---------- */
if (!旗('keep-theme')) {
  if (原主题 && 原主题 !== pkg.id) {
    await 评(`const s=document.getElementById('themeSel');s.value='${原主题}';s.dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('saveBtn').click(); return 1;`);
    await sleep(900);
  }
  记('复原主题', true, 原主题 && 原主题 !== pkg.id ? '切回 ' + 原主题 : '没动（原本就是它）');
  if (!旧.ids.includes(pkg.id)) {
    await 评(`const m=await import('${前缀}/js/lib/themePlugin.js');await m.remove('${pkg.id}');m.refreshPluginIndex();
      (await import('${前缀}/js/settings/appearance.js')).rebuildThemeOptions(); return 1;`);
    await sleep(400);
    const 后 = JSON.parse(await 评(读态));
    记('删掉这次导入的包', !后.ids.includes(pkg.id), '环境恢复原样（要留着看加 --keep-theme）');
  }
}
结果.通过 = true;
记('全链路', true, '离线闸 → 真页面导入 → 切主题' + (图 ? ' → 出图' : '') + ' 全过（通道：' + 通道名 + '）');
if (旗('json')) console.log(JSON.stringify(结果));
收场(0);
