/* 设置分组「桌面图标」：整组只在壳里出现（lib/appicon.js 的 iconSupported() 说了算）。
 * 每次打开设置都重新问一次原生「现在是哪套」，而不是只在启动时读一次 —— 生效状态以原生回的那个
 * 名字为准：万一四个入口被 ROM 关干净，getIcon() 会自愈成默认，界面也跟着回到默认，
 * 不会出现「界面上显示选了 A、桌面上其实是 B」。
 * 网格与监听只建一次（openSettings 会被反复调用）。 */
import { el } from '../lib/dom.js';
import * as ui from '../ui.js';
import { ICON_CHOICES, iconSupported, currentIcon, applyIcon, iconLabel } from '../lib/appicon.js';

let iconBuilt = false;
const mark = id => [].slice.call(el.iconGrid.children).forEach(n => n.classList.toggle('on', n.dataset.id === id));

/* 网格与监听只建一次（openSettings 会被反复调用，重铺一遍会把监听叠成两份） */
function buildGrid() {
  if (iconBuilt) return;
  iconBuilt = true;
  el.iconGrid.innerHTML = ICON_CHOICES.map(c =>
    '<button type="button" class="ic-thumb" data-id="' + c.id + '" title="' + c.label + '">' +
    '<svg viewBox="0 0 108 108" width="46" height="46" aria-hidden="true" style="background:' + c.bg + ';color:' + c.ink + '">' + c.art + '</svg>' +
    '<span>' + c.label + '</span></button>').join('');
  el.iconGrid.addEventListener('click', e => {
    const b = e.target.closest('.ic-thumb');
    if (!b) return;
    applyIcon(b.dataset.id)
      .then(id => { mark(id); ui.showStatus('桌面图标已切到「' + iconLabel(id) + '」（桌面那一枚可能过一会儿才刷新）'); })
      .catch(err => ui.showStatus('换图标失败：' + ((err && err.message) || err), true));
  });
}
function syncIconUI() {
  /* 不支持就把它收回去 —— 原来只在不支持时 early return，从不 hidden=true：
   * 一次「先支持、后不支持」之间那组会一直留在屏上（回归里假原生插件跑完就是这一形状，
   * 2026-10-15 由那条「三组整组不画」的断言抓出来）。与通知/预警那两组同一写法。 */
  if (!iconSupported()) { el.iconGroup.hidden = true; return; }
  el.iconGroup.hidden = false;
  buildGrid();
  currentIcon().then(id => { if (id) mark(id); });
}

export default {
  /* 启动时只把网格建好，**不敲原生**：那一发 currentIcon() 是实打实的 WebView→Java 往返，
   * 而用户可能从头到尾不打开设置。「现在是哪套」由 fill() 每次开面板时问 —— 那才是需要它的时刻，
   * 上面注释里「以原生回的名字为准」那条要求一点没让步。 */
  build() { if (iconSupported()) buildGrid(); },
  fill() { syncIconUI(); }
};
