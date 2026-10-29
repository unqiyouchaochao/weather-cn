/* 中文城市检索：Open-Meteo geocoding 为主源，Photon(OSM) 补库。
 *
 * 为什么要三层策略（均为实测结论）：
 * 1. 多变体 —— 中文库收录极不一致。「桂林」只查得到安徽/福建的村镇，必须查「桂林市」才有广西 PPLA2；
 *    反过来「三亚市」「深圳市」查不到、「三亚」「深圳」才查得到。只查一种必然一半概率出错
 *    （实测取原始 count=1 首条时，15 个知名城市里 7 个首位是错的，厦门、敦煌 0 条）。
 * 2. 按行政等级择优 —— rank 只反映等级、用于判断要不要兜底；score 额外带同名加分、只用于排序。
 *    两者必须分开：否则「香格里拉社区」这类 PPL 村落靠名字前缀相同就能冒充城市级，把兜底整个废掉。
 * 3. Photon 兜底 —— 主源一个城市级结果都没有时才逐变体问 OSM。雄安/保亭/可克达拉在主库里根本不存在。
 */
import { fetchJson } from './util.js';

const OM_RANK = { PPLC: 100, PPLA: 90, PPLA2: 80, PPLA3: 70, PPLA4: 60, PPL: 20 };
const PH_RANK = { city: 80, town: 60, suburb: 55, county: 50, district: 48, village: 35, hamlet: 25 };
const CITY_LEVEL_MIN = 60;   // 低于此分说明只有一堆同名村落，不可信

const ADMIN_SUFFIX = /(市|县|区|州|盟|旗|乡|镇)$/;
function geoVariants(q) {
  if (ADMIN_SUFFIX.test(q)) {
    // 用户已写明后缀：再补一个去掉后缀的词干（「武侯区」→「武侯」）提高召回。
    // 单字词干（杭州→杭）无意义，故要求长度≥2。
    const stem = q.slice(0, -1);
    return stem.length >= 2 ? [q, stem] : [q];
  }
  // 裸名：库里可能记作 X / X市 / X区 / X县。只补「市」会漏掉所有区县
  //（实测「武侯」被陕西的武侯镇顶掉、「浦东」查不到浦东新区、「凤凰」查不到凤凰县）
  return [q, q + '市', q + '区', q + '县'];
}

// Photon 的 name 常带多语种后缀（如「香格里拉市 སེས་ཀྱི་ཉི་ཟླ།」），故只取首个空白前的主名比对。
// 比对基准必须是**原始查询词**而非当前变体：用户输「浦东」时，正确结果「浦东新区」靠补后缀生成的
// 变体是「浦东区」永远对不上，而江苏确有叫「浦东」的 district，会靠全等把上海浦东新区挤掉。
const NAME_SUFFIX = /(新区|特区|市|区|县|州|盟|旗)$/;
function nameBonus(name, q) {
  const head = String(name || '').trim().split(/\s+/)[0];
  if (!head) return 0;
  if (head === q) return 40;
  return head.replace(NAME_SUFFIX, '') === q ? 40 : 0;
}

/* 用户写明「X县 / X旗」时，**类别本身就是线索**，必须参与排序。
 * 2026-09-29 真机上搜「××县」，屏上标题是「×× · Jilin Province」，广东那座排到第 10：
 * Photon 在手机上回的是英文名（同一句在桌面端回的是「××县」），nameBonus 一律 0，
 * 于是排序只剩行政等级 —— 而等级表把 county(50) 永远压在 city(80) 与 Open-Meteo 的 PPLA3(70) 下面，
 * 用户点名要的那一类反而注定排最后。等级只回答「多大」，不回答「是不是用户说的那一种」。
 * 只补 县/旗 这一档：① 它有真机字节撑着（`tests/fixtures/homonym-search-shapes.json`）；
 * ② 「市/州/盟」那类等级排序本来就偏向它们，再抬就会把 OSM 的点顶到主源之上，波及所有城市搜索；
 * ③ 「X区」没有实测样本（OSM 里区有 district 也有 suburb，没抓过真响应），不照猜测加规则。
 * 加分只进 score，不进 rank —— rank 那一路还管着「要不要再兜底问一遍 OSM」。 */
const WANT_CLASS = { 县: ['county'], 旗: ['county'] };
function classBonus(q, type) {
  const want = WANT_CLASS[String(q || '').trim().slice(-1)];
  return want && want.indexOf(type) >= 0 ? 40 : 0;
}

function omSearch(variant, signal, q) {
  return fetchJson('https://geocoding-api.open-meteo.com/v1/search?name=' +
    encodeURIComponent(variant) + '&count=10&language=zh&format=json', null, signal)
    .then(j => (j.results || []).map(g => {
      const rank = OM_RANK[g.feature_code] || 10;
      return {
        lat: g.latitude, lon: g.longitude, name: g.name,
        admin: g.admin1 || '', country: g.country || '', src: 'open-meteo',
        rank, score: rank + nameBonus(g.name, q)
      };
    }));
}
function photonSearch(variant, signal, q) {
  return fetchJson('https://photon.komoot.io/api/?q=' + encodeURIComponent(variant) + '&limit=12', null, signal)
    .then(j => (j.features || [])
      // 不过滤会拿到同名铁路点/公路点（实测「雄安」首位是 railway house 而非雄安新区）
      .filter(f => (f.properties || {}).osm_key === 'place' && f.geometry && f.geometry.coordinates)
      .map(f => {
        const p = f.properties;
        const rank = PH_RANK[p.type] || 10;
        return {
          lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
          name: p.name || p.city || p.county || variant,
          admin: p.state || p.city || '', country: p.country || '', src: 'photon',
          rank, score: rank + nameBonus(p.name, q) + classBonus(q, p.type)
        };
      }));
}
function dedupeRank(list) {
  const seen = new Set(), out = [];
  list.sort((a, b) => b.score - a.score).forEach(x => {
    if (x.lat == null || x.lon == null) return;
    const k = x.lat.toFixed(3) + ',' + x.lon.toFixed(3);
    if (seen.has(k)) return;
    seen.add(k); out.push(x);
  });
  return out;
}

// 返回按可信度排序的候选；一个都没有时返回空数组。
// 数组上挂一个 `silent`：**这一轮两家检索源一个都没答**（全请求失败）时为 true。
// 2026-10-01 实测同一句「××县」连问 5 次，前两次两源都没给可用结果、后三次正常 —— 公共实例会整轮不答。
// 那种情况报「未找到，可试试加上市/县后缀」是把上游没答说成用户词写得不对，责任归错了。
function tag(list, asked, failed) {
  list.silent = asked > 0 && failed === asked;
  return list;
}
async function runSearch(q, signal) {
  const vs = geoVariants(q);
  let asked = 0, failed = 0;
  const guard = p => { asked++; return p.catch(() => { failed++; return []; }); };
  // Photon 对裸词常开一发（非仅兜底）：它收录了若干 Open-Meteo 里缺失或等级更低的区县。
  // 实测「凤凰」只有 OSM 给出湖南凤凰县，其 city 级条目叠上剥后缀的同名加分（80+40）
  // 才能正确压过山西那个同名镇（PPLA3 70+40）；纯兜底时它会因主源已有命中而被跳过。
  const [omGroups, phOwn] = await Promise.all([
    Promise.all(vs.map(v => guard(omSearch(v, signal, q)))),
    guard(photonSearch(q, signal, q))
  ]);
  const merged = dedupeRank(omGroups.flat().concat(phOwn));
  // 是否再全变体问一遍 OSM，只看「原词那一发」在主源的结果（vs[0] 恒等于 q）：
  // 派生变体捞到高等级同名点时，不该掩盖原词其实一无所获 —— 实测「凤凰县」在 Open-Meteo 是 0 条，
  // 但合并的「凤凰」变体返回山西 PPLA3 顶过阈值，曾导致湖南凤凰县彻底查不到。
  const own = omGroups[0] || [];
  if (own.length && own[0].rank >= CITY_LEVEL_MIN) return tag(merged, asked, failed);
  const back = await Promise.all(
    vs.filter(v => v !== q).map(v => guard(photonSearch(v, signal, q)))
  );
  return tag(dedupeRank(merged.concat(back.flat())), asked, failed);
}

/* 同一个词只发一发检索：联想下拉和随后那次回车查的是同一个 q，不共享就得把 5~8 个跨域请求
 * 跑两遍（实测最慢的一发 2.4s，正好压在用户最敏感的「按下回车」那一刻）。
 * 只挂在途 Promise，10 秒后作废；失败不共享 —— 那多半是连打时被联想主动掐掉的 AbortError，
 * 后来者该重新发一发，而不是继承一个「查询已取消」。 */
const inflight = new Map();
const INFLIGHT_MS = 10000;
export function searchCities(q, signal) {
  q = String(q || '').trim();
  if (!q) return Promise.resolve([]);
  const cur = inflight.get(q);
  if (cur) return cur.catch(() => runSearch(q, signal));
  const p = runSearch(q, signal);
  inflight.set(q, p);
  /* 「两源都没答」的那一轮不该被共享出去：共享的意义是省掉重复请求，而空手而归的这一轮
   * 恰恰需要下一位（bestCity 的那发重试、或者用户再按一次回车）真的重新问一遍。
   * 留着它，重试就会原样拿回同一个空数组 —— 白等 600ms，报错还是那句。 */
  p.then(r => { if (r && r.silent && inflight.get(q) === p) inflight.delete(q); }, () => {});
  setTimeout(() => { if (inflight.get(q) === p) inflight.delete(q); }, INFLIGHT_MS);
  return p;
}

// 主源首条即用户想要的城市时直接返回，供 geocode 用。
// 结果按名字缓存在 localStorage：城市不会挪位置，而这一发要串起 5~8 个跨域检索请求
//（实测冷 850ms / 热 230ms），启动恢复上次城市、轮播、按名收藏全靠它。
/* 旧表里躺着的是**按错的排序挑出来的城市**（「××县」→ 吉林那座），而这一张表 30 天不过期 ——
 * 光改代码不改表名，用户搜过一次的那座错城会一直留在屏上。所以换名重来，旧表直接扔掉：
 * 检索冷了重问一发也就 850ms，拿错省的坐标当用户这儿的不行（宁缺勿错）。 */
try { localStorage.removeItem('weather-studio-geo'); } catch (e) { /* 读不到就当没有 */ }
const GEO_LS = 'weather-studio-geo2';
const GEO_TTL = 30 * 864e5;   // 30 天
const GEO_MAX = 120;          // 条数上限，超了丢最旧的
let geoMem = null;
function geoCache() {
  if (geoMem) return geoMem;
  try { geoMem = JSON.parse(localStorage.getItem(GEO_LS)) || {}; } catch (e) { geoMem = {}; }
  return geoMem;
}
function geoPut(q, v) {
  const c = geoCache();
  c[q] = { at: Date.now(), v };
  const ks = Object.keys(c);
  if (ks.length > GEO_MAX) {
    ks.sort((a, b) => (c[a].at || 0) - (c[b].at || 0))
      .slice(0, ks.length - GEO_MAX)
      .forEach(k => { delete c[k]; });
  }
  try { localStorage.setItem(GEO_LS, JSON.stringify(c)); } catch (e) { /* 满了或隐私模式，本次内存里仍有效 */ }
}

export async function bestCity(name) {
  const q = String(name || '').trim();
  const hit = geoCache()[q];
  if (hit && hit.v && hit.v.lat != null && Date.now() - (hit.at || 0) < GEO_TTL) return hit.v;
  let list = await searchCities(name);
  /* 一整轮都没人答：隔 600ms 再问一次。这不是想象出来的补救 —— 2026-10-01 同一句「××县」连问 5 次，
   * 前两次空、后三次正常，公共实例的"不答"是按轮次的，重试一发就能分清真有没有这个词。 */
  if (!list.length && list.silent) {
    await new Promise(r => setTimeout(r, 600));
    list = await searchCities(name);
  }
  if (!list.length) {
    throw new Error(list.silent
      ? '检索源这一轮没有回答（Photon 与 Open-Meteo 两家都没回），过几秒再搜一次。「' + name + '」这个词未必写得不对。'
      : '未找到「' + name + '」，可试试加上市/县后缀（如「' + name + '市」），或直接输入 lat,lon 坐标');
  }
  const g = list[0];
  const out = { lat: g.lat, lon: g.lon, name: g.name, country: g.country, admin: g.admin };
  geoPut(q, out);
  return out;
}

/* ---------- 逆地理编码：坐标 → 「市 · 区县 · 街道 · 路」 ----------
 * 定位成功后给「我的位置」补一个看得懂的地名。两个源并用（都免 key、CORS 放行，2026-09-20 实测）：
 * - Photon(OSM)：唯一能给到路名的一路（实测上海市中心 → 黄浦区 / 南京东路街道 / 西藏南路），
 *   但层级槽位不稳 —— 广东那个县级的点它把「县下辖的镇」塞在 city 里、地级市整个缺席。
 *   **别传 lang=zh**：公共实例只认 default/de/en/fr，传了直接 400。不传时给的是 OSM 本地名，
 *   但**不保证是中文**：同一个点桌面端拿到汉字那一层，手机上拿到同一层的拼音，
 *   所以中文过滤要配合槽位退让（见 pickPlace），不能指望它一次给全。
 * - BigDataCloud reverse-geocode-client：行政层级最全（省/市/县/镇都能给），但没有路名，
 *   而且繁简混排（实测上海的区返回「黃浦區」）。所以字段能取 Photon 就取 Photon，BDC 只补地级市与镇。
 * Nominatim 也试过：本环境实测 Failed to fetch（CORS/网络被拦），不接。 */
const CITY_RE = /^[^市]{1,8}市$/;
const SUB_RE = /(区|县|市|旗|特区|林区|新区)$/;        // 区县级槽位
const TOWN_RE = /(街道|镇|乡|苏木)$/;                   // 街道/乡镇级槽位

const HAN = /\p{Script=Han}/u;

/* BDC 的中文繁简混排（实测同一请求里郑州给「金水區」、上海给「黃浦區」），这里只转**量出来真的会
 * 以繁体出现的那几个字** —— 城市名内部的繁体字太多，不值得在客户端塞一张整表。
 * 2026-10-01 拿 24 个地级市的坐标逐个问过 BDC（`localityLanguage=zh`）：10 个对不上榜内简体名，
 * 其中 8 个是繁体（蘭州/銀川/濟南/嘉峪關/齊齊哈爾/三亞/吐魯番/克孜勒蘇），1 个给拼音（吴忠→"Wuzhong"，
 * 由下面那道 HAN 过滤挡掉），1 个是长自治州名（本来就能对上词干）。
 * 落空的代价不是显示不好看，是**华为城市榜匹配不上 → 空气质量掉到模型值**，所以这一表在取数链上。
 * 导出只为让回归能直接喂一串繁体字看它转不转 —— 界面不碰它。 */
const TRAD = { 區: '区', 縣: '县', 鎮: '镇', 鄉: '乡', 裏: '里', 裡: '里',
  蘭: '兰', 銀: '银', 濟: '济', 關: '关', 齊: '齐', 爾: '尔', 亞: '亚', 魯: '鲁', 蘇: '苏' };
export function toSimplified(v) {
  return String(v || '').replace(new RegExp('[' + Object.keys(TRAD).join('') + ']', 'g'), c => TRAD[c]);
}

function pickPlace(p, b) {
  p = p || {}; b = b || {};
  // 国内点位却给出拉丁字母 = 拼音（实测 ip.sb 只给 Yunfu/Guangdong 这种，OSM 个别新编辑的
  // name 也只有拉丁名），这种一律不用；境外就该显示当地名，故只在国家码 CN 时过滤。
  const inCN = (p.countrycode || b.countryCode || '') === 'CN';
  const out = [];
  const ok = v => {
    v = String(v || '').replace(/[;；].*$/, '').trim();
    if (inCN) v = toSimplified(v);
    if (!v || (inCN && !HAN.test(v))) return '';
    // 去重还要防「同一个地名两边写法不同」：包含关系直接丢掉（实测东京那点在两源给出
    // 「千代田区 / 千代田區」，不去掉就是重复一段）
    if (out.some(x => x.indexOf(v) === 0 || v.indexOf(x) === 0)) return '';
    return v;
  };
  // 槽位按候选顺序试到「第一个能用的」为止，不能只取首个非空：同一个点，桌面端 Photon 返回
  // ××县/××镇，手机 Photon 返回同一层的拼音（公共实例多语种不保证，实测两条链路结果不同），
  // 先被拼音占住槽位、再由上面那道过滤丢弃，县名就整段没了 —— 必须退到 BDC 的中文名。
  const add = (...vs) => { for (const v of vs) { const s = ok(v); if (s) { out.push(s); return; } } };
  // BDC 的行政链自带级号，实测同一个点：中华人民共和国@2 / 广东省@4 / 云浮市@5 / ××县@6 / ××镇@8。
  // 顶层那几个槽位不稳（Photon 被限流时只剩 BDC，实测 b.locality 会空掉，县名就没了），
  // 所以每个槽位都留一条按级取名的后路。
  const adm = (b.localityInfo && b.localityInfo.administrative) || [];
  const admAt = lv => String((adm.filter(a => a.adminLevel === lv)[0] || {}).name || '');
  // 市：Photon 没有稳定的「地级市」字段，故只认它本身就以「市」结尾的槽位，否则用 BDC
  add(CITY_RE.test(p.city) ? p.city : '', b.city, admAt(5), CITY_RE.test(p.state) ? p.state : '');
  add(p.county, SUB_RE.test(p.city) ? p.city : '', SUB_RE.test(p.district) ? p.district : '',
    b.locality, SUB_RE.test(admAt(6)) ? admAt(6) : '');
  // 街道/镇：Photon 的三个槽位里挑带乡镇后缀的那个（县城里往往是 city=镇名，直辖市是 district=XX街道）。
  // BDC 的深层行政单元只在接受到乡镇级后缀时才用 —— 日本的「大字」级和国外的社区名会补出重复一段。
  add(...[p.district, p.city, p.locality].filter(x => TOWN_RE.test(x || '')),
    (adm.filter(a => (a.adminLevel || 0) >= 7 && TOWN_RE.test(a.name || '')).pop() || {}).name);
  add(p.street, (p.type === 'street' || p.osm_key === 'highway') ? p.name : '');
  return out.join(' · ');
}

export function reverseGeo(lat, lon) {
  const la = Number(lat), lo = Number(lon);
  if (!isFinite(la) || !isFinite(lo)) return Promise.resolve('');
  // 键取到 0.01°（约 1km），与 30 秒重定位的位移闸门同量级；地名不会自己挪走，存进同一份 30 天缓存
  // 前缀带版本号：拼名规则一改（rv: 那版还没过滤拼音，实测手机上就是被这条 30 天旧值
  // 顶着，改完代码看着生效了、其实读的是缓存），旧键自然作废，靠 GEO_MAX 的 LRU 逐步挤掉。
  const key = 'rv3:' + la.toFixed(2) + ',' + lo.toFixed(2);
  const hit = geoCache()[key];
  if (hit && hit.v && Date.now() - (hit.at || 0) < GEO_TTL) return Promise.resolve(hit.v);
  const url = 'lat=' + la + '&lon=' + lo;
  const ph = fetchJson('https://photon.komoot.io/reverse?' + url, 6000)
    .then(j => (j.features && j.features[0] && j.features[0].properties) || null).catch(() => null);
  const bd = fetchJson('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' +
    la + '&longitude=' + lo + '&localityLanguage=zh', 6000).catch(() => null);
  return Promise.all([ph, bd]).then(r => {
    const txt = pickPlace(r[0], r[1]);
    if (txt) geoPut(key, txt);   // 两源都空时不写缓存，下次还能重试
    return txt;
  });
}

/* ---------- 「我的位置」这一类标题不是地名 ----------
 * 「我的位置」「网络定位」是标题占位符，不是地名 —— 拿它去问一个只认地名的源，
 * 必然得到「没有收录」（2026-09-29 真机就是卡在这一步：换了源、屏上一动不动）。
 * query.js 判占位符、ui 判出处，问的是同一件事，所以判据只留这一份。 */
const PLACE_BASES = ['我的位置', '网络定位'];
export function isPlaceName(name) { return PLACE_BASES.indexOf(String(name || '').trim()) >= 0; }
