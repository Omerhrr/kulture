#!/usr/bin/env python3
"""Trace river + named roads within the city window, and match bridges
to polylines (segment distance). Prints focused views for map design."""

import json
import math

RAW = "/home/z/my-project/kaduna-osm-raw"
data = json.load(open(f"{RAW}/layout_intermediate.json"))

X0, X1, Z0, Z1 = -700, 700, -700, 1150

def seg_dist(px, pz, ax, az, bx, bz):
    vx, vz = bx - ax, bz - az
    L2 = vx * vx + vz * vz
    t = 0 if L2 == 0 else max(0, min(1, ((px - ax) * vx + (pz - az) * vz) / L2))
    return math.hypot(px - (ax + t * vx), pz - (az + t * vz))

print("=== RIVER points in window (chain index order) ===")
river = data["river"]
prev = None
for i, c in enumerate(river):
    for j, (x, z) in enumerate(c):
        if X0 <= x <= X1 and Z0 <= z <= Z1:
            if prev is None or abs(x - prev[0]) > 30 or abs(z - prev[1]) > 30:
                print(f"  [{j:4d}] ({x}, {z})")
            prev = (x, z)

print("\n=== NAMED ROADS in window ===")
from collections import defaultdict
byname = defaultdict(list)
for r in data["roads"]:
    n = r["name"]
    if not n:
        continue
    pts = [(x, z) for x, z in r["pts"] if X0 <= x <= X1 and Z0 <= z <= Z1]
    if len(pts) >= 2:
        byname[n].append((r["class"], pts))
for n in sorted(byname):
    chain = byname[n]
    cls = chain[0][0]
    allpts = [p for _, pts in chain for p in pts]
    xs = [p[0] for p in allpts]; zs = [p[1] for p in allpts]
    if len(allpts) < 3:
        continue
    print(f"  {n} [{cls}]: {len(chain)} segs, {len(allpts)} pts, x[{min(xs):.0f}..{max(xs):.0f}] z[{min(zs):.0f}..{max(zs):.0f}], start={allpts[0]}, end={allpts[-1]}")

print("\n=== BRIDGE -> polyline match (segment dist < 45u) ===")
raw_bridges = json.load(open(f"{RAW}/bridges.json"))["elements"]
for e in raw_bridges:
    t = e.get("tags", {})
    g = e.get("geometry", [])
    if not g:
        continue
    mid = g[len(g)//2]
    x = (mid["lon"] - data["origin"][1]) * 10730.9
    z = -(mid["lat"] - data["origin"][0]) * 11090.0
    if not (X0 <= x <= X1 and Z0 <= z <= Z1):
        continue
    best = (1e9, "")
    for label, lines in (("river", river), ("road", [r["pts"] for r in data["roads"]]), ("rail", data["rail"])):
        for ln in lines:
            for k in range(len(ln) - 1):
                d = seg_dist(x, z, ln[k][0], ln[k][1], ln[k+1][0], ln[k+1][1])
                if d < best[0]:
                    best = (d, label)
    if best[0] < 45:
        print(f"  {t.get('name','?')} ({t.get('highway')}) at ({x:.0f},{z:.0f}) -> {best[1]} d={best[0]:.0f}")

print("\n=== RAIL lines in window ===")
for r in data["rail"]:
    pts = [(x, z) for x, z in r if X0 <= x <= X1 and Z0 <= z <= Z1]
    if len(pts) >= 3:
        xs = [p[0] for p in pts]; zs = [p[1] for p in pts]
        print(f"  rail: {len(pts)} pts x[{min(xs):.0f}..{max(xs):.0f}] z[{min(zs):.0f}..{max(zs):.0f}] start={pts[0]} end={pts[-1]}")

print("\n=== RESIDENTIAL polygons (top 40 by area, in window) ===")
res = sorted(data["residential"], key=lambda r: -r["area_m2"])
cnt = 0
for r in res:
    pts = [(x, z) for x, z in r["pts"] if X0 <= x <= X1 and Z0 <= z <= Z1]
    if len(pts) < 4:
        continue
    xs = [p[0] for p in pts]; zs = [p[1] for p in pts]
    cx = sum(xs)/len(xs); cz = sum(zs)/len(zs)
    print(f"  res area={r['area_m2']//10000}ha center=({cx:.0f},{cz:.0f}) x[{min(xs):.0f}..{max(xs):.0f}] z[{min(zs):.0f}..{max(zs):.0f}]")
    cnt += 1
    if cnt >= 40:
        break
