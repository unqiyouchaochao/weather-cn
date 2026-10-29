/* 天气预警（气象灾害预警信号）。
 *
 * 数据来自「中国天气」源那一发 /rest/weather 报文里的 data.real.warn —— 见 providers/chinaWeather.js。
 * 选它而不是另开一个预警接口，是量出来的：
 *   - 零额外请求、零额外字节。这一发本来每次刷新天气就要打，预警跟着报文一起更新，
 *     提醒延迟等于用户自己设的刷新间隔（30/60/300 秒），比任何独立轮询都及时。
 *   - 匹配是**站级精确**的：报的是哪个站，就是哪个站的预警，不存在就近挑一个隔壁县的问题。
 * 代价：一个站只给最新一条（同时挂两个信号时看到的是最新发布的那个）。
 *
 * 另一条路实测过、但没采用，记在这里免得下一个人重走：
 *   GET https://weather.cma.cn/api/map/alarm?adcode=   —— 免密钥、ACAO:*，一发 197 条全国在发预警，
 *   每条带经纬度与 6 位区县代码（id 前 6 位），按坐标就近可匹配。问题是：
 *     ① 116KB 且服务端不给 gzip、不给任何缓存头，按分钟级轮询在手机流量上不可接受；
 *     ② 实测并发两发会一起挂住（先后发都 200）；
 *     ③ 该域有两道 WAF：UA（curl 默认 UA → 403，任何 Mozilla/5.0 → 200）与 **Referer**
 *        —— 只要带了非 cma.cn 的 Referer 就 403，而 403 响应里没有 ACAO，浏览器会把它报成
 *        CORS 错误，看着像跨域问题、实际是 WAF。原生壳与本地调试页默认都会带 Referer，
 *        必须显式 referrerPolicy:'no-referrer' 才通。
 *   要做「同一地多条预警 / 附近预警」时从那儿取，但请只在用户点了后取，别挂在自动刷新上。
 *
 * 缺测哨兵：没有预警时该源把 warn 的每个字段写成 "9999"（issuetime 是空串），与报文里
 * 气压/降水的 9999 同一套约定，见 chinaWeather.js 的 txt()。
 */

/* 级别：rank 越大越严重（排序 + 「只提醒 X 级以上」）。键用裸颜色字，源写的「黄色」先剥掉尾字。
 * color 只用于圆点与色条这类**图形件**（WCAG 非文本 3:1），绝不拿去当文字色 ——
 * 四个值当初是对着 9 套主题的 --card 逐一量的（当时最差 3.16：红压在深海的 #0d2f3d 上）；
 * 2026-10-06 主题收到两套，这两块卡重量一遍仍然全部 ≥3：压夜航 #121212 是 4.23/5.36/7.12/6.04，
 * 压薄荷蓝 #ffffff 最低 **3.13**（黄）。但换算成文字对比度没有一个够 4.5（最高的红对纯白也才 4.45），
 * 所以正文一律 --ink。 */
const LEVEL = {
  红: { id: 'red', name: '红色', rank: 4, color: '#d4453c' },
  橙: { id: 'orange', name: '橙色', rank: 3, color: '#e65100' },
  黄: { id: 'yellow', name: '黄色', rank: 2, color: '#a8862c' },
  蓝: { id: 'blue', name: '蓝色', rank: 1, color: '#2b7fd4' }
};
export const LEVELS = [
  { id: 'any', label: '全部预警', rank: 0 },
  { id: 'yellow', label: '黄色及以上', rank: 2 },
  { id: 'orange', label: '橙色及以上', rank: 3 },
  { id: 'red', label: '仅红色', rank: 4 }
];

const NONE = v => {
  const t = String(v == null ? '' : v).trim();
  return !t || t === '9999' || t === '9999.0' || t === '-' ? '' : t;
};

/* pic 形如 https://image.nmc.cn/assets/img/alarm/p0012003.png，末三位是级别码
 * （001红 002橙 003黄 004蓝）—— signallevel 正常时用它自己的值，这一路只兜 signallevel 缺失的情况。 */
const PIC = { '001': LEVEL.红, '002': LEVEL.橙, '003': LEVEL.黄, '004': LEVEL.蓝 };

/** 把实况报文里的 data.real.warn 归一成界面用的形状；该站此刻没有预警就返回 null。
 *  station：站点名（如「黄平县」），报文里 warn 只给到省市，不补就看不出是县里发的。 */
export function fromWarn(w, station) {
  if (!w) return null;
  const type = NONE(w.signaltype);
  const level = NONE(w.signallevel);
  const text = NONE(w.issuecontent) || NONE(w.alert);
  if (!type && !text) return null;                    // 全空（含 "9999" 哨兵）= 没有预警
  const picM = /p\d{4}(00[1-4])\b/.exec(String(w.pic || ''));
  const lv = LEVEL[String(level).replace(/色$/, '')] || (picM ? PIC[picM[1]] : null);
  // url 形如 /publish/alarm/52262241600000_20260922134142.html：前 6 位是区县代码，
  // 下划线后是发布时刻。issuetime 字段实测是空串，时间只能从这里取。
  const um = /\/alarm\/(\d{6})\d*_(\d{14})/.exec(String(w.url || ''));
  const where = [NONE(w.province), NONE(w.city)].filter(Boolean);
  const st = NONE(station);
  if (st && where.indexOf(st) < 0) where.push(st);
  return {
    id: um ? um[0] : (type + '|' + level + '|' + (text || '').slice(0, 24)),
    adcode: um ? um[1] : '',
    name: type,
    levelName: level,
    levelId: lv ? lv.id : 'unknown',
    color: lv ? lv.color : '#8a8a8a',
    rank: lv ? lv.rank : 0,
    title: where.join(' ') + (type || level ? ' ' + (type + level) + '预警' : ''),
    text: text,
    guide: NONE(w.fmeans),
    issuedAt: um ? fmtStamp(um[2]) : '',
    // 预警卡顶上那行出处（见 ui.renderAlerts）。这一路确实是中央气象台那张网发的，
    // 别的源给预警时写自己的名字，界面上不许统一挂成「中央气象台」。
    src: '中央气象台 · 中国天气'
  };
}

/* 20260922134142 → 09-22 13:41 */
function fmtStamp(s) {
  const v = String(s || '');
  return v.length >= 12 ? v.slice(4, 6) + '-' + v.slice(6, 8) + ' ' + v.slice(8, 10) + ':' + v.slice(10, 12) : '';
}

/** 界面统一入口：标准对象里有 alert 就给一条，没有就给空数组（同一套渲染代码两用） */
export function listFrom(data) {
  const a = data && data.alert;
  return a ? [a] : [];
}

/* ---------- 去重：同一条预警只在「首次见到」或「升级」时提醒 ---------- */
const SEEN_LS = 'weather-alert-seen';

function readSeen() {
  try { const d = JSON.parse(localStorage.getItem(SEEN_LS)); return (d && typeof d === 'object') ? d : {}; }
  catch (e) { return {}; }
}

/** 返回这一轮该提醒的几条 + 读到的旧状态。
 *  seen 要等调用方确认通知真的发出去了再 commit（见 notify.js 的 pushAlerts），
 *  否则第一次因为没给通知权限而失败，之后就永远不再提醒了。 */
export function pickNew(list, minRank) {
  const seen = readSeen();
  const fresh = (list || []).filter(a => {
    const prev = seen[a.id];
    return a.rank >= (minRank || 0) && (!prev || prev.rank < a.rank);
  });
  return { fresh: fresh, seen: seen };
}

export function commitSeen(seen, list) {
  const next = Object.assign({}, seen);
  // 只留 7 天：预警条文是「区县码+时刻」，一条一条累积下去会把 localStorage 撑大
  const cut = Date.now() - 7 * 86400000;
  for (const k in next) { if (!next[k] || (next[k].at || 0) < cut) delete next[k]; }
  (list || []).forEach(a => { next[a.id] = { rank: a.rank, at: Date.now() }; });
  try { localStorage.setItem(SEEN_LS, JSON.stringify(next)); } catch (e) { /* 写不进去下次会重提一次，可接受 */ }
}
