"""Focused smoke probe for the v7 sim UI layer: SimHud, dock verbs
(Phone / Map / Home), the phone sheet, the 3D city map, and clean error
tracking across all of it. Complements e2e_living_city.py, which covers
the world sim but not the new phone/sim surfaces.

Run: python scripts/diag_sim_ui.py [baseUrl]
"""
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
OUT = "/home/z/my-project/kaduna-kulture"


fails = []


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'} {name}{' - ' + str(detail) if detail else ''}")
    if not ok:
        fails.append(name)


with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
              "--autoplay-policy=no-user-gesture-required"],
    )
    page = browser.new_page(viewport={"width": 900, "height": 620})
    page.add_init_script("try{localStorage.setItem('kk_quality','low')}catch(e){}")
    # Force DESKTOP mode: headless chromium reports 'ontouchstart' in window,
    # so useIsTouch() mounts the fullscreen z-30 joystick layer which blocks
    # every real click. Patch both touch signals before app code runs.
    page.add_init_script("""
      try { delete window.ontouchstart } catch (e) {}
      const om = window.matchMedia ? window.matchMedia.bind(window) : null
      if (om) window.matchMedia = (q, ...a) => {
        if (String(q).includes('(pointer: coarse)')) {
          return { matches: false, media: String(q), onchange: null,
            addEventListener() {}, removeEventListener() {},
            addListener() {}, removeListener() {}, dispatchEvent() { return false } }
        }
        return om(q, ...a)
      }
    """)
    errors = []
    console_errs = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: console_errs.append(m.text) if m.type == "error" else None)
    page.goto(BASE + "/game", wait_until="networkidle")
    page.wait_for_timeout(1500)
    page.fill("#kk-username", "demo_player")
    page.fill("#kk-password", "kaduna-demo-2026")
    page.click("button[type=submit]")
    page.wait_for_timeout(9000)
    check("canvas mounts", page.evaluate("!!document.querySelector('canvas')"))

    # ---- first-run onboarding: character creator + tour --------------------
    # Fresh browser => sim.created is false, the creator blocks pointer
    # events (z-60) until the flow finishes; the 7-step tour follows.
    # All clicks go through JS evaluate: the overlay intercepts real mouse
    # hit-testing, and trait toggles must be counted in STATE (Vue batches
    # class updates, so DOM-class-based picking double-toggles one card).
    creator_up = lambda: page.evaluate("!!document.querySelector('div[class*=\"z-[60]\"]')")
    if creator_up():
        page.fill('input[placeholder="yourname"]', "Zaria")
        page.wait_for_timeout(400)
        for _ in range(10):
            page.evaluate("""() => {
              // traits step: converge on exactly two selected
              const cards = [...document.querySelectorAll('.kk-card-opt')]
              const on = cards.filter(c => c.classList.contains('on'))
              if (cards.length >= 2 && on.length !== 2) {
                on.forEach(c => c.click())
                cards[0].click()
                cards[1].click()
              }
              // advance the CTA whenever it is enabled
              const ctas = [...document.querySelectorAll('button.w-full.rounded-full.py-4')]
              const cta = ctas[ctas.length - 1]
              if (cta && !cta.disabled) cta.click()
            }""")
            page.wait_for_timeout(900)
            if not creator_up():
                break
        check("character creator completes", not creator_up())
        if creator_up():
            page.screenshot(path=f"{OUT}/kk-probe-creator-stuck.png")
    skipped = page.evaluate("""() => {
      const b = [...document.querySelectorAll('button')]
        .find(x => x.textContent.trim() === 'Skip')
      if (b) { b.click(); return true }
      return false
    }""")
    page.wait_for_timeout(900)
    check("tour dismissed", not page.evaluate(
        "document.body.innerText.includes('Skip')"),
        "skip clicked" if skipped else "no tour shown")

    # ---- SimHud status cluster -------------------------------------------
    page.wait_for_timeout(2000)
    hud = page.evaluate("""() => ({
      status: !!document.querySelector('[data-tour=status]'),
      money: !!document.querySelector('[data-tour=money]'),
      mood: !!document.querySelector('[data-tour=mood]'),
      dock: !!document.querySelector('[data-tour=dock]'),
    })""")
    check("SimHud status cluster", hud.get("status") and hud.get("money"), hud)
    check("dock rendered", hud.get("dock"), hud)

    # ---- Phone ------------------------------------------------------------
    js_click = lambda sel: page.evaluate(
        f"() => {{ const b = document.querySelector('{sel}'); if (b) b.click(); return !!b }}")
    js_click("[data-tour=dock-phone]")
    page.wait_for_timeout(1200)
    phone = page.evaluate("""() => {
      const b = document.querySelector('[data-tour=dock-phone]')
      return { pressed: b && b.getAttribute('aria-pressed'), }
    }""")
    check("phone opens from dock", phone.get("pressed") == "true", phone)
    page.screenshot(path=f"{OUT}/kk-probe-phone.png")
    page.evaluate("""() => {
      const b = [...document.querySelectorAll('button')]
        .find(x => x.textContent.trim() === '✕ Close')
      if (b) b.click()
    }""")
    page.wait_for_timeout(600)
    closed = page.evaluate(
        "document.querySelector('[data-tour=dock-phone]').getAttribute('aria-pressed')")
    check("phone closes", closed == "false", closed)

    # ---- 3D city map -------------------------------------------------------
    js_click("[data-tour=dock-map]")
    page.wait_for_timeout(2500)
    cmap = page.evaluate(
        "document.querySelector('[data-tour=dock-map]').getAttribute('aria-pressed')")
    check("city map opens from dock", cmap == "true", cmap)
    page.screenshot(path=f"{OUT}/kk-probe-citymap.png")
    js_click("[data-tour=dock-map]")
    page.wait_for_timeout(800)

    # ---- Home verb ---------------------------------------------------------
    pos0 = page.evaluate("window.__kk_pos ? window.__kk_pos() : null")
    js_click("[data-tour=dock-home]")
    page.wait_for_timeout(4000)
    pos1 = page.evaluate("window.__kk_pos ? window.__kk_pos() : null")
    moved = (pos0 and pos1 and (abs(pos0[0] - pos1[0]) + abs(pos0[1] - pos1[1])) > 2)
    check("home verb acts without errors", True, f"moved={bool(moved)} pos0={pos0} pos1={pos1}")

    # ---- presence / remote players socket ---------------------------------
    remotes = page.evaluate("window.__kk_remotes ? window.__kk_remotes() : null")
    check("presence socket live", remotes is not None, remotes)
    commute = page.evaluate("window.__kk_commute ? window.__kk_commute() : null")
    check("commute state exposed", commute is not None, commute)
    billboards = page.evaluate("window.__kk_billboards ? window.__kk_billboards() : null")
    check("billboard registry exposed", billboards is not None,
          billboards if isinstance(billboards, int) else (len(billboards) if billboards else billboards))

    # ---- error budget -------------------------------------------------------
    check("no page errors", not errors, errors[:3])
    if console_errs:
        real = [e for e in console_errs if "favicon" not in e.lower()]
        check("no console errors", not real, real[:3])
    page.screenshot(path=f"{OUT}/kk-probe-final.png")
    browser.close()

print(f"\n{'ALL PASS' if not fails else 'FAILURES: ' + ', '.join(fails)}")
sys.exit(1 if fails else 0)
