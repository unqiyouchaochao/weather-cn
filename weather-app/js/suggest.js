/* 搜索框的候选列表（联想）：防抖、在途请求取消、键盘高亮、收藏兜底。
 * 归属判据：**只有它知道「候选列表现在是什么状态」**（sugTimer / sugItems / sugIdx / sugSeq / sugCtrl）。
 * 这些状态要是散在入口文件里，任何一个"顺手清一下列表"的调用都要伸手进来改私有变量。
 * 选中一条之后怎么走由 query.js 决定，这里只负责把坐标或城市名交出去。 */
import { el } from './lib/dom.js';
import { esc } from './lib/util.js';
import { loadConfig } from './lib/config.js';
import { loadFav, decodeKey } from './lib/favorites.js';
import { searchCities } from './lib/geo.js';
import { query } from './query.js';
import { getProvider } from './providers/index.js';

// 候选走 searchCities（多变体 + 双数据源，已按行政等级排序）；
// 选中后按经纬度精确查，避免同名城市被静默取第一个
let sugTimer = null, sugItems = [], sugIdx = -1, sugSeq = 0, sugCtrl = null;

export function hideSuggest() {
  /* 必须顺手作废**在途的那一轮联想**：输入后马上回车，hideSuggest 先把列表收了、query 也跑完了，
   * 而 260ms 防抖 + 网络回来的 fetchSuggest 这时才 resolve —— 它只比 `seq !== sugSeq`，
   * 没人动过 sugSeq 就判定「结果还有效」，于是候选框在结果都画完之后又弹回来。
   * 防抖定时器同理：不清掉就等于给同一轮输入留了一次重新弹出的机会。 */
  sugSeq++;
  if (sugCtrl) { sugCtrl.abort(); sugCtrl = null; }
  if (sugTimer) { clearTimeout(sugTimer); sugTimer = null; }   // 作废在途联想 + 清防抖，见函数头注释
  el.suggest.hidden = true;
  el.suggest.innerHTML = '';
  sugItems = [];
  sugIdx = -1;
}
function markSug() {
  Array.prototype.forEach.call(el.suggest.children, (n, i) => n.classList.toggle('on', i === sugIdx));
}
function showSuggest(list) {
  // byName 项（只按名字收藏、没带坐标的旧键）允许 lat 为空，选中时按名字查
  sugItems = (list || []).filter(x => x && x.name && (x.lat != null || x.byName)).map(x => ({
    name: x.name, admin: x.admin || '', country: x.country || '', lat: x.lat, lon: x.lon, src: x.src, byName: !!x.byName
  }));
  if (!sugItems.length) { hideSuggest(); return; }
  sugIdx = -1;
  el.suggest.innerHTML = sugItems.map((s, i) =>
    '<div class="sg" data-i="' + i + '" role="option">' +
    '<span class="sg-name">' + esc(s.name) + '</span>' +
    (s.src === 'photon' ? '<span class="sg-osm" title="Open-Meteo 库中未收录，来自 OpenStreetMap">OSM</span>' : '') +
    '<span class="sg-sub">' + esc([s.admin, s.country].filter(Boolean).join(' · ')) + '</span>' +
    '</div>').join('');
  el.suggest.hidden = false;
}
async function fetchSuggest(q) {
  if (sugCtrl) sugCtrl.abort();            // 掐掉上一轮在途请求，避免连打时放大成几十个外部调用
  sugCtrl = new AbortController();
  const seq = ++sugSeq;
  try {
    const list = await searchCities(q, sugCtrl.signal);
    if (seq !== sugSeq || sugCtrl.signal.aborted) return;   // 期间用户又输入了，丢弃过期结果
    showSuggest(list.slice(0, 8));
  } catch (e) { /* 取消、断网、超时都不打断输入 */ }
}
export function onInput() {
  const q = el.cityInput.value.trim();
  if (sugTimer) clearTimeout(sugTimer);
  if (!q) { showSuggest(favSuggest()); return; }                                  // 清空了就给收藏，别弹一片空白
  if (/^[\s\d.,\-]+$/.test(q)) { hideSuggest(); return; }                         // 纯坐标输入不联想
  sugTimer = setTimeout(() => fetchSuggest(q), 260);
}
// 空输入时的兜底候选：收藏城市（本地数据，不打任何外部接口）
function favSuggest() {
  return loadFav().map(k => {
    const d = decodeKey(k);
    return { name: d.name || k, admin: '收藏', country: '', lat: d.lat, lon: d.lon, byName: d.lat == null };
  });
}
// 点一下搜索框就弹候选：有文字立刻联想（不等防抖），空着就列收藏
export function openSuggest() {
  const q = el.cityInput.value.trim();
  if (sugTimer) clearTimeout(sugTimer);
  if (!q) { showSuggest(favSuggest()); return; }
  if (/^[\s\d.,\-]+$/.test(q)) { hideSuggest(); return; }
  fetchSuggest(q);
}
/* blur 比 click 早到，延时隐藏必须先看焦点是否已回到输入框，否则会把刚弹出的列表又关掉 */
export function onBlur() {
  setTimeout(() => {
    if (document.activeElement !== el.cityInput) hideSuggest();
  }, 120);
}
export function onPick(e) {
  const it = e.target.closest('.sg');
  if (!it) return;
  e.preventDefault();                 // 必须早于 blur 触发，否则候选列表已被清空
  pickSuggest(+it.dataset.i);
}
export function onKeydown(e) {
  const open = !el.suggest.hidden && sugItems.length > 0;
  if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    const n = sugItems.length;
    sugIdx = (sugIdx + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    markSug();
    return;
  }
  if (e.key === 'Escape') { hideSuggest(); return; }
  if (e.key === 'Enter') {
    if (open && sugIdx >= 0) { e.preventDefault(); pickSuggest(sugIdx); return; }
    hideSuggest();
    query({ city: el.cityInput.value });
  }
}
function pickSuggest(i) {
  const s = sugItems[i];
  if (!s) return;
  hideSuggest();
  el.cityInput.value = s.name;
  if (getProvider(loadConfig()).cap.byCityName) { query({ city: s.name }); return; }
  if (s.lat == null) { query({ city: s.name }); return; }   // 只有名字的收藏键
  query({ lat: s.lat, lon: s.lon, name: s.name, label: [s.name, s.admin || s.country].filter(Boolean).join(' · ') });
}
