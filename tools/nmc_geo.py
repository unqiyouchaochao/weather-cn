"""nmc 站点码表用的地理校验：省界多边形来自 DataV，判定「这个点真的属于这个省吗」。

为什么需要它：码表里的经纬度是我们按站名去配 DataV 行政区中心点得到的，而全国同名区县一大把
（「河南」既是河南省，也是青海的河南蒙古族自治县；「海南」既是海南省，也是青海的海南州、
内蒙古的海南区）。只按名字配就会把 A 省的站配到 B 省的中心点上 —— 界面上看不出来，
拿到的却是几百公里外那个省的天气。省界多边形 + 点在不在里面，是唯一不依赖命名的判据。

边界缓存放在 tools/datav_cache/（一个请求 580KB，可再生，不进版本库）。
"""
import json
import os

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"}
BOUND_URL = "https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json"
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "datav_cache")


def _rings(geom):
    """把 Polygon / MultiPolygon 摊平成「环」的列表，每个环是 [lon, lat] 序列。"""
    out = []

    def walk(c):
        if isinstance(c[0][0], (int, float)):
            if len(c) > 3:
                out.append(c)
            return
        for x in c:
            walk(x)

    if geom and geom.get("coordinates"):
        walk(geom["coordinates"])
    return out


def province_polygons(cache_dir=CACHE_DIR):
    """省名 → 该省所有环。缓存命中就不打网络。"""
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, "prov-bound.json")
    if not os.path.exists(path):
        import urllib.request
        open(path, "w", encoding="utf-8").write(
            urllib.request.urlopen(urllib.request.Request(BOUND_URL, headers=UA), timeout=120).read().decode("utf-8"))
    feats = json.load(open(path, encoding="utf-8"))["features"]
    poly = {}
    for f in feats:
        p = f.get("properties") or {}
        name = str(p.get("name") or "").replace(" ", "")
        # DataV 还回了一条十段线之类的辅助要素，没有 adcode 或名字不像行政区，跳过
        if not name or not str(p.get("adcode") or "").isdigit():
            continue
        rs = _rings(f.get("geometry"))
        if rs:
            poly[name] = rs
    return poly


def point_in(lon, lat, rings):
    """射线法，偶数条边判定；环有洞也没关系（洞的边同样参与奇偶）。"""
    hit = False
    for r in rings:
        for i in range(len(r) - 1):
            x1, y1 = r[i][0], r[i][1]
            x2, y2 = r[i + 1][0], r[i + 1][1]
            if (y1 > lat) != (y2 > lat):
                xint = (x2 - x1) * (lat - y1) / (y2 - y1) + x1
                if lon < xint:
                    hit = not hit
    return hit


MARGIN = 0.12   # ≈13km：省界画得粗、台站也可能贴着界，留一点余量免得误杀


def in_province(lon, lat, name, poly, margin=MARGIN):
    """点落在该省内，或落在边界外 margin 度以内，都算「属于这个省」。"""
    rings = poly.get(name)
    if not rings:
        return None                      # 省名对不上（命名差异），不下判断
    steps = [(0, 0), (margin, 0), (-margin, 0), (0, margin), (0, -margin),
             (margin, margin), (-margin, -margin), (margin, -margin), (-margin, margin)]
    for dx, dy in steps:
        if point_in(lon + dx, lat + dy, rings):
            return True
    return False
