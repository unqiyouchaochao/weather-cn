/* 设置分组「行为与自动化」：启动时是否自动定位、自动刷新/轮播的间隔与开关。
 * 这一组只读写配置，计时器不归它 —— 落盘之后由注册表走 saveSettings 里那一次 setupAutoRefresh
 * （js/refresh.js），这样"改了间隔却没重建计时器"只可能发生在同一个地方。
 *
 * 2026-10-15 从四个预设（关闭/30 秒/60 秒/5 分钟）改成「自定义间隔 + 右侧开关」：
 * 数值与单位是两格，落盘合成一个秒数（cfg.autoRefresh），开关是另一格（cfg.autoRefreshOn）。
 * 为什么拆两格而不是让 0 继续兼任「关」：那样一关就把用户算好的 7 分钟冲掉了，下次开要重填。
 * 范围、单位阶梯与读法全在 lib/config.js（REFRESH_LIMITS / SPAN_UNITS / spanRange），
 * 这一组一个数字都不写死 —— 包括数值框的 min/max：那一格填的是「几个单位」，
 * 所以边界要按当前单位换算过再写，直接把秒尺套上去，选「分钟」时 1 分钟会被 DOM 判越界。 */
import { el } from '../lib/dom.js';
import { svgIcon } from '../lib/icons.js';
import { DEFAULT_CFG, REFRESH_LIMITS, SPAN_UNITS, SPAN_WORD,
  clampRefresh, splitSpan, humanSpan, spanRange } from '../lib/config.js';

/* 开关的真值住在这个模块变量里，aria-pressed 只是它投给 DOM 的一份影子：
 * 读回来的是字符串，判等要再转一次，而 fill 与 click 两条路都必须记得同一个状态。 */
let on = false;

function paintBounds() {
  const u = Number(el.autoRefreshUnit.value) || 1;
  el.autoRefreshNum.min = String(Math.ceil(REFRESH_LIMITS.min / u));
  el.autoRefreshNum.max = String(Math.floor(REFRESH_LIMITS.max / u));
}
function paintSwitch(next) {
  on = !!next;
  el.autoRefreshToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
  el.autoRefreshToggle.querySelector('.sw-ic').innerHTML = svgIcon(on ? 'toggle-on' : 'toggle-off', true);
  el.autoRefreshToggle.querySelector('.sw-tx').textContent = on ? '开启' : '关闭';
  /* 关着的时候两格输入禁用：这时候改数值不产生任何效果，留着能改就是骗人 */
  el.autoRefreshNum.disabled = !on;
  el.autoRefreshUnit.disabled = !on;
}
/* 把两格输入合成秒数，顺手判断有没有被夹过 —— 因为「我填了 5 小时，结果它按别的跑」
 * 是这一格最容易产生的误解。 */
function readSpan() {
  const u = parseInt(el.autoRefreshUnit.value, 10) || 1;
  const raw = Number(el.autoRefreshNum.value);
  if (!Number.isFinite(raw) || raw <= 0) {
    const fallback = clampRefresh(DEFAULT_CFG.autoRefresh);
    return { sec: fallback, note: '那一格不是个正数，先按 ' + humanSpan(fallback) + ' 记下了。' };
  }
  const want = Math.round(raw * u);
  const sec = clampRefresh(want);
  return sec === want ? { sec, note: null }
    : { sec, note: '只能落在 ' + spanRange() + ' 之间，刚才那个 ' + want + ' 秒已按 ' + humanSpan(sec) + ' 记下。' };
}
function showHint(note) {
  el.refreshHint.textContent = note || '';
  el.refreshHint.hidden = !note;
}
/* 秒数写回两格（并跟着重算边界）：屏上显示的必须就是将要生效的那个值 */
function paintSpan(sec) {
  const [n, u] = splitSpan(clampRefresh(sec) || DEFAULT_CFG.autoRefresh);
  el.autoRefreshNum.value = String(n);
  el.autoRefreshUnit.value = String(u);
  paintBounds();
}

export default {
  build() {
    el.autoRefreshUnit.innerHTML = SPAN_UNITS.slice().reverse().map(u =>
      '<option value="' + u + '">' + SPAN_WORD[u] + '</option>').join('');
    el.autoRefreshToggle.addEventListener('click', () => {
      paintSwitch(!on);
      if (on) { const r = readSpan(); showHint(r.note); } else showHint(null);
    });
    el.autoRefreshNum.addEventListener('input', () => { if (on) showHint(readSpan().note); });
    el.autoRefreshUnit.addEventListener('change', () => {
      paintBounds();
      if (on) showHint(readSpan().note);
    });
  },
  fill(cfg) {
    el.autoLocate.checked = !!cfg.autoLocate;
    paintSpan(cfg.autoRefresh);
    paintSwitch(!!cfg.autoRefreshOn);
    showHint(null);
  },
  read(cfg) {
    cfg.autoLocate = !!el.autoLocate.checked;
    const r = readSpan();
    cfg.autoRefresh = r.sec;
    cfg.autoRefreshOn = on;
    /* 夹过就把框里的数字一起改掉：不然屏上写着 3 秒、存的是 15 秒、下一拍跑的又是 15，
     * 而那句解释在关开关或重开面板时就没了 —— 显示与生效分家是这一格最坏的一种错。 */
    paintSpan(r.sec);
    showHint(r.note);
  }
};
