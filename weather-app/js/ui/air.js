/* 空气质量卡：主视图渲染完再异步补。AQI 接口慢、被墙或数据源不支持时静默隐藏，绝不拖累天气主体。
 * 谁可以改我：改「四级链怎么退、卡上写谁的出处」的人 —— 每一级的口径差异都写在这条链的注释里。 */
import { el } from '../lib/dom.js';
import { esc, fmtNum } from '../lib/util.js';
import { aqiLevel } from '../lib/weather.js';
import { pickAir, STD_NAME } from '../lib/aqi.js';
import { providerLabel, getProvider } from '../providers/index.js';
import { inkFor } from '../lib/glass.js';
import { setAir } from '../lib/notify.js';
import { BARE_BASES } from './place.js';
import { loadConfig } from '../lib/config.js';
import * as hwAqi from '../lib/hwAqi.js';

let lastAirNum = null;   // 上一次画在卡上的数值，用来判「原地刷新时它到底变了没有」
/* 收起 AQI 卡：改完设置要主动收一次，见 main.js 的 saveSettings。
 * 同一目标原地刷新时 loadAir 故意不收（收了就是每 30 秒闪一次空白），
 * 但口径/数据源是用户刚改的，旧卡上那个数已经不代表任何他选的东西了。 */
export function clearAir() { el.airWrap.hidden = true; el.air.innerHTML = ''; lastAirRank = null; }
/* 点空气质量卡要看排名时用得上（见 main.js 的绑定）。走 Open-Meteo 兜底那一级时没有榜，
 * 退回来的是 null —— 那种情况下点击不该假装能排名，界面靠 .clickable 类控制光标与提示。 */
let lastAirRank = null;
export function airRank() { return lastAirRank; }
/* 这条链是**异步且没有取消**的：先搜 A 再搜 B，A 那一发 AQI 可能比 B 晚回来。
 * 没有令牌的话它会直接盖在 B 的卡上 —— 数字与出处都是 A 的，界面却写着 B，
 * 正是这个项目最不该出现的一种错（宁缺勿错）。airSeq 每次进 loadAir 自增，
 * 回来时发现自己已经不是最新一轮就整条丢掉。 */
let airSeq = 0;
/** place：这一屏是哪儿（站点名或搜索词）。第 2 级（城市榜）自带市名，不重复加。 */
export function loadAir(provider, lat, lon, keepVisible, place) {
  const seq = ++airSeq;
  // keepVisible=true 是「同一目标原地刷新」：这时候不能先把卡收起来，否则 AQI 每 30 秒闪一次空白。
  // 但换城市时必须收 —— 让上一座城市的 AQI 留在屏幕上，等于拿别的城市糊弄（宁缺勿错）。
  if (!keepVisible) clearAir();
  if (lat == null || lon == null) return;
  // AQI 是一条四级链，并且**把出处带到卡上**：各级的精度与口径不可直接比较（国控站实测的国标
  // AQI 与 CAMS 模型算的美标 US AQI，同一坐标同日实测差过 2.65~4.17 倍），不标出来就是拿卡片骗人。
  //   1) 当前源自带的 AQI —— 但 cap.air:true 只代表「可能有」：中国天气实测约 38% 站点缺测
  //   2) 华为天气的城市榜：地级市一级的**实测国标**（中国天气缺测的那些市它有），还带全国排名；
  //      代价是只到市，所以卡上一定写清是哪个市的（见 lib/hwAqi.js 顶部）
  //   3) 再拿不到才用 Open-Meteo 兜底（CAMS 模型值 + 美标，卡上必须写明）
  //   4) 全拿不到才整卡隐藏 —— 宁缺勿错
  const has = r => !!(r && r.current && r.current.us_aqi != null);
  // own：这一级的出处字符串**自带地名**（城市榜给的是「云浮市 全市」），那就不再叠加屏上的地名
  const withTag = (p, src, std) => p.then(r => (has(r)
    ? { raw: r, src: r.src || src, std: r.std || std, rank: r.rank || null, own: !!r.src } : null));
  Promise.resolve(provider.cap.air ? withTag(provider.airQuality(lat, lon), provider.airLabel || providerLabel(provider.id), provider.airStd) : null)
    .catch(() => null)                                  // 源连站都没匹到，按缺测处理
    .then(hit => hit || withTag(hwAqi.cityAqi(lat, lon)).catch(() => null))
    .then(hit => {
      if (seq !== airSeq) return null;   // 换城市了：别再为这一屏打第三发请求
      if (hit) return hit;
      if (provider.id === 'open-meteo') return null;    // 第 3 级刚打过同一个接口，不重复请求
      const om = getProvider({ provider: 'open-meteo' });
      return withTag(om.airQuality(lat, lon), om.airLabel, om.airStd).catch(() => null);
    })
    .then(hit => {
      if (seq !== airSeq) return;        // 过期的一律不画，也不许动 lastAirNum/lastAirRank
      const a = hit && hit.raw && hit.raw.current;
      if (!a || a.us_aqi == null) return;
      // 口径切换只在「源给了浓度」时才换得动；换不动时 pickAir 带回一句 note，必须显示在卡上（宁缺勿错）
      const picked = pickAir(a, loadConfig().aqiStd, hit.std);
      if (picked.v == null || isNaN(picked.v)) return;
      const lv = aqiLevel(picked.v);
      const v = Math.round(picked.v);
      // 整张卡是重建成 innerHTML 的，所以给新节点挂上 bump 就会在插入时自己播一次
      const airBump = keepVisible && lastAirNum !== null && lastAirNum !== v;
      lastAirNum = v;
      // 分项浓度是可选字段：中国天气只给 AQI 不给 PM2.5/PM10/O₃，全缺就不画这一行
      const sub = (a.pm2_5 == null && a.pm10 == null && a.ozone == null) ? '' :
        '<span class="air-sub">PM2.5 ' + fmtNum(a.pm2_5) + ' · PM10 ' + fmtNum(a.pm10) + ' · O₃ ' + fmtNum(a.ozone) + ' µg/m³</span>';
      el.airWrap.hidden = false;
      lastAirRank = hit.rank || null;
      const rank = hit.rank && hit.rank.order ? '<span class="air-rank">全国第 ' + hit.rank.order + ' / ' + hit.rank.total + ' 位</span>' : '';
      /* 徽章必须写清这组数是哪座城/哪个站的。第 1 级（provider 自带）以前只写「国控站实测 · 国标」，
       * 搜出来的城市屏幕上根本看不出这个数字属于谁 —— 而国控站是**一个点**，不写站点名就等于
       * 拿市域/邻站数字冒充用户脚下（第 2 级本来就带市名，所以那一侧不重复叠加）。
       * 「我的位置」「网络定位」这类不是地名的标题也不加，加了就是假出处。 */
      const bare = !place || place === '我的位置' || place === '网络定位' || BARE_BASES.indexOf(place) >= 0;
      const airSrc = (hit.own || bare) ? hit.src : place + ' ' + hit.src;
      el.air.innerHTML =
        '<span class="air-badge" style="background:' + lv.color + ';color:' + inkFor(lv.color) + '">' + esc(lv.label) + '</span>' +
        '<span class="air-num' + (airBump ? ' bump' : '') + '">' + v + '<i>AQI</i></span>' +
        '<span class="cur-src" title="这组空气质量的出处与口径">' + esc(airSrc + (STD_NAME[picked.std] ? ' · ' + STD_NAME[picked.std] : ' · 口径未知') + (picked.note ? '（' + picked.note + '）' : '')) + '</span>' + rank + sub;
      setAir(v, lv.label);   // AQI 比天气晚到，到了再同步一次通知栏
    })
    .catch(() => { /* 静默 */ });
}
