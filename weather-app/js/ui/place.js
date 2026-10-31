/* 标题那一段：定位点后面补的当前地名（市/县/街道/路）。
 * 反向地理编码和天气接口谁先回来都可能，所以这一小段存在这里由 render 一起拼，
 * 而不是谁回来谁直接改 DOM —— 否则早到的那个会被晚到的覆盖掉。
 * 谁可以改我：改「标题怎么拼」的人。air.js 认这份清单里的「哪些算裸地名」，别另抄一份。 */
import { el } from '../lib/dom.js';
import { setPlaceTitle } from '../lib/notify.js';

/* placeBase 非空即表示当前标题就是定位点；切成搜出来的城市时自动作废。 */
let placeBase = '', placeTail = '';
/* 「我的位置」定到位后直接显示地名链（云浮市 · ××县 · ××镇 · ××路），不再挂前缀；
 * 「网络定位」要留着 —— 那是 IP 估的城市，标出来才不会让人以为应用把位置搞错了。 */
export const BARE_BASES = ['我的位置'];
function placeTitle(locName, tail) {
  if (!tail || locName !== placeBase) return locName;
  return BARE_BASES.indexOf(locName) >= 0 ? tail : locName + ' · ' + tail;
}
export function setPlace(base, tail) {
  placeBase = base || '';
  placeTail = tail || '';
  if (!placeBase) { setPlaceTitle(''); return; }
  setPlaceTitle(placeTitle(placeBase, placeTail));   // 通知栏跟着换（BARE_BASES 时就是纯地名链）
  if (placeBase) el.locName.textContent = placeTitle(placeBase, placeTail);
}
/** 主视图画标题之前先问一次：换了一座城，旧的定位点标题就作废（并给出这一次该画的字）。 */
export function adoptLocName(locName) {
  if (placeBase && locName !== placeBase) { placeBase = ''; placeTail = ''; }
  return placeTitle(locName || '—', placeTail);
}
