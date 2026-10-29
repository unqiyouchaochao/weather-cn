/* 启动：把静态件灌好、把不依赖查询的东西先画出来，然后决定首屏查谁。
 * 归属判据：**只有它知道「开机的先后」**（图标要先灌成矢量才有人读按钮尺寸、
 * 计时器要在首屏那一发之前建好、hash 里带着对比链接时整条定位链都不用走）。
 * 事件接线不在这里 —— 那部分在 main.js。 */
import { hydrateIcons } from './lib/icons.js';
import { loadConfig } from './lib/config.js';
import { isNative } from './lib/locate.js';
import { queryByKey } from './query.js';
import * as rank from './ui/rank.js';
import * as fortune from './ui/fortune.js';
import * as news from './ui/news.js';
import * as ui from './ui.js';
import { buildSettings } from './settings/index.js';
import { rebuildThemeOptions } from './settings/appearance.js';
import { seedFromBundled } from './lib/themePlugin.js';
import { themeById } from './lib/themes.js';
import { maybeAutoLocate } from './locate.js';
import { setupAutoRefresh } from './refresh.js';
import { parseHashCompare } from './share.js';

/* ---------- PWA ---------- */
function registerSW() {
  // 原生壳里资源本就在设备上，SW 只会带来「App 更新了还端旧壳」的问题，一律不注册
  if (isNative()) return;
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 离线缓存失败不影响主功能 */ });
  }
}

export function init() {
  // markup 里那些 <span data-icon="…"> 先填成矢量，再往下才有人读按钮的尺寸
  hydrateIcons(document);
  const cfg = loadConfig();
  // 各设置分组自己的静态件（主题/口径下拉的选项、通知芯片、预警门槛、图标网格）由它们自己建，
  // 加一组不用回来动这里
  buildSettings();
  rank.init();
  ui.applyTheme(cfg.theme);
  ui.applyBg('sun');
  ui.renderFav();
  // 搜索框启动时不回填上次城市：查询成功后框里的字会被收回（见 ui/render.js），
  // 开着就显示成「搜过却没清」的样子；当前在哪儿由标题 + 经纬度那行说明。
  fortune.init();
  news.init();
  registerSW();
  setupAutoRefresh();
  // 预置主题包异步播，不挡首屏：它只往插件区加「可选项」，当前选中的那套不受它影响。
  // 播完要重灌主题下拉，否则列表里有 acme 这一套、下拉里却没有。
  seedFromBundled().then(r => {
    if (!r.seeded || !r.seeded.length) return;
    rebuildThemeOptions();
    // 报的是给人看的名字，不是插件 id：id 只在设置的主题插件区里当副标题用。
    // 认不到是插件就不换 —— themeById 兜底会返回内置第一套，直接拿它的 label 会说错话。
    const 名 = r.seeded.map(id => { const t = themeById(id); return t.plugin ? t.label : id; }).join('、');
    ui.showStatus('已启用安装包自带的主题：' + 名 + '（设置 → 主题插件 里可删除）');
  });
  if (parseHashCompare()) return;
  if (!maybeAutoLocate()) queryByKey(cfg.lastCity || '北京');
}
