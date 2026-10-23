// Procedural PBR materials for the catalog keys. Everything is painted on canvases at load time:
// an albedo map, a roughness map, a height map (turned into a normal map) and, for terrazzo, a
// metalness map for the brass strips. One shared material per key; geometry gets world-space UVs
// (see fitUV) so a 1.2 m panel is 1.2 m on every wall.

import * as THREE from '../../vendor/three.module.js';
import { materials as CATALOG } from './catalog.js';

const SIZE = 512;

// Deterministic noise so the demo looks the same every run.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function canvas(size = SIZE) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}
const ctx2d = (c) => c.getContext('2d');
const rgb = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`;
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

function fill(c, colour) { const g = ctx2d(c); g.fillStyle = colour; g.fillRect(0, 0, c.width, c.height); }

// Fine grain: many thin translucent strokes along one axis.
function grain(c, rand, { vertical = true, count = 1400, alpha = 0.08, dark = [0, 0, 0], light = [255, 255, 255] } = {}) {
  const g = ctx2d(c);
  const n = c.width;
  for (let i = 0; i < count; i++) {
    const t = rand();
    const col = t < 0.5 ? dark : light;
    g.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${alpha * (0.4 + rand())})`;
    g.lineWidth = 0.6 + rand() * 1.6;
    const a = rand() * n, b0 = rand() * n, len = n * (0.15 + rand() * 0.6);
    g.beginPath();
    if (vertical) { g.moveTo(a, b0); g.bezierCurveTo(a + (rand() - 0.5) * 6, b0 + len / 3, a + (rand() - 0.5) * 6, b0 + (2 * len) / 3, a + (rand() - 0.5) * 4, b0 + len); }
    else { g.moveTo(b0, a); g.bezierCurveTo(b0 + len / 3, a + (rand() - 0.5) * 6, b0 + (2 * len) / 3, a + (rand() - 0.5) * 6, b0 + len, a + (rand() - 0.5) * 4); }
    g.stroke();
  }
}

function speckle(c, rand, { count = 4000, alpha = 0.06, size = 1.5 } = {}) {
  const g = ctx2d(c);
  for (let i = 0; i < count; i++) {
    const v = rand() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${alpha * rand()})`;
    g.fillRect(rand() * c.width, rand() * c.height, size * (0.5 + rand()), size * (0.5 + rand()));
  }
}

// Soft low-frequency mottling (trowel marks, stone clouds).
function clouds(c, rand, { count = 60, alpha = 0.05, radius = 120, colours = [[0, 0, 0], [255, 255, 255]] } = {}) {
  const g = ctx2d(c);
  for (let i = 0; i < count; i++) {
    const col = colours[Math.floor(rand() * colours.length)];
    const r = radius * (0.4 + rand());
    const x = rand() * c.width, y = rand() * c.height;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${alpha * rand()})`);
    grad.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

// Marble veins: wandering polylines with varying width and a soft halo.
function veins(c, rand, { count = 7, colour = [120, 110, 130], width = 2.4, alpha = 0.55, halo = 0.12 } = {}) {
  const g = ctx2d(c);
  const n = c.width;
  for (let i = 0; i < count; i++) {
    let x = rand() * n, y = rand() < 0.5 ? 0 : rand() * n;
    let ang = rand() * Math.PI * 2;
    const pts = [[x, y]];
    for (let k = 0; k < 90; k++) {
      ang += (rand() - 0.5) * 0.9;
      x += Math.cos(ang) * 8; y += Math.sin(ang) * 8;
      pts.push([x, y]);
      if (x < -20 || x > n + 20 || y < -20 || y > n + 20) break;
    }
    for (const [w, a] of [[width * 5, halo], [width * 2, alpha * 0.5], [width * (0.5 + rand()), alpha]]) {
      g.strokeStyle = `rgba(${colour[0]},${colour[1]},${colour[2]},${a})`;
      g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath();
      pts.forEach(([px, py], j) => (j ? g.lineTo(px, py) : g.moveTo(px, py)));
      g.stroke();
    }
    // thin branches
    for (let b = 0; b < 3; b++) {
      const [bx, by] = pts[Math.floor(rand() * pts.length)];
      g.strokeStyle = `rgba(${colour[0]},${colour[1]},${colour[2]},${alpha * 0.6})`;
      g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(bx, by);
      let a2 = rand() * Math.PI * 2, px = bx, py = by;
      for (let k = 0; k < 25; k++) { a2 += (rand() - 0.5) * 1.2; px += Math.cos(a2) * 5; py += Math.sin(a2) * 5; g.lineTo(px, py); }
      g.stroke();
    }
  }
}

// Each painter fills { albedo, height, rough, metal? } canvases. Height: white = high.
const PAINTERS = {
  walnut(a, h, r, rand) {
    fill(a, rgb(74, 48, 32)); fill(h, '#9a9a9a'); fill(r, '#737373');
    grain(a, rand, { vertical: true, count: 2200, alpha: 0.12, dark: [30, 16, 10], light: [140, 95, 60] });
    clouds(a, rand, { count: 30, alpha: 0.12, radius: 140, colours: [[20, 10, 6], [120, 80, 50]] });
    // panels with shadow reveals: 2 x 2 per tile
    const g = ctx2d(a), gh = ctx2d(h), gr = ctx2d(r);
    const reveal = 7;
    for (const p of [0, SIZE / 2]) {
      g.fillStyle = 'rgba(10,6,4,0.95)'; g.fillRect(p - reveal / 2, 0, reveal, SIZE); g.fillRect(0, p - reveal / 2, SIZE, reveal);
      gh.fillStyle = '#000'; gh.fillRect(p - reveal / 2, 0, reveal, SIZE); gh.fillRect(0, p - reveal / 2, SIZE, reveal);
      gr.fillStyle = '#e0e0e0'; gr.fillRect(p - reveal / 2, 0, reveal, SIZE); gr.fillRect(0, p - reveal / 2, SIZE, reveal);
    }
    // repeat at the tile edge so the grid is seamless
    g.fillStyle = 'rgba(10,6,4,0.95)'; g.fillRect(SIZE - reveal / 2, 0, reveal / 2, SIZE); g.fillRect(0, SIZE - reveal / 2, SIZE, reveal / 2);
    gh.fillStyle = '#000'; gh.fillRect(SIZE - reveal / 2, 0, reveal / 2, SIZE); gh.fillRect(0, SIZE - reveal / 2, SIZE, reveal / 2);
    grain(r, rand, { vertical: true, count: 800, alpha: 0.12 });
  },
  white_oak(a, h, r, rand) {
    fill(a, rgb(192, 160, 118)); fill(h, '#a0a0a0'); fill(r, '#9c9c9c');
    const g = ctx2d(a), gh = ctx2d(h);
    const planks = 13; // 2 m tile / ~0.15 m planks
    const pw = SIZE / planks;
    for (let i = 0; i < planks; i++) {
      const tone = 0.88 + rand() * 0.22;
      g.fillStyle = rgb(192 * tone, 160 * tone, 118 * tone);
      g.fillRect(i * pw, 0, pw, SIZE);
      // staggered end joints
      let y = -rand() * SIZE;
      while (y < SIZE) {
        const len = SIZE * (0.35 + rand() * 0.5);
        g.fillStyle = 'rgba(60,40,25,0.6)'; g.fillRect(i * pw, y + len, pw, 1.5);
        gh.fillStyle = '#404040'; gh.fillRect(i * pw, y + len, pw, 1.5);
        y += len;
      }
      g.fillStyle = 'rgba(60,40,25,0.7)'; g.fillRect(i * pw - 1, 0, 2, SIZE);
      gh.fillStyle = '#303030'; gh.fillRect(i * pw - 1, 0, 2, SIZE);
    }
    grain(a, rand, { vertical: true, count: 2600, alpha: 0.09, dark: [120, 90, 55], light: [240, 225, 195] });
    grain(r, rand, { vertical: true, count: 900, alpha: 0.1 });
  },
  terrazzo(a, h, r, rand, m) {
    fill(a, rgb(196, 190, 180)); fill(h, '#8a8a8a'); fill(r, '#4a4a4a'); fill(m, '#000');
    const g = ctx2d(a);
    const chips = [[245, 242, 236], [225, 215, 200], [120, 118, 115], [60, 58, 56], [170, 110, 80], [200, 185, 160], [95, 100, 110]];
    for (let i = 0; i < 1500; i++) {
      const c = chips[Math.floor(rand() * chips.length)];
      g.fillStyle = rgb(c[0], c[1], c[2]);
      g.beginPath();
      const x = rand() * SIZE, y = rand() * SIZE, rx = 2 + rand() * 7, ry = 2 + rand() * 6;
      g.save(); g.translate(x, y); g.rotate(rand() * Math.PI);
      g.moveTo(rx, 0);
      for (let k = 1; k < 6; k++) { const t = (k / 6) * Math.PI * 2; g.lineTo(Math.cos(t) * rx * (0.8 + rand() * 0.4), Math.sin(t) * ry * (0.8 + rand() * 0.4)); }
      g.closePath(); g.fill(); g.restore();
    }
    speckle(a, rand, { count: 3000, alpha: 0.05, size: 1 });
    // brass divider strips: 2 x 2 per tile (0.9 m fields)
    const gm = ctx2d(m), gh = ctx2d(h), gr = ctx2d(r);
    for (const p of [0, SIZE / 2]) {
      g.fillStyle = rgb(186, 150, 90); g.fillRect(p - 1.5, 0, 3, SIZE); g.fillRect(0, p - 1.5, SIZE, 3);
      gm.fillStyle = '#fff'; gm.fillRect(p - 1.5, 0, 3, SIZE); gm.fillRect(0, p - 1.5, SIZE, 3);
      gh.fillStyle = '#b0b0b0'; gh.fillRect(p - 1.5, 0, 3, SIZE); gh.fillRect(0, p - 1.5, SIZE, 3);
      gr.fillStyle = '#303030'; gr.fillRect(p - 1.5, 0, 3, SIZE); gr.fillRect(0, p - 1.5, SIZE, 3);
    }
    g.fillStyle = rgb(186, 150, 90); g.fillRect(SIZE - 1.5, 0, 1.5, SIZE); g.fillRect(0, SIZE - 1.5, SIZE, 1.5);
    gm.fillStyle = '#fff'; gm.fillRect(SIZE - 1.5, 0, 1.5, SIZE); gm.fillRect(0, SIZE - 1.5, SIZE, 1.5);
  },
  board_concrete(a, h, r, rand) {
    fill(a, rgb(168, 165, 158)); fill(h, '#909090'); fill(r, '#d0d0d0');
    const g = ctx2d(a), gh = ctx2d(h);
    const boards = 12; // 2.4 m tile / 0.2 m boards
    const bh = SIZE / boards;
    for (let i = 0; i < boards; i++) {
      const tone = 0.92 + rand() * 0.16;
      g.fillStyle = rgb(168 * tone, 165 * tone, 158 * tone);
      g.fillRect(0, i * bh, SIZE, bh);
      g.fillStyle = 'rgba(40,40,38,0.55)'; g.fillRect(0, i * bh, SIZE, 1.5);
      gh.fillStyle = rand() < 0.5 ? '#7a7a7a' : '#a0a0a0'; gh.fillRect(0, i * bh + 1.5, SIZE, bh - 1.5);
      gh.fillStyle = '#404040'; gh.fillRect(0, i * bh, SIZE, 1.5);
    }
    grain(a, rand, { vertical: false, count: 1800, alpha: 0.07, dark: [90, 88, 84], light: [220, 218, 212] });
    clouds(a, rand, { count: 40, alpha: 0.08, radius: 110, colours: [[60, 60, 58], [230, 228, 222]] });
    // tie holes: 2 columns x 2 rows per tile
    for (const x of [SIZE * 0.25, SIZE * 0.75]) for (const y of [SIZE * 0.25, SIZE * 0.75]) {
      g.fillStyle = rgb(70, 68, 64); g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill();
      gh.fillStyle = '#000'; gh.beginPath(); gh.arc(x, y, 7, 0, Math.PI * 2); gh.fill();
    }
    speckle(a, rand, { count: 5000, alpha: 0.05, size: 1.2 });
  },
  marble_viola(a, h, r, rand) {
    fill(a, rgb(236, 232, 230)); fill(h, '#a0a0a0'); fill(r, '#2e2e2e');
    clouds(a, rand, { count: 50, alpha: 0.12, radius: 160, colours: [[170, 150, 170], [255, 255, 255], [120, 100, 130]] });
    veins(a, rand, { count: 9, colour: [92, 72, 104], width: 3, alpha: 0.7 });
    veins(a, rand, { count: 5, colour: [140, 120, 130], width: 1.4, alpha: 0.5 });
    clouds(r, rand, { count: 30, alpha: 0.15, radius: 150 });
  },
  marble_white(a, h, r, rand) {
    fill(a, rgb(240, 239, 236)); fill(h, '#a0a0a0'); fill(r, '#303030');
    clouds(a, rand, { count: 40, alpha: 0.1, radius: 170, colours: [[200, 200, 205], [255, 255, 255]] });
    veins(a, rand, { count: 6, colour: [150, 152, 158], width: 1.6, alpha: 0.5, halo: 0.08 });
    clouds(r, rand, { count: 30, alpha: 0.15, radius: 150 });
  },
  plaster(a, h, r, rand) {
    fill(a, rgb(238, 232, 222)); fill(h, '#a0a0a0'); fill(r, '#ececec');
    clouds(a, rand, { count: 80, alpha: 0.05, radius: 130, colours: [[200, 190, 175], [255, 255, 255]] });
    clouds(h, rand, { count: 80, alpha: 0.12, radius: 120 });
    speckle(a, rand, { count: 6000, alpha: 0.03, size: 1 });
    speckle(h, rand, { count: 6000, alpha: 0.1, size: 1 });
  },
  limestone(a, h, r, rand) {
    fill(a, rgb(214, 200, 176)); fill(h, '#a0a0a0'); fill(r, '#b4b4b4');
    const g = ctx2d(a), gh = ctx2d(h);
    const cols = 2, rows = 3; // 1.2 m tile -> 0.6 x 0.4 m slabs
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const tone = 0.93 + rand() * 0.14;
      g.fillStyle = rgb(214 * tone, 200 * tone, 176 * tone);
      g.fillRect((i * SIZE) / cols, (j * SIZE) / rows, SIZE / cols, SIZE / rows);
    }
    speckle(a, rand, { count: 9000, alpha: 0.07, size: 1.3 });
    clouds(a, rand, { count: 40, alpha: 0.08, radius: 100, colours: [[160, 140, 110], [245, 240, 225]] });
    for (let i = 0; i <= cols; i++) { g.fillStyle = 'rgba(90,80,65,0.5)'; g.fillRect((i * SIZE) / cols - 1, 0, 2, SIZE); gh.fillStyle = '#404040'; gh.fillRect((i * SIZE) / cols - 1, 0, 2, SIZE); }
    for (let j = 0; j <= rows; j++) { g.fillStyle = 'rgba(90,80,65,0.5)'; g.fillRect(0, (j * SIZE) / rows - 1, SIZE, 2); gh.fillStyle = '#404040'; gh.fillRect(0, (j * SIZE) / rows - 1, SIZE, 2); }
  },
  redwood_deck(a, h, r, rand) {
    fill(a, rgb(150, 82, 56)); fill(h, '#a0a0a0'); fill(r, '#a8a8a8');
    const g = ctx2d(a), gh = ctx2d(h);
    const boards = 10; // 1.5 m tile / 0.15 m boards
    const bw = SIZE / boards, gap = 3;
    for (let i = 0; i < boards; i++) {
      const tone = 0.85 + rand() * 0.3;
      g.fillStyle = rgb(150 * tone, 82 * tone, 56 * tone);
      g.fillRect(i * bw, 0, bw - gap, SIZE);
      g.fillStyle = rgb(25, 18, 14); g.fillRect(i * bw + bw - gap, 0, gap, SIZE);
      gh.fillStyle = '#000'; gh.fillRect(i * bw + bw - gap, 0, gap, SIZE);
    }
    grain(a, rand, { vertical: true, count: 2400, alpha: 0.12, dark: [70, 35, 22], light: [210, 140, 100] });
  },
  tile_white(a, h, r, rand) {
    fill(a, rgb(214, 212, 206)); fill(h, '#404040'); fill(r, '#e6e6e6');
    const g = ctx2d(a), gh = ctx2d(h), gr = ctx2d(r);
    const n = 4, grout = 3; // 0.6 m tile -> 0.15 m tiles
    const t = SIZE / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const tone = 0.97 + rand() * 0.04;
      g.fillStyle = rgb(246 * tone, 245 * tone, 240 * tone);
      g.fillRect(i * t + grout / 2, j * t + grout / 2, t - grout, t - grout);
      gh.fillStyle = '#b0b0b0'; gh.fillRect(i * t + grout / 2, j * t + grout / 2, t - grout, t - grout);
      gr.fillStyle = '#262626'; gr.fillRect(i * t + grout / 2, j * t + grout / 2, t - grout, t - grout);
    }
    clouds(a, rand, { count: 20, alpha: 0.03, radius: 150 });
  },
  carpet_wool(a, h, r, rand) {
    fill(a, rgb(196, 184, 166)); fill(h, '#a0a0a0'); fill(r, '#ffffff');
    speckle(a, rand, { count: 26000, alpha: 0.1, size: 1.2 });
    speckle(h, rand, { count: 26000, alpha: 0.25, size: 1.3 });
    clouds(a, rand, { count: 30, alpha: 0.04, radius: 150, colours: [[150, 140, 125], [230, 225, 215]] });
  },
  painted_brick(a, h, r, rand) {
    fill(a, rgb(222, 214, 202)); fill(h, '#404040'); fill(r, '#cccccc');
    const g = ctx2d(a), gh = ctx2d(h);
    const cols = 6, rows = 18; // 1.2 m tile -> 0.2 x 0.067 m bricks
    const bw = SIZE / cols, bh = SIZE / rows, mortar = 3;
    for (let j = 0; j < rows; j++) {
      const off = j % 2 ? bw / 2 : 0;
      for (let i = -1; i < cols; i++) {
        const tone = 0.93 + rand() * 0.1;
        g.fillStyle = rgb(236 * tone, 229 * tone, 218 * tone);
        g.fillRect(i * bw + off + mortar / 2, j * bh + mortar / 2, bw - mortar, bh - mortar);
        gh.fillStyle = `rgb(${150 + rand() * 40},${150 + rand() * 40},${150 + rand() * 40})`;
        gh.fillRect(i * bw + off + mortar / 2, j * bh + mortar / 2, bw - mortar, bh - mortar);
      }
    }
    speckle(a, rand, { count: 5000, alpha: 0.04, size: 1 });
  },
  cladding_dark(a, h, r, rand) {
    fill(a, rgb(32, 30, 29)); fill(h, '#a0a0a0'); fill(r, '#8a8a8a');
    const g = ctx2d(a), gh = ctx2d(h), gr = ctx2d(r);
    const boards = 12; // 1.2 m tile / 0.1 m boards
    const bw = SIZE / boards, gap = 3;
    for (let i = 0; i < boards; i++) {
      const tone = 0.8 + rand() * 0.5;
      g.fillStyle = rgb(32 * tone, 30 * tone, 29 * tone);
      g.fillRect(i * bw, 0, bw - gap, SIZE);
      g.fillStyle = rgb(8, 8, 8); g.fillRect(i * bw + bw - gap, 0, gap, SIZE);
      gh.fillStyle = '#000'; gh.fillRect(i * bw + bw - gap, 0, gap, SIZE);
      gr.fillStyle = `rgb(${110 + rand() * 60},${110 + rand() * 60},${110 + rand() * 60})`; gr.fillRect(i * bw, 0, bw - gap, SIZE);
    }
    grain(a, rand, { vertical: true, count: 2000, alpha: 0.1, dark: [0, 0, 0], light: [90, 80, 70] });
    grain(r, rand, { vertical: true, count: 1000, alpha: 0.15 });
  },
};

// Height canvas -> tangent-space normal map (Sobel), tiling across the edges.
function normalFromHeight(hc, strength = 2.0) {
  const n = hc.width;
  const data = ctx2d(hc).getImageData(0, 0, n, n).data;
  const hAt = (x, y) => data[(((y + n) % n) * n + ((x + n) % n)) * 4] / 255;
  const out = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (hAt(x + 1, y - 1) + 2 * hAt(x + 1, y) + hAt(x + 1, y + 1)) - (hAt(x - 1, y - 1) + 2 * hAt(x - 1, y) + hAt(x - 1, y + 1));
    const dy = (hAt(x - 1, y + 1) + 2 * hAt(x, y + 1) + hAt(x + 1, y + 1)) - (hAt(x - 1, y - 1) + 2 * hAt(x, y - 1) + hAt(x + 1, y - 1));
    const v = new THREE.Vector3(-dx * strength, -dy * strength, 1).normalize();
    const i = (y * n + x) * 4;
    out[i] = (v.x * 0.5 + 0.5) * 255; out[i + 1] = (v.y * 0.5 + 0.5) * 255; out[i + 2] = (v.z * 0.5 + 0.5) * 255; out[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(out, n, n, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

function wrapTex(tex, srgb = false, anisotropy = 8) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const cache = new Map();

// The material for a catalog key. `variant` lets a floor and a wall share maps but differ in finish.
export function catalogMaterial(key, { anisotropy = 8 } = {}) {
  if (!CATALOG[key]) throw new Error(`unknown catalog material "${key}"`);
  if (cache.has(key)) return cache.get(key);
  const seed = [...key].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
  const rand = rng(seed);
  const a = canvas(), h = canvas(), r = canvas();
  const needsMetal = key === 'terrazzo';
  const m = needsMetal ? canvas() : null;
  PAINTERS[key](a, h, r, rand, m);
  const normalStrength = { plaster: 0.6, carpet_wool: 0.8, marble_viola: 0.3, marble_white: 0.3, tile_white: 1.2, walnut: 1.6, terrazzo: 0.8 }[key] ?? 1.4;
  const mat = new THREE.MeshStandardMaterial({
    map: wrapTex(new THREE.CanvasTexture(a), true, anisotropy),
    roughnessMap: wrapTex(new THREE.CanvasTexture(r), false, anisotropy),
    roughness: 1,
    normalMap: wrapTex(normalFromHeight(h, normalStrength), false, anisotropy),
    normalScale: new THREE.Vector2(1, 1),
    metalness: needsMetal ? 1 : 0,
    metalnessMap: needsMetal ? wrapTex(new THREE.CanvasTexture(m), false, anisotropy) : null,
    envMapIntensity: ({ marble_viola: 1.0, marble_white: 1.0, tile_white: 0.9, terrazzo: 0.7 })[key] ?? 0.35,
  });
  mat.userData.catalogKey = key;
  mat.userData.tile = CATALOG[key].tile;
  cache.set(key, mat);
  return mat;
}

// Give a box-like geometry world-space UVs: every face is mapped from its own two axes in metres,
// divided by the material's tile size, offset by the mesh position so neighbouring pieces line up.
export function fitUV(geometry, tile, offset = { x: 0, y: 0, z: 0 }) {
  const pos = geometry.attributes.position, nor = geometry.attributes.normal, uv = geometry.attributes.uv;
  if (!pos || !nor || !uv) return geometry;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    const x = pos.getX(i) + offset.x, y = pos.getY(i) + offset.y, z = pos.getZ(i) + offset.z;
    if (nx >= ny && nx >= nz) uv.setXY(i, z / tile, y / tile);
    else if (ny >= nx && ny >= nz) uv.setXY(i, x / tile, z / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  uv.needsUpdate = true;
  return geometry;
}

// Leaf-cluster alpha texture for foliage cards (trees, hedges, indoor plants).
let leafTex = null;
export function leafTexture() {
  if (leafTex) return leafTex;
  const c = canvas(256);
  const g = ctx2d(c);
  g.clearRect(0, 0, 256, 256);
  const rand = rng(1234);
  const greens = [[52, 92, 40], [70, 118, 48], [96, 140, 60], [40, 76, 34], [120, 150, 70]];
  for (let i = 0; i < 160; i++) {
    const x = 128 + (rand() - 0.5) * 220, y = 128 + (rand() - 0.5) * 220;
    if (Math.hypot(x - 128, y - 128) > 118) continue;
    const col = greens[Math.floor(rand() * greens.length)];
    g.fillStyle = rgb(col[0] * (0.85 + rand() * 0.3), col[1] * (0.85 + rand() * 0.3), col[2] * (0.85 + rand() * 0.3));
    g.save(); g.translate(x, y); g.rotate(rand() * Math.PI);
    g.beginPath(); g.ellipse(0, 0, 9 + rand() * 9, 4 + rand() * 4, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  leafTex = new THREE.CanvasTexture(c);
  leafTex.colorSpace = THREE.SRGBColorSpace;
  leafTex.anisotropy = 4;
  return leafTex;
}

export function leafMaterial() {
  return new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, metalness: 0, envMapIntensity: 0.3 });
}

// Window-grid texture for distant towers (city_view): lit and unlit panes, no text.
export function towerTexture() {
  const c = canvas(128);
  const g = ctx2d(c);
  const rand = rng(99);
  g.fillStyle = '#3a4250'; g.fillRect(0, 0, 128, 128);
  for (let j = 0; j < 16; j++) for (let i = 0; i < 8; i++) {
    const lit = rand() < 0.25;
    g.fillStyle = lit ? `rgb(${230 + rand() * 25},${200 + rand() * 30},${150 + rand() * 40})` : `rgb(${70 + rand() * 30},${85 + rand() * 30},${105 + rand() * 30})`;
    g.fillRect(i * 16 + 3, j * 8 + 2, 10, 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
