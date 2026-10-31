/* 入口与接线表：把 lib / providers / query / ui 接起来，然后开机。
 * 分区规矩（2026-10-06 这一轮定的，与 js/ui.js 那一层同一形状）：
 *   这一层**只写"哪个控件上发生了什么"** —— 一个监听器配一行调用，函数体超过十几行就该问
 *   「这段状态归谁」，然后落到归属它的那个模块里：
 *     locate.js    设备定位/网络定位/回前台续查/每 30 秒重定位（只有它认得当前落点）
 *     suggest.js   搜索联想的防抖、在途请求、键盘高亮（只有它认得候选列表）
 *     refresh.js   自动刷新与收藏轮播（只有它认得"下一轮查谁"）
 *     tabs.js      底部三个板块的切换与各自的滚动位置
 *     share.js     对比链接 #compare= 的出与入
 *     favorite.js  收藏这一格：加、删、以及「落盘之后要同时重画栏与那颗星」那对重画
 *     settings/    设置面板：一条分组一个文件，注册表在 settings/index.js
 *     boot.js      开机的先后
 *   加一个新功能：先看它认得什么状态，落一个新文件；只有"接线"这一行回来改这里。
 * 为什么不再把实现写在本文件：767 行时有 73 个顶层函数挤在一起，两条会话各加一个功能就是在
 * 同一个位置改同一个文件，冲突全撞在这一份上（分区那一轮的直接动因）。
 * 改完任何 js/css/html 记得同步 sw.js 的 SHELL 并升 CACHE —— 新文件漏进清单，老用户拿到的是旧壳。 */
import { el } from './lib/dom.js';
import { svgIcon } from './lib/icons.js';
import { loadConfig, saveConfig } from './lib/config.js';
import { toggleTheme } from './lib/themes.js';
import { query, queryByKey, compareCities } from './query.js';
import * as rank from './ui/rank.js';
import * as ui from './ui.js';
import * as favorite from './favorite.js';
import { doLocate, onVisibility } from './locate.js';
import { setupAutoRefresh, stopAutoRefresh } from './refresh.js';
import * as suggest from './suggest.js';
import * as share from './share.js';
import { setTab } from './tabs.js';
import * as settings from './settings/index.js';
import { init } from './boot.js';

/* ---------- 收藏栏与按钮交互 ---------- */

function bindEvents() {
  el.brandIcon.innerHTML = svgIcon('sun');
  /* 定位那一拍自己清自己排（见 locate.js 的 onVisibility）；刷新这一拍由这里代劳 ——
   * 让它反过来 import refresh.js 就成环了，refresh.js 本来就要 setupAutoLocate。
   * 两边都走 setupAutoRefresh 这一个出口：它顺带按同一份配置重建定位那一拍。 */
  document.addEventListener('visibilitychange', () => {
    onVisibility();
    if (document.hidden) stopAutoRefresh(); else setupAutoRefresh();
  });

  el.searchBtn.addEventListener('click', () => { suggest.hideSuggest(); query({ city: el.cityInput.value }); });
  el.locBtn.addEventListener('click', () => doLocate(false));
  el.cityInput.addEventListener('input', suggest.onInput);
  el.cityInput.addEventListener('click', suggest.openSuggest);   // 再点一下就重新弹出候选
  el.cityInput.addEventListener('blur', suggest.onBlur);
  el.suggest.addEventListener('mousedown', suggest.onPick);
  el.cityInput.addEventListener('keydown', suggest.onKeydown);

  el.favBar.addEventListener('click', e => {
    const x = e.target.closest('.x');
    const chip = e.target.closest('.chip');
    if (x && chip) { favorite.remove(x.getAttribute('data-key')); return; }
    if (chip) queryByKey(chip.getAttribute('data-key'));
  });
  el.starBtn.addEventListener('click', favorite.toggleCurrent);

  el.compareBtn.addEventListener('click', () => compareCities());
  el.closeCompare.addEventListener('click', ui.closeCompareView);
  el.tabbar.addEventListener('click', e => {
    const b = e.target.closest('.tab');
    if (b) setTab(b.dataset.tab);
  });
  el.compareGrid.addEventListener('click', e => {
    const card = e.target.closest('.ccard');
    if (!card || !card.dataset.key) return;
    if (card.classList.contains('err')) { compareCities(); return; }   // 失败卡点击重试全部
    ui.closeCompareView();
    queryByKey(card.dataset.key);
  });
  el.exportCsv.addEventListener('click', ui.exportCSV);
  el.exportImg.addEventListener('click', ui.exportPNG);
  el.shareLink.addEventListener('click', share.shareCompare);

  // 点某天 → 小时条切到该天全天
  el.forecast.addEventListener('click', e => {
    const d = e.target.closest('.day.act');
    if (d && d.dataset.date) ui.dayClicked(d.dataset.date);
  });
  el.hourlyBack.addEventListener('click', ui.backToToday);

  el.darkBtn.addEventListener('click', () => {
    // 只做明暗对切；往哪一套切、两边各自记哪套，全在 lib/themes.js 的 toggleTheme（那里有实测记录）
    const c = loadConfig();
    Object.assign(c, toggleTheme(c));
    saveConfig(c);
    ui.applyTheme(c.theme);
  });

  el.openSettings.addEventListener('click', settings.openSettings);
  document.getElementById('closeSettings').addEventListener('click', settings.closeSettings);

  /* 空气质量卡 → 全国城市排名。只有走城市榜那一级才有榜可看（ui.airRank() 给得出），
   * 用 Open-Meteo 模型值兜底时没有榜，这时候卡不响应点击，也不摆可点的样子。 */
  el.air.addEventListener('click', () => {
    const r = ui.airRank();
    if (r) rank.open(r.city);
  });
  /* Esc 关掉全屏子视图（键盘用户 / 外接键盘） */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    backOneLevel();
  });

  /* 系统返回键 / 全面屏手势：一级一级往回退，全关着才真退出。
   * 注册监听会让 Capacitor 把返回事件整个交给 JS（原生默认是直接 finish），
   * 所以最后那句 exitApp 不能省，否则返回键变成「按了没反应」。
   * 实测过没装 @capacitor/app 之前：排名浮层开着按返回 = 直接退回桌面。 */
  const capApp = window.Capacitor && window.Capacitor.Plugins ? window.Capacitor.Plugins.App : null;
  if (capApp && typeof capApp.addListener === 'function') {
    capApp.addListener('backButton', () => {
      if (!backOneLevel()) capApp.exitApp();
    });
  }

  el.modal.addEventListener('click', e => { if (e.target === el.modal) settings.closeSettings(); });
  el.providerSel.addEventListener('change', settings.resync);
  /* 通知与预警那两栏的提示按「用过没有」收起，开关一拨就得重算 —— 不绑这两下的话，
   * 把常驻通知关掉之后那句说明不会自己回来，要等下一次打开面板才改口。 */
  el.notifyOn.addEventListener('change', settings.resync);
  el.alertOn.addEventListener('change', settings.resync);
  /* 口径那一栏也要重画声明：第一条讲的是「当前口径」，不跟着改就会挂着上一套的说法。 */
  el.aqiStdSel.addEventListener('change', settings.onStdChange);
  el.saveBtn.addEventListener('click', settings.saveSettings);
  el.resetBtn.addEventListener('click', settings.resetSettings);
  window.addEventListener('hashchange', share.parseHashCompare);
}

/* 「往回退一级」的层级顺序只有一处定义：排名浮层 → 设置面板 → 都不在场时交给调用方真退出。
 * 两条出口（Esc 键与系统返回键）以前各写一遍，改一个忘另一个就是「键盘能退、返回键直接退出应用」。 */
function backOneLevel() {
  if (rank.isOpen()) { rank.close(); return true; }
  if (!el.modal.hidden) { settings.closeSettings(); return true; }
  return false;
}

bindEvents();
init();
