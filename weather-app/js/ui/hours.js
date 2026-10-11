/* 今日天气那一栏的 24 格（以及点逐日卡下钻到别的一天）。
 * 谁可以改我：改「格子怎么画、哪一格算已过」的人。**取哪一家的逐小时**不在这里，在 lib/hourly.js。 */
import { el } from '../lib/dom.js';
import { esc, hhmm } from '../lib/util.js';
import { svgIcon } from '../lib/icons.js';
import { fmtTemp } from '../lib/config.js';
import { dayLabel } from './charts.js';
import { todayHours } from '../lib/hourly.js';

// hourRows = 今天那一天的格子；viewDay 非空时改显示逐日卡点进来的那一天
let hourRows = [], hourlyByDay = {}, viewDay = null, hourNow = '', hourSrc = '', hourStep = 0;
/* 这条链和 AQI 那条一样是**异步且没有取消**的：先搜 A 再搜 B，A 那一发逐小时可能比 B 晚回来。
 * 没有令牌它就会盖在 B 的卡上 —— 数字是 A 城的、标题是 B 城，正是最不该出现的一种错（宁缺勿错）。 */
let hourSeq = 0;

/* 「已过 / 现在」只敢在源给了**该地**此刻（current.time）的时候标。没给就一格都不标 ——
 * 拿浏览器时钟去标别处的「现在」会整排标错（搜东京时本机可能才早上）。 */
function hourState(t) {
  if (!hourNow) return '';
  const k = String(t).slice(0, 13);
  return k === hourNow ? ' now' : (k < hourNow ? ' past' : '');
}
function hideHours() {
  el.hourlyWrap.hidden = true;
  el.hourly.innerHTML = '';
  if (el.hourlyBack) el.hourlyBack.hidden = true;
  if (el.hourlySrc) el.hourlySrc.hidden = true;
}
function renderHours(list, scopeText) {
  if (!list || !list.length) { hideHours(); return; }
  el.hourlyWrap.hidden = false;
  if (el.hourlyScope) el.hourlyScope.textContent = scopeText;
  if (el.hourlyBack) el.hourlyBack.hidden = !viewDay;
  if (el.hourlySrc) {                       // 只有退到第二个源时才需要写出处；当前源自己给的不重复标
    el.hourlySrc.hidden = !hourSrc;
    el.hourlySrc.textContent = hourSrc ? '逐小时：' + hourSrc : '';
    el.hourlySrc.title = hourSrc ? '当前数据源不提供逐小时预报，这一栏的数来自 ' + hourSrc : '';
  }
  el.hourly.innerHTML = list.map(h => {
    const st = hourState(h.time);
    // 下雨：有降水概率就报概率（预报口径），没概率才报降水量（毫米）—— 两个都缺就不占行
    const rain = h.precipProb != null ? esc(h.precipProb) + '%'
      : (h.precip != null && h.precip > 0 ? (h.precip < 10 ? h.precip.toFixed(1) : Math.round(h.precip)) + 'mm' : '');
    return '<div class="hr' + st + '" title="' + esc(h.desc || '') + (st === ' past' ? '（该时段已过）' : '') + '">' +
      '<div class="hr-t">' + (st === ' now' ? '现在' : esc(hhmm(h.time))) + '</div>' +
      '<div class="hr-ic">' + svgIcon(h.icon) + '</div>' +
      '<div class="hr-temp">' + fmtTemp(h.temp) + '</div>' +
      '<div class="hr-desc">' + esc(h.desc || '') + '</div>' +
      '<div class="hr-pop">' + rain + '</div>' +
      '</div>';
  }).join('');
  Array.prototype.forEach.call(el.forecast.querySelectorAll('.day'), d => {
    d.classList.toggle('sel', !!viewDay && d.dataset.date === viewDay);
  });
  markDrillable();
}
/* 「能不能下钻到当天逐小时」不能在建卡那一刻定死 —— 格子这一栏是异步的（当前源没给逐小时时
 * 还要另问一家），建卡时 hourlyByDay 常常还是空的，于是首屏每张日卡都点不动，
 * 要等下一次查询才「自己好了」。改成格子一到就重盖一次章。 */
function markDrillable() {
  Array.prototype.forEach.call(el.forecast.querySelectorAll('.day'), d => {
    const list = d.dataset.date && hourlyByDay[d.dataset.date];
    const can = !!(list && list.length > 1);
    d.classList.toggle('act', can);
    if (can) d.title = '查看当天逐小时'; else d.removeAttribute('title');
  });
}
function showHours() {
  /* 窗口标题必须与格子的实际档位一致：wttr.in 那一路每天只给 8 档（3 小时一档），
   * 还写「今天 00–23 时」就是栏目比内容宽（2026-10-01 体检挑出来的）。间隔由 lib/hourly.js 量出来。 */
  const coarse = hourStep > 1 ? ' · 每 ' + hourStep + ' 小时一档' : '';
  if (viewDay && hourlyByDay[viewDay]) {
    renderHours(hourlyByDay[viewDay], dayLabel(viewDay) + ' 全天（' + viewDay.slice(5).replace('-', '/') + '）' + coarse);
  } else {
    viewDay = null;
    renderHours(hourRows, '今天 00–23 时' + coarse);
  }
}
/** 今天 24 格由 lib/hourly.js 决定用哪个源（当前源给得出就用它，否则退 Open-Meteo 并标出处）。
 *  keepVisible=true 是同一目标原地刷新：旧格子留在原地等新的覆盖，否则每半分钟闪一次空白。
 *  换城市时必须收 —— 上一座城的小时挂在屏幕上等于拿别处的数糊弄。 */
export function loadToday(provider, lat, lon, data, keepVisible) {
  const seq = ++hourSeq;
  if (!keepVisible) { hideHours(); hourRows = []; hourlyByDay = {}; viewDay = null; hourStep = 0; }
  todayHours(provider, lat, lon, data).then(res => {
    if (seq !== hourSeq) return;
    if (!res) { hideHours(); return; }              // 拿不到就整块收起，不留一张空卡
    hourRows = res.hours;
    hourlyByDay = res.byDay || {};
    hourNow = res.nowAt ? String(res.nowAt).slice(0, 13) : '';
    hourSrc = res.fallback ? res.src : '';
    hourStep = res.step || 0;
    viewDay = null;
    showHours();
  }).catch(() => { if (seq === hourSeq) hideHours(); });
}
export function clearToday() { ++hourSeq; hideHours(); hourRows = []; hourlyByDay = {}; viewDay = null; }
// 点日卡 → 小时条切到该天全天，再点收起
export function dayClicked(date) {
  if (!hourlyByDay[date]) return;
  viewDay = (viewDay === date) ? null : date;
  showHours();
  if (viewDay) el.hourlyWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
export function backToToday() { viewDay = null; showHours(); }
