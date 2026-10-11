/* 软件声明 —— 设置面板里那一组：一级是「软件声明」这一组，二级是每一条点开看的讲解。
 *
 * 为什么单独成一个模块，而不是把文字写在 index.html 里：这四段说的全是
 * 「当前选中的这一家到底给什么、数从哪来、存在哪」，**必须跟着选择变**。
 * 写死在 markup 里就会出现「选了墨迹、下面还挂着中国天气那 2529 个站」这种声明与实际不一致 ——
 * 那是这个项目最不该有的一类错（宁缺勿错）。所以这里一个字都不写死厂商名，
 * 全部从 providers 注册表的能力位现推（cap / note / nativeOnly / background / alert / airLabel）。
 *
 * 三条口径：
 * ① 只说代码真做得到的事。没实现的不写「将会」，拿不到的写「不给」。
 * ② 长度受控：每条一行一句，最多四句。全文在 README，界面上只留能一眼扫完的量。
 * ③ 默认收起（main.js 渲染时不加 open），点开才展开 —— 这一组的存在本身就是为了
 *    「想查的时候查得到，平时不占地方」。 */
import { getProvider, providerLabel, providerNote, providerNativeOnly, providerBackground, providerGivesAlerts } from '../providers/index.js';
import { AQI_STDS } from './aqi.js';

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
  const only = providerNativeOnly(providerId);
  const out = [];

  const s1 = [];
  if (note) s1.push(note);
  s1.push(capErr ? '这一家的能力要看你填的映射，现在推不出来（' + capErr + '），所以不猜。'
    : '这一家的能力：' + caps(p) + '。');
  if (only) s1.push(native ? '它是逆向来的网页接口，不放行浏览器跨域，所以只有 App 里（原生 HTTP）拿得到。'
    : '它是逆向来的网页接口，不放行浏览器跨域 —— 在浏览器里选中它必然报错，请换一家。');
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

  /* 第四条原来是写死的三句，其中一句直接是错的：「华为天气接口只在壳里用」—— 那个城市榜接口
   * 浏览器与壳同样可用（见 MEMORY 里 hwAqi 那条实测）；「国控站与预警来自 nmc.cn」对墨迹和自定义
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
