package com.weatherstudio.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONObject;

/**
 * 把闹钟链接回来。
 *
 * 为什么需要它：MIUI 的「上滑清理」对本包就是一次 force-stop（logcat 里 `am_kill … : SwipeUpClean`），
 * 而 force-stop 会连带取消该应用所有待触发闹钟（`dumpsys alarm` 历史里的 `Reason=pi_cancelled`）。
 * 链断在这里之后，`WeatherTickReceiver` 是 `exported=false` 且没有任何系统广播入口，**没有任何东西会再把
 * 下一拍排上** —— 用户得亲手打开一次应用才接得回来，那就不叫「后台存活」了。
 *
 * 挑这三个入口（**别以为清单声明了就一定收得到**，下面 USER_PRESENT 那行就是反例）：
 *   BOOT_COMPLETED     —— 开机之后
 *   USER_PRESENT       —— 每次解锁。**2026-09-30 在华为 LNA-AL00 / EMUI 12 上实测收不到**：强停后请用户
 *                         真的锁屏再指纹解开，logcat 是 `BroadcastQueue: enter shouldPreventSendBroadcast
 *                         … USER_PRESENT`，之后进程 0、待触发闹钟 0 发 —— 压根没投递。这条**不能**当自愈依据；
 *                         实测有效的把手是「用户进一次应用」（拉起后闹钟立刻回来）。红米那台恢复过，
 *                         但没有单独证据证明是这一发送的（MY_PACKAGE_REPLACED 在那台会投）。
 *   MY_PACKAGE_REPLACED —— 覆盖安装/更新之后
 *
 * 三件事按这个顺序做，且**都不要求进程活着**：
 * ① 只认落盘的配方（`SharedPreferences` 里那份），配方没了或 `on:false` 就什么都不做 —— 用户关掉的
 *    东西不许被开机广播偷偷打开；
 * ② `scheduleTick` 走的是锚定时刻（见那里的注释），所以「每次解锁都排一次」不会把期限一路推走；
 * ③ 起前台服务只是**尽力**：Android 14 起后台起前台服务是被禁的（`specialUse` 不例外，只有系统自己
 *    放行的那一类入口能过，见 2026-09-26 那次 MY_PACKAGE_REPLACED 的 `SYSTEM_ALLOW_LISTED`），被拒是预期内的，
 *    那一拍照样会由闹钟到点时 `WeatherTickReceiver` 就地跑完并 `notify()` 把通知写回去。
 */
public class WeatherRestartReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent == null ? "" : String.valueOf(intent.getAction());
        if (!Intent.ACTION_BOOT_COMPLETED.equals(a)
          && !Intent.ACTION_USER_PRESENT.equals(a)
          && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) return;
        Context app = ctx.getApplicationContext();
        JSONObject r = WeatherKeepAliveService.recipe(app);
        if (r == null || !r.optBoolean("on", false)) return;
        WeatherKeepAliveService.scheduleTick(app);
        if (!r.optBoolean("live", false)) return;
        try {
            Intent svc = new Intent(app, WeatherKeepAliveService.class);
            svc.setAction(WeatherKeepAliveService.ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) app.startForegroundService(svc);
            else app.startService(svc);
        } catch (Exception e) {
            /* 系统不放行后台起前台服务：闹钟已经排上，到点那一拍自己把通知写回来 */
        }
    }
}
