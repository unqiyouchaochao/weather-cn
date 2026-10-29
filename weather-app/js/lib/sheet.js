/* 全屏浮层的退场：`.sheet`（空气排名）与设置弹窗 `.modal` 共用这一套。
 *
 * 之前只有进场一段 CSS fade，关闭是「hidden 一瞬没了」—— 用户说的「返回不跟手」主要就在这。
 * 退场动画必须跑完再 hidden，所以统一走这个 helper，而不是各处自己写 setTimeout。
 * 进场反过来交给 CSS（13-transition.css 的 overlay-in）：面板从 hidden 回到在场时浏览器会自己
 * 重放它身上的 animation，JS 插手不了这一头，硬写只会多一套要对齐的数值。
 *
 * 只动 opacity 与 transform 两个合成属性，不动 height/top：那两类会触发整页重排。
 * 系统要求「减少动态效果」时直接跳到终态，不播动画。 */

const OUT_MS = 150;
/* 这一对就是 CSS overlay-in 的反向（同一组 9px / .99），改一处要同时改另一处，
 * 否则进出场各走各的曲线，看着像两个面板。 */
const OUT = [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(9px) scale(.99)' }];

function wantsReduced() {
  return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/* 在途的退场登记在这里，重开时作废它。两条都是 2026-09-27 在浏览器里量出来的，不是推测：
 *  ① 退场途中重新打开 —— 原先那一趟照样会走完 `done()`，把刚打开的面板 `hidden` 掉；
 *  ② 带 `fill:'forwards'` 的动画跑完之后**一直挂在元素上**，computed opacity 就此钉死在 0。
 *     于是下一次打开（`hidden=false`）拿到的是**透明的面板**：`.modal` 是
 *     `position:fixed; inset:0; z-index:50`，它盖满整屏、把每一个点击都吃掉，
 *     `document.elementFromPoint()` 在面板中央返回的是面板里的控件而不是底下的页面 ——
 *     用户说的「页面卡死，看得见点不动」就是这一种。
 * 所以落定与作废都要 `cancel()` 那个动画：`hidden` 只管在不在场，不该顺手把透明度留在身上。 */
const closing = new WeakMap();

/* 背景滚动锁：有浮层在场，底下那页就不许跟着滚。
 *
 * 这条锁原来写在**调用方**（`rank.js` 自己 `document.body.dataset.sheet='open'`、关的时候自己删），
 * 而设置弹窗走的是同一个 `openSheet/closeSheet`，却没人给它上锁 —— 于是抽屉滑到顶、滑到底，
 * 滚动就链到背后那页天气上去了（2026-10-01 用户报的现象）。锁的归属收回到本模块：
 * **谁走 openSheet，谁就带上锁**；浮层真的 hidden 之后才解。用计数是因为两层可能叠着
 * （排名浮层是从天气页点进去的，将来若从设置里也能点进去，解早了就把底下那层的锁也带走了）。 */
const 在场 = new Set();
function 上锁(node) {
  在场.add(node);
  /* 两处都要：`body[data-sheet]` 是既有那条规则读的标记，但**它其实锁不住页面** ——
   * body 没有固定高度，盒子本身就和内容一样高，`overflow:hidden` 只是把 body 裁一刀，
   * 视口的滚动范围还是 documentElement 看着 body 的整盒高度算出来的（2026-10-01 回归里
   * 真的去推 scrollTop 才发现：属性挂着、overflow 是 hidden、页面照样能动）。
   * 真正把滚动挡住的是根元素上的同一条：html 的 overflow 会传播给视口。 */
  document.body.dataset.sheet = 'open';
  document.documentElement.dataset.sheet = 'open';
}
function 解锁(node) {
  在场.delete(node);
  /* 有人绕开 closeSheet 直接把面板 hidden 掉（本轮就抓到两处：saveSettings 里那句
   * `el.modal.hidden = true`、以及回归里那个 reset()）—— 那种节点不能继续算"在场"，
   * 否则它把锁留在身上，谁都解不掉，表现就是用户说的"设置关掉以后天气页滚不动"。 */
  [...在场].forEach(n => { if (n.hidden) 在场.delete(n); });
  if (!在场.size) {
    delete document.body.dataset.sheet;
    delete document.documentElement.dataset.sheet;
  }
}

/** 打开。**必须走这里**，直接 `node.hidden = false` 就作废不了在途的那一趟退场 */
export function openSheet(node) {
  const abort = closing.get(node);
  if (abort) abort();
  node.hidden = false;
  上锁(node);
}

/** 播完退场再隐藏。node 必须已经在屏幕上；after 在真正 hidden 之后调 */
export function closeSheet(node, after) {
  if (closing.has(node)) return;      // 退场已在途：再叠一趟只会多一个动画、多一次 hidden
  let settled = false;
  let a = null;
  const drop = () => {
    closing.delete(node);
    if (a) {
      try { a.cancel(); } catch (e) { /* 本来就废了 */ }
      a = null;
    }
  };
  const done = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    drop();
    node.hidden = true;
    解锁(node);
    if (after) after();
  };
  /* 兜底计时器必须无条件挂上。以前它写在 `else` 分支里，于是「有 finished promise」这条路
   * 完全依赖 promise 兑现 —— 页面被切到后台、动画时间线被暂停时它就不 settle，
   * node 永不 hidden，body[data-sheet] 那条 overflow:hidden 也就永不解除，
   * 表现就是用户说的「应用卡死」：界面还在，滚不动也点不动。 */
  const timer = setTimeout(done, OUT_MS + 120);
  // 重发作废这一趟：不 hidden、也不跑 after（面板又在场了，那条滚动锁得留着）
  closing.set(node, () => {
    settled = true;
    clearTimeout(timer);
    drop();
  });
  if (node.hidden || wantsReduced() || !node.animate) { done(); return; }
  try { a = node.animate(OUT, { duration: OUT_MS, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }); }
  catch (e) { done(); return; }
  if (a && a.finished) a.finished.then(done, done);   // 老 WebView 没有 finished promise，交给上面那个计时器
}
