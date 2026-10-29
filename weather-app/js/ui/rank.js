/* 全国城市空气质量排名：点空气质量卡进来的全屏视图。
 *
 * 数据就是 AQI 兜底那一级用的同一份榜单（lib/hwAqi.js 的缓存），所以点开通常零请求。
 * 只到地级市 —— 列表里 360 行全是「市」，没有县，这一点在页头上明写出来，
 * 免得有人在自己县的名下找不到自己、以为数据漏了。
 *
 * 排序默认「最优在前」（榜单本身就是这个序）。切成「最差在前」只是把同一个序倒过来，
 * 名次数字**跟着倒过来重编**还是保持原名次？保持原名次 —— 第 328 名就是第 328 名，
 * 倒序看只是翻列表的方向，改数字会让人以为空气突然变差了。 */
import { el } from '../lib/dom.js';
import { closeSheet, openSheet } from '../lib/sheet.js';
import { esc } from '../lib/util.js';
import { loadConfig } from '../lib/config.js';
import { aqiLevel } from '../lib/weather.js';
import { inkFor } from '../lib/glass.js';
import * as hwAqi from '../lib/hwAqi.js';

/* 页头那一行是**现推的**，不写在 markup 里：榜只有国标口径（源给的就是国标数），
 * 而「空气质量口径」那一档可以选美标 —— 写死一句「口径为国标」会让人以为整应用在说国标，
 * 选了美标之后更明显。两句都要短：长声明留 README，界面上只留一行。 */
export function noteText(std) {
  const 底 = '榜内只有 360 个地级市，不含县。';
  return std === 'us'
    ? 底 + '这一榜只有国标 —— 上面选的美标换不过来（源没给污染物浓度）。'
    : 底 + '这一榜只有国标（源给的就是国标数）。';
}

let asc = true;          // true = 最优在前
let current = null;      // 当前展示的城市（用于置顶高亮）
let lastList = null;     // 这一次取到的榜单，切换排序时直接用它重画，不再发请求
let seq = 0;

export function init() {
  el.rankBack.addEventListener('click', close);
  el.rankSort.addEventListener('click', () => { asc = !asc; draw(lastList); });
}

export function open(cityName) {
  current = cityName || null;
  openSheet(el.rankView);          // 走 openSheet：退场动画可能还在途，见 lib/sheet.js；背景滚动锁也由它一起管
  // 归零要在 openSheet 之后：面板 hidden 时那子树没有盒子，写进去不生效（设置抽屉那条同样的坑）。
  // 下面那句 innerHTML 换骨架看着像会顺手夹住 scrollTop，其实夹不住 —— 榜单命中缓存时 .then 在
  // 同一帧的微任务里就把 360 行填回来了，布局发生时滚动高度没变过（2026-10-02 华为实测重开停在 4000）。
  el.rankScroll.scrollTop = 0;
  el.rankNote.textContent = noteText(loadConfig().aqiStd || 'auto');
  el.rankList.innerHTML = '<p class="rank-loading">正在加载榜单…</p>';
  el.rankSort.hidden = true;
  const my = ++seq;
  hwAqi.rankList().then(list => {
    if (my !== seq) return;
    if (!list.length) { el.rankList.innerHTML = '<p class="rank-loading">榜单暂时取不到，过一会儿再进来看看。</p>'; return; }
    el.rankSort.hidden = false;
    lastList = list;
    draw(list);
  }).catch(() => {
    if (my !== seq) return;
    el.rankList.innerHTML = '<p class="rank-loading">榜单加载失败（这个接口偶尔会拒访），稍后再试。</p>';
  });
}

export function close() {
  closeSheet(el.rankView);      // 背景锁由 sheet.js 在真正 hidden 之后解，这里不再自己删 dataset
}

export function isOpen() { return !el.rankView.hidden; }

function row(c, isMine) {
  const lv = aqiLevel(c.aqi);
  return '<li class="rank-row' + (isMine ? ' mine' : '') + '">' +
    '<span class="rank-no">' + c.order + '</span>' +
    '<span class="rank-city"><b>' + esc(c.city) + '</b><i>' + esc(c.prov) + '</i></span>' +
    '<span class="air-badge" style="background:' + lv.color + ';color:' + inkFor(lv.color) + '">' + esc(lv.label) + '</span>' +
    '<span class="rank-aqi">' + c.aqi + '</span>' +
  '</li>';
}

function draw(list) {
  if (!list || !list.length) return;
  const rows = list.slice().sort((a, b) => (asc ? a.order - b.order : b.order - a.order));
  el.rankSortTxt.textContent = asc ? '最优在前' : '最差在前';
  const mine = current ? list.filter(c => c.city === current)[0] : null;   // 置顶那条用原名次，不跟着倒序重编
  el.rankMine.innerHTML = mine
    ? row(mine, true)
    : (current ? '<li class="rank-row empty">' + esc(current) + ' 不在这份榜单里（榜内只有 360 个地级市，县与部分新设区划不列）</li>' : '');
  el.rankList.innerHTML = rows.map(c => row(c, false)).join('');
}
