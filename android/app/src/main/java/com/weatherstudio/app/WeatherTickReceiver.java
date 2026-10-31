package com.weatherstudio.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * 闹钟到点后的落脚点。收广播时进程可能已被杀掉重建，所以这里做两件事，顺序很要紧：
 *
 * ① **先把下一拍闹钟排上**，再干活。这是一次性闹钟（`setAndAllowWhileIdle`），
 *    排班若放在活干完之后，进程正好在活儿中间被回收就再也没人排下一次 —— 整条链会静断掉。
 *    2026-09-23 在红米上实测到的正是这一种：01:08 那一拍之后再没有任何待触发的闹钟。
 * ② 就地跑一拍（`goAsync()` 把窗口撑到几十秒），**不从广播里起前台服务**：
 *    Android 14 起后台起前台服务是被禁的（我们那个 `specialUse` 不例外），同一台机器实测系统回
 *    `infoAllowStartForeground=… code:DENIED`，那一发等于白扔。常驻那条通知由应用在自己
 *    在前台时用 `show()`（和 keepAlive 起的前台服务）维持，后台这一拍只负责把新内容写回去 ——
 *    普通 notify 就够，通知本身带 setOngoing，「常驻」的语义没丢。
 */
public class WeatherTickReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(final Context ctx, Intent intent) {
        if (!WeatherKeepAliveService.ACTION_TICK.equals(intent.getAction())) return;
        /* #34：闹钟渠道的首条读数。只打时刻，不打城市/坐标/URL —— 这行要能回答
         * 「划掉应用、屏幕灭着，那一拍到底跑没跑、隔多久」，也要能安全留在 logcat 里。 */
        Log.i("WeatherTick", "alarm fired at " + System.currentTimeMillis());
        final Context app = ctx.getApplicationContext();
        WeatherKeepAliveService.scheduleTick(app);
        final PendingResult res = goAsync();
        new Thread(null, new Runnable() {
            @Override public void run() {
                try {
                    WeatherKeepAliveService.runTick(app);
                } catch (Exception e) {
                    /* 没网 / 中途被杀：下一拍已经排好了，等下一次。异常 message 常带完整 URL，不打。 */
                    Log.i("WeatherTick", "tick failed at " + System.currentTimeMillis());
                } finally {
                    res.finish();
                }
            }
        }, "weather-tick").start();
    }
}
