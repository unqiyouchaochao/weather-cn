/* 新闻板块的取数与解析（不碰 DOM）。
 *
 * 三条链的可达性不一样，这是设计的前提，不是实现细节：
 *   · 中新网 RSS —— 响应带 `Access-Control-Allow-Origin: *`，浏览器和手机壳里都能直取。
 *   · 中国政府网政策文件库 JSON —— **没有** CORS 头（实测只有 `Vary: Origin`），
 *     浏览器里必被 CORS 拦掉；只有手机壳里走 CapacitorHttp（原生 HTTP，不受同源策略约束）
 *     才拿得到。实测同一个 people.com.cn 的 RSS：fetch 抛 Failed to fetch，
 *     CapacitorHttp 回 200 / 188446 字。所以「政策」这一栏在桌面浏览器里必然显示不可用，
 *     这是事实而不是 bug，界面要把原因讲出来。
 *
 * 只用实测过的地址：roll.xml / gj.xml 这两个被文档站传来传去的「中新网频道」实际是 404，
 * people.com.cn 的 RSS 虽然能拉到但内容停在 2025-06-05，都不许用。
 */
import { isNative } from './locate.js';

export const CHANNELS = [
  {
    id: 'china', label: '中国', web: true,
    src: '中新网 · 时政', home: 'https://www.chinanews.com.cn/',
    feeds: [{ kind: 'rss', url: 'https://www.chinanews.com.cn/rss/china.xml' }]
  },
  {
    id: 'world', label: '国际', web: true,
    src: '中新网 · 国际', home: 'https://www.chinanews.com.cn/',
    feeds: [{ kind: 'rss', url: 'https://www.chinanews.com.cn/rss/world.xml' }]
  },
  {
    // 「国务院等国家机构」：国务院文件 + 部门文件两个桶合并，按发布日期倒序，条目标上发文机关
    id: 'policy', label: '政策', web: false,
    src: '中国政府网 · 政策文件库', home: 'https://www.gov.cn/zhengce/',
    feeds: [
      { kind: 'gov', url: 'https://sousuo.www.gov.cn/search-gov/data?t=zhengcelibrary_gw&q=&timetype=timeqb&sort=pubtime&sortType=1&page=1&pageSize=20', bucket: '国务院文件' },
      { kind: 'gov', url: 'https://sousuo.www.gov.cn/search-gov/data?t=zhengcelibrary_bm&q=&timetype=timeqb&sort=pubtime&sortType=1&page=1&pageSize=20', bucket: '部门文件' }
    ]
  }
];

const TTL = 5 * 60000;   // 中新网自己标 max-age=120，这里取更保守的 5 分钟，避免切板块就打一遍
const cache = {};        // { channelId: { at, items } }

function httpGet(url) {
  const H = isNative() && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
  if (H) {
    return H.get({ url, headers: { Accept: 'application/json, text/xml, */*' } }).then(r => {
      if (r.status >= 400) throw new Error('HTTP ' + r.status);
      return typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    });
  }
  return fetch(url).then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  });
}

function stripEm(s) { return String(s || '').replace(/<\/?em[^>]*>/g, '').trim(); }

/* RSS 的 pubDate 是 RFC-822（"Mon, 21 Sep 2026 20:01:17 +0800"），直接上屏既难读又跟
 * 政策那一路的 "2026.09.18" 对不齐；统一收成 MM-DD HH:mm，解析不动就原样留着。 */
function shortTime(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  if (/^\d{4}[.\-\/]\d{2}[.\-\/]\d{2}$/.test(t)) return t.slice(5).replace(/[.\-\/]/g, '-');
  const d = new Date(t);
  if (isNaN(d.getTime())) return t;
  const p = n => (n < 10 ? '0' : '') + n;
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/* 排序不能跟着显示串走：MM-DD 在跨年会把 12 月排到 1 月后面，RFC-822 更不能比字符串。
 * 所以另存一个数值时间戳只用来排序。 */
function stampOf(s) {
  const t = String(s || '').trim();
  if (!t) return 0;
  const d = new Date(/^\d{4}[.\-\/]\d{2}[.\-\/]\d{2}$/.test(t) ? t.replace(/[.\/]/g, '-') : t);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function parseRss(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('RSS 解析失败');
  const one = (it, tag) => {
    const n = it.getElementsByTagName(tag)[0];
    return n ? String(n.textContent).trim() : '';
  };
  return Array.prototype.slice.call(doc.getElementsByTagName('item')).map(it => {
    const raw = one(it, 'pubDate');
    return {
      title: one(it, 'title'), url: one(it, 'link'),
      time: shortTime(raw), ts: stampOf(raw), org: ''
    };
  }).filter(x => x.title && x.url);
}

function parseGov(json, bucket) {
  const d = JSON.parse(json);
  const list = (((d || {}).searchVO) || {}).listVO || [];
  return list.map(x => ({
    title: stripEm(x.title), url: x.url,
    time: shortTime(x.pubtimeStr), ts: stampOf(x.pubtimeStr), org: stripEm(x.puborg) || bucket
  })).filter(x => x.title && x.url);
}

/* 拉一个频道。多个 feed 时逐个试，只要有一个成就用「已拿到的那部分」，
 * 全失败才抛错 —— 政策两个桶里挂一个不该让整栏空白。 */
function loadChannel(ch) {
  const jobs = ch.feeds.map(f => httpGet(f.url).then(txt =>
    f.kind === 'rss' ? parseRss(txt) : parseGov(txt, f.bucket)
  ).catch(() => null));
  return Promise.all(jobs).then(parts => {
    const ok = parts.filter(Boolean);
    if (!ok.length) throw new Error('全部来源都没返回内容');
    const items = ok.reduce((a, b) => a.concat(b), []);
    items.sort((a, b) => b.ts - a.ts);
    return items;
  });
}

/** 只问缓存、一个请求都不发。给得出对象就说明这一份还在 TTL 里，
 *  视图层拿它比对「屏上画的是不是这批」，从此两边共用同一个新鲜度判据，不各算各的。 */
export function peek(id) {
  const hit = cache[id];
  return hit && Date.now() - hit.at < TTL ? hit : null;
}

/**
 * @returns {Promise<{items:Array, src:string, fromCache:boolean}>}
 * 失败时 reject，错误对象带 .needsNative 标记，供界面说明「这一栏只在手机 App 内可用」。
 */
export function getChannel(id, force) {
  const ch = CHANNELS.filter(c => c.id === id)[0];
  if (!ch) return Promise.reject(new Error('未知频道'));
  const hit = cache[id];
  if (hit && !force && Date.now() - hit.at < TTL) {
    return Promise.resolve({ items: hit.items, src: ch.src, fromCache: true });
  }
  if (!ch.web && !isNative()) {
    const e = new Error('这一栏的源没有跨域许可，只能在手机 App 里打开');
    e.needsNative = true;
    return Promise.reject(e);
  }
  return loadChannel(ch).then(items => {
    cache[id] = { at: Date.now(), items };
    return { items, src: ch.src, fromCache: false };
  });
}
