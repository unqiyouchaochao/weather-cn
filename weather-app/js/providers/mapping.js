/* 声明式字段映射：把任意 JSON 响应翻译成标准对象，全程不执行任何用户提供的代码。
 *
 * 映射写成 JSON（设置面板里那一个大文本框），结构：
 *   {
 *     "codes": "wmo" | "owm" | { "0": { "desc": "晴", "icon": "sun" }, ... },
 *     "units": { "temp": "C" | "K", "wind": "kmh" | "ms" },   // 归一到应用基准 °C / km·h⁻¹
 *     "current": { temp, feels, humidity, wind, pressure, uv, code, desc, icon, name, time },
 *     "daily":   { list: "路径", fields: { date, tmax, tmin, code, desc, icon, sunrise, sunset, precipProb, precip } },
 *     "hourly":  { list: "路径", fields: { time, temp, precipProb, code, desc, icon, isDay } },
 *     "geo":     { list: "路径", fields: { lat, lon, name, admin, country } }
 *   }
 * 每个字段值写成 "a.b[0].c" 路径字符串，或 { path, mul, add, map, default }。
 *
 * 两种真实响应形状都要支持，所以字段解析有两条回退：
 *   ① 对象数组（OpenWeatherMap 的 list[]）→ 路径相对每个元素；
 *   ② 平行数组（Open-Meteo 的 daily.time / daily.temperature_2m_max 各一个数组）→
 *      相对解析取不到时改用根对象路径，取到数组就按行号 i 取元素。
 * 顺带两条无害的格式归一：daily.date 长于 10 字符时截 YYYY-MM-DD；hourly.time 里的空格换成 T。
 */
import { wmo, owmIcon, owmDesc, hourlyByDate } from '../lib/weather.js';

const KEYS = /[^.[\]]+/g;
export function pick(obj, path) {
  const keys = String(path).match(KEYS);
  if (!keys) return undefined;
  let v = obj;
  for (const k of keys) {
    if (v == null) return undefined;
    v = v[k];
  }
  return v;
}

function resolve(spec, item, root, i) {
  const s = typeof spec === 'string' ? { path: spec } : (spec || {});
  if (!s.path) return undefined;
  let v = (item && typeof item === 'object') ? pick(item, s.path) : undefined;
  if (v === undefined) v = pick(root, s.path);
  if (Array.isArray(v)) v = v[i];
  if (v === undefined || v === null || v === '') v = s.default;
  if (v === undefined) return undefined;
  if (s.map) {
    const m = s.map[String(v)];
    if (m === undefined) return undefined;
    v = m;
  }
  if (typeof v === 'string' && /^[-+]?\.?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v.trim())) v = Number(v.trim());
  if (typeof v !== 'number') return v;
  if (s.mul != null) v *= s.mul;
  if (s.add != null) v += s.add;
  // 消掉浮点噪声：0.4×100 会得到 40.00000000000001，直接标在小时条上很难看
  return s.mul != null || s.add != null ? Math.round(v * 100) / 100 : v;
}

// codes 决定「只有天气代码」时怎么补出中文描述与图标；也允许映射里直接给 desc/icon 覆盖
function codeTable(codes) {
  if (codes === 'owm') return c => ({ desc: owmDesc(c), icon: owmIcon(c) });
  if (codes && typeof codes === 'object') return c => codes[String(c)] || null;
  return c => { const w = wmo(c); return w.desc === '未知' ? null : w; };
}

function normalizeRow(v, units) {
  const kelvin = String(units.temp || '').toUpperCase() === 'K';
  const ms = String(units.wind || '').toLowerCase() === 'ms';
  if (kelvin) for (const k of ['temp', 'feels', 'tmax', 'tmin']) if (v[k] != null) v[k] -= 273.15;
  if (ms && v.wind != null) v.wind *= 3.6;
  return v;
}

function applyCodes(v, get) {
  if (!get) return v;
  if (v.code != null && v.code !== '') {
    const w = get(v.code);
    if (w) {
      if (v.desc == null || v.desc === '') v.desc = w.desc;
      if (v.icon == null || v.icon === '') v.icon = w.icon;
    }
  }
  if (!v.icon) v.icon = 'cloud';
  return v;
}
function mapFields(raw, spec, item, i) {
  const out = {};
  for (const k in spec) {
    const v = resolve(spec[k], item, raw, i);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function mapList(raw, block, units, get) {
  if (!block || !block.list || !block.fields) return [];
  let rows = pick(raw, block.list);
  if (rows == null) return [];
  if (!Array.isArray(rows)) rows = [rows];
  return rows.map((item, i) => {
    let v = mapFields(raw, block.fields, item, i);
    if (typeof v.date === 'string' && v.date.length > 10) v.date = v.date.slice(0, 10);
    if (typeof v.time === 'string') v.time = v.time.replace(' ', 'T');
    v = normalizeRow(v, units);
    return applyCodes(v, get);
  });
}

// cfg.map 可以是对象，也可以是设置面板存的 JSON 字符串
export function parseMap(spec) {
  if (!spec) throw new Error('自定义 API 需填写映射 JSON');
  if (typeof spec === 'object') return spec;
  try { return JSON.parse(spec); }
  catch (e) { throw new Error('映射 JSON 解析失败：' + (e && e.message ? e.message : e)); }
}

export function normalizeWith(raw, spec) {
  const get = codeTable(spec.codes || 'wmo');
  const units = spec.units || {};
  const current = applyCodes(normalizeRow(mapFields(raw, spec.current || {}, null, 0), units), get);
  const daily = mapList(raw, spec.daily, units, get).filter(d => d.date != null);
  const hourly = mapList(raw, spec.hourly, units, get).filter(h => h.time != null);
  return { current, hourlyByDay: hourlyByDate(hourly), daily };
}

export function geoWith(raw, spec) {
  const g = mapList(raw, spec.geo, {}, null)[0];
  if (!g || g.lat == null || g.lon == null) return null;
  return { lat: g.lat, lon: g.lon, name: g.name, admin: g.admin || '', country: g.country || '' };
}
