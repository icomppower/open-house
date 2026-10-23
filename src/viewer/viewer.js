// open-house viewer: a three.js tour built from layout.json.
// Clean architectural geometry (walls, floor slabs at their levels, openings, glass with black
// steel mullions), catalog materials (procedural PBR), catalog furniture, a two-scene render
// (near house + far backdrop so windows show sky and the chosen environment), Sky + PMREM
// environment, PCF soft shadows, RectAreaLight bounce at glass walls, GTAO, bloom, FXAA and a
// warm grade with vignette and grain. The camera glides from stop to stop (one stop per photo,
// using the layout cameras); drag to look. "Photoreal" crossfades to that stop's enhanced photo.
// captureStops() renders a PNG per stop. "How it was made" shows trace-derived numbers.
// ?q=low (or options.quality = 'low') drops GTAO and shadow resolution for phones.

import * as THREE from '../../vendor/three.module.js';
import { EffectComposer, RenderPass, ShaderPass, GTAOPass, UnrealBloomPass, OutputPass, FXAAShader, RectAreaLightUniformsLib } from '../../vendor/three-addons.module.js';
import { materials as MATERIALS, environments as ENVIRONMENTS } from './catalog.js';
import { catalogMaterial, fitUV } from './textures.js';
import { buildFurniture } from './furniture.js';
import { buildBackdrop, buildNearGround, sunDirection } from './scenery.js';

const WALL_T = 0.12;
const SLAB_T = 0.2;
const MULLION = 0.05;

const CSS = `
.oh-viewer{position:relative;width:100%;background:#1a1816;color:#f4efe6;font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;border-radius:12px;overflow:hidden;user-select:none;-webkit-user-select:none}
.oh-stage{position:relative;width:100%;aspect-ratio:4/3;max-height:78vh;background:#0f0e0d}
.oh-stage canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab}
.oh-stage canvas:active{cursor:grabbing}
.oh-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .5s ease;pointer-events:none}
.oh-caption{position:absolute;left:0;right:0;bottom:0;padding:10px 14px;background:linear-gradient(transparent,rgba(0,0,0,.65));font-size:14px;text-shadow:0 1px 2px rgba(0,0,0,.6);pointer-events:none}
.oh-caption b{display:block;font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.8;margin-bottom:2px}
.oh-bar{display:flex;flex-wrap:wrap;gap:8px;padding:10px;align-items:center;background:#1a1816}
.oh-bar button{flex:1 1 auto;min-width:44px;min-height:44px;padding:0 12px;border:1px solid #4a443d;border-radius:10px;background:#2a2622;color:#f4efe6;font:inherit;font-weight:600;cursor:pointer}
.oh-bar button[aria-pressed="true"]{background:#e3a35d;color:#1a1816;border-color:#e3a35d}
.oh-bar button:disabled{opacity:.4;cursor:default}
.oh-bar .oh-idx{flex:0 0 auto;min-width:3.5em;text-align:center;opacity:.8;font-variant-numeric:tabular-nums}
.oh-made{position:absolute;inset:10px;overflow:auto;background:rgba(20,18,16,.92);backdrop-filter:blur(6px);border:1px solid #4a443d;border-radius:10px;padding:12px 14px;font-size:13px;display:none}
.oh-made.open{display:block}
.oh-made h3{margin:0 0 6px;font-size:14px}
.oh-made p{margin:4px 0;opacity:.85}
.oh-made table{border-collapse:collapse;width:100%;margin:6px 0 10px;font-variant-numeric:tabular-nums}
.oh-made th,.oh-made td{text-align:left;padding:3px 6px;border-bottom:1px solid #35302a;font-weight:400}
.oh-made th{opacity:.7;font-size:11px;letter-spacing:.06em;text-transform:uppercase}
.oh-made .oh-close{position:absolute;top:8px;right:8px;min-width:36px;min-height:36px;border:1px solid #4a443d;border-radius:8px;background:#2a2622;color:#f4efe6;cursor:pointer}
.oh-made small{opacity:.6}
`;

let cssInjected = false;
function injectCss() {
  if (cssInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  cssInjected = true;
}

// ------------------------------------------------------------- geometry helpers

function wallSeg(rect, wall) {
  switch (wall) {
    case 'n': return { axis: 'x', fixed: rect.z, from: rect.x, to: rect.x + rect.w, inward: +1 };
    case 's': return { axis: 'x', fixed: rect.z + rect.d, from: rect.x, to: rect.x + rect.w, inward: -1 };
    case 'w': return { axis: 'z', fixed: rect.x, from: rect.z, to: rect.z + rect.d, inward: +1 };
    case 'e': return { axis: 'z', fixed: rect.x + rect.w, from: rect.z, to: rect.z + rect.d, inward: -1 };
    default: return null;
  }
}
const OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' };

// Openings expressed for each side of a shared wall, with offsets converted to that room's wall.
function openingsFor(layout, roomsById, levelsById) {
  const map = {}; // roomId -> wall -> [opening]
  const add = (roomId, wall, o) => (((map[roomId] ||= {})[wall] ||= []).push(o));
  for (const o of layout.openings) {
    if (o.type === 'stair') continue;
    const a = roomsById[o.between[0]];
    if (!a) continue;
    add(a.id, o.wall, { ...o, room: a.id });
    const b = roomsById[o.between[1]];
    if (b) {
      const sa = wallSeg(a.rect, o.wall), sb = wallSeg(b.rect, OPPOSITE[o.wall]);
      const abs = sa.from + o.offset;
      const dElev = levelsById[a.level].elevation - levelsById[b.level].elevation;
      add(b.id, OPPOSITE[o.wall], { ...o, room: b.id, offset: abs - sb.from, sill: o.sill + dElev, mirrored: true });
    }
  }
  return map;
}

function detectQuality(options) {
  let q = options.quality || null;
  try {
    const param = new URLSearchParams(location.search).get('q');
    if (param === 'low' || param === 'high') q = param;
  } catch { /* no location (tests) */ }
  if (q === 'low' || q === 'high') return q;
  try {
    const coarse = matchMedia && matchMedia('(pointer: coarse)').matches;
    if (coarse && Math.min(innerWidth, innerHeight) < 700) return 'low';
  } catch { /* ignore */ }
  return 'high';
}

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, warmth: { value: 0.6 }, vignette: { value: 0.55 }, grain: { value: 0.028 }, time: { value: 0 }, resolution: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float warmth; uniform float vignette; uniform float grain; uniform float time; uniform vec2 resolution;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 warm = col * vec3(1.0 + 0.09 * warmth, 1.0 + 0.025 * warmth, 1.0 - 0.07 * warmth);
      vec3 cool = col * vec3(1.0 - 0.012 * warmth, 1.0, 1.0 + 0.02 * warmth);
      col = mix(cool, warm, smoothstep(0.12, 0.85, l));
      vec2 p = vUv - 0.5;
      col *= 1.0 - vignette * smoothstep(0.3, 1.0, length(p) * 1.45);
      float n = fract(sin(dot(vUv * resolution + vec2(time, time * 0.7), vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * grain;
      gl_FragColor = vec4(col, c.a);
    }`,
};

// ------------------------------------------------------------- viewer

export function createViewer({ container, layout, spec = null, narration = null, images = {}, order = null, report = null, options = {} } = {}) {
  if (!container) throw new Error('createViewer needs a container element');
  if (!layout) throw new Error('createViewer needs layout.json');
  injectCss();

  const opts = { sun: 'golden', autoplayMs: 4200, glideMs: 1600, showControls: true, quality: null, environment: null, ...options };
  const quality = detectQuality(opts);
  const environment = ENVIRONMENTS[opts.environment] ? opts.environment : ENVIRONMENTS[layout.environment] ? layout.environment : 'neutral_sky';
  const roomsById = Object.fromEntries(layout.rooms.map((r) => [r.id, r]));
  const levelsById = Object.fromEntries(layout.levels.map((l) => [l.id, l]));
  const roomHeight = (r) => r.ceilingHeight || levelsById[r.level].height;
  const narrationByRoom = Object.fromEntries(((narration && narration.lines) || []).map((l) => [l.room, l.text]));
  const matKey = (k, fallback) => (MATERIALS[k] ? k : fallback);

  // DOM
  const root = document.createElement('div');
  root.className = 'oh-viewer';
  const stage = document.createElement('div');
  stage.className = 'oh-stage';
  root.appendChild(stage);
  const photoA = document.createElement('img'); photoA.className = 'oh-photo'; photoA.alt = '';
  const photoB = document.createElement('img'); photoB.className = 'oh-photo'; photoB.alt = '';
  const caption = document.createElement('div'); caption.className = 'oh-caption';
  const made = document.createElement('div'); made.className = 'oh-made'; made.setAttribute('aria-label', 'How it was made');
  const bar = document.createElement('div'); bar.className = 'oh-bar';
  container.appendChild(root);

  // Renderer (FXAA handles the edges; MSAA is off so the composer stays simple)
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 1.5);
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.appendChild(renderer.domElement);
  stage.appendChild(photoA);
  stage.appendChild(photoB);
  stage.appendChild(caption);
  stage.appendChild(made);
  if (opts.showControls) root.appendChild(bar);
  RectAreaLightUniformsLib.init();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 4 / 3, 0.05, 120);
  const backCamera = new THREE.PerspectiveCamera(70, 4 / 3, 2, 60000);

  const fp = layout.footprint;
  const cx = fp.x + fp.w / 2, cz = fp.z + fp.d / 2;
  const lowest = Math.min(...layout.levels.map((l) => l.elevation));
  const groundY = lowest - SLAB_T;

  // ---- sky + backdrop (far scene) and environment map
  const sunAz = (layout.sun && layout.sun.azimuth) ?? 250;
  const sunElGolden = (layout.sun && layout.sun.elevation) ?? 10;
  const backdrop = buildBackdrop(environment, { footprint: fp, groundY, sunDir: sunDirection(sunAz, sunElGolden) });
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  let envRT = null;
  function refreshEnvironment() {
    const envScene = new THREE.Scene();
    envScene.add(backdrop.sky.clone());
    const rt = pmrem.fromScene(envScene, 0, 1, 50000);
    if (envRT) envRT.dispose();
    envRT = rt;
    scene.environment = rt.texture;
    backdrop.scene.environment = rt.texture;
  }

  // ---- lights (house scene)
  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x8a8470, 0.45);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffffff, 0.08);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffb070, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality === 'low' ? 1024 : 2048, quality === 'low' ? 1024 : 2048);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.02;
  const span = Math.max(fp.w, fp.d) * 0.9 + 6;
  Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 160 });
  sun.target.position.set(cx, lowest, cz);
  scene.add(sun, sun.target);
  const rectLights = [];

  function setSun(mode) {
    opts.sun = mode;
    const golden = mode === 'golden';
    const el = golden ? sunElGolden : 52;
    const dir = sunDirection(sunAz, el);
    sun.position.copy(dir).multiplyScalar(70).add(new THREE.Vector3(cx, lowest, cz));
    sun.color.set(golden ? 0xffa85c : 0xfff1dc);
    sun.intensity = golden ? 2.4 : 3.0;
    hemi.color.set(golden ? 0xd9c4ff : 0xcfe0ff);
    hemi.groundColor.set(golden ? 0x9a7a5a : 0x8a8470);
    hemi.intensity = golden ? 0.3 : 0.42;
    backdrop.sun.position.copy(dir).multiplyScalar(1000);
    backdrop.sun.color.copy(sun.color);
    backdrop.sun.intensity = golden ? 1.8 : 2.2;
    backdrop.hemi.intensity = golden ? 0.45 : 0.7;
    backdrop.setSky(dir, golden);
    for (const l of rectLights) { l.color.set(golden ? 0xffc48a : 0xdfeaff); l.intensity = golden ? 1.4 : 1.8; }
    scene.environmentIntensity = golden ? 0.35 : 0.45;
    renderer.toneMappingExposure = 0.85;
    if (grade) grade.uniforms.warmth.value = golden ? 0.75 : 0.3;
    refreshEnvironment();
    sunBtn && sunBtn.setAttribute('aria-pressed', String(golden));
  }

  // ---- near surroundings (house scene: shadows + AO)
  scene.add(buildNearGround(environment, { footprint: fp, groundY }));

  // ---- materials
  const surface = (key, fallback) => catalogMaterial(matKey(key, fallback), { anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()) });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xe6f1f6, transparent: true, opacity: 0.16, roughness: 0.03, metalness: 0, reflectivity: 0.7, envMapIntensity: 1.0, side: THREE.DoubleSide, depthWrite: false });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.42, metalness: 0.65 });

  const house = new THREE.Group();
  scene.add(house);
  const box = (w, h, d, mat, x, y, z, { shadow = true, tile = null } = {}) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    const t = tile || (mat.userData && mat.userData.tile);
    if (t) fitUV(geo, t, { x, y, z });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    house.add(mesh);
    return mesh;
  };
  const slabPlane = (w, d, mat, x, y, z, { up = true } = {}) => {
    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
    fitUV(geo, mat.userData.tile, { x, y, z });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    mesh.castShadow = !up;
    house.add(mesh);
    return mesh;
  };

  const openingMap = openingsFor(layout, roomsById, levelsById);
  const overlaps = (a, b) => a.rect.x < b.rect.x + b.rect.w && a.rect.x + a.rect.w > b.rect.x && a.rect.z < b.rect.z + b.rect.d && a.rect.z + a.rect.d > b.rect.z;
  const roomAbove = (room) => layout.rooms.find((o) => o.id !== room.id && levelsById[o.level].elevation > levelsById[room.level].elevation + 0.5 && overlaps(o, room));
  const roomBelow = (room) => layout.rooms.find((o) => o.id !== room.id && levelsById[o.level].elevation < levelsById[room.level].elevation - 0.5 && overlaps(o, room));

  for (const room of layout.rooms) {
    const { x, z, w, d } = room.rect;
    const elev = levelsById[room.level].elevation;
    const H = roomHeight(room);
    const floorMat = surface(room.floor, 'white_oak');
    const ceilMat = surface(room.ceiling, 'plaster');
    const below = roomBelow(room);
    const slabMat = below ? surface(below.ceiling, 'plaster') : surface('plaster');
    // floor slab: its top face is the floor, its underside is the ceiling of the room below
    box(w, SLAB_T, d, slabMat, x + w / 2, elev - SLAB_T / 2, z + d / 2);
    slabPlane(w, d, floorMat, x + w / 2, elev + 0.002, z + d / 2);
    // ceiling (skip when a slab above already closes the room)
    if (!roomAbove(room)) {
      slabPlane(w, d, ceilMat, x + w / 2, elev + H, z + d / 2, { up: false });
      box(w, SLAB_T, d, surface('plaster'), x + w / 2, elev + H + SLAB_T / 2, z + d / 2); // roof slab
    }
    // walls
    const wallMat = surface(room.walls, 'plaster');
    for (const wall of ['n', 's', 'e', 'w']) {
      const seg = wallSeg(room.rect, wall);
      const L = seg.to - seg.from;
      const openings = ((openingMap[room.id] || {})[wall] || []).slice().sort((a, b) => a.offset - b.offset);
      const centre = seg.fixed + seg.inward * WALL_T / 2; // wall sits just inside the room edge
      const place = (from, to, y0, y1, mat = wallMat, thick = WALL_T, shadow = true) => {
        if (to - from < 0.004 || y1 - y0 < 0.004) return null;
        const len = to - from, mid = seg.from + (from + to) / 2, h = y1 - y0, y = elev + (y0 + y1) / 2;
        return seg.axis === 'x' ? box(len, h, thick, mat, mid, y, centre, { shadow }) : box(thick, h, len, mat, centre, y, mid, { shadow });
      };
      let cursor = 0;
      for (const o of openings) {
        const o0 = Math.max(0, o.offset), o1 = Math.min(L, o.offset + o.width);
        const s0 = Math.max(0, o.sill), s1 = Math.min(H, o.sill + o.height);
        place(cursor, o0, 0, H);
        if (s0 > 0) place(o0, o1, 0, s0);
        if (s1 < H) place(o0, o1, s1, H);
        if (!o.mirrored || o.between[1] === 'exterior') { // build glass/frames once per opening
          if (o.type === 'window' || o.type === 'glass_wall') addGlazing(seg, centre, o0, o1, elev + s0, elev + s1, o, room);
          if (o.type === 'door') addDoorFrame(seg, centre, o0, o1, elev + s0, elev + s1);
        }
        cursor = o1;
      }
      place(cursor, L, 0, H);
    }
  }

  function addGlazing(seg, centre, o0, o1, y0, y1, o, room) {
    const len = o1 - o0, h = y1 - y0, mid = seg.from + (o0 + o1) / 2, ym = (y0 + y1) / 2;
    const horiz = seg.axis === 'x';
    const mk = (l, hh, t, mat, a, y, shadow = true) => (horiz ? box(l, hh, t, mat, a, y, centre, { shadow }) : box(t, hh, l, mat, centre, y, a, { shadow }));
    mk(len, h, 0.012, glassMat, mid, ym, false);
    // frame
    mk(len, MULLION, MULLION, steelMat, mid, y0 + MULLION / 2);
    mk(len, MULLION, MULLION, steelMat, mid, y1 - MULLION / 2);
    mk(MULLION, h, MULLION, steelMat, seg.from + o0 + MULLION / 2, ym);
    mk(MULLION, h, MULLION, steelMat, seg.from + o1 - MULLION / 2, ym);
    const n = o.mullions ?? Math.max(0, Math.round(len / 1.1) - 1);
    for (let i = 1; i <= n; i++) mk(MULLION, h, MULLION, steelMat, seg.from + o0 + (len * i) / (n + 1), ym);
    if (h > 2.3) mk(len, MULLION, MULLION, steelMat, mid, y0 + 2.1); // transom on tall glazing
    // daylight bounce: an area light just inside large exterior glazing
    if (o.between[1] === 'exterior' && len * h >= 1.5 && rectLights.length < 6) {
      const light = new THREE.RectAreaLight(0xffc48a, 2.6, len - 0.1, h - 0.1);
      const inward = seg.inward * 0.12;
      if (horiz) light.position.set(mid, ym, centre + inward); else light.position.set(centre + inward, ym, mid);
      const target = horiz ? new THREE.Vector3(mid, ym - 0.2, centre + seg.inward * 3) : new THREE.Vector3(centre + seg.inward * 3, ym - 0.2, mid);
      light.lookAt(target);
      light.userData.room = room.id;
      scene.add(light);
      rectLights.push(light);
    }
  }
  function addDoorFrame(seg, centre, o0, o1, y0, y1) {
    const h = y1 - y0, ym = (y0 + y1) / 2, mid = seg.from + (o0 + o1) / 2;
    const horiz = seg.axis === 'x';
    const mk = (l, hh, t, a, y) => (horiz ? box(l, hh, t, steelMat, a, y, centre) : box(t, hh, l, steelMat, centre, y, a));
    mk(0.04, h, WALL_T + 0.02, seg.from + o0 + 0.02, ym);
    mk(0.04, h, WALL_T + 0.02, seg.from + o1 - 0.02, ym);
    mk(o1 - o0, 0.04, WALL_T + 0.02, mid, y1 - 0.02);
  }

  // stairs: a straight run from the wall of between[0] up to the other room's level
  for (const o of layout.openings.filter((o) => o.type === 'stair')) {
    const a = roomsById[o.between[0]], b = roomsById[o.between[1]];
    if (!a || !b) continue;
    const seg = wallSeg(a.rect, o.wall);
    const rise = levelsById[b.level].elevation - levelsById[a.level].elevation;
    if (rise <= 0) continue;
    const steps = Math.max(2, Math.round(rise / 0.18));
    const riser = rise / steps, run = 0.27;
    const treadMat = surface(a.floor, 'white_oak');
    for (let i = 0; i < steps; i++) {
      const along = seg.from + o.offset + o.width / 2;
      const depthPos = seg.fixed + seg.inward * (WALL_T + run * (i + 0.5));
      const y = levelsById[a.level].elevation + riser * (i + 0.5);
      if (seg.axis === 'x') box(o.width, riser, run, treadMat, along, y, depthPos);
      else box(run, riser, o.width, treadMat, depthPos, y, along);
    }
  }

  // ---- furniture from the catalog
  const furnitureGroup = new THREE.Group();
  furnitureGroup.name = 'furniture';
  house.add(furnitureGroup);
  const furnitureItems = Array.isArray(layout.furniture) ? layout.furniture : [];
  let furnitureBuilt = 0;
  for (const item of furnitureItems) {
    const room = roomsById[item.room];
    if (!room) continue;
    const g = buildFurniture(item, { elevation: levelsById[room.level].elevation, height: roomHeight(room), siblings: furnitureItems });
    if (g) { furnitureGroup.add(g); furnitureBuilt++; }
  }

  // ---- stops
  const camsByPhoto = Object.fromEntries(layout.cameras.map((c) => [c.photoId, c]));
  const ids = (order || layout.cameras.map((c) => c.photoId)).filter((id) => camsByPhoto[id]);
  const stops = ids.map((id) => {
    const c = camsByPhoto[id];
    const room = roomsById[c.room];
    const specPhoto = spec && spec.photos ? spec.photos.find((p) => p.id === id) : null;
    return { photoId: id, room: c.room, roomName: room ? room.name : c.room, camera: c, view: specPhoto ? specPhoto.view : '' };
  });
  if (!stops.length) throw new Error('layout has no cameras');

  // ---- post-processing
  const composer = new EffectComposer(renderer);
  const backPass = new RenderPass(backdrop.scene, backCamera);
  const housePass = new RenderPass(scene, camera);
  housePass.clear = false;
  housePass.clearDepth = true;
  composer.addPass(backPass);
  composer.addPass(housePass);
  let gtao = null;
  if (quality !== 'low') {
    gtao = new GTAOPass(scene, camera, 1, 1);
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = 0.9;
    gtao.updateGtaoMaterial({ radius: 0.4, distanceExponent: 1, thickness: 1, scale: 1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 8 });
    gtao.setSceneClipBox(new THREE.Box3(new THREE.Vector3(fp.x - 2, lowest - 1, fp.z - 2), new THREE.Vector3(fp.x + fp.w + 2, lowest + 12, fp.z + fp.d + 2)));
    composer.addPass(gtao);
  }
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.5, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const fxaa = new ShaderPass(FXAAShader);
  composer.addPass(fxaa);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  // ---- controls
  let btnPrev, btnPlay, btnNext, btnPhoto, sunBtn, madeBtn, idxEl;
  if (opts.showControls) {
    const mkBtn = (label, title, onClick) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.title = title; b.setAttribute('aria-label', title);
      b.addEventListener('click', onClick);
      bar.appendChild(b);
      return b;
    };
    btnPrev = mkBtn('‹', 'Previous stop', () => prev());
    btnPlay = mkBtn('▶', 'Play', () => (playing ? pause() : play()));
    btnNext = mkBtn('›', 'Next stop', () => next());
    idxEl = document.createElement('span'); idxEl.className = 'oh-idx'; bar.appendChild(idxEl);
    btnPhoto = mkBtn('Photoreal', 'Toggle the enhanced photo for this stop', () => setPhotoreal(!photoreal));
    btnPhoto.setAttribute('aria-pressed', 'false');
    sunBtn = mkBtn('Golden hour', 'Toggle golden-hour sun', () => setSun(opts.sun === 'golden' ? 'day' : 'golden'));
    madeBtn = mkBtn('How it was made', 'How it was made', () => showMade(!made.classList.contains('open')));
    madeBtn.title = 'Show how this tour was made (call trace numbers)';
    madeBtn.setAttribute('aria-pressed', 'false');
  }
  setSun(opts.sun);

  // ---- "How it was made" panel (data only from report.js; the viewer never sees the state)
  let reportData = report;
  function showMade(on) {
    made.classList.toggle('open', Boolean(on));
    if (madeBtn) madeBtn.setAttribute('aria-pressed', String(Boolean(on)));
  }
  function renderMade() {
    const r = reportData;
    made.innerHTML = '';
    const close = document.createElement('button'); close.className = 'oh-close'; close.type = 'button'; close.textContent = '×'; close.title = 'Close'; close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => showMade(false));
    made.appendChild(close);
    const h3 = document.createElement('h3'); h3.textContent = 'How it was made'; made.appendChild(h3);
    if (!r) { const p = document.createElement('p'); p.textContent = 'No call trace for this tour yet.'; made.appendChild(p); return; }
    const t = r.totals;
    const p = document.createElement('p');
    p.innerHTML = `<b data-oh="calls">${t.calls}</b> model/image calls (${t.modelCalls} model, ${t.imageCalls} image) · <b data-oh="retries">${t.retries}</b> retries · <b data-oh="failed">${t.failed}</b> failed attempts · <b data-oh="redone">${t.photosRedone}</b> of ${t.photos} photos redone · judge mean <b data-oh="mean">${t.meanScore ?? '—'}</b>/5${t.meanTourScore !== null ? ` · tour mean <b data-oh="tour">${t.meanTourScore}</b>/5` : ''} · model time ${(t.ms / 1000).toFixed(1)} s`;
    made.appendChild(p);
    const table = (head, rows) => {
      const tb = document.createElement('table');
      tb.innerHTML = `<thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`;
      made.appendChild(tb);
    };
    table(['step', 'calls', 'retries', 'failed', 'redo calls', 'time'], r.steps.map((s) => [s.step, s.calls, s.retries, s.failed, s.redos, `${(s.ms / 1000).toFixed(1)} s`]));
    table(['photo', 'calls', 'judge', 'first', 'tour', 'redone', 'defects'], r.photos.map((ph) => [ph.photoId, ph.calls, ph.score === null ? '—' : `${ph.score}/5`, ph.firstScore === null ? '—' : `${ph.firstScore}/5`, ph.tourScore === null ? '—' : `${ph.tourScore}/5`, ph.redone ? 'yes' : 'no', ph.defects.length]));
    const small = document.createElement('small'); small.textContent = `Every number is recounted from the call trace (${t.calls} entries) and the judge output; no model-written summary is quoted. Run ${r.runId || ''}.`;
    made.appendChild(small);
  }
  renderMade();

  // ---- camera state
  let index = 0;
  let playing = false;
  let playTimer = null;
  let photoreal = false;
  let activePhoto = photoA;
  const look = { yaw: 0, pitch: 0 };
  const cur = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 70 };
  let glide = null; // { from, to, start, dur }

  const v3 = (o) => new THREE.Vector3(o.x, o.y, o.z);

  function applyCamera() {
    camera.position.copy(cur.pos);
    const dir = cur.target.clone().sub(cur.pos);
    const sph = new THREE.Spherical().setFromVector3(dir);
    sph.theta += look.yaw;
    sph.phi = THREE.MathUtils.clamp(sph.phi + look.pitch, 0.15, Math.PI - 0.15);
    const t = new THREE.Vector3().setFromSpherical(sph).add(cur.pos);
    camera.lookAt(t);
    if (camera.fov !== cur.fov) { camera.fov = cur.fov; camera.updateProjectionMatrix(); }
    backCamera.position.copy(camera.position);
    backCamera.quaternion.copy(camera.quaternion);
    if (backCamera.fov !== camera.fov || backCamera.aspect !== camera.aspect) { backCamera.fov = camera.fov; backCamera.aspect = camera.aspect; backCamera.updateProjectionMatrix(); }
  }

  function setStopInstant(i) {
    const c = stops[i].camera;
    cur.pos.copy(v3(c.position));
    cur.target.copy(v3(c.lookAt));
    cur.fov = c.fov;
    look.yaw = 0; look.pitch = 0;
    applyCamera();
  }

  function goTo(i, { instant = false } = {}) {
    i = ((i % stops.length) + stops.length) % stops.length;
    index = i;
    const c = stops[i].camera;
    if (instant || !opts.glideMs) { glide = null; setStopInstant(i); }
    else {
      glide = {
        from: { pos: cur.pos.clone(), target: lookTarget(), fov: cur.fov },
        to: { pos: v3(c.position), target: v3(c.lookAt), fov: c.fov },
        start: performance.now(), dur: opts.glideMs,
      };
      look.yaw = 0; look.pitch = 0;
    }
    updateCaption();
    if (photoreal) showPhoto(stops[i].photoId);
    root.dispatchEvent(new CustomEvent('oh:stop', { detail: { index: i, stop: stops[i] } }));
  }
  function lookTarget() { // where the (possibly dragged) camera is looking now
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    return cur.pos.clone().add(dir.multiplyScalar(cur.target.distanceTo(cur.pos)));
  }
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function updateCaption() {
    const s = stops[index];
    const line = narrationByRoom[s.room] || s.view || '';
    caption.innerHTML = `<b>${index + 1} / ${stops.length} · ${escapeHtml(s.roomName)}</b>${escapeHtml(line)}`;
    if (idxEl) idxEl.textContent = `${index + 1}/${stops.length}`;
  }
  const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function showPhoto(photoId) {
    const src = images[photoId];
    const incoming = activePhoto === photoA ? photoB : photoA;
    if (!src) { photoA.style.opacity = 0; photoB.style.opacity = 0; return; }
    incoming.src = src;
    incoming.style.opacity = 1;
    activePhoto.style.opacity = 0;
    activePhoto = incoming;
  }
  function setPhotoreal(on) {
    photoreal = Boolean(on);
    if (btnPhoto) btnPhoto.setAttribute('aria-pressed', String(photoreal));
    if (photoreal) showPhoto(stops[index].photoId);
    else { photoA.style.opacity = 0; photoB.style.opacity = 0; }
    root.dispatchEvent(new CustomEvent('oh:photoreal', { detail: { on: photoreal } }));
  }
  function next() { goTo(index + 1); }
  function prev() { goTo(index - 1); }
  function play() {
    playing = true;
    if (btnPlay) { btnPlay.textContent = '❚❚'; btnPlay.title = 'Pause'; }
    clearInterval(playTimer);
    playTimer = setInterval(() => next(), opts.autoplayMs);
  }
  function pause() {
    playing = false;
    if (btnPlay) { btnPlay.textContent = '▶'; btnPlay.title = 'Play'; }
    clearInterval(playTimer);
    playTimer = null;
  }

  // ---- drag to look
  let drag = null;
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: look.yaw, pitch: look.pitch }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = 0.0045;
    look.yaw = drag.yaw + (e.clientX - drag.x) * k; // drag right -> look right
    look.pitch = THREE.MathUtils.clamp(drag.pitch + (e.clientY - drag.y) * k, -1.2, 1.2);
    glide = null;
  });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---- sizing + loop
  let sizeW = 0, sizeH = 0;
  function setSize(w, h) {
    if (!w || !h) return;
    sizeW = w; sizeH = h;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio();
    fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    grade.uniforms.resolution.value.set(w * pr, h * pr);
    bloom.setSize(w, h);
    if (gtao) gtao.setSize(w, h);
  }
  function resize(w = stage.clientWidth, h = stage.clientHeight) { setSize(w, h); }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  ro && ro.observe(stage);
  resize();

  let frames = 0, raf = 0, disposed = false;
  renderer.info.autoReset = false; // count every pass of a frame, not just the last one
  function renderFrame(now = performance.now()) {
    applyCamera();
    grade.uniforms.time.value = (now % 1000) / 7;
    renderer.info.reset();
    composer.render();
    frames++;
  }
  function frame(now) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    if (glide) {
      const t = Math.min(1, (now - glide.start) / glide.dur);
      const k = ease(t);
      cur.pos.lerpVectors(glide.from.pos, glide.to.pos, k);
      cur.target.lerpVectors(glide.from.target, glide.to.target, k);
      cur.fov = glide.from.fov + (glide.to.fov - glide.from.fov) * k;
      if (t >= 1) glide = null;
    }
    renderFrame(now);
  }
  setStopInstant(0);
  updateCaption();
  raf = requestAnimationFrame(frame);

  // ---- capture every stop as a PNG for the judge
  async function captureStops({ width = 960, height = 720 } = {}) {
    const wasPlaying = playing; pause();
    const savedIndex = index, savedPos = cur.pos.clone(), savedTarget = cur.target.clone(), savedFov = cur.fov, savedLook = { ...look };
    const savedPhoto = photoreal;
    const prevW = sizeW, prevH = sizeH;
    setSize(width, height);
    const shots = [];
    for (let i = 0; i < stops.length; i++) {
      setStopInstant(i);
      renderFrame();
      shots.push({ photoId: stops[i].photoId, room: stops[i].room, image: renderer.domElement.toDataURL('image/png') });
      await new Promise((r) => setTimeout(r, 0));
    }
    setSize(prevW || stage.clientWidth, prevH || stage.clientHeight);
    index = savedIndex; cur.pos.copy(savedPos); cur.target.copy(savedTarget); cur.fov = savedFov; Object.assign(look, savedLook);
    applyCamera();
    photoreal = savedPhoto;
    if (wasPlaying) play();
    return shots;
  }

  // Where an opening lands on the canvas (pixels), for tests that sample the glass region.
  function openingScreenRect(openingId) {
    const o = layout.openings.find((x) => x.id === openingId);
    if (!o || o.type === 'stair') return null;
    const a = roomsById[o.between[0]];
    const seg = wallSeg(a.rect, o.wall);
    const elev = levelsById[a.level].elevation;
    const pts = [];
    for (const along of [seg.from + o.offset, seg.from + o.offset + o.width]) for (const y of [elev + o.sill, elev + o.sill + o.height]) {
      pts.push(seg.axis === 'x' ? new THREE.Vector3(along, y, seg.fixed) : new THREE.Vector3(seg.fixed, y, along));
    }
    camera.updateMatrixWorld();
    const w = renderer.domElement.width, h = renderer.domElement.height;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      const v = p.project(camera);
      if (v.z > 1) return null; // behind the camera
      const sx = ((v.x + 1) / 2) * w, sy = ((1 - v.y) / 2) * h;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(w, x1), y1: Math.min(h, y1), canvas: { w, h } };
  }

  function setImages(map) { Object.assign(images, map || {}); if (photoreal) showPhoto(stops[index].photoId); }
  function setNarration(n) {
    for (const l of (n && n.lines) || []) narrationByRoom[l.room] = l.text;
    updateCaption();
  }
  function setReport(r) { reportData = r || null; renderMade(); }
  function dispose() {
    disposed = true;
    cancelAnimationFrame(raf);
    pause();
    ro && ro.disconnect();
    composer.dispose && composer.dispose();
    if (envRT) envRT.dispose();
    pmrem.dispose();
    renderer.dispose();
    root.remove();
  }
  function debug() {
    const info = renderer.info.render;
    return {
      stop: index, photoId: stops[index].photoId, stops: stops.length, frames,
      camera: { x: +camera.position.x.toFixed(2), y: +camera.position.y.toFixed(2), z: +camera.position.z.toFixed(2), fov: +camera.fov.toFixed(1) },
      calls: info.calls, triangles: info.triangles, photoreal, sun: opts.sun, playing, gliding: Boolean(glide),
      canvas: { w: renderer.domElement.width, h: renderer.domElement.height },
      quality, environment, furniture: furnitureBuilt, rectLights: rectLights.length, gtao: Boolean(gtao), passes: composer.passes.length,
      made: made.classList.contains('open'), report: reportData ? { calls: reportData.totals.calls, retries: reportData.totals.retries } : null,
    };
  }

  return { el: root, renderer, scene, backdrop: backdrop.scene, camera, composer, stops, goTo, next, prev, play, pause, setPhotoreal, setSun, setImages, setNarration, setReport, showMade, captureStops, renderFrame, openingScreenRect, resize, dispose, debug, get index() { return index; }, get photoreal() { return photoreal; }, get quality() { return quality; }, get environment() { return environment; } };
}
