package com.weatherstudio.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Iterator;
import java.util.Locale;

/**
 * 划掉后台之后还要继续更新通知栏天气，以及继续盯气象预警。
 *
 * 形态是前台服务 + 一条 AlarmManager 节拍，**不养 WebView**：进程里只跑这一发 HTTP 和几个
 * JSON 取值，内存与电量都按最小算。文案不在这里重新实现一套天气逻辑 —— 前端每次刷新会把
 * 「要显示哪些段、每段从报文的哪个路径取值、单位怎么换算」交给过来（recipe），
 * 服务端换回来的 JSON 只按这份配方拼字符串，所以前后台说的是同一套话，不会各算各的。
 *
 * 节拍：预警开着 10 分钟一次，关掉就退成 60 分钟一次；通知正文只在满一小时的那一拍重建
 * （一小时内的其余拍只查预警，命中才发通知）。取一次报文两件事共用，不额外多打请求。
 *
 * 为什么用前台服务而不是 WorkManager：WorkManager 的周期任务最短 15 分钟，10 分钟这一档
 * 根本排不进去；而常驻通知本身就要一条 ongoing 通知，正好拿来当前台服务的驻留通知，
 * 不多弹一条。
 *
 * 每一拍的活都由 WeatherTickReceiver 自己跑（`goAsync()` 撑窗口），**服务不负责被闹钟叫醒**：
 * Android 14 起前台服务一概不许从后台拉起（我们声明的 `specialUse` 不例外），红米实测系统直接回 code:DENIED。
 * 服务的职责就剩两件：应用在前台时驻留那条常驻通知（省电平策略下不被回收），
 * 以及关掉常驻通知时干脆不起（前台服务必须挂通知，那等于把用户刚关掉的这条请回来）。
 *
 * 说清楚的边界：华为/小米的省电策略仍可能冻住或杀掉前台服务，这不是应用侧能完全保证的；
 * 红米实测**从最近任务里上滑清理 = 系统对本包做一次 Force stopping（日志里写明 SwipeUpClean）**，
 * 而 force-stop 会连带取消本应用所有待触发的闹钟与广播 —— 想让用户「划掉之后仍然自取」成立，
 * 必须在系统的应用设置里放行「自启动」（并把省电策略设为无限制），那是用户侧的一次性开关。
 */
public class WeatherKeepAliveService extends Service {

    public static final String ACTION_START = "com.weatherstudio.app.action.KEEP_ALIVE_START";
    public static final String ACTION_STOP = "com.weatherstudio.app.action.KEEP_ALIVE_STOP";
    public static final String ACTION_TICK = "com.weatherstudio.app.action.KEEP_ALIVE_TICK";

    static final String PREFS = "weather-keep-alive";
    static final String KEY_RECIPE = "recipe";
    static final String KEY_ALERT_SEEN = "alert-seen";
    private static final String KEY_LAST_LIVE = "last-live";
    private static final String KEY_LIVE_TITLE = "live-title";
    private static final String KEY_LIVE_TEXT = "live-text";
    private static final String KEY_TICK_AT = "tick-at";

    private static final String CHANNEL_LIVE = "weather-live";
    private static final String CHANNEL_ALERT = "weather-alert";
    private static final int NOTIF_LIVE = 1001;
    private static final int ALERT_ID_BASE = 2000;
    private static final int ALERT_ID_SPAN = 1000;

    private static final long WEATHER_MS = 60 * 60 * 1000L;
    private static final long ALERT_MS = 10 * 60 * 1000L;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? "" : String.valueOf(intent.getAction());
        if (ACTION_STOP.equals(action)) {
            cancelTick(this);
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        JSONObject r = recipe(this);
        if (r == null || !r.optBoolean("live", false)) {
            // 常驻通知被关了：没资格占前台位，这一拍交给广播自己跑（见 WeatherTickReceiver）
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            startForeground(NOTIF_LIVE, liveNotification(this, lastTitle(this), lastText(this)));
        } catch (Exception e) {
            /* 系统不放行前台服务（Android 14 起后台起 FGS 的限制、省电策略）：
               这一拍照常跑完，只是不驻留；下次进前台会再试 */
        }
        scheduleTick(this);        // 先排下一拍再干活，理由见 runTick 上面那段
        runTickAsync(this);
        return START_STICKY;
    }

    /** 一拍要跑网络，绝不能摊在主线程上（onStartCommand 卡 12 秒就是一个 ANR） */
    private static void runTickAsync(final Context ctx) {
        final Context app = ctx.getApplicationContext();
        new Thread(null, new Runnable() {
            @Override public void run() {
                try {
                    runTick(app);
                } catch (Exception e) {
                    /* 这一拍失败不影响下一拍：闹钟在干活之前就已经排好了 */
                }
            }
        }, "weather-tick").start();
    }

    @Override
    public void onDestroy() {
        // 服务被停（含用户关掉常驻通知）时把驻留那条一起带走，不然它会留在栏里划不掉
        stopForeground(true);
        // 闹钟**不在这里**取消：省电策略随时可能回收服务，取消了就再也没人把它排回来
        super.onDestroy();
    }

    /* ---------------- 节拍 ---------------- */

    /* 排下一拍。**排班时刻锚在 prefs 里，不按「现在 + 周期」重算**：这是一次性闹钟，
     * 而 onStartCommand 与广播都会调这里 —— 2026-09-25 在红米上量到进程被反复杀掉重启，
     * 每一次重启都把那一发推到 now+10min，于是待触发时刻一路往后滑
     * （00:31:50 → 00:35:08 → 00:44:48 → 01:02:18），**十分钟那一拍永远到不了**。
     * 锚住之后重复排班只是把同一时刻的那一发重新装上（进程死了闹钟会被系统清掉，必须重发），
     * 但期限不再被推走。节拍变快（刚打开预警）或那一发已经过期时才重算。 */
    static void scheduleTick(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        long every = alertWanted(ctx) ? ALERT_MS : WEATHER_MS;
        long now = System.currentTimeMillis();
        SharedPreferences sp = prefs(ctx);
        long at = sp.getLong(KEY_TICK_AT, 0L);
        if (at <= now || at - now > every) at = now + every;
        sp.edit().putLong(KEY_TICK_AT, at).apply();
        PendingIntent pi = tickIntent(ctx);
        // setAndAllowWhileIdle：省电模式下也会被叫醒一次，比 setInexactRepeating 靠谱，
        // 而且不需要「精确闹钟」权限（那个权限要用户去系统设置里单独放行）。
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                am.set(AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (Exception e) {
            /* 被 ROM 拒了也只能作罢：下一次进前台还会重新排 */
        }
    }

    static void cancelTick(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(tickIntent(ctx));
        // 锚点一起清掉：不然下次重新排时会沿用一个属于上一世的中止时刻
        prefs(ctx).edit().remove(KEY_TICK_AT).apply();
    }

    private static PendingIntent tickIntent(Context ctx) {
        Intent i = new Intent(ctx, WeatherTickReceiver.class);
        i.setAction(ACTION_TICK);
        int fl = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) fl |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(ctx, 4101, i, fl);
    }

    private static boolean alertWanted(Context ctx) {
        JSONObject r = recipe(ctx);
        return r != null && r.optBoolean("alertOn", false);
    }

    /** 一拍：取一次报文，预警随时查，通知正文只在满一小时的那一拍重建。
     *  **不负责排下一拍** —— 排班由调用方在干活之前先做好（见 WeatherTickReceiver 与 onStartCommand），
     *  否则进程正好在请求途中被回收，这条一次性闹钟的链就永远断在这里。 */
    static void runTick(Context ctx) {
        JSONObject r = recipe(ctx);
        if (r == null) return;
        String url = r.optString("url", "");
        if (url.length() < 8) return;

        String body = fetch(url);
        if (body == null) return;
        JSONObject json;
        try {
            json = new JSONObject(body);
        } catch (Exception e) {
            return;
        }
        if (r.optBoolean("alertOn", false)) checkAlert(ctx, json, r);
        if (!r.optBoolean("live", false)) return;
        long last = prefs(ctx).getLong(KEY_LAST_LIVE, 0L);
        if (System.currentTimeMillis() - last < WEATHER_MS) return;
        String text = buildText(json, r);
        if (text.length() == 0) return;
        String title = notificationTitle(r);
        /* 内容一个字没变就别重发。满一小时重建是「保新鲜」的上限，不是义务：夜里天气不动的时候，
         * 重发只是让 SystemUI 白重画一遍、并给这条常驻通知刷一次 postTime。
         * 门限照样往前推，下一次仍是满一小时才来看（不推的话每 10 分钟那一拍都会重比一次，白干活）。 */
        if (text.equals(prefs(ctx).getString(KEY_LIVE_TEXT, ""))
          && title.equals(prefs(ctx).getString(KEY_LIVE_TITLE, ""))) {
            prefs(ctx).edit().putLong(KEY_LAST_LIVE, System.currentTimeMillis()).apply();
            return;
        }
        notify(ctx, liveNotification(ctx, title, text));
        rememberLive(ctx, title, text);
    }

    /* ---------------- 取报文 ---------------- */

    private static String fetch(String spec) {
        HttpURLConnection c = null;
        try {
            URL u = new URL(spec);
            c = (HttpURLConnection) u.openConnection();
            c.setConnectTimeout(12000);
            c.setReadTimeout(12000);
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Mobile Safari/537.36");
            c.setRequestProperty("Accept", "application/json, text/plain, */*");
            // 对方有两道 WAF 会看 Referer（见 lib/alerts.js 那段），带 Referer 反而 403，这里刻意不带
            int code = c.getResponseCode();
            if (code < 200 || code >= 300) return null;
            BufferedReader br = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(1 << 14);
            String line;
            int n = 0;
            while ((line = br.readLine()) != null && n++ < 40000) {
                sb.append(line).append('\n');
                if (sb.length() > (1 << 20)) break;      // 1MB 封顶，别被异常响应撑爆
            }
            br.close();
            return sb.toString();
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /* ---------------- 按配方拼文案 ---------------- */

    /** 段序与单位都由前端交来的 fields 决定，缺值就跳过那一段（宁缺勿错，不拿旧值糊） */
    private static String buildText(JSONObject json, JSONObject r) {
        JSONArray fields = r.optJSONArray("fields");
        JSONObject paths = r.optJSONObject("paths");
        if (fields == null || paths == null) return "";
        boolean fahrenheit = "F".equals(r.optString("tempUnit", "C"));
        boolean kmh = "km/h".equals(r.optString("windUnit", "m/s"));

        StringBuilder out = new StringBuilder();
        for (int i = 0; i < fields.length(); i++) {
            String f = fields.optString(i, "");
            String seg = "";
            if ("temp".equals(f)) seg = temp(paths.optJSONArray("temp"), json, fahrenheit);
            else if ("desc".equals(f)) seg = str(paths.optJSONArray("desc"), json);
            else if ("range".equals(f)) {
                String mx = temp(paths.optJSONArray("tmax"), json, fahrenheit);
                String mn = temp(paths.optJSONArray("tmin"), json, fahrenheit);
                // 只有单边时补 "--"，与前端 fmtTemp(null) 的写法一致，别留一个光秃秃的「~25°」
                if (mx.length() > 0 || mn.length() > 0) seg = dash(mn) + "~" + dash(mx);
            } else if ("feels".equals(f)) {
                String v = temp(paths.optJSONArray("feels"), json, fahrenheit);
                if (v.length() > 0) seg = "体感" + v;
            } else if ("humidity".equals(f)) {
                String v = num(paths.optJSONArray("humidity"), json, 0);
                if (v.length() > 0) seg = "湿度" + v + "%";
            } else if ("wind".equals(f)) {
                // 报文给的是 m/s，要显示成什么由 windUnit 说；取整规则与 config.js 的 fmtWind 一致
                String v = num(paths.optJSONArray("wind"), json, 1);
                if (v.length() > 0) {
                    double ws = Double.parseDouble(v);
                    seg = kmh
                        ? Math.round(ws * 3.6) + " km/h"
                        : String.format(Locale.CHINA, "%.1f", ws) + " m/s";
                }
            } else if ("aqi".equals(f)) {
                // 后缀是「这组数从哪来的」而不是等级名：等级表在前端一份，后台再抄一份迟早对不上，
                // 而且口径本来就是通知栏里最该露出来的一项（宁缺勿错）
                String v = num(paths.optJSONArray("aqi"), json, 0);
                if (v.length() > 0) seg = "AQI" + v + " " + r.optString("aqiLabel", "");
            } else if ("time".equals(f)) {
                seg = new SimpleDateFormat("HH:mm", Locale.CHINA).format(new Date());
            }
            if (seg.length() > 0) {
                if (out.length() > 0) out.append(" · ");
                out.append(seg);
            }
        }
        return out.toString();
    }

    private static String dash(String s) {
        return s.length() > 0 ? s : "--";
    }

    private static String temp(JSONArray cand, JSONObject json, boolean f) {
        String raw = num(cand, json, 1);
        if (raw.length() == 0) return "";
        double v = Double.parseDouble(raw);
        if (f) v = v * 9.0 / 5.0 + 32.0;
        return String.valueOf(Math.round(v)) + "°" + (f ? "F" : "");
    }

    private static String num(JSONArray cand, JSONObject json, int decimals) {
        Double v = pickNumber(cand, json);
        if (v == null) return "";
        if (decimals <= 0) return String.valueOf(Math.round(v));
        return String.format(Locale.CHINA, "%." + decimals + "f", v);
    }

    private static String str(JSONArray cand, JSONObject json) {
        Object v = pick(cand, json);
        return v == null ? "" : String.valueOf(v).trim();
    }

    private static Double pickNumber(JSONArray cand, JSONObject json) {
        Object v = pick(cand, json);
        if (v == null) return null;
        try {
            double d = Double.parseDouble(String.valueOf(v).trim());
            // 9000 以上是这个报文体系的缺测值（气压给 9999、温度给 9999.0）
            if (d >= 9000 || d <= -9000) return null;
            return d;
        } catch (Exception e) {
            return null;
        }
    }

    /** 依次试每条候选路径，第一个**取得到值**的算数（候选顺序由前端按当前报文形态决定）。
     *  判「取得到值」必须在这里做而不能交给调用方：否则 9999 会把候选位置占住，
     *  后面那条真正的退路永远轮不到 —— 当天 20 点后 detail[0].day 整格变 9999 就是这一种。 */
    private static Object pick(JSONArray cand, JSONObject json) {
        if (cand == null) return null;
        for (int i = 0; i < cand.length(); i++) {
            Object v = resolve(json, cand.optString(i, ""));
            if (usable(v)) return v;
        }
        return null;
    }

    /** 该报文体系的缺测写法：数字段是 9999/9999.0，描述段是空串或 "-" */
    private static boolean usable(Object v) {
        if (v == null || v.equals(JSONObject.NULL)) return false;
        String s = String.valueOf(v).trim();
        return s.length() > 0 && !"-".equals(s) && !"null".equals(s)
            && !"9999".equals(s) && !"9999.0".equals(s);
    }

    /**
     * 极简路径取值：{@code data.real.weather.temperature}、数组下标 {@code detail[0].day}、
     * 以及按字段匹配 {@code tempchart[time={today}].max_temp}。{@code {today}} 由这里替换成
     * yyyy-MM-dd —— 后台跨零点时「今天」会变，不能由前端算好传进来。
     */
    static Object resolve(Object node, String path) {
        if (node == null || path == null || path.length() == 0) return null;
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).format(new Date());
        String[] bits = path.split("\\.");
        Object cur = node;
        for (String bit : bits) {
            String key = bit, idx = null;
            int br = bit.indexOf('[');
            if (br >= 0 && bit.endsWith("]")) {
                key = bit.substring(0, br);
                idx = bit.substring(br + 1, bit.length() - 1);
            }
            try {
                if (cur instanceof JSONObject) {
                    if (key.length() > 0) cur = ((JSONObject) cur).opt(key);
                    else return null;
                } else if (cur instanceof JSONArray && key.length() == 0) {
                    /* 纯下标段，下面处理 */
                } else {
                    return null;
                }
                if (idx == null) continue;
                if (idx.indexOf('=') < 0) {
                    int n = Integer.parseInt(idx);
                    if (!(cur instanceof JSONArray) || n >= ((JSONArray) cur).length()) return null;
                    cur = ((JSONArray) cur).get(n);
                    continue;
                }
                String[] kv = idx.split("=", 2);
                String want = normDate(kv[1].replace("{today}", today));
                if (!(cur instanceof JSONArray)) return null;
                JSONArray arr = (JSONArray) cur;
                cur = null;
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.optJSONObject(i);
                    // 该源的日期串是 2026/09/22 这种斜杠形式，两边都归一到 yyyy-MM-dd 再比
                    if (o != null && want.equals(normDate(String.valueOf(o.opt(kv[0]))))) { cur = o; break; }
                }
                if (cur == null) return null;
            } catch (Exception e) {
                return null;
            }
        }
        if (cur == null || cur.equals(JSONObject.NULL)) return null;
        return cur;
    }

    /** {@code 2026/09/22}、{@code 2026-09-22 00:00} 都算同一天：斜杠换横杠、只留前 10 位。
     *  实测这份报文两个字段给的都已是横杠形式，归一只是不给不同写法留死角。 */
    private static String normDate(String s) {
        if (s == null) return "";
        String t = s.trim().replace('/', '-');
        return t.length() >= 10 ? t.substring(0, 10) : t;
    }

    /* ---------------- 预警 ---------------- */

    private static void checkAlert(Context ctx, JSONObject json, JSONObject r) {
        JSONObject paths = r.optJSONObject("alertPaths");
        if (paths == null) return;
        String type = str(paths.optJSONArray("type"), json);
        String level = str(paths.optJSONArray("level"), json);
        String text = str(paths.optJSONArray("text"), json);
        if (text.length() == 0) text = str(paths.optJSONArray("alt"), json);
        if (type.length() == 0 && text.length() == 0) return;      // 全空（含 9999 哨兵）= 该站此刻没有预警

        String url = str(paths.optJSONArray("url"), json);
        String pic = str(paths.optJSONArray("pic"), json);
        java.util.regex.Matcher um = java.util.regex.Pattern.compile("/alarm/(\\d{6})\\d*_(\\d{14})").matcher(url);
        String tag = um.find() ? um.group() : (type + "|" + level + "|" + text.substring(0, Math.min(24, text.length())));

        int rank = rankOf(level, pic);
        int min = r.optInt("alertMinRank", 2);
        if (rank < min) return;

        String station = str(paths.optJSONArray("station"), json);
        StringBuilder where = new StringBuilder();
        String prov = str(paths.optJSONArray("province"), json);
        String city = str(paths.optJSONArray("city"), json);
        if (prov.length() > 0) where.append(prov).append(' ');
        if (city.length() > 0) where.append(city);
        if (station.length() > 0 && where.indexOf(station) < 0) where.append(' ').append(station);

        String title = (type + level).trim().length() > 0 ? type + shortLevel(level) + "预警" : "气象预警";
        String body = (where.toString().trim().length() > 0 ? where.toString().trim() + " " : "") + text;
        deliverAlert(ctx, tag, rank, title, body);
    }

    /**
     * 发一条预警通知，**带去重**：同一条（tag）且级别没升过就不再吵。
     * 前台（插件的 alert）与后台（上面那个 checkAlert）走同一个判定、同一份记账，
     * 否则后台先弹过一次、用户再打开应用又会被同一条预警炸一次。
     * 返回 false 表示「这条不该再弹」或系统不允许弹 —— 调用方据此决定要不要落自己的账。
     */
    static boolean deliverAlert(Context ctx, String tag, int rank, String title, String text) {
        JSONObject seen = readSeen(ctx);
        JSONObject prev = seen.optJSONObject(tag);
        if (prev != null && prev.optInt("rank", 0) >= rank) return false;
        if (!postAlert(ctx, tag, title, text)) return false;
        mark(seen, tag, rank);
        prune(seen);
        prefs(ctx).edit().putString(KEY_ALERT_SEEN, seen.toString()).apply();
        return true;
    }

    private static void mark(JSONObject seen, String tag, int rank) {
        try {
            JSONObject v = new JSONObject();
            v.put("rank", rank);
            v.put("at", System.currentTimeMillis());
            seen.put(tag, v);
        } catch (Exception e) { /* 只在键为 null 时抛，这里不会 */ }
    }

    /** 「黄色」→「黄」：源给的是带色字的全名，通知里连写两遍会成「雷电黄色黄色预警」 */
    private static String shortLevel(String lv) {
        if (lv == null) return "";
        return lv.replace("红色", "红").replace("橙色", "橙").replace("黄色", "黄").replace("蓝色", "蓝");
    }

    /** 级别 rank：红4 橙3 黄2 蓝1；signallevel 缺失时退回 pic 文件名末三位（001红 002橙 003黄 004蓝） */
    private static int rankOf(String level, String pic) {
        String lv = level == null ? "" : level.replace("色", "");
        if ("红".equals(lv)) return 4;
        if ("橙".equals(lv)) return 3;
        if ("黄".equals(lv)) return 2;
        if ("蓝".equals(lv)) return 1;
        java.util.regex.Matcher pm = java.util.regex.Pattern.compile("p\\d{4}(00[1-4])").matcher(pic == null ? "" : pic);
        if (pm.find()) {
            String c = pm.group(1);
            if ("001".equals(c)) return 4;
            if ("002".equals(c)) return 3;
            if ("003".equals(c)) return 2;
            if ("004".equals(c)) return 1;
        }
        return 0;
    }

    private static JSONObject readSeen(Context ctx) {
        try {
            String s = prefs(ctx).getString(KEY_ALERT_SEEN, "");
            if (s != null && s.length() > 1) return new JSONObject(s);
        } catch (Exception e) { /* 坏了当没有 */ }
        return new JSONObject();
    }

    /** 只留 7 天：预警条文是「区县码+时刻」，一条条累积下去会撑爆 */
    private static void prune(JSONObject seen) {
        long cut = System.currentTimeMillis() - 7 * 86400000L;
        /* 先把该删的键攒起来，迭代结束再删。**边迭代边 remove 会抛 ConcurrentModificationException**：
         * JSONObject.keys() 给的是内部 LinkedHashMap 的迭代器。这个雷是 date-triggered 的 ——
         * 只有真的存在满 7 天的那一条时才走到 remove，所以装机后第七天开始，每一次 alert 都炸
         * 在 CapacitorPlugins 线程上（未捕获 ⇒ 整个应用重启），而开发机上永远验不到。 */
        java.util.List<String> dead = new java.util.ArrayList<>();
        Iterator<String> it = seen.keys();
        while (it.hasNext()) {
            String k = it.next();
            JSONObject v = seen.optJSONObject(k);
            if (v == null || v.optLong("at", 0) < cut) dead.add(k);
        }
        for (String k : dead) seen.remove(k);
    }

    /* ---------------- 通知 ---------------- */

    private static boolean postAlert(Context ctx, String tag, String title, String text) {
        NotificationManager m = mgr(ctx);
        if (m == null) return false;
        ensureAlertChannel(ctx, m);
        int id = ALERT_ID_BASE + (Math.abs(tag.hashCode()) % ALERT_ID_SPAN);
        Notification n = new NotificationCompat.Builder(ctx, CHANNEL_ALERT)
            .setSmallIcon(R.drawable.ic_stat_weather)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(openApp(ctx, id))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build();
        m.notify(id, n);
        return m.areNotificationsEnabled();
    }

    private static Notification liveNotification(Context ctx, String title, String text) {
        NotificationManager m = mgr(ctx);
        if (m != null) ensureLiveChannel(ctx, m);
        return new NotificationCompat.Builder(ctx, CHANNEL_LIVE)
            .setSmallIcon(R.drawable.ic_stat_weather)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(openApp(ctx, 0))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build();
    }

    private static void notify(Context ctx, Notification n) {
        NotificationManager m = mgr(ctx);
        if (m != null) m.notify(NOTIF_LIVE, n);
    }

    /* 常驻那条「最后一次真实内容」记在这里，两个用处：
     *   1) 服务被系统回收后重新起来，驻留通知先用上一次的文本占位，而不是干挂一句「正在获取天气…」
     *      —— 一小时门限没到的那段时间里，这句空话会一直摆在栏里；
     *   2) 门限量的是「这条通知上次真的换过内容」，前台每次刷新也算，所以应用一直开着时，
     *      后台那一拍不会为了同一件刚更新过的事再打一发请求。 */
    static void rememberLive(Context ctx, String title, String text) {
        prefs(ctx).edit()
            .putLong(KEY_LAST_LIVE, System.currentTimeMillis())
            .putString(KEY_LIVE_TITLE, title)
            .putString(KEY_LIVE_TEXT, text)
            .apply();
    }

    static String lastTitle(Context ctx) {
        String t = prefs(ctx).getString(KEY_LIVE_TITLE, "");
        return t == null || t.length() == 0 ? "天气" : t;
    }

    static String lastText(Context ctx) {
        String t = prefs(ctx).getString(KEY_LIVE_TEXT, "");
        return t == null || t.length() == 0 ? "正在获取天气…" : t;
    }

    private static String notificationTitle(JSONObject r) {
        return titleOf(r == null ? "" : r.optString("title", ""));
    }

    private static String titleOf(String t) {
        return t == null || t.trim().length() == 0 ? "天气" : t;
    }

    private static PendingIntent openApp(Context ctx, int requestCode) {
        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int fl = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) fl |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(ctx, requestCode, open, fl);
    }

    private static NotificationManager mgr(Context ctx) {
        return (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
    }

    private static void ensureLiveChannel(Context ctx, NotificationManager m) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || m.getNotificationChannel(CHANNEL_LIVE) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_LIVE, "实时天气", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("在通知栏常驻一条当前天气");
        ch.setShowBadge(false);
        m.createNotificationChannel(ch);
    }

    private static void ensureAlertChannel(Context ctx, NotificationManager m) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || m.getNotificationChannel(CHANNEL_ALERT) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ALERT, "气象预警", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("发布新的气象灾害预警信号时提醒");
        ch.setShowBadge(true);
        ch.enableVibration(true);
        m.createNotificationChannel(ch);
    }

    /* ---------------- 存档 ---------------- */

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static JSONObject recipe(Context ctx) {
        try {
            String s = prefs(ctx).getString(KEY_RECIPE, "");
            if (s == null || s.length() < 2) return null;
            return new JSONObject(s);
        } catch (Exception e) {
            return null;
        }
    }
}
