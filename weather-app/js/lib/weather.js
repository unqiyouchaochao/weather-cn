/* 气象语义模型：WMO 天气代码 → 中文描述/图标、夜间换星形、逐小时数据的标准化与切片。 */

const WMO = {
  0: { desc: '晴', icon: 'sun' },
  1: { desc: '晴间多云', icon: 'sun-02' },
  2: { desc: '局部多云', icon: 'cloudy' },
  3: { desc: '阴', icon: 'cloud' },
  45: { desc: '雾', icon: 'fog' }, 48: { desc: '雾凇', icon: 'fog' },
  51: { desc: '小毛毛雨', icon: 'rain' }, 53: { desc: '毛毛雨', icon: 'rain' }, 55: { desc: '大毛毛雨', icon: 'rain' },
  56: { desc: '冻毛毛雨', icon: 'rain-02' }, 57: { desc: '强冻毛毛雨', icon: 'rain-02' },
  61: { desc: '小雨', icon: 'rain' }, 63: { desc: '中雨', icon: 'rain' }, 65: { desc: '大雨', icon: 'rain-02' },
  66: { desc: '冻雨', icon: 'rain-02' }, 67: { desc: '强冻雨', icon: 'rain-02' },
  71: { desc: '小雪', icon: 'snowy' }, 73: { desc: '中雪', icon: 'snowy' }, 75: { desc: '大雪', icon: 'snowy' }, 77: { desc: '雪粒', icon: 'snowflake' },
  80: { desc: '阵雨', icon: 'rain-02' }, 81: { desc: '强阵雨', icon: 'rain-02' }, 82: { desc: '暴雨', icon: 'rain-02' },
  85: { desc: '阵雪', icon: 'snowy' }, 86: { desc: '强阵雪', icon: 'snowy' },
  95: { desc: '雷阵雨', icon: 'thunderstorm' }, 96: { desc: '雷阵雨伴冰雹', icon: 'thunderstorm' }, 99: { desc: '强雷阵雨伴冰雹', icon: 'thunderstorm' }
};

export function wmo(code) { return WMO[code] || { desc: '未知', icon: 'cloud' }; }

// 夜间把太阳图标换成月亮（pack 里的 night），避免大白天样式出现在晚上。
// 以前用的是 star（四角星闪），读起来更像「幸运/高亮」而不是「夜里」，所以换掉。
export function nightIcon(icon, isDay) {
  return (!isDay && (icon === 'sun' || icon === 'sun-02')) ? 'night' : icon;
}

/* OpenWeatherMap 的编号体系与 WMO 不同，单独映射 */
export function owmIcon(id) {
  if (id >= 200 && id < 300) return 'thunderstorm';
  if (id >= 300 && id < 400) return 'rain';
  if (id >= 500 && id < 600) return 'rain-02';
  if (id >= 600 && id < 700) return 'snowy';
  if (id >= 700 && id < 800) return 'fog';
  if (id === 800) return 'sun';
  if (id === 801) return 'sun-02';
  /* 803 的描述是「多云」，就得和 802 一样给 cloudy：以前它和 804 共用 cloud，
   * 于是同一个词在「走文字的那路」和「走数字码的这路」下长出两枚图标。 */
  if (id === 802 || id === 803) return 'cloudy';
  if (id === 804) return 'cloud';
  return 'cloud';
}
export function owmDesc(id) {
  if (id >= 200 && id < 300) return '雷阵雨';
  if (id >= 300 && id < 400) return '毛毛雨';
  if (id >= 500 && id < 600) return '降雨';
  if (id >= 600 && id < 700) return '降雪';
  if (id >= 700 && id < 800) return (id === 741 ? '雾' : (id === 761 ? '沙尘' : '雾霾'));
  if (id === 800) return '晴';
  if (id === 801) return '晴间多云';
  if (id === 802) return '局部多云';
  if (id === 803) return '多云';
  if (id === 804) return '阴';
  return '未知';
}

/* wttr.in 用的是 World Weather Online 的编号体系（又一套，跟 WMO / OWM 都不同）。
 * 它的 j1 接口**没有中文**（实测 ?lang=zh 回来还是 "Sunny"，lang_zh 字段填的就是英文），
 * 所以描述只能自己给；图标复用上面 WMO 那套名字。 */
const WWO = {
  113: ['晴', 'sun'], 116: ['晴间多云', 'sun-02'], 119: ['多云', 'cloudy'], 122: ['阴', 'cloud'],
  143: ['薄雾', 'fog'], 148: ['霾', 'fog'], 149: ['烟霾', 'fog'], 248: ['雾', 'fog'], 260: ['冻毛毛雨', 'rain-02'],
  176: ['有雨', 'rain'], 182: ['雨夹雪', 'rain-02'], 185: ['冻毛毛雨', 'rain-02'], 200: ['可能有雷暴', 'thunderstorm'],
  227: ['吹雪', 'snowy'], 230: ['暴风雪', 'snowy'],
  263: ['小阵雨伴雷', 'rain'], 266: ['小雨', 'rain'], 281: ['小冻毛毛雨', 'rain-02'], 284: ['冻毛毛雨', 'rain-02'],
  293: ['零星小雨', 'rain'], 296: ['小雨', 'rain'], 299: ['间歇中雨', 'rain'], 302: ['中雨', 'rain'],
  305: ['间歇大雨', 'rain-02'], 308: ['大雨', 'rain-02'], 311: ['冻雨', 'rain-02'], 314: ['强冻雨', 'rain-02'],
  317: ['雨夹雪', 'rain-02'], 320: ['强雨夹雪', 'snowy'],
  353: ['小阵雨', 'rain'], 356: ['间歇中雨', 'rain-02'], 359: ['强降雨阵', 'rain-02'],
  362: ['小雨夹雪阵', 'rain-02'], 365: ['中雨夹雪阵', 'rain-02'],
  368: ['小阵雪', 'snowy'], 371: ['中到大阵雪', 'snowy'], 374: ['小阵雪', 'snowy'], 377: ['中阵雪', 'snowy'],
  386: ['阵雨伴雷', 'thunderstorm'], 389: ['中到大雨伴雷', 'thunderstorm'], 392: ['暴雨伴雷', 'thunderstorm'],
  395: ['大雪伴雷', 'thunderstorm']
};
export function wwo(code) {
  const x = WWO[Number(code)];
  return x ? { desc: x[0], icon: x[1] } : { desc: '未知', icon: 'cloud' };
}

/* 只有中文现象文字时的图标推断 —— 中国天气给的是文字而不是标准码，
 * 两边共用这一张表（判据从「雷」排到「阴」，先命中先赢，所以顺序就是语义优先级）。
 * 「雷」排在「雹」前面是有意的：「雷阵雨伴冰雹」两个关键字都有，该给雷暴（更该被注意到的那个），
 * 只有不伴雷的纯冰雹/霰才落到 hail。
 * 2026-10-12 真机装机改的两处：① 「多云」原来给的是 sun-02（一枚纯太阳，pack 那枚还是镂空的），
 * 屏上写着多云、画着太阳，现在给 cloudy（云后露半个日头）；② 「晴间多云」单独一条并排在「晴」之前，
 * 因为 /晴/ 会把它一起吃掉 —— 数字码那三张表里 WMO 1 / OWM 801 / WWO 116 说的是同一件事，
 * 同一个词在两家源下面长出两个图标就是漂移。现在四档是一级的：晴 sun · 晴间多云 sun-02 · 多云 cloudy · 阴 cloud。 */
const TEXT_ICON = [
  [/雷/, 'thunderstorm'],
  [/雹/, 'hail'],
  [/雪/, 'snowy'],
  [/雾|霾/, 'fog'],
  [/沙尘|扬沙|浮尘|大风|龙卷/, 'wind'],
  [/阵雨/, 'rain-02'],
  [/雨/, 'rain'],
  [/晴间多云/, 'sun-02'],   // 必须排在「晴」前面，否则被 /晴/ 先吃掉
  [/晴/, 'sun'],
  [/多云|少云/, 'cloudy'],
  [/阴/, 'cloud']
];
export function iconFromText(text) {
  const t = String(text || '');
  for (let i = 0; i < TEXT_ICON.length; i++) if (TEXT_ICON[i][0].test(t)) return TEXT_ICON[i][1];
  return 'cloud';
}

/* ---------- 逐小时数据 ---------- */
// 一次拉到的全部整点（Open-Meteo 给 7×24 条），先统一标准化
export function hourlyList(raw) {
  const h = raw.hourly;
  if (!h || !h.time || !h.time.length) return [];
  const out = [];
  for (let i = 0; i < h.time.length; i++) {
    const code = h.weather_code ? h.weather_code[i] : null;
    const wm = wmo(code);
    const isDay = h.is_day ? !!h.is_day[i] : true;
    out.push({
      time: h.time[i],
      temp: h.temperature_2m ? h.temperature_2m[i] : null,
      precipProb: h.precipitation_probability ? h.precipitation_probability[i] : null,
      precip: h.precipitation ? h.precipitation[i] : null,
      desc: wm.desc, icon: nightIcon(wm.icon, isDay), code, isDay
    });
  }
  return out;
}
// 按日期分组，供「今日天气」取当天 24 格与「点某天看当天逐小时」用
export function hourlyByDate(list) {
  const g = {};
  list.forEach(x => {
    const d = String(x.time).slice(0, 10);
    (g[d] = g[d] || []).push(x);
  });
  return g;
}

/* ---------- 空气质量分级（US AQI） ---------- */
export const AQI_LEVELS = [
  { max: 50, label: '优', color: '#22a06b' },
  { max: 100, label: '良', color: '#d9a514' },
  { max: 150, label: '轻度污染', color: '#e2801f' },
  { max: 200, label: '中度污染', color: '#d94a4a' },
  { max: 300, label: '重度污染', color: '#8e44ad' },
  { max: Infinity, label: '严重污染', color: '#7b1f2b' }
];
export function aqiLevel(v) {
  for (const l of AQI_LEVELS) if (v <= l.max) return l;
  return AQI_LEVELS[AQI_LEVELS.length - 1];
}

/* 背景随天气变化：图标名 → 天气态。这个值写成 body 的 data-weather 属性，
 * styles.css 里那六条 body[data-weather="x"] 规则去取主题给的 --w-x 渐变。
 * 以前这里是 'bg-clear' 这样的类名、CSS 也按类选，多出一层「前缀」只在 JS 里拼一次，
 * 现在整串就是态名，少一处两边对不上的地方。 */
export const BG_STATE = {
  sun: 'clear', 'sun-02': 'clear', rainbow: 'clear', star: 'clear', fire: 'clear',
  cloudy: 'cloud', cloud: 'cloud', wind: 'cloud', 'temperature-down': 'cloud',
  rain: 'rain', 'rain-02': 'rain', 'temperature-up': 'clear',
  snowy: 'snow', snowflake: 'snow',
  thunderstorm: 'storm', lightning: 'storm',
  fog: 'fog', temperature: 'cloud'
};
