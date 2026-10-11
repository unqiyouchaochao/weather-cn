/* 定位这一路的流程：设备定位 / 网络定位 / 竞速与兜底 / 回前台续查 / 每 30 秒的自动重定位。
 * 这一层的归属判据：**只有它碰得到「设备现在在哪儿」**（locatedTarget、lastFix、定位开关的记账）。
 * 谁要用坐标去查天气，它只调 query.js，不认识设置面板，也不管屏幕上画了什么。
 * 与 lib/locate.js 的分工：那一层是原生桥与能力探测（有没有设备定位、开关开没开、跳系统设置），
 * 这一层是「什么时候问、问完了怎么办」。 */
import { loadConfig, saveConfig } from './lib/config.js';
import { ipLocation, geoErrorMsg, isNative, hasDeviceLocation, devicePosition, isLocationOff, openLocationSettings, freshFix } from './lib/locate.js';
import { query, queryByKey, lastQuery, hasTarget, sameTarget, retryOnResume } from './query.js';
import * as ui from './ui.js';

let locatedTarget = null, lastFix = null;
function renderLocated(target) {
  locateResolved = true;
  locatedTarget = target;
  if (target.lat != null) lastFix = { lat: target.lat, lon: target.lon };  // 只记「设备定位」的落点与时刻：设备定位超时后靠它判断能不能沿用上一次坐标，
  // 而不是退到 IP —— IP 给的是运营商核心网出口，实测能把人从广东甩到郑州。
  // fromCache 那一路（定位开关关着、沿用上次落点）**不许**把 at 刷成当下 ——
  // 否则每轮自动刷新都在给这份缓存续命，半小时的窗口永远不会到期，旧位置就再也换不下来了。
  if (target.label === '我的位置' && target.lat != null && !target.fromCache) {
    const cfg = loadConfig();
    cfg.locFix = { lat: target.lat, lon: target.lon, at: Date.now() };
    saveConfig(cfg);
  }
  // name 一起传：它进的是 currentKey() → cfg.lastCity 的「名字@纬度,经度」，只传 label 的话
  // 落盘的 key 是光秃秃的 "@34.77,113.72"，下次启动 restore 时 decodeKey 拿不到名字，
  // resolveTarget 会把默认值「我的位置」安到 IP 兜底的坐标上（实测装机就是这样显示成郑州的）
  query(Object.assign({}, target, target.label ? { name: target.label } : null));
}

async function ipLocate(silent) {
  if (!silent) ui.showStatus('正在通过网络定位…');
  try {
    const loc = await ipLocation();
    // 标题写「网络定位」而不是「我的位置」：这一路只有城市级精度、还常被出口路由带偏，
    // 标成「我的位置」会让人以为应用把自己的位置搞错了（2026-09-20 就是这么一条反馈）。
    if (loc.lat != null && loc.lon != null) renderLocated({ lat: loc.lat, lon: loc.lon, label: '网络定位' });
    else if (loc.city) renderLocated({ city: loc.city });
    else throw new Error('未获取到位置');
  } catch (e) {
    if (!silent) ui.showStatus('网络定位失败：' + (e && e.message ? e.message : e), true);
    throw e;
  }
}

// 浏览器定位 与 网络定位 并行竞速：先到先用；浏览器定位更准则稍后升级。
// auto=true 表示启动时的后台自动定位：失败不该弹红色报错条阻断界面（下方已能用上次城市渲染），
// 只有用户主动点 📍 时才需要完整报错。
let locateResolved = false, geoErrored = false, ipErrored = false;
/* 超时给到 15 秒：这台红米实测十几秒常常等不到新 fix（MIUI PowerKeeper 会把谷歌网络定位的
 * wake lock 掐掉，日志里 OS-PLUG-GLOC-0010 连发），8 秒几乎必超时。maximumAge 保持 5 分钟，
 * 所以有近期缓存时照样是秒回。 */
const GEO_OPTS = { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 };
// 「半小时内的设备落点宁可沿用也不退 IP」这条判据在 lib/locate.js 的 freshFix() 里，两处共用一份
/* 系统定位开关没开时的两个钩子：一键跳系统设置；回到前台自动重试（用户多半刚在设置页里打开）。
 * 应用自己拨不开那个开关（改 Settings.Secure 要系统级权限，正规弹窗又在谷歌的 Play 服务里），
 * 所以「进入前台自动开始定位、退到后台立刻停轮询 + 原生摘监听」是这里能做到的另一半。 */
let locationOffHint = false;
function gotoLocationSettings() {
  openLocationSettings().catch(e =>
    ui.showStatus('打不开系统定位设置页：' + ((e && e.message) || e) + '，请手动到「设置 → 位置信息」里打开', true));
}
export function onVisibility() {
  if (document.hidden) {
    if (locateTimer) { clearInterval(locateTimer); locateTimer = null; }
    return;
  }
  // 回前台先补那一发因为退后台而没打出去的重试（见 query.js 的 armRetry）——
  // 实测冷启动赶上网没起来时，光靠这一发就能把首页从空白救回来。
  retryOnResume();
  setupAutoLocate();
  if (locationOffHint) { locationOffHint = false; doLocate(true); }
}
export function doLocate(auto) {
  const quietFail = () => { if (auto) { ui.hideStatus(); return; } };
  const insecure = !isNative() && (typeof window.isSecureContext === 'boolean') && !window.isSecureContext;
  if (!hasDeviceLocation() || insecure) {
    if (insecure && !auto) ui.showStatus('当前非安全环境（需 https 或 localhost），改用网络定位', false);
    ipLocate(false).catch(() => { quietFail(); });
    return;
  }
  locateResolved = false; geoErrored = false; ipErrored = false;
  if (!auto) ui.showStatus('正在获取定位…');
  // 手机壳里 GPS 优先、IP 只当兜底，不再竞速：设备装了 VPN 时 IP 定位会返回出境节点的城市，
  // 竞速会让那个错结果先占住界面（GPS 往往晚半秒到）。桌面浏览器没有 GPS，仍按竞速走。
  if (isNative()) {
    devicePosition(GEO_OPTS).then(
      p => { ui.unpinStatus(); renderLocated({ lat: p.lat, lon: p.lon, label: '我的位置' }); },
      err => {
        geoErrored = true;
        if (locateResolved) return;
        // 系统定位没开：这是「打不开定位」最常见的原因，却最容易被下面两条链路的报错盖成
        // 「要开谷歌服务」。这里单独一条路：说清原因 + 一键跳系统设置（钉在状态条上，
        // 天气渲染把它冲掉后还会回来）。落点顺序和下面那条对齐 —— **先沿用半小时内的设备定位，
        // 确实没有才退 IP**：以前这一支直接跳到 ipLocate，结果「关掉定位」反而比「定位超时」更容易
        // 被甩到别的城市（IP 出口在郑州，人在广东）。
        if (isLocationOff(err)) {
          locateResolved = true;
          locationOffHint = true;
          const off = freshFix(loadConfig(), Date.now());
          if (off) {
            const m = Math.floor((Date.now() - off.at) / 60000);
            ui.pinStatus(geoErrorMsg(err) + '，暂用上次定位' + (m >= 1 ? '（' + m + ' 分钟前）' : '') +
              '。打开后回到本应用会自动重新定位', { label: '去开启定位服务', onClick: gotoLocationSettings });
            renderLocated({ lat: off.lat, lon: off.lon, label: '我的位置', fromCache: true });
            return;
          }
          ui.pinStatus(geoErrorMsg(err) + '，改用网络定位。打开后回到本应用会自动重新定位',
            { label: '去开启定位服务', onClick: gotoLocationSettings });
          // 这一发以前没人接：整条 IP 链挂掉时抛的是未捕获的 promise 拒绝（实测断网冷启动抓到
          // 「Sohu: 网络定位失败；ip.sb: Failed to fetch；ipapi.co: Failed to fetch」），
          // 而状态行还挂着「已先用网络定位顶着」——那句成了空话。
          ipLocate(true).catch(() => {
            // 屏上已经有一座城（那份是真取到的）就别改口；什么都没有时才把实话补上。
            if (hasTarget()) return;
            /* 这句只说定位这一路怎么了，**不许替天气下结论**：它是钉住的，而自愈重试成功之后
             * 这句还会留在屏幕上 —— 「天气暂时取不到」就变成新的假话（2026-10-02 真机自愈那一跑
             * 量到的正是这个）。天气到底取没取到，由空状态卡与结果区自己说。 */
            ui.pinStatus(geoErrorMsg(err) + '，网络定位也没成功。打开后回到本应用会自动重新定位',
              { label: '去开启定位服务', onClick: gotoLocationSettings });
          });
          return;
        }
        // 设备定位失败时，屏幕上如果就是半小时内的设备落点，就沿用它在等下一轮 —— 退到 IP 会把
        // 城市整个换错（实测本机 IP 出口在郑州，人在广东，一张卡直接跳 1500 公里）。
        const lf = freshFix(loadConfig(), Date.now());
        if (lf && sameTarget(lf, lastQuery())) {
          locateResolved = true;
          if (!auto) {
            const mins = Math.floor((Date.now() - lf.at) / 60000);
            ui.showStatus(geoErrorMsg(err) + '，暂用上次定位' + (mins >= 1 ? '（' + mins + ' 分钟前）' : ''), false);
          }
          return;
        }
        if (!auto) ui.showStatus(geoErrorMsg(err) + '，正在用网络定位…', false);
        ipLocate(auto).catch(() => {
          if (!auto) ui.showStatus('定位失败：设备与网络定位均不可用', true);
          else ui.hideStatus();
        });
      }
    );
    return;
  }
  ipLocate(true).catch(() => {
    ipErrored = true;
    if (geoErrored && !locateResolved) {
      if (auto) quietFail();
      else ui.showStatus('定位失败：设备与网络定位均不可用', true);
    }
  });
  devicePosition(GEO_OPTS).then(
    p => renderLocated({ lat: p.lat, lon: p.lon, label: '我的位置' }),
    err => {
      geoErrored = true;
      if (!locateResolved) {
        if (auto) return;
        if (ipErrored) ui.showStatus('定位失败：设备与网络定位均不可用', true);
        else ui.showStatus(geoErrorMsg(err) + '，正在用网络定位…', false);
      }
    }
  );
}

/* 首屏那一发不能只指望定位链成功。华为 EMUI 的 WebView **没有 `navigator.permissions`**（实测
 * `!!navigator.permissions === false`），于是 maybeAutoLocate 走的是最后那一支「定位成功就归它查」，
 * 整条定位链一失败（断网冷启动：设备定位抛 LOCATION_OFF、IP 三级全挂）应用就**从来没发起过查询** ——
 * 首页停在 index.html 那套 `hidden` 的初始状态上，`#loading` 连骨架都没画过，屏幕上只剩一行钉住的提示。
 * 这才是 2026-10-02 那条「冷启动不自动查询」的真正入口（另一半是 renderError 留白，已在 ui/render.js 修）。
 * 这道 2.5 秒的兜底：定位已经把城市查出来了就不动，没查出来就用上次城市自己补一发。 */
function firstQueryGuard() {
  setTimeout(() => {
    if (hasTarget()) return;
    queryByKey(loadConfig().lastCity || '北京');
  }, 2500);
}
export function maybeAutoLocate() {
  const cfg = loadConfig();
  if (!hasDeviceLocation()) {
    if (cfg.autoLocate) { doLocate(true); firstQueryGuard(); return true; }   // 无设备定位 → 直接走网络(IP)兜底
    return false;
  }
  const tryLoc = () => doLocate(true);   // 启动期均为后台定位，失败不该把首屏一起带走
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'geolocation' })
      .then(ps => { if (ps.state === 'granted' || cfg.autoLocate) tryLoc(); })
      .catch(() => { if (cfg.autoLocate) tryLoc(); });
    return false;   // 交给权限回调决定，init 仍回退到上次城市
  }
  if (cfg.autoLocate) { tryLoc(); firstQueryGuard(); return true; }
  return false;
}

/* ---------- 每 30 秒的自动重定位 ----------
 * 开了「自动定位」就每 30 秒重新取一次位置，位置真的挪了才重查天气。
 * 三道闸门：① 当前显示的不是定位结果（用户手动搜了城市、或在轮播/对比里）→ 不动；
 * ② 页面在后台 → 不动；③ 新坐标与上次差不到 1km → 不动（否则整屏每 30 秒白闪一次）。
 * 只用设备定位，不拿 IP 定位凑数：每 30 秒打一次第三方 IP 库既失礼，VPN 下还会来回跳城市。
 * maximumAge 也必须比启动那次小 —— 沿用 5 分钟缓存的话，每轮拿到的都是同一个旧坐标。 */
const LOCATE_MS = 30000, MOVE_KM = 1;
let locateTimer = null;
function kmBetween(a, b) {
  const mid = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const dx = (a.lon - b.lon) * Math.cos(mid), dy = a.lat - b.lat;
  return Math.sqrt(dx * dx + dy * dy) * 111.32;
}
export function setupAutoLocate() {
  if (locateTimer) { clearInterval(locateTimer); locateTimer = null; }
  if (!loadConfig().autoLocate || !hasDeviceLocation()) return;
  locateTimer = setInterval(() => {
    if (document.hidden || ui.compareOpen()) return;
    if (!locatedTarget || !sameTarget(locatedTarget, lastQuery())) return;
    devicePosition({ enableHighAccuracy: false, timeout: GEO_OPTS.timeout, maximumAge: 30000 }).then(p => {
      if (lastFix && kmBetween(p, lastFix) < MOVE_KM) return;
      renderLocated({ lat: p.lat, lon: p.lon, label: '我的位置' });
    }).catch(() => { /* 这一轮没定到，下一轮再说，不打断用户 */ });
  }, LOCATE_MS);
}
