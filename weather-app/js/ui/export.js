/* 把对比那一屏带走：CSV 与截图（FR11）。
 * 谁可以改我：改导出格式的人。字段口径**不在这里定义** —— 那份模型在 compare.js 的 cardFields，
 * 界面上看到的和导出去的就是同一份文案，改一处两边一起变。 */
import { downloadBlob, cssVar } from '../lib/util.js';
import { showStatus } from './status.js';
import { cardFields, compareRows } from './compare.js';

export function exportCSV() {
  const res = compareRows();
  if (!res.length) { showStatus('暂无对比数据', true); return; }
  const rows = [['城市', '当前温度', '天气', '最高', '最低', '湿度%', '风']];
  res.forEach(r => {
    if (r.error) { rows.push([r.key, 'ERROR', r.error, '', '', '', '']); return; }
    const f = cardFields(r);
    rows.push([f.name, f.temp, f.desc, f.tmax, f.tmin, f.humNum, f.wind]);
  });
  const csv = '\ufeff' + rows.map(row => row.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'weather-compare.csv');
  showStatus('已导出 CSV');
}

export function exportPNG() {
  const res = compareRows().filter(r => !r.error);
  if (!res.length) { showStatus('暂无对比数据', true); return; }
  const cols = Math.min(res.length, 3), rows = Math.ceil(res.length / cols);
  const cw = 240, ch = 200, pad = 16;
  const cv = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  cv.width = (cols * cw + pad * (cols + 1)) * dpr;
  cv.height = (rows * ch + pad * (rows + 1)) * dpr;
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  const cardBg = cssVar('--card', '#ffffff');
  const ink = cssVar('--ink', '#1f2a37');
  const muted = cssVar('--muted', '#6b7785');
  const roundRect = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  res.forEach((r, i) => {
    const f = cardFields(r);
    const x = pad + (i % cols) * (cw + pad), y = pad + Math.floor(i / cols) * (ch + pad);
    ctx.fillStyle = cardBg; roundRect(x, y, cw, ch, 14); ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = ink; ctx.font = '600 16px sans-serif'; ctx.fillText(f.name, x + cw / 2, y + 30);
    ctx.fillStyle = cssVar('--brand', '#2b7fff'); ctx.font = '600 40px sans-serif'; ctx.fillText(f.temp, x + cw / 2, y + 80);
    ctx.fillStyle = muted; ctx.font = '13px sans-serif'; ctx.fillText(f.desc, x + cw / 2, y + 105);
    ctx.fillStyle = ink; ctx.font = '13px sans-serif'; ctx.fillText(f.range, x + cw / 2, y + 132);
    ctx.fillStyle = muted; ctx.fillText('湿度 ' + f.humidity + ' · ' + f.wind, x + cw / 2, y + 156);
  });
  cv.toBlob(b => { if (b) downloadBlob(b, 'weather-compare.png'); else showStatus('截图导出失败', true); }, 'image/png');
  showStatus('已导出对比截图');
}
