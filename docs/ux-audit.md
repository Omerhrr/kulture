# Kaduna Kulture: product & UX audit (Oct 2026)

A pre-DevFest Kaduna '26 audit of the player experience, focusing on the first two minutes a judge spends with the game.

## Severity key
- **P0**: blocks or confuses a first-time player or a judge.
- **P1**: visible polish or quality issue.

## P0: fixed
| # | Problem | Fix |
|---|---|---|
| 1 | Home interiors were crude boxes and you couldn't see inside | Rebuilt as a furnished cut-away "doll's house" home (`utils/interiorRoom.ts`). Living room, kitchen, bath and bedroom, with textured floors, real lighting, and walls that drop when they face the camera. Every house in the city can be entered. |
| 2 | No guidance: players didn't know what to do | `ObjectiveTracker.vue` walks the golden path (Musa → job → pickup → deliver to Amina → pay with Lightning), with a live distance and direction arrow. It can be minimised or dismissed. |
| 3 | Ride, door and ped prompt buttons couldn't be tapped (`pointer-events-none` parent) | Added `pointer-events-auto` to each panel. |
| 4 | The "rotate your phone" overlay showed even in landscape | It now checks the real orientation and re-checks on resize or rotation. |
| 5 | Signed-in players saw the login form flash, and a blank screen while the city built | Added a boot state and a "Building Kaduna…" loader. |
| 6 | The camera clipped into buildings on narrow streets | The camera boom marches against the collision grid and pulls in before walls, then eases back out. |

## P1: fixed
| # | Problem | Fix |
|---|---|---|
| 7 | The controls hint covered the world permanently | It auto-hides after 15 s and collapses to a "? Controls" button. |
| 8 | Trees and kiosks blocked Musa's storefront and NPC spots | Added keep-clear zones (14 m) around every playable position. |
| 9 | Map legend: dark-on-dark "Tall towers" text, civic icons missing | Rebuilt the legend with white labels and added the hospital, school, filling station and mechanic icons. |
| 10 | The HUD overflowed on short landscape phones (844×390) | Labels and the avatar tile hide when the viewport is under 500 px tall, and the guide starts minimised. |
| 11 | The mobile action button always said TALK | It now reads TALK, BOARD, EXIT, ENTER or EXIT depending on context. |
| 12 | Leftover debug error hook in `game.vue` | Removed. |
| 13 | No way to trade looks for frame rate | An HD/Lite toggle in the HUD. Lite means dpr 1, no shadows, a smaller detail radius and lighter rain. It defaults to Lite on touch devices. |

## Still open / recommended
- Run a usability test with 3-5 people who haven't played. Time how long it takes them to reach the Lightning payment, and aim for under 3 minutes.
- Do the demo rehearsal on the actual venue laptop and projector. Use Lite if it runs below 30 fps.
- Interiors are generated from one layout family. Add 2-3 floor-plan variants (flat, duplex ground floor, shop with living quarters).
- Accessibility: keyboard focus rings on HUD buttons, a reduced-motion option for camera shake, and colour-blind-safe map icons.

---

# UI / visual design pass (Oct 12)

Screen-by-screen review of the landing page, login, HUD, panels, interaction sheet, dialogue, shop, Lightning payment, and mobile in portrait and landscape.

## Bugs found while auditing
| Problem | Impact | Fix |
|---|---|---|
| API timestamps had no timezone (SQLite drops it) | Every Lightning invoice showed **"expired"** in a Lagos browser (UTC+1), and ledger times were off by an hour | `app/schemas/utc.py`: every API datetime is now serialised as UTC with `Z`. Regression test added. |
| Recycled traffic with a zero heading vector passed the hit test from any distance | The player was randomly knocked down while standing on the pavement, anywhere in the city | Fixed the zero-length route segments, plus a proximity gate before the hit test |
| Brand fonts (Fredoka / Nunito) loaded from Google Fonts | They silently fell back to the system font when offline or on poor venue Wi-Fi | Self-hosted via `@fontsource` (run `bun install`) |
| `bg-gold` class was used but never defined | The guide's current-step bar and the mobile action highlight were invisible | Added the `gold` colour token |
| Camera at spawn faced the player's back against a house wall | First impression was a screen full of wall | When the camera is pinned, it swings toward open space |

## Visual and interaction changes
- **HUD hierarchy**: eight equal pills became three groups:
  - World (time and weather in one pill)
  - Navigation (Map, Bag, Jobs, Ledger, with keyboard hints and an active-job dot)
  - A ⚙ settings menu (sound switch, graphics quality)
- **Mobile**: the top bar no longer duplicates the map button. Portrait wraps cleanly, and the guide starts minimised.
- **Minimap**: uses a label-free map, so no more giant clipped names. It hides while a side panel is open.
- **Interaction sheet**:
  - Has a title and the question "What would you like to do?".
  - The primary action is filled, and options are numbered so number keys work.
  - Talk-only spots skip the sheet entirely, because the dialogue opens directly.
- **Lightning payment**:
  - A four-step progress bar (Invoice → Pay → Verified → Delivered).
  - The sats amount is the hero number, with a live expiry countdown.
  - "Open wallet" (`lightning:` link) and Copy buttons, and a tappable QR.
  - Clear demo-wallet labelling.
  - The trust explanation is folded behind "How is this payment verified?".
  - Success screen: "Paid. It's in your bag.", now 4.5 s instead of 1.6 s.
- **Dialogue**: initial avatar instead of a farmer emoji, plain labels ("AI shopkeeper" / "Scripted"), larger text, and it is narrower in landscape so it clears the joystick.
- **Consistency**:
  - One close button style (`.kk-close`, 32 px target).
  - Focus rings show only for keyboard users (`focus-visible`).
  - The guide's distance text spacing is fixed.
