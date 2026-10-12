/* 天气助手 Service Worker —— 缓存应用壳，支持离线打开。
 * 天气 API 为跨域请求，一律走网络（不缓存），保证数据实时。
 * 改完任何 js/css/html 必须升一次 CACHE，否则老用户拿到的仍是旧壳。
 * SHELL 那份清单不手写：`node tools/gen-shell.mjs`（npm run apk 第一句就跑它）按磁盘上的文件重写，
 * 手写漏一项是「联网一切正常、离线才白屏」那种 bug。 */
/* 号段跳到 v138：main 分支那一侧的工作树已经用到 v137，两条线共用一个号会退化成旧缓存。 */
const CACHE = 'weather-studio-v138';
/* SHELL:BEGIN 这份清单由 tools/gen-shell.mjs 生成，别手工增删 */
const SHELL = [
  './',
  './icon.svg',
  './index.html',
  './manifest.webmanifest',
  './styles.css',
  './js/boot.js',
  './js/favorite.js',
  './js/lib/alerts.js',
  './js/lib/almanac.js',
  './js/lib/appicon.js',
  './js/lib/aqi.js',
  './js/lib/config.js',
  './js/lib/disclosures.js',
  './js/lib/dom.js',
  './js/lib/favorites.js',
  './js/lib/ganzhi.js',
  './js/lib/geo.js',
  './js/lib/glass.js',
  './js/lib/horoscope.js',
  './js/lib/hourly.js',
  './js/lib/hwAqi.js',
  './js/lib/icon-data.js',
  './js/lib/icons.js',
  './js/lib/idb.js',
  './js/lib/locate.js',
  './js/lib/news.js',
  './js/lib/notify.js',
  './js/lib/sheet.js',
  './js/lib/themePlugin.js',
  './js/lib/themeScan.js',
  './js/lib/themes.js',
  './js/lib/util.js',
  './js/lib/weather.js',
  './js/locate.js',
  './js/main.js',
  './js/providers/chinaWeather.js',
  './js/providers/custom.js',
  './js/providers/index.js',
  './js/providers/mapping.js',
  './js/providers/mojiWeather.js',
  './js/providers/openMeteo.js',
  './js/providers/wttrIn.js',
  './js/query.js',
  './js/refresh.js',
  './js/settings/alerts.js',
  './js/settings/appearance.js',
  './js/settings/behavior.js',
  './js/settings/disclosures.js',
  './js/settings/icon.js',
  './js/settings/index.js',
  './js/settings/notify.js',
  './js/settings/source.js',
  './js/settings/themePlugins.js',
  './js/share.js',
  './js/suggest.js',
  './js/tabs.js',
  './js/ui.js',
  './js/ui/air.js',
  './js/ui/alerts.js',
  './js/ui/charts.js',
  './js/ui/compare.js',
  './js/ui/export.js',
  './js/ui/fortune.js',
  './js/ui/home.js',
  './js/ui/hours.js',
  './js/ui/news.js',
  './js/ui/place.js',
  './js/ui/rank.js',
  './js/ui/render.js',
  './js/ui/status.js',
  './js/ui/theme.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;        // 跨域（天气 API）走网络
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit =>
      hit || fetch(e.request).then(resp => {
        const cp = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, cp));
        return resp;
      }).catch(() => caches.match('./index.html'))
    )
  );
});
