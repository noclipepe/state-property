# STATE PROPERTY

[![PLAY NOW](https://img.shields.io/badge/%E2%96%B6%20PLAY%20NOW-state--property.pages.dev-5b50b4?style=for-the-badge)](https://state-property.pages.dev/)

Six playable perspectives on the State Property meme, plus Fish Escape, an endless hopping run, in the
browser. Built for desktop and mobile.

![The series menu: Fisherman POV with skin selection, Driver, Fish, Ant and God POV](docs/screenshot.png)

## The games

- **Fisherman POV**: you stand at the pickup's open window with a fishing rod while the driver
  tells you off. Cast at his mirror, his cap or his sleeve, or hook the truck itself and drag it
  across the lawn.
- **Driver POV**: you are the man in the pickup. Pick what to say to the fisherman. The right
  answers replay the original conversation with the original voices; then he hooks your truck
  and hauls it toward the pond, with you still inside.

- **Fish POV**: you are a caught fish inside a metal bucket. Listen to the full original
  argument, swim around, surface to hear clearly, and splash. The pickup eventually knocks
  the bucket over, spilling the water and fish onto the bank for a brief ending.

- **Ant POV**: carry a crumb along the pickup and back to the colony in about 32 seconds while
  the original argument continues overhead. Dodge the fisherman's boot and rod, wait for him
  to haul the truck across the trail, then crawl beneath its detailed underbody to the anthill.
  Red ground marks the actual impact areas. A hit retries from a nearby checkpoint.

- **God POV**: rise from the argument into a divine view, pull the lake plug, pick up the truck,
  grow a giant ant and summon a fish thunderstorm. The powers share one world and work in any
  order. The giant ant follows and pushes the pickup, then eats fallen fish.

- **Witness POV**: hide on a branch over the pond and watch the argument through binoculars.
  Each man has his own suspicion meter; stare too long and one of them spots you. "HEY!",
  you flinch, the branch cracks, and you end up in the pond looking up at both of them.

- **Fish Escape**: the fish jumps out of the bucket and hops for its life, Crossy Road style:
  crabs, cars, pickups and box trucks, fast streams and PRIVATE PROPERTY fences, while the
  original argument plays in the background. Keep moving or the fisherman hooks you back.

All seven start from one menu (`index.html`, "Choose your POV"). On phones, the looping carousel
swipes in either direction and snaps to a card, with neighboring cards peeking in at the edges.
Only Fish Escape has a **NEW** badge and a gold outline. The Fisherman card has a
**SKIN: ORIGINAL / GRU** selector. Original is the default; an explicit
selection is remembered in this browser. The selector updates a static gameplay preview
without loading a 3D scene or leaving the menu. Press PLAY to launch the selected version.
Escape, clicking outside or tabbing away dismisses the panel. Arrow keys move between options;
Enter or Space selects one. Driver, Fish, Ant and God POV keep their original characters.

The same filled bucket appears beside the pickup in the two human perspectives, with larger
fish in Fisherman POV.

### Gru skin

Gru sits in a riveted metal vehicle with an open cockpit, striped scarf and a mounted shrink
ray beside the driver's window. Take the ray, aim, and fire at the vehicle or the fish bucket.
The fishing rod is stowed before the ray enters the player's hand. Misses do nothing.

A hit shrinks the vehicle and its occupant together over 0.8 seconds, including collision
bounds, while keeping the wheels grounded. The separate bucket target shrinks with its water
and swimming fish. The ray and first-person camera stay at normal scale. Repeated hits cannot
shrink a target indefinitely; either target can be hit first.

The current voice line continues uninterrupted. Tiny Gru's higher-pitched voice follows his
position near the ground, then original recorded complaints continue for about 26 seconds.
Restart restores both targets, the mounted weapon, held items and dialogue.

`GRU_CONFIG` in `src/gameplay/gru-scene.js` sets the vehicle scale to `0.12`, bucket scale to
`0.22`, voice pitch to `1.85` and shrink duration to `0.8`. The full-size vehicle measures
5.965 x 2.184 x 2.112 world units (length x width x height), within the original pickup limits.
`fisherman.html?skin=gru&showcase` records a repeatable conversation, pickup, shot and miniature
inspection using the same interactions as manual play. Add `&clean` to hide the interface.

### Ant POV

Open `ant.html` directly or choose **ANT POV — Just trying to get home.** in the menu.
The opening shows a marching colony below the original characters, then continuously moves
forward to the playable ant. The camera stays anchored during mouse/touch orbit and LOOK UP.

The boot lands with a bass thud, dust and a brief shake; reduced motion disables the shake.
The held rod sweeps the trail, then the player's approach triggers a strong truck pull. Its
1.25-second warning precedes a 0.9-second move, so the pickup stops before the ant reaches
the rear axle even with continuous forward input. Crawl between the wheels to deliver the
crumb. The uninterrupted 61.864-second original recording continues through **CRUMB SECURED.**
and finishes naturally without looping. Checkpoint retries preserve the dialogue.

The original pickup has simple rectangular headlights, a grille and bumper trim. Closed wheel
rims prevent seeing through the tires from underneath. Ant mode adds chassis, axles, suspension,
drivetrain, exhaust, tank and spare tire detail in three material batches. A single soil grid
avoids overlapping ground at the rear wheel; fine grass and trail crumbs use instanced meshes.

### God POV

Open `god.html` directly or choose **GOD POV** from the menu. The four-second introduction starts
close to the fisherman and the driver, turns toward gathering clouds and golden light, then
rises into a stable three-quarter view. It can be skipped; Reset World does not replay it.

An articulated first-person hand grips the plug ring and pickup. Pull the ring upward to drain
the lake, then place the truck on its exposed bed. The glowing giant ant follows the truck
immediately, pushes it when grounded, and eats nearby fallen fish. A storm drops one fish,
pauses, then rains a bounded burst that interacts with the truck, ground and remaining water.
The fisherman turns toward the moved truck; both voices follow their speakers' positions.

The original argument continues underneath synthesized divine choir, wind and impact sounds.
Larger subtitles stay above a reserved hint area, so appearing or expiring instructions do not
move the dialogue. Reset World restores all powers, weather, audio and active gestures.

### Witness POV

Open `tree.html` directly or choose **WITNESS POV** from the menu. You sit on a branch of a
pondside tree, about 9 m from the pickup, with your legs on a fork of the branch and the
binoculars in your hands. The branch sways, you rock gently on it, and your body leans the way
you look. Both men are visible through a gap in the leaves.

Suspicion rises only while the binoculars are aimed at a man (faster near the centre of the
lenses): a steady stare fills a meter in about 4.5 seconds. Looking away lets it fall slowly;
lowering the binoculars into the leaves lets it fall faster; switching targets keeps the other
meter. Above each man: an eye icon, a bar and his state in words (UNAWARE, DISTRACTED,
SUSPICIOUS, SPOTTED YOU). Distracted, he glances around; suspicious, he searches toward the tree
(hide now and he calms down); at full suspicion the icon turns into a red "!" and he looks
straight at you. The fisherman's "HEY!" is his own line from the original recording.

Getting caught plays once: the other man turns too, you flinch, the branch bends and cracks,
your hands grab for it, the binoculars slip, and you fall backward into the pond. A short
underwater ending follows in the Fish POV's water style: the binoculars sink past you while
both men peer down from the bank. Then **Caught watching**, your score and **TRY AGAIN**.

The score is the time you spent actually watching them: seconds with the binoculars raised and
aimed at one of the men (the sky, the road or hiding in the leaves don't count). It ticks up in
the WATCHING badge while you play; the end screen shows it with your personal best in this
browser. Lasting longer means switching between the two men and hiding at the right moments.

## Fish Escape

Open `escape.html` (or **FISH ESCAPE** in the menu). An endless hop-the-crossings run in the
spirit of Crossy Road: the fish leaps out of the bucket by the pickup and flops along the lake
shore, one grid cell per hop.

- **Opening:** PLAY (which also turns the sound on) opens on the series' familiar shot: the
  fisherman at the pickup's window, letterboxed, "Who told you you could fish here?" with a
  caption and mouths following the recording, while the fish keeps leaping up out of the bucket
  beside them. Right after that line the camera drops to the bucket, the fish jumps out and the run
  begins; the exchange carries on in the background ("I thought it was state property." …
  "STATE?!" "Yeah."). Any tap or key skips it (a move key also hops at once). PLAY AGAIN goes
  straight to the run.
- **Controls:** tap / W / ↑ / Space hop forward; swipe or A, D, S (←, →, ↓) hop left, right or
  back. One gesture is one move (decided when the finger lifts); one extra input during a hop is
  kept, a burst never queues up a run of hops. Held keys do not repeat. Every 3–6 hops the fish
  rolls right over in the air and lands on its other side.
- **Grass:** safe ground with tufts, clover, flowers, toadstools and lines of ants carrying crumbs;
  buckets, boulders and round bushes block cells (bump one and it wobbles). **Fences** with
  PRIVATE PROPERTY / STATE PROPERTY signs cross the lawn with a one- or two-cell gate near the
  middle, never straight ahead of the last one: holding forward doesn't get you anywhere.
- **Sand:** crab lanes, one species per lane: red shore crabs, blue crabs, green crabs, violet
  crabs, small fast ghost crabs, and the occasional huge, slow king crab. They walk sideways in
  groups; a hop is not a jump over them. Lost hooks lie in the sand.
- **Road:** vehicles at real width, so a lane spans several rows: cars and the familiar pickup take
  2 rows, box trucks (STATE PROPERTY on the side and roof) take 3. Three kinds, five colours each.
  Dashed lines between lanes going the same way, a double yellow line between opposite ones,
  kerbs, PRIVATE PROPERTY painted on the odd lane. Express lanes send one fast white pickup
  through; lamps at both ends blink and a bell rings first.
- **Stream:** one to three rows; a strong current carries the fish sideways (from the middle to
  the edge in about 2 s, 1.3 s later on); drift off the edge and you're swept away. The
  fisherman's red and white floats drift past.
- **The original argument plays in the background:** after the opening, a line every 14–22 s,
  and each ending has its own ("Lock 'em up!" when hooked, "Hit the road, dude." under a
  vehicle), all captioned.
- **The hook:** no new furthest row for 6 s and the fisherman casts at your cell (a red circle
  fills while the hook drops). Leave the circle in 1.2 s and it misses; it can retry after a
  short pause; any new furthest row cancels it. Caught: lifted out and dropped back into the bucket.
- **Difficulty** rises over the first 90 rows (faster lanes, tighter gaps, more lanes in a row,
  mixed sand and road, more blockers and fences, a single grass row between hazards), then stays put.
- **Score:** one point per new furthest row (going back and forth doesn't count); the best is
  kept in the browser.
- All tuning is in `src/escape/config.js`. The rules run at a fixed 120 Hz step. The generator
  guarantees that grass rows stay connected around blockers with no dead ends (you never have to
  go back to reach a gap or a gate), that every lane (including consecutive and multi-row lanes)
  leaves enough time to cross, and that streams sit between grass rows; rows behind the fish are
  recycled.

```bash
npm run verify:escape          # opening scene, controls, taps vs swipes, blockers and fences, crabs and wide vehicle lanes, the fish's roll, streams, express warning, hook, scoring, generator fairness, holding forward, bot runs, layouts
node tools/capture-escape.mjs  # writes assets/brand/card-escape.jpg
```

## Controls

**Fisherman POV**

| | Desktop | Mobile |
|---|---|---|
| Look around | drag with the mouse | drag an empty area |
| Move | WASD / arrow keys | left stick |
| Cast | click a highlighted target | tap a target |
| Reel in | hold **Space** or **REEL** | hold **REEL** |
| Release the hook | **X** / **Q** | **Release** |
| Restart / mute | **R** / **M** | buttons at the top |
| Truck Showcase, Record Mode | **T**, or Modes | Modes |

Movement and shortcuts use physical keys, including when a Russian or other keyboard layout is active.

**Gru skin:** **E / TAKE** picks up the ray; **F / Space / FIRE** fires through the reticle.
Click or tap a visible point in the scene to shoot there. Drag to aim as usual. **T** or
**Modes > Gru Showcase** starts the repeatable sequence; **TAKE CONTROL** returns to manual play.

**Driver POV**

| | Desktop | Mobile |
|---|---|---|
| Look around (always, even while people talk) | drag, or arrow keys / WASD | drag on the scene |
| Answer | click a line, or **1** / **2** / **3** | tap a line |
| Show him the finger | **F** or 🖕 | 🖕 |
| Pause / menu | **Esc** / **P** | pause button |
| Restart / mute | **R** / **M** | buttons at the top |
| Hide the top bar for recording | **H**, or add `?clean` to the address | `?clean` |

**Fish POV controls:** drag or swipe to look; use **WASD** or the left pad to swim. Hold
**Space / SURFACE** to rise and release to sink; press **F / SPLASH** to jump. **Esc**, **R**
and **M** pause, restart and mute. Loading opens the game immediately. If autoplay is blocked,
the first tap unlocks audio and starts the waiting dialogue. Speech becomes muffled underwater
and clear above the surface without restarting the clip. Subtitles and a repeatable recording
showcase are available from the pause menu; `fish.html?showcase&clean` starts a showcase with
its interface hidden. Fish POV uses the original recordings in order, with no invented speech.

**Ant POV controls:** **WASD / arrow keys** or the compact left joystick move the ant; forward
follows the route and left/right dodge. Drag or swipe to look, **V / LOOK UP** looks overhead,
and **C / TRAIL CAM** returns behind the ant. **Esc / P**, **R**, **M** and **H** pause, restart,
mute and hide the interface. If autoplay is blocked, tap **TAP TO START**. Replay starts a new
marching opening; automatic checkpoint retries skip it.

**Witness POV controls:** drag (mouse or finger) to look around. Press and hold on someone
(or hold the right mouse button / **Space**) to raise the binoculars, aimed at that point; keep
dragging to aim and release to lower them. Arrow keys look/aim, **R** restarts, **M** mutes.

**God POV controls:** drag the plug upward or use **PLUG**, then pull it with the hand.
Drag the pickup with one finger or the mouse and release to place it. Tap **GIANT ANT** and
**FISH RAIN** for the other powers. **1–4** select powers; arrow keys move a held pickup or pull
the plug upward, **Enter** places the pickup and **R** resets the world. **SOUND ON/OFF** toggles audio.
The on-screen **RESET WORLD** and **MENU** controls remain available on phones.

## Run it locally

Requires Node.js 22.2 or newer. three.js is included in `vendor/`, so playing needs no packages.

```bash
npm ci          # development tools only (mesh bakers, browser tests)
npm start       # static server; open the address it prints
```

Modules and assets need to be served over HTTP; opening the HTML files directly from disk won't
work.

## Build

```bash
npm run build   # -> dist/ (the menu and all five game pages, ready to host as static files)
```

The build copies only what the pages use, packs the meshes, fills in share metadata and creator
links from `src/site-config.js`, and checks that every file is under 25 MiB. To test the build
locally, run `npm run serve:dist` and open the printed address.

Cloudflare Pages settings: framework preset **None**, build command `npm run build`, build output
directory `dist`, root directory left empty (the repository root).

## Project notes

- `src/site-config.js` holds everything public-facing: the games in the menu, creator links,
  the public site address (`siteUrl`, used for canonical links and share previews) and an
  optional analytics adapter (off by default; no data is collected). To add a game, add an
  entry to `SITE.games`.
- `tools/bake-*.mjs` regenerate the meshes (`npm run bake`). The `verify-*` scripts and
  `check.mjs` are browser tests (Playwright; `npx playwright install chromium` first).
- `npm run bake:gru` regenerates Gru's mesh. `npm run verify:gru` checks the production preview;
  `node tools/verify-gru-bucket.mjs` covers both shrink targets and restart. `npm run verify:hub`
  covers skin selection, persistence, keyboard/touch controls and all five POV launches.
- `node tools/verify-god.mjs http://localhost:8080/` checks the intro, all four powers in
  different orders, resets, release/cancellation, mobile touch controls and navigation.
  The other `verify-god-*` scripts cover hand grip, atmosphere, ant behavior and spatial audio.
  `node tools/verify-hub-touch.mjs http://localhost:8080/` checks real emulated touch swipes,
  short-swipe snapping, looping, navigation and slow or failed preview loading.
- With the local server running, `node tools/verify-ant-mode.mjs http://localhost:8080/` checks
  the opening, camera tracking, physical warnings/collisions, checkpoints, delivery at 60/20 Hz,
  and desktop/touch controls. `node tools/verify-ant-route.mjs http://localhost:8080/` also checks
  real-time keyboard delivery and the complete audio recording without repeats. Phone checks
  use Chromium emulation; physical iOS/Android devices have not been tested.
- Menu previews are lightweight JPEGs captured from the game. With the development server
  running, `node tools/capture-previews.mjs --fisherman-skins` regenerates both Fisherman previews.
- Original reference media, local transcripts and development reports are not included in this
  repository or the production build. Browser checks include desktop and phone emulation.
- See [ATTRIBUTION.md](ATTRIBUTION.md) for third-party code, the font and asset provenance.

No open-source license is granted for this project's own code, art or branding. Third-party
components keep their own licenses (see ATTRIBUTION.md).

## Created by @noclipepe

- Instagram: [instagram.com/noclipepe](https://www.instagram.com/noclipepe/)
- X: [x.com/noclipepe](https://x.com/noclipepe)
