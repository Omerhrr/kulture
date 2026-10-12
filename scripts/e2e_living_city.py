# Headless E2E verification for the living-city pass:
# day/night cycle, traffic behavior, pedestrian smarts, street chat,
# interior isolation, vehicle probe, audio wiring.
#
# The suite is frame-rate tolerant: headless SwiftShader renders the 3x
# city at ~1-3 fps, so every gameplay check POLLS for a condition instead
# of assuming N frames happened within M milliseconds. Runs the world at
# low quality (dpr 1, no shadows, lighter rain) to keep frames coming.
# Run: python scripts/e2e_living_city.py [baseUrl]
import json
import re
import sys
from urllib import request as _urlreq
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
results = []


def ok(name, passed, detail=""):
    results.append((name, passed))
    print(("PASS " if passed else "FAIL ") + name + ((" - " + str(detail)) if detail else ""))


def poll(page, expr, timeout_s, expect_true=True, interval_ms=400):
    """Poll a JS expression until it is truthy (or falsy when expect_true=False)."""
    deadline = timeout_s * 1000
    waited = 0
    while waited < deadline:
        v = page.evaluate(expr)
        if bool(v) == expect_true:
            return True
        page.wait_for_timeout(interval_ms)
        waited += interval_ms
    return page.evaluate(expr) == expect_true if not expect_true else False


def walk_by_keys(page, key, min_units, timeout_s=14):
    """Hold a key, polling position until the player moved min_units."""
    p0 = page.evaluate("window.__kk_pos && window.__kk_pos()")
    page.keyboard.down(key)
    moved = False
    deadline = timeout_s * 1000
    waited = 0
    while waited < deadline:
        page.wait_for_timeout(700)
        waited += 700
        p1 = page.evaluate("window.__kk_pos && window.__kk_pos()")
        if p0 and p1 and ((p1[0] - p0[0]) ** 2 + (p1[1] - p0[1]) ** 2) ** 0.5 > min_units:
            moved = True
            break
    page.keyboard.up(key)
    return moved, p0, p1 if moved else page.evaluate("window.__kk_pos && window.__kk_pos()")


with sync_playwright() as pw:
    browser = pw.chromium.launch(
        headless=True,
        args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
              "--autoplay-policy=no-user-gesture-required"],
    )
    page = browser.new_page(viewport={"width": 560, "height": 360})
    page.add_init_script("try{localStorage.setItem('kk_quality','low')}catch(e){}")
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    # ---------- login
    page.goto(BASE + "/game", wait_until="networkidle")
    page.wait_for_timeout(1500)
    page.fill("#kk-username", "demo_player")
    page.fill("#kk-password", "kaduna-demo-2026")
    page.click("button[type=submit]")
    page.wait_for_timeout(9000)

    authed = page.evaluate("!!document.querySelector('canvas')")
    ok("world canvas mounts", authed)
    ok("no page errors after load", len(errors) == 0, errors[:3])

    # ---------- district NPCs render (7 named characters now)
    npc_codes = []
    npcs_live = poll(page, "window.__kk_npcs && window.__kk_npcs().length >= 7", 12)
    if npcs_live:
        npc_codes = page.evaluate("window.__kk_npcs ? window.__kk_npcs() : []")
    need_npcs = {"npc_mama_chidi", "npc_bashir", "npc_prof_danjuma", "npc_tunde", "npc_ngozi"}
    ok("district NPCs rendered", need_npcs.issubset(set(npc_codes)), npc_codes)

    # ---------- movement (open road first: persisted spawn can sit wedged
    # against a shed, which would block the probe). At walk 5 u/s and the
    # 0.1s dt clamp, ~2 frames are needed per unit; poll generously.
    page.evaluate("window.__kk_teleport && window.__kk_teleport(-182, 256.45)")
    page.wait_for_timeout(600)
    moved, p0, p1 = walk_by_keys(page, "ArrowUp", 0.6, timeout_s=16)
    ok("arrow key movement", moved, f"{p0} -> {p1}")

    # ---------- vehicle collision: you cannot walk through a parked car
    # (spawn kerb fleet car: PLAYABLE_POS.spawn_roadside + (9, -2.9)). Walk
    # straight at it and track the closest approach: blocked means the walk
    # stops ~2.5 u short of the car center instead of crossing it.
    car_c = [-182.001 + 9.0, 256.449 - 2.9]
    page.evaluate(f"window.__kk_teleport && window.__kk_teleport({car_c[0]}, {car_c[1] + 6.5})")
    page.wait_for_timeout(700)
    page.keyboard.down("ArrowUp")
    min_z = 999.0
    deadline = 15000
    waited = 0
    while waited < deadline:
        page.wait_for_timeout(600)
        waited += 600
        z = page.evaluate("window.__kk_pos && window.__kk_pos()[1]")
        if z is None:
            continue
        min_z = min(min_z, z)
        if z < car_c[1] + 2.2:
            break  # walked into/past the car footprint
    page.keyboard.up("ArrowUp")
    ok("parked car blocks the player", min_z > car_c[1] + 2.2, f"closest approach z={min_z} (car center {car_c[1]})")

    # ---------- day/night cycle
    t0 = page.evaluate("window.__kk_time && window.__kk_time()")
    ok("day/night clock running", bool(t0 and t0.get("hour", 0) > 0), t0)
    reached_night = False
    for _ in range(10):
        page.evaluate("window.dispatchEvent(new CustomEvent('kk-time-skip'))")
        page.wait_for_timeout(600)
        t1 = page.evaluate("window.__kk_time && window.__kk_time()")
        if t1 and t1.get("night", 0) > 0.8:
            reached_night = True
            break
    # let the sky catch up (a few frames at software-GL pace)
    if reached_night:
        poll(page, "window.__kk_time && window.__kk_time().night > 0.8", 12)
        t1 = page.evaluate("window.__kk_time && window.__kk_time()")
    ok("time skip reaches night", reached_night, t1)
    page.screenshot(path="/tmp/kk-night-city.png")

    dark = page.evaluate(
        """() => {
      const cv = document.querySelector('canvas');
      if (!cv) return false;
      const gl = cv.getContext('webgl2') || cv.getContext('webgl');
      if (!gl) return false;
      const px = new Uint8Array(4);
      gl.readPixels(Math.floor(cv.width/2), cv.height - 8, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return (px[0] + px[1] + px[2]) < 260;
    }"""
    )
    ok("night sky is dark (pixel probe)", dark)

    # back to daylight (loop skips of 2h until night < 0.4)
    back_day = poll(
        page,
        "window.__kk_time && window.__kk_time().night < 0.4",
        16,
    )
    if not back_day:
        for _ in range(14):
            page.evaluate("window.dispatchEvent(new CustomEvent('kk-time-skip'))")
            page.wait_for_timeout(500)
            t2 = page.evaluate("window.__kk_time && window.__kk_time()")
            if t2 and t2.get("night", 1) < 0.4:
                back_day = True
                break
        poll(page, "window.__kk_time && window.__kk_time().night < 0.4", 10)
    t2 = page.evaluate("window.__kk_time && window.__kk_time()")
    ok("time wraps back to day", bool(t2 and t2.get("night", 1) < 0.4), t2)

    # ---------- crowd smarts
    page.wait_for_timeout(2500)
    crowd = page.evaluate("window.__kk_crowd && window.__kk_crowd()")
    ok(
        "crowd alive",
        bool(crowd and crowd.get("total", 0) >= 60),
        {k: crowd.get(k) for k in ("total", "waiting", "crossing")} if crowd else None,
    )
    ok("traffic probe shared with peds", bool(crowd and crowd.get("probeCars", 0) > 0))

    # ---------- traffic behavior
    traffic = page.evaluate("window.__kk_traffic && window.__kk_traffic()")
    ok(
        "traffic alive with signals",
        bool(traffic and traffic.get("cars", 0) >= 20 and traffic.get("signals", 0) >= 3),
        {k: traffic.get(k) for k in ("cars", "signals", "stopped", "avgV")} if traffic else None,
    )
    v0 = page.evaluate("window.__kk_traffic && window.__kk_traffic().avgV")
    page.wait_for_timeout(5000)
    v1 = page.evaluate("window.__kk_traffic && window.__kk_traffic().avgV")
    ok("cars actually move", bool(v1 and v1 > 3 or (v0 or 0) > 3), f"avgV {v0} -> {v1}")

    # ---------- street chat: stand next to a stationary market vendor
    chat = False
    page.evaluate("window.__kk_teleport && window.__kk_teleport(-210, 330)")
    page.wait_for_timeout(1200)
    for _ in range(6):
        page.evaluate(
            """() => {
          const ped = window.__kk_nearest_ped && window.__kk_nearest_ped();
          if (ped) window.__kk_teleport(ped[0] + 0.9, ped[1]);
        }"""
        )
        page.wait_for_timeout(800)
        page.evaluate("window.dispatchEvent(new CustomEvent('kk-ped-talk'))")
        page.wait_for_timeout(600)
        txt = page.evaluate("document.body.innerText")
        if re.search(r"(Mallam|Alhaji|Hajiya|Madam|Malama|Dr\.)", txt):
            chat = True
            break
        page.wait_for_timeout(900)
    ok("street chat line appears", chat)
    page.screenshot(path="/tmp/kk-chat.png")

    # ---------- interiors: teleport to the first open house door and enter.
    # Wait for the door scan to actually publish action==='enter' before
    # firing the one-shot event (the exit path below does the same; firing
    # blind races the render loop at software-GL pace).
    page.evaluate(
        """() => {
      const doors = window.__kk_doors && window.__kk_doors();
      if (doors && doors[0]) window.__kk_teleport(doors[0].door[0], doors[0].door[1]);
    }"""
    )
    prompt_ready = poll(
        page,
        "window.__kk_interior && window.__kk_interior().prompt && window.__kk_interior().prompt.action === 'enter'",
        30,
    )
    ok("door prompt visible at the entrance", prompt_ready, page.evaluate("window.__kk_interior && window.__kk_interior()"))
    if prompt_ready:
        page.evaluate("window.dispatchEvent(new CustomEvent('kk-door-use'))"
    )
    entered = poll(page, "window.__kk_interior && window.__kk_interior().inside", 30)
    interior = page.evaluate("window.__kk_interior && window.__kk_interior()")
    ok("interior entered", entered, interior)
    sank = poll(page, """() => {
      const r = window.__kk_ctx;
      const c = (r && r.camera && r.camera.activeCamera && r.camera.activeCamera.value) || ((r && r.cameras && r.cameras.value || [])[0]);
      return c ? c.position.y < -30 : false;
    }""", 20)
    cam = page.evaluate(
        """() => {
      const r = window.__kk_ctx;
      const c = (r && r.camera && r.camera.activeCamera && r.camera.activeCamera.value) || ((r && r.cameras && r.cameras.value || [])[0]);
      return c ? [ +c.position.x.toFixed(1), +c.position.y.toFixed(1), +c.position.z.toFixed(1) ] : null;
    }"""
    )
    ok("camera sinks to the underground room", sank, cam)
    page.screenshot(path="/tmp/kk-interior.png")

    # walk within the room
    walked, before, after = walk_by_keys(page, "ArrowDown", 0.5, timeout_s=12)
    ok("can walk within the room", walked, f"{before} -> {after}")

    # exit through the door: teleport to the threshold, WAIT for the exit
    # prompt (recomputed per frame; at software-GL pace that can take a few
    # seconds), and only then fire the one-shot door event
    page.evaluate(
        """() => {
      const doors = window.__kk_doors && window.__kk_doors();
      if (doors && doors[0]) window.__kk_teleport(doors[0].door[0], doors[0].door[1]);
    }"""
    )
    prompt_ready = poll(
        page,
        "window.__kk_interior && window.__kk_interior().prompt && window.__kk_interior().prompt.action === 'exit'",
        20,
    )
    if prompt_ready:
        page.evaluate("window.dispatchEvent(new CustomEvent('kk-door-use'))")
    exited = poll(page, "window.__kk_interior && !window.__kk_interior().inside", 20)
    interior2 = page.evaluate("window.__kk_interior && window.__kk_interior()")
    ok("interior exit works", exited, interior2)

    # ---------- vehicles + probe
    page.evaluate("window.__kk_teleport && window.__kk_teleport(-174, 256.45)")
    page.wait_for_timeout(1600)
    fleet = page.evaluate("window.__kk_fleet && window.__kk_fleet()")
    ok("boardable fleet exists", isinstance(fleet, list) and len(fleet) >= 9, len(fleet) if fleet else None)
    page.evaluate("window.dispatchEvent(new CustomEvent('kk-ride-toggle'))")
    boarded = poll(page, "window.__kk_ride && window.__kk_ride().active", 16)
    ride = page.evaluate("window.__kk_ride && window.__kk_ride()")
    ok("boards the nearest vehicle", boarded, ride and ride.get("kind"))
    # drive: hold W, poll the speedo. Boarding plays a walk-to-door + climb
    # animation worth ~3s of game time; at software-GL pace (dt clamped to
    # 0.1s per frame) that is ~30 frames, so allow a long window.
    page.keyboard.down("KeyW")
    drove = poll(page, "window.__kk_ride && window.__kk_ride().speed > 2", 80)
    page.keyboard.up("KeyW")
    ride2 = page.evaluate("window.__kk_ride && window.__kk_ride()")
    ok("vehicle drives", drove, f"speed {ride2 and ride2.get('speed')} km/h")
    page.evaluate("window.dispatchEvent(new CustomEvent('kk-ride-toggle'))")
    page.wait_for_timeout(900)

    # ---------- audio wiring
    audio = page.evaluate("window.__kk_audio && window.__kk_audio()")
    ok("audio engine ready", bool(audio and audio.get("ready")), audio)

    # ---------- district content served by the backend
    try:
        def _api(method: str, path: str, payload=None, token=None):
            data = json.dumps(payload).encode() if payload is not None else None
            req = _urlreq.Request(
                BASE + path, data=data, method=method,
                headers={"Content-Type": "application/json", **({"Authorization": "Bearer " + token} if token else {})},
            )
            with _urlreq.urlopen(req, timeout=15) as r:
                return json.loads(r.read())

        tok = _api("POST", "/api/v1/auth/login", {"username": "demo_player", "password": "kaduna-demo-2026"})["access_token"]
        region = _api("GET", "/api/v1/world/regions/kaduna-city", token=tok)
        codes = {e["code"] for e in region["entities"]}
        need = {"textile_market", "kawo_motor_park", "kasu_gate", "rigasa_station", "sabon_tasha_shop"}
        ok("district spots seeded", need.issubset(codes), sorted(need - codes))
        jobs = _api("GET", "/api/v1/jobs/available", token=tok)
        ok("job board has district routes", len(jobs) >= 7, len(jobs))
        rewards = sorted(int(j["reward_ngn_minor"]) for j in jobs)
        ok("job rewards tuned by distance", rewards[0] >= 5_000_00 and rewards[-1] >= 15_000_00, [r / 100 for r in rewards])
    except Exception as e:  # noqa: BLE001
        ok("district content API reachable", False, str(e)[:120])

    # ---------- district occupancy: stalls, benches, queues are staffed
    occ = page.evaluate("window.__kk_occupants && window.__kk_occupants()")
    inhabited = (
        bool(occ)
        and occ.get("textile", 0) >= 6
        and occ.get("rigasa", 0) >= 4
        and occ.get("kasu", 0) >= 2
        and occ.get("kawo", 0) >= 2
        and occ.get("sabon", 0) >= 1
    )
    ok("districts are inhabited", inhabited, occ)
    ok("bench sitters at Rigasa", bool(occ) and occ.get("sitters", 0) >= 4, occ and occ.get("sitters"))

    # ---------- night rhythm: the city thins out after dark, wakes at dawn
    for _ in range(10):
        page.evaluate("window.dispatchEvent(new CustomEvent('kk-time-skip'))")
        page.wait_for_timeout(500)
        t3 = page.evaluate("window.__kk_time && window.__kk_time()")
        if t3 and t3.get("night", 0) > 0.85:
            break
    asleep = poll(page, "window.__kk_crowd && window.__kk_crowd().asleep >= 20", 12)
    crowd_n = page.evaluate("window.__kk_crowd && window.__kk_crowd()")
    ok("the city sleeps at night", asleep, crowd_n and {k: crowd_n.get(k) for k in ("total", "asleep")})
    page.screenshot(path="/tmp/kk-night-empty.png")
    for _ in range(10):
        page.evaluate("window.dispatchEvent(new CustomEvent('kk-time-skip'))")
        page.wait_for_timeout(500)
        t4 = page.evaluate("window.__kk_time && window.__kk_time()")
        if t4 and t4.get("night", 1) < 0.3:
            break
    woke = poll(page, "window.__kk_crowd && window.__kk_crowd().asleep === 0", 12)
    crowd_d = page.evaluate("window.__kk_crowd && window.__kk_crowd()")
    ok("the city wakes at dawn", woke, crowd_d and {k: crowd_d.get(k) for k in ("total", "asleep")})

    ok("no page errors at the end", len(errors) == 0, errors[:4])
    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
