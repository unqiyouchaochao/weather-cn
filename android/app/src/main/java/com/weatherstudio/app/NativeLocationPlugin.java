package com.weatherstudio.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.List;

/**
 * 只用系统 LocationManager 的定位通道，全程不碰谷歌服务。
 *
 * 为什么要自己写一个：@capacitor/geolocation 只走 FusedLocationProviderClient（谷歌），
 * 实测在国内机器上会被 MIUI 的省电策略（PowerKeeper）掐掉网络定位的 wake lock，
 * 十几秒拿不到新位置就回 OS-PLUG-GLOC-0010 超时，应用只能退到 IP 定位 —— 而 IP 拿到的是
 * 运营商核心网出口，能把人在广东甩到郑州。
 *
 * 这里做两件插件不做的事：
 * 1) 先用 getLastKnownLocation 遍历各 provider 取「系统里现成的最新位置」，多数情况下秒回，
 *    根本不用等新的 fix；
 * 2) 确实要等时，同时挂在 gps / network / passive 上，谁先来回谁，并把 provider 与年龄一起
 *    返回，前端才标得清楚这是刚定到的还是缓存。
 */
@CapacitorPlugin(
    name = "NativeLocation",
    permissions = {
        @Permission(
            strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION },
            alias = "location"
        )
    }
)
public class NativeLocationPlugin extends Plugin {

    private LocationManager locationManager;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private LocationListener activeListener;
    private Runnable timeoutRunnable;

    @Override
    public void load() {
        super.load();
        locationManager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
    }

    @PluginMethod
    public void getPosition(PluginCall call) {
        if (locationManager == null) {
            call.reject("设备无定位能力", "NO_MANAGER");
            return;
        }
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "locationPermissionResult");
            return;
        }
        fetch(call);
    }

    /** 单独问一问权限与可用 provider，出问题时不用靠异常猜 */
    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("state", getPermissionState("location").name());
        ret.put("providers", providerSummary());
        call.resolve(ret);
    }

    /**
     * 「系统定位开关到底开没开」——前端要靠这个把「没开定位」和「缺谷歌服务」分开说，
     * 否则三条链路各自的报错拼起来一定带 Google Play Services 字样，用户会以为必须装谷歌。
     * location_mode 是任何应用都能读的 Secure 设置：0=关 1=高精度 2=省电 3=仅设备。
     */
    @PluginMethod
    public void locationStatus(PluginCall call) {
        JSObject ret = new JSObject();
        boolean gps = providerOn(LocationManager.GPS_PROVIDER);
        boolean network = providerOn(LocationManager.NETWORK_PROVIDER);
        boolean passive = providerOn(LocationManager.PASSIVE_PROVIDER);
        ret.put("gps", gps);
        ret.put("network", network);
        ret.put("passive", passive);
        ret.put("switchOn", gps || network || passive);
        ret.put("mode", locationMode());
        ret.put("permission", getPermissionState("location").name());
        ret.put("providers", providerSummary());
        call.resolve(ret);
    }

    /**
     * 跳到系统的「位置信息」设置页让用户自己开。
     * 应用**不能**自己把开关拨开 —— 改 Settings.Secure.LOCATION_MODE 需要 WRITE_SECURE_SETTINGS
     * （系统/签名级，只能 adb 给），所以能做的极限就是把用户送到那一页 + 回来自动重试。
     */
    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        Intent primary = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
        if (startOrFallback(primary, call)) return;
        // 个别 ROM/精简系统没实现那一页，退回本应用的详情页（那里也能开权限）
        Intent details = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", getContext().getPackageName(), null));
        if (!startOrFallback(details, call)) {
            call.reject("打不开系统定位设置页，请手动到「设置 → 位置信息」里开启", "NO_SETTINGS_ACTIVITY");
        }
    }

    private boolean startOrFallback(Intent intent, PluginCall call) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            Context ctx = getActivity() == null ? getContext() : getActivity();
            ctx.startActivity(intent);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private boolean providerOn(String provider) {
        if (locationManager == null) return false;
        try {
            return locationManager.isProviderEnabled(provider);
        } catch (Exception e) {
            return false;
        }
    }

    private int locationMode() {
        try {
            String v = Settings.Secure.getString(getContext().getContentResolver(), Settings.Secure.LOCATION_MODE);
            return v == null ? -1 : Integer.parseInt(v);
        } catch (Exception e) {
            return -1;
        }
    }

    @PermissionCallback
    private void locationPermissionResult(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) {
            fetch(call);
        } else {
            call.reject("定位权限被拒绝", "PERMISSION_DENIED");
        }
    }

    private void fetch(PluginCall call) {
        long maxAge = call.getLong("maxAge", 30000L);
        long timeout = call.getLong("timeout", 15000L);

        Location known = bestLastKnown(maxAge);
        if (known != null) {
            call.resolve(toJs(known, true));
            return;
        }
        // 系统定位总开关关着就别白等 15 秒：直接给一个专门的错误码，前端据此提示「去开启」
        if (!providerOn(LocationManager.GPS_PROVIDER) && !providerOn(LocationManager.NETWORK_PROVIDER)
                && !providerOn(LocationManager.PASSIVE_PROVIDER)) {
            call.reject("系统定位服务未开启", "LOCATION_OFF");
            return;
        }
        waitForFix(call, timeout);
    }

    /** 各 provider 的缓存位置里挑最新的一个，且不老于 maxAge */
    private Location bestLastKnown(long maxAge) {
        Location best = null;
        List<String> providers = locationManager.getProviders(true);
        if (providers == null) return null;
        for (String p : providers) {
            Location l = lastKnown(p);
            if (l == null) continue;
            if (best == null || l.getTime() > best.getTime()) best = l;
        }
        if (best == null) return null;
        return System.currentTimeMillis() - best.getTime() <= maxAge ? best : null;
    }

    @SuppressWarnings("deprecation")
    private Location lastKnown(String provider) {
        try {
            return locationManager.getLastKnownLocation(provider);
        } catch (SecurityException | IllegalArgumentException e) {
            return null;
        }
    }

    @SuppressWarnings("deprecation")
    private void waitForFix(final PluginCall call, final long timeout) {
        final boolean[] settled = { false };
        final LocationListener listener = new LocationListener() {
            @Override public void onLocationChanged(Location location) {
                if (settled[0]) return;
                settled[0] = true;
                detach();
                call.resolve(toJs(location, false));
            }
            @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
            @Override public void onProviderEnabled(String provider) {}
            @Override public void onProviderDisabled(String provider) {}
        };
        activeListener = listener;
        timeoutRunnable = new Runnable() {
            @Override public void run() {
                if (settled[0]) return;
                settled[0] = true;
                detach();
                // 超时前再兜一次：可能刚好有别的应用把位置写进了系统缓存
                Location late = bestLastKnown(Math.max(timeout * 4, 120000L));
                if (late != null) call.resolve(toJs(late, true));
                else call.reject("定位超时（设备信号不可用）", "TIMEOUT");
            }
        };

        int attached = 0;
        for (String p : new String[] { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER }) {
            try {
                if (!locationManager.isProviderEnabled(p)) continue;
                locationManager.requestLocationUpdates(p, 0L, 0f, listener, Looper.getMainLooper());
                attached++;
            } catch (SecurityException | IllegalArgumentException | IllegalStateException e) {
                // 这个 provider 挂不上就试下一个，不整体失败
            }
        }
        if (attached == 0) {
            settled[0] = true;
            detach();
            call.reject("没有可用的定位 provider（系统定位开关未开？）", "NO_PROVIDER");
            return;
        }
        mainHandler.postDelayed(timeoutRunnable, timeout);
    }

    /** 摘掉监听与超时任务：不摘的话每次定位都留一个挂着的 listener，GPS 芯片会一直醒着耗电 */
    private void detach() {
        if (timeoutRunnable != null) mainHandler.removeCallbacks(timeoutRunnable);
        if (activeListener != null) {
            try {
                locationManager.removeUpdates(activeListener);
            } catch (SecurityException ignored) {
                // 权限中途被收回，摘不到就算了
            }
            activeListener = null;
        }
    }

    /** 给前端的诊断串：哪些 provider 可用，一眼分清是权限问题还是系统开关没开 */
    private String providerSummary() {
        StringBuilder sb = new StringBuilder();
        List<String> all = locationManager == null ? null : locationManager.getProviders(true);
        if (all != null) {
            for (String p : all) {
                if (sb.length() > 0) sb.append('/');
                sb.append(p);
            }
        }
        return sb.toString();
    }

    /**
     * 退到后台就把定位监听摘掉：应用不在前台时没必要继续醒着 GPS 芯片，
     * 回到前台前端会重新发起定位（见 js/main.js 的 visibilitychange 分支）。
     */
    @Override
    protected void handleOnStop() {
        detach();
        super.handleOnStop();
    }

    @Override
    protected void handleOnDestroy() {
        detach();
        super.handleOnDestroy();
    }

    private JSObject toJs(Location l, boolean cached) {
        JSObject ret = new JSObject();
        ret.put("latitude", l.getLatitude());
        ret.put("longitude", l.getLongitude());
        ret.put("accuracy", l.getAccuracy());
        ret.put("provider", l.getProvider());
        ret.put("cached", cached);
        ret.put("age", System.currentTimeMillis() - l.getTime());
        return ret;
    }
}
