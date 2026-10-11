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
 * 「中国天气」在实况报文里带、墨迹在城市页里带（各家只给最新一条），Open-Meteo/wttr 根本不给。
 * 换成不给预警的源时把这一句写在设置里，比让用户对着一条空栏猜强。 */
function alertHint() {
  if (!alertSupported()) {
    el.alertHint.textContent = '预警提醒只在手机 App 里可用（浏览器拿不到系统通知权限）；网页版仍会把预警画在页面上。';
    return;
  }
  const id = el.providerSel.value;
  if (!providerGivesAlerts(id)) {
    el.alertHint.textContent = '当前这一源不给气象预警，页面上不会出现那一栏；换成「中国天气」或「墨迹天气」才有得核对。';
    return;
  }
  el.alertHint.textContent = '预警跟着天气那一发一起核对，不额外耗流量；到门槛级别才弹通知，同一张网只给最新一条。' +
    (providerBackground(id) ? '划掉后台后每 10 分钟自取一次专盯预警。' : '划掉应用后不再自取（那一路只有「中国天气」给得出），只在打开应用时核对。');
}

export default {
  build() {
    el.alertMin.innerHTML = LEVELS.map(l => '<option value="' + l.rank + '">' + l.label + '</option>').join('');
  },
  fill(cfg) {
    const ok = alertSupported();
    const a = cfg.alert || {};
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
