/* 出图：把几套主题的首屏与设置面板截成 PNG，用眼睛过一遍（回归只证明数字，不证明好不好看）。
 * 用法：SERVE_PORT=8191 node tools/shot-themes.mjs <输出目录> [主题id,逗号分隔]
 * 注意：headless 关掉 GPU，backdrop-filter 的模糊效果在图上未必与真机一致 ——
 * 这几张只看**版式与配色**（有没有糊成一团、字还在不在原位），材质观感仍以真机为准（S7）。 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function findEdge() {
  if (process.env.EDGE_BIN) return process.env.EDGE_BIN;
  const base = 'C:\\Program Files (x86)\\Microsoft\\EdgeCore';
  try {
    const v = readdirSync(base).filter(d => /^\d+\./.test(d)).sort((a, b) =>
      a.split('.').map(Number).reduce((p, c) => p * 1e5 + c, 0) - b.split('.').map(Number).reduce((p, c) => p * 1e5 + c, 0));
    for (const dir of v.reverse()) { const p = join(base, dir, 'msedge.exe'); if (existsSync(p)) return p; }
  } catch {}
  return null;
}
const EDGE = findEdge();
if (!EDGE) { console.error('找不到 EdgeCore'); process.exit(90); }
const OUT = process.argv[2] || join(ROOT, 'tests', 'shots');
const IDS = (process.argv[3] || 'mint,dark').split(',');
const PORT = +(process.env.CDP_PORT || 9443);
const SERVE = +(process.env.SERVE_PORT || 8191);
mkdirSync(OUT, { recursive: true });
const PROFILE = join(tmpdir(), 'weather-shots-' + process.pid);
rmSync(PROFILE, { recursive: true, force: true }); mkdirSync(PROFILE, { recursive: true });
const chrome = spawn(EDGE, ['--headless=new', '--no-first-run', '--no-default-browser-check',
  '--window-size=390,844', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank'],
  { stdio: 'ignore' });
const stop = () => { try { chrome.kill(); } catch {} };
process.on('exit', stop);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let seq = 0; const waiting = new Map(); let ws;
const send = (m, p) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });
const wire = () => {
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.error ? rej2(w, m.error) : w.res(m.result); }
  };
};
const rej2 = (w, err) => w.rej(new Error(JSON.stringify(err)));
const evaluate = async e => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true, timeout: 60000 });
  if (r.exceptionDetails) throw new Error('页内抛错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
};
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const p = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); wire(); break; }
  } catch {}
  await sleep(500);
}
if (!ws) { console.error('CDP 没起来'); process.exit(91); }
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: `http://127.0.0.1:${SERVE}/weather-app/index.html` });
await sleep(6000);
await evaluate(`(async () => {
  const q = await import('/weather-app/js/query.js');
  q.query({ lat: 23.13, lon: 113.26, name: '广州', label: '广州' });
  return 1; })()`);
await sleep(7000);
for (const id of IDS) {
  await evaluate(`(async () => { const ui = await import('/weather-app/js/ui.js');
    ui.applyTheme('${id}'); ui.applyBg(${JSON.stringify(process.env.SHOT_BG || 'rain')}); return 1; })()`);
  await sleep(900);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, id + '-weather.png'), Buffer.from(shot.data, 'base64'));
  console.log('拍了 ' + id + '-weather.png');
}
/* 设置面板：玻璃恒开之后，那张卡是压在深色遮罩上的，最容易看出「透得脏」 */
await evaluate(`(async () => { const ui = await import('/weather-app/js/ui.js');
  ui.applyTheme('${IDS[0]}'); document.getElementById('openSettings').click(); return 1; })()`);
await sleep(1500);
const s2 = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, IDS[0] + '-settings.png'), Buffer.from(s2.data, 'base64'));
console.log('拍了 ' + IDS[0] + '-settings.png');
stop();
