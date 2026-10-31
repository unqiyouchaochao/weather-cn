/* 气象预警卡。数据在天气那一发报文里，不另外请求（为什么这么选、以及另一条路的代价，
 * 见 lib/alerts.js 顶部）。谁可以改我：改「一条预警怎么画、什么条件下说话」的人。 */
import { el } from '../lib/dom.js';
import { esc } from '../lib/util.js';
import { loadConfig, DEFAULT_CFG } from '../lib/config.js';
import { providerLabel } from '../providers/index.js';
import { pushAlerts } from '../lib/notify.js';
import * as alerts from '../lib/alerts.js';

let lastAlertKey = null;
/* 没有预警就整块收起：这个源只报「本站」的状况，说不出「附近也没有」，
 * 所以宁可不说话，也不写一句会被理解成「全城平安」的空状态。 */
export function clearAlerts() {
  el.alertWrap.hidden = true;
  el.alertScope.textContent = '';
  el.alertList.innerHTML = '';
  lastAlertKey = null;
}
export function renderAlerts(data, keepVisible, providerId) {
  const list = alerts.listFrom(data);
  const key = list.map(a => a.id + '|' + a.rank).join(',');
  if (key === lastAlertKey && keepVisible) return;    // 原地刷新且内容没变：一行都不重画
  lastAlertKey = key;
  if (!list.length) { clearAlerts(); return; }
  el.alertWrap.hidden = false;
  /* 出处跟着发这条信号的源走。以前这里写死「中央气象台 · 中国天气」，选中不给预警的那一家之后卡片还挂着
   * 别家的名字 —— 数字没错，出处错了，在这一屏上就是骗人（宁缺勿错）。 */
  el.alertScope.textContent = list[0].src || providerLabel(providerId || loadConfig().provider);
  el.alertList.innerHTML = list.map(a =>
    '<details class="alert-item" style="--al:' + a.color + '">' +
      '<summary><i class="al-dot"></i>' +
        '<span class="al-name">' + esc(a.name + (a.levelName ? ' ' + a.levelName : '')) + '</span>' +
        '<span class="al-area">' + esc(a.title || '') + '</span>' +
        '<span class="al-time">' + esc(a.issuedAt) + '</span>' +
      '</summary>' +
      '<p class="al-text">' + esc(a.text || '') + '</p>' +
      (a.guide ? '<p class="al-guide"><b>防御指南</b>' + esc(a.guide) + '</p>' : '') +
    '</details>').join('');
  const ac = loadConfig().alert || {};
  if (ac.on !== false) pushAlerts(list, ac.min == null ? DEFAULT_CFG.alert.min : ac.min);
}
