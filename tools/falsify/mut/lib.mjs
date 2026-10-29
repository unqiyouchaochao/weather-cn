/* falsify 变异表里属于「lib」的那一族。
 * 为什么一张表拆成几份：MUT 是「每条新功能都必须改同一个文件」的第三处 —— 两条改动线各加一条
 * 断言就要往同一个 ]; 前面插一行，抢同一个位置、同一份上下文（前两处是 ui.js 与 main.js，已分片）。
 * 加一处变异 = 在归属那一族加一条；一条断言盯两个族的文件就写成两条，各进各的族。
 * 两条规矩没变：① name 开头写 `vNNN `，falsify 靠它把比这棵树新的条目筛掉；
 * ② from 必须在目标文件里**恰好命中 1 次** —— 改完跑 `node tools/anchor-audit.mjs`，一秒出失锚条数，
 *   不必等那一整趟两小时的全量逼红。 */
import { F } from '../files.mjs';

export default [
  /* ↓ v113 S3：老配置升版那一步。三条各拦一种「迁移顺手多干了一件事」。 */
  { name: 'v113 迁移不看版本号（为背景升一次版，把用户挑的数据源打回默认）', file: F.cfg,
    from: '    if (老版 < 2) cache.provider = DEFAULT_CFG.provider;', to: '    cache.provider = DEFAULT_CFG.provider;',
    expect: '迁移到 v5' },
  { name: 'v113 配置里那一格 bg 没删（合并结果里 stored.bg 会活下来）', file: F.cfg,
    from: '      delete cache.bg;', to: '      void cache.bg;', expect: '迁移到 v5' },
  { name: 'v113 照片键没删（那张 JPEG 一直躺在 localStorage 里）', file: F.cfg,
    from: "      try { localStorage.removeItem('weather-bg-photo'); } catch (e) { /* 清不掉也只能这样 */ }",
    to: '      void 0;', expect: '迁移到 v5' },
  /* ↓ v121 主题从 11 套收到 2 套：老用户存的 id 可能查无此套。两条各拦一半——
   *   第一条不修（屏上落默认套、设置下拉里却没有这一项，读出来是空串）；
   *   第二条不分明暗侧（深色用户一觉醒来变成浅色）。 */
  { name: 'v121 存过的主题 id 查无此套时不修（下拉里没这一项）', file: F.cfg,
    from: "    if (v && !认识(v)) cache[k] = k === 'theme' ? defaultOf(已删主题[v] || 'light') : null;",
    to: '    void v;', expect: '存过的主题 id 已不在清单里' },
  { name: 'v121 修的时候不分明暗侧（删掉的深色套用户被扔进浅色）', file: F.cfg,
    from: "    if (v && !认识(v)) cache[k] = k === 'theme' ? defaultOf(已删主题[v] || 'light') : null;",
    to: "    if (v && !认识(v)) cache[k] = k === 'theme' ? defaultOf('light') : null;",
    expect: '落到同明暗侧的默认套' },
  /* ↓ 2026-10-01 v95「软件声明」这一组 + 顺手修的两条测试自身的竞态/空门。
   *   这一轮值得记的东西一半在测试上：三条断言原本是**绿的摆设**（/手机|App/ 谁家文案里都有、
   *   nowIdx>0 零点必红、hw.hidden 量的其实是网络快慢），所以变异里特意有几处是去打那些
   *   「看着像判据、其实恒真」的位置，红了才算把门装上。 */
  { name: 'v95 能力行不看 cap.air（空气质量永远报「给」）', file: F.disc, from: "['空气质量', !!c.air, '']", to: "['空气质量', true, '']", expect: '四家源逐个选中' },
  { name: 'v95 标题写死成中国天气（选了别家也挂着这句）', file: F.disc, from: "title: '数据源 · ' + label", to: "title: '数据源 · 中国天气'", expect: '四家源逐个选中' },
  { name: 'v95 映射不全时不再兜住（设置面板当场崩）', file: F.disc, from: "try { p = getProvider({ provider: providerId, custom: custom || {} }); }\n  catch (e) { capErr = String((e && e.message) || e); }", to: "p = getProvider({ provider: providerId, custom: custom || {} }); void capErr;", expect: '映射填得不全时' },
  { name: 'v95 推不出来却硬编一句「能力齐全」', file: F.disc, from: "s1.push(capErr ? '这一家的能力要看你填的映射，现在推不出来（' + capErr + '），所以不猜。'", to: "s1.push(capErr ? '这一家的能力齐全。'", expect: '映射填得不全时' },
  { name: 'v95 口径那一行不看选中的标准（永远写默认那套）', file: F.disc, from: "'当前口径：' + stdLabel(aqiStd)", to: "'当前口径：' + stdLabel('auto')", expect: '换空气质量口径' },
  { name: 'v95 署名那栏又把「逐小时另取 Open-Meteo」写死（有逐小时的也挂着别家）', file: F.disc, from: "if (!c.hourly) gap.push('逐小时另取 Open-Meteo 的模型值');", to: "gap.push('逐小时另取 Open-Meteo 的模型值');", expect: '四家源逐个选中' },
  { name: 'v99 通知正文没变也照发（每小时白重画一次 SystemUI）', file: F.svc, from: '        if (text.equals(prefs(ctx).getString(KEY_LIVE_TEXT, ""))', to: '        if (text.length() > 0', expect: '通知正文没变就不许重发' },
  { name: 'v100 锁只挂在 body 上（根元素没标记，那条 overflow 压根不生效）', file: F.sheet, from: "  document.documentElement.dataset.sheet = 'open';", to: '  void 0;', expect: '打开设置就把背景锁住' },
  /* 第一版这条改的是「abort 里顺手解锁」—— 跑下来不红，而且**不该红**：openSheet 里 abort 之后
   * 紧接着就 `上锁(node)`，先解再上等于什么都没发生，那是个等价改动不是回归（同 --muted-base 那条教训）。
   * 真正会坏掉的是"不作废在途的那一趟退场"：它的 270ms 硬超时照样会跑完，把刚打开的面板藏掉并解锁。 */
  { name: 'v100 重开时不作废在途的退场（那一趟照样跑完，把面板藏掉并解了锁）', file: F.sheet, from: '  const abort = closing.get(node);\n  if (abort) abort();', to: '  void closing.get(node);', expect: '退场动画在途时重新打开' },
];
