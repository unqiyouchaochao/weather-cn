/* 自动刷新与收藏轮播：只有一个计时器归这里管。
 * 归属判据：**「下一轮该查谁」是它的事** —— 刷新间隔、轮播到第几座城、对比中刷对比。
 * 位置的自动重定位不在这里（在 locate.js，那份状态只有它认得），但每次重建计时器都要顺手重建它，
 * 所以入口仍然只有一个 setupAutoRefresh：设置面板保存、恢复默认、启动三处都只认这一个名字，
 * 免得有人重建了刷新忘了重建定位（那两个都读配置，漏一个是静默的错）。 */
import { loadConfig } from './lib/config.js';
import { loadFav } from './lib/favorites.js';
import { query, queryByKey, lastQuery, hasTarget, compareCities } from './query.js';
import { setupAutoLocate } from './locate.js';
import * as ui from './ui.js';

let refreshTimer = null, carouselIdx = 0;
export function setupAutoRefresh() {
  setupAutoLocate();
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  const sec = loadConfig().autoRefresh || 0;
  if (!sec) return;
  refreshTimer = setInterval(() => {
    /* 屏幕不在前台就什么都不做。这条是本轮省电的第一嫌疑：常驻通知那个前台服务把进程钉住了，
     * 于是这个 setInterval 在后台照样每 30/60/300 秒跑一遍「整屏重绘 + 写 localStorage + 敲原生桥」，
     * 而通知栏那条正文由原生那一拍独立负责（见 WeatherKeepAliveService），JS 这边白跑没有任何收益。
     * 上面 locateTimer 那道 `document.hidden` 闸门早就有了，这一条一直是漏的。 */
    if (document.hidden) return;
    const favs = loadFav();
    if (ui.compareOpen()) { compareCities(); return; }      // 对比中 → 刷新对比
    if (favs.length >= 2) {                                  // 轮播：依次展示收藏城市
      carouselIdx = (carouselIdx + 1) % favs.length;
      queryByKey(favs[carouselIdx]);
    } else if (hasTarget()) {
      query(lastQuery());                                    // 否则刷新当前
    }
  }, sec * 1000);
}
