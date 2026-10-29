/* 数据源注册表 —— 全应用唯一的「插拔口」。换和风 / 高德 / 自建后端代理，都是在这里加一项，
 * 其余模块只认下面的接口约定，不认具体厂商。
 *
 * provider 接口：
 *   { id, label, needsKey,
 *     cap: { byCityName, air, hourly, daily, background },   // 界面按能力显隐，不再到处 typeof 探测
 *     geocode?(city) -> { lat, lon, name }      // 只认地名的源也要能「城市名 → 坐标」，检索走 lib/geo.js
 *     airLabel?: '国控站实测 · 国标',             // AQI 卡的出处与口径；缺省回落到 providerLabel
 *                                               //   注意 cap.air 只代表「可能有」，取不到值时 ui 仍会回落
 *     geocode?(city) -> { lat, lon, name, admin, country } | null,
 *     weather(lat, lon, city, key) -> raw,
 *     airQuality?(lat, lon) -> raw,
 *     normalize(raw) -> 标准对象 }
 *
 * 标准对象：
 *   current: { temp, feels, humidity, wind, desc, icon, code, pressure?, uv?, name?, time? }
 *   hourlyByDay: { 'YYYY-MM-DD': [ { time, temp, precipProb?, precip?, desc, icon, code, isDay } ] }
 *              「今日天气」取今天那一格（00–23 时），逐日卡「点某天看当天」也走这一份。
 *              current.time 写的是**该地**的此刻（不是浏览器时钟），用来判哪几格已经过去；
 *              源没给就不标「已过」，宁可不标也不能拿别处的时间冒充这里的时间。
 *   daily:   [ { date, tmax, tmin, desc, icon, code, sunrise?, sunset?, precipProb?, precip? } ]
 *   alert?:  { id, name, levelName, levelId, color, rank, title, text, guide, issuedAt, adcode, src? } | null
 *              气象灾害预警，形如 null 表示该地此刻没有在发预警（界面整块收起）。
 *              「中国天气」在实况报文里给（见 lib/alerts.js 的 fromWarn）。
 *              `src` 写的是**发这条信号的家的名字**，界面那行出处直接用它 —— 缺了就退回当前源的标签。
 *              别的源不填即可 —— 缺字段就等于没有这一栏，不需要额外的能力开关。
 */
import { openMeteo } from './openMeteo.js';
import { chinaWeather } from './chinaWeather.js';
import { wttrIn } from './wttrIn.js';
import { buildCustomProvider } from './custom.js';

const REGISTRY = {
  [openMeteo.id]: openMeteo,
  [chinaWeather.id]: chinaWeather,
  [wttrIn.id]: wttrIn
};

export function getProvider(cfg) {
  if (cfg.provider === 'custom') return buildCustomProvider(cfg.custom || {});
  return REGISTRY[cfg.provider] || REGISTRY['open-meteo'];
}

export function providerLabel(id) {
  if (id === 'custom') return '自定义 API';
  return (REGISTRY[id] && REGISTRY[id].label) || id;
}

// 设置面板用：密钥框显隐与说明文字都问注册表，别再硬编码「id === 'open-meteo'」
// （以前就是那句让选「中国天气」时也冒出 API Key 框，看着像要填东西）
export function providerNeedsKey(id) {
  if (id === 'custom') return true;
  return !!(REGISTRY[id] && REGISTRY[id].needsKey);
}
export function providerNote(id) {
  if (id === 'custom') return '要自己填接口地址与字段映射（URL 里的 {city} {lat} {lon} {key} 会被替换）。不执行任何代码。';
  return (REGISTRY[id] && REGISTRY[id].note) || '';
}
/* 这个源能不能喂「划掉应用之后还在跑的那一路」（通知栏每小时自取、预警每 10 分钟自查）。
 * 判据不是「它有没有数据」，是**它给不给得出 JSON 配方**：原生那边按「URL + 字段路径」取值，
 * 而只给 HTML 页面的源拼不出「此刻」。
 * 所以只有「中国天气」为 true。真正的账还是以 data.recipe 为准（见 lib/notify.js 的 recipeNow），
 * 这一位只用来把设置里那两行说明写对 —— 别让用户勾了半天、其实后台根本没在跑。 */
export function providerBackground(id) {
  return !!(REGISTRY[id] && REGISTRY[id].cap && REGISTRY[id].cap.background);
}
/* 这个源给不给得出气象预警（设置里那行说明用）。判据同 cap.background：
 * 渲染那一路本来就不需要开关 —— 报文里没有 alert 就等于这一栏收起；
 * 但「换源之后还有没有预警可核对」这一句必须写对，不能让用户对着一个空栏猜。 */
export function providerGivesAlerts(id) {
  return !!(REGISTRY[id] && REGISTRY[id].cap && REGISTRY[id].cap.alert);
}
