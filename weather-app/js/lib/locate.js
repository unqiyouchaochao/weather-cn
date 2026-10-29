/* 网络(IP)定位链：浏览器 GPS 慢/不可用时的兜底，也用于用户点 📍 时的竞速对手。
 * 三级：Sohu JSONP（国内快、只需 script 标签故不受 CORS 限制，但只给城市名）
 *      → ip.sb（直接给经纬度）→ ipapi.co（国外，最后尝试）。
 * 逐源记录失败原因：原先只报一句「网络定位失败」，用户无从分辨是被 CORS 拦了、限流了还是真没网。 */
import { fetchResponse } from './util.js';

// 定位接口解析不出位置时会返回这类哨兵值，直接当城市名查必然失败（实测 Sohu 返回过「未知」）
const BAD_PLACE = /^(未知|不详|unknown|undefined|null|N\/?A|[—-])$/i;
function cleanPlace(s) {
  s = String(s == null ? '' : s).trim();
  return (!s || BAD_PLACE.test(s)) ? '' : s;
}

function sohuIP() {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    const timer = setTimeout(() => { s.remove(); reject(new Error('网络定位超时')); }, 4000);
    s.onload = () => { clearTimeout(timer); const d = window.returnCitySN; s.remove(); if (d && (d.city || d.cname)) resolve(d); else reject(new Error('未返回城市')); };
    s.onerror = () => { clearTimeout(timer); s.remove(); reject(new Error('网络定位失败')); };
    s.src = 'https://pv.sohu.com/cityjson?ie=utf-8';
    document.body.appendChild(s);
  });
}

/* IP 库返回空坐标不是假想坑：`j.latitude` 为空串时 `== null` 判不住，而 `Number('')` 恰好是 0，
 * 于是「定位成功」到了几内亚湾的 (0,0)，天气接口照样返回数据，用户只看到城市名莫名其妙。
 * 统一过这一道：非有限值与 (0,0) 一律算失败，交给下一级源。 */
function coords(lat, lon, label) {
  const la = Number(lat), lo = Number(lon);
  if (!isFinite(la) || !isFinite(lo) || (la === 0 && lo === 0)) throw new Error('返回坐标无效');
  return { lat: la, lon: lo, label };
}

/* 这两个源的市/省名**只有拼音**（实测 ip.sb 给 city=Yunfu、region=Guangdong，加 `lang=zh` 也一样；
 * ipapi.co 给 Foshan / China）。所以 main.js 不拿这个 label 当标题：标题一律写「网络定位」，
 * 中文地名由逆地理编码补（geo.js 的 reverseGeo，国内点位会滤掉无汉字的片段）。
 * label 只留给日志/状态行当线索用。 */
function rawLabel(parts) { return parts.filter(Boolean).join(' · ') || ''; }

// ip.sb：CORS 友好且直接给经纬度。实测国内移动网络（AS9808）下能定到地级市，
// 比 ipinfo.io（同一 IP 返回上海）和 freeipapi（返回广州，偏 150km）准得多
async function ipSb() {
  const r = await fetchResponse('https://api.ip.sb/geoip', 5000);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return coords(j.latitude, j.longitude, rawLabel([cleanPlace(j.city), cleanPlace(j.region)]));
}

async function ipApiCo() {
  const r = await fetchResponse('https://ipapi.co/json/', 4000);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return coords(j.latitude, j.longitude, rawLabel([cleanPlace(j.city), j.country_name]));
}

// 返回 { city, label } 或 { lat, lon, label }
export async function ipLocation() {
  const errs = [];
  try {
    const d = await sohuIP();
    const city = cleanPlace(d.city) || cleanPlace(d.cname ? d.cname.split(',').pop() : '');
    if (city) return { city, label: cleanPlace(d.cname) || city };
    errs.push('Sohu 返回「' + (d.cname || '未知') + '」' + (d.cip === '127.0.0.1' ? '（请求被识别为本机回环，通常是代理或内置预览环境所致）' : ''));
  } catch (e) { errs.push('Sohu: ' + (e && e.message ? e.message : e)); }
  try { return await ipSb(); } catch (e) { errs.push('ip.sb: ' + (e && e.message ? e.message : e)); }
  try { return await ipApiCo(); } catch (e) { errs.push('ipapi.co: ' + (e && e.message ? e.message : e)); }
  throw new Error(errs.join('；'));
}

/* 定位错误文案要分环境：原生壳里没有「地址栏」可点，说了也是白说；
 * 而 @capacitor/geolocation 被拒时抛的是普通 Error（没有 code），只有英文 message，
 * 所以除了 W3C 的 code 之外还要认一下 message，否则界面会冒出「User denied Geolocation」。 */
// 缺谷歌服务的特征：插件抛 OS-PLUG-GLOC-14/15 或 message 里带 Google Play Services；
// 裸 API 那侧则可能表现为某个 provider 不可用（英文 API_UNAVAILABLE / SIGNS_UNAVAILABLE）。
const GMS_MISSING = /google play services|gloc-1[45]|api_unavailable|signs_unavailable/i;
/* 「系统定位没开」必须抢在「缺谷歌服务」前面判掉：三条链路的报错拼成一句话时，融合定位那条
 * 一定带 Google Play Services 字样，用户看到的就是「要开谷歌服务才能定位」，而真正的原因只是
 * 定位开关没开（2026-09-20 反馈）。devicePosition() 现在会先问原生 locationStatus，
 * 开关关着就直接抛 LOCATION_OFF，不再往下试。 */
const LOC_OFF = /LOCATION_OFF|NO_PROVIDER|系统定位(服务|开关)?未开启|没有可用的定位/;
export function isLocationOff(err) {
  return !!err && (err.code === 'LOCATION_OFF' ||
    LOC_OFF.test(String(err.code || '') + ' ' + ((err && err.message) || err)));
}
export function geoErrorMsg(err) {
  const native = isNative();
  if (isLocationOff(err)) {
    return native ? '系统定位服务未开启（GPS 与网络定位都关着）' : '设备定位不可用（系统定位开关未开）';
  }
  const where = native ? '请在系统弹窗或「设置 → 应用 → 天气助手 → 权限」里允许定位' : '请在地址栏允许定位，或改用网络定位';
  if (err && err.code === 1) return '定位权限被拒绝（' + where + '）';
  if (err && err.code === 2) return '定位信号不可用（设备未开启定位/GPS）';
  if (err && err.code === 3) return '定位超时';
  const m = String((err && err.message) || err || '');
  const c = String((err && err.code) || '');
  if (GMS_MISSING.test(c) || GMS_MISSING.test(m)) return '本机没有谷歌服务，融合定位不可用（正在改用系统定位…）';
  if (/denied|permission|unauthoriz/i.test(m)) return '定位权限被拒绝（' + where + '）';
  if (/timeout|timed out/i.test(m)) return '定位超时';
  if (/unavailable|source mode/i.test(m)) return '定位信号不可用（设备未开启定位/GPS）';
  return m ? '定位失败：' + m : '定位失败';
}

/* ---------- 原生壳（Capacitor）适配 ---------- */
// 原生判定只认 Capacitor 注入的全局，不引任何构建产物：本项目零构建，web 侧代码两边共用。
export function isNative() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}
// Capacitor 注入的插件都挂在 window.Capacitor.Plugins 上（自建插件在 MainActivity 里注册）
function capPlugin(name) {
  return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name]) || null;
}
function capGeo() { return capPlugin('Geolocation'); }
function capLocManager() { return capPlugin('NativeLocation'); }
export function hasDeviceLocation() {
  return !!(capLocManager() || capGeo() || navigator.geolocation);
}

/* 设备定位的取数顺序（2026-09-20 重排，为了「不装谷歌也能定位」）：
 * 1) NativeLocation —— 自建插件，只用系统 LocationManager：先取各 provider 现成的缓存位置
 *    （getLastKnownLocation，多数情况下秒回），拿不到再同时挂 gps/network/passive 等一个 fix。
 *    全程不碰谷歌，也不受「谷歌被省电策略掐住」的影响。
 * 2) @capacitor/geolocation —— 谷歌融合定位。装了谷歌且没被 PowerKeeper 掐时它最准，所以留着。
 *    它只走 FusedLocationProviderClient（见 GeolocationPlugin.kt 里
 *    IONGLOCController(LocationServices.getFusedLocationProviderClient(...))，内部唯一的
 *    LocationManager 用法只是查「系统定位开关」），缺谷歌会回 OS-PLUG-GLOC-15，认到就本次运行不再试它。
 * 3) navigator.geolocation —— WebView 标准 API，Chromium 在 Android 上走系统定位；桌面浏览器只有这条。
 * 每条失败都攒下原因，全失败才抛 —— 以前只报一句「定位失败」，分不清是被拒、超时还是没信号。 */
let fusedDead = false;      // 融合定位确认不可用（缺谷歌）后本次运行不再重试；补装后重启即自愈
function errText(e) { return String((e && e.message) || e || '未知错误'); }
function isGmsMissing(e) {
  return GMS_MISSING.test(String((e && e.code) || '') + ' ' + errText(e));
}
function webPosition(opts) {
  if (!navigator.geolocation) return Promise.reject(new Error('设备无定位能力'));
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
    pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, channel: 'WebView' }),
    reject, opts
  ));
}
/* 没有谷歌时只剩设备 GNSS（Wi-Fi/基站辅助那套在谷歌手里），室内首定位慢，
 * 所以这条通道反过来强制高精度并把超时放宽到 15s */
function gnssOpts(opts) {
  return Object.assign({}, opts, { enableHighAccuracy: true, timeout: Math.max((opts && opts.timeout) || 0, 15000) });
}
export async function devicePosition(opts) {
  opts = opts || {};
  const errs = [];
  const lm = capLocManager();
  // 先问一句系统开关：关着的话三条链路都定不到，而融合定位的报错必然带 Google Play Services 字样，
  // 拼起来就成了「要开谷歌服务才能定位」的误导文案。老 APK 没这个方法 → catch 成 null 照常往下走。
  if (lm && lm.locationStatus) {
    const st = await lm.locationStatus().catch(() => null);
    if (st && st.switchOn === false) {
      const e = new Error('系统定位服务未开启');
      e.code = 'LOCATION_OFF';
      e.status = st;
      throw e;
    }
  }
  if (lm) {
    try {
      const p = await lm.getPosition({ maxAge: opts.maximumAge || 0, timeout: opts.timeout || 15000 });
      return { lat: p.latitude, lon: p.longitude, provider: p.provider, cached: !!p.cached, age: p.age, accuracy: p.accuracy, channel: '系统定位' };
    } catch (e) { errs.push('系统定位: ' + errText(e)); }
  }
  const g = capGeo();
  if (g && !fusedDead) {
    try {
      const p = await g.getCurrentPosition(opts);
      return { lat: p.latitude, lon: p.longitude, channel: '融合定位' };
    } catch (e) {
      if (isGmsMissing(e)) fusedDead = true;
      errs.push('融合定位: ' + errText(e));
    }
  }
  if (navigator.geolocation) {
    try { return await webPosition(isNative() ? gnssOpts(opts) : opts); }
    catch (e) { errs.push('WebView: ' + errText(e)); }
  }
  throw new Error(errs.length ? errs.join('；') : '设备无定位能力');
}

/**
 * 跳到系统的「位置信息」页让用户自己开。
 * 应用**没法**替用户拨开这个开关：改 Settings.Secure 要 WRITE_SECURE_SETTINGS（系统级，只能 adb 给），
 * 而安卓给的正规弹窗（LocationSettingsRequest）又是谷歌 Play 服务里的东西 —— 与本项目「不碰谷歌」的前提冲突。
 * 所以这里做到极限是：把用户送到那一页，回到前台后前端自动重试一次定位。
 */
export function openLocationSettings() {
  const lm = capLocManager();
  if (!lm || !lm.openLocationSettings) return Promise.reject(new Error('本机没有系统定位设置入口'));
  return lm.openLocationSettings();
}

/* ---------- 「上一次设备定位落点」还能不能用 ---------- */
/* 定位拿不到时，宁可沿用不久前的 GPS 落点，也不退到 IP：IP 给的是运营商核心网出口，
 * 实测能把人从广东甩到郑州（差 1500 公里，比"位置旧半小时"错得离谱得多）。
 * 这条判据以前只在「定位超时」那一支里手写了一遍，「系统定位开关关着」那一支直接跳过去打 IP ——
 * 同一个问题两处答案不一样，就是这个模块要收住的事。 */
export const KEEP_FIX_MS = 30 * 60000;
/** 返回还能用的落点 {lat,lon,at}，否则 null。now 由调用方传进来，测试才有确定性。 */
export function freshFix(cfg, now) {
  const lf = (cfg || {}).locFix;
  if (!lf) return null;
  const lat = Number(lf.lat), lon = Number(lf.lon), at = Number(lf.at);
  if (!isFinite(lat) || !isFinite(lon) || !isFinite(at) || (lat === 0 && lon === 0)) return null;
  return now - at < KEEP_FIX_MS ? { lat: lat, lon: lon, at: at } : null;
}
