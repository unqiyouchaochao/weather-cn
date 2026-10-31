/* 新闻板块视图：顶部一排频道（中国 / 国际 / 政策），下面一条列表。
 * 只画列表，取数与解析全在 lib/news.js；板块内部的事不往 main.js 里堆（跟 fortune.js 一个路子）。 */
import { el } from '../lib/dom.js';
import { esc } from '../lib/util.js';
import { isNative } from '../lib/locate.js';
import { CHANNELS, getChannel, peek } from '../lib/news.js';

let active = 'china';
/* 屏上那一份列表是谁画的：频道 + 取数层给的那个数组。数组换了对象就等于内容换过，
 * 所以这一个键不需要再带时间戳（新鲜度只有 lib/news.js 的 TTL 一个判据）。 */
let 画着 = null;
/* 用世代号而不是「正在加载」布尔量：布尔量会让连点两个频道时后一次直接 return，
 * 结果是频道高亮已经换人了、列表还是上一个的（实测出现过 政策 亮着、列表却是中国的）。
 * 号号不相等就说明这份结果迟到了，丢掉不画。 */
let seq = 0;

function chipHtml(c) {
  return '<button class="chip-btn' + (c.id === active ? ' on' : '') + '" type="button" data-ch="' +
    c.id + '" aria-selected="' + (c.id === active) + '">' + esc(c.label) + '</button>';
}

function drawChips() { el.newsChips.innerHTML = CHANNELS.map(chipHtml).join(''); }

function note(msg, kind) {
  el.newsNote.hidden = !msg;
  el.newsNote.textContent = msg || '';
  el.newsNote.className = 'news-note' + (kind ? ' ' + kind : '');
}

function itemHtml(x) {
  const meta = [x.org, x.time].filter(Boolean).join(' · ');
  return '<li class="news-item"><a href="' + esc(x.url) + '" target="_blank" rel="noopener">' +
    '<span class="news-title">' + esc(x.title) + '</span>' +
    (meta ? '<span class="news-meta">' + esc(meta) + '</span>' : '') + '</a></li>';
}

function show(items, src) {
  el.newsList.innerHTML = items.map(itemHtml).join('');
  el.newsSrc.textContent = '来源：' + src + ' · 共 ' + items.length + ' 条 · 点条目在浏览器中打开原文';
  el.newsSrc.hidden = false;
}

/** 进板块或切频道时调用。force=true 是用户主动按刷新。 */
export function render(force) {
  /* 反复进板块不该把列表擦一遍再建一遍：条目没变（取数层给的还是同一个数组）就把 30 个 <li>
   * 重新 innerHTML 一次，是白干的一笔布局 —— 频繁切板块时卡顿就有这一份。
   * 只认「同一个数组」这一个判据，不另算时间：新鲜度归 lib/news.js 的 TTL 管，那边过期换了数组，
   * 这里自然就不认了。按「刷新」(force)、换频道、上一回根本没画成都走原来的重取重画。 */
  if (!force) {
    const 缓存 = peek(active);
    if (缓存 && 画着 && 画着.ch === active && 画着.items === 缓存.items) return;
  }
  const my = ++seq;
  drawChips();
  const ch = CHANNELS.filter(c => c.id === active)[0] || {};
  note('正在加载' + (ch.label || '') + '…');
  el.newsList.innerHTML = '';
  el.newsSrc.hidden = true;
  画着 = null;                                   // 这一趟没画成之前，屏上那份已经不算数了
  getChannel(active, force).then(r => {
    if (my !== seq) return;                                  // 期间已经切走了，这份迟到结果不画
    if (!r.items.length) { note('这个源此刻没有条目，过几分钟再刷新。', 'warn'); return; }
    show(r.items, r.src);
    画着 = { ch: active, items: r.items };
    note('');
  }).catch(e => {
    if (my !== seq) return;
    // 政策那一路的源没有跨域许可：在浏览器里拿不到是必然的，直接把原因说清楚，
    // 并给出可点开的官网入口，而不是留一片空白让人以为程序坏了。
    if (e && e.needsNative) {
      note('「政策」的源（中国政府网）不允许跨域读取，只有在手机 App 里才打得开。' +
        (isNative() ? '' : '手机上用本应用的 App 版本即可，或直接在浏览器打开 gov.cn/zhengce。'), 'warn');
    } else {
      note('没取到：' + ((e && e.message) || e) + '。这个源可能临时抽风，稍后再刷新。', 'err');
    }
  });
}

export function init() {
  el.newsChips.addEventListener('click', e => {
    const b = e.target.closest('[data-ch]');
    if (!b || b.dataset.ch === active) return;
    active = b.dataset.ch;
    render(false);
  });
  el.newsRefresh.addEventListener('click', () => render(true));
}
