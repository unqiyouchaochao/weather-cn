/* falsify 变异表里属于「view」的那一族。
 * 为什么一张表拆成几份：MUT 是「每条新功能都必须改同一个文件」的第三处 —— 两条改动线各加一条
 * 断言就要往同一个 ]; 前面插一行，抢同一个位置、同一份上下文（前两处是 ui.js 与 main.js，已分片）。
 * 加一处变异 = 在归属那一族加一条；一条断言盯两个族的文件就写成两条，各进各的族。
 * 两条规矩没变：① name 开头写 `vNNN `，falsify 靠它把比这棵树新的条目筛掉；
 * ② from 必须在目标文件里**恰好命中 1 次** —— 改完跑 `node tools/anchor-audit.mjs`，一秒出失锚条数，
 *   不必等那一整趟两小时的全量逼红。 */
import { F } from '../files.mjs';

export default [
  { name: 'v111 图标表把雾天指到一个不存在的态', file: F.wthr,
    from: "  fog: 'fog', temperature: 'cloud'", to: "  fog: 'foggy', temperature: 'cloud'",
    expect: '天气底色四处名单对齐' },
  { name: 'v111 applyTheme 忘了下发（值在 themes.js 里躺着，屏上还是没底）', file: F.uiTheme,
    from: "  for (const k of WEATHER_BG) document.body.style.setProperty('--w-' + k, t.w[k]);",
    to: '  void WEATHER_BG;', expect: '换主题会把六个渐变全下发' },
  { name: 'v111 天气态又回去整体重写 body.className', file: F.uiTheme,
    from: "  document.body.dataset.weather = BG_STATE[lastIcon] || 'clear';",
    to: "  document.body.className = BG_STATE[lastIcon] || 'clear';",
    expect: '换主题会把六个渐变全下发' },
  { name: 'v112 主题换了但 --glass-mix 没跟着下发（卡面透出去、次要文字没人补色）', file: F.uiTheme,
    from: "  document.body.style.setProperty('--glass-mix', t.glass.mix + '%');", to: '',
    expect: '各自的下发：--glass-a' },
  { name: 'v114 applyTheme 下发 mix/blur 却漏了 α（卡面还是实底，主题间看不出差别）', file: F.uiTheme,
    from: "  document.body.style.setProperty('--glass-a', t.glass.a + '%');", to: '',
    expect: '各自的下发：--glass-a' },
  { name: 'v114 天气态查表退成永远晴天（底不再跟着天气变，逐帧探针也就量不到「换过」）', file: F.uiTheme,
    from: "  document.body.dataset.weather = BG_STATE[lastIcon] || 'clear';",
    to: "  document.body.dataset.weather = 'clear';",
    expect: '切主题的那一帧不许出现' },
  { name: '预警卡的出处又写死成中央气象台', file: F.uiAlerts, from: 'el.alertScope.textContent = list[0].src || providerLabel(providerId || loadConfig().provider);', to: "el.alertScope.textContent = '中央气象台 · 中国天气';", expect: '那行出处跟着「发这条信号的源」走' },
  { name: 'v95「已过」改标在「现在」之后', file: F.uiHours, from: "return k === hourNow ? ' now' : (k < hourNow ? ' past' : '');", to: "return k === hourNow ? ' now' : (k > hourNow ? ' past' : '');", expect: '已过去的格子恰好排在' },
  /* 这一处原先改的是 query.js 那句 `if (!silent) ui.showSkeleton()`，2026-10-04 全量跑批报「红 ✗」
   * （改了之后 121 条一条不红）。查下来不是断言坏了，是**它防的行为有三道冗余闸**：
   * ① 换目标时整页交给骨架屏（#result 一 hidden，祖先没 client rect ⇒ 格子自然不算「在屏上」）；
   * ② loadToday 开头 `if (!keepVisible) hideHours()`（换城市先收）；③ 拿不到数据时再 hideHours() 一次。
   * 实测：单独撤 ① 不红，单独撤 ③ 也不红 —— 撤一道另外两道照样收得住，绿是对的，
   * 这种变异属于「改不坏」，不是「断言是摆设」。（falsify 的提示语在这时候会说重话，得自己分清。）
   * 要咬住就得把 ②③ 两道一起撤 —— 于是这一条改的是 loadToday 里那连续的两句。 */
  { name: 'v95 逐小时两道「收块」闸一起撤（上一座城的格子留在屏上）', file: F.uiHours,
    from: '  if (!keepVisible) { hideHours(); hourRows = []; hourlyByDay = {}; viewDay = null; hourStep = 0; }\n  todayHours(provider, lat, lon, data).then(res => {\n    if (seq !== hourSeq) return;\n    if (!res) { hideHours(); return; }              // 拿不到就整块收起，不留一张空卡',
    to: '  if (!keepVisible) { hourRows = []; hourlyByDay = {}; viewDay = null; hourStep = 0; }\n  todayHours(provider, lat, lon, data).then(res => {\n    if (seq !== hourSeq) return;\n    if (!res) { return; }',
    expect: '不留空卡、也不留上一座城的格子' },
  { name: 'v97 界面不再写「每 3 小时一档」（栏目比内容宽）', file: F.uiHours, from: "  const coarse = hourStep > 1 ? ' · 每 ' + hourStep + ' 小时一档' : '';", to: "  const coarse = '';", expect: '窗口标题写明' },
  /* ↓ 2026-10-02 v101「冷启动查不到」（#109）。①② 是首页三态的两半（该不该算「有数据」、
   *   空状态卡出场时结果区必须让位）；③④⑤ 是状态行那格的所有权（报错优先、解钉要解干净、
   *   屏幕空着时钉住的必须上得来）；⑥–⑨ 是自动补两轮的四道闸；⑩ 是「重试认的是上一次**尝试**过的目标」。
   *   踩过的两处坑记在这儿：hideStatus 里那句 errLine=null 是个**等价改动**（showStatus 画非报错时
   *   自己就翻页了），改坏它断言照样绿 —— 第一版这条就是这么混过去的，换成上面 ④⑤ 两处真有副作用的；
   *   而「计次被清零」那种改坏要等满 4 秒那一档才量得到，回归里那一头只等了 3 秒，也绿过一次。 */
  { name: 'v101 什么都没查到时也算「有数据」（回到整页留白那个原始缺陷）', file: F.uiHome, from: "home = hasData ? 'data' : 'none';", to: "home = 'data';", expect: '什么都没查到时首页落在空状态卡上' },
  { name: 'v101 空状态卡出场时结果区还赖在屏上（三态不互斥）', file: F.uiHome, from: "el.result.hidden = cmp || home !== 'data';", to: 'el.result.hidden = cmp;', expect: '什么都没查到时首页落在空状态卡上' },
  { name: 'v101 钉住的提示又能盖掉正在显示的报错', file: F.uiStatus, from: '  if (!errLine || el.status.hidden) showStatus(msg, false, null, action);', to: '  showStatus(msg, false, null, action);', expect: '钉住的提示不许盖掉正在显示的报错' },
  { name: 'v101 解钉只清屏幕不清记录（下一次 hideStatus 又把旧提示顶回来）', file: F.uiStatus, from: 'export function unpinStatus() {\n  pinned = null;', to: 'export function unpinStatus() {', expect: '解过钉之后状态行该真的空着' },
  { name: 'v101 屏幕空着时也拦着不钉（报错记录还挂着就永远上不来）', file: F.uiStatus, from: '  if (!errLine || el.status.hidden) showStatus(msg, false, null, action);', to: '  if (!errLine) showStatus(msg, false, null, action);', expect: '屏幕空着时新钉上的那条要立刻上屏' },
  { name: 'v101 空状态底下还挂着「数据源：—」（读起来像这家的数据就是空的）', file: F.uiHome, from: "  el.providerTag.hidden = home !== 'data';", to: '  el.providerTag.hidden = false;', expect: '空状态那一态下「数据源」那一行跟着收起' },
  /* v115 花嫁装饰层那一条（applyTheme 不下发 --lace）2026-10-06 删了：--lace 这一格连同
   * 那四件装饰、三条断言一起随花嫁主题撤走。另一半（装饰段与 .petals 的门）在
   * tools/falsify/mut/visuals.mjs 末尾留着往回捞的说明。 */
];
