/* 设置分组「数据源」：选哪一家、它的 key、自定义源那五个字段。
 * 这一组是别的组的信息来源（通知、预警、软件声明都要看「当前选中的是哪一家」），
 * 但它不直接叫谁 —— 它只把自己那两栏的显隐摆对，剩下由注册表在各组的 sync 里重算。 */
import { el, customInputs } from '../lib/dom.js';
import { providerNeedsKey } from '../providers/index.js';
import * as ui from '../ui.js';

function fillCustomInputs(cu) {
  for (const k in customInputs) {
    customInputs[k].value = k === 'map' ? JSON.stringify(cu.map || {}, null, 2) : (cu[k] || '');
  }
}

export default {
  fill(cfg) {
    el.providerSel.value = cfg.provider;
    el.apiKey.value = cfg.key || '';
    // 总是回填自定义字段：否则在面板里从别的源切到「自定义」时是一片空白，只能保存失败
    fillCustomInputs(cfg.custom);
  },
  read(cfg) {
    cfg.provider = el.providerSel.value;
    cfg.key = el.apiKey.value.trim();
    if (cfg.provider !== 'custom') return;
    const v = k => customInputs[k].value.trim();
    let map;
    try { map = JSON.parse(v('map')); }
    catch (e) { ui.showStatus('映射 JSON 解析失败：' + (e && e.message ? e.message : e), true); return false; }
    if (!v('curUrl') || !map || !map.current) {
      ui.showStatus('自定义 API 需填写「当前天气 URL」，且映射 JSON 里要有 "current" 段', true);
      return false;
    }
    cfg.custom = {
      geoUrl: v('geoUrl'), curUrl: v('curUrl'), dayUrl: v('dayUrl'), hourUrl: v('hourUrl'),
      needsKey: !!cfg.key, map
    };
  },
  sync() {
    const p = el.providerSel.value;
    el.keyField.hidden = !providerNeedsKey(p);
    el.customFields.hidden = (p !== 'custom');
  }
};
