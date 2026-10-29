/* 桌面图标：只在手机壳里可用。
 *
 * Android 的图标是**编译期**资源 —— 运行时只能在这几套预设之间换（预设与 activity-alias
 * 见 android/app/src/main/AndroidManifest.xml，切换与自愈见 AppIconPlugin.java）。
 * 「从相册挑一张当桌面图标」只有桌面启动器做得到（它能把任意图做成快捷方式），
 * 应用自己做不到，所以这里只给预设，不放选图入口。
 *
 * 预览的色值与图形是 android 那几份 vector / values/app_icon_colors.xml 的照抄，
 * 改 android 那侧要回来改这里 —— 两边对不上时以 android 为准（屏幕上真正显示的是它）。 */

function plug() {
  return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.WeatherIcon) || null;
}
export function iconSupported() { const p = plug(); return !!(p && p.setIcon && p.getIcon); }

/* art 里不写 fill 的图形走 currentColor，由每套自己的 ink 上色 */
export const ICON_CHOICES = [
  {
    id: 'default', label: '默认', bg: '#2B7FFF', ink: '#FFD54A',
    art: '<circle cx="40.5" cy="40.5" r="15.19" fill="currentColor"/>' +
      '<path d="M40.5,13.5 L40.5,20.25 M40.5,60.75 L40.5,67.5 M13.5,40.5 L20.25,40.5 M60.75,40.5 L67.5,40.5 M20.25,20.25 L25.31,25.31 M55.69,55.69 L60.75,60.75" stroke="currentColor" stroke-width="4.05" stroke-linecap="round"/>' +
      '<g fill="#FFFFFF"><circle cx="64.13" cy="67.5" r="18.56"/><circle cx="47.25" cy="74.25" r="15.19"/><circle cx="77.63" cy="74.25" r="13.5"/>' +
      '<rect x="37.13" y="77.63" width="50.63" height="15.19" rx="7.59"/></g>'
  },
  {
    id: 'sun', label: '晴日', bg: '#2E6FB7', ink: '#F5C542',
    art: '<circle cx="54" cy="54" r="14" fill="currentColor"/>' +
      '<path d="M54,25 L54,32 M54,76 L54,83 M25,54 L32,54 M76,54 L83,54 M38.4,38.4 L33.5,33.5 M69.6,38.4 L74.5,33.5 M38.4,69.6 L33.5,74.5 M69.6,69.6 L74.5,74.5" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>'
  },
  {
    id: 'night', label: '夜航', bg: '#0B0B0D', ink: '#E8E6EE',
    art: '<path d="M60,28 A26,26 0 1 0 60,80 A30,30 0 0 1 60,28 Z" fill="currentColor"/>' +
      '<path d="M76,32 L78,38 L84,40 L78,42 L76,48 L74,42 L68,40 L74,38 Z" fill="#F5C542"/>'
  },
  {
    id: 'bloom', label: '花嫁', bg: '#F2E6EE', ink: '#6E5A72',
    art: '<circle cx="48" cy="44" r="12" fill="#DFAFC6"/>' +
      '<circle cx="55" cy="64" r="11" fill="currentColor"/><circle cx="70" cy="58" r="14" fill="currentColor"/>' +
      '<circle cx="76" cy="64" r="10" fill="currentColor"/>' +
      '<path d="M33,64 h53 v10 a5,5 0 0 1 -5,5 h-43 a5,5 0 0 1 -5,-5 z" fill="currentColor"/>'
  }
];

export function iconLabel(id) {
  const c = ICON_CHOICES.find(x => x.id === id);
  return c ? c.label : id;
}

/** 当前生效的那一套。原生侧顺带会自愈「四个入口全被关掉」这种桌面图标消失的极端态。 */
export function currentIcon() {
  const p = plug();
  if (!p) return Promise.resolve(null);
  return p.getIcon().then(r => (r && r.icon) || null, () => null);
}

/** 换图标，resolve 成原生实际生效的名字（不是我们传进去的那个 —— 以原生为准）。 */
export function applyIcon(id) {
  const p = plug();
  if (!p) return Promise.reject(new Error('这个平台换不了桌面图标'));
  return p.setIcon({ name: id }).then(r => (r && r.icon) || id);
}
