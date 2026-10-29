/* 星座边界 + 每日运势推算（本地确定性生成，不碰 DOM、不打接口）。
 *
 * 为什么是本地生成而不是接星座接口：实测 api.vvhan.com 无响应、api.oick.cn 404、
 * api.oioweb.cn 不给 Access-Control-Allow-Origin —— 详见 lib/ganzhi.js 顶部注释。
 * 本地推算的好处很实在：离线可用、零密钥、当天结果固定（换设备/重开都一样），
 * 而且这类文本本来就无高下之分，接来的也只是别人爬虫拼的句子。
 *
 * 确定性 = hash(命主标识 + 当日日期) 喂给一个 LCG，逐位取模。
 * 同一天同一人永远同一结果，跨天必然换一套，不会露「三年不变」的馅。
 *
 * 星座日期按热带黄道通用区间。交界当天（cusp）的精确归属要看当年交宫时刻，
 * 这里刻意不做 —— 娱乐向功能没必要假装有那个精度，界面上一句「民俗与娱乐参考」说清楚。
 */

const SIGNS = [
  { name: '白羊座', glyph: '♈', el: '火' }, { name: '金牛座', glyph: '♉', el: '土' },
  { name: '双子座', glyph: '♊', el: '风' }, { name: '巨蟹座', glyph: '♋', el: '水' },
  { name: '狮子座', glyph: '♌', el: '火' }, { name: '处女座', glyph: '♍', el: '土' },
  { name: '天秤座', glyph: '♎', el: '风' }, { name: '天蝎座', glyph: '♏', el: '水' },
  { name: '射手座', glyph: '♐', el: '火' }, { name: '摩羯座', glyph: '♑', el: '土' },
  { name: '水瓶座', glyph: '♒', el: '风' }, { name: '双鱼座', glyph: '♓', el: '水' }
];

/* 每月起始日与对应星座：d >= 该月起始日 → 取该月星座，否则取上一个 */
const START = [[1, 20, 10], [2, 19, 11], [3, 21, 0], [4, 20, 1], [5, 21, 2], [6, 21, 3],
  [7, 23, 4], [8, 23, 5], [9, 23, 6], [10, 23, 7], [11, 22, 8], [12, 22, 9]];

export function signOf(m, d) {
  const cur = START[m - 1];
  return d >= cur[1] ? SIGNS[cur[2]] : SIGNS[(cur[2] + 11) % 12];
}

/* 文案库 —— 只放不含事实断言的通用建议，避免写出「本周会有贵人相助」这种容易当真的话 */
const COLORS = ['朱红', '暖橙', '明黄', '缃色', '黛绿', '青碧', '湖蓝', '靛紫', '胭脂', '素白', '玄黑', '棕褐'];
const DIRS = ['正东', '东南', '正南', '西南', '正西', '西北', '正北', '东北'];
const YI = ['早起十分钟', '把桌面收拾干净', '约久未见的人吃饭', '把拖着的那封邮件发出去', '读二十页纸质书',
  '自己下厨做一次', '散步三公里不看手机', '给家里打个电话', '把念头记下来', '整理这个月的账单',
  '当面说清一件误会', '早点睡'];
const JI = ['临时改主意', '干等别人回复', '熬夜', '冲动下单', '翻旧账', '在群里争辩',
  '空腹喝咖啡', '把话憋着', '过度解读一句回复', '承诺没想好的事', '跟人身体的较劲', '刷手机到很晚'];
const TIPS = ['慢一点没关系，方向比速度值钱。', '今天适合把复杂的事拆成三步。', '别急着表态，先听完整句。',
  '把最不想碰的那件事放在开头，后面会顺。', '对人直接一点，绕弯今天不灵。', '省下的力气留给晚上。',
  '有件小事拖了很久，今天动一下就好。', '少看别人的进度条。', '该问就问，猜的答案通常更糟。',
  '把手机放远一些，效率会吓你一跳。', '今天适合收尾，不太适合开新坑。', '答应之前先数一下自己手里有几件事。'];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* mulberry32：同一个种子必然给出同一串序列（这就是「当天固定」的全部机制）。
 * 一开始用的是教科书式 LCG（乘数 1103515245），实测四项星级全变成 5 星 —— 因为那个乘数
 * 能被 5 整除，`s % 5` 从第二次起就锁死在同一个余数上。**任何小模数整除乘数都会这样**，
 * 而星级恰好就是 mod 5。mulberry32 靠异或混淆，对任意 n 都没有这种退化。 */
function stream(seed) {
  let s = seed >>> 0;
  return n => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
}

/**
 * 生成当日运势。
 * @param {string} key    命主标识（八字用四柱串，星座用星座名）
 * @param {string} todayISO  YYYY-MM-DD，跨天即换一套
 * @param {number} bias     -1..+1 的偏移，八字用它把「今日五行生克」揉进星级
 */
export function dailyFortune(key, todayISO, bias) {
  const r = stream(hash(key + '|' + todayISO));
  const b = Math.max(-2, Math.min(2, bias || 0));
  const star = () => Math.max(1, Math.min(5, 1 + r(5) + (r(2) ? b : 0)));
  const aspects = [
    { label: '综合', n: star() }, { label: '情感', n: star() },
    { label: '事业', n: star() }, { label: '财运', n: star() }
  ];
  const score = aspects.reduce((s, a) => s + a.n, 0);
  return {
    aspects,
    level: score >= 17 ? '大吉' : score >= 13 ? '顺' : score >= 9 ? '平' : '需要耐心',
    color: COLORS[r(COLORS.length)],
    number: 1 + r(29),
    direction: DIRS[r(DIRS.length)],
    yi: YI[r(YI.length)],
    ji: JI[r(JI.length)],
    tip: TIPS[r(TIPS.length)]
  };
}

/* 今天的 YYYY-MM-DD（按本地日期，不用 toISOString，否则会按 UTC 差八小时） */
export function localISO(d) {
  const x = d || new Date();
  const p = n => String(n).padStart(2, '0');
  return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate());
}
