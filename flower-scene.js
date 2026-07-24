/* =========================================================================
   flower-scene.js — real 3D Stargazer-style lilies, via Three.js

   Uses the "lily flower" GLB model by quyrommap (CC-BY-4.0):
   https://sketchfab.com/3d-models/lily-flower-b58f68ed6cbe4e4d8070185a888a8dc6
   Only the model's petal + stamen meshes are used, as reusable "flower head"
   instances. The stem, branches, and leaves are our own procedural geometry,
   built as ONE connected plant (single trunk splitting into three branches)
   instead of three separate plants — this is what lets grow/bloom animate
   live without needing a custom rig on the source model.

   Exposes: init(canvas) -> Promise<{ update, resize }>
   ========================================================================= */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const MODEL_URL = "assets/lily-flower.glb";

const GROUND_Y = -2.6;
const MAIN_STEM_LEN = 2.0;     // world units, main trunk at full growth
const STEM_RADIUS = 0.045;
const BRANCH_RADIUS = 0.026;

// where each of the 3 flowers sits relative to the branch node, at full
// growth — (x, y) offset in world units. Center one is tallest/frontmost.
const BRANCHES = [
  { dx: -1.05, dy: 0.85, sizeScale: 0.86, swayPhase: 0 },
  { dx: 0.08, dy: 1.25, sizeScale: 1.05, swayPhase: 1.7 },
  { dx: 1.05, dy: 0.8, sizeScale: 0.9, swayPhase: 3.3 },
];

// how big the OPEN flower head is relative to the model's native size —
// the source model's flower is small relative to its stem, so this scales
// it up to look proportionate to a real Stargazer bloom
const OPEN_SCALE = 3.4;
const CLOSED_SCALE = 0.55; // bud size relative to OPEN_SCALE

export async function init(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, 0.3, 6);
  camera.lookAt(0, 0.3, 0);

  scene.add(new THREE.AmbientLight(0xfff2e6, 0.7));
  const key = new THREE.DirectionalLight(0xfff0dd, 1.2);
  key.position.set(2, 3, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfe0ff, 0.45);
  rim.position.set(-3, 1, -2);
  scene.add(rim);

  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(MODEL_URL);

  const glowTexture = makeGlowTexture();
  const leafGeo = makeLeafGeometry();
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f7a45, roughness: 0.6, side: THREE.DoubleSide });

  // shared tube materials (stem/branches) — one instance is fine, geometry
  // is what changes per frame, not the material
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x3a6e3f, roughness: 0.55 });

  const mainTube = { mesh: null };
  const branches = BRANCHES.map((cfg) => ({
    cfg,
    tube: { mesh: null },
    flower: buildFlowerHead(gltf.scene, glowTexture),
    leaves: [makeLeafInstance(leafGeo, leafMat), makeLeafInstance(leafGeo, leafMat)],
  }));

  scene.add(...branches.map((b) => b.flower.group));
  scene.add(...branches.flatMap((b) => b.leaves.map((l) => l.mesh)));

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    const aspect = w / h;
    const halfH = 2.35; // smaller = more zoomed in / bigger-looking plants
    const halfW = halfH * aspect;
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH * 1.5 - 1.1;
    camera.bottom = -halfH * 0.5 - 1.1;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  function update(growth, bloom, pinchPulse, t) {
    const growEased = easeOutCubic(growth);
    const bloomEased = easeOutCubic(bloom);

    const mainSway = Math.sin(t * 0.5) * 0.12 * growEased;
    const nodeX = mainSway;
    const nodeY = GROUND_Y + MAIN_STEM_LEN * growEased;

    mainTube.mesh = rebuildTube(
      scene, mainTube.mesh, stemMat,
      new THREE.Vector3(0, GROUND_Y, 0),
      new THREE.Vector3(mainSway * 0.5, GROUND_Y + MAIN_STEM_LEN * growEased * 0.55, 0.05),
      new THREE.Vector3(nodeX, nodeY, 0),
      STEM_RADIUS
    );

    for (const b of branches) {
      const reach = growEased;
      const sway = Math.sin(t * 0.5 + b.cfg.swayPhase) * 0.08 * growEased;
      const tipX = nodeX + b.cfg.dx * reach + sway;
      const tipY = nodeY + b.cfg.dy * reach;
      const tip = new THREE.Vector3(tipX, tipY, 0.03 * Math.sign(b.cfg.dx || 1));
      const node = new THREE.Vector3(nodeX, nodeY, 0);
      const mid = node.clone().lerp(tip, 0.55);
      mid.y += 0.06 * reach;

      if (reach > 0.02) {
        b.tube.mesh = rebuildTube(scene, b.tube.mesh, stemMat, node, mid, tip, BRANCH_RADIUS);
        if (b.tube.mesh) b.tube.mesh.visible = true;
      } else if (b.tube.mesh) {
        b.tube.mesh.visible = false;
      }

      // leaves ride along the branch at fixed fractions, fading in with growth
      b.leaves.forEach((leaf, i) => {
        const f = 0.35 + i * 0.35;
        const p = node.clone().lerp(tip, f);
        const reveal = clamp((reach - f + 0.15) / 0.15, 0, 1);
        leaf.mesh.visible = reveal > 0.02;
        leaf.mesh.position.copy(p);
        leaf.mesh.scale.setScalar(0.55 * reveal * b.cfg.sizeScale);
        leaf.mesh.rotation.z = (i === 0 ? 1 : -1) * (0.7 + Math.sin(t * 0.4 + b.cfg.swayPhase) * 0.1);
        leaf.mesh.rotation.y = t * 0.15 + i;
      });

      // flower head: pinned exactly to the current branch tip every frame —
      // no nested-scale drift, it's just placed there directly
      b.flower.group.visible = reach > 0.06;
      b.flower.group.position.copy(tip);
      b.flower.group.rotation.z = sway * 0.6;
      b.flower.update(bloomEased, pinchPulse, b.cfg.sizeScale, t + b.cfg.swayPhase);
    }

    renderer.render(scene, camera);
  }

  return { update, resize };
}

/* ---------------------------------------------------------------------
   Flower head: just the model's petal + stamen meshes, recentered around
   their own combined center so it opens/closes in place, plus a simple
   procedural bud for the closed state and a soft glow sprite + point light.
   --------------------------------------------------------------------- */

function buildFlowerHead(sourceRoot, glowTexture) {
  const clone = sourceRoot.clone(true);
  clone.updateMatrixWorld(true);

  const petals = clone.getObjectByName("Object_3");
  const stamens = clone.getObjectByName("Object_2");

  const group = new THREE.Group();

  if (petals && stamens && petals.parent) {
    const parent = petals.parent;
    parent.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(petals).union(new THREE.Box3().setFromObject(stamens));
    const center = box.getCenter(new THREE.Vector3());

    const pivot = new THREE.Group();
    parent.add(pivot);
    pivot.position.copy(parent.worldToLocal(center.clone()));
    pivot.updateMatrixWorld(true);
    pivot.attach(petals);
    pivot.attach(stamens);

    // give each flower head its own material instances so fading one
    // doesn't fade the others (clone(true) shares materials by default)
    for (const mesh of [petals, stamens]) {
      mesh.material = mesh.material.clone();
      mesh.material.transparent = true;
      mesh.material.opacity = 1;
    }

    // move them into `group` at (0,0,0) — their local offsets (relative to
    // the pivot, which sat at their collective center) carry straight over,
    // so `group`'s own origin is now the flower's true visual center
    while (pivot.children.length) group.add(pivot.children[0]);
  }

  const bloomInner = new THREE.Group();
  while (group.children.length) bloomInner.add(group.children[0]);
  group.add(bloomInner);

  // simple closed-bud placeholder, visible only at low bloom
  const bud = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xdf7fa8, roughness: 0.5, transparent: true })
  );
  bud.scale.set(0.8, 1.6, 0.8);
  group.add(bud);

  const glowLight = new THREE.PointLight(0xff8fc0, 0, 2.6, 2);
  group.add(glowLight);

  const glowSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture, color: 0xffb3d9, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  glowSprite.scale.setScalar(0.01);
  group.add(glowSprite);

  function update(bloomEased, pinchPulse, sizeScale, tLocal) {
    const openT = clamp((bloomEased - 0.28) / 0.72, 0, 1);
    const closedT = 1 - clamp(bloomEased / 0.4, 0, 1);

    bud.visible = closedT > 0.02;
    bud.material.opacity = closedT;
    bud.scale.set(0.75, 1.55, 0.75).multiplyScalar((0.85 + 0.15 * Math.sin(tLocal * 1.3)) * sizeScale);

    const s = (CLOSED_SCALE + (OPEN_SCALE - CLOSED_SCALE) * openT) * sizeScale;
    bloomInner.scale.setScalar(Math.max(0.001, s));
    const op = clamp((bloomEased - 0.15) / 0.4, 0, 1);
    bloomInner.visible = op > 0.01;
    bloomInner.traverse((o) => {
      if (o.isMesh) o.material.opacity = op;
    });
    bloomInner.rotation.y = tLocal * 0.25;

    const glow = bloomEased * (0.6 + 0.4 * pinchPulse);
    glowLight.intensity = lerp(glowLight.intensity, glow * 2.6, 0.15);
    glowSprite.material.opacity = lerp(glowSprite.material.opacity, glow * 0.8, 0.15);
    glowSprite.scale.setScalar(0.55 + glow * 1.1);
  }

  return { group, update };
}

/* ---------------------------------------------------------------------
   Procedural stem/branch tubes — rebuilt each frame from live control
   points, so the whole plant grows as one connected piece
   --------------------------------------------------------------------- */

function rebuildTube(scene, existingMesh, material, p0, p1, p2, radius) {
  const curve = new THREE.QuadraticBezierCurve3(p0, p1, p2);
  const geo = new THREE.TubeGeometry(curve, 12, radius, 6, false);
  if (existingMesh) {
    existingMesh.geometry.dispose();
    existingMesh.geometry = geo;
    return existingMesh;
  }
  const mesh = new THREE.Mesh(geo, material);
  scene.add(mesh);
  return mesh;
}

function makeLeafGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(0.16, 0.18, 0.05, 0.5);
  shape.quadraticCurveTo(-0.05, 0.2, 0, 0);
  const geo = new THREE.ShapeGeometry(shape);
  geo.computeVertexNormals();
  return geo;
}

function makeLeafInstance(geo, mat) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  return { mesh };
}

function makeGlowTexture() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.5)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function easeOutCubic(x) {
  return 1 - Math.pow(1 - x, 3);
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
