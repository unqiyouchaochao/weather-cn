#!/usr/bin/env node
/* 从一个量过的最小例子起一个新主题包。
 * 用法：node .qoder/skills/theme-plugin-dev/scripts/scaffold.mjs <id> [显示名] [--out <目录>]
 *
 * 为什么要这个脚本而不是让 agent 照着文档手抄：那份底就一段 30 行的 JSON，手抄会漏令牌
 * （本轮实测漏过 --ok-bg / --err-bg —— 缺了它「面板」那一族底就少量两块，而读数照样是绿的）。
 * 这里不复制判据、也不复制内容：**直接从 主题插件开发范式.md §0 那个 ```json 块里刮**，
 * 所以文档改了起盘点跟着改，不会出现第二份底。
 *
 * 只写一个新文件，不碰别的。 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/* 找仓库根：先从当前工作目录往上找，再退回从脚本自己往上找。
 * 两段都要是因为技能可能装在用户级（那时从脚本往上走找不到这个仓库），
 * 而 agent 一定是在项目根里调用它的。认根的条件：看得见范式文档与离线闸。 */
function 找根(from) {
  let 当前 = from;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(当前, '主题插件开发范式.md')) && fs.existsSync(path.join(当前, 'tools', 'theme-pkg-check.mjs'))) return 当前;
    const 上 = path.dirname(当前);
    if (上 === 当前) break;
    当前 = 上;
  }
  return null;
}
const 根 = 找根(process.cwd()) || 找根(path.resolve(import.meta.dirname));
if (!根) { console.log('✗ 没找到仓库根（要看得到 主题插件开发范式.md 与 tools/theme-pkg-check.mjs）。在项目里跑，或把技能装进那个仓库。'); process.exit(2); }

const 参数 = process.argv.slice(2);
const id = 参数.find(a => !a.startsWith('--'));
const 名位 = 参数.indexOf(id);
const 显示名 = 参数[名位 + 1] && !参数[名位 + 1].startsWith('--') ? 参数[名位 + 1] : null;
const 出位 = 参数.indexOf('--out');
const 出 = (参数.find(a => a.startsWith('--out=')) || '').split('=')[1]
  || (出位 >= 0 ? 参数[出位 + 1] : '') || 根;
if (!id) { console.log('用法：node scaffold.mjs <id> [显示名] [--out=<目录>]'); process.exit(2); }
if (!/^[a-z][a-z0-9_-]{1,31}$/.test(id)) {
  console.log('✗ id 不合规：' + id + '（要 /^[a-z][a-z0-9_-]{1,31}$/：小写字母开头，只允许小写字母、数字、下划线、连字符）');
  process.exit(2);
}

const 文档 = fs.readFileSync(path.join(根, '主题插件开发范式.md'), 'utf8');
const 起 = 文档.indexOf('```json\n');
const 止 = 起 < 0 ? -1 : 文档.indexOf('\n```', 起);
if (止 < 0) { console.log('✗ 范式文档 §0 里那个 ```json 块没找到 —— 底变了，先修脚本别硬写。'); process.exit(3); }
let 底;
try { 底 = JSON.parse(文档.slice(起 + '```json\n'.length, 止)); }
catch (e) { console.log('✗ §0 那份底不是合法 JSON：' + e.message); process.exit(3); }

const 目标 = path.join(path.resolve(出), id + '.themepkg.json');
if (fs.existsSync(目标)) { console.log('✗ 已经存在，不覆盖：' + 目标); process.exit(4); }
底.id = id;
底.label = 显示名 || id;
fs.mkdirSync(path.dirname(目标), { recursive: true });
fs.writeFileSync(目标, JSON.stringify(底, null, 2) + '\n');
console.log('✓ 起盘完成：' + path.relative(process.cwd(), 目标).replace(/\\/g, '/'));
console.log('  令牌 ' + Object.keys(底.tokens).length + ' 个 · glass ' + JSON.stringify(底.glass) + ' · 没有 css / assets / lace（按 §9 的顺序往上加，每加一处重量一次）');

const 闸 = spawnSync(process.execPath, [path.join(根, 'tools', 'theme-pkg-check.mjs'), 目标], { cwd: 根, encoding: 'utf8' });
console.log('\n' + (闸.stdout || '').trim().split('\n').filter(l => !/^\s*$/.test(l)).join('\n'));
console.log('\n下一步：改 w 的六条渐变和 tokens 的色，然后重量 —— node tools/theme-pkg-check.mjs '
  + path.relative(process.cwd(), 目标).replace(/\\/g, '/'));
process.exit(闸.status === 0 ? 0 : 1);
