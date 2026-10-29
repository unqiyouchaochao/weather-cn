"""重新生成 weather-app/js/lib/nmc-stations.js —— 中国天气（nmc.cn）站点码表。

平时用不到；官方站点表变了、或想让按名称检索覆盖更全时才跑一次。
产物是纯静态文件，应用本身没有构建步骤。

    cd 到任一空目录后：python <仓库根>/tools/build-nmc-stations.py

外部依赖（只在构建期）：
  1) https://www.nmc.cn/rest/province/all + /rest/province/{省码}   → 站名与站点码（2529 站）
  2) https://geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json → 行政区中心点，用来配经纬度
     全国 34 省 + ~370 市，约 405 个请求 / 30MB，脚本会把每个响应缓存到 ./datav_cache/，重跑不再打网络。
"""
import json
import os
import time
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"}
CACHE = "datav_cache"
OUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "weather-app", "js", "lib", "nmc-stations.js")
NMC = "https://www.nmc.cn"
os.makedirs(CACHE, exist_ok=True)


def jget(url, cache_name=None):
    """带缓存的 GET：DataV 那 400 多个请求只打一次。"""
    p = os.path.join(CACHE, cache_name) if cache_name else None
    if p and os.path.exists(p):
        return json.loads(open(p, encoding="utf-8").read())
    txt = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read().decode("utf-8")
    if p:
        open(p, "w", encoding="utf-8").write(txt)
        time.sleep(0.12)
    return json.loads(txt)


def children(adcode):
    try:
        return jget("https://geo.datav.aliyun.com/areas_v3/bound/%s_full.json" % adcode, str(adcode) + ".json").get("features") or []
    except Exception as e:
        print("  miss", adcode, e)
        return []


def node(f):
    p = f.get("properties") or {}
    c = p.get("center") or f.get("centroid")
    if not c or not p.get("name"):
        return None
    return {"name": p["name"], "adcode": p.get("adcode"), "level": p.get("level"),
            "lon": round(float(c[0]), 3), "lat": round(float(c[1]), 3)}


# ---------- 1) 站点码：站名 nationwide 只有 7 组重名 ----------
stations = []
for p in jget(NMC + "/rest/province/all"):
    for s in jget(NMC + "/rest/province/" + p["code"]):
        stations.append({"city": s["city"], "code": s["code"], "province": p["name"]})
print("stations", len(stations))

# ---------- 2) 中心点：省 → 市 → 区县 ----------
divisions = {}


def add(d, prov):
    divisions.setdefault(d["name"], []).append(dict(d, prov=prov))


for pv in [x for x in map(node, children("100000")) if x]:
    add(pv, pv["name"])
    for ch in [x for x in map(node, children(pv["adcode"])) if x]:
        add(ch, pv["name"])
        if ch["level"] == "city":
            for gc in [x for x in map(node, children(ch["adcode"])) if x]:
                add(gc, pv["name"])
print("division names", len(divisions))

SUF = ("特别行政区", "自治区", "自治州", "自治县", "地区", "林区", "新区", "盟", "市", "区", "县", "旗")


def core(n):
    out = {n}
    for s in SUF:
        if n.endswith(s) and len(n) > len(s):
            out.add(n[: -len(s)])
    return out


def find(city, prov):
    pool = []
    for nm in core(city):
        for d in divisions.get(nm, []):
            pool.append((0 if nm == city else 1, 0 if d["prov"].startswith(prov[:2]) else 1, len(d["name"]), d))
    if not pool:
        return None
    return sorted(pool, key=lambda t: t[:3])[0][3]


rows, missed = [], 0
for s in stations:
    d = find(s["city"], s["province"])
    if d:
        rows.append((s["city"], s["code"], d["lat"], d["lon"]))
    else:
        # 没配上坐标的也保留：按站名查仍可用，只是不参与「只有坐标」的就近选站
        rows.append((s["city"], s["code"], "", ""))
        missed += 1
print("with coords", len(rows) - missed, "name-only", missed)

body = (
    "/* 中国天气（中央气象台 nmc.cn）站点码表：`站名|站点码|纬度|经度`，条目用 ; 分隔。\n"
    " * 由 tools/build-nmc-stations.py 生成（站点码来自 nmc.cn，经纬度按名称配 DataV 行政区中心点）。\n"
    " * 全国 2529 站仅 7 组重名，按名称匹配足够；经纬度供「只有坐标」的定位路径就近选站。\n"
    " * 没配上经纬度的站（约 70 个新设区划/林场）后两位留空，只能按名称命中。\n"
    " */\n"
    "export const NMC_ROWS = '" + ";".join("%s|%s|%s|%s" % r for r in rows) + "';\n"
)
open(OUT_PATH.replace("\\", "/"), "w", encoding="utf-8").write(body)
print("wrote", OUT_PATH, len(body.encode("utf-8")), "bytes")
