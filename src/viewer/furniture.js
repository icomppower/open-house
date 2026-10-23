// Furniture builders for every catalog furniture key: rounded boxes and cylinders at the
// real-world sizes from catalog.js. Each builder returns a THREE.Group whose origin is the
// centre of the footprint at floor level, facing north (-z) at rotation 0.

import * as THREE from '../../vendor/three.module.js';
import { RoundedBoxGeometry } from '../../vendor/three-addons.module.js';
import { furniture as CATALOG, footprintBox } from './catalog.js';
import { catalogMaterial, fitUV, leafMaterial } from './textures.js';

// ---- shared finishes (the viewer decides how everything looks)
const F = {
  fabric: () => new THREE.MeshStandardMaterial({ color: 0x7b8079, roughness: 0.95 }),
  fabricDark: () => new THREE.MeshStandardMaterial({ color: 0x4a4f4c, roughness: 0.95 }),
  leather: () => new THREE.MeshStandardMaterial({ color: 0x4b3627, roughness: 0.55 }),
  linen: () => new THREE.MeshStandardMaterial({ color: 0xece6da, roughness: 0.95 }),
  steel: () => new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.4, metalness: 0.7 }),
  brass: () => new THREE.MeshStandardMaterial({ color: 0xb8925a, roughness: 0.3, metalness: 0.9 }),
  chrome: () => new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.12, metalness: 1 }),
  ceramic: () => new THREE.MeshStandardMaterial({ color: 0xf6f4ef, roughness: 0.18 }),
  ceramicInner: () => new THREE.MeshStandardMaterial({ color: 0xd9d5cc, roughness: 0.25, side: THREE.BackSide }),
  opal: () => new THREE.MeshStandardMaterial({ color: 0xfff4e4, emissive: 0xffe2b8, emissiveIntensity: 2.2, roughness: 0.5 }),
  shade: () => new THREE.MeshStandardMaterial({ color: 0xf1e9da, emissive: 0xffd9a8, emissiveIntensity: 0.55, roughness: 0.95, side: THREE.DoubleSide }),
  mirror: () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.02, metalness: 1 }),
  soil: () => new THREE.MeshStandardMaterial({ color: 0x2c2118, roughness: 1 }),
  terracotta: () => new THREE.MeshStandardMaterial({ color: 0x9c6a4c, roughness: 0.85 }),
  darkWood: () => new THREE.MeshStandardMaterial({ color: 0x3b2a1f, roughness: 0.55 }),
  ember: () => new THREE.MeshStandardMaterial({ color: 0x1a0d08, emissive: 0xff6a1a, emissiveIntensity: 1.6, roughness: 1 }),
  cavity: () => new THREE.MeshStandardMaterial({ color: 0x0a0908, roughness: 1 }),
  book: (hex) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85 }),
};
const finishCache = new Map();
const fin = (name) => { if (!finishCache.has(name)) finishCache.set(name, F[name]()); return finishCache.get(name); };
const bookMat = (hex) => { const k = `book_${hex}`; if (!finishCache.has(k)) finishCache.set(k, F.book(hex)); return finishCache.get(k); };

// A catalog material with local-space UVs so panels and planks read at real size.
function surf(key) { return catalogMaterial(key); }

function rbox(w, h, d, r, mat, { x = 0, y = 0, z = 0, uvTile = null, shadow = true } = {}) {
  const geo = new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2));
  if (uvTile) fitUV(geo, uvTile, { x, y, z });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}
function box(w, h, d, mat, opts = {}) { return rbox(w, h, d, 0, mat, opts); }
function cyl(rt, rb, h, mat, { x = 0, y = 0, z = 0, seg = 28, shadow = true } = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}
const tileOf = (mat) => (mat.userData && mat.userData.tile) || null;

function legs(g, w, d, h, inset, mat, size = 0.04) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(size, h, size, mat, { x: sx * (w / 2 - inset), y: h / 2, z: sz * (d / 2 - inset) }));
}

// Deterministic per-item variation (book colours, leaf cards).
function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function foliage(g, rand, { cards, cx = 0, cy, cz = 0, rx, ry, size }) {
  const mat = leafMaterial();
  for (let i = 0; i < cards; i++) {
    const u = rand() * Math.PI * 2, v = Math.acos(2 * rand() - 1), rr = Math.cbrt(rand());
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    m.position.set(cx + rx * rr * Math.sin(v) * Math.cos(u), cy + ry * rr * Math.cos(v), cz + rx * rr * Math.sin(v) * Math.sin(u));
    m.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
    m.castShadow = true; m.receiveShadow = false;
    g.add(m);
  }
}

// ---- builders: (g: Group, { w, d, h }, ctx) where ctx = { material (catalog key | null), ceiling (m above floor), rand }
const BUILD = {
  sofa_l(g, { w, d, h }, c) {
    const fab = c.material ? surf(c.material) : fin('fabric');
    const seatH = 0.42, backT = 0.24;
    g.add(rbox(w, seatH, 0.9, 0.05, fab, { y: seatH / 2, z: d / 2 - 0.45 })); // main seat along the back
    g.add(rbox(0.9, seatH, d - 0.9, 0.05, fab, { x: w / 2 - 0.45, y: seatH / 2, z: -(d / 2) + (d - 0.9) / 2 })); // chaise, right
    g.add(rbox(w, h - seatH, backT, 0.06, fab, { y: seatH + (h - seatH) / 2, z: d / 2 - backT / 2 }));
    g.add(rbox(0.22, h - seatH + 0.02, 0.9, 0.05, fab, { x: -w / 2 + 0.11, y: seatH + (h - seatH) / 2 - 0.02, z: d / 2 - 0.45 })); // left arm
    for (let i = 0; i < 3; i++) g.add(rbox((w - 0.3) / 3 - 0.03, 0.12, 0.62, 0.05, fab, { x: -w / 2 + 0.26 + (i + 0.5) * ((w - 0.3) / 3), y: seatH + 0.06, z: d / 2 - 0.55 }));
    g.add(rbox(0.8, 0.12, d - 1.0, 0.05, fab, { x: w / 2 - 0.45, y: seatH + 0.06, z: -(d / 2) + (d - 0.9) / 2 }));
  },
  sofa_straight(g, { w, d, h }, c) {
    const fab = c.material ? surf(c.material) : fin('fabric');
    const legH = 0.12, seatH = 0.42, armW = 0.2, backT = 0.22;
    legs(g, w - 0.1, d - 0.1, legH, 0.08, fin('steel'), 0.035);
    g.add(rbox(w, seatH - legH, d, 0.05, fab, { y: legH + (seatH - legH) / 2 }));
    g.add(rbox(w, h - seatH, backT, 0.06, fab, { y: seatH + (h - seatH) / 2, z: d / 2 - backT / 2 }));
    for (const s of [-1, 1]) g.add(rbox(armW, h - seatH - 0.1, d, 0.05, fab, { x: s * (w / 2 - armW / 2), y: seatH + (h - seatH - 0.1) / 2 }));
    const inner = w - 2 * armW;
    for (let i = 0; i < 3; i++) g.add(rbox(inner / 3 - 0.03, 0.13, d - backT - 0.08, 0.05, fab, { x: -inner / 2 + (i + 0.5) * (inner / 3), y: seatH + 0.065, z: -backT / 2 }));
  },
  lounge_chair(g, { w, d, h }, c) {
    const fab = c.material ? surf(c.material) : fin('fabricDark');
    const wood = fin('darkWood');
    legs(g, w - 0.08, d - 0.08, 0.3, 0.05, wood, 0.04);
    g.add(rbox(w - 0.08, 0.16, d - 0.1, 0.05, fab, { y: 0.38, z: 0.02 }));
    const back = rbox(w - 0.1, 0.5, 0.1, 0.05, fab, { y: 0.38 + 0.25, z: d / 2 - 0.1 });
    back.rotation.x = -0.18;
    g.add(back);
    for (const s of [-1, 1]) g.add(box(0.05, 0.03, d - 0.1, wood, { x: s * (w / 2 - 0.03), y: h - 0.2, z: 0 }));
    for (const s of [-1, 1]) g.add(box(0.04, h - 0.2 - 0.3, 0.04, wood, { x: s * (w / 2 - 0.03), y: 0.3 + (h - 0.5) / 2, z: -d / 2 + 0.06 }));
  },
  ottoman(g, { w, d, h }, c) {
    const fab = c.material ? surf(c.material) : fin('fabric');
    legs(g, w, d, 0.08, 0.06, fin('steel'), 0.03);
    g.add(rbox(w, h - 0.08, d, 0.07, fab, { y: 0.08 + (h - 0.08) / 2 }));
  },
  coffee_table_plinth(g, { w, d, h }, c) {
    const mat = surf(c.material || 'white_oak');
    g.add(rbox(w, h, d, 0.015, mat, { y: h / 2, uvTile: tileOf(mat) }));
  },
  dining_table(g, { w, d, h }, c) {
    const mat = surf(c.material || 'white_oak');
    g.add(rbox(w, 0.04, d, 0.008, mat, { y: h - 0.02, uvTile: tileOf(mat) }));
    for (const s of [-1, 1]) g.add(rbox(0.08, h - 0.04, d - 0.3, 0.008, mat, { x: s * (w / 2 - 0.25), y: (h - 0.04) / 2, uvTile: tileOf(mat) }));
  },
  dining_chair(g, { w, d, h }, c) {
    const wood = c.material ? surf(c.material) : fin('darkWood');
    const seatH = 0.45;
    legs(g, w, d, seatH, 0.03, wood, 0.035);
    g.add(rbox(w, 0.035, d, 0.008, wood, { y: seatH }));
    for (const s of [-1, 1]) g.add(box(0.035, h - seatH, 0.035, wood, { x: s * (w / 2 - 0.03), y: seatH + (h - seatH) / 2, z: d / 2 - 0.03 }));
    g.add(rbox(w - 0.06, 0.09, 0.025, 0.008, wood, { y: h - 0.06, z: d / 2 - 0.03 }));
    g.add(rbox(w - 0.06, 0.05, 0.02, 0.008, wood, { y: h - 0.2, z: d / 2 - 0.03 }));
  },
  island_waterfall(g, { w, d, h }, c) {
    const body = surf(c.material || 'walnut');
    const stone = surf('marble_white');
    const top = 0.04;
    g.add(box(w - 0.1, 0.08, d - 0.2, fin('cavity'), { y: 0.04 })); // toe kick shadow
    g.add(box(w - 0.1, h - top - 0.08, d - 0.1, body, { y: 0.08 + (h - top - 0.08) / 2, uvTile: tileOf(body) }));
    g.add(box(w, top, d, stone, { y: h - top / 2, uvTile: tileOf(stone) }));
    for (const s of [-1, 1]) g.add(box(top, h, d, stone, { x: s * (w / 2 - top / 2), y: h / 2, uvTile: tileOf(stone) })); // waterfall ends
    // door reveals
    const doors = 3;
    for (let i = 1; i < doors; i++) g.add(box(0.006, h - top - 0.12, 0.012, fin('cavity'), { x: -w / 2 + 0.05 + (i * (w - 0.1)) / doors, y: 0.08 + (h - top - 0.08) / 2, z: -d / 2 + 0.05 }));
  },
  counter_run(g, { w, d, h }, c) {
    const body = surf(c.material || 'walnut');
    const stone = surf('marble_white');
    const top = 0.04;
    g.add(box(w, 0.08, d - 0.08, fin('cavity'), { y: 0.04, z: 0.04 }));
    g.add(box(w, h - top - 0.08, d - 0.04, body, { y: 0.08 + (h - top - 0.08) / 2, z: 0.02, uvTile: tileOf(body) }));
    g.add(box(w + 0.02, top, d + 0.03, stone, { y: h - top / 2, z: -0.015, uvTile: tileOf(stone) }));
    const doors = Math.max(2, Math.round(w / 0.6));
    for (let i = 1; i < doors; i++) g.add(box(0.006, h - top - 0.12, 0.012, fin('cavity'), { x: -w / 2 + (i * w) / doors, y: 0.08 + (h - top - 0.08) / 2, z: -d / 2 + 0.005 }));
    for (let i = 0; i < doors; i++) g.add(box(0.12, 0.01, 0.02, fin('brass'), { x: -w / 2 + ((i + 0.5) * w) / doors, y: h - top - 0.12, z: -d / 2 + 0.01 }));
  },
  bar_stool(g, { w, h }, c) {
    const seat = c.material ? surf(c.material) : fin('leather');
    g.add(cyl(0.19, 0.19, 0.01, fin('steel'), { y: 0.005 }));
    g.add(cyl(0.02, 0.02, h - 0.06, fin('steel'), { y: (h - 0.06) / 2 }));
    g.add(cyl(0.16, 0.16, 0.02, fin('steel'), { y: 0.22, seg: 20 }));
    g.add(cyl(w / 2, w / 2 - 0.02, 0.06, seat, { y: h - 0.03 }));
  },
  bed_king(g, size, c) { BUILD.bed_queen(g, size, c); },
  bed_queen(g, { w, d, h }, c) {
    const frame = surf(c.material || 'white_oak');
    const headH = h, headT = 0.06;
    g.add(rbox(w, 0.28, d - headT, 0.01, frame, { y: 0.14, z: -headT / 2, uvTile: tileOf(frame) }));
    g.add(rbox(w - 0.1, 0.22, d - headT - 0.12, 0.04, fin('linen'), { y: 0.28 + 0.11, z: -headT / 2 - 0.03 }));
    g.add(rbox(w - 0.06, 0.1, d - headT - 0.75, 0.05, fin('linen'), { y: 0.5 + 0.05, z: -headT / 2 - 0.3 })); // duvet
    for (const s of [-1, 1]) g.add(rbox((w - 0.2) / 2 - 0.04, 0.12, 0.45, 0.05, fin('linen'), { x: s * ((w - 0.2) / 4 + 0.02), y: 0.5 + 0.06, z: d / 2 - headT - 0.32 }));
    g.add(rbox(w, headH, headT, 0.01, frame, { y: headH / 2, z: d / 2 - headT / 2, uvTile: tileOf(frame) }));
  },
  nightstand(g, { w, d, h }, c) {
    const mat = surf(c.material || 'walnut');
    g.add(box(w - 0.06, 0.1, d - 0.06, fin('cavity'), { y: 0.05 }));
    g.add(rbox(w, h - 0.1, d, 0.008, mat, { y: 0.1 + (h - 0.1) / 2, uvTile: tileOf(mat) }));
    g.add(box(w - 0.1, 0.004, 0.012, fin('cavity'), { y: h / 2 + 0.05, z: -d / 2 + 0.002 }));
    g.add(box(0.1, 0.01, 0.02, fin('brass'), { y: h / 2 + 0.12, z: -d / 2 + 0.01 }));
  },
  bench(g, { w, d, h }, c) {
    const fab = c.material ? surf(c.material) : fin('fabricDark');
    legs(g, w, d, h - 0.12, 0.05, fin('steel'), 0.03);
    g.add(rbox(w, 0.12, d, 0.04, fab, { y: h - 0.06 }));
  },
  credenza(g, { w, d, h }, c) {
    const mat = surf(c.material || 'walnut');
    legs(g, w - 0.1, d - 0.1, 0.12, 0.05, fin('steel'), 0.03);
    g.add(rbox(w, h - 0.12, d, 0.006, mat, { y: 0.12 + (h - 0.12) / 2, uvTile: tileOf(mat) }));
    const doors = 3;
    for (let i = 1; i < doors; i++) g.add(box(0.005, h - 0.16, 0.012, fin('cavity'), { x: -w / 2 + (i * w) / doors, y: 0.12 + (h - 0.12) / 2, z: -d / 2 + 0.003 }));
  },
  bookshelf_wall(g, { w, d, h }, c) {
    const mat = surf(c.material || 'walnut');
    const t = 0.03, shelves = 5;
    g.add(box(w, h, 0.012, mat, { y: h / 2, z: d / 2 - 0.006, uvTile: tileOf(mat) }));
    for (const s of [-1, 1]) g.add(box(t, h, d, mat, { x: s * (w / 2 - t / 2), y: h / 2, uvTile: tileOf(mat) }));
    const gap = (h - t) / shelves;
    for (let i = 0; i <= shelves; i++) g.add(box(w - 2 * t, t, d, mat, { y: i * gap + t / 2, uvTile: tileOf(mat) }));
    // books: plain cloth volumes, no lettering
    const palette = [0x7a3b2e, 0x3f5d4a, 0x2f3e5c, 0xb59a6a, 0x6b5b7b, 0x8d6e4a, 0x44443f, 0xa0522d];
    for (let i = 0; i < shelves; i++) {
      if (c.rand() < 0.15) continue; // an empty shelf now and then
      let x = -w / 2 + t + 0.03 + c.rand() * 0.2;
      const end = w / 2 - t - 0.03 - c.rand() * 0.5;
      while (x < end) {
        const bw = 0.025 + c.rand() * 0.035, bh = Math.min(gap - t - 0.03, 0.17 + c.rand() * 0.12);
        g.add(box(bw, bh, d - 0.1, bookMat(palette[Math.floor(c.rand() * palette.length)]), { x: x + bw / 2, y: i * gap + t + bh / 2, z: 0.02 }));
        x += bw + 0.004;
        if (c.rand() < 0.08) x += 0.12;
      }
    }
    g.add(cyl(0.05, 0.035, 0.18, fin('ceramic'), { x: w / 2 - t - 0.3, y: shelves * gap - gap + t + 0.09, z: 0 }));
  },
  fireplace_concrete(g, { w, d, h }, c) {
    const mat = surf(c.material || 'board_concrete');
    const H = Math.min(h, c.ceiling - 0.001);
    g.add(box(w, H, d, mat, { y: H / 2, uvTile: tileOf(mat) }));
    g.add(box(w * 0.5, 0.5, d * 0.8, fin('cavity'), { y: 0.35 + 0.25, z: -d / 2 + d * 0.4 - 0.01 }));
    g.add(box(w * 0.5 - 0.1, 0.06, 0.2, fin('ember'), { y: 0.38, z: -d / 2 + 0.15 }));
    g.add(box(w + 0.4, 0.06, d + 0.3, mat, { y: 0.03, uvTile: tileOf(mat) }));
  },
  tub_freestanding(g, { w, d, h }) {
    const outer = cyl(0.5, 0.42, h, fin('ceramic'), { y: h / 2, seg: 48 });
    outer.scale.set(w / 1.0, 1, d / 1.0);
    g.add(outer);
    const inner = cyl(0.46, 0.4, h - 0.1, fin('ceramicInner'), { y: h / 2 + 0.06, seg: 48 });
    inner.scale.set((w - 0.1) / 1.0, 1, (d - 0.1) / 1.0);
    inner.castShadow = false;
    g.add(inner);
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.46, 48), new THREE.MeshStandardMaterial({ color: 0xcfe3ea, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.85 }));
    water.rotation.x = -Math.PI / 2; water.position.y = h - 0.08; water.scale.set((w - 0.1) / 1.0, (d - 0.1) / 1.0, 1);
    g.add(water);
    g.add(cyl(0.012, 0.012, 0.9, fin('chrome'), { x: w / 2 + 0.1, y: 0.45, seg: 12 }));
    const spout = cyl(0.012, 0.012, 0.25, fin('chrome'), { x: w / 2 - 0.02, y: 0.9, seg: 12 });
    spout.rotation.z = Math.PI / 2;
    g.add(spout);
  },
  vanity_double(g, { w, d, h }, c) {
    const mat = surf(c.material || 'walnut');
    const stone = surf('marble_white');
    const cabH = 0.5;
    g.add(rbox(w, cabH, d - 0.04, 0.006, mat, { y: h - 0.04 - cabH / 2, z: 0.02, uvTile: tileOf(mat) }));
    g.add(box(w + 0.02, 0.04, d, stone, { y: h - 0.02, uvTile: tileOf(stone) }));
    g.add(box(0.005, cabH - 0.04, 0.012, fin('cavity'), { y: h - 0.04 - cabH / 2, z: -d / 2 + 0.003 }));
    for (const s of [-1, 1]) {
      const basin = cyl(0.2, 0.17, 0.12, fin('ceramic'), { x: s * w / 4, y: h + 0.06, z: -0.02, seg: 36 });
      basin.scale.set(1.15, 1, 0.9);
      g.add(basin);
      g.add(cyl(0.012, 0.012, 0.22, fin('chrome'), { x: s * w / 4, y: h + 0.11, z: d / 2 - 0.08, seg: 12 }));
    }
    g.add(box(w - 0.2, 0.9, 0.006, fin('mirror'), { y: h + 0.3 + 0.45 + 0.1, z: d / 2 - 0.003 - 0.0, shadow: false }));
  },
  desk(g, { w, d, h }, c) {
    const mat = surf(c.material || 'white_oak');
    g.add(rbox(w, 0.03, d, 0.006, mat, { y: h - 0.015, uvTile: tileOf(mat) }));
    legs(g, w - 0.06, d - 0.06, h - 0.03, 0.03, fin('steel'), 0.03);
    g.add(rbox(0.45, 0.12, d - 0.2, 0.006, mat, { x: w / 2 - 0.3, y: h - 0.03 - 0.06, uvTile: tileOf(mat) }));
  },
  rug(g, { w, d, h }, c) {
    const mat = surf(c.material || 'carpet_wool');
    const m = rbox(w, h, d, 0.006, mat, { y: h / 2, uvTile: tileOf(mat), shadow: false });
    g.add(m);
  },
  plant_tree(g, { w, h }, c) {
    g.add(cyl(0.22, 0.17, 0.4, fin('terracotta'), { y: 0.2 }));
    g.add(cyl(0.2, 0.2, 0.02, fin('soil'), { y: 0.39 }));
    g.add(cyl(0.03, 0.045, 1.0, fin('darkWood'), { y: 0.9, seg: 10 }));
    foliage(g, c.rand, { cards: 22, cy: h - 0.55, rx: w, ry: 0.65, size: 0.55 });
  },
  plant_small(g, { w, h }, c) {
    g.add(cyl(0.12, 0.09, 0.22, fin('ceramic'), { y: 0.11 }));
    g.add(cyl(0.11, 0.11, 0.015, fin('soil'), { y: 0.215 }));
    foliage(g, c.rand, { cards: 10, cy: h - 0.22, rx: w * 0.9, ry: 0.22, size: 0.28 });
  },
  pendant_globe(g, { w }, c) {
    const top = c.ceiling, globeY = Math.max(1.9, top - 0.75);
    g.add(cyl(0.004, 0.004, top - globeY, fin('steel'), { y: (top + globeY) / 2, seg: 6, shadow: false }));
    g.add(cyl(0.06, 0.06, 0.02, fin('steel'), { y: top - 0.01, seg: 16, shadow: false }));
    const globe = new THREE.Mesh(new THREE.SphereGeometry(w / 2, 32, 20), fin('opal'));
    globe.position.y = globeY;
    globe.castShadow = false;
    g.add(globe);
  },
  floor_lamp(g, { w, h }) {
    g.add(cyl(w / 2, w / 2, 0.02, fin('steel'), { y: 0.01 }));
    g.add(cyl(0.012, 0.012, h - 0.34, fin('steel'), { y: (h - 0.34) / 2, seg: 10 }));
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.3, 32, 1, true), fin('shade'));
    shade.position.y = h - 0.15; shade.castShadow = false;
    g.add(shade);
    g.add(cyl(0.03, 0.03, 0.08, fin('opal'), { y: h - 0.2, seg: 12, shadow: false }));
  },
  table_lamp(g, { w, h }) {
    g.add(cyl(0.06, 0.07, 0.2, fin('brass'), { y: 0.1 }));
    g.add(cyl(0.012, 0.012, 0.1, fin('brass'), { y: 0.25, seg: 10 }));
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(w / 2 - 0.03, w / 2, h - 0.28, 28, 1, true), fin('shade'));
    shade.position.y = h - (h - 0.28) / 2; shade.castShadow = false;
    g.add(shade);
    g.add(cyl(0.02, 0.02, 0.06, fin('opal'), { y: h - 0.2, seg: 10, shadow: false }));
  },
};

// Build one placed item. `room` gives the floor elevation and ceiling height; `siblings` lets
// tabletop items find the surface they stand on.
export function buildFurniture(item, { elevation, height, siblings = [] }) {
  const def = CATALOG[item.item];
  if (!def || !BUILD[item.item]) return null;
  const g = new THREE.Group();
  g.name = item.id;
  const seed = [...item.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 11) >>> 0;
  const ctx = { material: item.material || null, ceiling: height, rand: rng(seed) };
  BUILD[item.item](g, def.footprint, ctx);
  let y = elevation;
  if (def.zone === 'tabletop') {
    const under = siblings.filter((s) => s.id !== item.id && CATALOG[s.item] && CATALOG[s.item].zone === 'floor' && s.room === item.room)
      .map((s) => ({ s, box: footprintBox(s.item, s.x, s.z, s.rotation || 0) }))
      .find(({ box }) => item.x >= box.x0 && item.x <= box.x1 && item.z >= box.z0 && item.z <= box.z1);
    if (under) y += CATALOG[under.s.item].footprint.h;
  }
  g.position.set(item.x, y, item.z);
  g.rotation.y = -THREE.MathUtils.degToRad(item.rotation || 0);
  return g;
}

export const FURNITURE_BUILDERS = Object.keys(BUILD);
