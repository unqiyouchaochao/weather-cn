/* wttr.in：public-apis 那份选型里**唯一免密钥、免注册、能直接按坐标查**的源
 * （2026-09-20 本机广东移动实测 200，0.5~1.5 s，`{lat},{lon}?format=j1`）。
 *
 * 三个短板都在 normalize 里处理了，也都写进了 note，别让它当主源：
 * 1. 只有 3 天预报，且逐小时是 3 小时一档（每天 8 条），不是真逐小时；
 * 2. 描述**没有中文**（实测 `?lang=zh` 在 j1 里返回的还是 "Sunny"，`lang_zh` 字段填的就是英文），
 *    所以走 lib/weather.js 的 `wwo()` 自带码表出中文；
 * 3. 报文里没有昼夜标记与时区，昼夜只能按本地小时 6~18 点粗判 ——
 *    查异地城市时这个近似会偏，但比晚上显示太阳好。
 * 另外它不给空气质量（cap.air=false），AQI 由 ui.loadAir 那一条链用 Open-Meteo 兜底。 */
import { wwo, nightIcon, hourlyByDate } from '../lib/weather.js';
import { bestCity } from '../lib/geo.js';

const num = v => {
  const n = Number(v);
  return v == null || v === '' || !isFinite(n) ? null : n;
};

// astronomy 用 "06:20 AM"，界面只认 ISO 形状（util.hhmm 截 [11,16)），故拼成 dateT HH:MM
function toIso(date, hm) {
  const m = /^(\d{1,2}):(\d{2})\s*([AP])M$/i.exec(String(hm || '').trim());
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/p/i.test(m[3])) h += 12;
  return date + 'T' + String(h).padStart(2, '0') + ':' + m[2];
}

const dayHour = () => {
  const d = new Date();
  return { date: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'), h: d.getHours() };
};

export const wttrIn = {
  id: 'wttr-in',
  label: 'wttr.in（免密钥·无需注册）',
  needsKey: false,
  note: '免密钥免注册、按坐标直查，但只有 3 天预报、逐小时是 3 小时一档，且不带空气质量。上游是 best-effort 公共服务、会限流，适合当兜底源。',
  cap: { byCityName: false, air: false, hourly: true, daily: true },
  /* 这一家「逐小时」是 3 小时一档（每天 8 条）—— 声明要跟着改口，界面那一栏的窗口标题也要。
   * 2026-10-01 拿真报文复验过（`tests/fixtures/wttr-j1.json`，兰州 36.0611,103.8343）：
   * 3 天 × 8 档，`hourly[].time` 是 0/300/600/…/2100。**这个数是量出来的，不是照抄上面那段注释**：
   * 回归里有一条拿它跟报文实算的间隔对，改了报文形状而声明没改就会红。 */
  hourlyStep: 3,

  // 城市名 → 坐标用本地那套中文检索（多变体 + 等级择优），不依赖 wttr.in 自己的解析：
  // 它给的 nearest_area 是威妥玛拼音（实测 Hsinhsinghsien），界面没法看
  async geocode(city) { return bestCity(city); },

  async weather(lat, lon) {
    const r = await fetch('https://wttr.in/' + lat + ',' + lon + '?format=j1');
    if (!r.ok) throw new Error('wttr.in 请求失败（HTTP ' + r.status + '，该服务会限流）');
    const j = await r.json();
    if (!j || !j.current_condition || !j.current_condition[0]) throw new Error('wttr.in 返回异常');
    return j;
  },

  normalize(raw) {
    const now = dayHour();
    const isDayNow = now.h >= 6 && now.h < 18;
    const c = raw.current_condition[0];
    const w = wwo(c.weatherCode);
    const hourly = [];
    (raw.weather || []).forEach(d => (d.hourly || []).forEach(h => {
      const t4 = String(h.time || '0').padStart(4, '0');
      const hh = t4.slice(0, 2);
      const ww = wwo(h.weatherCode);
      const isDay = Number(hh) >= 6 && Number(hh) < 18;
      hourly.push({
        time: d.date + 'T' + hh + ':00', temp: num(h.tempC),
        precipProb: num(h.chanceofrain), precip: num(h.precipMM), desc: ww.desc,
        icon: nightIcon(ww.icon, isDay), code: num(h.weatherCode), isDay
      });
    }));
    const daily = (raw.weather || []).map(d => {
      const hs = d.hourly || [];
      const mid = hs[4] || hs[0] || {};          // 12:00 那档代表白天
      const ww = wwo(mid.weatherCode);
      const ast = (d.astronomy || [])[0] || {};
      return {
        date: d.date, tmax: num(d.maxtempC), tmin: num(d.mintempC),
        desc: ww.desc, icon: ww.icon, code: num(mid.weatherCode),
        sunrise: toIso(d.date, ast.sunrise), sunset: toIso(d.date, ast.sunset),
        precipProb: hs.length ? Math.max.apply(null, hs.map(h => num(h.chanceofrain) || 0)) : null,
        precip: hs.length ? hs.reduce((s, h) => s + (num(h.precipMM) || 0), 0) : null
      };
    });
    return {
      current: {
        temp: num(c.temp_C), feels: num(c.FeelsLikeC), humidity: num(c.humidity),
        wind: num(c.windspeedKmph), desc: w.desc, code: num(c.weatherCode),
        icon: nightIcon(w.icon, isDayNow), pressure: num(c.pressure), uv: num(c.uvIndex)
      },
      hourlyByDay: hourlyByDate(hourly),
      daily
    };
  }
};
