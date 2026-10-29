/* 变异表的汇总口：按族各归一份，这里只管拼接与形状。
 * 加一处变异去**归属那一族**的文件里加，不要加在这一份上（这一份只有 import 与清单，
 * 两条改动线都往这里插才真的会撞）；新增一族才回来加一行 import + 一行清单。
 * 形状自查是给「少写一个逗号 / 少写一个字段」兜底的：这些错在跑批里表现为「这条没轮到跑」，
 * 看起来像绿，所以宁可在开局就抛。 */
import providers from './providers.mjs';
import geoAir from './geo-air.mjs';
import view from './view.mjs';
import settings from './settings.mjs';
import controller from './controller.mjs';
import visuals from './visuals.mjs';
import lib from './lib.mjs';

const MUT = [...providers, ...geoAir, ...view, ...settings, ...controller, ...visuals, ...lib];

const 缺件 = MUT.filter(m => !m.name || !m.file || m.from === undefined || m.to === undefined || !m.expect);
if (缺件.length) throw new Error('变异表里有 ' + 缺件.length + ' 条缺字段（name/file/from/to/expect 都得写）：' +
  缺件.map(m => m.name || m.file || '(说不清是哪条)').join(' / '));
const 重名 = MUT.map(m => m.name).filter((n, i, a) => a.indexOf(n) !== i);
if (重名.length) throw new Error('变异表里有重名（跑批日志分不出是谁）：' + [...new Set(重名)].join(' / '));

export default MUT;
