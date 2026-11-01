/* 首页的三态：等结果（骨架屏）/ 有结果 / 什么都没查到（空状态卡）。
 * 这三块的可见性**只有 paintHome 一处会改**，别处只负责说「要哪一态」。
 * 谁可以改我：加一态、或改「原地刷新时闪不闪」的人。 */
import { el } from '../lib/dom.js';
import { svgIcon } from '../lib/icons.js';

/* 以前只有前两态有落点：showSkeleton 把 #result 藏起来、render 成功再掀开，而 renderError
 * 只记得收骨架屏 —— 于是一次失败的查询把整页留在 hidden 上（2026-10-02 那次冷启动空白就是它），
 * 「什么都没有」这一态压根没地方说话，报错只能挤在状态行那一格，还被钉住的定位提示盖掉。 */
let home = 'wait';       // 'wait' 骨架屏 / 'data' 结果区 / 'none' 空状态卡
let hasData = false;     // 这一屏有过数据就一直算有过：同一座城刷新失败时旧数字留在原地等覆盖
export function paintHome() {
  const cmp = !el.compare.hidden;   // 对比视图盖在首页之上，三态全让位
  el.loading.hidden = cmp || home !== 'wait';
  el.result.hidden = cmp || home !== 'data';
  el.emptyState.hidden = cmp || home !== 'none';
  // 「数据源：—」那一行只在真有结果时才有意义：空状态卡下面挂着一条说不清来源的标签，
  // 读起来像「这家的数据就是空的」，而实际上一发都没取到。
  el.providerTag.hidden = home !== 'data';
}
export function showSkeleton() {
  el.loading.innerHTML =
    '<div class="sk-card">' +
    '<div class="sk sk-loc"></div>' +
    '<div class="sk sk-temp"></div>' +
    '<div class="sk sk-meta"></div>' +
    '</div>' +
    '<div class="details">' + Array(4).fill('<div class="sk sk-dt"></div>').join('') + '</div>' +
    '<div class="hourly">' + Array(8).fill('<div class="sk sk-hr"></div>').join('') + '</div>' +   // 与真实版式同序：详情之后、今日天气
    '<div class="forecast">' + Array(7).fill('<div class="sk sk-day"></div>').join('') + '</div>';
  home = 'wait';
  paintHome();
}
export function showData() { hasData = true; home = 'data'; paintHome(); }
/**
 * 一次查询失败的落点：屏上有过数据就留在那儿（配状态行的报错，等同一座城的新一批覆盖），
 * 什么都没查到过才动用空状态卡 —— 它的文字与重试入口自带，不跟状态行抢那一格。
 */
export function showError(msg, retryFn) {
  home = hasData ? 'data' : 'none';
  if (home === 'none') {
    el.emptyIcon.innerHTML = svgIcon('cloud');
    el.emptyMsg.textContent = '没取到天气：' + msg;
    el.emptyRetry.hidden = !retryFn;
    el.emptyRetry.onclick = retryFn || null;
  }
  paintHome();
}
export function homeState() { return home; }
export function hadData() { return hasData; }

/* 回归专用：把这一屏退回「从来没查到过东西」那一态，并**交回一个还原函数**。
 * 「什么都没查到」在活页面上本来够不着 —— hasData 一旦为真就回不去。以前测试是换一个
 * `ui.js?v101` 的模块实例来拿到初始状态；视图层拆成多个文件之后那招会静默失效
 * （ESM 只会重建带 query 的那一个模块，`?v101` 的 render 仍然 import 不带 query 的本模块，
 * 看到的还是 hasData=true）。所以把「复位」明说出来，比依赖模块实例身份可靠。
 * ⚠ 生产代码里没有第二个调用方，也不该有：正常运行时这一屏不会「退回没查过」。
 * 还原必须调用 —— 后面几条判据的前提正是「屏上已经有数据」，不还就等于把上一场的状态留给了下一场。 */
export function resetHome() {
  const 上一态 = home, 上一有 = hasData;
  home = 'wait'; hasData = false; paintHome();
  return () => { home = 上一态; hasData = 上一有; paintHome(); };
}

/* 值真的变了才写、才闪：不然是白闪一下，比不提示更烦。class 无论这次闪不闪都要先摘干净，
 * 否则上一次的 bump 会一直挂在节点上，状态看着像「刚闪过」。重启动画要强制一次回流，
 * 不然连着两次改值时第二次不播。 */
export function setVal(node, text, bump) {
  const changed = node.textContent !== text;
  if (changed) node.textContent = text;
  node.classList.remove('bump');
  if (changed && bump) {
    void node.offsetWidth;
    node.classList.add('bump');
  }
}

export function skeletonCards(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += '<div class="ccard sk-card"><div class="sk sk-line"></div><div class="sk sk-temp sm"></div><div class="sk sk-line"></div></div>';
  return s;
}
