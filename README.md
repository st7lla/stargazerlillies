# Bloomframe — Gesture Lily

A webcam app that grows and blooms real 3D Stargazer-style lilies using
hand gestures — MediaPipe for hand tracking, Three.js for rendering.

## What it does

Three 3D lily plants, planted side by side. Open your **left hand** (thumb
and index spreading apart) to grow their stems, leaves, and buds. Open your
**right hand** to open the petals and light up a soft glow. Hold both hands
in a fist to plant fresh seedlings.

## Requirements

- **Browser:** Chrome or Edge (recommended), Firefox — needs WebGL for the
  3D rendering, which all modern browsers support
- **Hardware:** Webcam
- **Internet:** Needed to load the MediaPipe hand model and the Three.js
  library from CDN (first run only, then cached)
- **Local server:** Required — this can't be opened as a plain file (ES
  modules + camera access need `http://`, not `file://`)

## Setup

1. Unzip / place this folder anywhere.
2. Serve it with any static server, e.g. VS Code's **Live Server**
   extension (open the folder, click **Go Live**), or:
   ```
   npx serve .
   ```
3. Open the printed `http://localhost:...` URL and allow camera access.

## Project structure

```
lily/
├── index.html        # entry point: video, 3D canvas, HUD
├── app.js             # hand tracking + gesture state machine
├── flower-scene.js    # Three.js scene: loads/animates the 3D lily model
├── css/
│   └── styles.css
├── assets/
│   └── lily-flower.glb   # 3D model, CC-BY-4.0 by quyrommap (see Credits)
└── README.md
```

## Gestures

| Gesture                                 | Effect                                |
| ---------------------------------------- | -------------------------------------- |
| Left hand pinch (thumb + index), open   | Grows the stems, leaves, and buds      |
| Right hand pinch (thumb + index), open  | Opens the petals and lights the glow   |
| Both hands closed fist, hold ~1.3s      | Resets to fresh seedlings              |

The HUD at the bottom shows live `Grow` / `Bloom` meters. Opening your hand
tracks the plant upward live; holding it open holds the plant there; closing
your hand eases it back down.

## How it's built

- **MediaPipe Tasks Vision `HandLandmarker`** tracks up to two hands and
  reports 21 landmarks each, plus a Left/Right label.
- **Pinch/openness detection** measures the 3D distance (x, y, *and* z)
  between the thumb tip and index tip, scaled by the hand's own size. Using
  z matters: a hand opening toward the camera moves mostly in depth, which
  a flat x/y distance barely picks up. The reading passes through a
  median-of-3 filter (throws out single-frame tracking glitches entirely)
  plus smoothing, then a two-threshold hysteresis gate decides "open" vs
  "closed" so a steady hand doesn't flicker between states.
- **Fist detection** requires all four fingers curled *and* the thumb
  tucked in — a normal open pinch naturally curls the other three fingers
  on its own, so a looser check used to misread that as a fist and trigger
  false resets.
- **The 3D rendering** (`flower-scene.js`) loads a real GLB model — actual
  geometry and photo-based textures for the petals, stamens, leaves, and
  stem, not procedural shapes. Since the model is a static "already open"
  mesh with no animation rig, growth and bloom are driven by two nested,
  independently-scaled groups per plant:
  - an outer group, normalized to a known height and pinned at the ground,
    scaled by `growth` — this is the plant getting taller/bigger from the
    soil up;
  - an inner group containing just the petal + stamen meshes, re-pivoted
    to their own center (via `Object3D.attach`, which preserves world
    position during the re-parent), scaled between a "closed bud" vector
    and the model's natural full-open (1,1,1) — this is the bloom.
  A small point light lives at each flower head, its intensity tied to
  `bloom` (and pulsing slightly while you're actively opening your right
  hand), for the glow effect.
- **Three.js** and its `GLTFLoader` addon are loaded from CDN via an
  `importmap` in `index.html` — no build step, same as the MediaPipe setup.

## Tuning

Most of what you'd want to adjust lives at the top of the two JS files:

- `app.js` → `CONFIG`: gesture sensitivity (`apertureMin/Max`,
  `openOnRaw/OffRaw`, `responseCurve`), reset hold time.
- `flower-scene.js` → `PLANT_LAYOUT` (position/size of each of the 3
  plants), `CLOSED_SCALE` (how tightly "closed" a bud looks at bloom=0),
  `GROUND_Y` (where the plants are rooted).

## Troubleshooting

**Camera won't turn on** — check that no other app (Zoom, Teams, Discord,
another browser tab) is holding the camera.

**Model/hand-tracking won't load** — this needs `storage.googleapis.com`,
`cdn.jsdelivr.net`, and `unpkg.com` (for Three.js) to be reachable; check
your network/firewall.

**Blank/black screen, or flowers don't appear** — make sure you're running
this from a local server (`http://localhost:...`), not by double-clicking
`index.html`. Also check the browser console (Cmd+Option+I → Console) for
any red errors — if the GLB failed to load or a node name inside it doesn't
match what `flower-scene.js` expects, it'll show up there.

**Flowers look too big/small, too high/low, or oddly spaced** — adjust
`PLANT_LAYOUT` and `GROUND_Y` in `flower-scene.js`. Since this is real 3D,
these are somewhat trial-and-error the first time — nudge one plant's `x`
or `sizeScale` and refresh to see the effect.

**Growth/bloom not responding well** — adjust `openOnRaw`/`openOffRaw`
(how open counts as "open"/"closed") or `apertureMin`/`apertureMax` (the
full range mapped to 0–100%) in `app.js`'s `CONFIG`.

## Credits

3D model: **["lily flower"](https://sketchfab.com/3d-models/lily-flower-b58f68ed6cbe4e4d8070185a888a8dc6)**
by [quyrommap](https://sketchfab.com/quyrommap), licensed
[CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/).

## Stack

- MediaPipe Tasks Vision `v0.10.14` — hand landmark detection
- Three.js `0.160.0` + GLTFLoader — 3D rendering
- Vanilla JavaScript (ES modules) — no framework, no build step

## License

MIT for the code in this project — use, modify, and share freely. The 3D
model is separately licensed CC-BY-4.0 (see Credits above); keep the
attribution if you redistribute it.
