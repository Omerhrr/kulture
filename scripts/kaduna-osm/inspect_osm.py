#!/usr/bin/env python3
"""Inspect fetched OSM layers: summarize what we got."""

import json

OUT = "/home/z/my-project/kaduna-osm-raw"

def load(n): return json.load(open(f"{OUT}/{n}.json"))["elements"]

print("=== RIVER ===")
for w in load("river"):
    name = w.get("tags", {}).get("name", "?")
    g = w.get("geometry", [])
    print(f"  {name}: {len(g)} pts, first={g[0]['lat']:.4f},{g[0]['lon']:.4f} last={g[-1]['lat']:.4f},{g[-1]['lon']:.4f}")

print("=== BRIDGES ===")
for w in load("bridges"):
    t = w.get("tags", {})
    g = w.get("geometry", [])
    mid = g[len(g)//2]
    print(f"  {t.get('name','?')} ({t.get('highway')}): mid={mid['lat']:.4f},{mid['lon']:.4f}")

print("=== PLACES ===")
for n in load("places"):
    t = n.get("tags", {})
    print(f"  {t.get('name','?')} ({t.get('place')}): {n['lat']:.4f},{n['lon']:.4f}")

print("=== AEROWAY ===")
for e in load("aeroway"):
    t = e.get("tags", {})
    g = e.get("geometry", [e])
    lat = sum(p["lat"] for p in g)/len(g); lon = sum(p["lon"] for p in g)/len(g)
    print(f"  {t.get('aeroway','?')} {t.get('name','')}: {len(g)} pts center={lat:.4f},{lon:.4f}")

print("=== LANDMARKS (named) ===")
seen = set()
for e in load("landmarks"):
    t = e.get("tags", {})
    name = t.get("name", "")
    if not name or name in seen: continue
    seen.add(name)
    if "center" in e:
        lat, lon = e["center"]["lat"], e["center"]["lon"]
    elif e.get("type") == "node":
        lat, lon = e["lat"], e["lon"]
    else:
        g = e.get("geometry", [])
        if not g: continue
        lat = sum(p["lat"] for p in g)/len(g); lon = sum(p["lon"] for p in g)/len(g)
    kinds = ",".join(k for k in t if k in ("amenity","leisure","building","landuse","man_made","railway","aeroway","shop","tourism","office","historic"))
    print(f"  {name} [{kinds}]: {lat:.4f},{lon:.4f} ({e['type']})")
