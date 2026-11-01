/* 设置分组「通知栏天气」。字段清单来自 lib/notify.js 的 NOTIFY_FIELDS（同一份定义也发给原生），
 * 这里只画芯片、读写勾选，不解释通知怎么写出去。
 * saved() 是这一组自己的事：关掉就立刻撤销（不然用户关了还在栏里挂着），
 * 刚打开就立刻补一次（不用等下一轮刷新）。 */
import { el } from '../lib/dom.js';
import { providerBackground } from '../providers/index.js';
import { NOTIFY_FIELDS, notifyPrefs, notifySupported, clearWeather, resync } from '../lib/notify.js';

function notifyInputs() { return [].slice.call(el.notifyFields.querySelectorAll('input')); }

/* 后台那一路只认「中国天气」那份 JSON 配方（判据在 providers/index.js 的 providerBackground）。
 * 换到别的源它会自动停 —— 这一句必须写在这一行里，不然用户以为通知还在跟。 */
function notifyHint() {
  if (!notifySupported()) {
    /* 整组在浏览器里压根不画（fill 里那句 hidden），这句说明也就没有存在的场合。
     * 但盒子必须一起收：.hint 自带 padding 与底色，留一个空的会在面板里画出一条实心色块。 */
    el.notifyHint.hidden = true;
    return;
  }
  const gives = providerBackground(el.providerSel.value);
  el.notifyHint.textContent = '开着时每次刷新都更新；' +
    (gives
      ? '划掉后台后每小时自取一次（文本里那个更新时间就是新旧的凭据）。'
      : '但当前这一源给不出后台那份配方，划掉应用后通知停在最后一次的内容。') +
    '小米/华为要在系统的应用设置里放行「自启动」，否则上滑清理等于强制停止，连排好的闹钟一起被取消。';
  /* 「用过就收起」：开关已经打开、且后台那一路确实给得出配方，这一栏就只剩重复 ——
   * 那两句解释在「软件声明 · 哪些能力要手机壳在场」里随时查得到，不必常驻在面板里。
   * 但「这一源给不出配方」那一支不许收：那是**现状**不是入门教学，用户勾了开关而后台
   * 根本没在跑的时候，这一句是屏上唯一说清这件事的地方（收掉它等于把故障藏起来）。 */
  el.notifyHint.hidden = el.notifyOn.checked && gives;
}

export default {
  build() {
    el.notifyFields.innerHTML = NOTIFY_FIELDS.map(f =>
      '<label class="chip"><input type="checkbox" data-f="' + f.id + '" /><span>' + f.label + '</span></label>').join('');
  },
  /* 桌面浏览器没有原生插件（window.Capacitor 都不存在）：整组不画，而不是摆一个点不动的开关
   * 让人勾半天 —— 与「桌面图标」那组同一手法。少了这两组是为什么，写在「软件声明」里。 */
  fill(cfg) {
    const ok = notifySupported();
    el.notifyGroup.hidden = !ok;
    el.notifyOn.disabled = !ok;
    el.notifyFields.hidden = !ok;
    const n = notifyPrefs(cfg.notify);
    el.notifyOn.checked = n.on;
    notifyInputs().forEach(i => { i.checked = !!n.fields[i.dataset.f]; });
  },
  read(cfg) {
    cfg.notify = { on: !!el.notifyOn.checked, fields: {} };
    notifyInputs().forEach(i => { cfg.notify.fields[i.dataset.f] = !!i.checked; });
  },
  sync() { notifyHint(); },
  saved(cfg) { if (cfg.notify.on) resync(); else clearWeather(); }
};
