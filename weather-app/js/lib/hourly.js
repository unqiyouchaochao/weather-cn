/* 「今日天气」的数据从哪来。
 *
 * 默认源「中国天气」的报文里**没有逐小时预报**（`cap.hourly:false`；`passedchart` 那 24 格是
 * 过去 24 小时实测，最新一格就是刚发布的那个整点，不能当预报）。只认当前源的话这张卡在日常
 * 配置下永远不出现，所以给它加一条退路：当前源给得出就用当前源的，给不出就单独问一次
 * Open-Meteo 的逐小时模型值。
 *
 * 两个源的数不可直接混着看，所以**退到第二个源时出处必须写在卡上**（宁缺勿错 —— 与空气质量
 * 那条四级链同一套做法）；而当前源自己给得出时不加徽章，页面底部那行「数据源：X」已经说了是谁的数，
 * 再重复一遍只会多一块噪声。
 *
 * 两边都拿不到就返回 null，让整块隐藏 —— 一张空卡比没有卡更糟。 */
import { getProvider } from '../providers/index.js';

/* 一次查询会打这张卡一回（30 秒自动定位、半分钟一次的原地刷新都会重新 query），
 * 而逐小时数据一小时之内不会变样 —— 按坐标缓存 30 分钟，别为同一张卡反复敲第三方接口。 */
const TTL = 30 * 60 * 1000;
const cache = new Map();

function localDay() {
  const d = new Date(), p = n => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
/* 「今天」优先取源自己给的那一天：跨时区搜别处时浏览器日期不等于当地的今天。
 * daily[0] 可信是因为 chinaWeather.normalize 已经按「本地今天」把昨天那一格切掉了（见那里）。 */
function todayOf(data) {
  const d0 = ((data || {}).daily || [])[0];
  return d0 && d0.date ? String(d0.date).slice(0, 10) : localDay();
}

async function openMeteoHours(lat, lon) {
  const k = lat + ',' + lon;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const om = getProvider({ provider: 'open-meteo' });
  const data = om.normalize(await om.weather(lat, lon));
  cache.set(k, { at: Date.now(), data });
  return data;
}

/* 一档隔几个小时 —— **量出来，不假定**。栏目原本写着「今天 00–23 时」，而 wttr.in 给的是每天 8 档
 * （3 小时一档），窗口标题于是比内容宽。取相邻两档的最小正间隔；只有一档或时刻读不出就给 0，
 * 意思是「间隔声明不成立」，界面那行退回不带档位的写法。 */
function stepOf(hours) {
  let s = 0;
  for (let i = 1; i < (hours || []).length; i++) {
    const a = Number(String(hours[i - 1].time || '').slice(11, 13));
    const b = Number(String(hours[i].time || '').slice(11, 13));
    if (!isFinite(a) || !isFinite(b)) continue;
    const d = b - a;
    if (d > 0 && (s === 0 || d < s)) s = d;
  }
  return s;
}

/** 今天 00–23 那一天的逐小时。
 *  返回 { day, hours, byDay, src, fallback, nowAt, step }；拿不到返回 null。
 *  byDay 一并带回：逐日卡「点某天看当天」用的是同一批数，出处也一样。 */
export async function todayHours(provider, lat, lon, data) {
  const own = (data || {}).hourlyByDay || {};
  if (Object.keys(own).length) {                     // 当前源自己给得出，一问到底，不打第二家
    const day = todayOf(data);
    const hours = own[day];
    return hours && hours.length > 1
      ? { day, hours, byDay: own, src: '', fallback: false, nowAt: (data.current || {}).time || '', step: stepOf(hours) }
      : null;                                        // 今天这一格没有：整块收起，不拿别天糊
  }
  if (lat == null || lon == null) return null;
  const om = await openMeteoHours(lat, lon).catch(() => null);
  if (!om) return null;
  const day = todayOf(om);
  const hours = (om.hourlyByDay || {})[day];
  if (!hours || hours.length < 2) return null;
  return { day, hours, byDay: om.hourlyByDay, src: 'Open-Meteo 模型值', fallback: true,
    nowAt: (om.current || {}).time || '', step: stepOf(hours) };
}
