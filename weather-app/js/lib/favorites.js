/* 收藏：键的编解码 + localStorage 读写。不含 DOM。
 * 键必须能带精确坐标：同名城市很多（「朝阳」有 5 个），只存名字会在二次解析时被地理编码取到另一个。
 * 格式：  名称@纬度,经度  /  纬度,经度  /  纯名称 */
import { loadConfig, saveConfig } from './config.js';

export function encodeKey(name, lat, lon) {
  if (lat != null && lon != null) return (name ? name : '') + '@' + lat + ',' + lon;
  return name || '';
}
export function decodeKey(k) {
  k = String(k == null ? '' : k);
  const at = k.indexOf('@');
  if (at >= 0) {
    const name = k.slice(0, at);
    const p = k.slice(at + 1).split(',').map(Number);
    if (p.length === 2 && !isNaN(p[0]) && !isNaN(p[1])) return { name, lat: p[0], lon: p[1] };
  }
  const m = k.match(/^\s*([-\d.]+)\s*,\s*([-\d.]+)\s*$/);
  if (m) return { name: '', lat: +m[1], lon: +m[2] };
  return { name: k, lat: null, lon: null };
}
export function keyLabel(k) {
  const d = decodeKey(k);
  // 这一串是**文字**标签（会进列表、也会进比较卡的标题），不是界面按钮，
  // 所以这里不塞 SVG，改成写「坐标」两个字 —— 比一枚 📍 更直说"这条是按经纬度存的"。
  if (d.lat != null && !d.name) return '坐标 ' + k;
  return d.name || k;
}

export function loadFav() { return loadConfig().favorites || []; }
export function saveFav(arr) { const c = loadConfig(); c.favorites = arr; saveConfig(c); }
export function isFav(k) { return k ? loadFav().indexOf(k) >= 0 : false; }
