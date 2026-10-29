/* 收藏这一格的归属：只有它知道「收藏变了，屏上要跟着改哪两样」。
 * 为什么单独一个文件：以前「写盘 + 重画收藏栏 + 重画那颗星」这三步在 main.js 里写了两遍
 * （星那颗钮一遍、收藏栏上那枚 ✕ 一遍），设置里「恢复默认」清完收藏又是第三遍同样的两句。
 * 少跟一处就是「栏里还挂着那枚标签、星已经灭了」或反过来那种错 —— 而这三处原先一条断言都没盯。
 * 判据照旧：**改这件事的人不需要读第二件事**。取数与渲染都不在这里，这里只管落盘与对齐界面。 */
import { loadFav, saveFav } from './lib/favorites.js';
import { currentKey } from './query.js';
import * as ui from './ui.js';

/* 收藏栏与那颗星是同一本账的两个投影，必须一起重画。 */
export function repaintFav() {
  ui.renderFav();
  ui.setStar(currentKey());
}

/** 星那颗钮：把当前查询的目标加进收藏，或从收藏里去掉。还没查出目标时什么都不做。 */
export function toggleCurrent() {
  const k = currentKey();
  if (!k) return;
  const arr = loadFav();
  const i = arr.indexOf(k);
  if (i >= 0) arr.splice(i, 1); else arr.push(k);
  saveFav(arr);
  repaintFav();
}

/** 收藏栏上那一枚 ✕：删的是被点的那一枚，不是当前正在看的那座城。 */
export function remove(key) {
  if (!key) return;
  saveFav(loadFav().filter(k => k !== key));
  repaintFav();
}
