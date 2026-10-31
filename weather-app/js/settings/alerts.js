/* 设置分组「气象预警」。
 * 门槛下拉的选项来自 lib/alerts.js 的 LEVELS（与配色同一份定义，别在这儿重抄一遍）。
 * 提醒只在手机壳里成立：网页版要发通知得有 ServiceWorker，而原生壳里刻意不注册 SW（见 README），
 * 桌面浏览器又拿不到系统通知权限 —— 所以网页版只把预警画在页面上，不弹通知。 */
import { el } from '../lib/dom.js';
import { DEFAULT_CFG } from '../lib/config.js';
import { providerBackground, providerGivesAlerts } from '../providers/index.js';
import { alertSupported } from '../lib/notify.js';
import { LEVELS } from '../lib/alerts.js';

/* 「有没有预警可核对」和「划掉应用后还查不查」都是当前那个源的事，不是全局的：
 * 「中国天气」在实况报文里带（只给最新一条），Open-Meteo/wttr 根本不给。
 * 换成不给预警的源时把这一句写在设置里，比让用户对着一条空栏猜强。 */
function alertHint() {
  if (!alertSupported()) {
    el.alertHint.hidden = true;      // 整组不画时把盒子一起收，理由同 notify.js
    return;
  }
  el.alertHint.hidden = false;
  const id = el.providerSel.value;
  const gives = providerGivesAlerts(id);
  if (!gives) {
    el.alertHint.textContent = '当前这一源不给气象预警，页面上不会出现那一栏；换成「中国天气」才有得核对。';
    return;   // 这一句讲的是现状，不是入门教学：只要这一源给不出就一直说
  }
  const back = providerBackground(id);
  el.alertHint.textContent = '预警跟着天气那一发一起核对，不额外耗流量；到门槛级别才弹通知，同一张网只给最新一条。' +
    (back ? '划掉后台后每 10 分钟自取一次专盯预警。' : '划掉应用后不再自取（那一路只有「中国天气」给得出），只在打开应用时核对。');
  /* 「用过就收起」，与通知那一栏同一条规矩：开关已经打开、且划掉应用之后那一路也真跑得动，
   * 这套说明才收 —— 长文在「软件声明 · 哪些能力要手机壳在场」里。后台跑不动时留着，
   * 因为那一支说的是「划掉应用之后就不再跟了」这个现状，收掉等于把差别藏起来。 */
  el.alertHint.hidden = el.alertOn.checked && back;
}

export default {
  build() {
    el.alertMin.innerHTML = LEVELS.map(l => '<option value="' + l.rank + '">' + l.label + '</option>').join('');
  },
  fill(cfg) {
    const ok = alertSupported();
    const a = cfg.alert || {};
    /* 浏览器里这一组整套不画：门槛与开关都只喂给原生通知（pushAlerts 第一行就没插件直接 return），
     * 页面上那条预警栏不受这两个控件影响，照常画。 */
    el.alertGroup.hidden = !ok;
    el.alertOn.disabled = !ok;
    el.alertMin.disabled = !ok || a.on === false;
    el.alertOn.checked = a.on !== false;
    el.alertMin.value = String(a.min == null ? DEFAULT_CFG.alert.min : a.min);
  },
  read(cfg) {
    cfg.alert = { on: !!el.alertOn.checked, min: parseInt(el.alertMin.value, 10) || 0 };
  },
  sync() { alertHint(); }
};
