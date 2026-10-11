/* 设置分组「行为与自动化」：启动时是否自动定位、自动刷新/轮播的间隔。
 * 这一组只读写配置，计时器不归它 —— 落盘之后由注册表走 saveSettings 里那一次 setupAutoRefresh
 * （js/refresh.js），这样"改了间隔却没重建计时器"只可能发生在同一个地方。 */
import { el } from '../lib/dom.js';

export default {
  fill(cfg) {
    el.autoLocate.checked = !!cfg.autoLocate;
    el.autoRefresh.value = String(cfg.autoRefresh || 0);
  },
  read(cfg) {
    cfg.autoLocate = !!el.autoLocate.checked;
    cfg.autoRefresh = parseInt(el.autoRefresh.value, 10) || 0;
  }
};
