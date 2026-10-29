/* 对比视图：收藏两城以上才出现的那一面盖在首页之上的网格。
 * 谁可以改我：改「对比卡画什么」的人；**导出**（CSV / 截图）住在一墙之隔的 export.js，
 * 两边共用下面那份 cardFields —— 同一套「高/低/湿度/风」的文案不许各写一遍。 */
import { el } from '../lib/dom.js';
import { esc } from '../lib/util.js';
import { svgIcon } from '../lib/icons.js';
import { fmtTemp, fmtWind } from '../lib/config.js';
import { miniChart } from './charts.js';
import { paintHome, skeletonCards } from './home.js';

// 卡片字段模型只算一次：对比卡、CSV、截图三处共用，避免同一套「高/低/湿度/风」文案各写一遍
export function cardFields(r) {
  const c = (r.data && r.data.current) || {};
  const d = ((r.data && r.data.daily) || [])[0] || {};
  const tempText = fmtTemp(c.temp), maxText = fmtTemp(d.tmax), minText = fmtTemp(d.tmin);
  return {
    name: r.locName || r.key,
    temp: tempText,
    desc: c.desc || '',
    tmax: maxText, tmin: minText,
    range: d.tmax != null ? '高 ' + maxText + ' / 低 ' + minText : '—',
    humidity: (c.humidity != null ? c.humidity : '--') + '%',
    humNum: c.humidity != null ? c.humidity : '',
    wind: fmtWind(c.wind),
    icon: c.icon || 'cloud',
    daily: (r.data && r.data.daily) || []
  };
}

let compareResults = [];
export function compareRows() { return compareResults; }

export function renderCompare(results) {
  compareResults = results;
  el.compareGrid.innerHTML = results.map(r => {
    if (r.error) return '<div class="ccard err" data-key="' + esc(r.key) + '"><div class="c-loc">' + esc(r.key) + '</div><div class="c-desc">加载失败</div><div class="c-sub">' + esc(r.error) + '</div><div class="c-retry">点击重试</div></div>';
    const f = cardFields(r);
    return '<div class="ccard" data-key="' + esc(r.key) + '">' +
      '<div class="c-loc">' + esc(f.name) + '</div>' +
      '<div class="c-ic">' + svgIcon(f.icon) + '</div>' +
      '<div class="c-temp">' + f.temp + '</div>' +
      '<div class="c-desc">' + esc(f.desc) + '</div>' +
      '<div class="c-chart">' + miniChart(f.daily) + '</div>' +
      '<div class="c-meta">' + esc(f.range) + '</div>' +
      '<div class="c-sub">湿度 ' + esc(f.humidity) + ' · 风 ' + esc(f.wind) + '</div>' +
      '</div>';
  }).join('');
  el.compare.hidden = false;
  paintHome();
}
export function showCompareLoading(n) {
  el.compareGrid.innerHTML = skeletonCards(n);
  el.compare.hidden = false;
  paintHome();
}
export function closeCompareView() { el.compare.hidden = true; paintHome(); }
export function compareOpen() { return !el.compare.hidden; }
