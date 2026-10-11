/* 干支历核心：只算，不碰 DOM、不打接口。
 *
 * 为什么自己算而不用现成的排盘接口（2026-09-19 实测）：
 * api.vvhan.com 直接无响应、api.oick.cn 404、api.oioweb.cn 不给 Access-Control-Allow-Origin ——
 * 纯静态应用接这种个人站，等于把功能挂在别人心情上。而干支本来就可计算：
 * 日柱是连续的六十循环（儒略日取模），年柱/月柱的界限是节气，节气就是太阳视黄经每 15° 的交点。
 *
 * 精度：太阳视黄经取 Meeus《天文算法》低阶截断式，误差约 0.01°（折合时间约 15 分钟）；
 * 解交点用牛顿迭代（黄经日变化率 ≈0.9856°/天），4 次内收敛到秒级。
 * 唯一会错的是「交点恰好落在出生时刻前后十几分钟」，影响的只是一个时辰的归属。
 *
 * 两套有争议的约定，这里怎么选（都写死在注释里，别当神秘学自由发挥）：
 * - 不做真太阳时修正（不算经度差与均时差），按用户填的钟表时间排 —— 与多数民俗万年历一致。
 * - 23:00~23:59 归夜子时，但**日柱不提前换成次日**（早子/晚子两派各有拥趸，取不换日这派，
 *   理由是用户填的是出生当日，换日会让人以为算错了）。
 */

const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const ZODIAC = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
const STEM_ELEM = ['木', '木', '火', '火', '土', '土', '金', '金', '水', '水'];
const BRANCH_ELEM = ['水', '土', '木', '木', '土', '火', '火', '土', '金', '金', '土', '水'];

/* 六十甲子纳音，每条目覆盖相邻两柱（甲子乙丑海中金 …）。index = 甲子序 / 2 */
const NAYIN = ['海中金', '炉中火', '大林木', '路旁土', '剑锋金', '山头火', '涧下水', '城头土',
  '白蜡金', '杨柳木', '泉中水', '屋上土', '霹雳火', '松柏木', '长流水', '砂中金',
  '山下火', '平地木', '壁上土', '金箔金', '覆灯火', '天河水', '大驿土', '钗钏金',
  '桑柘木', '大溪水', '沙中土', '天上火', '石榴木', '大海水'];

/* 24 节气按格里历年排序：k=0 小寒 … k=23 冬至。黄经 = (285 + 15k) mod 360。
 * EPOCH 是 21 世纪的平均落日，只当牛顿迭代的初值，不参与结果。 */
const TERM_EPOCH = [[1, 5], [1, 20], [2, 4], [2, 19], [3, 6], [3, 20], [4, 5], [4, 20],
  [5, 5], [5, 21], [6, 6], [6, 21], [7, 7], [7, 23], [8, 7], [8, 23],
  [9, 8], [9, 23], [10, 8], [10, 23], [11, 7], [11, 22], [12, 7], [12, 22]];
const TERM_NAMES = ['小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满',
  '芒种', '夏至', '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'];
/* 一个干支年里的 12 个「节」（不含中气），月柱就按它们切换：立春→寅月 … 小寒→丑月 */
const JIE = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 0];

const RAD = Math.PI / 180;
const mod = (a, n) => ((a % n) + n) % n;

/* 格里历正午 → 儒略日序号（只用于日柱，与设备时区无关）。
 * m<=2 时按前一年的 13/14 月处理，这是 Fliegel-Van Flandern 的标准写法。 */
function jdOf(y, m, d, h, mi) {
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5
    + (h + mi / 60) / 24;
}

/* 用户填的钟表时间 → 绝对儒略日。**必须走 Date**：节气交点是绝对时刻，
 * 若把「2024-02-04 09:30」直接当 UTC 算，会与真实时刻差一整个时区 ——
 * 实测 2024 年立春是北京时间 16:27，用错参照系会把当天上午出生的人排进下一个干支年。
 * 代价是所填时间按**设备时区**解释（在国内即东八区，正好是常用参照）。 */
function wallJD(y, m, d, h, mi) {
  return new Date(y, m - 1, d, h, mi).getTime() / 864e5 + 2440587.5;
}

/* 太阳视黄经（含章动与光行差差值），度 */
function sunLon(jd) {
  const T = (jd - 2451545) / 36525;
  const L0 = 280.46646 + T * (36000.76983 + T * 0.0003032);
  const M = 357.52911 + T * (35999.05029 - T * 0.0001537);
  const C = Math.sin(RAD * M) * (1.914602 - T * (0.004817 + 0.000014 * T))
    + Math.sin(2 * RAD * M) * (0.019993 - 0.000101 * T)
    + Math.sin(3 * RAD * M) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  return mod(L0 + C - 0.00569 - 0.00478 * Math.sin(RAD * omega), 360);
}

/* 第 k 个节气在 year 年内的儒略日（一律落在 year 年内，因为 k=0 是小寒、k=23 是冬至） */
function termJD(year, k) {
  const target = mod(285 + 15 * k, 360);
  const ep = TERM_EPOCH[k];
  let jd = jdOf(year, ep[0], ep[1], 12, 0);
  for (let i = 0; i < 8; i++) {
    let diff = target - sunLon(jd);
    if (diff > 180) diff -= 360;
    else if (diff < -180) diff += 360;
    jd += diff / 0.98565;
    if (Math.abs(diff) < 1e-6) break;   // ≈0.1 秒
  }
  return jd;
}

const CYCLE = i => ({ s: i % 10, b: i % 12 });

/* 日柱：六十循环连续不断，儒略日正午取模。基准校验 —— 2000-01-01（JDN 2451545）为戊午。 */
function dayIndex(y, m, d) {
  return mod(Math.floor(jdOf(y, m, d, 12, 0)) + 49, 60);
}

function gzName(i) { const c = CYCLE(i); return STEMS[c.s] + BRANCHES[c.b]; }
function nayinOf(i) { return NAYIN[Math.floor(i / 2)]; }

/* 给黄历/择日用的两个小出口：任意六十甲子序号 → 干支名；地支序号 → 生肖。 */
export function cycleName(i) { return gzName(mod(i, 60)); }
export const ANIMALS = ZODIAC;

/* 今日（或指定日）的日柱序号与五行，供运势推算用 */
export function dayOf(date) {
  const d = date || new Date();
  const i = dayIndex(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return { index: i, gz: gzName(i), elem: STEM_ELEM[CYCLE(i).s], branch: BRANCHES[CYCLE(i).b] };
}

/* 出生四柱。h 是钟表小时 0~23（取该小时中点与节气交点比较）；传 null 表示时辰未知，
 * 此时只排三柱 —— 不编造时柱，五行计数也只按三柱算，免得「不确定」被算成确定。 */
export function fourPillars(y, m, d, h) {
  const known = h != null;
  const jd = wallJD(y, m, d, known ? h : 12, 30);
  let gy = y;
  if (jd < termJD(y, 2)) gy = y - 1;              // 立春之前归上一干支年
  const yIdx = mod(gy - 4, 60);

  const jieJD = JIE.map(k => termJD(gy + (k === 0 ? 1 : 0), k));
  let jie = 0;                                    // 已过的是本干支年第几个「节」
  for (let i = 0; i < 12; i++) {
    if (jd >= jieJD[i]) jie = i;
    else break;                                   // 节气在干支年内单调推进，断开即可停
  }
  const monthStem = mod(((yIdx % 10) % 5) * 2 + 2 + jie, 10);       // 五虎遁：甲己之年丙作首
  const monthBranch = mod(2 + jie, 12);
  const dIdx = dayIndex(y, m, d);
  const hb = Math.floor(mod(h + 1, 24) / 2);
  const hourStem = mod((dIdx % 10) % 5 * 2 + hb, 10);               // 五鼠遁：甲己还加甲

  const list = [
    { key: '年', label: '年柱', s: yIdx % 10, b: yIdx % 12 },
    { key: '月', label: '月柱', s: monthStem, b: monthBranch },
    { key: '日', label: '日柱', s: dIdx % 10, b: dIdx % 12 }
  ];
  if (known) list.push({ key: '时', label: '时柱', s: hourStem, b: hb });
  const cells = list.map(p => {
    const e = STEM_ELEM[p.s];
    return Object.assign(p, {
      gz: STEMS[p.s] + BRANCHES[p.b], elem: e, branchElem: BRANCH_ELEM[p.b],
      nayin: nayinOf(jiaziIndex(p.s, p.b))
    });
  });

  const counts = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
  cells.forEach(p => { counts[p.elem]++; counts[p.branchElem]++; });

  return {
    gzYear: gy, pillars: cells, zodiac: ZODIAC[yIdx % 12], known,
    dayMaster: STEM_ELEM[cells[2].s], nayin: cells[2].nayin,
    counts, counted: cells.length * 2,
    nextJie: nextJie(jd, gy)
  };
}

/* 六十甲子里由天干地支组合出的序号：六十循环中每对 (s,b) 唯一，且必同奇偶 */
function jiaziIndex(s, b) {
  for (let i = 0; i < 60; i++) if (i % 10 === s && i % 12 === b) return i;
  return 0;
}

/* 出生之后最近的「节」。排盘离节气越近，流派与时区差异越可能翻转月柱，
 * 所以把交节时刻一起显示出来，让用户自己核，而不是替他假装绝对正确。 */
function nextJie(jd, gy) {
  for (let i = 0; i < 12; i++) {
    const k = JIE[i];
    const t = termJD(gy + (k === 0 ? 1 : 0), k);
    if (t > jd) return { name: TERM_NAMES[k], at: jdToLocal(t) };
  }
  return { name: '立春', at: jdToLocal(termJD(gy + 1, 2)) };
}

/* 下一个「节气」（24 个，中气也算）——黄历要的是「距秋分还有 3 天」这类提示，
 * 而 nextJie 只遍历 12 个节，用不了。起点取**当天零点**：取正午会把当天上午的交节
 * 判成已过去（实测 2026-09-23 08:09 秋分，正午起算就漏成「距寒露」）。
 * days 是日历日差，0 表示今天交节。 */
export function nextTerm(date) {
  const d = date || new Date();
  const jd0 = wallJD(d.getFullYear(), d.getMonth() + 1, d.getDate(), 0, 0);
  for (let y = d.getFullYear(); y <= d.getFullYear() + 2; y++) {
    for (let k = 0; k < 24; k++) {
      const t = termJD(y, k);
      if (t >= jd0) return { name: TERM_NAMES[k], at: jdToLocal(t), days: Math.floor(t - jd0) };
    }
  }
  return null;
}

function jdToLocal(jd) {
  const dt = new Date((jd - 2440587.5) * 864e5);
  const p = n => String(n).padStart(2, '0');
  return (dt.getMonth() + 1) + '月' + dt.getDate() + '日 ' + p(dt.getHours()) + ':' + p(dt.getMinutes());
}

/* ---------- 五行生克（十神的大类，不细分阴阳正偏） ---------- */
const GEN = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };   // 我生
const OVR = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };   // 我克

/* a = 日主五行，b = 今日日柱五行。返回关系与传统叫法。 */
export function relation(a, b) {
  if (a === b) return { rel: '比和', ten: '比肩', score: 3, note: '同气相扶，宜守成、合伙、会友' };
  if (GEN[a] === b) return { rel: '我生', ten: '食伤', score: 4, note: '才华外泄之象，宜表达、创作、教学' };
  if (GEN[b] === a) return { rel: '生我', ten: '印绶', score: 5, note: '得庇护之象，宜学习、请示、依靠长辈' };
  if (OVR[a] === b) return { rel: '我克', ten: '财', score: 4, note: '我所能驾驭者，宜理财、谈判、落实' };
  return { rel: '克我', ten: '官杀', score: 2, note: '受制之日，宜守规矩、避冲突、慎承诺' };
}
