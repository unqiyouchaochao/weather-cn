/* 软件声明 —— 设置面板里那一组：一级是「软件声明」这一组，二级是每一条点开看的讲解。
 *
 * 为什么单独成一个模块，而不是把文字写在 index.html 里：这四段说的全是
 * 「当前选中的这一家到底给什么、数从哪来、存在哪」，**必须跟着选择变**。
 * 写死在 markup 里就会出现「选了 A 家、下面还挂着 B 家那 2529 个站」这种声明与实际不一致 ——
 * 那是这个项目最不该有的一类错（宁缺勿错）。所以这里一个字都不写死厂商名，
 * 全部从 providers 注册表的能力位现推（cap / note / background / alert / airLabel）。
 *
 * 三条口径：
 * ① 只说代码真做得到的事。没实现的不写「将会」，拿不到的写「不给」。
 * ② 长度受控：每条一行一句，最多四句。全文在 README，界面上只留能一眼扫完的量。
 * ③ 默认收起（main.js 渲染时不加 open），点开才展开 —— 这一组的存在本身就是为了
 *    「想查的时候查得到，平时不占地方」。 */
import { getProvider, providerLabel, providerNote, providerBackground, providerGivesAlerts } from '../providers/index.js';
import { AQI_STDS } from './aqi.js';
/* 主题插件那一条的数字全部从校验层自己拿：格式串、尺寸上限、AA 线。写死在文案里，
 * 哪天 LIMITS 调了这条声明就开始说谎 —— 而它是用户唯一会当成「规则」读的那段话。 */
import { PLUGIN_FORMAT, LIMITS } from './themePlugin.js';
import { AA_LINE } from './themeScan.js';
import { DEFAULT_CFG, humanSpan, spanRange } from './config.js';

const YES = '给', NO = '不给';

/* 能力矩阵：一行讲完「这一家给到哪一步」。顺序固定，测试按这一行断言。
 * 「逐小时 给」这一枚要带档位说明：wttr.in 的 hourly 是 3 小时一档（每天 8 条），
 * 光写「给」就等于把栏目名「今天 00–23 时」也一起吹圆了 —— 声明比实际宽，是这一组最不该犯的错。 */
function caps(p) {
  const c = (p && p.cap) || {};
  const step = Number(p && p.hourlyStep) || 1;
  return [['实况', true, ''], ['逐日', !!c.daily, ''],
    ['逐小时', !!c.hourly, c.hourly && step > 1 ? '（' + step + ' 小时一档）' : ''],
    ['空气质量', !!c.air, ''], ['气象预警', !!c.alert, ''], ['划掉后自取', !!c.background, '']]
    .map(([k, on, extra]) => k + ' ' + (on ? YES : NO) + (on ? extra : '')).join(' · ');
}

function stdLabel(id) {
  const s = AQI_STDS.filter(x => x.id === id)[0];
  return s ? s.label : AQI_STDS[0].label;
}

/**
 * @param providerId 面板里**当前下拉选中**的那一家（不是已保存的 cfg —— 用户换了还没点保存，
 *                   说明就得跟着改，否则「写着 A 实际跑 B」）
 * @param aqiStd     空气质量口径那一栏当前选中的值
 * @param native     现在是不是在手机壳里（决定「只在 App 里可用」这类话怎么说）
 * @param custom     已保存的自定义源配置（只有选中自定义时才用得上）
 */
export function disclosures(providerId, aqiStd, native, custom) {
  /* 自定义那一家的能力要从用户自己填的映射里推，而 buildCustomProvider 在映射没填好时是**会抛**的
   * （缺 "current" 字段）。这里只是生成一段说明，绝不能把设置面板带崩 ——
   * 第一版就是直接 getProvider({provider:'custom', custom:{}})，选中自定义当场炸。
   * 拿不到就照实说拿不到，不猜一套能力出来。 */
  let p = null, capErr = '';
  try { p = getProvider({ provider: providerId, custom: custom || {} }); }
  catch (e) { capErr = String((e && e.message) || e); }
  const label = providerLabel(providerId);
  const note = providerNote(providerId);
  const out = [];

  const s1 = [];
  if (note) s1.push(note);
  s1.push(capErr ? '这一家的能力要看你填的映射，现在推不出来（' + capErr + '），所以不猜。'
    : '这一家的能力：' + caps(p) + '。');
  if (!providerBackground(providerId)) {
    s1.push('划掉应用之后不再自取：通知栏那条会停在最后一次的内容。');
  }
  if (!providerGivesAlerts(providerId)) {
    s1.push('这一家给不出气象预警，所以预警那一栏不会出现（不是「此刻没有预警」，是「这一栏没有数据来源」）。');
  }
  out.push({ id: 'source', title: '数据源 · ' + label, lines: s1 });

  const s2 = [];
  s2.push('当前口径：' + stdLabel(aqiStd) + '。同一组污染物浓度按两套标准算出来是两个数，所以卡上一定写着你看到的这一枚是哪一套。');
  s2.push((p && p.airLabel) ? '这一家给的空气质量写作「' + p.airLabel + '」。'
    : '这一家不提供空气质量数据。');
  s2.push('空气质量那一栏可能拼了好几路（站点实测 / 全市榜 / 模型值），卡上那行徽章写的就是这一组数实际来自哪一路，不是当前选中的源名。');
  out.push({ id: 'air', title: '空气质量口径与降级', lines: s2 });

  out.push({ id: 'privacy', title: '隐私与本地存储', lines: [
    '没有账号、没有登录、没有统计上报：除了下面列出的那几个接口，应用不发任何请求。',
    '设置、收藏、背景选择与开关状态都存在这台设备的 localStorage 里，卸载即清；相册选的那张图单独存一键，不写进配置对象。',
    '发出去的只有查询目标本身（坐标或城市名）和 API Key（如果你配了自定义源）。你的位置不会被"攒起来"上传。',
    '自定义源那格只解析 JSON、不执行任何代码。'
  ] });

  /* 主题插件的规则原先是「主题插件」那个分组里一段常驻 .hint，2026-10-15 按用户要求收进这一组
   * 统一管理：那一段是解释性的长句，天天开着面板的人不需要天天读它，而真要导入一次的人一定
   * 会先翻说明 —— 放分组里两头不讨好。规则本身以校验层为准，这里只是把它说给人听。 */
  out.push({ id: 'themes', title: '主题插件 · 导入与验收', lines: [
    '导入一个 format 为 "' + PLUGIN_FORMAT + '" 的 .json 主题包，它会出现在上面「主题」那一栏里，选中即生效；删掉就回到内置那两套。',
    '装之前先量文字对比度：最低的那一对必须 ≥ ' + AA_LINE.toFixed(1) + '（WCAG AA）。不达标直接拒收，并把是哪一对配色、比值多少、要求多少原样列在面板上 —— 不存在「警告一下照样装」。',
    '尺寸闸：单图 ≤' + (LIMITS.maxAsset / 1048576) + 'MB、整包 ≤' + (LIMITS.maxTotal / 1048576) + 'MB、图 ≤' + LIMITS.maxAssets +
      ' 张、令牌 ≤' + LIMITS.maxTokens + ' 个。应用自己下发的令牌名（--w-* / --glass-* / --lace / --surface / --muted）不收：插件写了要么和 applyTheme 抢下发顺序，要么绕过对比度补偿链。'
  ] });

  /* 第五条原来是「通知栏天气只在手机 App 里可用（浏览器拿不到系统通知权限）」这类话，散在
   * 那两个分组的动态提示里。2026-10-15 用户要求：浏览器里这两组整组不画（跟「桌面图标」同一
   * 手法，反正 pushAlerts 第一行没插件就 return，控件在浏览器里一个都不起作用），为什么少
   * 了东西收到这一组里说一次。判据是 notifySupported()/alertSupported() 同一把尺子。 */
  out.push({ id: 'native', title: native ? '哪些能力要手机壳在场' : '这一版跑在浏览器里：少了哪几样', lines: native ? [
    '现在跑在手机 App 里：通知栏常驻天气、预警通知、桌面图标切换、后台保活与开机自启这几样都在，面板里「通知栏天气」「气象预警」「桌面图标」那三组也因此才画出来。',
    '页面上的天气、预警栏、逐小时、收藏与主题插件都不依赖原生 —— 换到浏览器一样能用；那边那三组会整组不画，这一条会跟着改口。',
    '常驻那条与预警提醒都归系统管：小米/华为要在系统的应用设置里放行「自启动」，否则上滑清理等于强制停止，连排好的闹钟一起被取消。',
    '预警不额外耗流量：它跟着天气那一发一起核对，到门槛级别才弹通知，同一张网只给最新一条。划掉应用之后每 10 分钟自取一次专盯它的那一路，只有「中国天气」给得出配方。'
  ] : [
    '这一版拿不到系统通知权限：「通知栏天气」「气象预警」「桌面图标」那三组整组不画，面板里看不到它们不是坏了，也不是被藏进哪个二级页。',
    '不依赖原生的部分照常：天气与逐日逐小时、页面上那条预警栏、空气质量、收藏与并排对比、运势、新闻、主题插件都不受影响。要常驻通知与后台自取，得装手机 App。'
  ] });

  /* 自动刷新这一条。间隔能自定义之后，「范围多少、关着时那个数值去哪了、划掉应用后归谁
   * 管」一定会被问 —— 按 2026-10-15 定的口径，这类解释一律进这一组，分组里只留按状态出现的动态
   * 提示。区间与读法取自 lib/config.js 的 spanRange()（界面上不许出现第二份数字）。
   * 最后那句「划掉应用之后另有其人」讲的是原生常驻服务，浏览器里根本没有那个东西，
   * 所以按 native 分支 —— 与「原生能力边界」那条同一手法，别对着网页用户念他没有的能力。 */
  const 刷新 = [
    '刷新间隔可以自定义，能落在 ' + spanRange() + ' 之间（填出格的东西会被夹到边界，并在这一栏下面说一句按多少记的）。' +
      '右边那颗开关只管启停：关着时你填的数值还留着，下次开不用重填；默认是关（' +
      humanSpan(DEFAULT_CFG.autoRefresh) + ' 是打开开关时先给你填上的那个值）。',
    '这一拍是页面侧的，屏幕不在前台时它什么都不做 —— 后台标签本来也被浏览器节流到每分钟一个宏任务，白跑一遍整屏重绘而已。'
  ];
  if (native) 刷新.push('划掉应用之后另有其人：手机壳里那个常驻服务每小时重建一次通知、预警开着每 10 分钟只查预警，那两拍与这里的间隔无关。');
  out.push({ id: 'refresh', title: '自动刷新与轮播', lines: 刷新 });

  /* 第四条原来是写死的三句，其中一句直接是错的：「华为天气接口只在壳里用」—— 那个城市榜接口
   * 浏览器与壳同样可用（见 MEMORY 里 hwAqi 那条实测）；「国控站与预警来自 nmc.cn」对自定义那一源
   * 也根本不对。署名这一栏比别条更要跟着实际走 —— 它的作用就是「这一组数究竟问的谁」，
   * 挂错名字等于把出处伪造了一遍。所以这一条也按 cap 现推。 */
  const u = [];
  if (capErr) {
    u.push('天气与空气：' + label + '（当前选中）。这一家的能力还推不出来，所以「哪一格由谁补」也说不准 —— 等映射填全了回来看这一条。');
  } else {
    const c = (p && p.cap) || {};
    /* 只列**数据**上的缺口（逐小时、空气质量）—— 预警给不给得出，第一条里已经照实说过一遍，
     * 在这儿重复还会拼出一句不通的话（「补来的每一格都把出处写在卡上」管不着预警那一栏）。 */
    const gap = [];
    if (!c.hourly) gap.push('逐小时另取 Open-Meteo 的模型值');
    if (!c.air) gap.push('空气质量先取全国城市榜（地级市一级的实测国标），再退 Open-Meteo 的模型值');
    u.push('天气与空气：' + label + '（当前选中）。' + (gap.length
      ? '它缺的那几格由别处补 —— ' + gap.join('；') + '。补来的每一格都把出处写在卡上。'
      : '实况、逐日、逐小时、空气质量、预警它都给得出，卡上那行出处就是这一组数的来路。'));
    if (providerId === 'nmc') u.push('中国天气这一路的实况、国控站空气报文与气象预警都读自 nmc.cn（中央气象台）。');
  }
  u.push('地名检索：Photon（komoot.io）与 Open-Meteo Geocoding 两家合并打分，谁先答对用谁的坐标；坐标反查地名走 Photon 与 bigdatacloud。');
  u.push('新闻板块：中国新闻网的 RSS（时政、国际）与中国政府网政策文件库的公开检索接口，正文版权归原媒体，这里只列标题与链接。');
  u.push('AQI 分级阈值取自生态环境部 HJ 633—2026 与美国 EPA 公开发布的版本；图标与配色是本应用自己画的矢量件，没用第三方图标库。');
  out.push({ id: 'upstream', title: '第三方来源与署名', lines: u });

  return out;
}
