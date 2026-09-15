# ✈ Sky Captain

A complete, polished, realistic **airline pilot career simulator** that runs entirely in the
browser — no build step, no dependencies, no placeholders. Fly gate-to-gate sectors,
talk to ATC, earn USD, buy bigger jets (up to 777 / A380 class), upgrade them, earn
licenses and ratings, and build your pilot career.

Just open it and fly — on desktop (keyboard + mouse, gamepad supported) or mobile
(touch controls).

## Play

```bash
cd sky-captain
python3 -m http.server 8080
# open http://localhost:8080
```

Or play the pre-built package in `dist/` (see **Build** below).

## Features

- **Career loop** — pilot creation, starting money, licenses, ratings, logbook,
  persistent save/load (localStorage), suggestion box.
- **USD economy, no pay-to-win, ads-free** — earn per flight from distance, landing
  quality, ATC compliance and fuel efficiency; buy aircraft and upgrades.
- **Full gate-to-gate flights** — pushback/taxi, takeoff, climb, cruise, descent,
  ILS-style approach guidance, flare, rollout, taxi-in to the gate.
- **Playable ATC** — clearance delivery through tower; voice readback (speech
  synthesis), predefined phrase menu, free text, and a chat box. Fly the
  pattern as ATC or as pilot in multiplayer.
- **Multiplayer-ready** — net layer with lobby/chat scaffolding; single-player and
  multiplayer share the same flight model and procedures (parity by design).
- **Fuel system** — 1 s ≈ 0.1 fuel baseline at cruise (configurable in
  `js/config.js`), phase-dependent burn, low-fuel warnings, partial refueling
  and fuel-truck service on the ground.
- **World airports + map** — Mumbai, Goa, Delhi, Hyderabad, Dubai, London, Paris
  and more, with a live world-map view.
- **Aircraft progression** — Sparrow trainer → Meridian turboprop → Metro jet →
  widebodies (777 / A380 class), each with upgrades (engines, avionics, fuel).
- **Flight model** — lift/drag/thrust physics, flaps, gear, stalls, crosswinds,
  ground effect, hard-landing / gear-up / excursion crash detection, and a
  capable autopilot (HDG/ALT/SPD + approach beam + auto-flare).
- **Cockpit + camera views** — 2.5D cockpit instruments, tower/flyby/chase views.
- **Weather + day/night** — METAR-style winds, gusts, turbulence, day/night cycle.
- **AI traffic** — ambient aircraft on the map and in the pattern.
- **Modes** — tutorial missions, free flight, career missions, time acceleration
  (1×–20×), crash → respawn at last safe airport with repair bill.

## Controls

| Action | Keyboard | Touch / Pad |
|---|---|---|
| Pitch / roll | Arrow keys / mouse drag on yoke | Left stick / tilt yoke |
| Throttle | W / S | Throttle slider |
| Brake | B (hold) | Brake button |
| Gear | G | Gear lever |
| Flaps | F (cycle) | Flaps lever |
| Autopilot | A (toggle) | AP button |
| ATC menu | T | ATC button |
| Pause | Esc / P | Pause button |
| Camera | C (cycle) | Camera button |

## Project layout

```
index.html        game shell + all screens
css/style.css     full UI styling
js/               game source (plain ES5, no modules — loads via <script> tags)
  config.js       tuning: fuel rates, economy, assists
  utils.js        math/geo helpers
  data.js         airports, aircraft, missions, tutorial
  save.js         profiles + persistence
  core.js         game state, time, weather, traffic, economy wrappers
  flight.js       flight model, autopilot, phases, touchdown, fuel
  atc.js          ATC engine (clearances, phrases, ratings)
  net.js          multiplayer/chat transport layer
  render.js       canvas cockpit + near-plane-clipped 3D-ish scene renderer
  maps.js         world map + approach radar + flight minimap
  ui*.js          menu / flight HUD / ATC UI
  audio.js        WebAudio sounds + voice readback
  input.js        keyboard/mouse/touch/gamepad
  main.js         bootstrap + game loop
tools/
  test-logic.js   unit tests (economy, ratings, ATC, saves…)
  test-flight.js  headless E2E: AI pilot flies BOM→GOI gate-to-gate + crash recovery
  test-render.js  renderer: paints every phase day/night/storm, asserts runway stays visible
  test-ui.js      full-app UI flow: all screens, flight, ATC shift, MP lobby, crash, results
dist/             built package (see Build)
```

## Tests

```bash
node tools/test-logic.js    # unit tests — must print ALL TESTS PASSED
node tools/test-flight.js   # E2E gate-to-gate + crash recovery — must print ALL E2E TESTS PASSED
node tools/test-render.js   # renderer — must print ALL RENDER TESTS PASSED
node tools/test-ui.js       # full-app UI flow — must print ALL UI FLOW TESTS PASSED
```

The E2E test boots the real game code headless and has a scripted AI pilot taxi,
take off, cruise, shoot the approach, land, taxi to the gate and get paid —
plus five crash-recovery checks.

## Server spec

No backend needed — any static file server works (the game also runs from
`file://`). Multiplayer ships with an offline loopback transport, so the lobby,
ATC roles and chat all work solo with zero setup; networked rooms with real
peers use the optional `RoomServer` WebSocket relay sketched in `js/net.js`
(requires the `ws` npm package on the host — **not** needed to play).

## Versions

- **v1.1.0** — near-plane-clipped renderer (runways never vanish up close),
  richer terrain (forests, lakes, city blocks), airfield detail (TDZ markings,
  both runway numbers, REIL strobes, hangars, fuel farm, floodlights, taxi
  signs, service road), day/night map terminator, radar sweep trail, minimap
  final-course line, working ATC hold orbits, 100% client-side renderer + UI
  regression suites.
- **v1.0.0** — initial release: full career sim, ATC, multiplayer, E2E-tested.

## Build

```bash
python3 tools/bundle.py     # runs tests, copies the game to dist/, zips it
```

Output: `dist/sky-captain/` (playable copy) and `dist/sky-captain.zip`
(drop it on any static host — itch.io, GitHub Pages, Netlify, an S3 bucket…).

## License

Free to play and share. Built with plain HTML/CSS/JS — no engine, no SDKs, no
third-party assets (all art and audio are generated in code), no ads.
