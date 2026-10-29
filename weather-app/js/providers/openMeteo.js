/* 默认数据源：Open-Meteo（免密钥、无需注册）。
 * 天气与空气质量是两个独立接口；AQI 慢或被墙时 ui 层会静默隐藏，不拖累主体。 */
import { bestCity } from '../lib/geo.js';
import { wmo, nightIcon, hourlyList, hourlyByDate } from '../lib/weather.js';

/* 空气质量那一问按坐标缓存 30 分钟，并把同一坐标的并发合并成一发。
 * 为什么必须缓存：界面那条空气链的第 3 级（ui.js 的 loadAir）会**无条件**再问一次 Open-Meteo，
 * 而国控站约四成缺测 —— 开着自动刷新（30/60/300 秒）时，这就变成每半分钟敲一发第三方接口，
 * 而它回的本来就是**一小时一档**的模型值（报文里 `interval: 3600`，2026-10-01 实测）。
 * 30 分钟与 lib/hourly.js 那一份逐小时缓存同一档，不会读到更旧的数。 */
const AIR_TTL = 30 * 60 * 1000;
const airCache = new Map();
const airInflight = new Map();
const airKey = (lat, lon) => Number(lat).toFixed(2) + ',' + Number(lon).toFixed(2);   // 0.01° ≈ 1km，城市尺度的数不需要更细

export const openMeteo = {
  id: 'open-meteo',
  label: 'Open-Meteo（免密钥）',
  needsKey: false,
  note: '免密钥、免接口地址，选中即可用。功能最全：逐小时 7×24 条 + 7 天 + 空气质量与分项污染物。',
  cap: { byCityName: false, air: true, hourly: true, daily: true },
  // 空气质量是 CAMS 模式预报算出来的，不是监测站实测；它回的 us_aqi 用 EPA 断点，国标要从浓度重算（见 lib/aqi.js）
  airLabel: 'CAMS 模型',
  airStd: 'us',

  async geocode(city) { return bestCity(city); },

  async weather(lat, lon) {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
      '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,pressure_msl,uv_index,is_day' +
      '&hourly=temperature_2m,weather_code,precipitation_probability,precipitation,is_day' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,precipitation_sum' +
      '&timezone=auto&forecast_days=7';
    const r = await fetch(url);
    if (!r.ok) throw new Error('Open-Meteo 请求失败');
    return await r.json();
  },

  async airQuality(lat, lon) {
    /* 六项浓度一次问全：lib/aqi.js 的 cnAqi 读的就是这六项（NO₂/SO₂/CO 少请求一项，`.filter(p => p[1] != null)`
     * 就把它静默丢掉，于是「国标」其实只由三项算出 —— 2026-10-01 体检量的六城×168 小时回灌里，
     * 太原有 9/192 小时六项算出来更高（最大差 6 个 IAQI，跨档 0 次）。同一发请求免费带出，没有理由少要。 */
    const k = airKey(lat, lon);
    const hit = airCache.get(k);
    if (hit && Date.now() - hit.at < AIR_TTL) return hit.data;
    if (airInflight.has(k)) return airInflight.get(k);
    const url = 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + lat + '&longitude=' + lon +
      '&current=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide&timezone=auto';
    const p = fetch(url).then(async r => {
      if (!r.ok) throw new Error('空气质量接口失败');
      const j = await r.json();
      if (j && j.current) airCache.set(k, { at: Date.now(), data: j });
      return j;
    });
    p.catch(() => {});                       // 在途那份失败时由调用方处理，这里只保证别把键卡住
    p.then(() => airInflight.delete(k), () => airInflight.delete(k));
    airInflight.set(k, p);
    return p;
  },

  normalize(raw) {
    const c = raw.current;
    const w = wmo(c.weather_code);
    const d = raw.daily;
    const daily = d.time.map((t, i) => {
      const code = d.weather_code[i];
      const ww = wmo(code);
      return {
        date: t, tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i],
        desc: ww.desc, icon: ww.icon, code,
        sunrise: d.sunrise && d.sunrise[i], sunset: d.sunset && d.sunset[i],
        precipProb: d.precipitation_probability_max && d.precipitation_probability_max[i],
        precip: d.precipitation_sum && d.precipitation_sum[i]
      };
    });
    const hl = hourlyList(raw);
    return {
      current: {
        temp: c.temperature_2m, feels: c.apparent_temperature, humidity: c.relative_humidity_2m,
        wind: c.wind_speed_10m, desc: w.desc, code: c.weather_code,
        icon: nightIcon(w.icon, c.is_day == null ? true : !!c.is_day),
        // time 是**当地**的此刻（timezone=auto）：「今日天气」要靠它判哪几格已经过去，
        // 拿浏览器时钟去标别处的「现在」会标错
        pressure: c.pressure_msl, uv: c.uv_index, time: c.time
      },
      hourlyByDay: hourlyByDate(hl),
      daily
    };
  }
};
