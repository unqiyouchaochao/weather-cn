/* 推之前扫一遍「这次会让远端第一次见到的那些提交」。
 *
 * 为什么要有它：2026-11-05 把开发线推出去之前，敏感内容不是扫 HEAD 扫出来的 —— HEAD 干净得多，
 * 真正带着旧账本的是**历史里的旧对象**（六条路径虽已从树上删掉，blob 还挂在祖先提交上），
 * 而本地还留着几条从没推过的旧线（main / 归档在 refs/legacy 下那两条）。一次 `push --all`
 * 或一次顺手 `push main:xxx` 就会把刚拔掉的东西原样发回公网。闸门不靠人记得，靠它自己拦。
 *
 * 用法：
 *   node tools/push-guard.mjs                      # 扫「本地所有 ref 相对远端还没有的那些提交」
 *   node tools/push-guard.mjs --hook               # 当 pre-push 钩子用（stdin 收 ref sha 四元组）
 *   node tools/push-guard.mjs --install            # 把自己装进 .git/hooks/pre-push
 *   node tools/push-guard.mjs <rev-list 参数…>     # 手动指定要扫的范围，如 main 或 HEAD..某sha
 * 退出码：0 = 干净；1 = 拦下（逐条列出为什么）；2 = 自己没跑起来（git 问不到东西）。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const 已拔除路径 = [
  'docs/开发账本.md', 'weather-app/README.md',
  'tests/fixtures/moji-cities-guangdong.html', 'tests/fixtures/moji-city.html',
  'tests/fixtures/moji-p404.html', 'tests/fixtures/moji-provinces.html',
];
/* 这些规则里的字符类不是笔误：写成完整字面量，这条闸第一次跑就抓到它自己（真发生过一次 ——
 * `git push` 被自己拦住，报的就是「设备编号在文件内容里：tools/push-guard.mjs」）。
 * 手法与 `oss-guard` 那条 `/Admini[s]trator/` 一致，也不能整条排除本文件，否则它对外包一句话
 * 写着同样的串就漏掉了。 */
const 字面 = [
  ['家目录', /C:\\+Users\\+Admini[s]trator/i], ['本机工程目录', /D:\\+a[i] cunfang/i],
  ['设备编号', /6ca[2]3daa|YPL0[2]23B30002073/], ['真实门牌', /[朝]瞰路|七[里]河区/],
  ['令牌', /ghp_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|gho_[A-Za-z0-9]{16,}/],
  ['私钥', /BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY/],
];
const 身份白名单 = ['weather@local', '265463977+unqiyouchaochao@users.noreply.github.com'];
const g = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }); } catch (e) { return null; } };
const 问 = (...a) => { const s = g(...a); if (s === null) { console.error('问不到 git：' + a.join(' ')); process.exit(2); } return s; };

/** 一个范围 → 这一批要新出现在远端的提交里有什么不该在的东西 */
function 扫范围(参数, 标签) {
  const 出 = [];
  const 笔 = 问('rev-list', ...参数).trim().split('\n').filter(Boolean);
  if (!笔.length) return 出;
  const 清单 = 问('log', '--pretty=format:', '--name-only', ...参数).split('\n').map(s => s.trim()).filter(Boolean);
  for (const p of 已拔除路径) if (清单.includes(p)) 出.push(`【已拔除的本地记录又回来了】${p} —— ${标签} 的 ${笔.length} 笔里有它`);
  const 信息 = 问('log', '--pretty=format:%B%x00', ...参数).split('\0');
  for (const [名, 尺] of 字面) {
    const 中 = 信息.findIndex(m => 尺.test(m));
    if (中 >= 0) 出.push(`【${名}】在提交信息里：${问('rev-parse', '--short', 笔[中]).trim()} ——「${(信息[中].match(尺) || [''])[0].slice(0, 48)}」`);
  }
  const 对象 = 问('rev-list', '--objects', ...参数);
  const 判 = execFileSync('git', ['cat-file', '--batch-check=%(objecttype) %(objectname) %(objectsize) %(rest)'],
    { cwd: ROOT, input: 对象, encoding: 'utf8', maxBuffer: 1 << 28 });
  const 是 = new Map();
  const 单 = [];
  for (const 行 of 判.split('\n')) {
    const m = /^blob (\w{40}) (\d+) (.+)$/.exec(行);
    if (!m) continue;
    const [, sha, 大, path] = m;
    是.set(sha, path); 单.push(sha);
    if (Number(大) > 4 * 1024 * 1024) 出.push(`【四兆以上的文件】${path}（${(Number(大) / 1048576).toFixed(1)}MB）`);
  }
  /* 一次 cat-file --batch 把所有 blob 内容拿回来：逐条 spawn 在整条旧线上要几千次，闸门就会变成负担 */
  const 流 = 单.length ? execFileSync('git', ['cat-file', '--batch'],
    { cwd: ROOT, input: 单.join('\n') + '\n', maxBuffer: 1 << 28 }) : Buffer.alloc(0);
  let 偏 = 0;
  while (偏 < 流.length) {
    const 换 = 流.indexOf(0x0a, 偏); if (换 < 0) break;
    const 头 = 流.subarray(偏, 换).toString('utf8');
    const m = /^(\w{40}) blob (\d+)$/.exec(头);
    if (!m) { 偏 = 换 + 1; continue; }                    // 缺失对象只报一行 sha
    const 长 = Number(m[2]);
    const s = 流.subarray(换 + 1, 换 + 1 + 长).toString('utf8');
    偏 = 换 + 1 + 长 + 1;
    const path = 是.get(m[1]) || m[1];
    for (const [名, 尺] of 字面) if (尺.test(s)) 出.push(`【${名}】在文件内容里：${path} ——「${(s.match(尺) || [''])[0].slice(0, 48)}」`);
  }
  const 身份 = new Set(问('log', '--pretty=format:%ae%x1f%ce', ...参数).split('\n').flatMap(l => l.split('\u001f')));
  const 野 = [...身份].filter(x => x && !身份白名单.includes(x));
  if (野.length) 出.push(`【提交身份不在白名单】${野.slice(0, 4).join(' / ')}`);
  return 出.map(x => x + `（${标签}）`);
}

const 参数 = process.argv.slice(2);
if (参数[0] === '--install') {
  const 钩 = (() => { const s = 问('rev-parse', '--git-common-dir').trim(); return s.includes(':') ? s : join(ROOT, s); })();
  const 目 = join(钩, 'hooks', 'pre-push');
  writeFileSync(目, '#!/bin/sh\n# 推之前扫一遍这次会让远端第一次见到的提交；判据与来历见 tools/push-guard.mjs 的注释。\nexec node tools/push-guard.mjs --hook\n', { mode: 0o755 });
  try { chmodSync(目, 0o755); } catch {}
  console.log('已装到 ' + 目 + '（这条不入库，换克隆要再跑一次本命令）');
  process.exit(0);
}

let 批 = [];
if (参数[0] === '--hook') {
  const 入 = readFileSync(0, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  for (const 行 of 入) {
    const [lr, ls, rr, rs] = 行.split(' ');
    if (!ls || /^0+$/.test(ls)) continue;                        // 删除操作，没东西要扫
    /* 远端还没有这个 ref ⇒ 从它可达的提交全扫；已有 ⇒ 只扫新增的那一段 */
    批.push(/^0+$/.test(rs || '') ? [ls] : [`${rs}..${ls}`]);
    批[批.length - 1].标签 = `${lr} → ${rr}`;
  }
} else if (参数.length) {
  批 = [参数]; 批[0].标签 = 参数.join(' ');
} else {
  const 远端 = 问('remote').trim().split(/\r?\n/)[0] || 'origin';
  for (const 本 of 问('for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads').trim().split('\n').filter(Boolean)) {
    const [名, sha] = 本.split(' ');
    const 对 = 问('rev-parse', '--verify', '--quiet', `refs/remotes/${远端}/${名.replace('refs/heads/', '')}`).trim();
    批.push(对 ? [`${对}..${sha}`] : [sha]);
    批[批.length - 1].标签 = 名;
  }
}
const 报 = [];
for (const b of 批) 报.push(...扫范围(b, b.标签 || '指定范围'));
if (报.length) { console.error('push-guard 拦下这次推送：\n  ' + [...new Set(报)].join('\n  ') + '\n真要看过去的那几条旧线，用 refs/legacy/ 下的归档名，别推 refs/heads。'); process.exit(1); }
console.log('push-guard：' + 批.length + ' 个待推 ref，扫过 —— 没有已拔除的本地记录、个人字面、令牌私钥或白名单外的提交身份');
