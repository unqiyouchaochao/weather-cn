/* 主视图：把一批发回来的数据画到屏上（今日卡、详情网格、七日逐日卡、收藏星、标题），
 * 以及它的对偶 renderError。谁可以改我：改「一屏上有什么、按什么顺序画」的人；
 * 某一栏自己的画法（小时格 / 预警卡 / 空气卡）住在那一栏自己的文件里。 */
import { el } from '../lib/dom.js';
import { esc, hhmm, uvLabel } from '../lib/util.js';
import { svgIcon } from '../lib/icons.js';
import { fmtTemp, fmtWind } from '../lib/config.js';
import { dayLabel } from './charts.js';
import { providerLabel } from '../providers/index.js';
import { loadFav, isFav, keyLabel } from '../lib/favorites.js';
import { applyBg } from './theme.js';
import { showData, hadData, setVal, showError } from './home.js';
import { setSyncing, showStatus } from './status.js';
import { clearToday } from './hours.js';
import { renderAlerts } from './alerts.js';
import { adoptLocName } from './place.js';

/* ---------- 气象详情网格（缺字段的项自动不显示） ---------- */
function renderDetails(data) {
  const c = (data && data.current) || {};
  const d0 = (data && data.daily && data.daily[0]) || {};
  const rows = [
    ['体感', c.feels != null ? fmtTemp(c.feels) : null, 'temperature'],
    ['湿度', c.humidity != null ? c.humidity + '%' : null, 'water'],
    ['风力', c.wind != null ? fmtWind(c.wind) : null, 'wind'],
    ['气压', c.pressure != null ? Math.round(c.pressure) + ' hPa' : null, 'compass'],
    ['紫外线', uvLabel(c.uv), 'sun'],
    ['降水概率', d0.precipProb != null ? d0.precipProb + '%' : null, 'rain-02'],
    ['日出', d0.sunrise ? hhmm(d0.sunrise) : null, 'sun-02'],
    ['日落', d0.sunset ? hhmm(d0.sunset) : null, 'night']
  ];
  const items = rows.filter(r => r[1] != null && r[1] !== '');
  el.details.hidden = !items.length;
  el.details.innerHTML = items.map(r =>
    '<div class="dt"><span class="dt-ic">' + svgIcon(r[2]) + '</span>' +
    '<span class="dt-k">' + esc(r[0]) + '</span><span class="dt-v">' + esc(r[1]) + '</span></div>').join('');
}

/* 降水的三态，判据只在这一处：
 *   源给了量（>0）  → 「N mm」，--pop
 *   源明确给了 0    → 「0 mm」，--muted —— 真没下不能和有雨共用那副嗓子
 *   源没给这个字段  → 一行都不画。「没收到」不等于「没下」，所以不替它编一句「今天没雨」。
 *                    （9999 缺测哨兵在 providers/chinaWeather.js 的 num() 里就清成 null 了，
 *                     这一层只认 null；自定义源给的怪值由下面那个 isFinite 挡掉。）
 * 2026-09-26 删温度趋势大图时，随图的 precView 一起删掉，只剩 precip > 0 才出声，前两态被压成
 * 同一张脸；这一条把那个判据写回逐日卡。 */
function rainLine(v) {
  if (v == null || v === '' || !isFinite(Number(v))) return '';
  const mm = Number(v);
  return '<div class="d-mm' + (mm > 0 ? '' : ' none') + '">' +
    (mm > 0 && mm < 10 ? mm.toFixed(1) : Math.round(mm)) + ' mm</div>';
}

function dayCard(d) {
  return '<div class="day"' + (d.date ? ' data-date="' + esc(d.date) + '"' : '') + '>' +
    '<div class="d-name">' + dayLabel(d.date) + '</div>' +
    '<div class="d-ic">' + svgIcon(d.icon) + '</div>' +
    '<div class="d-t"><span class="d-hi">' + fmtTemp(d.tmax) + '</span> ' +
    '<span class="d-lo">' + fmtTemp(d.tmin) + '</span></div>' +
    (d.precipProb != null ? '<div class="d-pop">降水 ' + esc(d.precipProb) + '%</div>' : '') +
    rainLine(d.precip) +
    '</div>';
}

export function setStar(favKey) {
  const on = isFav(favKey);
  el.starBtn.classList.toggle('on', on);
  // 图形只有这一枚（pack 的五角星），实心/描边交给 CSS 的 .on ——
  // 换一套图标不必再配一对字符，读屏拿到的仍是按钮的 aria-label「收藏」。
  el.starBtn.innerHTML = '<span class="ic">' + svgIcon('five-pointed-star') + '</span>';
}

export function render(data, locName, providerId, favKey, silent) {
  const c = data.current || {};
  // silent = 同一目标原地刷新：这时值变了要轻微高亮一下，否则页面一动不动，看不出数据换过了。
  // 换城市不给（整页骨架屏已经是更强的信号，再到处闪反而更乱）。
  const bump = !!silent;
  el.locName.textContent = adoptLocName(locName);
  setVal(el.curDesc, c.desc || '—', bump);
  el.curIcon.innerHTML = svgIcon(c.icon || 'cloud');
  setVal(el.curTemp, fmtTemp(c.temp), bump);
  // 当日高/低取自 daily[0]（按该地时区的「今天」）；数据源没给预报时整行隐藏，不留空位
  const today = (data.daily || [])[0] || {};
  const hasRange = today.tmax != null || today.tmin != null;
  el.curRange.hidden = !hasRange;
  if (hasRange) {
    setVal(el.curHi, '最高 ' + fmtTemp(today.tmax), bump);
    setVal(el.curLo, '最低 ' + fmtTemp(today.tmin), bump);
  }
  el.curSource.textContent = providerLabel(providerId);
  el.curSource.title = '本卡气温、湿度、风与当日最高/最低均来自 ' + providerLabel(providerId) + '；最高/最低为当日预报值';
  setVal(el.curFeels, '体感 ' + fmtTemp(c.feels), bump);
  setVal(el.curHum, '湿度 ' + (c.humidity != null ? c.humidity : '--') + '%', bump);
  setVal(el.curWind, '风 ' + fmtWind(c.wind), bump);

  const days = (data.daily || []).slice(0, 7);
  renderDetails(data);
  el.forecast.innerHTML = days.length ? days.map(dayCard).join('') : '<p style="color:var(--muted)">该数据源未提供预报数据。</p>';

  applyBg(c.icon || 'cloud');
  renderAlerts(data, silent, providerId);
  setStar(favKey);
  el.providerTag.textContent = '数据源：' + providerLabel(providerId);
  setSyncing(false);
  showData();
  // 查完把搜索框里的字收回：留着既跟下方内容重复，也像是「没搜上」；
  // 当前显示的是哪儿，看标题与搜索框下面那行经纬度（setCoords）
  el.cityInput.value = '';
}

export function renderError(msg, retryFn) {
  setSyncing(false);
  el.airWrap.hidden = true;
  clearToday();              // 今天的小时属于刚才那座城，别让它留在报错条下面
  el.alertWrap.hidden = true;   // 查询失败时别把上一处的预警留在屏幕上（宁缺勿错）
  showError(msg, retryFn);   // 空状态卡的落点在 home.js（三态归它管），这里只说「要哪一态」
  // 屏上有旧数字时才需要状态行那句「查询失败」；一张都没查到时空状态卡自己会说话，
  // 这一格留给更该常驻的提示（比如「系统定位没开，去开启」）。
  if (hadData()) showStatus('查询失败：' + msg, true, retryFn);
}

/* ---------- 收藏栏 ---------- */
export function renderFav() {
  const arr = loadFav();
  el.favBar.innerHTML = arr.map(k =>
    '<span class="chip" data-key="' + esc(k) + '">' + esc(keyLabel(k)) +
    '<button class="x" data-key="' + esc(k) + '" title="移除">×</button></span>').join('');
  const enough = arr.length >= 2;
  el.compareBtn.hidden = !enough;
  el.compareHint.hidden = enough;
}
