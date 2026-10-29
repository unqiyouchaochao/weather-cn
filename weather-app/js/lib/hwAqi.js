/* 华为天气「全国城市空气质量榜」—— 作为 AQI 链的第二级兜底。
 *
 * 为什么值得加：中国天气站点 AQI 实测约 38% 缺测（温州、唐山、云浮、黔东南…都在里面），
 * 缺的那些现在直接掉到 Open-Meteo 的 CAMS **模型值 + 美标**。这个榜给的是**城市级实测 + 国标**，
 * 精度高一档，还顺带带来一个原来根本没有的信息：全国排名。
 *
 * 实测（2026-09-22）：
 *   GET https://weather-drcn.weather.dbankcloud.cn/v2/weather/aqi/page/query?startIndex=1&endIndex=400&isAscend=1
 *     → code:"0"，data.pmlist 共 360 条（**全是地级市/州/盟，不含县**），43KB。
 *     → 免密钥免签名：bundle 里那串 Authorization:appId=… 根本不必带，光秃秃一发就 200。
 *     → Access-Control-Allow-Origin: *，而且不需要任何自定义头 = 不触发预检，浏览器与原生壳同样可用。
 *        （顺带：就算带 Authorization/timestamp 也通，OPTIONS 预检回 204 且 Allow-Headers 里有它们。）
 *   GET …/aqi/rank/query?cityCode={榜单里的 cityCode} → {orderNum,totalNum}；给它一个县码（如新兴 58258）
 *     回 code:"10123" "no data" —— 印证了榜里只有地级市。本模块不需要它，排名直接从全榜算。
 *   条目：{cityProv 省, cityName 市, cityCode 华为内部码, aqi 数值, lv 1..?, lvDesc 优/良/轻度…, orderNum 名次}
 *
 * 与自家那一条链的口径对齐（宁缺勿错）：
 *   - 榜上 aqi 是**城市**的数，不是用户所在县的。所以卡上必须带市名，
 *     写成「华为天气 · 云浮市 全市」而不是光秃秃一个 AQI —— 用户在新疆看着"云浮"两个字就该知道不对。
 *   - 只给指数不给六项浓度，所以「切美标」在这里换不动，由 lib/aqi.js 的 pickAir 把原因带回卡上。
 *   - 榜单没有经纬度，只能按**地名**匹配：先反查地址（lib/geo.js，30 天缓存），
 *     再在地址串里取「出现最早、名字最长」的那个地级市。地址串是「市 · 区县 · 街道 · 路」的顺序，
 *     最前面的就是本级市；像上海话里出现「铜仁路」这种撞名，靠位置先后而不是靠枚举黑名单。
 *   - 匹配不上就返回 null，让链子继续往 Open-Meteo 走，绝不硬配一个邻近城市。
 */
import { fetchJson } from './util.js';
import { reverseGeo } from './geo.js';

const API = 'https://weather-drcn.weather.dbankcloud.cn/v2/weather/aqi/page/query?startIndex=1&endIndex=400&isAscend=1';
/* 30 分钟（原来是 10 分钟）：这一份是 360 城的榜，一发 43KB，而榜本身是小时级发布的。
 * 开着自动刷新时 10 分钟那一档等于每 10 分钟重下一遍全榜，只为给一座城取一个数。
 * 与 Open-Meteo 空气质量那一份缓存（providers/openMeteo.js）同档，免得两级的新旧口径不一致。 */
const TTL = 30 * 60 * 1000;
const LS = 'weather-hw-rank';
const CN_BOX = { n: 53.6, s: 3.5, w: 73.5, e: 135.1 };   // 榜内全是中国城市，境外坐标直接不做这一步

let mem = null, inflight = null;

function readDisk() {
  try {
    const d = JSON.parse(localStorage.getItem(LS));
    if (d && d.at && Array.isArray(d.list)) return d;
  } catch (e) { /* 没有或坏了当没有 */ }
  return null;
}

function fetchRank() {
  const now = Date.now();
  if (!mem) { const d = readDisk(); if (d) mem = d; }
  if (mem && now - mem.at < TTL) return Promise.resolve(mem.list);
  if (inflight) return inflight;                 // 并发合并成一发（见 lib/alerts.js 那条教训）
  inflight = fetchJson(API, 9000)
    .then(j => {
      const raw = ((j || {}).data || {}).pmlist || [];
      const list = raw.filter(x => x && x.cityName).map(x => ({
        city: String(x.cityName),
        prov: String(x.cityProv || ''),
        aqi: Number(x.aqi),
        order: Number(x.orderNum),
        total: 0
      })).filter(x => isFinite(x.aqi) && x.aqi > 0);
      list.forEach(x => { x.total = list.length; });
      if (list.length) mem = { at: Date.now(), list: list };
      try { localStorage.setItem(LS, JSON.stringify(mem)); } catch (e) { /* 内存里还留着 */ }
      return mem ? mem.list : [];
    })
    .catch(e => { if (mem) return mem.list; throw e; });
  inflight.then(() => { inflight = null; }, () => { inflight = null; });
  return inflight;
}

/* 地址串里挑「出现最早、并列时名字更长」的那个地级市。
 * **只在行政那几段里找**（市/区/县/州/盟/旗），路名段一概不看 —— 2026-10-01 在兰州就是栽在这一条上：
 * 反查串是「蘭州市 · 城关区 · 张掖路街道 · 酒泉路」，本级市名是繁体「蘭州市」对不上榜内的简体「兰州市」，
 * 于是整串扫描让路名里的「张掖」赢了，屏上写着兰州、数却是张掖市（92 vs 站 62）。
 * 繁体那一半已在 lib/geo.js 补了归一，但**光靠补字表是补不完的**（24 个城市里 8 个繁体、1 个拼音），
 * 所以这一刀才是主修：一段「张掖路街道」压根不该进候选，进不去就不会有「拿别市顶本市」这种错。
 * 判据按段的**结尾**问：结尾是行政级号的段才当候选，其余（街道/路/巷/村/社区/大字）一律丢。
 * 导出只为让回归能直接喂一条地址串看它挑中谁；界面那一侧走 cityAqi。 */
const ADMIN_SEG = /(市|区|县|州|盟|旗|地区)$/;
const NOT_CITY_SEG = /(省|自治区|特别行政区|街道|路|巷|弄|村|社区|组|队|大道)$/;
export function matchCity(list, addr) {
  const segs = String(addr || '').split(' · ').map(s => s.trim()).filter(Boolean);
  let best = null;
  segs.forEach((seg, si) => {
    if (!ADMIN_SEG.test(seg) || NOT_CITY_SEG.test(seg)) return;
    for (const e of list) {
      const stem = e.city.replace(/[市州区]$/, '').replace(/(自治州|地区|盟)$/, '');
      for (const cand of [e.city, stem]) {
        if (cand.length < 2 || seg.indexOf(cand) !== 0) continue;   // 必须是段首，不做整串包含
        const at = si * 1000 + seg.length - cand.length;            // 先比段序，同段内再比谁更长
        if (!best || at < best.at) best = { at: at, e: e };
      }
    }
  });
  return best ? best.e : null;
}

/** 坐标 → 该地所属地级市的榜单 AQI。取不到（境外/榜内没有/反查失败）一律 null，让链子继续兜底。 */
export function cityAqi(lat, lon) {
  const la = Number(lat), lo = Number(lon);
  if (!isFinite(la) || !isFinite(lo)) return Promise.resolve(null);
  if (la < CN_BOX.s || la > CN_BOX.n || lo < CN_BOX.w || lo > CN_BOX.e) return Promise.resolve(null);
  return Promise.all([reverseGeo(la, lo).catch(() => ''), fetchRank().catch(() => [])])
    .then(r => {
      const addr = r[0] || '';
      if (!addr) return null;
      const hit = matchCity(r[1], addr);
      if (!hit) return null;
      return {
        current: { us_aqi: hit.aqi, pm2_5: null, pm10: null, ozone: null },
        // 徽章上只写「云浮市 全市」—— 用户要求不出现厂商字样，但**市名必须留着**：
        // 这是本市/本县的数还是上级市的数，全靠这几个字区分（宁缺勿错）。
        src: hit.city + ' 全市',
        std: 'cn',
        rank: { order: hit.order, total: hit.total, city: hit.city, prov: hit.prov }
      };
    });
}

/** 全国城市榜全量（点空气质量卡进去看的那个列表）。缓存与上面同一份，不额外请求 */
export function rankList() {
  return fetchRank();
}
