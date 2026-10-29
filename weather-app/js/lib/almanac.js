/* 黄历：农历日子 + 干支 + 建除十二值 + 冲煞 + 彭祖百忌 + 节气倒计时，全本地计算。
 *
 * 为什么不打「黄历 API」：理由同 ganzhi.js 顶部（个人免费站随时挂，且 CORS 无保证）。
 *
 * 农历这一行用 Intl 的 chinese 历法，而不是手抄一份 1900–2100 农历码表 —— 那种表错一个
 * 十六进制位就整月错位，而 ICU 的数据随浏览器自带、支持闰月。实测 2026-09-20 → 「八月10」，
 * 2025-07-25 → 「闰六月1日」，与万年历一致。
 *
 * 外部对表（2026-09-20，老黄历站）：
 *   9-20 丙午年 丁酉月 丁酉日 · 值建 · 冲(辛卯)兔煞东 · 丁不剃头头必生疮，酉不会客醉坐颠狂
 *   9-26 八月十六 癸卯日 · 值破 · 冲(丁酉)鸡煞西 · 宜破屋坏垣求医治病，忌移徙入宅
 *   10-01 八月廿一 戊申日 · 值闭 · 冲(壬寅)虎煞南 · 戊不受田田主不祥，申不安床鬼祟入房
 * 本模块算出的每一项（含日柱连续、建除落点、冲的干支与生肖、煞方、彭祖百忌）与上述逐字相同。
 *
 * 唯一刻意不照搬的是「逐日宜忌」：市面黄历的宜忌要过几十种吉神凶煞（月建、土府、杨公忌……），
 * 那是另一套得查完整神煞表的活，凭记忆补只会编。所以这里只给**建除十二值的通用宜忌**，
 * 界面上也写明是通用值，别当成某一天专属的择日结论。 */
import { dayOf, fourPillars, nextTerm, cycleName, ANIMALS } from './ganzhi.js';

const mod = (n, m) => ((n % m) + m) % m;
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/* 建除十二值：以日支与月支同支为「建」，顺行十二辰。
 * 吉凶按口诀「建满平收黑，除危定执黄，成开皆可用，闭破不相当」定档；
 * 宜忌取该值的通用说法（与逐日神煞排出来的老黄历会有出入）。 */
const JIANCHU = [
  { name: '建', dao: '黑道', yi: '祭祀、出行、沐浴、扫舍', ji: '动土、破土、修造、开仓', note: '月建当日，气正方，只宜例行祭祀出行' },
  { name: '除', dao: '黄道', yi: '除旧、扫舍、就医、祭祀', ji: '出行、求财、安葬', note: '去旧生新，除弊之日' },
  { name: '满', dao: '黑道', yi: '祈福、祭祀、纳财、栽种', ji: '嫁娶、赴任、动土', note: '充盈之象，宜取财不宜婚宦' },
  { name: '平', dao: '黑道', yi: '修造、平治、谋划、做事', ji: '诉讼、出行、安葬', note: '平平无险，宜做平常事' },
  { name: '定', dao: '黄道', yi: '订盟、协议、宴饮、上官', ji: '医疗、诉讼、出师', note: '安定可久，宜议定事成' },
  { name: '执', dao: '黄道', yi: '建屋、种植、捕捉、修筑', ji: '迁移、出行、开市', note: '执守之日，宜守成不宜远行' },
  { name: '破', dao: '凶日', yi: '破屋、坏垣、求医、治病', ji: '嫁娶、移徙、入宅、出行', note: '月支所冲，坏垣而已，馀事勿取' },
  { name: '危', dao: '黄道', yi: '安床、祭祀、结纳、修造', ji: '出行、登高、涉险', note: '高危之象，宜安稳勿冒险' },
  { name: '成', dao: '吉日', yi: '开业、入学、嫁娶、赴任', ji: '诉讼、破土', note: '诸事可成，黄历里的上等日' },
  { name: '收', dao: '黑道', yi: '纳财、收租、囤积、栽种', ji: '出行、安葬、开市', note: '收成敛藏，宜进不宜动' },
  { name: '开', dao: '吉日', yi: '开张、求财、祈福、出行', ji: '破土、安葬', note: '开辟开通，与成日同列吉' },
  { name: '闭', dao: '凶日', yi: '筑堤、开渠、塞洞、埋葬', ji: '嫁娶、开市、出行、求医', note: '闭藏不通，只宜填筑封闭之事' }
];

/* 彭祖百忌：干一句、支一句，共 10 + 12 条固定文本 */
const PENGZI_STEM = ['甲不开仓财物耗散', '乙不栽植千株不长', '丙不修灶必见灾殃', '丁不剃头头必生疮',
  '戊不受田田主不祥', '己不破券二比并亡', '庚不经络织机虚张', '辛不合酱主人不尝',
  '壬不泱水更难提防', '癸不词讼理弱敌强'];
const PENGZI_BRANCH = ['子不问卜自惹祸殃', '丑不冠带主不还乡', '寅不祭祀神鬼不尝', '卯不穿井水泉不香',
  '辰不哭泣必主重丧', '巳不远行财物伏藏', '午不苫盖屋主更张', '未不服药毒气入肠',
  '申不安床鬼祟入房', '酉不会客醉坐颠狂', '戌不吃犬作怪上床', '亥不嫁娶不利新郎'];

/* 三合局定煞方：申子辰南、巳酉丑东、寅午戌北、亥卯未西 —— 日支 % 4 正好分组 */
const SHA = ['南', '东', '北', '西'];

/* 「初十 / 十一 / 二十 / 廿一 / 三十」这类农历日子的写法 */
function lunarDayName(n) {
  if (!(n >= 1 && n <= 30)) return String(n);
  if (n <= 10) return '初' + CN_NUM[n - 1];
  if (n < 20) return '十' + CN_NUM[n - 11];
  if (n === 20) return '二十';
  if (n < 30) return '廿' + CN_NUM[n - 21];
  return '三十';
}

let lunarFmt = null;
/* ICU 只把农历月给成「八月/闰六月/正月/腊月」，日是阿拉伯数字，所以取 parts 自己拼 */
function lunarOf(date) {
  try {
    if (!lunarFmt) lunarFmt = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' });
    let month = '', day = '';
    for (const p of lunarFmt.formatToParts(date)) {
      if (p.type === 'month') month = p.value;
      else if (p.type === 'day') day = p.value;
    }
    const n = parseInt(day, 10);
    return month && n ? month + lunarDayName(n) : '';
  } catch (e) { return ''; }   // 没有 chinese 历法数据的环境就整行不显示，不硬凑
}

export function almanac(date) {
  const now = date || new Date();
  const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
  const day = dayOf(now);
  const s = day.index % 10, b = day.index % 12;
  const t = fourPillars(y, m, d, 12);
  const mb = t.pillars[1].b % 12;                    // 月支：建除的起点
  const jc = JIANCHU[mod(b - mb, 12)];
  // 反吟（日柱之冲）：干取「我克者」（同性相克，序号 +4），支取对冲（+6）
  const cs = mod(s + 4, 10), cb = mod(b + 6, 12);
  const term = nextTerm(now);
  return {
    solar: m + '月' + d + '日',
    lunar: lunarOf(now),
    gzYear: t.pillars[0].gz,
    gzMonth: t.pillars[1].gz,
    gzDay: day.gz,
    elem: day.elem,
    zodiac: t.zodiac,
    jianchu: jc,
    clash: { gz: cycleName(mod(6 * cs - 5 * cb, 60)), animal: ANIMALS[cb] },
    sha: SHA[b % 4],
    pengzi: PENGZI_STEM[s] + '，' + PENGZI_BRANCH[b],
    term: term
  };
}
