/* falsify 变异表里属于「providers」的那一族。
 * 为什么一张表拆成几份：MUT 是「每条新功能都必须改同一个文件」的第三处 —— 两条改动线各加一条
 * 断言就要往同一个 ]; 前面插一行，抢同一个位置、同一份上下文（前两处是 ui.js 与 main.js，已分片）。
 * 加一处变异 = 在归属那一族加一条；一条断言盯两个族的文件就写成两条，各进各的族。
 * 两条规矩没变：① name 开头写 `vNNN `，falsify 靠它把比这棵树新的条目筛掉；
 * ② from 必须在目标文件里**恰好命中 1 次** —— 改完跑 `node tools/anchor-audit.mjs`，一秒出失锚条数，
 *   不必等那一整趟两小时的全量逼红。 */
import { F } from '../files.mjs';

export default [

  { name: '城市页选择器失效', file: F.moji, from: "d.querySelector('.wea_weather')", to: "d.querySelector('.wea_weather_NOPE')", expect: '墨迹城市页解析' },
  { name: '夜间不换成月牙图标', file: F.moji, from: 'icon: nightIcon(icon, isDay)', to: 'icon: icon', expect: '月牙图标' },
  { name: '缺降水量退成 0', file: F.moji, from: 'precipProb: null, precip: null', to: 'precipProb: 0, precip: 0', expect: '不许退成 0' },
  { name: 'nativeOnly 标记丢掉', file: F.moji, from: 'nativeOnly: true', to: 'nativeOnly: false', expect: '必须 disabled' },
  { name: 'index 说没有 nativeOnly', file: F.idx, from: 'return !!(REGISTRY[id] && REGISTRY[id].nativeOnly);', to: 'return false;', expect: '必须 disabled' },
  /* ↓ 墨迹那五条失败路径：这四条各拦一种「它骗人」的方式 */
  { name: '200 + Server is busy 不再当失败', file: F.moji, from: "if (!body || body.indexOf('Server is busy') >= 0)", to: 'if (!body)', expect: 'Server is busy' },
  { name: '418 退成一条通用 HTTP 报错', file: F.moji, from: "if (st === 418) throw new Error('墨迹天气的防火墙把这次请求拦了（418）');", to: '', expect: '防火墙拦下来' },
  { name: '检索不再要求名字精确相等（新昌县当成新兴县）', file: F.moji, from: 'const exact = list.filter(c => c.name === name);', to: 'const exact = list;', expect: '同名不同省' },
  { name: '页面标题对不上也照画', file: F.moji, from: 'if (page.city && page.city !== c.name) throw new Error(', to: 'if (!page.city && page.city !== c.name) throw new Error(', expect: '另一座城' },
  { name: '那枚自拼的 cookie 没发出去', file: F.moji, from: 'if (cookie) headers.Cookie = cookie;', to: 'if (cookie && false) headers.Cookie = cookie;', expect: 'internal_id' },
  { name: '平局改回按行序取', file: F.china, from: 'return tied.find(s => s.name === q || (qs && s.name === qs)) || tied[0];', to: 'return tied[0];', expect: '按所查城市名选' },
  { name: '距离上限放到 250°（脏坐标不再被拒）', file: F.china, from: 'if (Math.sqrt(bd) > 2.5) return null;', to: 'if (Math.sqrt(bd) > 250) return null;', expect: '报不出站' },
  { name: 'stationFor 不把城市名传下去', file: F.china, from: 'return resolve(lat, lon, city);', to: 'return resolve(lat, lon);', expect: '只有城市名时仍查到' },
  { name: '把清洗掉的坐标填回去（还原脏数据，让它比本尊更近）', file: F.stations, from: '河南|jNnwV||', to: '河南|jNnwV|34.758|113.665', expect: '码表清洗' },
  { name: '坐标点不再反查地名（就是真机那次「换源后屏上一动不动」）', file: F.moji, from: 'const cands = await places(lat, lon);', to: 'const cands = { names: [], hint: [] }; void places;', expect: '先反查这一带的地名' },
  { name: '反查不到地名时退成一句含糊的「没有收录」', file: F.moji, from: 'if (!cands.names.length) {', to: 'if (false) {', expect: '要明确说「反查不出」' },
  { name: '同名不同省的区县又不看线索、按检索第一条取', file: F.moji, from: 'if (pool.length < 2 || !hint || !hint.length) return pool[0];', to: 'return pool[0];', expect: '用反查链上的市名挑' },
  { name: '那份 id 缓存不分「替谁查的」（打过一次的名字被坐标点直接继承）', file: F.moji, from: "const cacheKey = (name, hint) => name + (hint && hint.length ? '@' + hint[0] : '');", to: 'const cacheKey = (name, hint) => name;', expect: '不许被坐标反查直接继承' },
  { name: '墨迹又没有了检索器（打城市名回车就看见内部错）', file: F.moji, from: 'geocode: bestCity,', to: 'geocode: null,', expect: '都必须有检索器' },
  /* ↓ 2026-09-29 下午：真机量到「按中文路径拼城市页」拿到的是 200 + p404 模板，界面画成一张空屏 */
  { name: '页面地址又退回按中文拼（真机那个 200 + p404 的错法）', file: F.moji, from: "return HOST + '/weather/china/' + prov + '/' + encodeURIComponent(slug);", to: "return HOST + '/weather/' + encodeURIComponent(c.coun) + '/' + encodeURIComponent(c.pname) + '/' + encodeURIComponent(c.name);", expect: '从它自己的两级索引页读出来的 slug 地址' },
  { name: '「200 但页里什么都没有」不再报错（画一张全 -- 的空屏）', file: F.moji, from: 'if (!page.city && page.temp == null && !page.days.length) {', to: 'if (false) {', expect: '不许画一张全 -- 的空屏' },
  { name: '省索引读不出省份时装作没事继续往下走', file: F.moji, from: "if (Object.keys(t).length < 2) throw new Error('墨迹的省列表页读不出省份（页面改版了？）');", to: '', expect: '要明确说「页面改版了」' },
  { name: '301 不跟了（CapacitorHttp 实测不会自己跟跳转）', file: F.moji, from: 'if (st >= 300 && st < 400) {', to: 'if (false && st >= 300) {', expect: '这一串请求真的按墨迹的要求发出去' },
  { name: '空气那一问不核对坐标（上一座城的 AQI 顶到这一座城）', file: F.moji, from: 'if (Math.abs(Number(lat) - m.la) > 0.005 || Math.abs(Number(lon) - m.lo) > 0.005) return Promise.resolve(null);', to: '', expect: '只回答「刚为这个坐标取过的那一份」' },
  { name: '注册表说谁都支持后台自取', file: F.idx, from: 'return !!(REGISTRY[id] && REGISTRY[id].cap && REGISTRY[id].cap.background);', to: 'return true;', expect: '后台那一路停用要说在通知/预警的说明里' },
  { name: '注册表说谁都不给预警', file: F.idx, from: 'return !!(REGISTRY[id] && REGISTRY[id].cap && REGISTRY[id].cap.alert);', to: 'return false;', expect: '但预警本身照旧' },
  { name: 'v97 空气质量那一问又只要四项（"国标"悄悄变成三项算的）', file: F.om, from: ',nitrogen_dioxide,sulphur_dioxide,carbon_monoxide&timezone=auto', to: '&timezone=auto', expect: '六项浓度都要了' },
  { name: 'v97 注册表把 wttr 的逐小时写成整点一档', file: F.wttr, from: '  hourlyStep: 3,', to: '  hourlyStep: 1,', expect: '档位与真报文实算的一致' },
  { name: 'v99 空气质量那一问不再走缓存（每拍敲一发第三方）', file: F.om, from: '    if (hit && Date.now() - hit.at < AIR_TTL) return hit.data;', to: '    void hit;', expect: '按坐标缓存 30 分钟' },
  { name: 'v99 空气那一问不合并并发（一轮催三发）', file: F.om, from: '    if (airInflight.has(k)) return airInflight.get(k);', to: '    void 0;', expect: '按坐标缓存 30 分钟' },
];
