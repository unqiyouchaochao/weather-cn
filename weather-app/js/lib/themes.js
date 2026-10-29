/* 主题清单 —— id 必须与 styles.css 里的 body[data-theme="id"] 一一对应。
 * base 决定 🌙/ 按钮往哪一边切；meta 写进 <meta name="theme-color">，
 * 让 Android 状态栏/浏览器地址栏跟着主题变色（深色主题下不再是刺眼的蓝）。
 * 设置面板的下拉选项由这里生成。
 *
 * 2026-10-06：11 套收敛成 2 套（夜航黑白 + 薄荷蓝），其余 9 套连同样式块一起删了，
 * 要恢复只能从 git 历史捞。为什么留这两套：一套零彩度的黑白、一套冷色浅底，
 * 明暗两边各一个代表，界面上没有第三选择 —— 清单短了，但下面那几条约束一条没松。
 * 加一套主题的步骤：这里加一行（含 w 与 glass 三个量）+ styles.css 加一个
 * body[data-theme="新id"] 的色板块，然后跑 tools/theme-glass-scan.mjs --fix 与全量回归。
 * **顺序有意义**：defaultOf(base) 取的是每个 base 里的第一套，themeById() 认不出来的 id
 * 也兜底回第 0 行 —— 所以第一行就是浅色默认，别把它挪走。
 *
 * w 是这套主题的**天气态底色**（六个态见 WEATHER_BG）。它以前抄在 styles.css 的每个主题块里，
 * 一份真值抄十遍：加一套主题要记得去 CSS 补六行，漏了的那套会悄悄继承 :root 的蓝白底
 * （#54 补的就是这个洞）。搬到这里之后，一套主题的完整设计（含底色）只在这一处，
 * applyTheme() 下发为 --w-* 自定义属性。
 * 这几处必须一起动，由 tests/app.checks.mjs 盯着：这里的键、styles.css 里
 * body[data-weather=…] 那六条规则、lib/weather.js 的 BG_STATE 表、applyTheme 的下发。
 *
 * glass 是这套主题自己的**卡面透出值**：a=卡面不透明度 %（越小越透）、mix=次要文字朝 --ink 提档的比例、
 * blur=毛玻璃半径 px。它以前是一根全局滑杆（cfg.bg.chip，任何人都能调），2026-10-04 起改成主题的设计值，
 * 于是三个量必须一起定：只降 α 不补字色，次要文字会跌破 AA(4.5)。
 *
 * 这两格不是拍的，每套各量一遍（tools/theme-glass-scan.mjs；浏览器里由 tests/app.checks.mjs
 * 那几条 AA 扫描复测）。每种字色都要压在它**真会遇到的每一块底**上 ≥ AA+0.5=5.0，底有三族：
 *   · 卡面直接压在天气渐变上：底 = α·card + (1−α)·色标 —— 复合色对底单调，所以六个渐变各两个端点
 *     加上页面 --bg（共 13 块）就包住了中间，不必真的去截图取色；
 *   · 卡面里的子面板（--code-bg / --hint-bg / --field-bg / --ok-bg / --err-bg）：它们不吃 α，只受提档影响；
 *   · 弹窗那一支：面板 = α·card 压在 --veil 上、遮罩再压在渐变上。遮罩把那一片压暗二十多个灰阶，
 *     只量前两族就会漏掉它 —— 第一轮离线报「每套 ≥5.0」，跑批里「软件声明」正文只剩 4.53。
 * α 的高低分两种情况：
 *   · 浅色那套（85）是**被字色顶住的**：--pop 与提档后的 --muted 压在最深那档 storm 端点或弹窗底上先到线；
 *   · 深色那套（72）字色富余，所以 α 由观感定 —— 夜航的渐变几乎是纯色
 *     （渐变与页面底之比只有 1.07~1.20），透出来看不见天气、只是把卡片层级化掉，就留在偏实的一档。
 * mix 是每套的**最小值**，不是统一档：掺到 62% 时 --muted 与 --ink 几乎同色，两级文字层次就没了，
 * 所以能不给的就不给（夜航是 0）。blur 跟着 α 走（越透越要糊得狠才压得住底纹），
 * 沿用改前那条换算的斜率、封顶 18px —— 改前滑杆最透那一档就是 18px，没道理现在更贵。
 *
 * 薄荷蓝这一套的色值不是重新挑的，是 2026-10-06 把原「薄荷」整套令牌**转色相 +28°、逐色保持相对亮度不变**
 * 挪过来的。为什么这样转：对比度只由亮度决定，亮度不动，那几条 AA 扫描的读数就还是原来那一组数
 * （转前实测最低 5.02，转后由扫描复验）。要改一套主题的色相就照这个办法，别一个个重挑。
 * @media (prefers-contrast: more) 那一票否决留在 CSS（它是媒体查询，搬不进 JS）。 */
export const WEATHER_BG = ['clear', 'cloud', 'rain', 'snow', 'storm', 'fog'];

export const THEMES = [
  { id: 'mint', label: '薄荷蓝（默认浅色）', base: 'light', meta: '#eefafa',
    w: { clear: 'linear-gradient(160deg, #cfeef4, #eefafa)', cloud: 'linear-gradient(160deg, #d2dfe2, #eef5f5)',
         rain: 'linear-gradient(160deg, #a6b9c2, #d7dee7)', snow: 'linear-gradient(160deg, #e7f3f6, #f7fbfd)',
         storm: 'linear-gradient(160deg, #556781, #8a96aa)', fog: 'linear-gradient(160deg, #d7e1e3, #eef4f4)' },
    glass: { a: 85, mix: 20, blur: 13 } },
  { id: 'dark', label: '夜航（黑白 · 默认深色）', base: 'dark', meta: '#0a0a0a',
    w: { clear: 'linear-gradient(160deg, #1c1c1c, #0a0a0a)', cloud: 'linear-gradient(160deg, #161616, #090909)',
         rain: 'linear-gradient(160deg, #101010, #060606)', snow: 'linear-gradient(160deg, #232323, #0d0d0d)',
         storm: 'linear-gradient(160deg, #0a0a0a, #000000)', fog: 'linear-gradient(160deg, #191919, #0b0b0b)' },
    glass: { a: 72, mix: 0, blur: 18 } }
];

/* 插件主题另立一张表，不并进 THEMES。三个理由，缺一个都会出隐性 bug：
 * ① defaultOf(base) 取的是 THEMES 里该 base 的第一套 —— 并进来的话，用户装的第一个插件
 *    就可能变成「浅色默认」，而默认值不该由外部包决定。
 * ② tests/app.checks.mjs 有六处在遍历 THEMES（含逐主题覆盖率互相比对），
 *    运行期长度会变的数组喂进去，断言就成了看运气。
 * ③ themeById 查不到时兜底回 THEMES[0]，那张表必须始终是「构建期就存在的东西」。 */
const PLUGIN_THEMES = [];
export const pluginThemes = () => PLUGIN_THEMES.slice();
export function setPluginThemes(list) {
  PLUGIN_THEMES.length = 0;
  for (const t of list || []) if (!THEMES.some(b => b.id === t.id)) PLUGIN_THEMES.push(t);
}
/* 「这个 id 认不认」的唯一判据。config.js 那步「查无此 id 就换默认」的迁移必须走它 ——
 * 只看 THEMES 的话，用户导入的主题会在下一次启动时被静默抹掉。 */
export const themeKnown = id => THEMES.some(t => t.id === id) || PLUGIN_THEMES.some(t => t.id === id);

export function themeById(id) {
  for (let i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i];
  for (let i = 0; i < PLUGIN_THEMES.length; i++) if (PLUGIN_THEMES[i].id === id) return PLUGIN_THEMES[i];
  return THEMES[0];
}

/* 清单里第一套浅色 / 第一套深色就是两边的默认值（'mint' 与 'dark'），不写死 id：
 * 换默认只改上面那张表，这里跟着走。config.js 那一步主题迁移用的也是它，两边不各写一份「谁是第一行」。 */
export const defaultOf = base => THEMES.filter(t => t.base === base)[0].id;

/* ☀/ 那一下点击落到哪套主题，以及明暗两边各自记住的那套 —— 纯函数，回归直接喂参数验往返。
 * 为什么单独拎出来：这段逻辑原先写在 main.js 的事件处理器里，没法测，于是「只修了一半」
 * 修了两次。2026-09-21 那次只记深色（切回浅色时写死 'light'），用户挑的浅色照样被偷偷换掉，
 * 实测 theme=paper 连点两下 → dark → light。两边对称记账才收得住。 */
export function toggleTheme(cfg) {
  const cur = themeById(cfg.theme);
  const next = { darkTheme: cfg.darkTheme, lightTheme: cfg.lightTheme };
  if (cur.base === 'dark') {
    next.darkTheme = cur.id;
    const back = themeById(next.lightTheme);
    next.theme = back.base === 'light' ? back.id : defaultOf('light');
  } else {
    next.lightTheme = cur.id;
    const back = themeById(next.darkTheme);
    next.theme = back.base === 'dark' ? back.id : defaultOf('dark');
  }
  return next;
}
