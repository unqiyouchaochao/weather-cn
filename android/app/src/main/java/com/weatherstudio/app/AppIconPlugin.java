package com.weatherstudio.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 桌面图标切换。Android 的图标是**编译期**资源，运行时只能在这几套预设之间换 ——
 * 用户给一张图就当图标这件事，只有桌面启动器自己做得到（它能把任意图生成快捷方式），
 * 应用自己做不到，所以界面上只给预设。
 *
 * 机制：桌面入口挂在四个 activity-alias 上（见 AndroidManifest），换图标 = 启用目标那一个、
 * 关掉其余三个，MainActivity 本身永远不动（它是四个入口共同的目标）。
 *
 * 两条必须守住的规矩：
 *  1. **先启用、后禁用**。反过来会留出一个「一个入口都没有」的窗口，个别桌面会当场把图标抹掉，
 *     再刷新回来就不一定了。
 *  2. **任何一次读取都顺手自愈**。`getComponentEnabledSetting` 在没被显式改过时返回
 *     `DEFAULT`（意思是「按清单声明」），拿它当「关着」会把默认那套误判成没有入口；
 *     而四个全关（改到一半被杀、用户在设置里单独禁用、ROM 干的）意味着**桌面上再也找不到这个应用**，
 *     所以这里发现「一个都没启用」就把记账的那套请回来，没记账就请回默认。
 */
@CapacitorPlugin(name = "WeatherIcon")
public class AppIconPlugin extends Plugin {

    static final String PREFS = "app-icon";
    private static final String KEY_ICON = "icon";

    /** 界面传的名字 -> 清单里的 alias 类名；顺序与 manifest 一致 */
    private static final String[] NAMES = { "default", "sun", "night", "bloom" };
    private static final String[] ALIASES = { "IconDefault", "IconSun", "IconNight", "IconBloom" };
    /** 清单里各 alias 的 android:enabled 声明值（DEFAULT 时以它为准） */
    private static final boolean[] DECLARED = { true, false, false, false };

    private SharedPreferences prefs() { return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    private int indexOf(String name) {
        for (int i = 0; i < NAMES.length; i++) if (NAMES[i].equals(name)) return i;
        return -1;
    }

    /** 组件名必须是**全限定**的：清单里写 `.IconSun`，PackageManager 解析时展开成「包名.IconSun」，
     *  比对时比的就是那一个。`new ComponentName(context, "IconSun")` 递过去的是没展开的短名 ——
     *  2026-09-29 真机上量到的现象是「点四枚缩略图永远换不了」，原文异常是
     *  `Component class IconSun does not exist in com.weatherstudio.app`。
     *  而**读**的那一路（`getComponentEnabledSetting`）拿短名查不到记录只回 DEFAULT、不抛错，
     *  于是 `getIcon()` 一直客客气气地回「default」，看着像一切正常 —— 这类「写失败、读装作成功」
     *  只能靠真机按一次按钮暴露，别拿界面上没报错当证据。 */
    private ComponentName cn(int i) {
        String pkg = getContext().getPackageName();
        return new ComponentName(pkg, pkg + "." + ALIASES[i]);
    }

    private boolean enabledAt(int i) {
        PackageManager pm = getContext().getPackageManager();
        int st = pm.getComponentEnabledSetting(cn(i));
        if (st == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) return true;
        if (st == PackageManager.COMPONENT_ENABLED_STATE_DISABLED) return false;
        return DECLARED[i];                       // DEFAULT = 照清单声明
    }

    /** 返回当前真正有桌面入口的那一套；一个都没有就自愈，并把自愈结果回给调用方 */
    private String current() {
        for (int i = 0; i < ALIASES.length; i++) if (enabledAt(i)) return NAMES[i];
        /* 走到这里桌面上已经没有这个应用的入口了。回到用户上次选的那一套，没记账过才回默认。 */
        int want = indexOf(prefs().getString(KEY_ICON, ""));
        if (want < 0) want = 0;
        switchTo(want);
        return NAMES[want];
    }

    /** 先开门、再关别的：顺序反过来会留出一个「一个入口都没有」的窗口 */
    private void switchTo(int i) {
        setAt(i, true);
        for (int k = 0; k < ALIASES.length; k++) if (k != i) setAt(k, false);
    }

    private void setAt(int i, boolean on) {
        PackageManager pm = getContext().getPackageManager();
        pm.setComponentEnabledSetting(cn(i),
            on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP);
    }

    @PluginMethod
    public void getIcon(PluginCall call) {
        JSObject r = new JSObject();
        r.put("icon", current());
        call.resolve(r);
    }

    @PluginMethod
    public void setIcon(PluginCall call) {
        String name = call.getString("name", "");
        int i = indexOf(name);
        if (i < 0) { call.reject("未知图标：" + name); return; }
        try {
            switchTo(i);
            prefs().edit().putString(KEY_ICON, name).apply();
        } catch (Exception e) {
            call.reject("换图标失败：" + e.getMessage());
            return;
        }
        JSObject r = new JSObject();
        r.put("icon", current());
        call.resolve(r);
    }
}
