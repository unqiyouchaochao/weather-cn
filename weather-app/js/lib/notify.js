/* 通知栏实时天气：内容按设置里勾的字段拼，只在手机壳里生效
 * （插件是 android/ 下的 WeatherNotifyPlugin，桌面浏览器拿不到就整块跳过）。
 *
 * 两条节奏分开走：应用在前面时每次刷新都同步一次（30 秒那一档见 main.js）；划掉之后由
 * 原生那份配方自己按小时更新（见下面的「后台存活」）。退出后停在最后一次内容也仍然成立 ——
 * 省电策略把闹钟掐掉时，通知文本里那个更新时间就是判断新旧的依据。 */
import { loadConfig, DEFAULT_CFG, fmtTemp, fmtWind } from './config.js';
import { pickNew, commitSeen } from './alerts.js';

/* id 必须与 cfg.notify.fields 的键一致；label 是设置里显示的文案 */
export const NOTIFY_FIELDS = [
  { id: 'temp', label: '温度' },
  { id: 'desc', label: '天气' },
  { id: 'range', label: '最高/最低' },
  { id: 'feels', label: '体感' },
  { id: 'humidity', label: '湿度' },
  { id: 'wind', label: '风' },
  { id: 'aqi', label: '空气质量' },
  { id: 'time', label: '更新时间' }
];

let last = null, air = null, lastOut = null;

function plugin() {
  return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.WeatherNotify) || null;
}
export function notifySupported() { return !!plugin(); }

/* 存进 localStorage 的 notify 可能被只改过一项的写入截断（config.js 只深合并 custom 与 units），
 * 所以字段默认值在这里兜 —— 默认表就是 DEFAULT_CFG.notify.fields 那一份，不再抄第二张 */
export function notifyPrefs(raw) {
  const n = raw || {};
  return { on: n.on !== false, fields: Object.assign({}, DEFAULT_CFG.notify.fields, n.fields || {}) };
}

function cfgOf() { return notifyPrefs(loadConfig().notify); }

function pad(n) { return String(n).padStart(2, '0'); }

/* 拼一行通知文本：城市当标题，其余按勾选顺序排，缺字段就跳过（数据源没给就不显示） */
function buildText(data, locName) {
  const f = cfgOf().fields;
  const c = (data && data.current) || {};
  const d0 = ((data && data.daily) || [])[0] || {};
  const parts = [];
  if (f.temp && c.temp != null) parts.push(fmtTemp(c.temp));
  if (f.desc && c.desc) parts.push(c.desc);
  if (f.range && (d0.tmax != null || d0.tmin != null)) parts.push(fmtTemp(d0.tmin) + '~' + fmtTemp(d0.tmax));
  if (f.feels && c.feels != null) parts.push('体感' + fmtTemp(c.feels));
  if (f.humidity && c.humidity != null) parts.push('湿度' + Math.round(c.humidity) + '%');
  if (f.wind && c.wind != null) parts.push(fmtWind(c.wind));
  if (f.aqi && air && air.aqi != null) parts.push('AQI' + Math.round(air.aqi) + (air.label ? ' ' + air.label : ''));
  if (f.time) { const t = new Date(); parts.push(pad(t.getHours()) + ':' + pad(t.getMinutes())); }
  return { title: locName || '天气', text: parts.join(' · ') || '暂无数据' };
}

function push() {
  const p = plugin();
  if (!p) return;
  const cfg = cfgOf();
  pushRecipe();
  if (!cfg.on || !last) { p.clear && p.clear().catch(() => {}); lastOut = null; return; }
  const t = buildText(last.data, last.locName);
  // 一轮刷新会催三次（天气渲染、AQI 后到、地名反查后到），内容没变就别再惊动原生
  const key = t.title + '||' + t.text;
  if (key === lastOut) return;
  lastOut = key;
  p.show({ title: t.title, text: t.text }).catch(() => { /* 没给通知权限：下次再试，别打扰 */ });
}

/* ---------- 后台存活 ----------
 * 把「往哪个 URL 要报文、通知每段从哪儿取、预警门槛几级」交给原生，划掉应用之后由
 * android/WeatherKeepAliveService 按这份配方自己跑。节奏全在服务端：预警开着 10 分钟一拍
 * （那一拍只查预警），常驻通知满一小时才重建一次 —— 与前台 30 秒一次的自动刷新是两条独立的路，
 * 前台那份在 main.js 的 setupAutoRefresh 里，这里不再管。
 *
 * 关掉常驻通知就退成「不打常驻那条」：服务不再以前台方式驻留（前台服务必须挂一条通知，
 * 用户既然不要通知，就不能拿这个理由占着），闹钟改由 WeatherTickReceiver 裸跑一拍，只用来看预警。
 *
 * 只有「中国天气」这一源给得出配方（实况与预警在同一发报文里）。换到别的源就下发 on:false 把服务停掉，
 * 而不是留一份指向旧站点的配方在后台跑 —— 那会一直提醒另一个地方的预警。 */
let sentRecipe = '';
function recipeNow() {
  const c = loadConfig();
  const n = notifyPrefs(c.notify);
  const a = c.alert || {};
  const alertOn = a.on !== false;
  const src = (last && last.data && last.data.recipe) || null;
  if (!src || (!n.on && !alertOn)) return { on: false };
  const units = c.units || {};
  const fields = [];
  NOTIFY_FIELDS.forEach(f => {
    if (!n.fields[f.id]) return;
    // AQI 那一路是另一次请求（城市榜/模型）时后台取不到，缺就整段不显示，别拿别处的数糊
    if (f.id === 'aqi' && !src.aqiLabel) return;
    fields.push(f.id);
  });
  return {
    on: true,
    live: !!n.on,
    url: src.url,
    title: (last && last.locName) || '',
    fields: fields,
    paths: src.paths,
    tempUnit: units.temp === 'F' ? 'F' : 'C',
    windUnit: units.wind === 'ms' ? 'm/s' : 'km/h',
    aqiLabel: src.aqiLabel,
    alertOn: alertOn,
    alertMinRank: a.min == null ? DEFAULT_CFG.alert.min : a.min,
    alertPaths: src.alertPaths
  };
}

function pushRecipe() {
  const p = plugin();
  if (!p || !p.keepAlive || !last) return;
  const r = recipeNow();
  const key = JSON.stringify(r);
  if (key === sentRecipe) return;      // 送达之后同一份不再重发；失败会在这下面把账作废
  sentRecipe = key;
  /* 「发过了」只能记在**送达**之后。以前是先记账再发、失败又被 catch 吞掉，于是同一份配方
   * 这一整个会话再不重发 —— 而原生那边还在按**上一座城**的配方每小时刷新正文，屏幕上已经是
   * 另一座城（2026-09-27 华为：界面郑州，通知停在「云浮市 · ××县…」，prefs 里 recipe.url
   * 一整天没动）。失败就把这次尝试作废，让下一轮刷新（30 秒自动刷新、换城市、回前台）补上。 */
  p.keepAlive({ recipe: r }).catch(() => { if (sentRecipe === key) sentRecipe = ''; });
}

/** 设置里改完开关/字段后立刻重发一次，不用等下一轮刷新 */
export function resync() { push(); }

/** 地名反查比天气晚到，到了把通知标题也换成同一个地名 */
export function setPlaceTitle(txt) {
  if (!last || !txt) return;
  last = { data: last.data, locName: txt };
  push();
}

/** 每次天气渲染完调一次 */
export function syncWeather(data, locName) {
  last = { data, locName };
  air = null;                       // AQI 是异步补的，新一轮先清掉上一城的数值
  push();
}

/** 空气质量晚于天气到达，到了再同步一次 */
export function setAir(aqi, label) {
  air = { aqi, label };
  push();
}

/* 只撤下通知，last/air 留着：设置里关掉再打开时 resync 能立刻复原，
 * 不用干等下一轮刷新（数据本身由 syncWeather 每轮覆盖，不会串城）。 */
export function clearWeather() {
  lastOut = null;                  // 通知撤了，下次同样内容也得重发，别被去重挡掉
  const p = plugin();
  if (p && p.clear) p.clear().catch(() => {});
}

/* ---------- 气象预警 ----------
 * 与上面那条常驻通知分开：不同的渠道、不同的 id、会响会横幅，且不常驻。
 * 只有壳里发得出去（网页版要通知得有 ServiceWorker，而原生壳里刻意不注册 SW —— 见 main.js），
 * 所以浏览器只在页面上显示预警，不弹通知。
 * 解除后不主动撤销已经发出去的那条：这条通知说的是「某个县发过这个信号」，
 * 换城市、换到别的地方的预警都不构成对它解除，撤错了反而更糟；让用户自己划掉。 */
export function alertSupported() {
  const p = plugin();
  return !!(p && p.alert);
}

/** 把这一轮该提醒的预警发出去，返回实际发了几条。
 *  seen 只在通知确实落地后才写盘 —— 第一次可能因为用户还没给通知权限而发不出去，
 *  那时候记下就等于「这辈子不再提醒这条」，是不可逆的错。
 *  rank 一并交给原生：真正的去重账本在那边（后台弹过的前台不该再弹一次），
 *  原生回 duplicate=true 说明「这条已经记过账了」，本地也跟着记一笔，免得每轮刷新重发一次。 */
export function pushAlerts(list, minRank) {
  const p = plugin();
  if (!p || !p.alert) return 0;
  const sel = pickNew(list, minRank);
  if (!sel.fresh.length) return 0;
  let shown = 0, pending = sel.fresh.length;
  const done = () => { if (--pending <= 0 && shown) commitSeen(sel.seen, sel.fresh); };
  sel.fresh.forEach(a => {
    p.alert({
      title: a.name + (a.levelName ? a.levelName + '预警' : '预警'),
      text: a.text || a.title || '',
      tag: a.id,
      rank: a.rank
    }).then(r => { if (r && (r.shown !== false || r.duplicate)) shown++; done(); })
      .catch(() => done());          // 没给权限：这轮不发，也不记账
  });
  return sel.fresh.length;
}
