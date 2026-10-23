// Builds vendor/three-addons.module.js: the three.js 0.170 example addons the viewer uses
// (Sky, EffectComposer + passes, GTAO, bloom, FXAA, RectAreaLight uniforms, RoundedBoxGeometry)
// concatenated into ONE ES module that imports from ./three.module.js. One file keeps the
// viewer loadable from any origin with no import map, and lets export.js inline it.
//
//   node tools/bundle-addons.mjs          (downloads from jsdelivr, writes vendor/three-addons.module.js)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '0.170.0';
const FILES = [
  'math/SimplexNoise.js',
  'lights/RectAreaLightTexturesLib.js',
  'lights/RectAreaLightUniformsLib.js',
  'objects/Sky.js',
  'geometries/RoundedBoxGeometry.js',
  'shaders/CopyShader.js',
  'shaders/FXAAShader.js',
  'shaders/LuminosityHighPassShader.js',
  'shaders/OutputShader.js',
  'shaders/GTAOShader.js',
  'shaders/PoissonDenoiseShader.js',
  'postprocessing/Pass.js',
  'postprocessing/MaskPass.js',
  'postprocessing/ShaderPass.js',
  'postprocessing/RenderPass.js',
  'postprocessing/EffectComposer.js',
  'postprocessing/OutputPass.js',
  'postprocessing/UnrealBloomPass.js',
  'postprocessing/GTAOPass.js',
];

const threeNames = new Set();
const topLevel = new Map(); // identifier -> file (collision check)
const parts = [];
for (const rel of FILES) {
  const url = `https://cdn.jsdelivr.net/npm/three@${VERSION}/examples/jsm/${rel}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  let src = await res.text();
  src = src.replace(/import\s*\{([^}]*)\}\s*from\s*'([^']+)';?/g, (m, names, from) => {
    if (from === 'three') { for (const n of names.split(',').map((s) => s.trim()).filter(Boolean)) threeNames.add(n); return ''; }
    if (/^\.\.?\//.test(from)) return ''; // sibling addon: same scope in the bundle
    throw new Error(`${rel}: unexpected import from ${from}`);
  });
  for (const m of src.matchAll(/^(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    const id = m[1];
    if (topLevel.has(id)) throw new Error(`top-level identifier "${id}" is defined in both ${topLevel.get(id)} and ${rel}`);
    topLevel.set(id, rel);
  }
  parts.push(`// ---- ${rel}\n${src.trim()}\n`);
}

const header = `// three.js ${VERSION} example addons, bundled by tools/bundle-addons.mjs for open-house.
// Source: https://github.com/mrdoob/three.js (MIT License, Copyright © 2010-2024 three.js authors).
// Files: ${FILES.join(', ')}
import {
\t${[...threeNames].sort().join(',\n\t')}
} from './three.module.js';

`;
const out = header + parts.join('\n');
const file = path.join(ROOT, 'vendor', 'three-addons.module.js');
await fs.writeFile(file, out);
console.log(`wrote ${path.relative(ROOT, file)} (${out.length} bytes, ${FILES.length} files, ${threeNames.size} three imports)`);
