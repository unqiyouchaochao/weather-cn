/* falsify 变异表里属于「controller」的那一族。
 * 为什么一张表拆成几份：MUT 是「每条新功能都必须改同一个文件」的第三处 —— 两条改动线各加一条
 * 断言就要往同一个 ]; 前面插一行，抢同一个位置、同一份上下文（前两处是 ui.js 与 main.js，已分片）。
 * 加一处变异 = 在归属那一族加一条；一条断言盯两个族的文件就写成两条，各进各的族。
 * 两条规矩没变：① name 开头写 `vNNN `，falsify 靠它把比这棵树新的条目筛掉；
 * ② from 必须在目标文件里**恰好命中 1 次** —— 改完跑 `node tools/anchor-audit.mjs`，一秒出失锚条数，
 *   不必等那一整趟两小时的全量逼红。 */
import { F } from '../files.mjs';

export default [
  /* 这一处原先是「空着的 #bgInfo 不再收掉」（改 main.js 里那句 hidden 守卫）。v112 S2 把背景模块
   * 连那一枚徽带守卫一起删了，锚点自然落空 —— 删掉，不是改成个能红的假变异。
   * 它守的那条断言「画得出框、却没字」还在，由上面 v95 往 markup 里塞回空 .hint 那一处逼红。 */
  /* ↓ 2026-10-01 v99「省电这一轮：只抠无谓开销」。① 后台闸门、② 通知去重（Java 侧，回归按形状钉，
   *   所以这里的"改坏"也是把那个形状拆掉）、③④ 两处网络缓存的三条独立失效路径。 */
  { name: 'v99 自动刷新又没了后台闸门（进程被 FGS 钉住，后台一直重绘）', file: F.refresh, from: '  if (document.hidden) return;', to: '', expect: 'document.hidden' },
  { name: 'v100 关浮层绕开 closeSheet 直接 hidden（锁留在身上解不掉）', file: F.rank, from: '  closeSheet(el.rankView);', to: '  el.rankView.hidden = true;', expect: '排名浮层与设置共用同一把锁' },
  { name: 'v101 自动重试没有封顶（RETRY_MS 取到 undefined ⇒ 立刻再来一发）', file: F.query, from: 'if (retryRound >= RETRY_MS.length) return;', to: 'if (false) return;', expect: '失败只补两轮就收手' },
  { name: 'v101 屏幕不在前台也照发这一枪（省电闸门没了）', file: F.query, from: 'if (document.hidden) { retryWait = target; return; }', to: 'if (false) { retryWait = target; return; }', expect: '后台不白发这一枪' },
  { name: 'v101 回前台不补那一发（retryOnResume 成了空函数）', file: F.query, from: 'export function retryOnResume() {\n  if (!retryWait) return;', to: 'export function retryOnResume() {\n  if (true) return;', expect: '后台不白发这一枪' },
  { name: 'v101 每一轮都把计次清零（永远停在最快那一档，白跑不停）', file: F.query, from: 'if (!(opts && opts.auto)) retryRound = 0;', to: 'retryRound = 0;', expect: '失败只补两轮就收手' },
  { name: 'v101 重试不认「上次尝试过的目标」，整页被撤成骨架屏', file: F.query, from: 'const silent = sameTarget(target, state) || sameTarget(target, lastAttempt);', to: 'const silent = sameTarget(target, state);', expect: '冷启动那一发失败之后自动补一轮' },
  { name: 'v106 榜单重开不归零（停在上次翻到的那一行）', file: F.rank, from: '  el.rankScroll.scrollTop = 0;', to: '  void el.rankScroll;', expect: '空气质量榜重开也回到顶部' },
  { name: 'v106 榜单归零归到了不滚的那一层（滚的是 .sheet-body，不是 <ol>）', file: F.rank, from: '  el.rankScroll.scrollTop = 0;', to: '  el.rankList.scrollTop = 0;', expect: '空气质量榜重开也回到顶部' },
  /* v108：榜页头那句「只有国标」不许写死。三处各拦一种改坏 */
  { name: 'v108 open() 忘了现推页头那一行（屏上永远空着）', file: F.rank, from: "  el.rankNote.textContent = noteText(loadConfig().aqiStd || 'auto');", to: '  void noteText;', expect: '榜页头那一行是现推的' },
  { name: 'v108 noteText 不看参数（选到美标也不改口）', file: F.rank, from: "  return std === 'us'", to: "  return false && std === 'us'", expect: '口径选到美标时那句要改口' },
  /* v121：这条断言（回车搜索完成后候选不许被在途联想弹回来）**从来没有变异盯着** —— 表里搜不到 suggest 这个文件。
   * 补上时要一次撤两道：`hideSuggest` 里 seq++ 与 abort 是同一件事的两道独立闸（只撤 seq，fetch 被 abort 掉
   * 照样不画；只撤 abort，回来时 seq 不等也照样不画），单撤一道必然照样绿 —— 与 2026-10-04 那晚
   * 「换城市不再收结果区」三道冗余闸是同一个形状。
   * ⚠ 实测过「只撤 seq、留着 abort」：照样全绿（共 0 红 / 126）—— 因为 `fetchSuggest` 除了比 seq 还要看
   *   `sugCtrl.signal.aborted` 那个**标志位**，断言的桩不理 signal 也拦不住它读这个位。
   *   所以那条变异不写进表（写进去就是一个永远不红的假闸），这一处证明的是「两道都在时列表不弹回来」。 */
  { name: 'v121 hideSuggest 两道闸一起撤（晚到的联想把列表弹回来，用户 09-24 报的那个形状）', file: F.sug,
    from: '  sugSeq++;\n  if (sugCtrl) { sugCtrl.abort(); sugCtrl = null; }',
    to: '  void sugCtrl;', expect: '候选列表不被在途的联想重新弹出' },
  /* v124：收藏的三处写点（星、栏上那枚 ✕、设置里恢复默认）收成 js/favorite.js 一处真值时补的牙。
   * 这条断言在收成一处之前**根本不存在** —— 三处各写一遍而没人管，正是「少跟一处」最容易活下来的形状。
   * 两处各撤一半：A 撤「那颗星」，B 撤「那本账」，两种坏法在屏上是不同的长相，所以不能合成一处。 */
  { name: 'v124 repaintFav 只重画收藏栏、忘了那颗星', file: F.fav,
    from: '  ui.renderFav();\n  ui.setStar(currentKey());',
    to: '  ui.renderFav();', expect: '收藏的加与删都同时改到「账 / 那一排 / 那颗星」三处' },
  { name: 'v124 remove() 只筛了数组没落盘（刷新就全回来）', file: F.fav,
    from: '  saveFav(loadFav().filter(k => k !== key));',
    to: '  void loadFav().filter(k => k !== key);', expect: '收藏的加与删都同时改到「账 / 那一排 / 那颗星」三处' },
];
