/* falsify 变异表里属于「visuals」的那一族。
 * 为什么一张表拆成几份：MUT 是「每条新功能都必须改同一个文件」的第三处 —— 两条改动线各加一条
 * 断言就要往同一个 ]; 前面插一行，抢同一个位置、同一份上下文（前两处是 ui.js 与 main.js，已分片）。
 * 加一处变异 = 在归属那一族加一条；一条断言盯两个族的文件就写成两条，各进各的族。
 * 两条规矩没变：① name 开头写 `vNNN `，falsify 靠它把比这棵树新的条目筛掉；
 * ② from 必须在目标文件里**恰好命中 1 次** —— 改完跑 `node tools/anchor-audit.mjs`，一秒出失锚条数，
 *   不必等那一整趟两小时的全量逼红。 */
import { F } from '../files.mjs';

export default [
  /* ↓ v110 这一轮（暗夜模式切换 + 图标/配色）：四条新断言各配一处改坏。
     第一条同时会让另外两条（「两边都挑过…」与「屏上真点两下…」）一起红，这里只认第一条。
     2026-10-06 清单收到两套（一深一浅）之后，这一条换了锚点：原来打的是「切回浅色写死列表默认」
     那一行，可一边只剩一套时「记住用户挑的那套」和「列表默认」是同一个值，怎么写都红不了；
     改成打**记账那一半**（lightTheme 不再记）——「浅色记账错」立刻红，而它正是 2026-09-21
     那次「只修了一半」的原形状。 */
  { name: '切回浅色时不再记浅色这一边的账（切回来的去处没人管了）', file: F.themes,
    from: '    next.lightTheme = cur.id;',
    to: '    next.lightTheme = null;', expect: '套主题各自连点两下都回到原来那套' },
  { name: 'hero 卡用 --surface 却不进玻璃名单', file: F.css,
    from: '.ccard, .current-card, .air-card', to: '.ccard, .air-card',
    expect: '用 --surface 的卡面与玻璃名单一一对应' },
  { name: '--pop 折回图形色（11px 小字跌破 AA）', file: F.css,
    from: '--pop: #156493;', to: '--pop: #3b82c4;', expect: '--pop（逐小时降水小字）' },
  { name: '.loc-btn 的落色拿掉（退回 UA 默认黑，深色主题里那颗针看不见）', file: F.css,
    from: '  color: var(--muted);\n  border-radius: 12px;', to: '  border-radius: 12px;',
    expect: '界面符号的落色压在卡面上' },
  /* ↓ v111 S1：天气底色从 CSS 的十个主题块搬进 themes.js。一份「有哪些态」现在散在四处，
     前五条各改坏一处（漏值 / 漏规则 / 图标表指错 / 不下发 / 又走类名），最后一条专验那个兜底格。 */
  { name: 'v111 某套主题少写一个天气渐变（夜航的雾天那一格漏了）', file: F.themes,
    from: "         storm: 'linear-gradient(160deg, #0a0a0a, #000000)', fog: 'linear-gradient(160deg, #191919, #0b0b0b)' },",
    to: "         storm: 'linear-gradient(160deg, #0a0a0a, #000000)' },",
    expect: '天气底色四处名单对齐' },
  { name: 'v111 CSS 里那条规则又写成类选择器（屏上再也没有这个态的底）', file: F.css,
    from: 'body[data-weather="fog"]   { background: var(--w-fog); }',
    to: 'body.bg-fog { background: var(--w-fog); }', expect: '天气底色四处名单对齐' },
  { name: 'v111 没有天气态时也把渐变铺上（首屏那一格不再回实底）', file: F.css,
    from: 'body[data-weather="clear"] { background: var(--w-clear); }',
    to: 'body { background: var(--w-clear); }\nbody[data-weather="clear"] { background: var(--w-clear); }',
    expect: '换主题会把六个渐变全下发' },
  /* ↓ v112 S2：背景模块取消。这四条各拦一种「偷偷长回来」或「下发链断一环」。 */
  { name: 'v112 背景那栏的控件又回到 DOM 里（藏起来也算复活）', file: F.html,
    from: '      <fieldset class="group" id="iconGroup" hidden>',
    to: '      <label id="bgChipRow"><input type="range" id="bgChip" /></label>\n      <fieldset class="group" id="iconGroup" hidden>',
    expect: '背景那一栏的十个控件' },
  { name: 'v112 增加对比度那一票否决挑错了元素', file: F.css,
    from: '@media (prefers-contrast: more) {\n  body {', to: '@media (prefers-contrast: more) {\n  body[data-bg="auto"] {',
    expect: 'prefers-contrast: more 真的否决玻璃' },
  { name: 'v112 面板卡用 --surface 却掉出玻璃名单（两份名单又各自漂移）', file: F.css,
    from: '.rank-row, .rank-loading, .sheet-note, .tabbar, .modal-card,', to: '.rank-row, .rank-loading, .sheet-note, .tabbar,',
    expect: '用 --surface 的卡面与玻璃名单一一对应' },
  /* ↓ v114 S5+S6：「透出值改成每套主题一档」新长出来的四条断言，一条一处改坏。
   *   前两条打**数据**（两个 α 抄成同一个数、把 --muted 的补偿系数拿掉），
   *   后两条打**下发链**（α 没写进 body、天气态查表退成永远晴天）。
   *   2026-10-06 锚点搬到薄荷蓝那一行（light 那套随收敛一起删了）：mint 的 mix 从 20 改成 0
   *   实测把「muted 压弹窗底 × storm 最深端」那一格从 5.00 拉到 4.18（同一把尺子，见
   *   tools/theme-glass-scan.mjs），跌破 AA —— 这一处不是随手翻常量，它翻的是「玻璃那层为什么
   *   必须同时提 --muted」这件事本身。 */
  { name: 'v114 两套主题的 glass.a 抄成同一个数（逐主题分档退化回一根全局滑杆）', file: F.themes,
    from: '    glass: { a: 85, mix: 20, blur: 13 } },', to: '    glass: { a: 72, mix: 20, blur: 13 } },',
    expect: '套主题的 glass.a 是' },
  { name: 'v114 薄荷蓝的 --muted 补偿系数拿掉（半透卡面上次要文字跌破 AA）', file: F.themes,
    from: '    glass: { a: 85, mix: 20, blur: 13 } },', to: '    glass: { a: 85, mix: 0, blur: 13 } },',
    expect: '的复合底色 × 四种字色' },
  { name: 'v95 正文用分隔线的颜色（几乎压不进弹窗底）', file: F.css, from: '.disc-body p { margin: 0 0 8px; font-size: 12.5px; line-height: 1.65; color: var(--muted);', to: '.disc-body p { margin: 0 0 8px; font-size: 12.5px; line-height: 1.65; color: var(--line);', expect: '软件声明展开后' },
  /* 这一处第一版写的是「正文改用 --muted-base」，跑下来**不红**，而它不该红：那一枚颜色在每套
   * 主题上都压得住弹窗底（实测最低 > 4.5），是合法替代而不是回归 —— 变异表里留一条永远不红的
   * 用例，等于自己造一个「断言是摆设」的假结论。改成动主题那套的 --muted-base 本身：
   * 那是 .disc 正文真正取色的上游，压不住就必须红。
   * 2026-10-06 锚点搬到薄荷蓝（bridal 随收敛删了）：#517077 褪到 #6f8f9d，提档 20% 之后
   * 压弹窗底只剩 3.49、压白卡 4.46，两处都跌破 —— 这条量的从来不是「好不好看」，是那一格的底。 */
  { name: 'v95 薄荷蓝的次要字色褪到压不住白卡', file: F.css, from: '--muted-base: #517077;', to: '--muted-base: #6f8f9d;', expect: '软件声明展开后' },
  /* 这一处不是编出来的变异，就是 2026-10-01 真犯过的错：#providerNote 搬进「软件声明」之后
   * markup 里那一段忘了删，而 `.hint` 自带底色与内边距 —— 空的也画出一条实心小色块。
   * 用户看到的现象是「设置里没有软件声明」，所以这一条必须能红。 */
  { name: 'v95 搬走说明后 markup 里留下空的 .hint（画成一条无色块的实底）', file: F.html, from: '      <label class="field" id="keyField">', to: '      <p class="hint small" id="providerNote"></p>\n      <label class="field" id="keyField">', expect: '画得出框、却没字' },
  { name: 'v96 声明组后面又加了一组（它不再在最下面）', file: F.html, from: '        <div id="discList"></div>\n      </fieldset>', to: '        <div id="discList"></div>\n      </fieldset>\n      <fieldset class="group"><legend>临时：位置守卫必须为这条红</legend></fieldset>', expect: '排在设置面板所有分组的最下面' },
  /* ↓ 2026-10-01 v100「设置抽屉的滚动结构与背景锁」。① 是把卡片改回"自己滚 + 标题 sticky 刷一条 --card"
   *   那个原始缺陷；③④ 是背景锁的两半（标记与真正生效的根 overflow）；⑤ 是退场在途重开时锁该留着；
   *   ⑥ 是"绕开 closeSheet 直接 hidden"这种旁路（本轮在 saveSettings 与回归 reset() 各抓到一处）。 */
  { name: 'v100 标题又回到 sticky + --card 底色（那条盖过圆角的异色带）', file: F.css, from: '  .modal-head { padding: 2px 0 10px; border-bottom: 1px solid var(--line); }', to: '  .modal-head { position: sticky; top: 0; background: var(--card); padding: 2px 0 10px; z-index: 2; }', expect: '只有一个滚动容器' },
  { name: 'v100 滚动区不再拦链式滚动（滑到顶/到底带着天气页走）', file: F.css, from: '  overflow-y: auto;\n  overscroll-behavior: contain;          /* 滑到顶/到底不带着背后那页一起滚 */', to: '  overflow-y: auto;', expect: '只有一个滚动容器' },
  { name: 'v100 根元素那条 overflow 规则被删（body 那条锁不住页面）', file: F.css, from: 'html[data-sheet] { overflow: hidden; }', to: 'html[data-sheet] { overflow: visible; }', expect: '打开设置就把背景锁住' },
  { name: 'v101 空状态卡的字色换成描边色（新配对没人量过 AA）', file: F.css, from: '  text-align: center;\n  background: var(--ok-bg);\n  color: var(--ok-ink);', to: '  text-align: center;\n  background: var(--ok-bg);\n  color: var(--ok-line);', expect: '空状态卡那一对配色在全部' },
  /* v107：浮层三段式。这两处各拦一种「头部又会跟着滚走」的形状 */
  { name: 'v107 浮层的滚动区不再自己滚（overflow 退回 visible）', file: F.css, from: '.modal-body, .sheet-body {\n  flex: 1 1 auto; min-height: 0;\n  overflow-y: auto;', to: '.modal-body, .sheet-body {\n  flex: 1 1 auto; min-height: 0;\n  overflow-y: visible;', expect: '整个浮层只有 .sheet-body 会滚' },
  { name: 'v107 滚动区漏了 min-height:0 那一刀（撑到两万像素高，用户滑不到底）', file: F.css, from: '.sheet-body { padding: 0 0 4px; }', to: '.sheet-body { flex: 0 0 auto; padding: 0 0 4px; }', expect: '整个浮层只有 .sheet-body 会滚' },
  { name: 'v108 那句话又被写回 markup 里', file: F.html, from: '<p class="sheet-note" id="rankNote"></p>', to: '<p class="sheet-note" id="rankNote">口径为城市空气质量指数（AQI，国标）。</p>', expect: '榜页头那一行是现推的' },
  { name: 'v121 全局那条 [hidden] 不再 !important（关掉的浮层照样盖住首页）', file: F.css,
    from: '[hidden] { display: none !important; }', to: '[hidden] { display: none; }',
    expect: '带 hidden 的节点算出来的 display' },
  /* v115 那三条（缎面掺写死的白 / 花瓣的门多开一格 / 菱点不再由 --lace 派生）2026-10-06 一起删了：
   * 它们打的 target 是花嫁那一套的装饰段与 .petals 的门，那一套连同 src/styles/20-bridal.css
   * 都从代码里撤了，锚点留着只会每轮报「失锚」。要恢复装饰层，装饰那三条断言与这三处变异
   * 一起从 git 历史里捞回来（同一轮的东西，别只捞一半 —— 只捞断言就出现没人管的装饰，
   * 只捞变异就红给一条已经删掉的断言看）。 */
];
