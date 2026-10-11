#!/usr/bin/env python3
"""Bake the Kaduna game layout from real OSM data.

Output: frontend/app/utils/kadunaBake.json - a compact, precomputed layout
that the game client renders directly (no OSM logic in the browser).

Conventions (Three.js): +X = east, +Z = south, 1 unit = 10 m.
Origin: Murtala Square (10.5332 N, 7.4413 E).

Data: (c) OpenStreetMap contributors, ODbL. Geometry is stylized and
approximate; landmark positions follow OSM where mapped.
"""

import json
import math
import random

RAW = "/home/z/my-project/kaduna-osm-raw"
OUT = "/home/z/my-project/kaduna-kulture/frontend/app/utils/kadunaBake.json"

ORIGIN = (10.5332, 7.4413)
M_PER_DEG_LAT = 110_900.0
M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(ORIGIN[0]))
random.seed(20261011)

def proj(lat, lon):
    return (lon - ORIGIN[1]) * M_PER_DEG_LON / 10.0, -(lat - ORIGIN[0]) * M_PER_DEG_LAT / 10.0

def load(name):
    return json.load(open(f"{RAW}/{name}.json"))["elements"]

# ---------------------------------------------------------------- helpers
def seg_dist(px, pz, ax, az, bx, bz):
    vx, vz = bx - ax, bz - az
    l2 = vx * vx + vz * vz
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((px - ax) * vx + (pz - az) * vz) / l2))
    return math.hypot(px - (ax + t * vx), pz - (az + t * vz)), t

def dist_to_polylines(x, z, lines):
    best = 1e18
    for pts in lines:
        for i in range(len(pts) - 1):
            d, _ = seg_dist(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
            if d < best:
                best = d
                if best < 1.0:
                    return best
    return best

def segs_intersect(a, b, c, d):
    def ccw(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    def on(p, q, r):
        return min(p[0], r[0]) - 1e-9 <= q[0] <= max(p[0], r[0]) + 1e-9 and \
               min(p[1], r[1]) - 1e-9 <= q[1] <= max(p[1], r[1]) + 1e-9 and \
               abs(ccw(p, q, r)) < 1e-9
    d1, d2, d3, d4 = ccw(a, b, c), ccw(a, b, d), ccw(c, d, a), ccw(c, d, b)
    if ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0)):
        return True
    if abs(d1) < 1e-9 and on(a, c, b): return True
    if abs(d2) < 1e-9 and on(a, d, b): return True
    if abs(d3) < 1e-9 and on(c, a, d): return True
    if abs(d4) < 1e-9 and on(c, b, d): return True
    return False

def point_in_poly(x, z, poly):
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, zi = poly[i][0], poly[i][1]
        xj, zj = poly[j][0], poly[j][1]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside

def dp_keep(pts, tol_m):
    """Douglas-Peucker in meters (approx: 1 deg lat = 11090 m)."""
    tol = tol_m / 110_900.0
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        ax, ay = pts[a][1], pts[a][0]
        bx, by = pts[b][1], pts[b][0]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy) or 1e-12
        dmax, imax = -1.0, -1
        for i in range(a + 1, b):
            d = abs((pts[i][1] - ax) * dy - (pts[i][0] - ay) * dx) / norm
            if d > dmax:
                dmax, imax = d, i
        if dmax > tol:
            keep[imax] = True
            stack.append((a, imax))
            stack.append((imax, b))
    return [p for p, k in zip(pts, keep) if k]

def in_bounds(pts):
    return any(-1500 <= x <= 800 and -1150 <= z <= 1500 for x, z in pts)

# ---------------------------------------------------------------- river
def stitch(elements, name_pred=None):
    segs = []
    for e in elements:
        tags = e.get("tags", {})
        if name_pred and not name_pred(tags.get("name", "")):
            continue
        g = e.get("geometry") or []
        pts = [(p["lat"], p["lon"]) for p in g]
        if len(pts) >= 2:
            segs.append(pts)
    used = [False] * len(segs)
    def key(p): return (round(p[0], 5), round(p[1], 5))
    chains = []
    for i in range(len(segs)):
        if used[i]:
            continue
        chain = list(segs[i]); used[i] = True
        changed = True
        while changed:
            changed = False
            ks, ke = key(chain[0]), key(chain[-1])
            for j in range(len(segs)):
                if used[j]:
                    continue
                js, je = key(segs[j][0]), key(segs[j][-1])
                if je == ks: chain = segs[j] + chain
                elif js == ke: chain = chain + segs[j]
                elif js == ks: chain = list(reversed(segs[j])) + chain
                elif je == ke: chain = chain + list(reversed(segs[j]))
                else: continue
                used[j] = True; changed = True; break
        if len(chain) >= 3:
            chains.append(chain)
    return chains

river_chains = stitch(load("river"), lambda n: n.lower() in ("kaduna", "r. kaduna", "kaduna river"))
all_chains = stitch(load("river"), lambda n: True)
river_chains.sort(key=len, reverse=True)
main = dp_keep(river_chains[0], 14.0)
river_main = [list(proj(*p)) for p in main]
print(f"river main: {len(river_main)} pts")

# side channels: longest other chains passing near the city window
side = []
for c in all_chains[1:]:
    pts = [proj(*p) for p in dp_keep(c, 16.0)]
    inbox = [p for p in pts if -1500 <= p[0] <= 1500 and -1100 <= p[1] <= 1600]
    if len(inbox) >= 4:
        side.append(pts)
side.sort(key=len, reverse=True)
side = side[:2]
print(f"river side channels: {[len(s) for s in side]}")

# ---------------------------------------------------------------- roads
MANUAL_ROADS = [
    # name, class, points (game units)
    ("Zaria Road", "trunk", [(80, -631), (140, -760), (180, -950), (200, -1120)]),
    ("Jos Road", "trunk", [(180, -450), (262, -690), (300, -880), (330, -1080)]),
    ("Airport Road", "primary", [(-500, -640), (-200, -680), (51, -699), (250, -700)]),
    ("NDA Road", "primary", [(-500, -640), (-620, -790), (-705, -939)]),
    ("Coronation Road", "secondary", [(-30, -20), (30, 30), (100, 68), (185, 72), (280, 30), (360, -30)]),
    ("Kachia Road Link", "secondary", [(-140, 700), (-100, 850), (-60, 980), (20, 1080)]),
]

roads = []
for e in load("roads"):
    t = e.get("tags", {})
    nm = t.get("name")
    if not nm:
        continue
    g = e.get("geometry") or []
    pts = [(p["lat"], p["lon"]) for p in g]
    if len(pts) < 2:
        continue
    pts = dp_keep(pts, 14.0)
    pl = [[round(v, 1) for v in proj(*p)] for p in pts]
    if in_bounds(pl):
        roads.append({"name": nm, "class": t.get("highway", "secondary"), "pts": pl})
for nm, cls, pts in MANUAL_ROADS:
    roads.append({"name": nm, "class": cls, "pts": [[float(x), float(z)] for x, z in pts]})
print(f"roads: {len(roads)}")

# ---------------------------------------------------------------- rail
rail_raw = stitch(load("rail"), None)
rail = []
for c in rail_raw:
    pts = [proj(*p) for p in dp_keep(c, 16.0)]
    if len(pts) >= 6 and in_bounds(pts):
        rail.append([[round(x, 1), round(z, 1)] for x, z in pts])
rail.sort(key=len, reverse=True)
rail = rail[:12]
print(f"rail lines: {len(rail)} lens={[len(r) for r in rail]}")

# ---------------------------------------------------------------- airport
runway, apron = None, None
for e in load("aeroway"):
    t = e.get("tags", {})
    g = e.get("geometry") or []
    if t.get("aeroway") == "runway" and len(g) >= 2:
        runway = [list(proj(p["lat"], p["lon"])) for p in g]
    if t.get("aeroway") == "apron" and len(g) >= 3 and apron is None:
        xs = [proj(p["lat"], p["lon"])[0] for p in g]
        zs = [proj(p["lat"], p["lon"])[1] for p in g]
        apron = {"x": sum(xs) / len(xs), "z": sum(zs) / len(zs),
                 "w": max(xs) - min(xs), "d": max(zs) - min(zs)}
print(f"runway: {runway and len(runway)} apron: {apron}")

# ---------------------------------------------------------------- bridges
bridges = []
for r in roads:
    pts = r["pts"]
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        hit = None
        for k in range(len(river_main) - 1):
            c, d = river_main[k], river_main[k + 1]
            if segs_intersect(a, b, c, d):
                # intersection point (parametric on road seg)
                x1, y1, x2, y2 = a[0], a[1], b[0], b[1]
                x3, y3, x4, y4 = c[0], c[1], d[0], d[1]
                den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
                if abs(den) < 1e-9:
                    continue
                t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
                hit = (x1 + t * (x2 - x1), y1 + t * (y2 - y1))
                break
        if hit:
            ang = math.atan2(b[1] - a[1], b[0] - a[0])
            bridges.append({"name": r["name"], "x": round(hit[0], 1), "z": round(hit[1], 1),
                            "rot": round(ang, 3), "w": 3.2 if r["class"] in ("trunk", "primary") else 2.2})
seen = set()
bridges = [b for b in bridges if (b["name"], round(b["x"] / 20), round(b["z"] / 20)) not in seen
           and not seen.add((b["name"], round(b["x"] / 20), round(b["z"] / 20)))]
# drop bridges far outside the play area
bridges = [b for b in bridges if -1500 <= b["x"] <= 800 and -1150 <= b["z"] <= 1500]
print(f"bridges: {[(b['name'], b['x'], b['z']) for b in bridges]}")

# ---------------------------------------------------------------- landmarks
# kind drives authored geometry in KadunaCity.vue; kw/kd = keepout meters
LANDMARKS = [
    # key, name, x, z, kind, kw, kd, label_h
    ("murtala_square", "Murtala Square", 0, 0, "square", 70, 70, 22),
    ("central_market", "Kaduna Central Market", -80, 102, "market", 130, 90, 26),
    ("abs_stadium", "Ahmadu Bello Stadium", -143, 370, "stadium", 95, 75, 30),
    ("st_joseph", "St. Joseph's Cathedral", -135, 440, "cathedral", 40, 55, 26),
    ("golf_club", "Kaduna Golf Club", 76, 125, "golf", 130, 110, 0),
    ("gov_house", "Government House", -263, 58, "govhouse", 80, 60, 20),
    ("national_museum", "National Museum", 8, 24, "museum", 40, 34, 16),
    ("arewa_house", "Arewa House", -20, -164, "label", 40, 30, 0),
    ("bello_mosque", "Sultan Bello Mosque", 46, -195, "mosque", 70, 60, 30),
    ("hamdala", "Hamdala Hotel", 10, 43, "hotel", 40, 30, 24),
    ("nta", "NTA Kaduna", -28, 107, "mast", 34, 26, 0),
    ("kasu", "Kaduna State University", 114, 151, "campus", 90, 70, 18),
    ("kadpoly", "Kaduna Polytechnic", -299, 202, "campus", 100, 80, 18),
    ("barau_dikko", "Barau Dikko Hospital", 230, -6, "hospital", 70, 50, 16),
    ("gamji_gate", "Gamji Gate", 106, 297, "park", 60, 40, 14),
    ("kawo_park", "Kawo Motor Park", 76, -580, "motorpark", 60, 44, 14),
    ("rigasa_station", "Rigasa Station", -943, -172, "station", 120, 60, 22),
    ("kaduna_junction", "Kaduna Junction", -273, 455, "junction", 90, 70, 20),
    ("airport", "Kaduna Airport", 51, -699, "airport", 0, 0, 24),
    ("nda", "Nigerian Defence Academy", -705, -939, "military", 150, 120, 18),
    ("refinery", "Kaduna Refinery", 538, 1362, "refinery", 180, 140, 26),
    ("textile_mill", "Kaduna Textile Mill", -255, 618, "factory", 110, 70, 16),
    ("pan_plant", "PAN Plant", 369, 978, "factory", 110, 80, 16),
    ("millennium", "Millennium City", 699, -33, "estate", 140, 120, 18),
    ("kajuru_sign", "Kajuru Road - Kajuru Castle 42km", 250, 1120, "sign", 0, 0, 0),
]
landmarks = [{"key": k, "name": n, "x": x, "z": z, "kind": kind, "kw": kw, "kd": kd, "lh": lh}
             for k, n, x, z, kind, kw, kd, lh in LANDMARKS]

PLACES = [
    ("Kawo", 182, -587), ("Malali", 256, -230), ("Unguwan Dosa", 153, -396), ("Rimi", 436, -441),
    ("Badiko", -281, -141), ("Rigasa", -1289, -99), ("Nasarawa GRA", 120, -60), ("Ungwan Rimi", 240, 40),
    ("Tudun Nupawa", -211, 208), ("Tudun Wada", -310, 280), ("Kinkinau", -394, 448), ("Barnawa", -121, 635),
    ("Kakuri", -332, 874), ("Makera", -300, 740), ("Television", -243, 968), ("Narayi", 123, 678),
    ("Sabon Tasha", 268, 1054), ("Ungwan Boro", 180, 800), ("Kamazo", 220, 542), ("Mando", -560, -480),
    ("Gwagwada", 400, 1200), ("Kigo", -320, -300), ("Afaka", -700, -800), ("Anadariya", -2, -59),
    ("Maraban Rido", 420, 950),
]
places = [{"name": n, "x": x, "z": z} for n, x, z in PLACES]

def dp_ring(pts, tol_m):
    """DP for closed rings: first point == last point would make the chord
    degenerate, so simplify the two halves independently."""
    if len(pts) < 5:
        return pts
    closed = abs(pts[0][0] - pts[-1][0]) < 1e-9 and abs(pts[0][1] - pts[-1][1]) < 1e-9
    body = pts[:-1] if closed else pts
    mid = len(body) // 2
    a = dp_keep(body[:mid + 1], tol_m)
    b = dp_keep(body[mid:] + body[:1], tol_m)
    out = a[:-1] + b
    return out

# ---------------------------------------------------------------- houses
resi = []
for e in load("residential"):
    ring = None
    if e.get("type") == "way" and e.get("geometry"):
        pts = [(p["lat"], p["lon"]) for p in e["geometry"]]
        if len(pts) >= 4:
            ring = dp_ring(pts, 30.0)
    elif e.get("type") == "relation":
        for m in e.get("members", []):
            if m.get("role") == "outer" and m.get("geometry"):
                pts = [(p["lat"], p["lon"]) for p in m["geometry"]]
                if len(pts) >= 4:
                    ring = dp_keep(pts, 30.0)
                    break
    if not ring or len(ring) < 4:
        continue
    pts2 = [proj(*p) for p in ring]
    xs = [p[0] for p in pts2]; zs = [p[1] for p in pts2]
    if not in_bounds(pts2):
        continue
    area_u2 = abs(sum(pts2[i][0] * pts2[i + 1][1] - pts2[i + 1][0] * pts2[i][1] for i in range(len(pts2) - 1))) / 2
    area = area_u2 * 100.0  # units are 10 m, so 1 u2 = 100 m2
    if area < 40_000:
        continue
    resi.append({"poly": pts2, "area": area, "bbox": (min(xs), max(xs), min(zs), max(zs))})
print(f"residential polygons: {len(resi)}, total {sum(r['area'] for r in resi)/1e6:.1f} km2")

river_for_dist = [river_main] + side
road_lines = [r["pts"] for r in roads]
keepout = []
for lm in landmarks:
    if lm["kw"] > 0:
        keepout.append((lm["x"], lm["z"], lm["kw"] / 2 + 8, lm["kd"] / 2 + 8))
# playable entity keepouts
PLAYABLE = {
    "spawn": (-98, 40, 14, 14), "musa": (-70, 75, 22, 18), "pos": (-25, 8, 12, 12),
    "market_ent": (-80, 102, 0, 0), "stonetech": (-55, 360, 20, 20), "keke": (-150, 250, 16, 12),
}
keepout += [(-70, 75, 34, 34), (-25, 8, 16, 16), (-55, 360, 30, 30), (-245, 420, 24, 18), (-98, 40, 16, 16), (-20, -164, 30, 24)]

WALL = ["#c9b18a", "#b8a07a", "#d8c9a3", "#a89468", "#c96f4a", "#9c8a6a", "#e0d6bd", "#7a8c5a"]
ROOF = ["#b04a3a", "#8a8f96", "#6b7280", "#96524a", "#7d8a7a"]

def keepout_hit(x, z):
    for kx, kz, kw, kd in keepout:
        if abs(x - kx) < kw / 2 and abs(z - kz) < kd / 2:
            return True
    return False

houses = []
for r in resi:
    n_target = int(max(4, min(240, r["area"] / 9_000)))
    x0, x1, z0, z1 = r["bbox"]
    tries = 0
    got = 0
    while got < n_target and tries < n_target * 22:
        tries += 1
        x = random.uniform(x0, x1); z = random.uniform(z0, z1)
        if not point_in_poly(x, z, r["poly"]):
            continue
        if dist_to_polylines(x, z, road_lines) < 17:
            continue
        if dist_to_polylines(x, z, river_for_dist) < 26:
            continue
        if keepout_hit(x, z):
            continue
        w = random.uniform(8, 15); d = random.uniform(7, 12)
        houses.append([round(x, 1), round(z, 1), round(w, 1), round(d, 1),
                       round(random.uniform(-0.14, 0.14), 3),
                       random.randrange(len(WALL)), random.randrange(len(ROOF))])
        got += 1
print(f"houses: {len(houses)}")

# ---------------------------------------------------------------- trees
trees = []
def push_tree(x, z):
    if dist_to_polylines(x, z, road_lines) < 11:
        return
    if keepout_hit(x, z):
        return
    trees.append([round(x, 1), round(z, 1), round(random.uniform(0.8, 1.5), 2)])

for k in range(len(river_main) - 1):
    a, b = river_main[k], river_main[k + 1]
    seglen = math.hypot(b[0] - a[0], b[1] - a[1])
    n = int(seglen / 34)
    for i in range(n):
        t = (i + 0.5) / n
        x = a[0] + (b[0] - a[0]) * t; z = a[1] + (b[1] - a[1]) * t
        nx, nz = -(b[1] - a[1]) / seglen, (b[0] - a[0]) / seglen
        for s in (-1, 1):
            if random.random() < 0.65:
                push_tree(x + nx * s * random.uniform(20, 34), z + nz * s * random.uniform(20, 34))

for r in roads:
    if r["class"] not in ("trunk", "primary"):
        continue
    pts = r["pts"]
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        seglen = math.hypot(b[0] - a[0], b[1] - a[1])
        n = int(seglen / 110)
        for j in range(n):
            t = (j + 0.5) / n
            if random.random() < 0.5:
                push_tree(a[0] + (b[0] - a[0]) * t + random.uniform(-14, 14),
                          a[1] + (b[1] - a[1]) * t + random.uniform(-14, 14))

for x, z in [(0, -40), (60, 160), (-30, 190), (76, 125), (64, 178)]:
    for _ in range(12):
        push_tree(x + random.uniform(-55, 55), z + random.uniform(-55, 55))

for _ in range(260):
    x = random.uniform(-1250, 700); z = random.uniform(-950, 1300)
    if dist_to_polylines(x, z, road_lines) > 22 and dist_to_polylines(x, z, river_for_dist) > 30:
        if not any(abs(x - hx) < 20 and abs(z - hz) < 20 for hx, hz, *_ in houses[:400]):
            trees.append([round(x, 1), round(z, 1), round(random.uniform(0.8, 1.6), 2)])
print(f"trees: {len(trees)}")

# ---------------------------------------------------------------- export
bake = {
    "meta": {
        "attribution": "Layout derived from OpenStreetMap data (c) OpenStreetMap contributors, ODbL. Stylized game geometry, not survey data.",
        "origin": list(ORIGIN),
        "unitM": 10,
        "bounds": {"xmin": -1400, "xmax": 700, "zmin": -1020, "zmax": 1450},
    },
    "river": {"main": [[round(x, 1), round(z, 1)] for x, z in river_main], "width": 16,
              "side": [[[round(x, 1), round(z, 1)] for x, z in s] for s in side]},
    "roads": roads,
    "rail": rail,
    "airport": {"runway": runway and [[round(x, 1), round(z, 1)] for x, z in runway], "apron": apron},
    "landmarks": landmarks,
    "places": places,
    "bridges": bridges,
    "houses": houses,
    "housePalettes": {"wall": WALL, "roof": ROOF},
    "trees": trees[:900],
}
json.dump(bake, open(OUT, "w"), separators=(",", ":"))
print(f"wrote {OUT} ({len(json.dumps(bake))//1024} KB)")
print("houses", len(bake["houses"]), "trees", len(bake["trees"]), "roads", len(roads), "bridges", len(bridges))
