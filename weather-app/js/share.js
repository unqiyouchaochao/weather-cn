/* 对比视图的分享链接：把当前收藏写成 `#compare=…`，以及打开这种链接时直接进对比。
 * 归属判据：**只有它认得这个 hash 的形状**。键本身可能含逗号（名称@纬度,经度），所以用 | 分隔。 */
import { loadFav } from './lib/favorites.js';
import { compareCities } from './query.js';
import * as ui from './ui.js';

export function shareCompare() {
  const keys = loadFav();
  if (keys.length < 2) { ui.showStatus('至少收藏 2 个城市才能分享对比', true); return; }
  // 键本身可能含逗号（名称@纬度,经度），故用 | 分隔
  const url = location.origin + location.pathname + '#compare=' + encodeURIComponent(keys.join('|'));
  const fallback = () => window.prompt('复制此对比链接：', url);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => ui.showStatus('对比链接已复制，可分享给好友'), fallback);
  } else fallback();
}
export function parseHashCompare() {
  const m = location.hash.match(/compare=([^&]+)/);
  if (m) {
    const keys = decodeURIComponent(m[1]).split('|').map(s => s.trim()).filter(Boolean);
    if (keys.length >= 2) { compareCities(keys); return true; }
  }
  return false;
}
