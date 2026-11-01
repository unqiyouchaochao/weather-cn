/* 取数编排：把「城市名 / 收藏键 / 经纬度」解析成目标 → 调 provider → 交给 ui 渲染。
 * 这里是唯一持有「当前查询状态」的地方；视图层靠参数拿数据，不反向 import 本模块。 */
import { loadConfig, saveConfig } from './lib/config.js';
import { decodeKey, encodeKey, loadFav } from './lib/favorites.js';
import { isPlaceName, reverseGeo } from './lib/geo.js';
import { syncWeather } from './lib/notify.js';
import { getProvider } from './providers/index.js';
import * as ui from './ui.js';

/* ---------- 当前查询状态 ---------- */
let state = { city: null, lat: null, lon: null, label: null, name: null };

// 纯坐标定位（无地名）时留空名字，键退化为 "lat,lon"
export function currentKey() {
  if (state.lat != null && state.lon != null) return encodeKey(state.name, state.lat, state.lon);
  return state.name || state.city || '';
}
export function lastQuery() { return { city: state.city, lat: state.lat, lon: state.lon, label: state.label, name: state.name }; }
export function hasTarget() { return !!(state.city || state.lat != null); }
/* 「这两个目标是不是同一个」——全应用只有这一份判定。a 是有 {lat,lon} 或 {city} 的任一侧，
 * b 是被比的那一侧（通常是 lastQuery() 的当前显示目标）。有坐标就只比坐标，没坐标才比城市名。 */
export function sameTarget(a, b) {
  if (!a || !b) return false;
  return a.lat != null ? (b.lat === a.lat && b.lon === a.lon) : (b.lat == null && b.city === a.city);
}

/* ---------- 目标解析 ---------- */
// 把收藏 key / 城市名 / 经纬度解析成可查询的目标
async function resolveTarget(key, provider, cfg) {
  const dk = decodeKey(key);
  if (dk.lat != null) return { la: dk.lat, lo: dk.lon, locName: dk.name || '我的位置', name: dk.name || null };
  if (provider.cap.byCityName) return { la: undefined, lo: undefined, locName: '', name: key };
  let coords = null, geoErr = null;
  try { coords = await provider.geocode(key, cfg.key); } catch (e) { geoErr = e; }
  if (coords) {
    return {
      la: coords.lat, lo: coords.lon, name: coords.name,
      locName: [coords.name, coords.admin || coords.country].filter(Boolean).join(' · ')
    };
  }
  const m = key.match(/^\s*([-\d.]+)\s*,\s*([-\d.]+)\s*$/);
  if (m) return { la: +m[1], lo: +m[2], locName: '坐标 ' + key };
  // 优先透出检索器给的真实原因（如「未找到某城市，可试加市/县后缀」），不要一律推给坐标格式
  if (geoErr && geoErr.message) throw geoErr;
  if (provider.geocode) throw new Error('该数据源需要城市经纬度，请用 "lat,lon" 形式搜索');
  throw new Error('自定义数据源未配置地理编码，请用 "lat,lon" 搜索');
}

/* ---------- 主查询 ---------- */
let querySeq = 0;
/* 上一次**尝试**过的目标（成功与否都算）。骨架屏只该在「换了一座城」时撤下屏上的数字：
 * 判据只看已成功渲染的那个 state，冷启动失败时它还是空的，于是每次自动重试都要白闪一次整页。 */
let lastAttempt = null;
export async function query({ city, lat, lon, label, name }, opts) {
  const mySeq = ++querySeq;
  city = (city || '').trim();
  if (lat == null && !city) { ui.showStatus('请输入城市名或经纬度', true); return; }
  ui.hideStatus();
  clearRetry();                                   // 另起一轮就把待发的自动重试作废
  if (!(opts && opts.auto)) retryRound = 0;       // 用户/定位主动查的，重新给两轮机会
  const target = { city, lat, lon };
  const silent = sameTarget(target, state) || sameTarget(target, lastAttempt);
  lastAttempt = target;
  if (!silent) ui.showSkeleton(); else ui.setSyncing(true);
  try {
    const cfg = loadConfig();
    const provider = getProvider(cfg);   // 自定义函数有语法错误时也要走正常报错，别留一张骨架屏
    // 已有精确坐标时直接用坐标，跳过地理编码；否则把输入原样交给检索器（"34.34,108.94" 这类
    // 纯坐标字符串输入由 resolveTarget 末尾的正则兜住）
    const key = (lat != null && lon != null) ? (lat + ',' + lon) : city;
    const t = await resolveTarget(key, provider, cfg);
    if (label) t.locName = label;
    // 只认地名的源没有「坐标 → 站」这条路，把手上有的名字都递过去：框里的词、检索给的
    // 名字、收藏键上那个名字 —— 三家在用的这一份可能是三者中任何一个，由源自己挑。
    const raw = await provider.weather(t.la, t.lo, city || t.name || name, cfg.key);
    const data = provider.normalize ? provider.normalize(raw) : raw;
    if (mySeq !== querySeq) return;   // 期间已发起更新的查询（如定位竞速里另一路），过期结果直接丢弃
    let locName = t.locName;
    if (!locName && data.current && data.current.name) locName = data.current.name;
    state = { city: lat != null ? null : city, lat: lat != null ? lat : null, lon: lon != null ? lon : null, label: locName, name: name || t.name || null };
    ui.render(data, locName, cfg.provider, currentKey(), silent);
    ui.setCoords(t.la, t.lo);            // 框里的字要被清空，坐标改由搜索框下面那行显示
    // 今日天气：当前源没给逐小时时会另问一家（出处写在卡上），所以它和 AQI 一样是异步的
    ui.loadToday(provider, t.la, t.lo, data, silent);
    syncWeather(data, locName);          // 通知栏：先按当前标题同步一次，地名反查到了再换
    fillPlaceName(t.la, t.lo, locName);
    // 站点名优先：AQI 徽章上那行要写的就是「这个数字来自哪个站/哪座城」（中国天气的报文里
    // current.name 是站点城市，比用户输入的城市名更贴切）。拿不到才退回屏上的地名，
    // 「我的位置」这类非地名由 ui.loadAir 自己判掉。
    ui.loadAir(provider, t.la, t.lo, silent, (data.current && data.current.name) || locName);
    cfg.lastCity = currentKey() || city || '';
    saveConfig(cfg);
    retryRound = 0;             // 查到了就把退避重新归零
    clearRetry();
  } catch (e) {
    // 过期的失败绝不能覆盖已成功渲染的界面：实测网络定位返回哨兵值「未知」比浏览器 GPS 晚落地，
    // 会在正常卡片上方挂一条无关的报错条
    if (mySeq !== querySeq) return;
    const msg = e && e.message ? e.message : String(e);
    ui.renderError(msg, () => query({ city, lat, lon, label, name }));
    armRetry({ city, lat, lon, label, name });
  }
}

/* ---------- 失败以后自己再来一次 ---------- */
/* 冷启动常常赶在网络起来之前（实测华为断网冷启动：三发请求全成 net::ERR_NAME_NOT_RESOLVED，
 * 首页就此空着，状态行那句「查询失败」还会被钉住的定位提示顶掉 —— #109）。
 * 补两轮 4 s / 30 s：第一发够把「网差几秒才起来」这一种救回来，第二发兜住切换网络、
 * 蜂窝刚注册这类慢一点的；两轮都没成就不再自动试，空状态卡上一直留着重试入口，由人决定。 */
const RETRY_MS = [4000, 30000];
let retryRound = 0, retryTimer = null, retryWait = null;
function clearRetry() { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } }
function armRetry(target) {
  clearRetry();
  if (retryRound >= RETRY_MS.length) return;
  const wait = RETRY_MS[retryRound++];
  retryTimer = setTimeout(() => {
    retryTimer = null;
    // 屏幕不在前台就不发这一枪：省的是用户明确要抠的无谓开销，回前台由 retryOnResume 补。
    if (document.hidden) { retryWait = target; return; }
    query(target, { auto: true });
  }, wait);
}
/** 回到前台：把因为退后台而没打出去的那一发补上。屏上已有数据时不碰（那是自动刷新的活）。 */
export function retryOnResume() {
  if (!retryWait) return;
  const t = retryWait;
  retryWait = null;
  query(t, { auto: true });
}

// 由收藏键发起一次查询（有坐标走坐标，避免重新地理编码取错城市）
export function queryByKey(k) {
  const d = decodeKey(k);
  if (d.lat != null) query({ lat: d.lat, lon: d.lon, name: d.name, label: d.name || '我的位置' });
  else query({ city: d.name });
}

/* 「我的位置」/「网络定位」太笼统：反查「市 · 区县 · 街道 · 路」补在标题后面（如
 * 「我的位置 · 云浮市 · ××县 · ××镇 · ××路」）。挂在 query() 这一层而不是定位那一路，
 * 是因为启动恢复上次坐标、按坐标收藏、轮播、点 📍 最终都汇到这里 —— 只有这里看得出
 * 「当前标题其实就是一个坐标点」。
 * 不等它：天气先出，地名到了再由 ui.setPlace 重拼，谁先到都不丢（见 ui.js 那段说明）。 */
function fillPlaceName(lat, lon, locName) {
  // 占位符名单只有 lib/geo.js 那一份
  if (!isPlaceName(locName)) { ui.setPlace('', ''); return; }   // 搜出来的城市：补字作废
  if (lat == null || lon == null) return;
  ui.setPlace(locName, '');
  reverseGeo(lat, lon).then(txt => {
    const s = lastQuery();    // 期间可能已切到别的城市，只认「当前显示的还是这个坐标」
    if (txt && s.label === locName && s.lat === lat && s.lon === lon) ui.setPlace(locName, txt);
  }).catch(() => {});
}

/* ---------- 对比 ---------- */
async function fetchOne(key) {
  const cfg = loadConfig();
  const provider = getProvider(cfg);
  const dk = decodeKey(key);
  const t = await resolveTarget(key, provider, cfg);
  const raw = await provider.weather(t.la, t.lo, dk.name || key, cfg.key);
  const data = provider.normalize ? provider.normalize(raw) : raw;
  let locName = t.locName;
  if (!locName && data.current && data.current.name) locName = data.current.name;
  return { key, locName, data, provider: cfg.provider };
}

export async function compareCities(keysArg) {
  const keys = keysArg || loadFav();
  if (keys.length < 2) { ui.showStatus('至少收藏 2 个城市才能对比', true); return; }
  ui.showStatus('正在加载对比…');
  ui.showCompareLoading(keys.length);
  const results = await Promise.all(keys.map(k =>
    fetchOne(k).catch(e => ({ key: k, error: (e && e.message) ? e.message : String(e) }))
  ));
  ui.renderCompare(results);
}
