/* 真机 WebView 里跑一段表达式，把返回值打印成 JSON —— 用来量只有设备上才成立的东西
 * （玻璃层数、计算后的 --surface、prefers-contrast 是否生效）。
 *   adb -s <serial> forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 *   node tests/cdp-eval.mjs <表达式文件 | 内联表达式> [--url <目标 url 片段>]
 * 表达式支持顶层 await（跑在 Runtime.evaluate + awaitPromise 上）。 */
import { readFileSync } from 'node:fs';

const arg = process.argv[2] || '-';
const src = arg === '-' ? readFileSync(0, 'utf8')
  : (() => { try { return readFileSync(arg, 'utf8'); } catch { return arg; } })();
const wantUrl = (process.argv.find(a => a.startsWith('--url=')) || '').slice(6);

const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = targets.find(t => t.type === 'page' && (!wantUrl || t.url.includes(wantUrl)));
if (!page) throw new Error('没有匹配的 page target：' + targets.map(t => t.url).join(' , '));

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 连接失败')); });
let id = 0;
const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  const p = pending.get(m.id);
  if (p) { pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
};
const send = (method, params) => new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params })); });

const r = await send('Runtime.evaluate', {
  expression: `(async () => { ${src} })()`,
  awaitPromise: true, returnByValue: true
});
if (r.exceptionDetails) {
  console.error('页面里抛错：', r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
  process.exitCode = 2;
} else {
  console.log(JSON.stringify(r.result.value, null, 2));
}
ws.close();
