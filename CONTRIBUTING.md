# 贡献指南

> 面向想改代码、加数据源、写主题包或报问题的人。
> 先读 [`README.md`](README.md)（功能与架构）与 [`技术栈说明.md`](技术栈说明.md)（技术取舍）；写主题包先读 [`主题插件开发范式.md`](主题插件开发范式.md)。
>
> 当前基线：`weather-studio-v1`（2026-10-27）。**文中的数字会过期，以命令输出为准。**

## 0. 五条底线

1. **宁缺勿错**：源没给的字段就不画，不估算、不借别的字段顶替；每个空气质量数字都要带出处与口径徽章，不同口径不许悄悄混用。
2. **不猜 URL**：没实测过的接口不写进代码；法规断点只认官方原文，不从内容农场或文档镜像抄。
3. **零依赖、零构建**：网页侧不引入框架与打包器；`npm ci` 只为 Capacitor CLI 和工具脚本服务。
4. **隐私**：仓库不含账号、遥测、自建后端或写死的密钥；代码、夹具、日志、issue 与截图里都不出现真实住址、经纬度、设备序列号。
5. **判据只有一份**：不要为了让某个主题包或某次改动过闸而放宽 `themeScan`、AA 或测试判据 —— 那等于改所有包、所有改动的尺子。

## 1. 环境

| 用途 | 需要 |
|---|---|
| 日常预览 / 跑回归 | **Node.js 22+**、Edge 或 Chrome |
| 只预览页面 | Node.js 18+ 即可（`tools/serve.mjs` 只用内置模块） |
| 打 Android APK（可选） | **JDK 21**、Android SDK（`platforms;android-35`、`build-tools;34.0.0` **和** `35.0.0`、`platform-tools`） |

- `run-checks` 依赖全局 `WebSocket`，Node 20 会在连 CDP 那一步报 `WebSocket is not defined`；建议直接用 Node 22+。
- 浏览器由 `run-checks` 自动按 `EdgeCore → Chrome → Edge` 查找；装在非默认位置时才需要设 `EDGE_BIN`。**不要把本机浏览器路径写进仓库或 CI。**
- Android 两件套不放进仓库：`JAVA_HOME` / `ANDROID_HOME` 指过去即可；不要提交 `android/local.properties`、SDK 路径、keystore。Gradle 用仓库自带的 wrapper，不需要另装。
- `npm ci` 只装 Capacitor 相关依赖；应用本身零依赖。

## 2. 跑起来

```bash
npm ci

npm run serve          # http://127.0.0.1:8150/  以 weather-app/ 为根（日常预览）
npm run serve:checks   # http://127.0.0.1:8169/tests/run.html  以仓库根为根（回归）
```

**回归必须用仓库根**：用 `npm run serve` 起的服务够不到 `tests/`，`run-checks` 会很快退回 203，而不是等满几分钟。

Service Worker 是 cache-first。验证改动时换一个新端口（换 origin 才会同时清掉 SW 与 HTTP 缓存），或在页面里 `unregister()` 全部 SW、删光 `caches` 后再刷新；只看普通刷新容易端到旧模块。

## 3. 闸门

从秒级到小时级：

| 命令 | 查什么 | 备注 |
|---|---|---|
| `node tools/shell-check.mjs` | `sw.js` 的 SHELL 清单与磁盘是否一致、`styles.css` 有没有漂移、`sw.js` 编不编得过 | 纯 Node；当前基线是 SHELL 70/70、styles 20 片 |
| `node tools/anchor-audit.mjs` | 变异表里每一处锚点还锚不锚得住 | 纯 Node；当前基线 89 个锚点 / 失锚 0 |
| `node tests/glass.test.mjs` | 玻璃材质数学（WCAG 比值、合成、反解） | 纯 Node |
| `node tests/theme-pkg.test.mjs` | 主题插件包的六道离线闸 | 纯 Node |
| `node tools/theme-make.mjs init <id> [显示名]` / `… build <id>` | 起一套主题工作目录（底从范式 §0 刮，不留第二份）、打包并立刻过闸 | 纯 Node；工作目录默认落在**仓库外**，往仓内写要显式 `--allow-in-repo` |
| `node tools/theme-pkg-check.mjs 你的.themepkg.json` | 单个主题包能不能导入、最差配色过不过 AA | 纯 Node；可加 `--explain` / `--fix` |
| `node tools/run-checks.mjs` | 浏览器回归：注入同源 iframe 量真 DOM / 真 computed style / 真模块 | 需要先起 `npm run serve:checks`，并本机有 Edge/Chrome；当前基线 102 条，约 60~70 秒 |
| `node tools/falsify.mjs` | 逐条把实现改坏，确认对应断言会红，再还原 | **很慢**（历史基线整趟约 2.5 小时；本树 v1 尚未跑全量，处数以开局打印为准），独占锁，见下 |
| `node tests/device-check.mjs [serial]` | 装机后的真机五件验收 | 需要 adb；锁屏/通知栏遮挡时会拒绝出数 |
| `node tests/icon-switch.mjs [serial]` | 桌面图标四套预设逐个切，并问系统实际生效的是哪个入口 | 真机，可选 |
| `node tests/gfx-rank-scroll.mjs` | 排名浮层的滚动 GPU 代价 | 真机，可选 |
| `node tests/notify-dedup.mjs` | 常驻通知「正文没变就不重发」 | 真机，且要等自然到的那一拍 |
| `node tools/theme-agent-loop.mjs 你的.themepkg.json` | 把包真装进页面：离线闸 → 导入 → 切主题 → 出图 | 需要浏览器；加 `--channel=device` 走真机 |

几条判读规则：

- **断言数以命令输出为准**。旧 README / 账本里的 127 条、130 锚点是墨迹源下架前的基线；当前树 是 **102 条 / 89 锚点**。差的是整源移除后删掉的断言与锚点，不是漏跑，也不要为了凑数补无意义断言。
- `run-checks` 的退出码：`0~N` 是红条数，`200~203` 是通道坏了（200 找不到浏览器 · 201 无结果 · 202 看门狗 · 203 问不到服务）。判红没红，读它逐条打印的 `PASS` / `FAIL` 比只读退出码稳。
- 少数断言要等真实第三方接口（例如全国空气质量榜），偶发超时会红一次。先隔一分钟重跑；重跑仍红再看代码，**不要把判据改成「有 N 行就算过」**。
- `falsify` 会改源文件再还原，**独占这棵树**，不要和其他跑批、真机脚本或另一套回归并行。处数以它开局打印的为准。中途被打断时先 `git status` 看残留，只还原它改过的文件；**自己还有未提交改动时不要直接 `git checkout -- .`**。
- 纯 Node 的几条适合放进 CI；浏览器回归要本机浏览器、真机脚本要 adb、`falsify` 要两三个小时，都不适合挂 CI。

## 4. 改代码的规矩

### 4.1 样式与 SHELL

- 样式只改 `src/styles/NN-*.css`，然后 `npm run styles` 重拼产物。**不要手改 `weather-app/styles.css`** —— 它是产物，`shell-check` 会抓漂移。
- 新增/删除 `weather-app/` 里需要预缓存的文件后跑 `npm run shell`，由 `tools/shell-list.mjs` 按磁盘重算清单。**不要手改 `sw.js` 的 SHELL 列表。**
- 刻意按需加载的文件（例如站点码表）应加进 `tools/shell-list.mjs` 的 `DYNAMIC` 并写明理由，而不是漏进 SHELL。

### 4.2 CACHE 与版本

- 改了 `weather-app/` 里的 **js / css / html**，必须把 `sw.js` 的 `CACHE` 升一档（`v1 → v2`），并跑 `npm run shell:check`。
- 只改 `tests/`、`tools/`、文档，不需要升 CACHE。
- 普通 PR 不要自行改 `versionCode` / `versionName`；发版时由维护者让 `CACHE` / `versionCode` / `versionName` / `package.json` 三件对齐。

### 4.3 断言与变异

- 每条新断言都要在 `tools/falsify/mut/<族>.mjs` 配一处「改坏它」的变异。
- **首次就绿的断言，先逼红一次再采信**。跑不到红，先分清是断言写空、锚点没匹配，还是那个改动根本不算回归。
- 断言脚本里报一个 `TypeError` 可能让整张表一行都不出；「0 条」不是全绿，是通道坏了。
- 少数断言是按源码形状问的（fetch 具体文件再找函数名）。搬代码时它们会红，不会静默变绿；跟着更新。

### 4.4 搬文件、改目录

- 文件改名用 `git mv`，否则历史里认不出改名。
- 搬完跑 `node tools/anchor-audit.mjs`；失锚数必须归零。
- 依赖方向保持单向：`main/boot → 控制器 → query → ui/* → lib、providers`；`lib` 与 `providers` 不 import 上层，`ui/` 的实现文件不 import 回门面。

### 4.5 加数据源

1. 在 `weather-app/js/providers/` 新增一个 provider，声明 `id`、`label`、`cap`（`byCityName` / `air` / `hourly` / `daily` / `alert` / `background`）与 `normalize`，按需实现 `airQuality` / `recipeFor`。
2. 在 `weather-app/js/providers/index.js` 注册。
3. **不把密钥写进仓库**：需要 key 的源走设置面板的字段；免密钥源也不要写死别人的 token。
4. **先实测再写**：CORS 是否放行、参数是否真的生效、缺测用什么哨兵、字段是不是平行数组 —— 这些都要自己发请求确认；不要从「看起来能用」的接口文档推断。
5. 不要新增逆向网页接口或需要抓 HTML 的源；确实必要先开 issue 讨论稳定性、条款与降级方式。
6. 同步设置面板与「软件声明」：来源、口径、缺测时退到哪一级，界面必须自己讲清楚，不能写死一句与当前源不符的说明。
7. 加夹具与断言，并在 `tools/falsify/mut/` 配一处改坏它的变异。

当前内置源：**中国天气（默认）/ Open-Meteo / wttr.in / 自定义 API**。历史文档若仍提墨迹，以代码为准 —— 历史版本已整源下架。

### 4.6 主题运行时 = 契约

以下文件与主题 CSS 变量 / DOM 钩子属于**运行时契约**：

`weather-app/js/lib/themePlugin.js` · `js/lib/themeScan.js` · `js/settings/themePlugins.js` · `js/ui/theme.js` · `js/lib/themes.js`

- 改它们之前先读 [`主题插件开发范式.md`](主题插件开发范式.md)。
- 判据只有一份：`js/lib/themeScan.js`。命令行 `theme-pkg-check` 与 App 导入用的是同一套，不要出现「命令行放行、App 拒绝」的两把尺子。
- 改契约要同时：升 CACHE、重跑 `node tests/theme-pkg.test.mjs` 与 `node tools/theme-pkg-check.mjs <包>`、在 PR 里明确写「契约变了」。已有主题包需要重新验收。
- **不要为了让旧包通过而放宽运行时判据**；兼容旧包应在包侧改，不在尺子上改。
- `tools/theme-make.mjs` 的起盘底是**刮范式 §0 那个 json 块**来的：改那份底不用回头改脚本，但改包格式时要连着看 §0 那份还过不过闸。这份工具不校验 id 格式、不算素材预算、不量对比度 —— 那些只住在 `validate` / `worstContrast` 里，它只多一条文件系统守卫（id 不许含路径分隔符）。

### 4.7 Android / 原生侧

- 先 `export JAVA_HOME=<jdk21>`、`export ANDROID_HOME=<android-sdk>`，再 `npm run apk`。脚本不会替你找 SDK。
- 产物在 `android/app/build/outputs/apk/debug/app-debug.apk`。当前是 debug 签名：换签名必须卸载重装（会清掉本机数据）；同一把 debug key 下 `adb install -r` 可保留数据。
- 不要提交 keystore、`local.properties`、`.gradle/`、`build/` 或 `android/app/src/main/assets/public/`（`cap sync` 会重新生成）。
- 原生日志**不含地址、经纬度、城市名、完整 URL**；异常只打类名，不打可能带完整 URL 的 message。
- 改了原生行为或样式，尽量在真机上留一张图或一段 logcat；截图若拍到街道级地址，用完当场删，不要贴进 issue。

### 4.8 夹具、截图与隐私

- 测试夹具用合成件或脱敏后的真实报文；不要放真实住址、精确坐标、设备序列号、账号信息。
- 夹具里被断言当作替换锚点的字面量，全文只出现一次，避免改坏一处却命中另一处。
- 报 issue / PR 时只贴必要的日志；先去掉坐标、地址、IP、设备标识与截图里的个人信息。

### 4.9 提交内容

提交前看一眼 `git status`，不要把这些带进去：

- `node_modules/`、`.toolchain/`、构建产物、`android/local.properties`；
- 个人素材、签名文件、密钥、token；
- 本机绝对路径、内部笔记、临时日志、`weather-checks-*` 残留；
- 仅因跑批产生的截图或临时文件。

保持一个 PR 只做一件事：不要在一次行为改动里夹带大范围重排或无关重构。提交信息写清「为什么」，不要只写「改了什么」。

## 5. 提 PR / 报问题

### PR 自查

- [ ] `node tools/shell-check.mjs` 干净（改了样式/壳/SHELL 时必跑）
- [ ] `node tools/anchor-audit.mjs` 失锚 0（搬过代码或加过断言时必跑）
- [ ] `npm run serve:checks` 起着，`node tools/run-checks.mjs` 红 0；若仍有红，说明原因
- [ ] 新断言配了变异，并亲眼见过它变红
- [ ] 改了样式 → 跑过 `npm run styles`，产物已包含；改了 SHELL 件 → 跑过 `npm run shell`
- [ ] 改了 js/css/html → `sw.js` 的 CACHE 已升一档
- [ ] 没有密钥、个人素材、真实坐标/地址、设备序列号、本机路径
- [ ] 行为变了就同步文档（README / 技术栈说明 / 主题插件范式）

### issue 里请带上

- `weather-app/sw.js` 里的 `CACHE` 版本（例如 `weather-studio-v1`）；
- 浏览器与版本，或手机型号 + Android 版本；
- 复现步骤、预期结果、实际结果；
- 相关报错（已脱敏）与截图（已去掉地址/坐标/设备标识）；
- 主题包问题附上 `.themepkg.json` 与 `theme-pkg-check` 的输出。

文档与代码冲突时，以代码和 `sw.js` 为准；发现文档过期，欢迎顺手修正。

## 6. 许可

MIT，见 [`LICENSE`](LICENSE)。提交 PR 即表示同意以同一许可证发布你的贡献。
