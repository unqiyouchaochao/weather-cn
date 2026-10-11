/* adb 在哪 —— 三个真机脚本共用一个把手。
 *
 * 2026-10-12 之前这三处各写死一个绝对路径（`D:/qder/Tools/android/Sdk/platform-tools/adb.exe`），
 * 那个目录早已不存在，于是整条真机通道哑掉、还不报错（`spawnSync` 拿不到命令时只是没输出）。
 * 写死的机器路径就是这种债：换机、搬家、甚至只是换个 SDK 摆放位置都会静默失效。
 *
 * 找的顺序：`ADB` 环境变量 → `ANDROID_HOME` / `ANDROID_SDK_ROOT` → 仓库内 `.toolchain/android-sdk`
 * → 交给 PATH 上的 `adb`。前三个都要求文件真存在，最后一个原样返回。 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
const 候选 = [
  process.env.ADB,
  process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools', exe),
  process.env.ANDROID_SDK_ROOT && path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools', exe),
  path.join(ROOT, '.toolchain', 'android-sdk', 'platform-tools', exe),
].filter(Boolean);

/** PATH 上那个是最后兜底：它是否存在交给执行时报错，这里不去猜 */
export const ADB = 候选.find(p => existsSync(p)) || 'adb';
