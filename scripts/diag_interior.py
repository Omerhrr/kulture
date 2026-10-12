"""Focused diagnostic: teleport to the first open house door and watch the
interior prompt state frame by frame. Tells us whether the door scan ever
reaches action='enter' (game fine, E2E timing was blind) or never does
(real regression, likely district geometry blocking the door front).

Run: python scripts/diag_interior.py [baseUrl]
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

    print("teleporting to door 0 and polling prompt for up to 25s...")
    page.evaluate("""() => {
      const doors = window.__kk_doors && window.__kk_doors();
      if (doors && doors[0]) window.__kk_teleport(doors[0].door[0], doors[0].door[1]);
    }""")
    seen = {}
    deadline = 25000
    waited = 0
    entered = False
    while waited < deadline:
        st = page.evaluate("window.__kk_interior && window.__kk_interior()")
        if st:
            key = (st.get("prompt") or {}).get("action") or "none"
            label = (st.get("prompt") or {}).get("label") or ""
            seen[key] = seen.get(key, 0) + 1
            if st.get("inside"):
                print(f"INSIDE after {waited}ms, name={st.get('name')!r}")
                entered = True
                break
            if key == "enter" and not seen.get("_fired"):
                page.evaluate("window.dispatchEvent(new CustomEvent('kk-door-use'))")
                seen["_fired"] = 1
                print(f"fired kk-door-use at {waited}ms with prompt={label!r}")
        page.wait_for_timeout(500)
        waited += 500

    st = page.evaluate("window.__kk_interior && window.__kk_interior()")
    print("prompt action counts:", seen)
    print("final state:", st)
    print("page errors:", errors[:5])
    browser.close()
