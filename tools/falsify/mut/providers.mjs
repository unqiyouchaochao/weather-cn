/* falsify 变异表里属于「providers」的那一族。
 * 为什么一张表拆成几份：MUT 是「每条新功能都必须改同一个文件」的第三处 —— 两条改动线各加一条
 * 断言就要往同一个 ]; 前面插一行，抢同一个位置、同一份上下文（前两处是 ui.js 与 main.js，已分片）。
 * 加一处变异 = 在归属那一族加一条；一条断言盯两个族的文件就写成两条，各进各的族。
 * 两条规矩没变：① name 开头写 `vNNN `，falsify 靠它把比这棵树新的条目筛掉；
 * ② from 必须在目标文件里**恰好命中 1 次** —— 改完跑 `node tools/anchor-audit.mjs`，一秒出失锚条数，
 *   不必等那一整趟两小时的全量逼红。 */
import { F } from '../files.mjs';

export default [

  /* ↓ 墨迹那五条失败路径：这四条各拦一种「它骗人」的方式 */
  { name: '平局改回按行序取', file: F.china, from: 'return tied.find(s => s.name === q || (qs && s.name === qs)) || tied[0];', to: 'return tied[0];', expect: '按所查城市名选' },
  { name: '距离上限放到 250°（脏坐标不再被拒）', file: F.china, from: 'if (Math.sqrt(bd) > 2.5) return null;', to: 'if (Math.sqrt(bd) > 250) return null;', expect: '报不出站' },
  { name: 'stationFor 不把城市名传下去', file: F.china, from: 'return resolve(lat, lon, city);', to: 'return resolve(lat, lon);', expect: '只有城市名时仍查到' },
  { name: '把清洗掉的坐标填回去（还原脏数据，让它比本尊更近）', file: F.stations, from: '河南|jNnwV||', to: '河南|jNnwV|34.758|113.665', expect: '码表清洗' },
  /* ↓ 2026-09-29 下午：真机量到「按中文路径拼城市页」拿到的是 200 + p404 模板，界面画成一张空屏 */
  { name: 'v97 空气质量那一问又只要四项（"国标"悄悄变成三项算的）', file: F.om, from: ',nitrogen_dioxide,sulphur_dioxide,carbon_monoxide&timezone=auto', to: '&timezone=auto', expect: '六项浓度都要了' },
  { name: 'v97 注册表把 wttr 的逐小时写成整点一档', file: F.wttr, from: '  hourlyStep: 3,', to: '  hourlyStep: 1,', expect: '档位与真报文实算的一致' },
  { name: 'v99 空气质量那一问不再走缓存（每拍敲一发第三方）', file: F.om, from: '    if (hit && Date.now() - hit.at < AIR_TTL) return hit.data;', to: '    void hit;', expect: '按坐标缓存 30 分钟' },
  { name: 'v99 空气那一问不合并并发（一轮催三发）', file: F.om, from: '    if (airInflight.has(k)) return airInflight.get(k);', to: '    void 0;', expect: '按坐标缓存 30 分钟' },
];
