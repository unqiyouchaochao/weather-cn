package com.weatherstudio.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * 通知栏：常驻一条实时天气（weather-live 渠道，不响），外加一条会响的气象预警（weather-alert 渠道）。
 *
 * 前端每次刷新天气后调一次 show；keepAlive 把「往哪儿要报文、每段从哪儿取」交给后台，
 * 划掉应用之后由 WeatherKeepAliveService（或关掉常驻通知时的 WeatherTickReceiver）接着更新。
 * 起不起前台服务由配方里的 live 决定：用户关了常驻通知，就不该再拿「后台要活着」当理由把那条通知请回来。
 *
 * setOngoing(true) 是为了让它不被一键清空划走（常驻语义）；渠道 IMPORTANCE_LOW + onlyAlertOnce
 * 保证刷新时不响铃、不弹 heads-up。
 */
@CapacitorPlugin(
    name = "WeatherNotify",
    permissions = {
        @Permission(strings = { "android.permission.POST_NOTIFICATIONS" }, alias = "notify")
    }
)
public class WeatherNotifyPlugin extends Plugin {

    private static final String CHANNEL_ID = "weather-live";
    private static final String CHANNEL_ALERT = "weather-alert";
    private static final int NOTIFICATION_ID = 1001;
    /* 预警通知按 tag 散列到 2000~2999，同一条预警重复提醒时落在同一个 id 上就地更新，
     * 不会堆一屏；和常驻那条（1001）永远不撞。 */
    private static final int ALERT_ID_BASE = 2000;
    private static final int ALERT_ID_SPAN = 1000;
    private static final int NOTIFY_PERMISSION_API = 33;

    private NotificationManager manager;

    @Override
    public void load() {
        super.load();
        manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        // 两条渠道都在启动时就建好：渠道要等第一次 notify 才出现的话，用户就没法在
        // 「还没出过预警」的时候去系统设置里调它的声音/横幅，而预警恰恰是要提前调好的东西。
        ensureChannel();
        ensureAlertChannel();
    }

    @PluginMethod
    public void show(PluginCall call) {
        if (manager == null) {
            call.reject("设备不支持通知");
            return;
        }
        if (needsNotifyPermission() && getPermissionState("notify") != PermissionState.GRANTED) {
            requestPermissionForAlias("notify", call, "notifyPermissionResult");
            return;
        }
        render(call);
    }

    @PermissionCallback
    private void notifyPermissionResult(PluginCall call) {
        // 用户拒了不报错：通知是锦上添花，每次刷新都弹授权框更糟。用 shown=false 告诉前端别再来
        render(call);
    }

    /** 通知是否真的能显示出来（系统总开关 + 渠道开关都算） */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        boolean granted = !needsNotifyPermission() || getPermissionState("notify") == PermissionState.GRANTED;
        ret.put("permission", granted ? "granted" : "denied");
        ret.put("enabled", manager != null && manager.areNotificationsEnabled());
        ret.put("active", manager != null);
        call.resolve(ret);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        if (manager != null) manager.cancel(NOTIFICATION_ID);
        call.resolve();
    }

    /**
     * 交给后台一份「配方」并拉起后台存活。配方里只有：往哪个 URL 要报文、通知每段从报文的
     * 哪个路径取值、单位怎么换算、预警的级别门槛与取值路径。天气与 AQI 的计算逻辑仍在前端，
     * 后台只按路径拼字符串 —— 两边不会各算一套对不上。
     *
     * 三种状态分开处理（on/live 两个开关）：
     *   on=false            —— 什么都不要了：抹掉配方、取消闹钟、停服务。
     *   on=true, live=true  —— 要常驻通知：起前台服务，闹钟由服务自己排。
     *   on=true, live=false —— 只查预警：停掉前台服务（连带撤下那条通知），配方留着，
     *                          闹钟改由 WeatherTickReceiver 裸跑。**不取消闹钟**，否则预警就不盯了。
     */
    @PluginMethod
    public void keepAlive(PluginCall call) {
        JSObject recipe = call.getObject("recipe");
        boolean on = recipe != null && recipe.optBoolean("on", false);
        SharedPreferences sp = getContext().getSharedPreferences(WeatherKeepAliveService.PREFS, Context.MODE_PRIVATE);
        Intent svc = new Intent(getContext(), WeatherKeepAliveService.class);
        if (!on || recipe == null) {
            sp.edit().remove(WeatherKeepAliveService.KEY_RECIPE).apply();
            WeatherKeepAliveService.cancelTick(getContext());
            svc.setAction(WeatherKeepAliveService.ACTION_STOP);
            getContext().startService(svc);
            call.resolve();
            return;
        }
        sp.edit().putString(WeatherKeepAliveService.KEY_RECIPE, recipe.toString()).apply();
        boolean live = recipe.optBoolean("live", false);
        try {
            if (live) {
                svc.setAction(WeatherKeepAliveService.ACTION_START);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(svc);
                else getContext().startService(svc);
            } else {
                // 只 stopService，不走 ACTION_STOP：那条会顺手把闹钟取消掉
                getContext().stopService(svc);
                WeatherKeepAliveService.scheduleTick(getContext());
            }
        } catch (Exception e) {
            /* 前台服务起不来（省电策略/后台限制）：通知停在最后一次内容，闹钟下一次进前台重排 */
        }
        call.resolve();
    }

    /**
     * 弹一条气象预警通知（会响、会横幅），与常驻那条互不影响。
     * 入参：title / text / tag / rank。tag 是预警的原文 id，决定落在哪个通知槽上，用来「同一条就地更新」；
     * rank 是级别（红4 橙3 黄2 蓝1），去重靠它判断「这条是不是已经弹过或没升级」。
     * 去重与记账在 WeatherKeepAliveService.deliverAlert 里，前台后台共用一份，免得后台弹过一次、
     * 用户再打开应用又被同一条炸一次。
     */
    @PluginMethod
    public void alert(PluginCall call) {
        if (manager == null) {
            call.reject("设备不支持通知");
            return;
        }
        if (needsNotifyPermission() && getPermissionState("notify") != PermissionState.GRANTED) {
            requestPermissionForAlias("notify", call, "alertPermissionResult");
            return;
        }
        renderAlert(call);
    }

    @PermissionCallback
    private void alertPermissionResult(PluginCall call) {
        renderAlert(call);
    }

    /** 预警解除后撤掉对应那条（前端按 tag 记着） */
    @PluginMethod
    public void alertDone(PluginCall call) {
        if (manager != null) manager.cancel(alertId(call.getString("tag", "")));
        call.resolve();
    }

    private void renderAlert(PluginCall call) {
        String text = call.getString("text", "");
        String title = call.getString("title", "气象预警");
        String tag = call.getString("tag", "");
        ensureAlertChannel();
        boolean delivered;
        try {
            delivered = WeatherKeepAliveService.deliverAlert(
                getContext(), tag, call.getInt("rank") == null ? 0 : call.getInt("rank"), title, text);
        } catch (Exception e) {
            /* 记账这一路炸了不许带走整个应用：CapacitorPlugins 线程上的未捕获异常 = 进程直接重启，
             * 而这条链本身是 best-effort（预警卡在界面上早就画好了，通知只是补一发）。
             * 前端 `pushAlerts` 的 `.catch` 把 reject 当「这轮不发、也不记账」，下一轮刷新自然再试。 */
            call.reject("预警通知没发出去：" + e);
            return;
        }

        JSObject ret = new JSObject();
        // delivered=false 有两种：这条已经弹过（不该再吵），或系统不允许弹。两种都不该记账，
        // 所以前端拿到的语义保持原样 —— shown 只说「有没有真的弹出去」。
        ret.put("shown", delivered);
        ret.put("duplicate", !delivered && manager != null && manager.areNotificationsEnabled());
        call.resolve(ret);
    }

    private int alertId(String tag) {
        int h = tag == null ? 0 : Math.abs(tag.hashCode());
        return ALERT_ID_BASE + (h % ALERT_ID_SPAN);
    }

    private void ensureAlertChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (manager == null || manager.getNotificationChannel(CHANNEL_ALERT) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ALERT, "气象预警", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("发布新的气象灾害预警信号时提醒");
        ch.setShowBadge(true);
        ch.enableVibration(true);
        manager.createNotificationChannel(ch);
    }

    private void render(PluginCall call) {
        String text = call.getString("text", "");
        String title = call.getString("title", "天气");
        ensureChannel();

        Intent open = new Intent(getContext(), MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(getContext(), 0, open, flags);

        Notification n = new NotificationCompat.Builder(getContext(), CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_weather)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(pi)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build();

        manager.notify(NOTIFICATION_ID, n);
        // 记进后台那份账：常驻通知刚真的换过内容，后台那一拍就不必为此再更新一次，
        // 服务被回收后重新起来时也拿这一条占位，不会挂一句「正在获取天气…」等一小时
        WeatherKeepAliveService.rememberLive(getContext(), title, text);

        JSObject ret = new JSObject();
        ret.put("shown", manager.areNotificationsEnabled());
        call.resolve(ret);
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (manager == null) return;
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL_ID);
        if (channel != null) return;
        channel = new NotificationChannel(CHANNEL_ID, "实时天气", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("在通知栏常驻一条当前天气");
        channel.setShowBadge(false);
        channel.enableVibration(false);
        channel.enableLights(false);
        manager.createNotificationChannel(channel);
    }

    private boolean needsNotifyPermission() {
        return Build.VERSION.SDK_INT >= NOTIFY_PERMISSION_API;
    }
}
