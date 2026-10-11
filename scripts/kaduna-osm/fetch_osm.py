#!/usr/bin/env python3
"""Fetch real Kaduna city geography from OpenStreetMap (Overpass API).

Downloads the raw building blocks for the game map: river, major roads,
railway, residential districts, airport, bridges, named landmarks and
neighborhood place nodes. Raw JSON is saved for the layout builder.

Data license: (c) OpenStreetMap contributors, ODbL. Game geometry derived
from it is stylized/approximate and credited in the world seed metadata.
"""

import json
import time
import urllib.request
import urllib.parse

BBOX = "10.40,7.28,10.64,7.62"  # S,W,N,E around Kaduna city + airport + NDA
OUT = "/home/z/my-project/kaduna-osm-raw"

QUERIES = {
    "river": f'[out:json][timeout:90];way["waterway"="river"]({BBOX});out geom;',
    "roads": f'[out:json][timeout:90];way["highway"~"^(trunk|primary|secondary)$"]({BBOX});out geom;',
    "rail": f'[out:json][timeout:90];way["railway"~"^(rail)$"]({BBOX});out geom;',
    "residential": f'[out:json][timeout:90];(way["landuse"="residential"]({BBOX});relation["landuse"="residential"]({BBOX}););out geom;',
    "aeroway": f'[out:json][timeout:90];(way["aeroway"~"^(runway|taxiway|apron)$"]({BBOX});node["aeroway"="aerodrome"]({BBOX});way["aeroway"="aerodrome"]({BBOX}););out geom;',
    "bridges": f'[out:json][timeout:90];way["bridge"="yes"]["highway"]["name"]({BBOX});out geom;',
    "places": f'[out:json][timeout:90];node["place"~"^(suburb|quarter|neighbourhood|town|village)$"]({BBOX});out;',
    "landmarks": (
        f'[out:json][timeout:90];'
        f'('
        f'nwr["name"~"Stadium|Central Market|Sultan Bello|Cathedral|St\\. Joseph|Arewa House|Museum|Airport|Polytechnic|Defence Academy|NDA|Refin|Textile|Golf|Government House|Lugard|Rigasa|Hamdala|Kaduna State University|Television|Millennium|Murtala|Gamji|Coronation|Barau Dikko|Trade Fair|Junction|Zoo|Kawo|Barnawa|Kakuri|Sabon Tasha|Narayi|Badiko|Abakpa|Tudun Wada|Malali|Dosa|Nasarawa|Ungwan Rimi|Kajuru|Waterfalls|Kagoro",i]({BBOX});'
        f');out geom tags center;'
    ),
}

import os
os.makedirs(OUT, exist_ok=True)

def fetch(name: str, q: str) -> dict:
    path = f"{OUT}/{name}.json"
    if os.path.exists(path) and os.path.getsize(path) > 100:
        print(f"[skip] {name} cached")
        return json.load(open(path))
    mirrors = [
        "https://overpass.kumi.systems/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
        "https://overpass-api.de/api/interpreter",
    ]
    for attempt in range(6):
        url = mirrors[attempt % len(mirrors)]
        data = urllib.parse.urlencode({"data": q}).encode()
        req = urllib.request.Request(url, data=data, headers={"User-Agent": "kaduna-kulture-map-builder/1.0"})
        try:
            t0 = time.time()
            with urllib.request.urlopen(req, timeout=180) as r:
                blob = json.load(r)
            n = len(blob.get("elements", []))
            json.dump(blob, open(path, "w"))
            print(f"[ok] {name}: {n} elements in {time.time()-t0:.1f}s via {url.split('/')[2]}")
            return blob
        except Exception as e:
            print(f"[retry {attempt}] {name}: {e}")
            time.sleep(4)
    raise SystemExit(f"failed: {name}")

for name, q in QUERIES.items():
    fetch(name, q)
print("done")
