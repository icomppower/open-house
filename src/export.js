// export: the finished tour as ONE self-contained HTML file, plus trace.json and report.md.
// The viewer modules and three.js (core + bundled addons) are inlined as JS strings turned into
// blob: module URLs at load time, together with layout, spec, narration, the final enhanced image
// per stop, the call trace and the "How it was made" data built from it.

import { loadResource, finalImageFor } from './harness.js';
import { buildReport, reportMarkdown } from './report.js';

// Modules in dependency order, with the import specifiers exactly as written in their sources.
const MODULES = [
  { key: 'three', path: '../vendor/three.module.js', spec: "'../../vendor/three.module.js'" },
  { key: 'addons', path: '../vendor/three-addons.module.js', spec: "'../../vendor/three-addons.module.js'", own: { "'./three.module.js'": 'three' } },
  { key: 'catalog', path: './viewer/catalog.js', spec: "'./catalog.js'" },
  { key: 'textures', path: './viewer/textures.js', spec: "'./textures.js'" },
  { key: 'furniture', path: './viewer/furniture.js', spec: "'./furniture.js'" },
  { key: 'scenery', path: './viewer/scenery.js', spec: "'./scenery.js'" },
  { key: 'viewer', path: './viewer/viewer.js', spec: null },
];
const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
const ADDONS_CDN = 'https://cdn.jsdelivr.net/gh/icomppower/open-house@v1.1/vendor/three-addons.module.js';

// JSON that is safe to drop inside a <script> element.
const js = (v) => JSON.stringify(v).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function tourData(state) {
  const { layout, spec = null, narration = null } = state.outputs;
  if (!layout) throw new Error('export needs a finished layout step');
  const images = {};
  for (const p of state.inputs.photos) {
    const img = finalImageFor(state, p.id);
    if (img) images[p.id] = img;
  }
  const report = Array.isArray(state.trace) && state.trace.length ? buildReport(state) : null;
  return { layout, spec, narration, images, order: state.inputs.photos.map((p) => p.id), report };
}

// The call trace as a file: every model/image call, including failed attempts.
export function traceJson(state) {
  const trace = Array.isArray(state.trace) ? state.trace : [];
  return { json: JSON.stringify({ runId: state.id || null, createdAt: state.createdAt || null, entries: trace.length, trace }, null, 2), filename: 'trace.json', entries: trace.length };
}

// report.md: built only from the trace and the judge output (src/report.js).
export function reportFiles(state) {
  const report = buildReport(state);
  return { report, markdown: reportMarkdown(report), filename: 'report.md' };
}

export async function buildTourHtml(state, { title = 'Home tour', inlineVendor = true } = {}) {
  const data = tourData(state);
  const sources = {};
  for (const m of MODULES) {
    if (!inlineVendor && (m.key === 'three' || m.key === 'addons')) { sources[m.key] = null; continue; }
    try { sources[m.key] = await loadResource(m.path); } catch (e) {
      if (m.key === 'three' || m.key === 'addons') sources[m.key] = null; else throw e;
    }
  }
  const inlined = sources.three !== null && sources.addons !== null;
  const intro = (data.narration && data.narration.intro) || '';
  const stops = data.layout.cameras.length;
  const trace = traceJson(state);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #1a1816; color: #f4efe6; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 16px; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  .intro { margin: 0 0 14px; opacity: .85; }
  .foot { margin-top: 14px; font-size: 12px; opacity: .55; }
  .foot a { color: inherit; }
  .err { padding: 12px; background: #3a1f1f; border-radius: 8px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(title)}</h1>
  ${intro ? `<p class="intro">${esc(intro)}</p>` : ''}
  <div id="tour"></div>
  <p class="foot">${stops} stops · drag to look · ${trace.entries} traced model calls (<a id="trace-link" download="trace.json" href="#">trace.json</a>) · built with open-house</p>
</div>
<script type="module">
const DATA = ${js(data)};
const TRACE = ${js(trace.json)};
const MODULES = ${js(MODULES.map((m) => ({ key: m.key, spec: m.spec, own: m.own || null })))};
const SRC = {
  three: ${sources.three === null ? 'null' : js(sources.three)},
  addons: ${sources.addons === null ? 'null' : js(sources.addons)},
  catalog: ${js(sources.catalog)},
  textures: ${js(sources.textures)},
  furniture: ${js(sources.furniture)},
  scenery: ${js(sources.scenery)},
  viewer: ${js(sources.viewer)},
};
const blobUrl = (src) => URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
try {
  document.getElementById('trace-link').href = URL.createObjectURL(new Blob([TRACE], { type: 'application/json' }));
  const urls = {};
  if (SRC.three) urls.three = blobUrl(SRC.three); else urls.three = ${js(THREE_CDN)};
  if (!SRC.addons) SRC.addons = await (await fetch(${js(ADDONS_CDN)})).text();
  for (const m of MODULES) {
    if (m.key === 'three') continue;
    let src = SRC[m.key];
    for (const other of MODULES) if (other.spec && other.key !== m.key && src.includes(other.spec)) src = src.split(other.spec).join(JSON.stringify(urls[other.key]));
    if (m.own) for (const [spec, key] of Object.entries(m.own)) src = src.split(spec).join(JSON.stringify(urls[key]));
    urls[m.key] = blobUrl(src);
  }
  const { createViewer } = await import(urls.viewer);
  const viewer = createViewer({ container: document.getElementById('tour'), ...DATA });
  window.__openHouseViewer = viewer;
} catch (e) {
  document.getElementById('tour').innerHTML = '<p class="err">Could not start the tour: ' + String(e && e.message || e).replace(/</g, '&lt;') + '</p>';
}
</script>
</body>
</html>
`;
  const filename = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'tour'}.html`;
  return { html, filename, inlined, bytes: new TextEncoder().encode(html).length, trace: trace.entries };
}

function download(text, filename, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Browser helpers: build and trigger a download.
export async function downloadTour(state, opts = {}) {
  const built = await buildTourHtml(state, opts);
  download(built.html, built.filename, 'text/html');
  return built;
}
export function downloadTrace(state) {
  const t = traceJson(state);
  download(t.json, t.filename, 'application/json');
  return t;
}
export function downloadReport(state) {
  const r = reportFiles(state);
  download(r.markdown, r.filename, 'text/markdown');
  return r;
}
