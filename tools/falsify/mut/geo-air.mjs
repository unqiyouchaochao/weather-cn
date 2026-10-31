/* falsify 变异表里属于「geo-air」的那一族。
 * 为什么一张表拆成几份：MUT 是「每条新功能都必须改同一个文件」的第三处 —— 两条改动线各加一条
 * 断言就要往同一个 ]; 前面插一行，抢同一个位置、同一份上下文（前两处是 ui.js 与 main.js，已分片）。
 * 加一处变异 = 在归属那一族加一条；一条断言盯两个族的文件就写成两条，各进各的族。
 * 两条规矩没变：① name 开头写 `vNNN `，falsify 靠它把比这棵树新的条目筛掉；
 * ② from 必须在目标文件里**恰好命中 1 次** —— 改完跑 `node tools/anchor-audit.mjs`，一秒出失锚条数，
 *   不必等那一整趟两小时的全量逼红。 */
import { F } from '../files.mjs';

export default [
  /* ↓ 2026-09-29「选中墨迹屏上一动不动」这一轮：坐标点 → 地名 → 各家出处，一条一个坑 */
  { name: '「X县」的类别又不参与排序（搜新兴县拿到吉林那座）', file: F.geo, from: 'score: rank + nameBonus(p.name, q) + classBonus(q, p.type)', to: 'score: rank + nameBonus(p.name, q)', expect: '必须落在广东那座县上' },
  /* ↓ 2026-10-01 v97「数据源体检四条修复」。这一组每处改坏的都是**当天量出来的那个真缺陷**，
   *   不是随手翻一个常量：路名顶掉本级市就是兰州那一晚的 92/62，繁体漏字就是 BDC 真回的「蘭州市」。 */
  { name: 'v97 城市榜退回整串扫描（路名里的「张掖」顶掉本级市）', file: F.hw, from: '    if (!ADMIN_SEG.test(seg) || NOT_CITY_SEG.test(seg)) return;', to: '    if (false) return;', expect: '路名不许顶掉本级市' },
  { name: 'v97 繁体表里又把 蘭/銀 漏掉（空气质量白降到模型值）', file: F.geo, from: "  蘭: '兰', 銀: '银', 濟: '济'", to: "  濟: '济'", expect: '繁体市名逐个归一' },
  { name: 'v97 cnAqi 不接 NO₂（请求回来了也没人吃）', file: F.aq, from: "    ['NO₂', iaqi(cur.nitrogen_dioxide, BP.no2_1h)],", to: "    ['NO₂', null],", expect: '首要污染物是它' },
  { name: 'v97 档位不再从报文里量（写死成一档）', file: F.hr, from: '    if (d > 0 && (s === 0 || d < s)) s = d;', to: '    void d;', expect: '窗口标题写明' },
  { name: 'v97 两源都没答时不再标记（又把锅甩给用户的用词）', file: F.geo, from: '  list.silent = asked > 0 && failed === asked;', to: '  list.silent = false;', expect: '检索源这一轮没有回答' },
  { name: 'v97 没答的那一轮仍被共享 10 秒（重试拿回同一个空数组）', file: F.geo, from: '  p.then(r => { if (r && r.silent && inflight.get(q) === p) inflight.delete(q); }, () => {});', to: '  void 0;', expect: '并重试一发' },
  { name: 'v99 城市榜 TTL 退回 10 分钟（43KB 每十分钟重下一遍）', file: F.hw, from: 'const TTL = 30 * 60 * 1000;', to: 'const TTL = 10 * 60 * 1000;', expect: 'TTL 是 30 分钟' },
];
