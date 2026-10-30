# 天气助手 · Weather Studio

纯静态网页天气应用 + Capacitor Android 壳。网页侧**零依赖、零构建**，浏览器就是运行时；只有打包成 App 才需要 Capacitor。

- **四家数据源可切换**：中国天气（中央气象台，默认）/ Open-Meteo / wttr.in / 自定义 API，全部免密钥（自定义源按对方要求填）
- **空气质量是一条四级降级链，每个数字都带出处徽章**：provider 自带 → 城市榜 → 模型值 → 整卡隐藏；不同口径不混用
- **气象预警随天气报文一起到**，零额外请求；应用被划掉之后后台接着盯，级别升级才提醒
- 通知栏常驻天气（逐字段勾选）、桌面图标四套预设、两套主题、可安装离线打开（PWA）
- 另有「运势」「新闻」两个板块：前者全部本地算（零请求零密钥），后者只接实测可达的公开接口
- **一个主题 = 一个 JSON 文件**：运行期解析、离线验收、装进插件区，不碰构建也不重新打包

界面与文档都是中文。改动之前请先读 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 快速开始

必须用本地服务器（ES 模块受 CORS 约束，`file://` 双击打不开；定位与 PWA 也要安全上下文）。

```bash
npm ci
npm run serve            # http://127.0.0.1:8150/  以 weather-app/ 为根，只绑回环
```

跑回归（注入同源 iframe，量真 DOM / 真 computed style / 真模块）：

```bash
npm run serve:checks     # http://127.0.0.1:8169/tests/run.html  以仓库根为根
node tools/run-checks.mjs  # 需要本机有 Edge 或 Chrome，约 60~70 秒；退出码 = 红条数
```

> 回归服务必须以**仓库根**为根；用 `npm run serve` 起的服务够不到 `tests/`，`run-checks` 会很快退回 203。

其余闸门：

| 命令 | 查什么 |
|---|---|
| `node tools/oss-guard.mjs` | 开源分区闸：个人版素材、本机绝对路径、写死的密钥不许进仓库 |
| `npm run shell:check` | `sw.js` 的 SHELL 清单与磁盘是否一致、样式产物漂没漂、`sw.js` 编不编得过 |
| `node tools/gen-styles.mjs` | 按 `src/styles/NN-*.css` 重拼 `weather-app/styles.css`（改样式后必跑，产物别手改） |
| `node tools/anchor-audit.mjs` | 变异表里每一处锚点还锚不锚得住 |
| `node tests/glass.test.mjs` | 玻璃材质数学（WCAG 比值、合成、反解） |
| `node tests/theme-pkg.test.mjs` | 主题插件包的六道离线闸 |
| `node tools/theme-make.mjs init <id> [显示名]` / `… build <id>` | 起一套主题工作目录并打包（底从范式 §0 刮），打完立刻过闸；工作目录默认在仓库外 |
| `node tools/theme-pkg-check.mjs 你的.themepkg.json` | 主题包能不能导入、最差那格配色过不过 AA |
| `node tools/falsify.mjs` | 逐条把实现改坏，确认对应断言真的会红（**很慢**，一整趟约两小时，见 `CONTRIBUTING.md`） |

`run-checks` / `falsify` 自己启动浏览器；真机脚本（`tests/device-check.mjs` 等）另外需要 adb 与一台解锁的设备。
纯 Node 的几条适合放进 CI；浏览器回归、真机脚本与 `falsify` 不适合挂在 CI 上。

## 打包成 Android 应用

```bash
npm run apk      # gen-styles → gen-shell → cap sync → gradlew assembleDebug
```

产物在 `android/app/build/outputs/apk/debug/app-debug.apk`。需要：

- **JDK 21** 与 **Android SDK**（`compileSdk` / `targetSdk` 35，`minSdk` 23，见 `android/variables.gradle`）。
  这两样不在仓库里，`npm run apk` 也不负责安装，且要求 `JAVA_HOME` / `ANDROID_HOME` 已经指过去。
- Node 20+（脚本只用内置模块，唯一的 devDependency 是 `@capacitor/cli`）。跑浏览器回归建议 Node 22+（要用全局 `WebSocket`）。
- iOS 需要 macOS + Xcode，本仓库当前只走 Android 这一条。

当前是 **debug 签名**：换签名必须卸载重装；同一把 debug key 下 `adb install -r` 可保留数据。
调试真机：`npm run dev`（USB 转发）或 `npm run dev:wifi`；装机后的核对是
`node tests/device-check.mjs [serial]`，它一次问完五条真机判据，并且**锁屏时会拒绝出数**。

## 数据源与第三方

应用不经过任何自建服务端 —— 下面这些请求都是手机/浏览器直连对应服务。
**它们各自的服务条款请自行核对**。本项目不内置逆向网页接口；需要新源时按 `CONTRIBUTING.md` 的步骤加 provider。

| 用途 | 服务 | 密钥 | 备注 |
|---|---|---|---|
| 天气（默认源） | `www.nmc.cn`（中央气象台） | 免 | 全国 2529 个县级站；无逐小时预报，小时条自动改走退路 |
| 天气 / 逐小时 / 地理编码 | `api.open-meteo.com`、`geocoding-api.open-meteo.com` | 免 | 境外服务 |
| 天气 | `wttr.in` | 免 | 每天 8 档（3 小时粒度），选它时小时条跟着改口 |
| 空气质量兜底 | `air-quality-api.open-meteo.com` | 免 | 是 **CAMS 模型预报值 + 美标**，徽章必须写明 |
| 空气质量城市榜 | `weather-drcn.weather.dbankcloud.cn` | 免 | 地级市一级实测；只到市不到县，所以徽章一定写是哪座市 |
| 中文检索 / 反查 | `photon.komoot.io` | 免 | 欧洲托管的公共服务，不宜高频轮询 |
| IP 定位兜底 | `pv.sohu.com`、`api.ip.sb`、`ipapi.co`、`api.bigdatacloud.net` | 免 | 精度到城市级 |
| 新闻 | `www.chinanews.com.cn/rss/*`、`sousuo.www.gov.cn` | 免 | 后者无 CORS 头，因此「政策」频道在桌面浏览器里必然不可用（界面会说明原因） |
| 国标断点依据 | `www.mee.gov.cn` 的 HJ 633—2026 PDF | — | 2012 版已于 2026-03-01 废止，两版有两格不同 |
| 天气图标 | [Game-Icon-Pack](https://github.com/Nieobie/Game-Icon-Pack) 4-nature | — | 已内联进 `js/lib/icon-data.js` |
| 壳 | [Capacitor](https://capacitorjs.com/) 7（`@capacitor/app`、`@capacitor/geolocation`） | — | |

## 隐私

- **没有账号、没有遥测、没有自建后端**，仓库里也不含任何分析 SDK。
- 设置、收藏、生辰、主题包全部存在本机：文本走 `localStorage`，带图片的主题包走 `IndexedDB`。
- 定位坐标、查询的城市名只出现在你直连的那些请求里；不发给本项目的任何一方（本项目没有服务端）。
- 卸载或清站点数据即可全部清除。

## 已知限制（摘要）

- 中文城市名仍有并列歧义无法自动判定（如「朝阳」多个、「昆山」两处同名同级），靠联想列表手选。
- 区县级 AQI 没有「免密钥 + 放行跨域 + 站点实测」三者兼备的国内源，县一级只能退模型值并写明。
- 桌面图标只能在那 4 套预设之间换（Android 图标是编译期资源）；各家启动器重画那一枚是异步的。
- 降水量、风力等字段源没给就整行不画，也不会用别的字段估算 —— 宁缺勿错是这仓库的默认取向。
- 当前是 debug 签名、`versionCode 1` / `versionName 1.0`；正式发布签名与商店元数据不在本仓库范围内。

更细的取舍与实测数字见 [`技术栈说明.md`](技术栈说明.md) 与 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 仓库结构

```
weather-app/     应用本体（纯静态，webDir；cap sync 整目录拷进 App）
  js/            boot → 控制器 → ui/* → lib、providers 单向依赖，跨层数据当参数传，window 上零全局
src/styles/      给人改的样式分片（NN-*.css，一片一个板块），产物由 gen-styles 拼
android/         Capacitor 壳 + 四个自写插件（图标切换 / 原生定位 / 常驻通知 / 后台保活）
tools/           生成器与闸门（样式、SHELL 清单、变异表、主题包验收、出图、真机通道）
tests/           浏览器断言 + 纯 Node 测试 + 真机脚本 + 合成夹具
CONTRIBUTING.md  环境、闸门、改动规矩与 PR 自查
主题插件开发范式.md   写主题包之前读这一份
```

## 许可

MIT，见 [LICENSE](LICENSE)。
