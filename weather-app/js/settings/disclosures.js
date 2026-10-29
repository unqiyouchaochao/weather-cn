/* 设置分组「软件声明」：整组重画。文字全在 lib/disclosures.js 里按「面板当前选中的那一家 +
 * 当前空气质量口径」现推，所以换源、换口径、每次开面板都走这一个函数 ——
 * 读的是下拉框的当前值而不是已保存的 cfg：用户换了还没点保存时，说明就该跟着改。
 * 一律不带 open：默认收起，点开才展开（这一组存在的意义就是平时不占地方）。 */
import { el } from '../lib/dom.js';
import { esc } from '../lib/util.js';
import { loadConfig } from '../lib/config.js';
import { isNative } from '../lib/locate.js';
import { providerLabel } from '../providers/index.js';
import { disclosures } from '../lib/disclosures.js';

function syncDisclosures() {
  const list = disclosures(el.providerSel.value, el.aqiStdSel.value, isNative(), loadConfig().custom);
  el.discLead.textContent = '当前选中「' + providerLabel(el.providerSel.value) +
    '」。点开每一条，看它给什么、数实际从哪来、东西存在哪。';
  el.discList.innerHTML = list.map(d =>
    '<details class="disc" data-d="' + d.id + '"><summary>' + esc(d.title) + '</summary><div class="disc-body">' +
    d.lines.map(t => '<p>' + esc(t) + '</p>').join('') + '</div></details>').join('');
}

export default {
  sync() { syncDisclosures(); },
  syncStd() { syncDisclosures(); }
};
