/* 设置分组「单位与外观」：温度/风速单位、主题、空气质量口径。
 * 主题选项由 lib/themes.js 的 THEMES 生成 —— 加一套配色只改那一处 + CSS，不用回来动这里，
 * 更不用动 index.html（那里的 <select> 是空的，写死选项就是第二份真值）。
 * 「背景」那一栏 2026-10-04 整栏删掉了：底由主题给（js/lib/themes.js 的 w 那一格），
 * 透多少也是主题的设计值（同一格的 glass），所以设置页不再需要任何背景控件。 */
import { el } from '../lib/dom.js';
import { esc } from '../lib/util.js';
import { THEMES, themeById, pluginThemes } from '../lib/themes.js';
import { AQI_STDS } from '../lib/aqi.js';

/* 下拉里的选项 = 内置 + 已导入的插件。写成函数而不是 build() 里那行内联表达式，
 * 因为导入/删除之后要能重灌一次 —— 那两处归 settings/themePlugins.js 管，它 import 这个。
 * 插件项加一个后缀而不是另起 optgroup：面板窄，分组标题比一行「（主题包）」更占地方。
 *
 * esc() 是必须的，不是防御性冗余：内置那几套的 label 是仓库里的字面量，可信；
 * 插件的 label 来自用户导入的 JSON，一个 `<option value=x>a</option><script>` 之类的串
 * 直接拼进 innerHTML 就成了注入点。id 同理。 */
export function rebuildThemeOptions() {
  el.themeSel.innerHTML = THEMES.concat(pluginThemes())
    .map(t => '<option value="' + esc(t.id) + '">' + esc(t.label) + (t.plugin ? '（主题包）' : '') + '</option>')
    .join('');
}

export default {
  build() {
    rebuildThemeOptions();
    el.aqiStdSel.innerHTML = AQI_STDS.map(s => '<option value="' + s.id + '">' + s.label + '</option>').join('');
  },
  fill(cfg) {
    el.unitTemp.value = (cfg.units && cfg.units.temp) || 'C';
    el.unitWind.value = (cfg.units && cfg.units.wind) || 'kmh';
    el.themeSel.value = cfg.theme;
    el.aqiStdSel.value = cfg.aqiStd || 'auto';
  },
  read(cfg) {
    cfg.units = { temp: el.unitTemp.value, wind: el.unitWind.value };
    cfg.theme = el.themeSel.value;
    cfg.aqiStd = el.aqiStdSel.value;
    // 下拉里选中的主题顺便记成「☀/🌙 的返回目标」，明暗两边都记：不然用户先在设置里换过配色、
    // 又用快捷按钮切过去再切回来，落回的是列表里那套默认值，用户挑的配色被偷偷换掉
    if (themeById(cfg.theme).base === 'dark') cfg.darkTheme = cfg.theme;
    else cfg.lightTheme = cfg.theme;
  }
};
