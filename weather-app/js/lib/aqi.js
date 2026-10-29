/* 空气质量口径换算：美标 US AQI ↔ 国标 HJ 633—2026。
 *
 * 为什么必须回到浓度重算：两条数据链给的数不是一个口径 —— 中国天气给的是国控站实测的
 * 国标 AQI（只有指数、没有浓度），Open-Meteo 给的是 CAMS 模型算的美标 us_aqi（带浓度）。
 * 同一坐标同日实测过 2.65~4.17 倍的差，所以「切换口径」不能靠乘系数糊弄。
 *
 * 断点表取自生态环境部官网 PDF（不是文档转载站）：
 *   HJ 633—2026 表3  http://www.mee.gov.cn/ywgz/fgbz/bz/bzwb/jcffbz/202602/W020260225366493492011.pdf
 *   HJ 633—2012 表1  https://www.mee.gov.cn/ywgz/fgbz/bz/bzwb/jcffbz/201203/W020250407406362045613.pdf
 * ⚠ HJ 633—2012 自 2026-03-01 起废止，现行的是 2026 版。两版只有两格不同：
 *   PM10 @IAQI100 由 150→120、PM2.5 @IAQI100 由 75→60。
 *   网上流传的表基本都是 2012 版，照抄会把 PM2.5 60~75 µg/m³ 这段从「轻度污染」误报成「良」。
 *
 * 换算只在「源给了浓度」时成立。源只给指数（中国天气就是这样）就跨不过去，
 * 此时保持原口径并把原因写在卡上，不做任何估算（宁缺勿错）。
 */

/* 表3 的 IAQI 轴，与各污染物浓度断点一一对应 */
const IAQI = [0, 50, 100, 150, 200, 300, 400, 500];

/* 实时口径取 1 小时断点；HJ 633—2026 §4.2.1 规定只有 1 小时值时颗粒物沿用 24h 断点。
 * 单位：µg/m³（CO 是 mg/m³，Open-Meteo 回的是 µg/m³，用前除以 1000）。 */
const BP = {
  pm2_5: [0, 35, 60, 115, 150, 250, 350, 500],
  pm10: [0, 50, 120, 250, 350, 420, 500, 600],
  o3_1h: [0, 160, 200, 300, 400, 800, 1000, 1200],
  no2_1h: [0, 100, 200, 700, 1200, 2340, 3090, 3840],
  so2_1h: [0, 150, 500, 650, 800],
  co_1h: [0, 5, 10, 35, 60, 90, 120, 150]
};

/* 线性插值。超出表内最高浓度断点时按 500 计 —— 国标指数本身封顶 500。 */
function iaqi(c, bp) {
  if (c == null || isNaN(c) || c < 0) return null;
  if (c > bp[bp.length - 1]) return 500;
  for (let i = 1; i < bp.length; i++) {
    if (c <= bp[i]) {
      return (IAQI[i] - IAQI[i - 1]) / (bp[i] - bp[i - 1]) * (c - bp[i - 1]) + IAQI[i - 1];
    }
  }
  return 500;
}

/**
 * 用 HJ 633—2026 从浓度算国标 AQI。
 * @param {object} cur Open-Meteo 风格的 current 对象（浓度单位 µg/m³）
 * @returns {null|{v:number, 首要:string}} 六项一个都没有时返回 null（不猜）
 */
export function cnAqi(cur) {
  if (!cur) return null;
  const so2 = cur.sulphur_dioxide;
  const items = [
    ['PM2.5', iaqi(cur.pm2_5, BP.pm2_5)],
    ['PM10', iaqi(cur.pm10, BP.pm10)],
    ['O₃', iaqi(cur.ozone, BP.o3_1h)],
    ['NO₂', iaqi(cur.nitrogen_dioxide, BP.no2_1h)],
    // 2026 版脚注：SO2 1 小时 >800 µg/m³ 不再外推，按 IAQI 200 计
    ['SO₂', so2 == null ? null : (so2 > 800 ? 200 : iaqi(so2, BP.so2_1h))],
    ['CO', cur.carbon_monoxide == null ? null : iaqi(cur.carbon_monoxide / 1000, BP.co_1h)]
  ].filter(p => p[1] != null);
  if (!items.length) return null;
  let top = items[0];
  for (const p of items) if (p[1] > top[1]) top = p;
  return { v: Math.ceil(top[1]), 首要: top[0] };   // §4.2.6：结果进位取整
}

export const AQI_STDS = [
  { id: 'auto', label: '跟随数据源（默认）' },
  { id: 'us', label: '美标 US AQI' },
  { id: 'cn', label: '国标 HJ 633—2026' }
];
export const STD_NAME = { us: '美标', cn: '国标' };

/**
 * 决定卡上到底显示哪个数，以及这个数是什么口径。
 * @param {object} cur   源的 current（可能带浓度，也可能只有 us_aqi 这一个槽位）
 * @param {string} std   用户选的口径：auto | us | cn
 * @param {?string} native 源给的那个指数本身是什么口径（provider.airStd；自定义源为 null）
 * @returns {{v:number|null, std:?string, note:string}} note 非空 = 切换没生效，必须显示出来
 */
export function pickAir(cur, std, native) {
  const raw = cur && cur.us_aqi != null ? Number(cur.us_aqi) : null;
  if (!std || std === 'auto') return { v: raw, std: native, note: '' };

  if (std === 'cn') {
    const cn = cnAqi(cur);
    if (cn) return { v: cn.v, std: 'cn', note: native === 'us' ? '由浓度按国标重算' : '' };
    if (native === 'cn') return { v: raw, std: 'cn', note: '源给的已是国标' };
    return { v: raw, std: native, note: '源未给浓度，无法换算国标' };
  }

  // std === 'us'
  if (native === 'us') return { v: raw, std: 'us', note: '' };
  if (native === 'cn') return { v: raw, std: 'cn', note: '站点实测只有国标，无浓度可换算美标' };
  return { v: raw, std: null, note: '源未标口径，按原值显示' };
}
