/* 开源分区闸：把「个人版的东西不许进公开仓库」这句话变成会红的东西。
 *
 * 为什么要有这一条：这仓库的分区此前全靠 `.gitignore` + 人记得。`.gitignore` 挡得住
 * `git add .`，挡不住「已经跟踪过的文件里写着本机路径」，也挡不住某天有人把一张角色图
 * 放进 web 根（应用网页侧零图片资源，图标全是内联 SVG —— 位图一进 `weather-app/`
 * 就会被 cap sync 打进 APK）。2026-10-12 那轮清理就是靠手跑这几条 grep 才查出问题的，
 * 手跑的闸门等于没有闸门。
 *
 * 用法：node tools/oss-guard.mjs        退出码 = 违规条数
 *
 * 注意：这条在**内部线**上是会红的（`.workbuddy/memory/` 里记着本机 keystore 路径），
 * 那是预期行为 —— 它红就是在说「这条线不能直接公开」。公开线（oss-public）不含那个目录。 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 路径规则：命中即违规，第二条是给人看的原因 */
const 禁路径 = [
  [/^private\//, '个人版素材与产物'],
  [/^\.workbuddy[/\\]/, '内部记忆（记着本机 keystore 路径这类东西）—— 内部线跟踪它，公开线一个文件都不许有'],
  [/seed-plugins[/\\]/, '安装包自带主题包（个人版构建时才存在）'],
  [/^weather-app[/\\]img[/\\]/, '个人版注入的图片'],
  [/21-tianyi-character\.css$/, '个人版注入的样式片'],
  [/\.themepkg\.json$/, '主题插件包（带立绘的那些属个人版，仓库只收格式与验收工具）'],
  [/^theme-tianyi[/\\]/, '天依还是内置主题时期的草稿'],
  [/^tools[/\\](build-personal|gen-tianyi-pkg)\.mjs$/, '个人版构建脚本（读 private/、往 assets 里塞包）'],
];

/** web 根不许有位图：应用网页侧的图片一律内联 SVG，位图进来就是个人版素材混进打包链路 */
const 位图 = /\.(png|jpe?g|webp|gif)$/i;

/** 内容规则：只在文本文件里查，命中给出行号 */
const 禁内容 = [
  [/C:\\Users\\/i, '本机用户目录绝对路径'],
  [/D:\\ai /i, '本机工程绝对路径'],
  [/D:\\qder/i, '本机备份位置'],
  [/Admini[s]trator/i, '本机账户名'],        // 那个字符类不是笔误：写成字面量这条闸会抓到它自己
  [/(api[_-]?key|token|secret|password|appid)["']?\s*[:=]\s*["'][A-Za-z0-9_+\-]{12,}/i, '疑似写死的密钥'],
];

const 文本扩展 = new Set(['.md', '.mjs', '.js', '.json', '.html', '.css', '.xml', '.svg',
  '.webmanifest', '.txt', '.yml', '.yaml', '.java', '.gradle', '.properties', '.bat',
  '.gitignore', '.gitattributes', '.py', '.cjs']);

const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter(Boolean);

const 账 = [];
const 记 = (f, 由, 行) => 账.push(`${f}${行 ? ':' + 行 : ''}  ${由}`);

for (const f of files) {
  for (const [re, 由] of 禁路径) if (re.test(f)) { 记(f, `不该被跟踪：${由}`); break; }
  if (/^weather-app[/\\]/.test(f) && 位图.test(f)) 记(f, 'web 根里不许有位图（图标请内联 SVG）');

  if (!文本扩展.has(path.extname(f).toLowerCase()) && !/^\.(gitignore|gitattributes)$/.test(path.basename(f))) continue;
  let body;
  try { body = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
  if (body.includes('\0')) continue;                       // 二进制伪装成文本
  const lines = body.split(/\r?\n/);
  for (const [re, 由] of 禁内容) {
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) { 记(f, `内容里有${由}`, i + 1); break; }
    }
  }
}

if (!账.length) {
  console.log(`干净：${files.length} 个被跟踪文件里没有个人版素材、本机路径，也没有写死的密钥`);
  process.exit(0);
}
for (const 条 of 账) console.log('✗ ' + 条);
console.log(`\n共 ${账.length} 条违规。修法：素材移出仓库（个人版走 private/ + tools/build-personal.mjs 那条通道）；` +
  `本机路径改写成相对路径或说明「在本机某处」；密钥改成本机输入项。`);
process.exit(Math.min(账.length, 90));
