// export: the finished tour as ONE self-contained HTML file.
// The viewer source and three.js are inlined (as JS strings turned into blob: module URLs at
// load time), together with layout, spec, narration and the final enhanced image per stop.

import { loadResource, finalImageFor } from './harness.js';

const THREE_IMPORT = "'../../vendor/three.module.js'";
const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

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
  return { layout, spec, narration, images, order: state.inputs.photos.map((p) => p.id) };
}

export async function buildTourHtml(state, { title = 'Home tour', inlineVendor = true } = {}) {
  const data = tourData(state);
  const viewerSrc = await loadResource('./viewer/viewer.js');
  let threeSrc = null;
  if (inlineVendor) {
    try { threeSrc = await loadResource('../vendor/three.module.js'); } catch { threeSrc = null; }
  }
  const intro = (data.narration && data.narration.intro) || '';
  const stops = data.layout.cameras.length;
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
  .err { padding: 12px; background: #3a1f1f; border-radius: 8px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(title)}</h1>
  ${intro ? `<p class="intro">${esc(intro)}</p>` : ''}
  <div id="tour"></div>
  <p class="foot">${stops} stops · drag to look · built with open-house</p>
</div>
<script type="module">
const DATA = ${js(data)};
const VIEWER_SRC = ${js(viewerSrc)};
const THREE_SRC = ${threeSrc === null ? 'null' : js(threeSrc)};
try {
  const threeUrl = THREE_SRC ? URL.createObjectURL(new Blob([THREE_SRC], { type: 'text/javascript' })) : ${js(THREE_CDN)};
  const viewerUrl = URL.createObjectURL(new Blob([VIEWER_SRC.replace(${js(THREE_IMPORT)}, JSON.stringify(threeUrl))], { type: 'text/javascript' }));
  const { createViewer } = await import(viewerUrl);
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
  return { html, filename, inlined: threeSrc !== null, bytes: new TextEncoder().encode(html).length };
}

// Browser helper: build and trigger a download.
export async function downloadTour(state, opts = {}) {
  const built = await buildTourHtml(state, opts);
  const blob = new Blob([built.html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = built.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return built;
}
