"""Focused diagnostic for the life-sim behavior pass:
  1. weather auto-dwell bounds (no season cycling, brief showers)
  2. a punch knocks a stationary vendor down, then they fight back or flee
  3. a named NPC (fighter) goes down and comes back at you
  4. a named NPC (fleer) goes down and runs
  5. ambient cars keep off parked vehicles (no ghosting)

NOTE on pacing: under swiftshader the game clock runs at roughly 10-30
percent of wall time (frame delta clamps at 0.1 s), so every poll window
below is sized for game time on a slow renderer. On a real machine the
same states arrive in wall seconds.

Run: python scripts/diag_life.py [baseUrl]
"""
import sys
import time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
fails = []


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'} {name}{' - ' + str(detail) if detail else ''}")
    if not ok:
        fails.append(name)


def poll(page, expr, timeout_ms):
    waited = 0
    while waited < timeout_ms:
        v = page.evaluate(expr)
        if v:
            return v
        page.wait_for_timeout(500)
        waited += 500
    return page.evaluate(expr)


def approach_and_punch(page, tx, tz, punches=3):
    """Teleport 1.5 south of the target, aim the camera forward, edge in,
    then swing. Facing follows movement, so the punch lands."""
    page.evaluate(
        """([tx, tz]) => {
          window.__kk_teleport(tx, tz + 1.5)
          const p = window.__kk_pos()
          window.__kk_setcam(Math.atan2(-(tx - p[0]), -(tz - p[1])), 0.32, 8.5)
        }""",
        [tx, tz],
    )
    page.wait_for_timeout(400)
    page.keyboard.down("ArrowUp")
    page.wait_for_timeout(260)
    page.keyboard.up("ArrowUp")
    page.wait_for_timeout(250)
    for _ in range(punches):
        page.evaluate("window.dispatchEvent(new CustomEvent('kk-action', { detail: 'punch' }))")
        page.wait_for_timeout(500)
    return page.evaluate("window.__kk_pos()")


def punch_until_down(page, target_expr, tries=4):
    """Re-approach a (possibly moving) target and punch until it drops.
    target_expr must evaluate to [x, z] or null. Returns True on a hit."""
    for _ in range(tries):
        t = page.evaluate(target_expr)
        if not t:
            return False
        approach_and_punch(page, t[0], t[1], punches=2)
        if page.evaluate("(window.__kk_crowd && window.__kk_crowd().knocked) >= 1"):
            return True
        page.wait_for_timeout(1500)
    return False


with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
              "--autoplay-policy=no-user-gesture-required"],
    )
    page = browser.new_page(viewport={"width": 720, "height": 500})
    page.add_init_script("""
      try{localStorage.setItem('kk_quality','low')}catch(e){}
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
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE + "/game", wait_until="networkidle")
    page.wait_for_timeout(1500)
    page.fill("#kk-username", "demo_player")
    page.fill("#kk-password", "kaduna-demo-2026")
    page.click("button[type=submit]")
    page.wait_for_timeout(9000)
    for _ in range(10):
        page.evaluate("""() => {
          const cards = [...document.querySelectorAll('.kk-card-opt')]
          const on = cards.filter(c => c.classList.contains('on'))
          if (cards.length >= 2 && on.length !== 2) { on.forEach(c => c.click()); cards[0].click(); cards[1].click() }
          const ctas = [...document.querySelectorAll('button.w-full.rounded-full.py-4')]
          const cta = ctas[ctas.length - 1]
          if (cta && !cta.disabled) cta.click()
        }""")
        page.wait_for_timeout(900)
        if page.evaluate("!document.querySelector('div[class*=\"z-[60]\"]')"):
            break
    page.evaluate("""() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Skip')
      if (b) b.click()
    }""")
    page.wait_for_timeout(1000)

    # ---- 1. weather: no season cycling, showers are brief ------------------
    w = page.evaluate("window.__kk_weather('rain', true)")
    check("rain dwell is brief", 30 <= w.get("timer", 1e9) <= 85, w.get("timer"))
    w = page.evaluate("window.__kk_weather('sunny', true)")
    check("sunny stretches are long", 280 <= w.get("timer", 0) <= 620, w.get("timer"))
    check("all peds published to traffic",
          (page.evaluate("window.__kk_crowd().probePeds") or 0) >= 80,
          page.evaluate("window.__kk_crowd().probePeds"))

    # ---- 2. crowd ped: punch -> knockdown (crowd melee queue) --------------
    landed = punch_until_down(page, "window.__kk_nearest_ped ? window.__kk_nearest_ped() : null")
    check("punch knocks a ped down", bool(landed))

    # ---- 3. named NPC: fighter comes back at you ---------------------------
    named = page.evaluate("window.__kk_named && window.__kk_named()")
    fighters = [n for n in (named or []) if n.get("fighter")]
    fleers = [n for n in (named or []) if not n.get("fighter")]
    check("named npc states exposed", bool(named), [n["code"] for n in (named or [])])
    if fighters:
        f = fighters[0]
        approach_and_punch(page, f["x"], f["z"])
        down = poll(page, f"(window.__kk_named('{f['code']}') || {{}}).state === 'down'", 30000)
        check("named fighter goes down", bool(down), f["code"])
        fight = poll(page, f"(window.__kk_named('{f['code']}') || {{}}).state === 'fight'", 130000)
        check("named fighter fights back", bool(fight), f["code"])
        closed = poll(
            page,
            """(() => {
              const n = window.__kk_named && window.__kk_named()
              if (!n) return false
              const f = n.find(x => x.state === 'fight')
              if (!f) return false
              const p = window.__kk_pos()
              return Math.hypot(f.x - p[0], f.z - p[1]) < 2.2
            })()""",
            45000,
        )
        check("fighter closes in on the player", bool(closed))
    else:
        check("a fighter npc exists", False, named)

    # ---- 4. named NPC: fleer runs ------------------------------------------
    if fleers:
        f = fleers[0]
        home = (f["x"], f["z"])
        approach_and_punch(page, f["x"], f["z"])
        down = poll(page, f"(window.__kk_named('{f['code']}') || {{}}).state === 'down'", 30000)
        check("named fleer goes down", bool(down), f["code"])
        fled = poll(page, f"(window.__kk_named('{f['code']}') || {{}}).state === 'flee'", 130000)
        check("named fleer runs away", bool(fled), f["code"])
        moved = poll(
            page,
            f"""(() => {{
              const n = window.__kk_named('{f['code']}')
              return n && Math.hypot(n.x - {home[0]}, n.z - {home[1]}) > 1.5
            }})()""",
            45000,
        )
        check("fleer actually moves away from home", bool(moved))
    else:
        check("a fleer npc exists", False, named)

    # ---- 5. ambient cars keep off parked vehicles --------------------------
    page.evaluate("window.__kk_teleport(-294, 120)")  # back to the spawn block
    page.wait_for_timeout(1500)
    worst_gap = 99.0
    samples = 0
    t0 = time.time()
    while time.time() - t0 < 14:
        gap = page.evaluate("""(() => {
          const fleet = window.__kk_fleet ? window.__kk_fleet() : []
          const t = window.__kk_traffic ? window.__kk_traffic() : null
          if (!t || !t.posNear || !fleet.length) return null
          let worst = 99
          for (const c of t.posNear)
            for (const f of fleet)
              worst = Math.min(worst, Math.hypot(c[0] - f[1], c[1] - f[2]))
          return worst
        })()""")
        if gap is not None:
            worst_gap = min(worst_gap, gap)
            samples += 1
        page.wait_for_timeout(500)
    check(
        "cars keep off parked vehicles",
        samples >= 10 and worst_gap > 1.2,
        f"worst gap {worst_gap:.2f} over {samples} samples",
    )

    check("no page errors", not errors, errors[:3])
    browser.close()

print(f"\n{'ALL PASS' if not fails else 'FAILURES: ' + ', '.join(fails)}")
sys.exit(1 if fails else 0)
