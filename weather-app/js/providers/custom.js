/* 「自定义 API」提供者：URL 模板 + 声明式 JSON 字段映射，接入任意天气接口。
 * 本模块（以及整个应用）不执行任何用户可书写的代码 —— 映射只能是 JSON，见 mapping.js。 */
import { normalizeWith, geoWith, parseMap } from './mapping.js';

function fill(tpl, ctx) {
  return (tpl || '')
    .replaceAll('{city}', encodeURIComponent(ctx.city || ''))
    .replaceAll('{lat}', ctx.lat != null ? ctx.lat : '')
    .replaceAll('{lon}', ctx.lon != null ? ctx.lon : '')
    .replaceAll('{key}', encodeURIComponent(ctx.key || ''));
}

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status + '（' + url.split('?')[0] + '）');
  return await r.json();
}

export function buildCustomProvider(cfg) {
  const spec = parseMap(cfg.map);
  if (!spec.current) throw new Error('映射 JSON 需包含 "current" 字段');
  const ctx = (city, lat, lon) => ({ city, lat, lon, key: cfg.key });

  return {
    id: 'custom',
    label: '自定义 API',
    needsKey: !!cfg.needsKey,
    cap: {
      byCityName: !(cfg.geoUrl && spec.geo),
      air: false,
      hourly: !!(cfg.hourUrl && spec.hourly),
      daily: !!(cfg.dayUrl && spec.daily)
    },

    async geocode(city) {
      if (!cfg.geoUrl || !spec.geo) return null;
      return geoWith(await getJson(fill(cfg.geoUrl, ctx(city, null, null))), spec);
    },

    async weather(lat, lon, city) {
      const c = ctx(city, lat, lon);
      const part = async url => normalizeWith(await getJson(fill(url, c)), spec);
      const data = await part(cfg.curUrl);
      if (cfg.dayUrl && spec.daily) data.daily = (await part(cfg.dayUrl)).daily;
      if (cfg.hourUrl && spec.hourly) data.hourlyByDay = (await part(cfg.hourUrl)).hourlyByDay;
      return data;
    },

    normalize(raw) { return raw; }
  };
}
