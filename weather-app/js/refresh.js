/* 自动刷新与收藏轮播：只有一个计时器归这里管。
 * 归属判据：**「下一轮该查谁」是它的事** —— 刷新间隔、轮播到第几座城、对比中刷对比。
 * 位置的自动重定位不在这里（在 locate.js，那份状态只有它认得），但每次重建计时器都要顺手重建它，
 * 所以入口仍然只有一个 setupAutoRefresh：设置面板保存、恢复默认、启动三处都只认这一个名字，
 * 免得有人重建了刷新忘了重建定位（那两个都读配置，漏一个是静默的错）。 */
import { effectiveRefresh } from './lib/config.js';
import { loadFav } from './lib/favorites.js';
import { el } from './lib/dom.js';
import { query, queryByKey, lastQuery, hasTarget, compareCities } from './query.js';
import { setupAutoLocate } from './locate.js';
import * as ui from './ui.js';

let refreshTimer = null, carouselIdx = 0;
/** 一拍该干什么。计时器与回归都调这一个函数 —— 闸门写在里面，「面板开着不重画」
 *  与「不在天气那一页不重画」这两道才不用等满一个刷新间隔才量得到。 */
export function refreshTick() {
  /* 屏幕不在前台就什么都不做。这条是本轮省电的第一嫌疑：常驻通知那个前台服务把进程钉住了，
   * 于是这个 setInterval 在后台照样每 30/60/300 秒跑一遍「整屏重绘 + 写 localStorage + 敲原生桥」，
   * 而通知栏那条正文由原生那一拍独立负责（见 WeatherKeepAliveService），JS 这边白跑没有任何收益。
   * 上面 locateTimer 那道 `document.hidden` 闸门早就有了，这一条一直是漏的。 */
  if (document.hidden) return;
  /* 面板开着、或人已经切到「运势」「新闻」那一页：这一拍重画的是屏上看不见的东西 ——
   * #weatherView 藏在 display:none 的子树里，照样被整块 innerHTML 重建一遍。
   * 这里只挡活、不重排闹钟：面板与标签都是几秒钟的状态，为它们来回拆表更容易出错；
   * 真正该拆的是「退到后台」，那一档由 stopAutoRefresh 做（见 main.js 的 visibilitychange）。 */
  if (!el.modal.hidden || document.body.dataset.tab !== 'weather') return;
  const favs = loadFav();
  if (ui.compareOpen()) { compareCities(); return; }      // 对比中 → 刷新对比
  if (favs.length >= 2) {                                  // 轮播：依次展示收藏城市
    carouselIdx = (carouselIdx + 1) % favs.length;
    queryByKey(favs[carouselIdx]);
  } else if (hasTarget()) {
    query(lastQuery());                                    // 否则刷新当前
  }
}
export function setupAutoRefresh() {
  setupAutoLocate();
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  const sec = effectiveRefresh();
  if (!sec) return;
  refreshTimer = setInterval(refreshTick, sec * 1000);
}
/** 把闹钟**真拆掉**，而不是留着让回调自己判断。
 *  常驻通知那个前台服务会钉住进程，于是 `document.hidden` 那道闸只挡得住活、挡不住每一拍的唤醒：
 *  15 秒一档就是一小时 240 次空唤醒，全在用户看不见屏幕的时候。回前台由 main.js 再叫一次
 *  setupAutoRefresh —— 重排只有那一个出口，顺带把定位那一拍也按同一份配置重建。 */
export function stopAutoRefresh() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}
/** 闹钟此刻在不在。界面不读它 —— 回归要靠它问「退后台那一发到底把表拆了没有」，
 *  而那件事除了等满一个间隔之外没有别的观测点，等满一个间隔不该是一条测试。 */
export function refreshArmed() { return !!refreshTimer; }
