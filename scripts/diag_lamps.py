"""Visual check: deep-night streetlight pools close to the camera.

Run: python scripts/diag_lamps.py [baseUrl]
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
    page.goto(BASE + "/game", wait_until="networkidle")
    page.wait_for_timeout(1500)
    page.fill("#kk-username", "demo_player")
    page.fill("#kk-password", "kaduna-demo-2026")
    page.click("button[type=submit]")
    page.wait_for_timeout(9000)

    # jump straight to deep night, then WAIT for the lamps to actually glow
    # (skips land one per frame; at software-GL pace that takes a while)
    for _ in range(8):
        page.evaluate("window.dispatchEvent(new CustomEvent('kk-time-skip'))")
        page.wait_for_timeout(500)
    lit = False
    for _ in range(40):
        page.wait_for_timeout(600)
        l = page.evaluate("window.__kk_lamps && window.__kk_lamps()")
        if l and l.get("glow", 0) > 0.9:
            lit = True
            break
    print(f"lamps lit: {lit}, state: {page.evaluate('window.__kk_lamps && window.__kk_lamps()')}")

    samp = page.evaluate("window.__kk_lamps && window.__kk_lamps().sample")
    print(f"lamps: {page.evaluate('window.__kk_lamps && window.__kk_lamps()')}")
    if samp:
        # stand a little way off the lamp so the pole + pool are both in frame;
        # the damped camera needs a long beat after teleport at software-GL pace
        page.evaluate(f"window.__kk_teleport({samp[0] + 6}, {samp[1] + 6})")
        for i, wait_ms in enumerate((4000, 5000, 5000)):
            page.wait_for_timeout(wait_ms)
            # dismiss a street chat bubble if one popped up
            page.evaluate(
                """() => {
                  const btns = [...document.querySelectorAll('button')];
                  const x = btns.find((b) => b.textContent.trim() === 'X' || b.textContent.trim() === '\\u00d7');
                  if (x) x.click();
                }"""
            )
            page.wait_for_timeout(600)
            page.screenshot(path=f"/tmp/kk-lamp-pool-{i}.png")
        print("saved /tmp/kk-lamp-pool-0..2.png")
    browser.close()
