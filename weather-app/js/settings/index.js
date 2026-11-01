/* 设置面板的注册表：一条设置分组 = `js/settings/` 里的一个文件 + GROUPS 里的一行。
 * 分组接口（都可选，按你这一组需要哪几步）：
 *   build(cfg)  启动时一次，生成静态件（下拉选项、芯片网格）
 *   fill(cfg)   打开面板：配置 → 控件
 *   read(cfg)   保存：控件 → 配置。**校验不通过就自己报状态并 return false**，整次保存作废
 *   sync()      换了数据源（含每次打开面板）：把依赖这一家的说法/显隐重算一遍
 *   syncStd()   换了空气质量口径
 *   saved(cfg)  saveConfig 落盘之后（通知栏那种「立刻生效」的动作归这一组自己管）
 * 为什么要有这张注册表：以前加一组要往同一个 767 行文件里插一段 fill、一段 read、一段 hint，
 * 两条会话各加一组就在同一个位置改同一处；现在各自新增一个文件，GROUPS 那一行是唯一共享点。
 * 面板的 DOM 结构不在这里（在 index.html），顺序也只由 markup 决定。 */
import { el } from '../lib/dom.js';
import { loadConfig, saveConfig, DEFAULT_CFG } from '../lib/config.js';
import { queryByKey } from '../query.js';
import { closeSheet, openSheet } from '../lib/sheet.js';
import * as ui from '../ui.js';
import { setupAutoRefresh } from '../refresh.js';
import * as favorite from '../favorite.js';

import source from './source.js';
import appearance from './appearance.js';
import themePlugins from './themePlugins.js';
import behavior from './behavior.js';
import notify from './notify.js';
import alerts from './alerts.js';
import icon from './icon.js';
import disclosures from './disclosures.js';

/* 顺序由 markup 决定，这里只跟着排 —— 见 index.html 里那几个 fieldset 的先后。
 * themePlugins 紧跟 appearance：它俩共用那个主题下拉（导入/删除后要重灌选项）。 */
const GROUPS = [source, appearance, themePlugins, behavior, notify, alerts, icon, disclosures];

export function buildSettings() {
  const cfg = loadConfig();
  GROUPS.forEach(g => g.build && g.build(cfg));
}

export function openSettings() {
  const cfg = loadConfig();
  GROUPS.forEach(g => g.fill && g.fill(cfg));
  // sync 必须在所有 fill 之后：这一组重算的是「面板里当前选中的那一家」，控件还没灌新值就白算
  GROUPS.forEach(g => g.sync && g.sync());
  // 走 openSheet 而不是直接 hidden=false：见 lib/sheet.js 那两条实测
  openSheet(el.modal);
  // v100 之后整张卡片不再自己滚，只有 .modal-body 滚，而面板 DOM 一直活着 —— 没人归零过它，
  // 于是滚到底关掉再开就落在最下面那组（2026-10-02 红米装机看到的）。**必须在 openSheet 之后**：
  // 面板 hidden 时那子树没有盒子，`scrollTop = 0` 写不进去（回归里就是这么红出来的）。
  el.modalBody.scrollTop = 0;
}
export function closeSettings() { closeSheet(el.modal); }   // 播完退场才 hidden，见 lib/sheet.js

/* 面板里「当前是哪一家、哪几个开关开着」变了都要重算各组的说明，所以这一把不只给数据源用：
 * 通知与预警那两栏的提示按「用过没有」显隐，开关那一拨也得走这里。 */
export function resync() { GROUPS.forEach(g => g.sync && g.sync()); }
export function onStdChange() { GROUPS.forEach(g => g.syncStd && g.syncStd()); }

export function saveSettings() {
  const cfg = loadConfig();
  // 任一组 return false 就整次保存作废：控件上的值没落盘，界面也不关，用户看得见那一行报错
  for (const g of GROUPS) if (g.read && g.read(cfg) === false) return;
  saveConfig(cfg);
  GROUPS.forEach(g => g.saved && g.saved(cfg));
  /* 走 closeSettings 而不是 `el.modal.hidden = true`：背景滚动锁归 sheet.js 管，
   * 直接改 hidden 会让那一层永远留在"在场"里，锁就再也解不掉（2026-10-01 回归当场红出来）。
   * 顺带保存之后也有那条退场动画，和点 ✕ 关掉是同一个出口。 */
  closeSettings();
  ui.applyTheme(cfg.theme);
  setupAutoRefresh();
  ui.clearAir();          // 旧口径的 AQI 数字不能留在卡上等新一轮覆盖，见 js/ui/air.js
  ui.showStatus('已保存，正在用新设置重新查询…');
  queryByKey(loadConfig().lastCity || '北京');
}

export function resetSettings() {
  saveConfig(JSON.parse(JSON.stringify(DEFAULT_CFG)));
  ui.applyTheme(DEFAULT_CFG.theme);
  favorite.repaintFav();   // 收藏被一起清掉了，不重渲染会留下点不动的旧标签（这一对为什么写在一处，见 js/favorite.js）
  openSettings();
  setupAutoRefresh();      // 轮播/刷新间隔也回到默认，否则旧计时器还在跑
  ui.clearAir();
  ui.showStatus('已恢复默认（Open-Meteo）');
  queryByKey(DEFAULT_CFG.lastCity);   // 否则界面还停在旧数据源渲染出的卡片上
}
