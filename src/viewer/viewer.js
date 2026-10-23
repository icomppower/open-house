// open-house viewer: a three.js tour built from layout.json.
// Clean architectural geometry (walls, floor slabs at their levels, openings, glass with black
// steel mullions), ACES tone mapping, soft shadows, golden-hour sun option. The camera glides
// from stop to stop (one stop per photo, using the layout cameras); drag to look around.
// "Photoreal" crossfades to that stop's enhanced photo. captureStops() renders a PNG per stop.

import * as THREE from '../../vendor/three.module.js';

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
`;

let cssInjected = false;
function injectCss() {
  if (cssInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  cssInjected = true;
}

// ------------------------------------------------------------- materials

const COLOUR_WORDS = [
  [/walnut|dark brown|espresso/i, 0x5a3f2c], [/oak|honey|wood|timber|pine|ash\b/i, 0xc99a5a],
  [/terrazzo/i, 0xd6d4cf], [/concrete|cement/i, 0xb4b2ad], [/sage|olive|green/i, 0xa9b59a],
  [/navy|blue/i, 0x9db2c7], [/black|charcoal/i, 0x2a2a2a], [/grey|gray/i, 0xc9c9c6],
  [/cream|beige|sand|taupe/i, 0xe6d9c2], [/stone|marble|limestone/i, 0xdad5ca], [/tile|ceramic/i, 0xe6e6e2],
  [/white/i, 0xf2efe8], [/terracotta|brick|red/i, 0xb5674a],
];

function pickColour(mat, where) {
  for (const text of [mat && mat.colour, mat && mat.name]) {
    if (!text) continue;
    for (const [re, hex] of COLOUR_WORDS) if (re.test(text)) return hex;
  }
  return where === 'floor' ? 0xc9a070 : where === 'ceiling' ? 0xf7f5f0 : 0xf0ece4;
}

function textureKind(mat) {
  const text = `${(mat && mat.name) || ''} ${(mat && mat.colour) || ''}`;
  if (/oak|wood|timber|pine|plank|walnut/i.test(text)) return 'planks';
  if (/tile|ceramic/i.test(text)) return 'tiles';
  if (/terrazzo/i.test(text)) return 'terrazzo';
  return null;
}

function makeTexture(kind, hex, repeatW, repeatD) {
  if (typeof document === 'undefined') return null;
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const base = new THREE.Color(hex);
  g.fillStyle = `#${base.getHexString()}`;
  g.fillRect(0, 0, size, size);
  const shade = (k) => `#${base.clone().multiplyScalar(k).getHexString()}`;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  if (kind === 'planks') {
    const rows = 8;
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * 200;
      while (x < size) {
        const w = 200 + rnd() * 240;
        g.fillStyle = shade(0.86 + rnd() * 0.26);
        g.fillRect(x, (r * size) / rows, w - 2, size / rows - 2);
        x += w;
      }
    }
  } else if (kind === 'tiles') {
    const n = 4;
    g.fillStyle = shade(0.8);
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = shade(0.97 + rnd() * 0.05);
      g.fillRect((i * size) / n + 2, (j * size) / n + 2, size / n - 4, size / n - 4);
    }
  } else if (kind === 'terrazzo') {
    for (let i = 0; i < 900; i++) {
      g.fillStyle = [shade(0.55), shade(0.7), shade(1.1), '#7a6a5a'][Math.floor(rnd() * 4)];
      g.beginPath();
      g.ellipse(rnd() * size, rnd() * size, 2 + rnd() * 5, 2 + rnd() * 4, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatW, repeatD);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
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

// ------------------------------------------------------------- viewer

export function createViewer({ container, layout, spec = null, narration = null, images = {}, order = null, options = {} } = {}) {
  if (!container) throw new Error('createViewer needs a container element');
  if (!layout) throw new Error('createViewer needs layout.json');
  injectCss();

  const opts = { sun: 'golden', autoplayMs: 4200, glideMs: 1600, showControls: true, ...options };
  const mats = Object.fromEntries(((spec && spec.materials) || []).map((m) => [m.id, m]));
  const roomsById = Object.fromEntries(layout.rooms.map((r) => [r.id, r]));
  const levelsById = Object.fromEntries(layout.levels.map((l) => [l.id, l]));
  const roomHeight = (r) => r.ceilingHeight || levelsById[r.level].height;
  const narrationByRoom = Object.fromEntries(((narration && narration.lines) || []).map((l) => [l.room, l.text]));

  // DOM
  const root = document.createElement('div');
  root.className = 'oh-viewer';
  const stage = document.createElement('div');
  stage.className = 'oh-stage';
  root.appendChild(stage);
  const photoA = document.createElement('img'); photoA.className = 'oh-photo'; photoA.alt = '';
  const photoB = document.createElement('img'); photoB.className = 'oh-photo'; photoB.alt = '';
  const caption = document.createElement('div'); caption.className = 'oh-caption';
  const bar = document.createElement('div'); bar.className = 'oh-bar';
  container.appendChild(root);

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.appendChild(renderer.domElement);
  stage.appendChild(photoA);
  stage.appendChild(photoB);
  stage.appendChild(caption);
  if (opts.showControls) root.appendChild(bar);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 4 / 3, 0.05, 200);

  // ---- lights
  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0xb5a898, 0.6);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffffff, 0.18);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffb070, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  const fp = layout.footprint;
  const cx = fp.x + fp.w / 2, cz = fp.z + fp.d / 2;
  const span = Math.max(fp.w, fp.d) * 0.9 + 4;
  Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 120 });
  sun.target.position.set(cx, 0, cz);
  scene.add(sun, sun.target);

  function setSun(mode) {
    opts.sun = mode;
    const az = (layout.sun && layout.sun.azimuth) ?? 250;
    const golden = mode === 'golden';
    const el = golden ? ((layout.sun && layout.sun.elevation) ?? 10) : 52;
    const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
    const dir = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
    sun.position.copy(dir.multiplyScalar(60)).add(new THREE.Vector3(cx, 0, cz));
    sun.color.set(golden ? 0xffb070 : 0xfff4e6);
    sun.intensity = golden ? 2.6 : 3.2;
    hemi.color.set(golden ? 0xd7c9ff : 0xcfe0ff);
    hemi.intensity = golden ? 0.5 : 0.75;
    scene.background = new THREE.Color(golden ? 0xe8b98a : 0xcfe0f2);
    renderer.toneMappingExposure = golden ? 1.05 : 0.95;
    sunBtn && sunBtn.setAttribute('aria-pressed', String(golden));
  }

  // ---- ground outside
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x8f9a74, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, -SLAB_T - 0.001, cz);
  ground.receiveShadow = true;
  scene.add(ground);

  // ---- materials
  const matCache = new Map();
  function surfaceMaterial(id, where, repeatW = 1, repeatD = 1) {
    const key = `${id}|${where}|${repeatW.toFixed(1)}|${repeatD.toFixed(1)}`;
    if (matCache.has(key)) return matCache.get(key);
    const spec = mats[id];
    const colour = pickColour(spec, where);
    const glossy = spec && /gloss|polish|lacquer/i.test(spec.finish || '');
    const m = new THREE.MeshStandardMaterial({ color: colour, roughness: glossy ? 0.35 : where === 'floor' ? 0.6 : 0.9, metalness: 0 });
    if (where === 'floor') {
      const tex = makeTexture(textureKind(spec), colour, repeatW, repeatD);
      if (tex) { m.map = tex; m.color.set(0xffffff); }
    }
    matCache.set(key, m);
    return m;
  }
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xdfeef5, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0, transmission: 0, side: THREE.DoubleSide, depthWrite: false });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.45, metalness: 0.6 });
  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0xf7f5f0, roughness: 0.95, side: THREE.FrontSide });

  const house = new THREE.Group();
  scene.add(house);
  const box = (w, h, d, mat, x, y, z, { shadow = true } = {}) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    house.add(mesh);
    return mesh;
  };

  const openingMap = openingsFor(layout, roomsById, levelsById);
  const hasRoomAbove = (room) => layout.rooms.some((o) => o.id !== room.id && levelsById[o.level].elevation > levelsById[room.level].elevation + 0.5
    && o.rect.x < room.rect.x + room.rect.w && o.rect.x + o.rect.w > room.rect.x && o.rect.z < room.rect.z + room.rect.d && o.rect.z + o.rect.d > room.rect.z);

  for (const room of layout.rooms) {
    const { x, z, w, d } = room.rect;
    const elev = levelsById[room.level].elevation;
    const H = roomHeight(room);
    // floor slab (top face at the level elevation; its underside is the ceiling of the room below)
    const floorMat = surfaceMaterial(room.floor, 'floor', w / 1.2, d / 1.2);
    const floor = box(w, SLAB_T, d, [ceilingMat, ceilingMat, floorMat, ceilingMat, ceilingMat, ceilingMat], x + w / 2, elev - SLAB_T / 2, z + d / 2, { shadow: false });
    floor.castShadow = true;
    // ceiling (skip when a slab above already closes the room)
    if (!hasRoomAbove(room)) {
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilingMat);
      ceil.rotation.x = Math.PI / 2;
      ceil.position.set(x + w / 2, elev + H, z + d / 2);
      ceil.receiveShadow = true;
      ceil.castShadow = true;
      house.add(ceil);
    }
    // walls
    const wallMat = surfaceMaterial(room.walls, 'wall');
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
          if (o.type === 'window' || o.type === 'glass_wall') addGlazing(seg, centre, o0, o1, elev + s0, elev + s1, o);
          if (o.type === 'door') addDoorFrame(seg, centre, o0, o1, elev + s0, elev + s1);
        }
        cursor = o1;
      }
      place(cursor, L, 0, H);
    }
  }

  function addGlazing(seg, centre, o0, o1, y0, y1, o) {
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
    const treadMat = surfaceMaterial(a.floor, 'floor', 1, 1);
    for (let i = 0; i < steps; i++) {
      const along = seg.from + o.offset + o.width / 2;
      const depthPos = seg.fixed + seg.inward * (WALL_T + run * (i + 0.5));
      const y = levelsById[a.level].elevation + riser * (i + 0.5);
      if (seg.axis === 'x') box(o.width, riser, run, treadMat, along, y, depthPos);
      else box(run, riser, o.width, treadMat, depthPos, y, along);
    }
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

  // ---- controls
  let btnPrev, btnPlay, btnNext, btnPhoto, sunBtn, idxEl;
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
  }
  setSun(opts.sun);

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
  function resize(w = stage.clientWidth, h = stage.clientHeight) {
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  ro && ro.observe(stage);
  resize();

  let frames = 0, raf = 0, disposed = false;
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
    applyCamera();
    renderer.render(scene, camera);
    frames++;
  }
  setStopInstant(0);
  updateCaption();
  raf = requestAnimationFrame(frame);

  // ---- capture every stop as a PNG for the judge
  async function captureStops({ width = 960, height = 720 } = {}) {
    const wasPlaying = playing; pause();
    const savedIndex = index, savedPos = cur.pos.clone(), savedTarget = cur.target.clone(), savedFov = cur.fov, savedLook = { ...look };
    const savedPhoto = photoreal;
    const prevW = stage.clientWidth, prevH = stage.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const shots = [];
    for (let i = 0; i < stops.length; i++) {
      setStopInstant(i);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      shots.push({ photoId: stops[i].photoId, room: stops[i].room, image: renderer.domElement.toDataURL('image/png') });
      await new Promise((r) => setTimeout(r, 0));
    }
    resize(prevW, prevH);
    index = savedIndex; cur.pos.copy(savedPos); cur.target.copy(savedTarget); cur.fov = savedFov; Object.assign(look, savedLook);
    applyCamera();
    photoreal = savedPhoto;
    if (wasPlaying) play();
    return shots;
  }

  function setImages(map) { Object.assign(images, map || {}); if (photoreal) showPhoto(stops[index].photoId); }
  function setNarration(n) {
    for (const l of (n && n.lines) || []) narrationByRoom[l.room] = l.text;
    updateCaption();
  }
  function dispose() {
    disposed = true;
    cancelAnimationFrame(raf);
    pause();
    ro && ro.disconnect();
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
    };
  }

  return { el: root, renderer, scene, camera, stops, goTo, next, prev, play, pause, setPhotoreal, setSun, setImages, setNarration, captureStops, resize, dispose, debug, get index() { return index; }, get photoreal() { return photoreal; } };
}
