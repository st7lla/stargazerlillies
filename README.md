# bloomframe hand gesture lily

A webcam app that grows and blooms real 3D Stargazer-style lilies using
hand gestures: MediaPipe for hand tracking, Three.js for rendering.

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

## Credits

3D model: **["lily flower"](https://sketchfab.com/3d-models/lily-flower-b58f68ed6cbe4e4d8070185a888a8dc6)**
by [quyrommap](https://sketchfab.com/quyrommap), licensed
[CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/).

## Stack

- MediaPipe Tasks Vision `v0.10.14` — hand landmark detection
- Three.js `0.160.0` + GLTFLoader — 3D rendering
- Vanilla JavaScript (ES modules) — no framework, no build step
