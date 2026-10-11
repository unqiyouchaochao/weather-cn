/* 把 weather-app/sw.js 里的 SHELL 清单按磁盘上的文件重写一遍（清单的算法在 tools/shell-list.mjs）。
 * 为什么不再手写：清单是「每条新功能都必须改同一个文件」的第四处，而且漏一项的后果最阴 ——
 * 联网时什么都对，老用户离线打开才白屏（新文件从来没被缓存过）。2026-10-06 视图层与控制器层
 * 分片之后一次要手写 24 行，这个风险从「偶尔」变成「必然」。
 * 只重写 SHELL 那一段：`CACHE` 那个版本号照旧由人改（falsify 认「这棵树是哪一版」读的就是它，
 * 工具不替人改版本号），清单变了就打印一句提醒。
 * 用法：node tools/gen-shell.mjs        （npm run apk 的第一句就是它，出包前必然对齐）
 *       node tools/shell-check.mjs      （只查不改，秒级；CI 或收尾时用这个） */
import fs from 'node:fs';
import { APP, BEGIN, SW, shellList } from './shell-list.mjs';

const list = shellList();
const src = fs.readFileSync(SW, 'utf8');
const eol = src.includes('\r\n') ? '\r\n' : '\n';
const i = src.indexOf(BEGIN);
const j = i < 0 ? -1 : src.indexOf('];', i);
if (j < 0) throw new Error('sw.js 里找不到 SHELL 那对标记，形状变了，不敢改写：' + APP);
const body = list.map((p, k) => "  '" + p + "'" + (k === list.length - 1 ? '' : ',')).join(eol);
const 新 = BEGIN + eol + 'const SHELL = [' + eol + body + eol + '];';
const 旧 = src.slice(i, j + 2);
fs.writeFileSync(SW, src.slice(0, i) + 新 + src.slice(j + 2), 'utf8');
const 版 = (/CACHE = 'weather-studio-v(\d+)'/.exec(src) || [])[1];
console.log('SHELL 已生成：' + list.length + ' 项（v' + (版 || '?') + '）' + eol +
  (旧.replace(/\s+/g, '') === 新.replace(/\s+/g, '')
    ? '  清单没变。'
    : '  ⚠ 清单和上一版不一样 —— 按规矩要升一次 CACHE，否则老用户拿到的还是旧壳。'));
