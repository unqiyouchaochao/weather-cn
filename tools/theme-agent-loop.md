# `tools/theme-agent-loop.mjs` 使用说明

把「**装进真页面 → 听 App 自己怎么说 → 切上去 → 出一张图**」这条链串成一条命令。
它不替代 `theme-pkg-check.mjs`（那道离线闸仍然先跑、不过线就不碰页面），它管的是离线算不出的那一半：
App 装了包之后**自己**怎么判、令牌有没有真下发、这一套在手机上长什么样。

```bash
# 在项目根跑
node tools/theme-agent-loop.mjs 你的主题.themepkg.json
```

**它真正值钱的地方是漂移检测**：`theme-pkg-check` 与 App 里的导入走的是同一个 `themePlugin.validate`，
所以「离线说合格、App 说不合格」只可能是有一边被改坏了。这条链每天真跑一次，那种事就藏不住。
（下面「漂移那一格怎么确认它是红的」有实测做法。）

---

## 1. 两条通道

| | `--channel=headless`（默认） | `--channel=device` |
|---|---|---|
| 要不要手机 | **不要**，也不用有人解锁 | 要，adb 连着 |
| 浏览器 | 自己起一个无头 Edge（同 `tools/run-checks.mjs` 那套） | 真机 WebView，走 `webview_devtools_remote_<pid>` |
| 包怎么进去 | 直接给宿主路径 | `adb push` 到 `/data/local/tmp` |
| 可信范围 | 布局、配色、令牌下发、装饰取景、文字溢出 | 再加上真 GPU、真 MIUI、真视口、性能 |
| 什么时候用 | agent 自己跑闭环；改完配色先看一眼 | 交付前那一次核对 |

两条都**不绕过任何一道闸**：导入走 `#pluginFile` 那个真实 `change` 事件，切主题走 `#themeSel` + `#saveBtn`
的真实 click。绕过的话这轮验证就等于没做。

> 为什么不是应用内那个浏览器面板：它是 0×0 隐藏页、`visibilityState=hidden`、CSS 动画整体冻结，
> 在里面量出来的一切都不作数（范式.md §10）。无头 Edge 的页面按可见算，配 `--disable-*-throttling` 正常跑。

device 通道两条实测账（2026-10-10 在红米 mondrian 上踩的）：

- **它每次都真的 `am start`，不是只看 `pidof`**。HyperOS 在 `install -r` 之后会**留着进程而把 Activity 收掉** ——
  `pidof` 有值、进程状态 `S`，但 WebView 的调试套接字压根不存在，只看 pidof 就会卡在「/json 里没有 page」。
  `am start` 对已在前台的场合是幂等的，所以无条件来一发，并把「焦点在不在它身上」打进输出：
  不在前台时，截图那一格本来就该怀疑。
- **两条通道的模块路径差一段**：无头那条由本工具自己的服务吐文件，应用挂在 `/weather-app` 下；
  壳里 Capacitor 把 `webDir` 拷成站点根。所以页面内 `import()` 走各自的 `前缀`，写死任何一边都会在另一边炸。

## 2. 输出长这样

```
✓ 离线闸 —— 最低比 5.454 @ muted@弹窗/storm@#6d7a8d · 可导入
✓ 无头通道 —— about:blank · 411×914 dpr3（视口是 Emulation 出来的，不是真屏）
✓ 被测代码 —— 工作树 · CACHE weather-studio-v133
✓ 离线闸 ↔ App 一致性 —— 「示例主题」两边都说可导入
✓ 切主题 —— data-theme=demo · --card #ffffff · --veil rgba(20,28,40,.45) · 装饰 CSS 0 字节
✓ 截图 —— tests\shots\agent-demo-1791631085029.png · 447KB · 数据已落地
✓ 复原主题 —— 切回 mint
✓ 删掉这次导入的包 —— 环境恢复原样（要留着看加 --keep-theme）
✓ 全链路 —— 离线闸 → 真页面导入 → 切主题 → 出图 全过（通道：headless）
```

两行值得单独说：

- **`被测代码` 那一行的版本号是从页面里 `fetch` 出来的**，不是读仓库里的 `sw.js`。
  两条通道量的本来就不是同一份代码 —— 无头量**工作树**，device 量**装进壳里那一份**，
  所以「装没装上」这件事必须有硬证据，不能靠猜。
- **`数据已落地`**：按快门之前会等 `#result` 显出来（最多 15s）。壳里冷启动那一拍常常还压在
  骨架屏上，不等的话抓下来的图看着完整、其实一片灰块 —— 判令牌与装饰够用，判观感不够。
  等不到会照出，但那行明说「这张是骨架屏」。

跑完默认把环境放回原样：主题切回去、**这次新引进来**的包删掉。本来就在清单里的包不动 ——
那是使用者的东西，不是这条链的临时产物。加 `--keep-theme` 两样都留着（人要盯着看的时候用）。

`--json` 会在最后再打一行结构化结果（每阶段 `{名, ok, 明细}` + `截图` 路径），给脚本和 agent 吃。

## 3. 退出码

| 码 | 含义 |
|---|---|
| `0` | 全链路通过 |
| `1..80` | 离线闸就没过（条数，原样透传 `theme-pkg-check`，**不碰页面**） |
| `200` | 用法/参数错、读不出 JSON、找不到 adb |
| `201` | `--channel=device` 但没有在线设备（或同时好几台、没给 `--device=`） |
| `202` | 应用装了却拉不起来 |
| `203` | CDP 连不上（**release 包不开那个调试套接字，这条链在 release 上走不通**） |
| `204` | 包送不进页面（推包失败 / 路径读不到 / `change` 事件没落地） |
| `205` | 页面上找不到 `#pluginFile` |
| `206` | **App 拒绝了离线闸放行的包 —— 两把尺子漂移**，最高优先级 |
| `207` | 装上了但切不过去 / 令牌没下发 |
| `208` | 截图拿不到可信画面（多半是设备锁屏挡着） |
| `209` | 头无头通道起不来（找不到 Edge、端口被占、页面 16s 没起来） |
| `210` | 链路中途抛了未归类的异常（页面侧或 CDP 侧）。会出成一条 `✗ 链路中断 —— <第一行>`，不把裸栈丢给调用方 |

与 `81~86`（pkg-check）、`90+`（run-checks）、`93~98`（falsify）都不撞。

## 4. 它证明了什么、没证明什么

证明了：App 肯收这个包；令牌真下发到了 `body`（`--card` / `--veil` 是实测值不是包里的字符串）；
包里的 `css` 注进了 `#plugin-theme-css`；切过去之后页面确实是那套配色（图在那儿）。

没证明：

1. **性能与发热**。42 层 `backdrop-filter` 压在位图底上掉不掉帧，只有真机 + 真 GPU 说得清。
   headless 默认带 `--disable-gpu`，`backdrop-filter` 走软件合成 —— 看着接近，不等于一样。
   想看更接近的一版，`HEADLESS_GPU=1` 去掉那个开关（仍然不是真机）。
2. **动画**。截图是一帧，轮播的中间态、过渡是否顺，看不出来。
3. **真实视口**。headless 是 `Emulation` 出来的 411×914 dpr3，不是那块屏。取景类的判断交付前仍要 `--channel=device`。

## 5. 漂移那一格怎么确认它是红的

一条只会绿的测试等于没有测试。做法（跑完必须还原并核对工作区干净）：

1. 备份 `weather-app/js/lib/themePlugin.js`；
2. 在 `importPkg()` 的 `if (!v.ok) return v;` 后面插一行无理由拒绝：
   `if (pkg && pkg.id === "demo") return { ok:false, errors:["（变异注入）App 侧无理由拒绝这个包"] };`
3. `node tools/theme-agent-loop.mjs .tmp-loop/demo.themepkg.json` → 期望
   `✗ 离线闸 ↔ App 一致性 —— App 拒了，而离线闸放行：…`，**退出码 206**；
4. 还原，再跑一遍 → 期望退出码 0，`git diff --exit-code` 干净。

2026-10-10 实测过这一条：注入后 206、还原后 0、工作区干净。

## 6. 旋钮

| 变量 | 默认 | 作用 |
|---|---|---|
| `CDP_PORT` | 9444 | CDP 端口（`run-checks.mjs` 用 9333，故意错开） |
| `SERVE_PORT` | 8177 | headless 通道那个临时静态服务的端口 |
| `LOOP_TIMEOUT` | 20000 | 等 App 对这次导入表态的秒数×1000 |
| `HEADLESS_GPU` | 空 | 设成任意值就不带 `--disable-gpu` |
| `EDGE_BIN` / `ADB` / `SERIAL` | 自动找 | 显式指定浏览器、adb、设备 |

headless 通道起的静态服务只监听 127.0.0.1、只允许出仓库内的文件（路径越界回 403）、
所有响应 `no-store`；进程退出时关掉，配置目录放在系统 temp 里，不留进仓库。

## 7. 给 AI 的完整闭环

```
写 / 改 包.json
  → node tools/theme-pkg-check.mjs 包.json --fix     # 算术那一半：不过线就照候选改
  → node tools/theme-agent-loop.mjs 包.json          # 装进真页面：漂移、令牌、一张图
  → 读退出码与那张 png（agent 直接看图）
  → 交付前再来一次 --channel=device                  # 真机那一层，需要有人解锁
```

前两步全自动、不需要人；第三步的观感判断由看图的人或读图的模型承担；
第四步是交付闸，机器替不了。
