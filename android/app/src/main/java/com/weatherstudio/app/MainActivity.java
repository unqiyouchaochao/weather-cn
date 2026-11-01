package com.weatherstudio.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * 自建插件必须在 super.onCreate() 之前注册：BridgeActivity 在 onCreate 里就把
 * bridgeBuilder 建成 bridge，之后再加就晚了。
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeLocationPlugin.class);
        registerPlugin(WeatherNotifyPlugin.class);
        registerPlugin(AppIconPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
