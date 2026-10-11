---
name: theme-plugin-dev
description: 开发、验收、装机核对天气助手的主题插件包（*.themepkg.json）。当用户要新建或修改一套主题、问导入为什么被拒、要查文字对比度/AA 是否达标、要加装饰层或立绘、或要把「改 JSON → 跑验收 → 装进真页面 → 出图」做成自动闭环时使用。本技能只指挥现成的 CLI 与判据，不自己算。
---

# 主题插件开发（天气助手）

## Overview

一个主题 = 一个 JSON 包，里面没有代码。三道关：**形状**（能不能被 App 接受）、**算术**（文字对比度达不达标）、
**观感**（好不好看、有没有被裁）。前两道有命令行，第三道只有图。

所有命令都在**仓库根**跑（工具用相对路径 import 了 `weather-app/js/lib/` 里的判据）。
认根：同时看得见 `主题插件开发范式.md` 与 `tools/theme-pkg-check.mjs` 的那个目录。

## 判据只有一份，别造第三把尺子

- 形状：`weather-app/js/lib/themePlugin.js` 的 `validate()`
- 对比度：`weather-app/js/lib/themeScan.js` 的 `worstContrast()`（达标线 = AA 4.5 + 0.5 余量 = **5.0**）
- 两个 CLI 只是外壳。**不要**自己另算对比度、不要用肉眼判、不要把判据或阈值复制进任何脚本、注释或本文档。
- 想改判据（AA 线、四族底的取法）→ 只改 `themeScan.js`，然后跑 `node tests/theme-pkg.test.mjs` 与
  `node tools/theme-glass-scan.mjs`。

## 标准流程

```bash
# 1 起盘：从范式文档 §0 那份量过的最小例子刮一份底（不手抄，见下方说明）
node .qoder/skills/theme-plugin-dev/scripts/scaffold.mjs <id> "显示名"
# ↑ 脚本在本技能目录下的 scripts/ 里；技能若装到用户级，把这段路径换成它实际所在位置即可，
#   脚本自己会往上找到仓库根，不依赖被从哪儿调用。

# 2 改配色，重量，直到退出码 0
node tools/theme-pkg-check.mjs <id>.themepkg.json
node tools/theme-pkg-check.mjs <id>.themepkg.json --explain   # 最差那一格是怎么叠出来的
node tools/theme-pkg-check.mjs <id>.themepkg.json --fix       # 允许范围内的候选（只打印，不落盘）

# 3 装进真页面：真实 change 事件导入 + 真实点击切主题 + 出图
node tools/theme-agent-loop.mjs <id>.themepkg.json

# 4 看图（路径就在上一行输出里）；交付前补一次真机
node tools/theme-agent-loop.mjs <id>.themepkg.json --channel=device
```

起盘脚本存在的理由：那份底 30 多行、18 个令牌，**手抄会漏**。本轮实测漏过 `--ok-bg` / `--err-bg` ——
缺了它「面板」那一族底就少量两块，而读数照样是绿的。脚本直接从文档里刮，所以文档改了底跟着改，
不会出现第二份底。它起完会立刻跑一次离线闸，绿了才算交出来。

## 退出码 → 动作

| 码 | 出自 | 下一步 |
|---|---|---|
| `0` | 两者 | 继续（pkg-check 的 0 只代表算术，仍要走 loop） |
| `1..80` | 两者 | 差几条错误就是几条，逐条改；`--fix` 给算术候选 |
| `84` | pkg-check | **量出 0 条底 —— 不是合格**，是判据什么都没看到 |
| `85` | pkg-check | `--fix` 在允许范围内无解：要动的是设计（换底 / 改深字色本身），别再迭代参数 |
| `201` `202` `208` | loop | 设备没插 / 起不来 / 锁屏 —— 这些要人，别重试 |
| `203` | loop | release 包不开调试套接字，device 通道只能配 debug 包 |
| **`206`** | loop | **两把尺子漂移**：App 拒了而离线闸放行。立刻停手，见红线 2 |
| `207` | loop | 装上了切不过去：多半是保存被别的分组校验挡了 |
| `209` | loop | 无头通道没起来，输出里带「现场」，按它查 |

## 三条红线

1. **不许绕过闸。** loop 走的是 `#pluginFile` 的真实 change 事件和 `#saveBtn` 的真实 click。
   手工往 IndexedDB 塞记录、或直接改 `cfg.theme` —— 测的就不是用户那条路，结论作废。
2. **见 `206` 立刻停手。** 那不是主题的问题，是判据漂移。先 `node tests/theme-pkg.test.mjs`（应全绿 7 条），
   再查两边是否还共享同一个 `validate`。
3. **绿 ≠ 好。** `--fix` 的候选只证明算术过线；顶到 `mix` 上限的候选会被明说「等于把两级文字压成一级」，
   那不算建议成功。观感必须看图，交付必须过一次 device。

## 本仓库实测过的坑

- **起盘那份只给 18 个令牌**（够过闸，四族底都量得到），而范式文档 §9 第 2 步要的是 §3 那 31 个全给 ——
  少给的那些不会报错，会落回上一套主题的取值，于是出现「一半新一半旧」的接缝。配色定稿前补齐。
- **越缺越绿**：包里不给 `--veil`，「弹窗」那一族底整支不被量，读数反而变好。所以
  `【判据没量到的地方】` 那段警告优先级高于读数本身，照它补令牌再重量。
- **子面板不吃 `glass.a`**：`--hint-bg/--code-bg/--field-bg/--ok-bg/--err-bg` 那五块与卡面透明度无关；
  `glass.mix` 只作用于 `--muted`，`pop`/`accent` 根本吃不到。loop 与 pkg-check 都会先说哪条轴无效。
- `w` 六条渐变一条都不能缺，端点必须写成十六进制（`oklch()` / `color-mix()` 判据读不了）。
- CSS 每条选择器都要含 `[data-theme="你的id"]`，`@media` 里面的规则同样要锁；`@keyframes` 名字必须含 id。
- `url()` 只认 `assets/<包内声明过的名字>` 和 `data:`，远程一律拒。
- **大面积装饰判据看不见**：`lace`、`body::before` 那种整屏层只有 loop 出的图能判。
  装饰层的动画只许动 `opacity`（合成器），把 `background-position` 写进 keyframes 会整条动画掉到主线程。
- 改了运行时资源（`weather-app/` 下的 js / css）要升 `weather-app/sw.js` 的 `CACHE`，
  然后 `node tools/shell-check.mjs` 到「干净」。

## 什么时候必须停下来找人

- 要真机画面：设备锁屏、release 包、性能掉帧、动画中间态 —— 无头通道不覆盖这三样。
- 要改判据本身，或要改 `tests/theme-pkg.test.mjs` 钉住的那六道闸。
- 包里的素材涉及版权角色或他人作品：那是另一套分区规矩，不进开源仓库（看仓库根 `.gitignore` 与 `private/`）。

## Resources

- `scripts/scaffold.mjs` —— 起盘一份量过的底并立刻跑离线闸。`node scripts/scaffold.mjs <id> [显示名] [--out=<目录>]`，
  默认落在仓库根（那是工作文件，没被 gitignore，别忘了处理掉或放 `--out` 到别处）。
- 深文档留在仓库里，按需读，别整篇搬进上下文：
  `主题插件开发范式.md`（格式与约束）、`tools/theme-pkg-check.md`（离线闸手册）、
  `tools/theme-agent-loop.md`（闭环与两条通道）。
