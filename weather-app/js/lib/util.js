/* 与界面无关的小工具：转义、带超时的 fetch、下载、CSS 变量读取、零散格式化。 */

export function esc(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

export function fetchJson(url, ms, outerSignal) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms || 6000);
  const onOuter = () => ctrl.abort();
  // 外部信号用于取消整轮检索：连打时若不取消，一次停顿会打出多达 8 个请求（4 变体 × 2 源）
  if (outerSignal) { if (outerSignal.aborted) ctrl.abort(); else outerSignal.addEventListener('abort', onOuter); }
  return fetch(url, { signal: ctrl.signal })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .finally(() => {
      clearTimeout(to);
      if (outerSignal) outerSignal.removeEventListener('abort', onOuter);
    });
}

export function fetchResponse(url, ms) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms || 5000);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(to));
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function cssVar(name, fallback) {
  try {
    const s = getComputedStyle(document.body).getPropertyValue(name).trim();
    return s || fallback;
  } catch (e) { return fallback; }
}

export function hhmm(iso) { const s = String(iso || ''); return s.length >= 16 ? s.slice(11, 16) : ''; }
/* 星期名。原来 charts.js 与 fortune.js 各抄了一份同样的七元素表 —— 又是「两份清单各改各的」那个形状 */
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export function weekday(d) { return WEEK[d.getDay()]; }
export function fmtNum(v) { return v == null || isNaN(v) ? '—' : Math.round(v); }
export function uvLabel(v) {
  if (v == null || isNaN(v)) return null;
  const n = Number(v);
  const tag = n < 3 ? '弱' : n < 6 ? '中等' : n < 8 ? '强' : n < 11 ? '很强' : '极强';
  return n.toFixed(1) + ' ' + tag;
}
