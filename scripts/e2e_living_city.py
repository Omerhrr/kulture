# Headless E2E verification for the living-city pass:
# day/night cycle, traffic behavior, pedestrian smarts, street chat,
# interior isolation, vehicle probe, audio wiring.
# Run: python scripts/e2e_living_city.py [baseUrl]
import re
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
results = []


def ok(name, passed, detail=""):
    results.append((name, passed))
    print(("PASS " if passed else "FAIL ") + name + ((" - " + str(detail)) if detail else ""))


with sync_playwright() as pw:
    browser = pw.chromium.launch(
        headless=True,
        executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome" if __import__("os").path.exists("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") else None, args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
    )
    page = browser.new_page(viewport={"width": 1280, "height": 760})
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

    # ---------- movement still works (open road first: persisted spawn can
    # sit wedged against a market shed, which would block the probe)
    page.evaluate("window.__kk_teleport && window.__kk_teleport(-182, 256.45)")
    page.wait_for_timeout(600)
    p0 = page.evaluate("window.__kk_pos && window.__kk_pos()")
    page.keyboard.down("ArrowUp")
    page.wait_for_timeout(2000)
    page.keyboard.up("ArrowUp")
    p1 = page.evaluate("window.__kk_pos && window.__kk_pos()")
    moved = bool(p0 and p1 and ((p1[0] - p0[0]) ** 2 + (p1[1] - p0[1]) ** 2) ** 0.5 > 2)
    ok("arrow key movement", moved, f"{p0} -> {p1}")

    # ---------- day/night cycle
    t0 = page.evaluate("window.__kk_time && window.__kk_time()")
    ok("day/night clock running", bool(t0 and t0.get("hour", 0) > 0), t0)
    for _ in range(9):
        page.evaluate("window.dispatchEvent(new CustomEvent('kk-time-skip'))")
    page.wait_for_timeout(2500)
    t1 = page.evaluate("window.__kk_time && window.__kk_time()")
    ok("time skip reaches night", bool(t1 and t1.get("night", 0) > 0.8), t1)
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
    for _ in range(14):
        page.evaluate("window.dispatchEvent(new CustomEvent('kk-time-skip'))")
        page.wait_for_timeout(350)
        t2 = page.evaluate("window.__kk_time && window.__kk_time()")
        if t2 and t2.get("night", 1) < 0.4:
            break
    page.wait_for_timeout(2000)
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
    page.wait_for_timeout(4000)
    traffic2 = page.evaluate("window.__kk_traffic && window.__kk_traffic()")
    ok("cars actually move", bool(traffic2 and traffic2.get("avgV", 0) > 3), f"avgV {traffic2 and traffic2.get('avgV')}")

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

    # ---------- interiors: teleport to the first open house door and enter
    page.evaluate(
        """() => {
      const doors = window.__kk_doors && window.__kk_doors();
      if (doors && doors[0]) window.__kk_teleport(doors[0].door[0], doors[0].door[1]);
    }"""
    )
    page.wait_for_timeout(1400)
    prompt_visible = page.evaluate("document.body.innerText.includes('Enter')")
    ok("door prompt visible at the entrance", prompt_visible)
    page.evaluate("window.dispatchEvent(new CustomEvent('kk-door-use'))")
    page.wait_for_timeout(8000)  # software GL in CI is slow to settle
    interior = page.evaluate("window.__kk_interior && window.__kk_interior()")
    ok("interior entered", bool(interior and interior.get("inside")), interior)
    cam = page.evaluate(
        """() => {
      const r = window.__kk_ctx;
      const c = (r && r.camera && r.camera.activeCamera && r.camera.activeCamera.value) || ((r && r.cameras && r.cameras.value || [])[0]);
      return c ? [ +c.position.x.toFixed(1), +c.position.y.toFixed(1), +c.position.z.toFixed(1) ] : null;
    }"""
    )
    ok("camera sinks to the underground room", bool(cam and cam[1] < -30), cam)
    page.screenshot(path="/tmp/kk-interior.png")

    # walk within the room
    before = page.evaluate("window.__kk_pos()")
    page.keyboard.down("ArrowDown")
    page.wait_for_timeout(800)
    page.keyboard.up("ArrowDown")
    after = page.evaluate("window.__kk_pos()")
    walked = bool(before and after and ((after[0] - before[0]) ** 2 + (after[1] - before[1]) ** 2) ** 0.5 > 1)
    ok("can walk within the room", walked, f"{before} -> {after}")

    # exit through the door
    page.evaluate(
        """() => {
      const doors = window.__kk_doors && window.__kk_doors();
      if (doors && doors[0]) window.__kk_teleport(doors[0].door[0], doors[0].door[1]);
    }"""
    )
    page.wait_for_timeout(1400)
    page.evaluate("window.dispatchEvent(new CustomEvent('kk-door-use'))")
    page.wait_for_timeout(1000)
    interior2 = page.evaluate("window.__kk_interior && window.__kk_interior()")
    ok("interior exit works", bool(interior2 and not interior2.get("inside")), interior2)

    # ---------- vehicles + probe
    page.evaluate("window.__kk_teleport && window.__kk_teleport(-174, 256.45)")
    page.wait_for_timeout(1600)
    fleet = page.evaluate("window.__kk_fleet && window.__kk_fleet()")
    ok("boardable fleet exists", isinstance(fleet, list) and len(fleet) >= 9, len(fleet) if fleet else None)
    page.evaluate("window.dispatchEvent(new CustomEvent('kk-ride-toggle'))")
    page.wait_for_timeout(1300)
    ride = page.evaluate("window.__kk_ride && window.__kk_ride()")
    ok("boards the nearest vehicle", bool(ride and ride.get("active")), ride and ride.get("kind"))
    page.keyboard.down("KeyW")
    page.wait_for_timeout(3000)
    page.keyboard.up("KeyW")
    ride2 = page.evaluate("window.__kk_ride && window.__kk_ride()")
    ok("vehicle drives", bool(ride2 and ride2.get("speed", 0) > 2), f"speed {ride2 and ride2.get('speed')} km/h")
    page.evaluate("window.dispatchEvent(new CustomEvent('kk-ride-toggle'))")
    page.wait_for_timeout(900)

    # ---------- audio wiring
    audio = page.evaluate("window.__kk_audio && window.__kk_audio()")
    ok("audio engine ready", bool(audio and audio.get("ready")), audio)

    ok("no page errors at the end", len(errors) == 0, errors[:4])
    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
