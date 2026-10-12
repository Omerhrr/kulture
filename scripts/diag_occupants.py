"""Visual check for district occupants: teleport near Rigasa Station and
the Textile Market in daylight and capture close-up screenshots.

Run: python scripts/diag_occupants.py [baseUrl]
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
    page = browser.new_page(viewport={"width": 900, "height": 560})
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

    # make sure it is broad daylight
    for _ in range(12):
        t = page.evaluate("window.__kk_time && window.__kk_time()")
        if t and t.get("night", 1) < 0.2:
            break
        page.evaluate("window.dispatchEvent(new CustomEvent('kk-time-skip'))")
        page.wait_for_timeout(350)

    occ = page.evaluate("window.__kk_occupants && window.__kk_occupants()")
    print("occupants:", occ)

    # Rigasa station: stand south of the benches
    page.evaluate("window.__kk_teleport(-2829, -388)")
    page.wait_for_timeout(20000)
    page.screenshot(path="/tmp/kk-rigasa-sitters.png")

    # Textile market vendors
    page.evaluate("window.__kk_teleport(-558, 1942)")
    page.wait_for_timeout(20000)
    page.screenshot(path="/tmp/kk-textile-vendors.png")

    # Kawo drivers + keke line
    page.evaluate("window.__kk_teleport(228, -1620)")
    page.wait_for_timeout(20000)
    page.screenshot(path="/tmp/kk-kawo-drivers.png")

    print("page errors:", errors[:5])
    browser.close()
