/* 用户偏好：设置持久化（localStorage）与单位换算。
 * loadConfig 结果做进程内缓存 —— 渲染路径（图表、每格温度）会高频调用 fmtTemp/uTemp，
 * 每次都 JSON.parse 一遍在移动端能感觉到。saveConfig 同步更新缓存。 */

import { defaultOf, themeKnown } from './themes.js';
import { refreshPluginIndex } from './themePlugin.js';

const LS_KEY = 'weather-studio-config';
/* 主题迁移用的那张表（2026-10-06 从 11 套收到 2 套）。它只服务于**已经不存在的那些 id**，
 * 现清单在 lib/themes.js，这里不抄第二份：留着旧 id 的键名 → 落在同一明暗侧的默认套上，
 * 深色用户不会因为删了「深海」就一觉醒来变成浅色。手改出来的乱码认不出侧，走浅色默认。
 * 表里那个 2026-10-10 撤成主题插件的 id 走的是另一条路：带那个包的安装版本里
 * refreshPluginIndex 会先把它认回来（所以根本轮不到这一行）；只有没带包的那份构建才会落到这里换成 mint。
 * 键名留着是为了两种情况下都不把一个还认得的 id 当乱码处理。 */
const 已删主题 = { bridal: 'light', light: 'light', sunset: 'light', paper: 'light', mono: 'light', tianyi: 'light',
  ocean: 'dark', dusk: 'dark', ember: 'dark', oled: 'dark' };
/* 默认数据源换过一次（open-meteo → 中国天气）：光改这里对**已存过配置**的设备无效，
 * 所以配一个一次性迁移（见下方 DEF_VER）。用户自己在设置里选过的源不该被覆盖，
 * 但绝大多数人从没动过，那一次就该吃到新默认。 */
export const DEFAULT_CFG = {
  provider: 'nmc',
  key: '',
  lastCity: '北京',
  aqiStd: 'auto',        // AQI 口径：auto 跟随数据源 / us 美标 / cn 国标，见 lib/aqi.js 的 pickAir
  theme: 'mint',         // 见 lib/themes.js；旧字段 dark 在 loadConfig 里平移。从没动过主题的人才会吃到这个默认
  darkTheme: null,       // 最近一次生效的深色主题 id：☀/🌙 切回浅色后再点，回到的是这套而不是默认深色
  lightTheme: null,      // 深色那一半的镜像：切回浅色时回到用户自己挑的那套，而不是列表里的默认浅色
  favorites: [],
  units: { temp: 'C', wind: 'kmh' },
  autoLocate: false,      // 启动自动定位（权限已授予时总会尝试）
  autoRefresh: 0,         // 自动刷新/轮播间隔（秒，0=关）
  birth: null,            // 运势板块的生辰 {iso,y,mo,d,s}；s 是时辰序号 0..11，-1=不确定。只存本机
  locFix: null,           // 最近一次「设备定位」成功的 {lat,lon,at}；定位超时时用来判断能否沿用，见 main.js
  /* 通知栏实时天气。on 默认开（用户要的功能），fields 缺项按 notify.js 里的默认值补，
   * 所以这里只列出来当「可选项清单」的参照，不必每个都写。 */
  notify: { on: true, fields: { temp: true, desc: true, range: true, humidity: true, wind: true, aqi: true, time: true, feels: false } },
  /* 气象预警提醒。min 是级别分（见 lib/alerts.js 的 LEVELS：0 全部 / 2 黄色及以上 / 3 橙 / 4 红），
   * 默认黄色起 — 蓝色那档多是「大风蓝色」这类日常提醒，用户明确说过别吵。 */
  alert: { on: true, min: 2 },
  /* 这里以前有一项 bg（{mode, id, chip}）：背景模式 + 预设 id + 卡面不透明度。
   * 2026-10-04 背景模块取消，底与透出都成了主题自己的设计值（js/lib/themes.js 的 w / glass），
   * 所以配置里不再存「背景」这件事。老数据由 loadConfig 的 defVer=3 那一步清掉。 */
  custom: {
    geoUrl: 'https://geocoding-api.open-meteo.com/v1/search?name={city}&count=1&language=zh&format=json',
    curUrl: 'https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto',
    dayUrl: 'https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=7',
    hourUrl: '',
    needsKey: false,
    // 默认示例即「用声明式映射接 Open-Meteo」，切到自定义 API 时开箱可用，也是映射语法的参照
    map: {
      codes: 'wmo',
      units: { temp: 'C', wind: 'kmh' },
      geo: {
        list: 'results',
        fields: { lat: 'latitude', lon: 'longitude', name: 'name', admin: 'admin1', country: 'country' }
      },
      current: {
        time: 'current.time',
        temp: 'current.temperature_2m',
        feels: 'current.apparent_temperature',
        humidity: 'current.relative_humidity_2m',
        wind: 'current.wind_speed_10m',
        code: 'current.weather_code'
      },
      daily: {
        list: 'daily.time',
        fields: {
          date: 'daily.time',
          tmax: 'daily.temperature_2m_max',
          tmin: 'daily.temperature_2m_min',
          code: 'daily.weather_code'
        }
      }
    }
  }
};

const clone = o => JSON.parse(JSON.stringify(o));

/* 默认值升版号：改了 DEFAULT_CFG 里「老用户也该跟着变」的项就 +1。
 * 迁移只在首次 load 时跑一次并落盘，之后用户在设置里的选择不会再被覆盖。
 * **每一条迁移都要认自己的版本号**：这一整块以前不分版本地重跑 `cache.provider = 默认`，
 * 于是「为背景升一次版」会把用户挑过的数据源一起打回默认（2026-10-04 加 v3 时发现并改掉）。
 * 现在 v2 那一刀只对没做过它的人跑，v3 那一刀只管清背景。 */
const DEF_VER = 3;

let cache = null;
export function loadConfig() {
  if (cache) return cache;
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { stored = null; }
  cache = stored
    ? Object.assign({}, clone(DEFAULT_CFG), stored, {
        custom: Object.assign({}, DEFAULT_CFG.custom, stored.custom || {}),
        units: Object.assign({}, DEFAULT_CFG.units, stored.units || {})
      })
    : clone(DEFAULT_CFG);
  // 旧配置只有 dark 布尔。判空必须判 stored 本身 —— 合并结果里 DEFAULT_CFG 已经把
  // theme 填成 'light'，再判 cache.theme 就永远不为空，深色用户会被静默重置成浅色
  if (stored && !stored.theme) cache.theme = stored.dark ? 'dark' : 'light';
  /* 存过的主题 id 已经不在清单里（收敛过、或者手改过）→ 换到同侧的默认套。
   * 这一步**不按 defVer 挡**：它只动「查无此 id」的值，用户挑过且还在的那套一律原样留下，
   * 所以没有 v3 那一刀「顺手把数据源打回默认」的毛病，幂等、每次跑也不怕。
   * 留着一个不存在的 id 才是 bug：<select> 里没有这一项，填进去再读出来是空串。
   *
   * 判据必须同时认内置与插件两套：refreshPluginIndex 是同步读 localStorage，
   * 它得排在 认识() 之前 —— 晚一步，用户导入的主题就会在这行被抹成默认，而且抹得无声无息
   * （屏幕上只是「主题怎么自己跳回去了」，日志里什么都没有）。 */
  refreshPluginIndex();
  const 认识 = themeKnown;
  for (const k of ['theme', 'darkTheme', 'lightTheme']) {
    const v = cache[k];
    if (v && !认识(v)) cache[k] = k === 'theme' ? defaultOf(已删主题[v] || 'light') : null;
  }
  const 老版 = stored ? (stored.defVer || 1) : 0;
  if (老版 < DEF_VER) {
    if (老版 < 2) cache.provider = DEFAULT_CFG.provider;
    if (老版 < 3) {
      delete cache.bg;                                  // 配置里那一格整个作废
      try { localStorage.removeItem('weather-bg-photo'); } catch (e) { /* 清不掉也只能这样 */ }
    }
    cache.defVer = DEF_VER;
    saveConfig(cache);
  }
  return cache;
}

export function saveConfig(c) {
  cache = c;
  try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch (e) { /* 隐私模式写不进去，本次会话内仍可用 */ }
}

/* ---------- 单位（基准：温度 °C、风速 km/h，与 Open-Meteo 默认一致） ---------- */
function unitPref() { return loadConfig().units || DEFAULT_CFG.units; }
export function uTemp(v) { const u = unitPref().temp; return (u === 'F' && v != null) ? v * 9 / 5 + 32 : v; }
function uWind(v) { const u = unitPref().wind; return (u === 'ms' && v != null) ? v / 3.6 : v; }
export function fmtTemp(v) {
  if (v == null || isNaN(v)) return '--';
  return Math.round(uTemp(v)) + '°' + (unitPref().temp === 'F' ? 'F' : '');
}
export function fmtWind(v) {
  if (v == null || isNaN(v)) return '--';
  return unitPref().wind === 'ms' ? uWind(v).toFixed(1) + ' m/s' : Math.round(uWind(v)) + ' km/h';
}
/* 风：有数字就按单位偏好换算；只给「西南风2级」这种文本的源（墨迹）原样搬过来。
 * 替他算一个 km/h 出来就是编数据 —— 2 级是 1.6~3.3 m/s 一个区间，不是一个值。 */
export function windLabel(c) {
  if (c && c.wind != null) return fmtWind(c.wind);
  return String((c && c.windText) || '').trim() || '--';
}
