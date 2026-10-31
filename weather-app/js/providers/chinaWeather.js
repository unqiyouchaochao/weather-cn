/* 数据源：中国天气（中央气象台 nmc.cn，与中国气象局同源数据）。
 *
 * 接口（2026-09 实测）：
 *   https://www.nmc.cn/rest/weather?stationid={站码}   —— CORS 全开、免密钥、无 Referer 限制
 * 一发返回 实况 real + 7 天 predict + 空气质量 air + 雷达，所以 AQI 不必再单独请求。
 *
 * 三个必须记住的坑：
 *   1) 站码是 nmc 自己的短码（北京=Wqsps、浦东=atcMf），只能查表 lib/nmc-stations.js。
 *      官方另一套 d1.weather.com.cn 要求 Referer 属于 weather.com.cn，浏览器改不了 Referer，
 *      所以那条路对纯静态应用是死的 —— 别再去试。
 *   2) 缺测值写 9999 / '9999'（气压、预警、部分降水），不当哨兵清掉就会显示 9999 hPa。
 *   3) 站点码表 70KB，用动态 import 按需加载，Open-Meteo 用户不必在启动时付这个代价。
 *
 * 该源没有逐小时**预报**（报文里的 passedchart 是过去 24 小时实测，不能当预报），cap.hourly=false，
 * 小时条与日卡下钻按能力自动隐藏。风速量纲是 m/s，标准对象基准是 km/h，要换算。
 */
import { fetchJson } from '../lib/util.js';
import { nightIcon, iconFromText } from '../lib/weather.js';
import { bestCity } from '../lib/geo.js';
import { fromWarn } from '../lib/alerts.js';

const API = 'https://www.nmc.cn/rest/weather?stationid=';
const MISSING = 9000;   // nmc 用 9999 表示缺测

/* ---------- 站点码表 ---------- */
let byName = null, withCoord = null, loading = null;
function ensureTable() {
  if (byName) return Promise.resolve();
  if (loading) return loading;
  loading = import('../lib/nmc-stations.js').then(m => {
    byName = {}; withCoord = [];
    const rows = String(m.NMC_ROWS).split(';');
    for (let i = 0; i < rows.length; i++) {
      const p = rows[i].split('|');
      if (!p[0] || !p[1]) continue;
      const s = { name: p[0], code: p[1], lat: p[2] === '' ? null : +p[2], lon: p[3] === '' ? null : +p[3] };
      if (s.lat != null) withCoord.push(s);
      (byName[s.name] = byName[s.name] || []).push(s);
    }
  }, e => {
    loading = null;
    throw new Error('中国天气站点码表加载失败：' + ((e && e.message) || e));
  });
  return loading;
}

const SUF = ['特别行政区', '自治区', '自治州', '自治县', '地区', '林区', '新区', '盟', '市', '区', '县', '旗'];
function stem(n) {
  for (let i = 0; i < SUF.length; i++) {
    const s = SUF[i];
    if (n.length > s.length && n.slice(-s.length) === s) return n.slice(0, -s.length);
  }
  return n;
}
// 重名时优先取带坐标的那个（共 7 组重名，如「朝阳」有北京朝阳与辽宁朝阳）
function prefer(arr) {
  for (let i = 0; i < arr.length; i++) if (arr[i].lat != null) return arr[i];
  return arr[0] || null;
}

/* 站名 → 站点：精确 → 剥行政后缀（朝阳区→朝阳）→ 补行政后缀（浦东→浦东新区）。
 * 第三档只认「站名 = 查询词 + 一个行政后缀」，不做任意前缀匹配 —— 否则「东京」会匹到
 * 黑龙江的「东京城镇」，把境外城市悄悄换成另一个中国地名，比直接报未收录更糟。 */
function stationByName(q) {
  const name = String(q || '').trim();
  if (!name || !byName) return null;
  if (byName[name]) return prefer(byName[name]);
  const ks = stem(name);
  if (ks !== name && byName[ks]) return prefer(byName[ks]);
  let best = null;
  for (const k in byName) {
    if (k.length <= name.length || k.slice(0, name.length) !== name) continue;
    if (!SUF.some(s => s === k.slice(name.length))) continue;
    if (!best || k.length < best.length) best = k;
  }
  return best ? prefer(byName[best]) : null;
}

/* 只有经纬度时就近选站（设备定位、纯坐标输入、带坐标的收藏键都走这里）。
 * hint 是调用方已知的地名（逆地理编码给的或用户搜的）。**平局必须按名字认**：码表里有 25 组
 * 站共用同一个中心点（离石/吕梁、曹妃甸/曹妃甸工业区、长沙市/长沙黄花…都是同城不同站），
 * 谁赢原本只取决于表的行序 —— 那等于随机拿隔壁站的数当这里的。 */
function stationByCoord(lat, lon, hint) {
  if (!withCoord || !withCoord.length) return null;
  const cos = Math.cos(lat * Math.PI / 180);
  let bd = Infinity, tied = [];
  for (let i = 0; i < withCoord.length; i++) {
    const s = withCoord[i];
    const dy = s.lat - lat, dx = (s.lon - lon) * cos;
    const d = dy * dy + dx * dx;
    if (d < bd - 1e-9) { bd = d; tied = [s]; }          // 更远一点的忽略
    else if (d <= bd + 1e-9) tied.push(s);              // 同距：攒起来按名字挑
  }
  if (Math.sqrt(bd) > 2.5) return null;                 // ≈280km 外视为不在覆盖内（境外/海上）
  if (tied.length < 2) return tied[0] || null;
  const q = String(hint || '').trim(), qs = q ? stem(q) : '';
  return tied.find(s => s.name === q || (qs && s.name === qs)) || tied[0];
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!isFinite(n) || Math.abs(n) >= MISSING) return null;
  return n;
}
// 实况描述缺测时源站直接给 '-'（三亚实测 info:'-'、img:'9999'），不清掉就会把横线当天气现象画出来
function txt(v) {
  const t = String(v == null ? '' : v).trim();
  if (!t || t === '-' || t === '9999' || t === '9999.0' || t === '暂无实况') return null;
  return t;
}
const hm = s => { const v = String(s || ''); return v.length >= 16 ? v.slice(11, 16) : ''; };

// 描述保留中国天气原文（"大到暴雨""雨夹雪"），只按文字推图标（表在 lib/weather.js，各家共用同一张）

/* 后台存活那份「配方」（android/WeatherKeepAliveService 按它在没有 WebView 的进程里拼通知）：
 * 只交代往哪个 URL 要报文、通知每一段从报文的哪个路径取值。天气与 AQI 的算法仍只有这一份，
 * 后台只是按路径取数 —— 在 Java 里再实现一套迟早和界面算不上。
 *
 * 路径写成「候选数组」，与 normalize 里 orv()/txt() 的退路一一对应（当天 20 点后 detail[0].day
 * 整格变 9999，最高气温要退到 tempchart）。温度与风一律是报文里的原始量纲（°C、m/s），
 * 显示成什么由 notify.js 按用户单位补上 tempUnit/windUnit，后台不做第二套判断。
 *
 * AQI 只在本站报文自己给了值时才交出去：城市榜与模型那两路是另一次请求，后台重建不出来，
 * 与其拿别处的数糊这一格，不如让它空着（宁缺勿错）。 */
function recipeFor(raw) {
  if (!raw || !raw.__url) return null;
  const d = raw.data || {};
  // 路径全部对着 2026-09-22 那一发真实报文核过：风在 real.wind 下（不在 weather 里），
  // tempchart 的日期字段叫 time，predict.detail 里当天那格过了 20 点整格变 9999 —— 所以候选数组
  // 的顺序必须和 normalize 里的退路一致，否则后台会比界面少一项。
  const tc = 'data.tempchart[time={today}]';
  /* 预报那一段**按日期取**，不按 [0] 取：normalize 会把早于报文当天的条目掐掉（见上），
   * 于是「界面里的今天」在 20 点前后可能落在 detail[0] 或 detail[1]。后台跨零点还要自己算「今天」，
   * 所以下标必须是它算出来的那个日期 —— 走 Java 端 resolve() 已有的 [字段={今天}] 匹配（tempchart 用的就是它）。 */
  const d0 = 'data.predict.detail[date={today}].';
  return {
    url: raw.__url,
    aqiLabel: num(((d.air || {}).aqi)) == null ? '' : '国控站实测 · 国标',
    paths: {
      temp: ['data.real.weather.temperature'],
      desc: ['data.real.weather.info', d0 + 'day.weather.info', tc + '.day_text', d0 + 'night.weather.info'],
      feels: ['data.real.weather.feelst'],
      humidity: ['data.real.weather.humidity'],
      wind: ['data.real.wind.speed'],
      tmax: [d0 + 'day.weather.temperature', tc + '.max_temp'],
      tmin: [d0 + 'night.weather.temperature', tc + '.min_temp'],
      aqi: ['data.air.aqi']
    },
    // 与 lib/alerts.js 的 fromWarn 同一套字段：id 由 url 前 6 位区县码 + 发布时刻组成，两边算出来一致，
    // 所以后台弹过的那条，前台再见到也不会重复吵一次
    alertPaths: {
      type: ['data.real.warn.signaltype'],
      level: ['data.real.warn.signallevel'],
      text: ['data.real.warn.issuecontent'],
      alt: ['data.real.warn.alert'],
      url: ['data.real.warn.url'],
      pic: ['data.real.warn.pic'],
      province: ['data.real.warn.province'],
      city: ['data.real.warn.city'],
      station: ['data.real.station.city']
    }
  };
}

function normalize(raw) {
  const d = raw.data || {}, r = d.real || {};
  const w = r.weather || {}, wd = r.wind || {}, sun = r.sunriseSunset || {};
  const at = hm(r.publish_time), sr = hm(sun.sunrise), ss = hm(sun.sunset);
  const isDay = !at || !sr || !ss ? true : (at >= sr && at <= ss);
  // 白天时段一过（实测 20:00 的报文），predict.detail[0].day 整格变成 9999，
  // 当天「最高气温」就查不到了 —— 退回 tempchart：按日的 max/min，覆盖过去 7 天 + 未来 7 天。
  const tc = {};
  (d.tempchart || []).forEach(x => {
    const k = String(x.time || x.date || '').replace(/\//g, '-').slice(0, 10);
    if (k) tc[k] = x;
  });
  const orv = (a, b) => (a == null ? num(b) : a);
  const detail = (d.predict && d.predict.detail) || [];
  const daily = [];
  for (let i = 0; i < detail.length; i++) {
    const p = detail[i] || {}, dw = (p.day || {}).weather || {}, nw = (p.night || {}).weather || {};
    const date = String(p.date || '').replace(/\//g, '-').slice(0, 10);
    const alt = tc[date] || {};
    const text = txt(dw.info) || txt(alt.day_text) || txt(nw.info) || '';
    daily.push({
      date: date,
      tmax: orv(num(dw.temperature), alt.max_temp), tmin: orv(num(nw.temperature), alt.min_temp),
      desc: text, code: txt(dw.img) || txt(alt.day_img), icon: iconFromText(text),
      precip: num(p.precipitation)
    });
  }
  /* 这份日预报窗口经常**从昨天开始**，两种情形（都实测过）：
   * ① 每天 20:00 那一版产品上线前，窗口还是前一天的 —— 同一站（新兴 guUOJ）09-24 17:13 拿到 09-23~09-29，
   *    二十分钟后变 09-24~09-30；② 零点之后到下一版产品之间，窗口整段滞后一天 —— 09-25 00:09 在红米上
   *    拿到的仍是 09-24~09-30（publish_time 就是 09-24 20:00）。照原样交出去，「未来预报」第一张卡与趋势图
   *    第一个点是昨天（真机：第一张「周四 22°/11°」打头、今天排第二），**主卡的最高/最低和常驻通知那一段
   *    跟着一起变成昨天的数**（ui.renderHeroCard 与 notify 都取 daily[0] 当今天）。
   * 下限必须取「报文自己的 publish_time」与「本地今天」里更晚的那个：只按 publish_time 是空操作 ——
   * 它的日期恒等于 detail[0].date，情形②一整天都砍不掉任何东西（上一轮就栽在这里）。
   * 用本地今天与原生配方里 `detail[date={today}]` 同一基准，两边才不会一个说今天一个说昨天；
   * 设备时钟错到把整份预报砍空时由下面那条退回兜住。 */
  const iso = s => String(s || '').replace(/\//g, '-').slice(0, 10);   // 该源日期两种写法都见过，归一到 yyyy-MM-dd 再比
  const nw = new Date();
  const todayLocal = nw.getFullYear() + '-' + String(nw.getMonth() + 1).padStart(2, '0') + '-' + String(nw.getDate()).padStart(2, '0');
  const pub = iso((d.predict || {}).publish_time);
  const floor = pub > todayLocal ? pub : todayLocal;
  let kept = daily.filter(x => !x.date || !floor || iso(x.date) >= floor);
  // 万一这一刀把整份预报掐空（报文日期换了写法、设备时钟跑得太前），宁可退回没过滤的那份：
  // 这一刀是修形，不是造数据，更不该把预报、当日高/低和通知那一段一起带走。
  if (!kept.length) kept = daily;
  /* 日出日落报文只给一组、就是今天的：挂在过滤后剩下的第一天，不再写死 detail[0]
   * （否则产品切换前那一组会被标到昨天头上）。ui 取的就是 daily[0]，见 renderDetails。 */
  if (kept[0]) {
    kept[0].sunrise = sr ? sun.sunrise : null;
    kept[0].sunset = ss ? sun.sunset : null;
  }
  // 实况描述缺测就退回今日白天文本，别让当前卡挂一个 '-'
  const desc = txt(w.info) || (kept[0] || {}).desc || '';
  return {
    current: {
      temp: num(w.temperature), feels: num(w.feelst), humidity: num(w.humidity),
      wind: num(wd.speed) == null ? null : Math.round(num(wd.speed) * 360) / 100,   // m/s → km/h（留两位，免得切回 m/s 时双重舍入）
      desc: desc, code: txt(w.img), icon: nightIcon(iconFromText(desc), isDay),
      pressure: num(w.airpressure),
      name: txt((r.station || {}).city)
    },
    hourlyByDay: {}, daily: kept,
    // 预警与实况同一条报文，白送：real.warn 没有预警时整串字段是 "9999"，由 fromWarn 判掉。
    // 省市之外的地名要补站点名 —— warn 自己只给到省市，不补就看不出是哪县发的（宁缺勿错）
    alert: fromWarn(r.warn, txt((r.station || {}).city)),
    recipe: recipeFor(raw)
  };
}

/* 天气与 AQI 在同一报文里：查过一次就先缓存，别让 loadAir 再打一发一样的请求。
 * 2026-10-18 之前这里只有**一格**且**永不过期**，两个毛病各对应一件真实的事：
 * ① 不过期 ⇒ 自动刷新每一拍拿回的都是同一份字节 —— 那一拍于是变成纯重绘 + 纯写盘 + 纯敲原生桥，
 *    屏上的数却永远不动。用户把间隔调到 15 秒看到的还是第一次那一发，这已经不是费电的问题了。
 * ② 只留一格 ⇒ 对比与轮播每换一座城就把上一座挤掉，缓存从不命中，N 座城就是 N 发现打的网络请求。
 * 时限取 60 秒：比 nmc 自己出实况的节奏短一个量级，又足够把「同一轮里天气与空气问的是同一发」
 * 这一件正事办成；默认的 5 分钟间隔因此每拍都是真数据，只有把间隔调到一分钟以内才会看到去重。
 * 槽位取 8：对比页最多并排几座城加当前一座，再多就是拿内存换命中率，没有意义。 */
const STATION_TTL = 60 * 1000, STATION_SLOTS = 8;
const memo = new Map();          // 站码 -> { raw, at }（Map 的插入序就是最近使用序，淘汰取第一个键）
async function fetchStation(s) {
  const hit = memo.get(s.code);
  /* age 为负也算过期：手机改过系统时间是常事（回归里更是直接把表针拨起来量），
   * 一份「来自未来」的报文不该被当成还新鲜 —— 那样一次拨表就能把这座城的缓存钉死一小时。 */
  if (hit) {
    const age = Date.now() - hit.at;
    if (age >= 0 && age < STATION_TTL) return hit.raw;
  }
  memo.delete(s.code);                                  // 过期的那一格要让位，否则淘汰顺序会被它占着
  const url = API + encodeURIComponent(s.code);
  const raw = await fetchJson(url, 8000);
  if (!raw || !raw.data || !raw.data.real) throw new Error('中国天气网无「' + s.name + '」站点数据');
  // 后台存活要按同一发 URL 自己再取一次报文，所以把 URL 一起挂在报文体上带出去
  raw.__url = url;
  while (memo.size >= STATION_SLOTS) memo.delete(memo.keys().next().value);
  memo.set(s.code, { raw, at: Date.now() });
  return raw;
}
async function resolve(lat, lon, city) {
  await ensureTable();
  const s = (lat != null && lon != null && stationByCoord(lat, lon, city)) || stationByName(city);
  if (s) return s;
  throw new Error('中国天气网未收录该地（多为新设区划或境外），换一个上级市名再试');
}

export const chinaWeather = {
  id: 'nmc',
  label: '中国天气（中央气象台）',
  needsKey: false,
  note: '免密钥、免接口地址：全国 2529 个站点码表已内置在应用里，选中即可用。该源给实况 + 7 天 + 中国 AQI，没有逐小时预报（「今日天气」那栏会另取 Open-Meteo 的模型值，并在卡上写明出处）。约四成站点 AQI 缺测（含温州、唐山、云浮），缺的站先退全国城市榜（全市实测国标），再退 Open-Meteo 的模型值（美标）；卡上那行徽章写的就是这一组数实际来自哪一路。',
  cap: { byCityName: false, air: true, hourly: false, daily: true, background: true, alert: true },
  // 中国 AQI 来自国控/省控站实测发布，口径就是国标；但约四成站点缺测（air 为空串或 9999）。
  // 只给指数不给浓度，所以「切美标」在这一源上换不动，pickAir 会把原因带回卡上。
  airLabel: '国控站实测',
  airStd: 'cn',

  async geocode(city) {
    await ensureTable();
    const s = stationByName(city);
    // 表里有就直接用表里的坐标，一次外部检索都不用打；没有才交给通用检索器（报错文案也由它给）
    if (s && s.lat != null) return { lat: s.lat, lon: s.lon, name: s.name, admin: '', country: '中国' };
    return bestCity(city);
  },

  weather(lat, lon, city) { return resolve(lat, lon, city).then(fetchStation); },

  /* 落点是哪个站 —— 不发包就能问出来。回归用它钉「坐标 → 站」这层映射，
   * 界面上它也是出处的一部分：站名与所查城市不一致时，就该让人看见。 */
  stationFor(lat, lon, city) { return resolve(lat, lon, city); },

  // 中国 AQI 的分级断点与 lib/weather.js 的 AQI_LEVELS 完全一致，标签可直接复用；
  // 但该源不给 PM2.5/PM10/O₃ 分项浓度，缺字段由 ui 层自动不画。
  airQuality(lat, lon) {
    return resolve(lat, lon, null).then(fetchStation).then(raw => {
      const v = num(((raw.data || {}).air || {}).aqi);
      return v == null ? null : { current: { us_aqi: v, pm2_5: null, pm10: null, ozone: null } };
    });
  },

  normalize(raw) { return normalize(raw); }
};
