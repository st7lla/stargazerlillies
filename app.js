/* =========================================================================
   Bloomframe — Gesture Lily
   Hand tracking via MediaPipe Tasks Vision (HandLandmarker), rendering via
   a real 3D model (Three.js + GLTFLoader) — see flower-scene.js.

   Gesture map:
     LEFT hand  — open your pinch (thumb+index apart) to GROW the plant.
                  Close it back down and it settles back toward a seedling.
     RIGHT hand — open your pinch to BLOOM the flowers open + glow.
                  Close it and they ease back toward closed buds.
     Both hands closed fist, held  -> hard RESET to a fresh seedling

   Grow/Bloom are a live, continuous read of how open your hand is, gated
   by hysteresis so a steady hand position doesn't flicker between states.
   ========================================================================= */

import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
import { init as initFlowerScene } from "./flower-scene.js";

/* ---------------------------------------------------------------------
   1. DOM references
   --------------------------------------------------------------------- */

const video = document.getElementById("webcam");
const threeCanvas = document.getElementById("three-canvas");
const loader = document.getElementById("loader");
const loaderText = document.getElementById("loader-text");
const toastEl = document.getElementById("toast");
const pinchLeftEl = document.getElementById("pinch-left");
const pinchRightEl = document.getElementById("pinch-right");

const fillGrow = document.getElementById("fill-grow");
const fillBloom = document.getElementById("fill-bloom");
const valueGrow = document.getElementById("value-grow");
const valueBloom = document.getElementById("value-bloom");

/* ---------------------------------------------------------------------
   2. Tunables
   --------------------------------------------------------------------- */

const CONFIG = {
  // normalized thumb-index distance (scaled by hand size). Fixed, not
  // adaptive — an earlier version auto-calibrated these per-hand live, but
  // that let a single noisy tracking frame get misread as a new "extreme,"
  // which could momentarily register as a false close and reset the plant.
  apertureMin: 0.32,
  apertureMax: 1.0,
  responseCurve: 0.75, // <1 makes small/medium openness register sooner
  rawSmoothing: 0.55,  // 0..1, higher = steadier reading but more lag
  // hysteresis band for the open/closed gate: your hand must exceed
  // openOnRaw to register as "open" (growing), and drop below openOffRaw to
  // register as "closed" (shrinking). The gap between them is what stops
  // a hand held near the boundary from flickering back and forth.
  openOnRaw: 0.6,
  openOffRaw: 0.42,
  resetHoldMs: 1300,       // both-fists hold time to trigger a hard reset
  mirrorHandedness: false, // flip if your camera reports hands backwards
};

/* ---------------------------------------------------------------------
   3. Gesture state
   --------------------------------------------------------------------- */

const state = {
  growth: 0.08,   // 0..1  (left hand openness)
  bloom: 0.0,     // 0..1  (right hand openness)
  right: { present: false, x: 0.5, y: 0.5, openAmt: 0, stable: 1, h1: 1, h2: 1, openGate: false },
  left: { present: false, x: 0.5, y: 0.5, openAmt: 0, stable: 1, h1: 1, h2: 1, openGate: false },
  fistHoldStart: null,
  lastTime: performance.now(),
};

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.remove("show"), 1600);
}

/* ---------------------------------------------------------------------
   4. Camera + HandLandmarker + 3D scene bootstrap
   --------------------------------------------------------------------- */

let handLandmarker = null;
let flowerScene = null;

async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await new Promise((resolve) => (video.onloadedmetadata = resolve));
  video.play();

  // some cameras (a lot of MacBooks included) expose a real "zoom" control
  // through getUserMedia — pull it to its minimum if it's there, which
  // actually widens the field of view (unlike any CSS trick)
  try {
    const [track] = stream.getVideoTracks();
    const caps = track.getCapabilities?.();
    if (caps && caps.zoom) {
      await track.applyConstraints({ advanced: [{ zoom: caps.zoom.min }] });
    }
  } catch (e) {
    // no zoom control on this camera/browser — nothing to do
  }
}

async function setupHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

async function boot() {
  try {
    loaderText.textContent = "Asking for camera access…";
    await setupCamera();
    loaderText.textContent = "Loading hand model…";
    await setupHandLandmarker();
    loaderText.textContent = "Loading 3D lily model…";
    flowerScene = await initFlowerScene(threeCanvas);
    loader.classList.add("hidden");
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    loaderText.textContent =
      "Couldn't start the camera, hand model, or 3D scene. Check permissions/connection, then reload.";
  }
}
boot();

/* ---------------------------------------------------------------------
   5. Landmark helpers
   --------------------------------------------------------------------- */

const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
const PIP = { index: 6, middle: 10, ring: 14, pinky: 18 };

// 3D distance (uses MediaPipe's relative z too). This matters a lot here:
// pinching/spreading with fingers pointed toward the camera moves mostly in
// depth, which a flat x/y distance barely picks up.
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
}

// normalized thumb-index distance, scaled by hand size so it works at any
// distance from the camera
function pinchAmount(landmarks) {
  const scale = dist(landmarks[0], landmarks[9]) || 0.0001;
  return dist(landmarks[TIP.thumb], landmarks[TIP.index]) / scale;
}

// true if the hand is a genuine fist: ALL four fingers curled AND the
// thumb tucked in — a natural open pinch (thumb+index touching) often
// leaves the other three fingers curled on their own, which used to
// satisfy a looser "3 curled" check and get misread as a fist
function isFist(landmarks) {
  const wrist = landmarks[0];
  const scale = dist(wrist, landmarks[9]) || 0.0001;
  let curled = 0;
  for (const f of ["index", "middle", "ring", "pinky"]) {
    const tipD = dist(landmarks[TIP[f]], wrist) / scale;
    const pipD = dist(landmarks[PIP[f]], wrist) / scale;
    if (tipD < pipD * 0.92) curled++;
  }
  if (curled < 4) return false;
  const thumbD = dist(landmarks[TIP.thumb], wrist) / scale;
  return thumbD < 0.85;
}

function apertureToOpenAmt(amt) {
  const linear = clamp((amt - CONFIG.apertureMin) / (CONFIG.apertureMax - CONFIG.apertureMin), 0, 1);
  return Math.pow(linear, CONFIG.responseCurve);
}

// rejects single-frame outliers far better than exponential smoothing alone
function median3(a, b, c) {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

/* ---------------------------------------------------------------------
   6. Main loop
   --------------------------------------------------------------------- */

function loop(now) {
  requestAnimationFrame(loop);
  if (!handLandmarker || !flowerScene || video.readyState < 2) return;

  const dt = Math.min((now - state.lastTime) / 1000, 0.1);
  state.lastTime = now;

  const result = handLandmarker.detectForVideo(video, now);
  updateGestureState(result, dt);
  render(now);
}

function updateGestureState(result, dt) {
  state.right.present = false;
  state.left.present = false;

  const hands = result.landmarks || [];
  const handedness = result.handednesses || [];

  for (let i = 0; i < hands.length; i++) {
    const landmarks = hands[i];
    let label = handedness[i]?.[0]?.categoryName || "Right";
    if (CONFIG.mirrorHandedness) label = label === "Left" ? "Right" : "Left";

    const bucket = label === "Left" ? state.left : state.right;
    const amt = pinchAmount(landmarks);

    // median-of-3 first: a single glitchy frame gets thrown out entirely
    // instead of dragging the signal around, THEN light exponential
    // smoothing on top of that for a steady final reading
    const med = median3(bucket.h2, bucket.h1, amt);
    bucket.h2 = bucket.h1;
    bucket.h1 = amt;
    bucket.stable = lerp(med, bucket.stable, CONFIG.rawSmoothing);

    // explicit open/closed gate with hysteresis
    if (bucket.openGate) {
      if (bucket.stable < CONFIG.openOffRaw) bucket.openGate = false;
    } else {
      if (bucket.stable > CONFIG.openOnRaw) bucket.openGate = true;
    }

    bucket.openAmt = apertureToOpenAmt(bucket.stable);
    bucket.present = true;
    bucket.x = 1 - landmarks[8].x; // mirrored for display
    bucket.y = landmarks[8].y;
    bucket.fist = isFist(landmarks);
  }

  // grow (left hand) / bloom (right hand): while the hand reads as "open"
  // it tracks upward toward its live openness; while "closed" it eases
  // back down toward 0. If a hand isn't visible, hold the last value.
  const followSpeed = 6;
  const followT = 1 - Math.exp(-followSpeed * dt);

  if (state.left.present) {
    const target = state.left.openGate ? state.left.openAmt : 0;
    state.growth = lerp(state.growth, target, followT);
  }
  if (state.right.present) {
    const target = state.right.openGate ? state.right.openAmt : 0;
    state.bloom = lerp(state.bloom, target, followT);
  }

  // both-fists hard reset
  const bothFists =
    state.right.present && state.right.fist && state.left.present && state.left.fist;

  if (bothFists) {
    if (state.fistHoldStart === null) state.fistHoldStart = performance.now();
    else if (performance.now() - state.fistHoldStart > CONFIG.resetHoldMs) {
      state.growth = 0.08;
      state.bloom = 0;
      state.fistHoldStart = null;
      showToast("🌱 new lilies planted");
    }
  } else {
    state.fistHoldStart = null;
  }

  fillGrow.style.width = `${state.growth * 100}%`;
  fillBloom.style.width = `${state.bloom * 100}%`;
  valueGrow.textContent = state.growth.toFixed(2);
  valueBloom.textContent = state.bloom.toFixed(2);
}

/* ---------------------------------------------------------------------
   7. Render: drive the 3D scene + the little HTML pinch-dot markers
   --------------------------------------------------------------------- */

function render(now) {
  const t = now / 1000;
  const pinchPulse = state.right.present ? 0.5 + 0.5 * Math.sin(t * 8) : 0;
  flowerScene.update(state.growth, state.bloom, pinchPulse, t);

  updatePinchDot(pinchLeftEl, state.left);
  updatePinchDot(pinchRightEl, state.right);
}

function updatePinchDot(el, hand) {
  if (!hand.present) {
    el.style.opacity = "0";
    return;
  }
  el.style.left = `${hand.x * 100}%`;
  el.style.top = `${hand.y * 100}%`;
  const openness = hand.openGate ? 1 : 0.3;
  el.style.opacity = String(0.3 + openness * 0.6);
  el.style.transform = `translate(-50%, -50%) scale(${0.6 + openness * 0.5})`;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
