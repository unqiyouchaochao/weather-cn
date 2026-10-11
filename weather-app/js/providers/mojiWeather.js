/* 墨迹天气（网页版 tianqi.moji.com）—— **只在手机 App 里可用**。
 *
 * 三条实测决定了这个形状（2026-09-27，全部是真打过并读到过响应的请求，没有猜的地址）：
 *   1) 裸 UA（curl/8.x 之类）打过去是 `418 访问被拦截`（华为云 CloudWAF），带浏览器 UA 才 200；
 *   2) 它所有接口的响应里**一个 `access-control-*` 头都没有** ⇒ 浏览器版必被 CORS 拦，
 *      只有原生 HTTP（CapacitorHttp，不受同源策略约束）拿得到 —— 与新闻「政策」那一栏同一处境；
 *   3) 逐小时的 `/index/getHour24` 不带任何参数，城市由 cookie `moji_setting={"internal_id":N}` 决定。
 *      验证方式是换城市：郑州(id 489) 回 `id:379`、新兴(1285) 回 `id:1016`，跟着 cookie 走，
 *      不是按 IP 定位；而 `id` 能从 `/api/citysearch/{城市名}` 直接查到，所以 **cookie 由我们自拼**，
 *      不依赖「读完 Set-Cookie 再带回去」（CapacitorHttp 未必要把 Set-Cookie 交回 JS）。
 *
 * 它能给什么：实况、今起三天、逐小时（滚动 24 小时，不是整天 00–23）、中国 AQI、气象预警。
 * 它不能给什么：7/15 天（要另敲 forecast7 那一页，多一次第三方请求，先不做）、站点级实测。
 * 逐日卡因此只有三张 —— 少几天不是错，拿别处的数凑成七天才是。
 *
 * ⚠ 这是逆向来的接口，没有任何兼容性承诺。所有失败路径都必须明确报错，让界面写「墨迹不可用」，
 *   而不是把上一次刷新或别的城市的数留在屏幕上（宁缺勿错）。 */
import { isNative } from '../lib/locate.js';
import { iconFromText, nightIcon } from '../lib/weather.js';
import { bestCity, placeNames, isPlaceName } from '../lib/geo.js';

const HOST = 'https://tianqi.moji.com';
// 墨迹的 WAF 认这个；换城市/换 UA 都可能变，变了就是这一行 + 下面那句 418 的报错文案要跟着改
const UA = 'Mozilla/5.0 (Linux; Android 15; 23013RK75C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const COOKIE = 'moji_setting=%7B%22internal_id%22%3A%s%7D';   // {"internal_id":N}

function http() {
  const H = isNative() && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
  if (!H) throw new Error('墨迹天气的接口不给浏览器放行跨域，这一项只能在手机 App 里用');
  return H;
}

function get(url, cookie, hop) {
  const headers = { 'User-Agent': UA, Accept: '*/*', Referer: HOST + '/' };
  if (cookie) headers.Cookie = cookie;
  return http().get({ url: url, headers: headers, responseType: 'text' }).then(r => {
    const st = r && r.status;
    if (st === 418) throw new Error('墨迹天气的防火墙把这次请求拦了（418）');
    if (st >= 400) throw new Error('墨迹天气 HTTP ' + st);
    // CapacitorHttp **不自己跟 301**（实测 /weather/china 回 301 + 180 字节的跳转壳），
    // 跟着走一次；还跳就是它的路径改了，明确报错比拿一张壳去解析好
    if (st >= 300 && st < 400) {
      const loc = (r.headers && (r.headers.Location || r.headers.location)) || '';
      if (!loc || hop) throw new Error('墨迹把这一发重定向到「' + (loc || '（没给 Location）') + '」，这一路没有接着跟下去');
      return get(loc, cookie, 1);
    }
    const body = typeof r.data === 'string' ? r.data : JSON.stringify(r.data || '');
    // 他们有一手：过载时回 200 + 「Server is busy」，按状态码判是判不出来的
    if (!body || body.indexOf('Server is busy') >= 0) throw new Error('墨迹天气暂时不可用（回了 200 但正文是 Server is busy）');
    return body;
  });
}

function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch (e) { return {}; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 存不下就每次多查一发，不影响正确性 */ } }

/* ---------- 地名 → 墨迹的 internal_id ---------- */
const SUF = ['特别行政区', '自治区', '自治州', '自治县', '地区', '盟', '市', '区', '县', '旗'];
function stem(n) {
  const s = String(n || '').trim();
  for (let i = 0; i < SUF.length; i++) {
    const x = SUF[i];
    if (s.length > x.length && s.slice(-x.length) === x) return s.slice(0, -x.length);
  }
  return s;
}
const stripAdm = s => String(s || '').replace(/(特别行政区|自治区|自治州|地区|省|市|区|县|旗|盟)$/, '');

/** 同名不同省是「自动挑名」这一路真正的坑：反查到的「朝阳区」，墨迹的检索会同时回北京那个和
 *  长春那个，取第一条等于随机选一座城。带 hint（同一坐标反查链上的其它地名，如「北京市」）时
 *  就在并列的多条里挑省名能对上 hint 的那条。**只用来在并列里做选择，不做一票否决** ——
 *  「新兴县」的省名是「广东」，而链上只有云浮市/新兴县，硬要求对上会把对的那条否掉。 */
function chooseCity(pool, hint) {
  if (pool.length < 2 || !hint || !hint.length) return pool[0];
  const hit = pool.filter(c => {
    const p = stripAdm(c.pname);
    return p && hint.some(h => stripAdm(h) === p);
  });
  return hit.length ? hit[0] : pool[0];
}

const KEY = 'weather-moji-city';
/* 缓存的键要带上「是替谁查的」：用户打的「朝阳区」与北京坐标反查出来的「朝阳区」是两条不同的
 * 判定（前者没有线索、只能取检索第一条）。共用一个键的话先打过的那一条会被后一个直接继承 ——
 * 于是北京坐标拿到长春的朝阳区。带上线索首段（地级市）之后两边各存各的。 */
const cacheKey = (name, hint) => name + (hint && hint.length ? '@' + hint[0] : '');
function cachedId(name, hint) {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) || '{}');
    return m[cacheKey(name, hint)] || null;
  } catch (e) { return null; }
}
function rememberId(name, hint, c) {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) || '{}');
    m[cacheKey(name, hint)] = c;
    const ks = Object.keys(m);
    if (ks.length > 80) delete m[ks[0]];     // 城市 id 不会变，但别让它无限长
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch (e) { /* 存不下就每次多查一发，不影响正确性 */ }
}

/** 用墨迹自己的检索定城市。**只认名字精确相等**：查「新兴县」它会同时回「新昌县」，
 *  拿第一条就是拿浙江的县糊广东的县。认不出就报错，不许退到「最像的那条」。 */
function cityOf(name, hint) {
  const hit = cachedId(name, hint);
  if (hit) return Promise.resolve(hit);
  const url = HOST + '/api/citysearch/' + encodeURIComponent(name);
  return get(url).then(txt => {
    let j;
    try { j = JSON.parse(txt); } catch (e) { throw new Error('墨迹检索回的不是 JSON'); }
    const want = stem(name);
    const list = (j && j.city_list) || [];
    const exact = list.filter(c => c.name === name);
    const same = exact.length ? exact : list.filter(c => stem(c.name) === want && c.counname === '中国');
    if (!same.length) throw new Error('墨迹天气没有收录「' + name + '」，换这个源先手动搜一个它认的城市');
    const c = chooseCity(same, hint);
    const out = { id: c.id, name: c.name, pname: c.pname || '', coun: c.counname || '中国' };
    rememberId(name, hint, out);
    return out;
  });
}

/* 反查地名这一步在回归里换成假的：真要跑就是两次公网往返，而且给什么取决于当天 OSM 的数据。
 * 换反查源等于换了一整个世界，那笔「这名字它没收录」的账（下面 missed）跟着作废。
 * 只给测试用；删掉或改名，app.checks.mjs 里「坐标点」那几条断言会跟着红。 */
let places = placeNames;
export function usePlaceNames(fn) { places = fn || placeNames; missed.clear(); }

/* 一个名字确认「墨迹没收录」之后记 10 分钟（只在本会话内）。收藏名很可能是「某某大学」「某某小区」
 * 这种它根本不收的叫法，而自动刷新每半分钟一轮 —— 不记这笔账就是每轮都为它敲一发检索、
 * 失败、再走反查，白打一次第三方。网络类错误（418、过载）不进这笔账，原样抛。 */
const missed = new Map();
const MISSED_TTL = 10 * 60 * 1000;
async function tryCity(name, hint) {
  if (!name) return null;
  const at = missed.get(name);
  if (at && Date.now() - at < MISSED_TTL) return null;
  try { return await cityOf(name, hint); }
  catch (e) {
    if (/没有收录/.test(e && e.message ? e.message : String(e))) { missed.set(name, Date.now()); return null; }
    throw e;
  }
}

/** 墨迹只认地名，而递到手上的经常是「我的位置」这种占位符（坐标收藏键的默认名）。
 *  先试给过来的名字，认不出就拿坐标反查这一带的行政区名，挑一个它收录的 —— 区县优先、市兜底。
 *  一个都不认就明确报错，绝不退到「最像的那个城市」（宁缺勿错）。 */
async function realName(given, lat, lon) {
  const name = String(given || '').trim();
  if (name && !isPlaceName(name)) {
    if (await tryCity(name, null)) return { name: name, hint: null };
  }
  const tried = [];
  const note = n => { if (n && tried.indexOf(n) < 0) tried.push(n); };
  note(name);
  if (lat == null || lon == null) {
    throw new Error('墨迹天气没有收录「' + (name || '（这一条既没有地名也没有坐标）') + '」，换这个源先手动搜一个它认的城市');
  }
  const cands = await places(lat, lon);
  if (!cands.names.length) {
    // 反查两个源都没回（或被限流）：说清是「认不出这一带叫什么」，别退成一句含糊的「没有收录」
    throw new Error('墨迹天气按城市名取数，而这个坐标反查不出地名（两个反查源都没回）—— 手动搜一个城市名再收藏，或换一家源');
  }
  for (const n of (cands.names || [])) {
    note(n);
    if (await tryCity(n, cands.hint)) return { name: n, hint: cands.hint };
  }
  throw new Error('墨迹天气没有收录这一带（试过「' + tried.join('」「') + '」），换这个源先手动搜一个它认的城市');
}

/* ---------- 页面地址：墨迹的 URL 是英文 slug，不是中文名 ----------
 * 2026-09-29 真机量的：按「/weather/中国/广东省/新兴县」拼过去，回的是 **200 + 一张 p404 模板**
 * （8925 字节，类名里就写着 p404_icon）—— 状态码看不出问题，界面会被画成一张「全 --」的空屏。
 * 有数据的那份页面在 `/weather/china/guangdong/xinxing-county`，而 slug 是墨迹自己的翻译表
 * （「新兴县」→ xinxing-county、「云城区」→ yuncheng-district、连 `yu'nan-county` 都带撇号），
 * 我推不出来，也不该猜 —— 只能从它自己的两级索引页里读：
 *   /weather1/china          → 「广东」→ /weather/china/guangdong（31 条，一份）
 *   /weather/china/{省}       → 「新兴县」→ …/xinxing-county（一省一份，广东 290 条）
 * 两张表都进 localStorage，所以只有第一次遇到某个省才多两发请求。
 * 匹配只认**页面上那条链接的文字与城市名相等**（剥一层行政后缀、且必须唯一），
 * 认不出或并列多条就明确报错 —— 拿隔壁县/别省的 slug 当这一条，是这一路最贵的错。 */
const PROV_URL = HOST + '/weather1/china';
const PROV_KEY = 'weather-moji-prov';
const URL_KEY = 'weather-moji-url';

/** 从一张索引页里取出「中文名 → 省 slug / 市 slug」；只有 /weather/china/x 这一形态算 */
function indexLinks(html) {
  const d = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  [].slice.call(d.querySelectorAll('a[href]')).forEach(a => {
    const m = String(a.getAttribute('href') || '').match(/\/weather\/china\/([a-z0-9'-]+)(?:\/([a-z0-9'-]+))?$/i);
    const name = (a.textContent || '').trim();
    if (m && name) out.push({ name: name, prov: m[1], city: m[2] || '' });
  });
  return out;
}

/** 省表：每次都要就先读那 13KB 的一页，读过就进 localStorage。
 *  刻意不另存一份内存 promise —— 那一发失败时内存里留着一个 rejected promise，
 *  之后每一轮刷新都会继承那句旧错（通知配方那一类「丢一次就永久分家」的坑，见 lib/notify.js）。 */
function provinceTable() {
  const cached = lsGet(PROV_KEY);
  if (cached._n) return Promise.resolve(cached);
  return get(PROV_URL).then(html => {
    const t = { _n: 1 };
    indexLinks(html).filter(x => !x.city).forEach(x => { if (!(x.name in t)) t[x.name] = x.prov; });
    if (Object.keys(t).length < 2) throw new Error('墨迹的省列表页读不出省份（页面改版了？）');
    lsSet(PROV_KEY, t);
    return t;
  });
}

/** 一省一份城市表；建好后连同省名一起存，下次同一省任何城市都不再敲索引页 */
function cityTable(prov) {
  const store = lsGet(URL_KEY);
  const hit = store[prov];
  if (hit && hit._n) return Promise.resolve(hit);
  return get(HOST + '/weather/china/' + encodeURIComponent(prov)).then(html => {
    const t = { _n: 1 };
    indexLinks(html).filter(x => x.city).forEach(x => { if (!(x.name in t)) t[x.name] = x.city; });
    if (Object.keys(t).length < 2) throw new Error('墨迹「' + prov + '」那份城市表读不出城市（页面改版了？）');
    store[prov] = t;
    const ks = Object.keys(store);
    if (ks.length > 8) ks.filter(k => k !== prov).forEach(k => delete store[k]);   // 一省约 6KB，最多留 8 省
    lsSet(URL_KEY, store);
    return t;
  });
}

/** 「广东省」→ guangdong：省名两边都剥掉行政后缀再比 */
function findProv(t, pname) {
  const want = stripAdm(pname);
  if (!want) return '';
  const ks = Object.keys(t).filter(k => k !== '_n' && stripAdm(k) === want);
  return ks.length ? t[ks[0]] : '';
}
function findCity(t, name) {
  if (name in t) return t[name];
  const want = stripAdm(name);
  const ks = Object.keys(t).filter(k => k !== '_n' && stripAdm(k) === want);
  return ks.length === 1 ? t[ks[0]] : '';      // 并列多条就不猜
}

/** 城市页的真正地址。索引页读回来的都是 slug，所以这条链上没有我编出来的字符串 */
async function pageUrl(c) {
  const prov = findProv(await provinceTable(), c.pname);
  if (!prov) throw new Error('墨迹的省列表里没有「' + c.pname + '」，这一条页面地址拼不出来');
  const slug = findCity(await cityTable(prov), c.name);
  if (!slug) throw new Error('墨迹「' + c.pname + '」那份城市表里没有「' + c.name + '」，换一个它认的城市名');
  return HOST + '/weather/china/' + prov + '/' + encodeURIComponent(slug);
}

/* ---------- HTML 解析 ---------- */
const NUM = s => { const n = parseFloat(String(s == null ? '' : s).replace(/[^\x2d0-9.]/g, '')); return isFinite(n) ? n : null; };

export function parsePage(html) {
  const d = new DOMParser().parseFromString(html, 'text/html');
  const t = el => (el && el.textContent || '').trim();
  const title = t(d.querySelector('title'));            // 【新兴县天气】_… —— 用来复核我们没拿错地方
  const weather = d.querySelector('.wea_weather');
  const about = d.querySelector('.wea_about');
  const descImg = weather && weather.querySelector('span img');
  const aqiEm = d.querySelector('.wea_info .wea_alert li:not(.warning_aqi) em');   // 「20 优」
  const warn = d.querySelector('.wea_info li.warning_aqi em');                     // 「高温 黄色」
  const days = [].slice.call(d.querySelectorAll('.forecast ul.days')).map(ul => {
    const li = [].slice.call(ul.querySelectorAll(':scope > li')).map(t);
    const pair = String(li[2] || '').split('/');
    return { label: li[0] || '', desc: li[1] || '', lo: NUM(pair[0]), hi: NUM(pair[1]), wind: (li[3] || '').trim() };
  }).filter(x => x.label);
  return {
    title: title,
    city: (title.match(/【([^】]+)天气】/) || [])[1] || '',
    temp: weather ? NUM(weather.querySelector('em') && weather.querySelector('em').textContent) : null,
    desc: t(weather && weather.querySelector('b')) || (descImg && descImg.getAttribute('alt')) || '',
    uptime: t(weather && weather.querySelector('.info_uptime')),
    humidity: about ? NUM((t(about.querySelector('span')).match(/(\d+)\s*%/) || [])[1]) : null,
    windText: t(about && about.querySelector('em')),
    aqi: aqiEm ? NUM((t(aqiEm).match(/(\d+)/) || [])[1]) : null,
    aqiLabel: t(aqiEm),
    warn: t(warn),
    days: days
  };
}

/** 滚动 24 小时 → 按天分组的逐小时（我们的「今日天气」要的是「今天 00–23」，
 *  所以这一栏在墨迹下只会画出当天剩下的几个小时 —— 缺的上午几格是「源没给」，不替它编）。 */
export function parseHour24(body) {
  let j;
  try { j = JSON.parse(body); } catch (e) { throw new Error('墨迹逐小时回的 JSON 解析不了'); }
  const list = (j && j.hour24) || [];
  const pad = n => (n < 10 ? '0' + n : '' + n);
  const byDay = {};
  for (const h of list) {
    if (!h || !h.Fpredict_date) continue;
    const hh = Number(h.Fpredict_hour);
    if (!isFinite(hh)) continue;
    const time = h.Fpredict_date + 'T' + pad(hh) + ':00';
    const desc = String(h.Fcondition || '').trim();
    const isDay = hh >= 6 && hh < 19;                    // 墨迹没给昼夜标志，按小时推（它的图标表也是这个分界）
    const icon = iconFromText(desc);
    (byDay[h.Fpredict_date] = byDay[h.Fpredict_date] || []).push({
      time: time, temp: NUM(h.Ftemp), feels: NUM(h.Ffeelslike), humidity: NUM(h.Fhumidity),
      wind: NUM(h.Fwspd),                               // 实测是 km/h（7.2 = 2 级）
      desc: desc || '未知', icon: nightIcon(icon, isDay), code: h.Fcondition_id, isDay: isDay
    });
  }
  Object.keys(byDay).forEach(k => byDay[k].sort((a, b) => (a.time < b.time ? -1 : 1)));
  return byDay;
}

/* 报文里的时刻都是源当地（中国单时区）写的，用「滚动 24 小时的第一格 = 下一小时」反推此刻，
 * 全程只做 Date 的本地加减，不引设备时区参与换算 */
function nowAt(byDay) {
  const days = Object.keys(byDay).sort();
  if (!days.length) return '';
  const first = byDay[days[0]][0];
  const t = new Date(first.time.replace('T', 'T') + ':00');
  if (isNaN(t.getTime())) return '';
  t.setHours(t.getHours() - 1);
  const pad = n => (n < 10 ? '0' + n : '' + n);
  return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()) + 'T' + pad(t.getHours()) + ':' + pad(t.getMinutes());
}

const RANK = { '红色': 4, '橙色': 3, '黄色': 2, '蓝色': 1 };
function alertFrom(pageText, city) {
  const s = String(pageText || '').trim();
  const m = s.match(/^(.+?)\s*(红色|橙色|黄色|蓝色)/);
  if (!m) return null;
  const rank = RANK[m[2]];
  return {
    id: 'moji:' + city + ':' + m[1], name: m[1].trim(), levelName: m[2], rank: rank,
    color: { 4: '#c0392b', 3: '#e67e22', 2: '#f1c40f', 1: '#2980b9' }[rank],
    title: m[1].trim() + m[2], text: s, guide: '', issuedAt: '', adcode: '',
    // 预警卡顶上那行出处：墨迹页上那条信号是它自己发布的，不是中央气象台那张网发的，
    // 写错出处就是骗人（界面那行读这个字段，见 ui.renderAlerts）
    src: '墨迹天气发布'
  };
}

/* AQI 就在天气那一页的 HTML 里，墨迹没有单独的空气接口。而界面那条空气链会再问一次
 * `airQuality(lat, lon)` —— 这一源**不能**从坐标反推城市（反查挑到的可能不是刚才取数那个），
 * 所以只认「刚为同一坐标取过数」留下的那一份：对不上就返回 null，
 * 让链子退到城市榜／模型值那一级（卡上的出处会跟着换），绝不拿别城的数顶上。 */
const AIR_TTL = 5 * 60 * 1000;
let airMemo = null;

async function fetchAll(lat, lon, city) {
  const want = await realName(city, lat, lon);
  const c = await cityOf(want.name, want.hint);
  const html = await get(await pageUrl(c));
  const page = parsePage(html);
  // 「200 但页里什么都没有」必须当场报错：拿中文路径去过一回，回来的是 200 + p404 模板，
  // 于是界面画成一张全 -- 的屏 —— 空屏会被读成「今天没数据」，而实际是这一路坏了（宁缺勿错）
  if (!page.city && page.temp == null && !page.days.length) {
    throw new Error('墨迹这一页里没有天气数据（页面改版，或这一条地址不对）');
  }
  // 页面标题与要查的地方对不上就是拿错了，宁可不显示（墨迹自己的检索同名不同省）
  if (page.city && page.city !== c.name) throw new Error('墨迹这个页给的是「' + page.city + '」，不是「' + want.name + '」');
  const hour = await get(HOST + '/index/getHour24', COOKIE.replace('%s', String(c.id))).then(parseHour24, () => ({}));
  airMemo = (lat == null || lon == null) ? null
    : { la: Number(lat), lo: Number(lon), at: Date.now(), aqi: page.aqi };
  return { __page: page, __hour: hour, __city: c, __name: want.name };
}

export const mojiWeather = {
  id: 'moji',
  label: '墨迹天气（逆向，仅手机 App）',
  needsKey: false,
  nativeOnly: true,
  note: '逆向自墨迹网页版：接口不放行浏览器跨域，只有 App 里（原生 HTTP）拿得到，所以桌面浏览器选中它必然报错。逐小时是「从现在起滚动 24 小时」，当天上午的几格源不给就不画；逐日只给今起三天。数据是它自己的模型与发布口径，没有站点实测。',
  // alert：城市页的 `.warning_aqi` 那一条（它转的也是气象局的信号，但出处记在它自己名下）。
  // background:false —— 后台那一路要的是「URL + JSON 路径」那份配方，墨迹的实况在 HTML 页里，给不出。
  cap: { byCityName: false, air: true, hourly: true, daily: true, alert: true },
  // 它给的是中国 AQI 指数本身，不给分项浓度 ⇒ 切美标换不动，aqiStd 让 ui 知道该写明原因
  airLabel: '墨迹天气发布',
  airStd: 'cn',

  // 检索走我们自己的三层中文检索（lib/geo.js）—— 墨迹的 citysearch 只用来定 id，
  // 认不出「我筛出的候选是不是同一座城」这种问题。选中这一源之后在框里打城市名，靠的就是它。
  geocode: bestCity,

  async weather(lat, lon, city) { return fetchAll(lat, lon, city); },

  // 见上面 airMemo 那段：只回答「刚才为这个坐标取过的那一份」，坐标对不上就交给链子的下一级
  airQuality(lat, lon) {
    const m = airMemo;
    if (!m || m.aqi == null || Date.now() - m.at > AIR_TTL) return Promise.resolve(null);
    if (Math.abs(Number(lat) - m.la) > 0.005 || Math.abs(Number(lon) - m.lo) > 0.005) return Promise.resolve(null);
    return Promise.resolve({ current: { us_aqi: m.aqi, pm2_5: null, pm10: null, ozone: null } });
  },

  normalize(raw) {
    const p = (raw || {}).__page;
    if (!p) throw new Error('墨迹报文不完整');
    const byDay = (raw).__hour || {};
    const days = p.days || [];
    const at = nowAt(byDay);
    // 今起三天的日期锚在源自己的「此刻」上（逐小时都没拿到时才退到设备日期）；
    // 墨迹那三天只写「今天/明天/后天」，不给日期，不这么推就只能把日期省掉。
    const today = at ? new Date(at.slice(0, 10) + 'T00:00:00') : new Date();
    const pad = n => (n < 10 ? '0' + n : '' + n);
    const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    return {
      current: {
        temp: p.temp, feels: null, humidity: p.humidity,
        wind: null, windText: p.windText || '',          // 它只给「西南风2级」，不换算成 km/h（换算就是编）
        pressure: null, uv: null,
        desc: p.desc || '未知', icon: iconFromText(p.desc), code: null,
        name: (raw).__city && (raw).__city.name || (raw).__name || '',
        time: nowAt(byDay)
      },
      hourlyByDay: byDay,
      daily: days.map((x, i) => ({
        date: iso(new Date(today.getTime() + i * 864e5)),
        tmax: x.hi, tmin: x.lo, desc: x.desc, icon: iconFromText(x.desc), code: null,
        precipProb: null, precip: null                    // 墨迹这几栏不给降水量：一行都不画，不写 0
      })),
      air: p.aqi == null ? null : { src: '墨迹天气发布 · 国标', std: 'cn', aqi: p.aqi, label: p.aqiLabel },
      alert: alertFrom(p.warn, (raw).__name)
    };
  }
};
