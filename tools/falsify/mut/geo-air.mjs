/* falsify 变异表里属于「geo-air」的那一族。
 * 为什么一张表拆成几份：MUT 是「每条新功能都必须改同一个文件」的第三处 —— 两条改动线各加一条
 * 断言就要往同一个 ]; 前面插一行，抢同一个位置、同一份上下文（前两处是 ui.js 与 main.js，已分片）。
 * 加一处变异 = 在归属那一族加一条；一条断言盯两个族的文件就写成两条，各进各的族。
 * 两条规矩没变：① name 开头写 `vNNN `，falsify 靠它把比这棵树新的条目筛掉；
 * ② from 必须在目标文件里**恰好命中 1 次** —— 改完跑 `node tools/anchor-audit.mjs`，一秒出失锚条数，
 *   不必等那一整趟两小时的全量逼红。 */
import { F } from '../files.mjs';

export default [
  /* ↓ 2026-09-29「坐标点 → 地名 → 各家出处」这一轮：一条一个坑。
   * 2026-11-01 加了下面那把「原词那一发命中 +40」之后，这里**单拆 classBonus 已经量不出来了**：
   * 全量逼红那一趟这一条报的是「共 0 红 / 110 条」—— 两把 +40 叠在同一行，撤掉一把，另一把刚好把广东那座县顶住。
   * 于是这一条改成一次拆两把（盯的还是同一句断言）。诚实的代价记在账本里：classBonus 单独失效，现在没有任何断言看得见。 */
  { name: '「X县」的类别与原词命中都不参与排序（搜新兴县拿到吉林那座）', file: F.geo,
    from: 'score: rank + nameBonus(p.name, q) + classBonus(q, p.type) + (variant === q ? 40 : 0)',
    to: 'score: rank + nameBonus(p.name, q)',
    expect: '必须落在广东那座县上' },
  /* ↓ 2026-10-01 v97「数据源体检四条修复」。这一组每处改坏的都是**当天量出来的那个真缺陷**，
   *   不是随手翻一个常量：路名顶掉本级市就是兰州那一晚的 92/62，繁体漏字就是 BDC 真回的「蘭州市」。 */
  { name: 'v97 城市榜退回整串扫描（路名里的「张掖」顶掉本级市）', file: F.hw, from: '    if (!ADMIN_SEG.test(seg) || NOT_CITY_SEG.test(seg)) return;', to: '    if (false) return;', expect: '路名不许顶掉本级市' },
  { name: 'v97 繁体表里又把 蘭/銀 漏掉（空气质量白降到模型值）', file: F.geo, from: "  蘭: '兰', 銀: '银', 濟: '济'", to: "  濟: '济'", expect: '繁体市名逐个归一' },
  { name: 'v97 cnAqi 不接 NO₂（请求回来了也没人吃）', file: F.aq, from: "    ['NO₂', iaqi(cur.nitrogen_dioxide, BP.no2_1h)],", to: "    ['NO₂', null],", expect: '首要污染物是它' },
  { name: 'v97 档位不再从报文里量（写死成一档）', file: F.hr, from: '    if (d > 0 && (s === 0 || d < s)) s = d;', to: '    void d;', expect: '窗口标题写明' },
  { name: 'v97 两源都没答时不再标记（又把锅甩给用户的用词）', file: F.geo, from: '  list.silent = asked > 0 && failed === asked;', to: '  list.silent = false;', expect: '检索源这一轮没有回答' },
  { name: 'v97 没答的那一轮仍被共享 10 秒（重试拿回同一个空数组）', file: F.geo, from: '  p.then(r => { if (r && (r.silent || (r.partial && !r.length)) && inflight.get(q) === p) inflight.delete(q); }, () => {});', to: '  void 0;', expect: '并重试一发' },
  /* ↓ 2026-11-05 红米 K60 那一轮：Photon 被这台的网络挡在 TCP 443，Open-Meteo 照答 —— silent 不响，
   *   提示却还是那句让用户改词。下面四处各拆一把尺：不标记 / 两家点反 / 点反之外再写死成 Photon / 空结果仍共享。
   *   四处落在三条断言上（「不标记」与「两家点反」都要让「要点名那一家」红，写死成 Photon 只有镜像那条会红）。
   *   别合并成一条 —— 合并了就又变成「一次拆两把」那种不可归因。 */
  { name: '2026-11-05 红米 一家整轮没连上不再标记（又把锅甩给用户的用词）', file: F.geo,
    from: '  list.partial = !list.silent && !(signal && signal.aborted) && (主 || 辅);',
    to: '  list.partial = false;',
    expect: '提示要点名那一家' },
  { name: '2026-11-05 红米 mute 把两家点反（说成答了的那一家没连上）', file: F.geo,
    from: "  list.mute = 主 ? 'open-meteo' : (辅 ? 'photon' : null);",
    to: "  list.mute = 主 ? 'photon' : (辅 ? 'open-meteo' : null);",
    expect: '提示要点名那一家' },
  { name: '2026-11-05 红米 mute 写死成 Photon（主源没连上时也怪 OSM 那家）', file: F.geo,
    from: "  list.mute = 主 ? 'open-meteo' : (辅 ? 'photon' : null);",
    to: "  list.mute = 'photon';",
    expect: '要点名 Open-Meteo' },
  { name: '2026-11-05 红米 一家没连上的空结果仍被共享 10 秒（提示里「过几秒再搜」成空话）', file: F.geo,
    from: '  p.then(r => { if (r && (r.silent || (r.partial && !r.length)) && inflight.get(q) === p) inflight.delete(q); }, () => {});',
    to: '  p.then(r => { if (r && r.silent && inflight.get(q) === p) inflight.delete(q); }, () => {});',
    expect: '第二次问要真的重新发 Photon' },
  /* ↓ 2026-11-01 华为装机录下来的真形状：撤掉「原词那一发命中」这一把尺，四川那座就又被陕西那座
   *   city(80) 顶掉。别拿等级表开刀 —— 我第一版就是抬了区/县却压不住 city，改错了地方。 */
  { name: '2026-11-01 真机 原词那一发的命中不再加权（补出来的写法反过来盖掉原词）', file: F.geo,
    from: 'score: rank + nameBonus(p.name, q) + classBonus(q, p.type) + (variant === q ? 40 : 0)',
    to: 'score: rank + nameBonus(p.name, q) + classBonus(q, p.type)',
    expect: '不许被我们补出来的写法捞到的更高行政级别点顶掉' },
  /* ↓ 同一次改动的另一半：表名不升，旧表就还在替新排序说话（装机实测屏上仍是陕西那座）。
   *   改坏方式就是把 GEO_LS 改回旧键 —— 于是 bestCity 直接端出旧表里的错城。 */
  { name: '2026-11-01 真机 改了排序却没作废按名缓存（旧表继续替新排序说话）', file: F.geo,
    from: "const GEO_LS = 'weather-studio-geo3';",
    to: "const GEO_LS = 'weather-studio-geo2';",
    expect: '旧的按名缓存不许再把那座错城端出来' },
  { name: 'v99 城市榜 TTL 退回 10 分钟（43KB 每十分钟重下一遍）', file: F.hw, from: 'const TTL = 30 * 60 * 1000;', to: 'const TTL = 10 * 60 * 1000;', expect: 'TTL 是 30 分钟' },
];
