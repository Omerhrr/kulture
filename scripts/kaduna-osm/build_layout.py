#!/usr/bin/env python3
"""Build the game layout from real OSM data.

Steps:
1. Stitch river segments into continuous polylines.
2. Project lat/lon to game units (1 unit = 10 m), origin at Murtala Square,
   north = -Z (Three.js convention: +X east, +Z south).
3. Simplify + decimate polylines.
4. Match named bridges to the river to find real crossings.
5. Emit an ASCII map for visual verification + layout JSON for the game.

Data: (c) OpenStreetMap contributors, ODbL - stylized/approximate in-game.
"""

import json
import math

RAW = "/home/z/my-project/kaduna-osm-raw"

# --- projection: origin = Murtala Square, 1 unit = 10 m, north = -Z ---
ORIGIN = (10.5332, 7.4413)
M_PER_DEG_LAT = 110_900.0
M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(ORIGIN[0]))
UNIT_M = 10.0
UX = M_PER_DEG_LON / UNIT_M   # units per degree lon
UZ = M_PER_DEG_LAT / UNIT_M

def proj(lat, lon):
    x = (lon - ORIGIN[1]) * UX
    z = -(lat - ORIGIN[0]) * UZ
    return round(x, 1), round(z, 1)

def load(name):
    return json.load(open(f"{RAW}/{name}.json"))["elements"]

def way_pts(e):
    if e.get("geometry"):
        return [(p["lat"], p["lon"]) for p in e["geometry"]]
    if e.get("center"):
        return [(e["center"]["lat"], e["center"]["lon"])]
    if e.get("lat") is not None:
        return [(e["lat"], e["lon"])]
    return []

# --- 1. stitch river segments ---
def stitch(elements, name_filter=None):
    """Stitch ways sharing endpoints into chains; return list of polylines."""
    segs = []
    for e in elements:
        tags = e.get("tags", {})
        nm = tags.get("name", "")
        if name_filter and not name_filter(nm):
            continue
        pts = way_pts(e)
        if len(pts) >= 2:
            segs.append([(p[0], p[1]) for p in pts])
    chains = []
    used = [False] * len(segs)

    def key(p): return (round(p[0], 5), round(p[1], 5))
    start_map = {}
    end_map = {}
    for i, s in enumerate(segs):
        start_map.setdefault(key(s[0]), []).append(i)
        end_map.setdefault(key(s[-1]), []).append(i)

    for i in range(len(segs)):
        if used[i]:
            continue
        chain = list(segs[i])
        used[i] = True
        changed = True
        while changed:
            changed = False
            kS, kE = key(chain[0]), key(chain[-1])
            for j in range(len(segs)):
                if used[j]:
                    continue
                js, je = key(segs[j][0]), key(segs[j][-1])
                if je == kS:
                    chain = segs[j] + chain
                elif js == kE:
                    chain = chain + segs[j]
                elif js == kS:
                    chain = list(reversed(segs[j])) + chain
                elif je == kE:
                    chain = chain + list(reversed(segs[j]))
                else:
                    continue
                used[j] = True
                changed = True
                break
        if len(chain) >= 3:
            chains.append(chain)
    return chains

river = stitch(load("river"), lambda n: n.lower() in ("kaduna", "r. kaduna", "kaduna river"))
print(f"river chains: {[len(c) for c in river]}")

# --- decimation (Douglas-Peucker) ---
def dp(pts, tol):
    if len(pts) < 3:
        return pts
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
        dmax, imax = -1, -1
        for i in range(a + 1, b):
            px, py = pts[i][1], pts[i][0]
            d = abs((px - ax) * dy - (py - ay) * dx) / norm
            if d > dmax:
                dmax, imax = d, i
        if dmax > tol:
            keep[imax] = True
            stack.append((a, imax))
            stack.append((imax, b))
    return [p for p, k in zip(pts, keep) if k]

# decimate in lat/lon space (tol in degrees ~ 12m)
RIVER_TOL = 12.0 / 110_900.0
river_simplified = [dp(c, RIVER_TOL) for c in river]

# --- 3. roads ---
roads_raw = []
for e in load("roads"):
    t = e.get("tags", {})
    pts = way_pts(e)
    if len(pts) < 2:
        continue
    roads_raw.append({
        "name": t.get("name", ""),
        "class": t.get("highway", "secondary"),
        "pts": dp(pts, 12.0 / 110_900.0),
    })

# merge same-name road segments into continuous chains for game visuals
road_chains = stitch(
    [e for e in load("roads") if e.get("tags", {}).get("name")],
    lambda n: True,
)
roads_named = []
for e in load("roads"):
    t = e.get("tags", {})
    pts = way_pts(e)
    if len(pts) >= 2 and t.get("name"):
        roads_named.append({"name": t["name"], "class": t["highway"], "pts": dp(pts, 12.0 / 110_900.0)})

# --- rail ---
rail = [dp(way_pts(e), 15.0 / 110_900.0) for e in load("rail") if len(way_pts(e)) >= 2]

# --- residential polygons ---
def poly_pts(e):
    """closed way or relation outer rings -> list of rings (each list of latlon)."""
    if e.get("geometry") and e["type"] == "way":
        pts = [(p["lat"], p["lon"]) for p in e["geometry"]]
        if len(pts) >= 4 and abs(pts[0][0]-pts[-1][0]) < 1e-6 and abs(pts[0][1]-pts[-1][1]) < 1e-6:
            return [dp(pts, 25.0 / 110_900.0)]
    if e.get("members") and e["type"] == "relation":
        rings = []
        for m in e["members"]:
            if m.get("role") == "outer" and m.get("geometry"):
                pts = [(p["lat"], p["lon"]) for p in m["geometry"]]
                if len(pts) >= 4:
                    rings.append(dp(pts, 25.0 / 110_900.0))
        return rings
    return []

resi = []
for e in load("residential"):
    for ring in poly_pts(e):
        area = 0.0
        for i in range(len(ring) - 1):
            area += ring[i][1] * ring[i+1][0] - ring[i+1][1] * ring[i][0]
        area = abs(area) * 111_320 * 110_900 * math.cos(math.radians(ORIGIN[0])) / 2  # m^2 approx
        if area > 40_000:  # skip tiny
            resi.append({"pts": ring, "area_m2": int(area)})

# --- landmarks (hand curated from data) ---
LM = {}
def lm(name, el, key=None):
    for e in load(el):
        t = e.get("tags", {})
        if key and key(t, e):
            c = e.get("center") or ({'lat': e['lat'], 'lon': e['lon']} if e.get('lat') is not None else None) \
                or (e.get("geometry") and {'lat': sum(p['lat'] for p in e['geometry'])/len(e['geometry']),
                                            'lon': sum(p['lon'] for p in e['geometry'])/len(e['geometry'])})
            if c:
                LM[name] = (c["lat"], c["lon"])
            return

lm("Murtala Square", "landmarks", lambda t, e: t.get("name") == "Murtala Square")
lm("Ahmadu Bello Stadium", "landmarks", lambda t, e: t.get("name") == "Ahmadu Bello Stadium")
lm("Kaduna Golf Club", "landmarks", lambda t, e: t.get("name") == "Kaduna Golf Club")
lm("Government House", "landmarks", lambda t, e: t.get("name") == "Government House")
lm("Sultan Bello Mosque", "landmarks", lambda t, e: t.get("name") == "Sultan Bello Mosque")
lm("Kaduna Junction", "landmarks", lambda t, e: t.get("name") == "Kaduna Junction")
lm("Rigasa Station", "landmarks", lambda t, e: "Rigasa Station" in t.get("name", ""))
lm("NDA", "landmarks", lambda t, e: t.get("name") == "Nigerian Defence Academy")
lm("Kaduna Refinery", "landmarks", lambda t, e: t.get("name") == "Kaduna Refinery")
lm("KASU", "landmarks", lambda t, e: "Kaduna State University Main Campus" in t.get("name", ""))
lm("Hamdala Hotel", "landmarks", lambda t, e: t.get("name") in ("Hamdala", "Hamdala Motel"))
lm("Gamji Gate", "landmarks", lambda t, e: t.get("name") == "Gamji Gate")
lm("NTA Kaduna", "landmarks", lambda t, e: t.get("name") == "Nigeria Television Authority")
lm("Kawo Motor Park", "landmarks", lambda t, e: t.get("name") == "Kawo Motor Park")
lm("Ranchers Bees Stadium", "landmarks", lambda t, e: "Ranchers Bees" in t.get("name", ""))
lm("Television Market", "landmarks", lambda t, e: t.get("name") == "Television Market")

# known approximations not in OSM name match
LM["Kaduna Central Market"] = (10.5240, 7.4340)
LM["St Joseph's Cathedral"] = (10.4935, 7.4290)
LM["Kaduna Polytechnic"] = (10.5150, 7.4140)
LM["Millennium City"] = (10.5362, 7.5052)
LM["Barau Dikko Hospital"] = (10.5337, 7.4623)
LM["National Museum"] = (10.5310, 7.4420)
LM["Arewa House"] = (10.5480, 7.4395)
LM["Kaduna Airport"] = (10.5962, 7.4460)
LM["Kajuru Castle"] = (10.2610, 7.8185)
LM["Kaduna Textile Mill"] = (10.4775, 7.4180)
LM["PAN Plant"] = (10.4450, 7.4750)

# --- bridges: match to river chains ---
bridges = []
for e in load("bridges"):
    t = e.get("tags", {})
    g = e.get("geometry", [])
    if not g:
        continue
    mid = g[len(g)//2]
    best = (1e9, None, None)
    for ci, c in enumerate(river_simplified):
        for p in c:
            d = math.hypot((mid["lon"]-p[1])*M_PER_DEG_LON/UNIT_M, (mid["lat"]-p[0])*M_PER_DEG_LAT/UNIT_M)
            if d < best[0]:
                best = (d, ci, (p[0], p[1]))
    bridges.append({"name": t.get("name", "?"), "hw": t.get("highway"),
                    "mid": (mid["lat"], mid["lon"]), "river_dist_u": round(best[0], 1), "chain": best[1]})

on_river = [b for b in bridges if b["river_dist_u"] < 12]
print("\nbridges ON main river:")
for b in on_river:
    x, z = proj(*b["mid"])
    print(f"  {b['name']} ({b['hw']}) at units ({x},{z})")

# --- places ---
places = {}
for e in load("places"):
    t = e.get("tags", {})
    nm = t.get("name")
    if nm:
        places[nm] = (e["lat"], e["lon"])
for nm, latlon in [("Kawo", None), ("Barnawa", None), ("Kakuri Gwari", None), ("Sabon Tasha", None),
                   ("Narayi", None), ("Badiko", None), ("Rigasa", None), ("Television", None),
                   ("Unguwan Dosa", None), ("Tudun Nupawa", None), ("Kinkinau", None)]:
    for e in load("landmarks"):
        t = e.get("tags", {})
        if t.get("name") == nm:
            c = e.get("center") or ({'lat': e['lat'], 'lon': e['lon']} if e.get('lat') is not None else None)
            if c:
                places[nm] = (c["lat"], c["lon"])

# --- ASCII map ---
allx, allz = [], []
def collect(pts):
    for p in pts:
        x, z = proj(*p)
        allx.append(x); allz.append(z)

for c in river_simplified:
    collect(c)
for r in roads_named:
    collect(r["pts"])
W, H = 150, 74
xmin, xmax = -520, 620
zmin, zmax = -620, 520
grid = [[" "] * W for _ in range(H)]

def cell(x, z):
    cx = int((x - xmin) / (xmax - xmin) * (W - 1))
    cz = int((z - zmin) / (zmax - zmin) * (H - 1))
    return cz, cx

def put(x, z, ch):
    cz, cx = cell(x, z)
    if 0 <= cz < H and 0 <= cx < W:
        grid[cz][cx] = ch

for c in river_simplified:
    for p in c:
        x, z = proj(*p)
        put(x, z, "~")
for r in rail:
    for p in r:
        x, z = proj(*p)
        put(x, z, "=")
for r in roads_named:
    ch = "#" if r["class"] in ("trunk", "primary") else "+"
    for p in r["pts"]:
        x, z = proj(*p)
        put(x, z, ch)

marks = {}
for nm, ll in LM.items():
    x, z = proj(*ll)
    marks[nm] = (x, z)
    put(x, z, "*")
for nm, ll in places.items():
    x, z = proj(*ll)
    put(x, z, "o")

print("\n=== ASCII MAP (X=east, Z=south, ~water #trunk/primary +secondary =rail *landmark o-neighborhood) ===")
for row in grid:
    print("".join(row))

print("\n=== LANDMARK UNITS ===")
for nm, (x, z) in sorted(marks.items()):
    print(f"  {nm}: ({x}, {z})")
print("\n=== NEIGHBORHOOD UNITS ===")
for nm, ll in sorted(places.items()):
    x, z = proj(*ll)
    print(f"  {nm}: ({x}, {z})")

# export intermediate for the next step
json.dump({
    "origin": ORIGIN, "unit_m": UNIT_M,
    "river": [[[round(x,1), round(z,1)] for x, z in (proj(*p) for p in c)] for c in river_simplified],
    "roads": [{"name": r["name"], "class": r["class"],
               "pts": [[round(x,1), round(z,1)] for x, z in (proj(*p) for p in r["pts"])]} for r in roads_named],
    "rail": [[[round(x,1), round(z,1)] for x, z in (proj(*p) for p in r)] for r in rail],
    "residential": [{"pts": [[round(x,1), round(z,1)] for x, z in (proj(*p) for p in ring)], "area_m2": r["area_m2"]}
                    for r in resi],
    "landmarks": {nm: list(proj(*ll)) for nm, ll in LM.items()},
    "places": {nm: list(proj(*ll)) for nm, ll in places.items()},
    "bridges_on_river": [{"name": b["name"], "at": list(proj(*b["mid"]))} for b in on_river],
}, open("/home/z/my-project/kaduna-osm-raw/layout_intermediate.json", "w"))
print("\nsaved layout_intermediate.json")
