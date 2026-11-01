/* 视图层的**唯一入口**：所有 DOM 渲染。只依赖 lib / charts / dom / providers，不反向依赖 query，
 * 需要「当前收藏键」之类的数据一律由调用方当参数传进来，避免循环 import。
 *
 * 2026-10-06 分区：实现搬进 `js/ui/<归属>.js`，这里只挂名字。规矩写在挂之前——
 *   ① 加一种新东西 = 在 `js/ui/` 里开一个自己的文件，然后**回这里加一行**；不要往邻居文件里插函数。
 *   ② 一个内部文件只管一件事（状态行 / 三态 / 小时格 / 预警 / 空气 / 标题 / 主视图 / 对比 / 导出 / 主题与底），
 *      判据是「改这件事的人不需要读第二件事」。
 *   ②b 板块级的那四件（`ui/fortune.js`·`ui/news.js`·`ui/rank.js`·`ui/charts.js`，2026-10-07 并进 ui/）
 *      **不挂进这份门面**，调用方直接 `import * as rank from './ui/rank.js'`：一个板块本来就一个文件，
 *      门面治的「两条会话往同一处插函数」在它们身上不存在，多一行 re-export 只是多一处要跟着改的地方。
 *   ③ 内部文件之间可以互相 import（render → home/status/alerts…），但**不许 import 回这份入口**，
 *      那会绕成一个环。
 *   ④ 为什么留这一层薄壳而不是让调用方各取各家：调用方是 `import * as ui`（main.js、query.js）
 *      加回归里十几处动态 import；真拆到调用点会让 `tests/app.checks.mjs`（多条会话共同的热点）大动，
 *      收益却只是省一行 re-export。这一层不写逻辑，所以它不会成为冲突的现场。
 * ⚠ 新增内部文件要同时进 `sw.js` 的 SHELL 清单并升一次 CACHE —— 漏了的话离线打开就是白屏。 */
export { applyBg, applyTheme } from './ui/theme.js';
export { showStatus, pinStatus, unpinStatus, hideStatus, setCoords, setSyncing } from './ui/status.js';
export { showSkeleton, showData, showError, homeState, skeletonCards, resetHome } from './ui/home.js';
export { setPlace } from './ui/place.js';
export { loadToday, clearToday, dayClicked, backToToday } from './ui/hours.js';
export { clearAlerts, renderAlerts } from './ui/alerts.js';
export { clearAir, airRank, loadAir } from './ui/air.js';
export { render, renderError, renderFav, setStar } from './ui/render.js';
export { cardFields, renderCompare, showCompareLoading, closeCompareView, compareOpen } from './ui/compare.js';
export { exportCSV, exportPNG } from './ui/export.js';
