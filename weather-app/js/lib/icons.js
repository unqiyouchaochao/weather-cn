/* 图标着色：把图标名换成带色的内联 SVG 片段（全离线，不依赖字体或外链）。
 *
 * 图形本身来自 Game-Icon-Pack（CC0-1.0，github.com/Nieobie/Game-Icon-Pack），
 * path 一个字没改，取法与清单见 icon-data.js 顶部。
 *
 * 两类图标走两条着色路：
 *  - 天气状况（sun/rain/…）：语义色，按名字给 —— 「雨是蓝的」这件事不该跟着主题变，
 *    换套主题雨就变成红的，比不协调更糟。
 *  - 界面符号（settings/location/sort/…）：**不写行内色**，让 SVG 的 fill="currentColor"
 *    继承按钮自己的字色。按钮在主题里是什么墨色，图标就是什么墨色，天然跟着走，
 *    也省掉「每套主题 × 每个 UI 图标」这一整片从没量过的配色配对。 */
import { ICONS } from './icon-data.js';

const COLOR = {
  sun: '#f5a623', 'sun-02': '#f5a623', cloudy: '#7aa7d6', cloud: '#8aa9c9',
  rain: '#3b82c4', 'rain-02': '#3b82c4', snowy: '#5fa8e0', snowflake: '#79b8e6',
  fog: '#9aa7b3', wind: '#7fc7c0', thunderstorm: '#7c5cd6', lightning: '#e0a92b',
  temperature: '#e06a5a', 'temperature-up': '#e0533f', 'temperature-down': '#3b82c4',
  rainbow: '#d96fb3', star: '#f5c542', fire: '#e0533f',
  night: '#8f9fd0', hail: '#7fa8c9', water: '#3b82c4', compass: '#8aa9c9',
};

/* 界面符号：颜色交给 CSS（currentColor），这里一个色都不给 */
const INK = ['location', 'settings', 'dark-mode', 'light-mode', 'sort', 'arrow-left',
  'five-pointed-star', 'crystal-ball', 'paper', 'search', 'refresh', 'info',
  'toggle-on', 'toggle-off'];

export function svgIcon(name, ink) {
  const svg = ICONS[name];
  // 认不出的名字**不兜底成云**：那会让一个拼错的 'setings' 在屏上画成一朵云，
  // 看着像图标坏了、查起来像 CSS 的事。留空 + 回归里那条「全库图标名必须都在 ICONS 里」才是对的。
  if (!svg) return '';
  // ink=true：天气图标也可能被界面按钮借用（明暗开关用的是 ☀/🌙 那两张），
  // 那种场合它承载的是「按钮状态」不是「天气状况」，所以跟着字色走而不是语义色。
  if (ink || INK.indexOf(name) >= 0) return '<span class="ic-ink" style="display:inline-flex;width:100%;height:100%">' + svg + '</span>';
  return '<span style="color:' + (COLOR[name] || '#5b6b7b') + ';display:inline-flex;width:100%;height:100%">' + svg + '</span>';
}

/* markup 里只留 <span data-icon="settings">，启动时一次填好。
 * 为什么不在 HTML 里直接写 svg：那是把图标库抄第二遍，改一处漏一处（这个项目里
 * 同一份真值抄两遍的下场已经记过好几回了）。声明名字 + 启动填，真值只有 icon-data.js 一处。 */
export function hydrateIcons(root) {
  const nodes = (root || document).querySelectorAll('[data-icon]');
  nodes.forEach(n => {
    const name = n.getAttribute('data-icon');
    n.innerHTML = svgIcon(name);
    n.dataset.iconName = name;    // 留个调试/回归抓手：屏上这枚到底是哪张图
    n.removeAttribute('data-icon');  // 填过的壳摘掉标记，重复调用不会把图标自己再吞一次
  });
  return nodes.length;
}
