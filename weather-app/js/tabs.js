/* 底部菜单那三个板块（天气 / 运势 / 新闻）的切换。
 * 归属判据：**只有它知道「现在在哪个板块、每个板块滚到哪儿了」**。
 * 板块自己的内容不在这里（fortune.js / news.js 各管各的），这里只管切过去要做什么、怎么切得看不出来。 */
import { el } from './lib/dom.js';
import * as fortune from './ui/fortune.js';
import * as news from './ui/news.js';

const TAB_ORDER = ['weather', 'fortune', 'news'];
const scrollByTab = { weather: 0, fortune: 0, news: 0 };
const EASE = 'cubic-bezier(.32,.72,.24,1)';
function applyTab(id) {
  document.body.dataset.tab = id;
  Array.prototype.forEach.call(el.tabbar.children, b =>
    b.setAttribute('aria-selected', String(b.dataset.tab === id)));
  // 每次进板块都重算一遍：应用可能整夜开着，跨天后今日干支与运势文案必须换成新的一天
  if (id === 'fortune') fortune.render();
  // 新闻只在进板块时才拉，且 lib/news.js 里有 5 分钟缓存，切来切去不会反复打别人的接口
  if (id === 'news') news.render(false);
  window.scrollTo(0, scrollByTab[id] || 0);
}
function swapView(fn, dir) {
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { fn(); return; }
  const root = document.documentElement;
  // 自定义属性会继承进 view-transition 伪元素树，方向就靠这两个变量传给 CSS
  root.style.setProperty('--vt-out', 'vt-out-' + dir + ' .3s ' + EASE + ' both');
  root.style.setProperty('--vt-in', 'vt-in-' + dir + ' .3s ' + EASE + ' both');
  if (!document.startViewTransition) {
    fn();
    document.body.classList.remove('sw-fwd', 'sw-back');
    void document.body.offsetWidth;                   // 强制重排，否则同名动画不重放
    document.body.classList.add(dir === 'fwd' ? 'sw-fwd' : 'sw-back');
    return;
  }
  document.startViewTransition(fn);
}
export function setTab(id) {
  const from = TAB_ORDER.indexOf(document.body.dataset.tab), to = TAB_ORDER.indexOf(id);
  if (to < 0 || to === from) return;
  scrollByTab[document.body.dataset.tab] = window.scrollY;
  swapView(() => applyTab(id), to > from ? 'fwd' : 'back');
}
