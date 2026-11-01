/* 底部菜单那三个板块（天气 / 运势 / 新闻）的切换。
 * 归属判据：**只有它知道「现在在哪个板块、每个板块滚到哪儿了」**。
 * 板块自己的内容不在这里（fortune.js / news.js 各管各的），这里只管切过去要做什么、往哪儿切。
 *
 * 动效一行都不在这里：整块容器的滑入写在 13-transition.css，要不要动由那条 reduced-motion 说了算，
 * 数字与两轮对拍的结论也记在那一片里，不在这儿抄第二遍。
 * 以前这里是 JS 主导 —— document.startViewTransition 播「推入」，回退路径还得先摘类名、强制一次重排、
 * 再挂回去，还要自己问 matchMedia。那些都不需要了：容器每次从 display:none 回到在场，
 * 浏览器自动重放它身上的 animation，方向只剩一个类名。 */
import { el } from './lib/dom.js';
import * as fortune from './ui/fortune.js';
import * as news from './ui/news.js';

const TAB_ORDER = ['weather', 'fortune', 'news'];
const scrollByTab = { weather: 0, fortune: 0, news: 0 };
function applyTab(id) {
  document.body.dataset.tab = id;
  Array.prototype.forEach.call(el.tabbar.children, b =>
    b.setAttribute('aria-selected', String(b.dataset.tab === id)));
  /* 进板块一律调 render：应用可能整夜开着，跨天与跨节气之后干支、运势文案必须换成新的一天。
   * 但「要不要真的重画」由板块自己判（fortune 比它算出来的那把键，news 比取数层那份还在不在 TTL 里）——
   * 来回切板块时省掉的就是「把已经画对的东西擦掉再建一遍」那一笔布局。 */
  if (id === 'fortune') fortune.render();
  // 新闻的取数在 lib/news.js 里另有 5 分钟缓存，切来切去不会反复打别人的接口
  if (id === 'news') news.render(false);
  window.scrollTo(0, scrollByTab[id] || 0);
}
export function setTab(id) {
  const from = TAB_ORDER.indexOf(document.body.dataset.tab), to = TAB_ORDER.indexOf(id);
  if (to < 0 || to === from) return;
  scrollByTab[document.body.dataset.tab] = window.scrollY;
  // 方向只留一个类名，位移曲线与时长都在 CSS 里
  document.body.classList.toggle('sw-fwd', to > from);
  document.body.classList.toggle('sw-back', to < from);
  applyTab(id);
}
