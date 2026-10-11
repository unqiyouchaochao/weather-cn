"""清洗 weather-app/js/lib/nmc-stations.js 里配错的经纬度。

判据（唯一不依赖命名的那一条）：站点的经纬度**落在另一个省的多边形里**才算配错。
站点归属省由 nmc 的 /rest/province/{省码} 给出，权威的；经纬度是我们自己配的，可能配错。
配错的清空坐标 —— 清空的站只是不参与「只有坐标」的就近选站，按站名查照样能用；
留着错坐标则是「拿几百公里外的天气当你的」。

为什么必须要求「落在别的省」而不是「不在本省」：三沙、南沙的站配在南海海面上，
哪个省的多边形都不含它，坐标却是对的（DataV 的省界不画岛礁）。只有「点落在另一个省里」
才是同名配到别省中心点的确切签名 —— 省界画得粗的海边/飞地站不会被误杀。

    cd tools && PYTHONUTF8=1 python repair-nmc-coords.py            # 看清单
    cd tools && PYTHONUTF8=1 python repair-nmc-coords.py --write    # 真改文件
"""
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nmc_geo import UA, CACHE_DIR, province_polygons, in_province, point_in   # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
TABLE = os.path.join(ROOT, "weather-app", "js", "lib", "nmc-stations.js")
NMC = "https://www.nmc.cn"
WRITE = "--write" in sys.argv


def station_provinces():
    """code → (省名, 站名)，来自 nmc 自己的省列表；缓存下来重跑不打网络。"""
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, "nmc-prov.json")
    if os.path.exists(path):
        return json.load(open(path, encoding="utf-8"))
    def get(url):
        return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read().decode("utf-8"))
    out = {}
    for p in get(NMC + "/rest/province/all"):
        for s in get(NMC + "/rest/province/" + p["code"]):
            out[s["code"]] = [p["name"], s["city"]]
        time.sleep(0.12)
    open(path, "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False))
    return out


text = open(TABLE, encoding="utf-8").read()
head, body = text.split("export const NMC_ROWS = '", 1)
rows = [r.split("|") for r in body.split("'")[0].split(";") if r]
prov = station_provinces()
poly = province_polygons()

dirty, unknown, kept, seakept = [], 0, 0, 0
NAMES = list(poly.keys())


def owner(lon, lat):
    """这个点落在哪个省。海面/境外返回 None。"""
    for n in NAMES:
        if point_in(lon, lat, poly[n]):
            return n
    return None


for r in rows:
    name, code = r[0], r[1]
    if len(r) < 4 or r[2] == "" or r[3] == "":
        continue
    lat, lon = float(r[2]), float(r[3])
    pv = prov.get(code, [None, None])[0]
    if not pv:
        unknown += 1
        continue
    if in_province(lon, lat, pv, poly):        # 在本省内（含边界余量），没问题
        kept += 1
        continue
    o = owner(lon, lat)
    if o is None or o == pv:
        seakept += 1                           # 海面上的站（三沙、南沙）：坐标是对的，别动
        continue
    dirty.append((name, code, lat, lon, pv, o))

print("行 %d / 坐标在本省 %d / 海面等保留 %d / 落在别省待清 %d / 省名对不上跳过 %d"
      % (len(rows), kept, seakept, len(dirty), unknown))
for name, code, lat, lon, pv, o in dirty:
    print("  清空 %s|%s  存的点 %s,%s 在%s，可它属于%s" % (name, code, lat, lon, o, pv))

if not dirty:
    print("没有要改的。")
    sys.exit(0)

if not WRITE:
    print("\n（只看了清单，没动文件。加 --write 才写。）")
    sys.exit(0)

blanked = set(c for _, c, _, _, _, _ in dirty)
out_rows = []
for r in rows:
    if r[1] in blanked and len(r) >= 4:
        out_rows.append("%s|%s||" % (r[0], r[1]))
    else:
        out_rows.append("|".join(r[:4]))
head = head.replace(" * 没配上经纬度的站", " * 没配上或坐标被判错（省界对不上）而清空经纬度的站")
new = head + "export const NMC_ROWS = '" + ";".join(out_rows) + "';\n"
open(TABLE, "w", encoding="utf-8").write(new)
print("已写回 %s（清空 %d 个站的坐标）" % (os.path.abspath(TABLE), len(blanked)))
