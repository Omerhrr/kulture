"""Focused diagnostic: the E2E ride section. Teleport to the street spot,
watch the ride proximity prompt, fire kk-ride-toggle exactly like the suite,
and report prompt/fleet/phase state at every step.

Run: python scripts/diag_ride.py [baseUrl]
"""
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
              "--autoplay-policy=no-user-gesture-required"],
    )
    page = browser.new_page(viewport={"width": 560, "height": 360})
    page.add_init_script("try{localStorage.setItem('kk_quality','low')}catch(e){}")
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE + "/game", wait_until="networkidle")
    page.wait_for_timeout(1500)
    page.fill("#kk-username", "demo_player")
    page.fill("#kk-password", "kaduna-demo-2026")
    page.click("button[type=submit]")
    page.wait_for_timeout(9000)
    if not page.evaluate("!!document.querySelector('canvas')"):
        print("FATAL: canvas never mounted")
        browser.close()
        sys.exit(1)

    t = page.evaluate("window.__kk_time && window.__kk_time()")
    print(f"game time after load: {t}")

    print("teleport to (-174, 256.45) and poll the ride prompt for 8s...")
    page.evaluate("window.__kk_teleport && window.__kk_teleport(-174, 256.45)")
    waited = 0
    prompt = None
    while waited < 8000:
        page.wait_for_timeout(500)
        waited += 500
        prompt = page.evaluate(
            "window.__kk_ride && window.__kk_ride().prompt"
        )
        if prompt:
            break
    fleet = page.evaluate(
        """() => {
          const f = window.__kk_fleet && window.__kk_fleet();
          return f ? f.slice(0, 4) : null;
        }"""
    )
    print(f"prompt after {waited}ms: {prompt!r}")
    print(f"fleet head: {fleet}")

    dbg0 = page.evaluate("window.__kk_toggle_n || 0")
    page.evaluate("window.dispatchEvent(new CustomEvent('kk-ride-toggle'))")
    page.wait_for_timeout(400)
    dbg1 = page.evaluate(
        "({n: window.__kk_toggle_n, dbg: window.__kk_toggle_dbg, ride: window.__kk_ride && window.__kk_ride()})"
    )
    print(f"right after toggle: n={dbg1.get('n')} (was {dbg0}) dbg={dbg1.get('dbg')}")
    print(f"ride right after toggle: active={dbg1['ride'] and dbg1['ride'].get('active')} kind={dbg1['ride'] and dbg1['ride'].get('kind')}")

    boarded = False
    deadline = 20000
    waited = 0
    while waited < deadline:
        page.wait_for_timeout(600)
        waited += 600
        ride = page.evaluate("window.__kk_ride && window.__kk_ride()")
        if ride and ride.get("active"):
            state = page.evaluate(
                "window.__kk_ride_state && window.__kk_ride_state() || null"
            )
            print(f"ACTIVE after {waited}ms kind={ride.get('kind')} phase-state={state}")
            boarded = True
            break
    if not boarded:
        ride = page.evaluate("window.__kk_ride && window.__kk_ride()")
        print(f"NEVER BOARDED. ride={ride} pageerrors={errors[:3]}")
    else:
        # no keys: just watch the phase machine crawl to 'riding' at
        # software-GL pace (dt clamped to 0.1 per frame)
        sw = 0
        reached = False
        while sw < 45000:
            page.wait_for_timeout(1200)
            sw += 1200
            ph = page.evaluate("window.__kk_ride && window.__kk_ride().phase")
            print(f"t={sw}ms phase={ph!r}")
            if ph == "riding":
                reached = True
                break
        print(f"reached riding: {reached} after {sw}ms")
        if reached:
            page.keyboard.down("KeyW")
            spd = 0
            dw = 0
            while dw < 20000:
                page.wait_for_timeout(900)
                dw += 900
                spd = page.evaluate("window.__kk_ride && window.__kk_ride().speed")
                if spd and spd > 2:
                    break
            page.keyboard.up("KeyW")
            print(f"drive: speed after {dw}ms = {spd}")
        print(f"pageerrors={errors[:3]}")
    browser.close()
