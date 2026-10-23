// Scenery: the sky, the far backdrop scene (rendered first, behind the house) and the near
// surroundings (ground, deck, foliage) that live in the house scene so they take shadows.
// Which backdrop is built comes from layout.environment (a catalog key); never flat beige.

import * as THREE from '../../vendor/three.module.js';
import { Sky } from '../../vendor/three-addons.module.js';
import { catalogMaterial, fitUV, leafMaterial, towerTexture } from './textures.js';

function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// Instanced trees: one trunk mesh + one leaf-card mesh for every tree in the list.
export function buildTrees(trees, { cardsPerTree = 12, castShadow = true } = {}) {
  const group = new THREE.Group();
  if (!trees.length) return group;
  const rand = rng(4242);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.16, 1, 7), new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.95 }), trees.length);
  const cards = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), leafMaterial(), trees.length * cardsPerTree);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const tint = new THREE.Color();
  let k = 0;
  trees.forEach((t, i) => {
    const scale = t.scale || 1;
    const trunkH = 2.2 * scale;
    p.set(t.x, t.y + trunkH / 2, t.z); q.identity(); s.set(scale, trunkH, scale);
    trunk.setMatrixAt(i, m.compose(p, q, s));
    const canopyY = t.y + trunkH + 1.1 * scale, rx = 1.6 * scale, ry = 1.5 * scale;
    for (let c = 0; c < cardsPerTree; c++) {
      const u = rand() * Math.PI * 2, v = Math.acos(2 * rand() - 1), rr = Math.cbrt(rand());
      p.set(t.x + rx * rr * Math.sin(v) * Math.cos(u), canopyY + ry * rr * Math.cos(v), t.z + rx * rr * Math.sin(v) * Math.sin(u));
      e.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
      q.setFromEuler(e);
      const cs = (1.2 + rand() * 1.0) * scale;
      s.set(cs, cs, 1);
      cards.setMatrixAt(k, m.compose(p, q, s));
      cards.setColorAt(k, tint.setHSL(0.26 + rand() * 0.06, 0.45, 0.32 + rand() * 0.2));
      k++;
    }
  });
  trunk.castShadow = castShadow; trunk.receiveShadow = true;
  cards.castShadow = castShadow; cards.receiveShadow = false;
  trunk.instanceMatrix.needsUpdate = true; cards.instanceMatrix.needsUpdate = true;
  if (cards.instanceColor) cards.instanceColor.needsUpdate = true;
  group.add(trunk, cards);
  return group;
}

// Random tree positions in a ring around the footprint, never inside the keep-out box.
function ringTrees(rand, { cx, cz, keep, count, rMin, rMax, y, scaleMin = 0.8, scaleMax = 1.4, avoid = null }) {
  const out = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 40) {
    const a = rand() * Math.PI * 2, r = rMin + rand() * (rMax - rMin);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (x > keep.x0 && x < keep.x1 && z > keep.z0 && z < keep.z1) continue;
    if (avoid && avoid(x, z)) continue;
    out.push({ x, z, y, scale: scaleMin + rand() * (scaleMax - scaleMin) });
  }
  return out;
}

export function sunDirection(azimuthDeg, elevationDeg) {
  const a = THREE.MathUtils.degToRad(azimuthDeg), e = THREE.MathUtils.degToRad(elevationDeg);
  // azimuth 0 = north (-z), 90 = east (+x)
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

// Sky dome + uniforms per mode. Returns the Sky object and a setter.
export function makeSky() {
  const sky = new Sky();
  sky.scale.setScalar(30000);
  // the stock Sky shader is HDR-bright near a low sun; a scale keeps windows from blowing out
  sky.material.uniforms.skyScale = { value: 0.5 };
  sky.material.fragmentShader = sky.material.fragmentShader
    .replace('uniform vec3 up;', 'uniform vec3 up;\nuniform float skyScale;')
    .replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( retColor * skyScale, 1.0 );');
  const u = sky.material.uniforms;
  function set(dir, golden) {
    u.sunPosition.value.copy(dir);
    u.turbidity.value = golden ? 5.5 : 3;
    u.rayleigh.value = golden ? 2.2 : 1.0;
    u.mieCoefficient.value = golden ? 0.009 : 0.004;
    u.mieDirectionalG.value = golden ? 0.85 : 0.8;
    u.skyScale.value = golden ? 0.28 : 0.42;
  }
  return { sky, set };
}

// The far world. Lives in its own scene with its own (shadowless) lights.
export function buildBackdrop(environment, { footprint, groundY, sunDir }) {
  const scene = new THREE.Scene();
  const rand = rng(77);
  const cx = footprint.x + footprint.w / 2, cz = footprint.z + footprint.d / 2;
  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x8a8a6a, 0.8);
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.copy(sunDir).multiplyScalar(1000);
  scene.add(hemi, sun);

  const far = new THREE.Group();
  scene.add(far);
  const groundColour = { bay_view: 0x6f8a56, city_view: 0x8f8d88, garden: 0x6b8d4e, forest: 0x4f6d3c, neutral_sky: 0x8b946e }[environment] || 0x8b946e;
  if (environment === 'bay_view') {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshStandardMaterial({ color: 0x2b5a78, roughness: 0.08, metalness: 0.05, envMapIntensity: 1.2 }));
    water.rotation.x = -Math.PI / 2; water.position.set(cx, groundY - 0.45, cz);
    far.add(water);
    // low hills across the water
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x506b66, roughness: 1 });
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2, r = 1800 + rand() * 1800;
      const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), hillMat);
      hill.scale.set(600 + rand() * 900, 90 + rand() * 160, 400 + rand() * 500);
      hill.position.set(cx + Math.cos(a) * r, groundY - 20, cz + Math.sin(a) * r);
      far.add(hill);
    }
  } else {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshStandardMaterial({ color: groundColour, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(cx, groundY - 0.4, cz);
    far.add(ground);
  }
  if (environment === 'city_view') {
    const tex = towerTexture();
    const count = 140;
    const towers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.2 }), count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2, r = 140 + rand() * 700;
      const w = 14 + rand() * 26, h = 25 + rand() * rand() * 160;
      p.set(cx + Math.cos(a) * r, groundY + h / 2, cz + Math.sin(a) * r);
      s.set(w, h, 12 + rand() * 26);
      towers.setMatrixAt(i, m.compose(p, q, s));
    }
    towers.instanceMatrix.needsUpdate = true;
    far.add(towers);
    // repeat the window grid per storey
    tex.repeat.set(1, 1);
  }
  if (environment === 'forest' || environment === 'garden' || environment === 'bay_view') {
    const keep = { x0: footprint.x - 40, x1: footprint.x + footprint.w + 40, z0: footprint.z - 40, z1: footprint.z + footprint.d + 40 };
    const n = environment === 'forest' ? 260 : environment === 'garden' ? 90 : 30;
    const avoid = environment === 'bay_view' ? (x) => x < footprint.x - 8 : null; // keep the west view over the water open
    far.add(buildTrees(ringTrees(rand, { cx, cz, keep, count: n, rMin: 45, rMax: environment === 'forest' ? 160 : 120, y: groundY - 0.3, scaleMin: 1.0, scaleMax: 1.9, avoid }), { cardsPerTree: 7, castShadow: false }));
  }
  const { sky, set: setSky } = makeSky();
  scene.add(sky);
  return { scene, sky, setSky, sun, hemi };
}

// Near surroundings, added to the house scene (they receive the sun's shadows and the AO).
export function buildNearGround(environment, { footprint, groundY }) {
  const group = new THREE.Group();
  const rand = rng(31);
  const cx = footprint.x + footprint.w / 2, cz = footprint.z + footprint.d / 2;
  const colours = { bay_view: 0x6f8a56, city_view: 0x8f8d88, garden: 0x6b8d4e, forest: 0x4f6d3c, neutral_sky: 0x8b946e };
  const size = environment === 'bay_view' ? 44 : 90;
  let groundMat;
  if (environment === 'city_view') groundMat = catalogMaterial('limestone');
  else groundMat = new THREE.MeshStandardMaterial({ color: colours[environment] || colours.neutral_sky, roughness: 1 });
  const groundGeo = new THREE.PlaneGeometry(size, size);
  groundGeo.rotateX(-Math.PI / 2);
  if (environment === 'city_view') fitUV(groundGeo, groundMat.userData.tile * 3, { x: cx, y: 0, z: cz }); // 3.6 m paving slabs
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.set(cx, groundY - 0.002, cz);
  ground.receiveShadow = true;
  group.add(ground);

  // a deck along the west side (where the sample's glass wall is) for the softer settings
  if (environment === 'bay_view' || environment === 'garden') {
    const deckMat = catalogMaterial('redwood_deck');
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, footprint.d + 2), deckMat);
    fitUV(deck.geometry, deckMat.userData.tile, { x: footprint.x - 1.6, y: 0, z: cz });
    deck.position.set(footprint.x - 1.6, groundY + 0.06 - 0.06, cz);
    deck.receiveShadow = true; deck.castShadow = true;
    group.add(deck);
  }
  const keep = { x0: footprint.x - 3, x1: footprint.x + footprint.w + 3, z0: footprint.z - 3, z1: footprint.z + footprint.d + 3 };
  let trees = [];
  if (environment === 'garden') trees = ringTrees(rand, { cx, cz, keep, count: 16, rMin: 7, rMax: 34, y: groundY });
  if (environment === 'forest') trees = ringTrees(rand, { cx, cz, keep, count: 70, rMin: 6, rMax: 44, y: groundY, scaleMin: 0.9, scaleMax: 1.8 });
  if (environment === 'bay_view') trees = ringTrees(rand, { cx, cz, keep, count: 7, rMin: 8, rMax: 20, y: groundY, avoid: (x) => x < footprint.x - 4 });
  if (environment === 'neutral_sky') trees = ringTrees(rand, { cx, cz, keep, count: 3, rMin: 14, rMax: 30, y: groundY });
  if (trees.length) group.add(buildTrees(trees));
  if (environment === 'garden') {
    const hedgeMat = new THREE.MeshStandardMaterial({ color: 0x3f6b35, roughness: 1, map: leafMaterial().map });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + rand() * 0.3, r = 9 + rand() * 4;
      const hedge = new THREE.Mesh(new THREE.BoxGeometry(2.5 + rand() * 3, 0.9 + rand() * 0.5, 0.9), hedgeMat);
      hedge.position.set(cx + Math.cos(a) * r, groundY + 0.6, cz + Math.sin(a) * r);
      hedge.rotation.y = -a;
      hedge.castShadow = hedge.receiveShadow = true;
      group.add(hedge);
    }
  }
  return group;
}
