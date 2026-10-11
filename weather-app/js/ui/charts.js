/* 日期角标与对比卡内嵌的 7 天温度小图（内联 SVG，全离线）。
 * 主页那张温度趋势大图连同「降水柱 / 降水量图例」一起在 2026-09-26 整块删掉了：
 * 大图与下面的「未来预报」逐日卡、逐小时浮层报同一批数，删掉不丢信息，只丢一次重绘。
 * dayLabel 仍被逐小时标题与逐日卡用着，别顺手删。 */
import { uTemp } from '../lib/config.js';
import { weekday } from '../lib/util.js';

export function dayLabel(date) {
  const dt = new Date(date + 'T00:00:00');
  if (isNaN(dt)) return date;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (dt.getTime() === today.getTime()) return '今天';
  return weekday(dt);
}

/** 对比卡里那条 7 天温度折线。没有温度值时返回空串，卡片就不留一块空白。
 *  --warm/--cool 只画在线上是有意为之：这两个令牌照「非文本图形件 ≥3:1」量的（最差 3.16），
 *  拿去当文字没有一个够 4.5，所以小图里一个字都不写。 */
export function miniChart(days) {
  if (!days || !days.length) return '';
  const vals = [];
  days.forEach(d => { if (d.tmax != null) vals.push(uTemp(d.tmax)); if (d.tmin != null) vals.push(uTemp(d.tmin)); });
  if (!vals.length) return '';
  const W = 150, H = 54, n = days.length;
  let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  const pad = (hi - lo) * 0.15 || 2;
  lo -= pad; hi += pad;
  if (hi <= lo) hi = lo + 4;
  const X = i => n === 1 ? 6 + (W - 12) / 2 : 6 + (i / (n - 1)) * (W - 12);
  const Y = v => 8 + (H - 16) - ((v - lo) / (hi - lo)) * (H - 16);
  const maxPts = days.map((d, i) => X(i) + ',' + Y(uTemp(d.tmax))).join(' ');
  const minPts = days.map((d, i) => X(i) + ',' + Y(uTemp(d.tmin))).join(' ');
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
    '<polyline points="' + maxPts + '" fill="none" stroke="var(--warm)" stroke-width="1.8" stroke-linejoin="round"/>' +
    '<polyline points="' + minPts + '" fill="none" stroke="var(--cool)" stroke-width="1.8" stroke-linejoin="round"/></svg>';
}
