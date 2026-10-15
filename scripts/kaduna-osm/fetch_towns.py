#!/usr/bin/env python3
"""Download real OpenStreetMap data for the other towns of Kaduna State.

Run this on a computer with internet (no extra packages needed):

    python scripts/kaduna-osm/fetch_towns.py zaria
    python scripts/kaduna-osm/fetch_towns.py all

It writes raw Overpass JSON to scripts/kaduna-osm/raw/<town>/ (roads, river,
rail, buildings, places, landmarks). Then `python scripts/kaduna-osm/towns.py`
(or ask Claude) bakes the real streets, rivers, railways and building
footprints into frontend/app/utils/towns/<town>.json, keeping the curated
landmarks. Data (c) OpenStreetMap contributors, ODbL.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")

# S, W, N, E boxes (~14 x 16 km around each town, matching the game bounds)
BBOX = {
    "zaria": "11.000,7.600,11.200,7.800",
    "kafanchan": "9.520,8.220,9.660,8.420",
    "kachia": "9.810,7.890,9.940,8.020",
    "zonkwa": "9.720,8.220,9.850,8.350",
    "saminaka": "10.340,8.620,10.480,8.760",
    "birnin_gwari": "10.590,6.460,10.730,6.600",
}

QUERIES = {
    "roads": 'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)$"]({b});out geom;',
    "river": 'way["waterway"~"^(river|stream)$"]({b});out geom;',
    "rail": 'way["railway"="rail"]({b});out geom;',
    "buildings": 'way["building"]({b});out center tags;',
    "places": 'node["place"~"^(suburb|quarter|neighbourhood|town|village|hamlet)$"]({b});out;',
    "landmarks": (
        '(nwr["amenity"~"^(place_of_worship|marketplace|hospital|university|college|school|bus_station|police|townhall)$"]["name"]({b});'
        'nwr["railway"="station"]["name"]({b});nwr["aeroway"="aerodrome"]({b});nwr["leisure"~"^(stadium|park|pitch)$"]["name"]({b});'
        'nwr["historic"]["name"]({b});nwr["tourism"]["name"]({b}););out center tags;'
    ),
}
MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]


def fetch(town: str) -> None:
    out = os.path.join(RAW, town)
    os.makedirs(out, exist_ok=True)
    b = BBOX[town]
    for name, q in QUERIES.items():
        path = os.path.join(out, f"{name}.json")
        if os.path.exists(path) and os.path.getsize(path) > 100:
            print(f"[{town}] {name}: cached")
            continue
        query = f"[out:json][timeout:180];{q.format(b=b)}"
        for attempt in range(6):
            url = MIRRORS[attempt % len(MIRRORS)]
            req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": query}).encode(), headers={"User-Agent": "kaduna-kulture-map-builder/1.1"})
            try:
                t0 = time.time()
                with urllib.request.urlopen(req, timeout=240) as r:
                    blob = json.load(r)
                json.dump(blob, open(path, "w"))
                print(f"[{town}] {name}: {len(blob.get('elements', []))} elements ({time.time() - t0:.0f}s)")
                break
            except Exception as e:  # noqa: BLE001
                print(f"[{town}] {name}: retry {attempt + 1} ({e})")
                time.sleep(5)
        else:
            print(f"[{town}] {name}: FAILED - run again later")


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "zaria"
    for t in (BBOX if which == "all" else [which]):
        fetch(t)
    print("done - now tell Claude (or run towns.py) to bake them")
