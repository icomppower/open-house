// Browser end-to-end check of demo/index.html with the mock model, on a phone viewport.
// Not part of `npm test` (needs Playwright + Chromium):
//   PLAYWRIGHT_MODULE=... PLAYWRIGHT_EXECUTABLE=... node tools/e2e-demo.mjs
// Asserts numbers (frames rendered, pixel statistics, stop index, report rows, trace counts), not screenshots.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(await resolvePlaywright());
async function resolvePlaywright() {
  const p = process.env.PLAYWRIGHT_MODULE;
  if (!p) return 'playwright';
  if (/^(file|node):/.test(p)) return p;
  const { pathToFileURL } = await import('node:url');
  const stat = await fs.stat(p).catch(() => null);
  return pathToFileURL(stat && stat.isDirectory() ? path.join(p, 'index.mjs') : p).href;
}

const server = createServer();
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

// Luminance statistics of a canvas region (in canvas pixels), shrunk by `inset` on each side.
const regionStats = `(src, r, inset) => {
  const w = Math.round(r.x1 - r.x0), h = Math.round(r.y1 - r.y0);
  const ix = Math.round(w * inset), iy = Math.round(h * inset);
  const c = document.createElement('canvas'); c.width = Math.max(1, w - 2 * ix); c.height = Math.max(1, h - 2 * iy);
  const g = c.getContext('2d'); g.drawImage(src, r.x0 + ix, r.y0 + iy, c.width, c.height, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let sum = 0, sum2 = 0, n = 0; const cols = new Set();
  for (let i = 0; i < d.length; i += 4) { const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; sum += l; sum2 += l * l; n++; cols.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4)); }
  const mean = sum / n; return { mean: +mean.toFixed(1), std: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(1), colours: cols.size, w: c.width, h: c.height };
}`;

async function runDemo(page) {
  await page.selectOption('#pace', '0');
  await page.getByRole('button', { name: 'Use the 6 sample photos' }).click();
  await page.waitForFunction(() => window.__oh && (window.__oh.done || window.__oh.error), null, { timeout: 180000 });
  return page.evaluate(() => window.__oh.error || null);
}

try {
  for (const [label, viewport] of [['phone 390x844', { width: 390, height: 844 }], ['desktop 1280x900', { width: 1280, height: 900 }]]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1, hasTouch: viewport.width < 500 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://localhost:${port}/demo/`);

    // the primary button is really clickable where it is drawn (hit-test, not element.click())
    const hit = await page.evaluate(() => {
      const b = document.getElementById('btn-sample'); const r = b.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { ok: el === b || b.contains(el), inView: r.right <= innerWidth && r.left >= 0 };
    });
    check(`${label}: sample button hit-testable and in view`, hit.ok && hit.inView, JSON.stringify(hit));
    const err = await runDemo(page);
    check(`${label}: run finished without error`, !err, err || '');

    const steps = await page.$$eval('.step', (els) => els.map((e) => e.className.replace('step', '').trim()));
    check(`${label}: six steps done`, steps.length === 6 && steps.every((s) => s === 'done'), steps.join(','));

    const summary = await page.evaluate(() => window.__oh.state.outputs.judge.summary);
    check(`${label}: judge summary (p4 redone, tour judged)`, summary.redone.join() === 'p4' && summary.tourStops === 6, JSON.stringify(summary));
    const rows = await page.$$eval('.pr', (els) => els.map((e) => ({ id: e.dataset.photo, redo: !!e.querySelector('.badge.redo'), imgs: e.querySelectorAll('img').length })));
    check(`${label}: judge report rows`, rows.length === 6 && rows.find((r) => r.id === 'p4').redo && rows.every((r) => r.imgs === 3), JSON.stringify(rows));
    const narr = await page.$$eval('#narr-lines li', (els) => els.length);
    check(`${label}: narration lines`, narr === 6, String(narr));

    // viewer: rendering real frames, furnished geometry on screen, controls fit the viewport
    await page.waitForTimeout(400);
    const dbg = await page.evaluate(() => window.__oh.viewer.debug());
    check(`${label}: viewer renders (furnished, post-processed)`, dbg.frames > 5 && dbg.calls > 200 && dbg.triangles > 50000 && dbg.stops === 6 && dbg.furniture === 27 && dbg.environment === 'bay_view' && dbg.passes >= 6 && dbg.rectLights >= 3, JSON.stringify(dbg));
    const px = await page.evaluate(() => {
      const v = window.__oh.viewer;
      v.renderFrame(); // a WebGL canvas is blank once its frame has been presented; read right after a render
      const src = v.renderer.domElement;
      const c = document.createElement('canvas'); c.width = 64; c.height = 48;
      const g = c.getContext('2d'); g.drawImage(src, 0, 0, 64, 48);
      const d = g.getImageData(0, 0, 64, 48).data;
      let sum = 0; const colours = new Set();
      for (let i = 0; i < d.length; i += 4) { sum += (d[i] + d[i + 1] + d[i + 2]) / 3; colours.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4)); }
      return { mean: sum / (d.length / 4), colours: colours.size };
    });
    check(`${label}: canvas has an image (not black, varied)`, px.mean > 25 && px.mean < 245 && px.colours > 12, JSON.stringify(px));

    // sky / bay through the glass wall at stop 1: the glass region must not be flat
    const glass = await page.evaluate((fnSrc) => {
      const stats = eval(fnSrc);
      const v = window.__oh.viewer;
      v.goTo(0, { instant: true }); v.renderFrame();
      const r = v.openingScreenRect('gw_living');
      if (!r) return { r: null };
      const sky = stats(v.renderer.domElement, r, 0.12);
      const topHalf = stats(v.renderer.domElement, { x0: r.x0, x1: r.x1, y0: r.y0, y1: (r.y0 + r.y1) / 2 }, 0.12);
      return { r: { x0: Math.round(r.x0), y0: Math.round(r.y0), x1: Math.round(r.x1), y1: Math.round(r.y1) }, sky, topHalf, canvas: r.canvas };
    }, regionStats);
    check(`${label}: glass region at stop 1 is not flat (pixel std > 12, > 10 colours, not blown out)`, glass.r && glass.sky.std > 12 && glass.sky.colours > 10 && glass.sky.mean > 20 && glass.sky.mean < 245 && glass.topHalf.mean < 250, JSON.stringify(glass));

    const fit = await page.evaluate(() => {
      const bar = document.querySelector('.oh-bar'); const r = bar.getBoundingClientRect();
      const btns = [...bar.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
      return { buttons: btns.length, scrollW: bar.scrollWidth, clientW: bar.clientWidth, docOverflow: document.documentElement.scrollWidth <= innerWidth, minH: Math.min(...btns.map((b) => b.height)), allInside: btns.every((b) => b.left >= r.left - 1 && b.right <= r.right + 1) };
    });
    check(`${label}: controls fit (no horizontal overflow, 44px targets)`, fit.buttons === 6 && fit.scrollW <= fit.clientW + 1 && fit.docOverflow && fit.minH >= 44 && fit.allInside, JSON.stringify(fit));

    // "How it was made": numbers in the viewer panel and the demo section equal a recount of the trace
    await page.getByRole('button', { name: /How it was made/ }).click();
    const madeCheck = await page.evaluate(() => {
      const st = window.__oh.state; const v = window.__oh.viewer;
      const panel = v.el.querySelector('.oh-made');
      const num = (root, k) => Number(root.querySelector(`[data-oh="${k}"]`).textContent);
      const trace = st.trace;
      const recount = { calls: trace.length, retries: trace.filter((t) => t.attempt > 1).length, failed: trace.filter((t) => t.validator !== 'pass').length, redone: new Set(trace.filter((t) => t.redoOf !== null).map((t) => t.photoId)).size };
      panel.scrollIntoView({ block: 'center' });
      const r = panel.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + 20, r.top + 20);
      return {
        open: panel.classList.contains('open'), hitInsidePanel: panel.contains(hit), recount,
        panel: { calls: num(panel, 'calls'), retries: num(panel, 'retries'), failed: num(panel, 'failed'), redone: num(panel, 'redone') },
        section: { calls: num(document.getElementById('made-summary'), 'calls'), retries: num(document.getElementById('made-summary'), 'retries'), redone: num(document.getElementById('made-summary'), 'redone') },
        md: document.getElementById('report-md').textContent.slice(0, 17),
        rows: panel.querySelectorAll('tbody tr').length,
      };
    });
    const sameNumbers = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);
    check(`${label}: "How it was made" panel shows trace-derived numbers (viewer panel + section)`, madeCheck.open && madeCheck.hitInsidePanel && sameNumbers(madeCheck.panel, madeCheck.recount) && sameNumbers(madeCheck.section, { calls: madeCheck.recount.calls, retries: madeCheck.recount.retries, redone: madeCheck.recount.redone }) && madeCheck.md === '# How it was made' && madeCheck.rows === 5 + 6 && madeCheck.recount.calls === 30, JSON.stringify(madeCheck));
    await page.getByRole('button', { name: /How it was made/ }).click();

    // photoreal toggle: real click, overlay becomes visible with the enhanced image
    await page.getByRole('button', { name: /Toggle the enhanced photo/ }).click();
    await page.waitForTimeout(600);
    const photo = await page.evaluate(() => {
      const v = window.__oh.viewer; const imgs = [...v.el.querySelectorAll('.oh-photo')];
      const on = imgs.find((i) => getComputedStyle(i).opacity === '1');
      return { photoreal: v.photoreal, visible: !!on, src: on ? on.src.slice(0, 22) : null, matches: on ? on.src === window.__oh.state.outputs.enhance.items.p1.attempts[0].image : false, madeClosed: !v.debug().made };
    });
    check(`${label}: photoreal toggle shows the enhanced p1`, photo.photoreal && photo.visible && photo.matches && photo.madeClosed, JSON.stringify(photo));
    await page.getByRole('button', { name: 'Next stop' }).click();
    await page.waitForTimeout(2000);
    const after = await page.evaluate(() => { const v = window.__oh.viewer; const d = v.debug(); const on = [...v.el.querySelectorAll('.oh-photo')].find((i) => getComputedStyle(i).opacity === '1'); return { ...d, overlayIsP2: on && on.src === window.__oh.state.outputs.enhance.items.p2.attempts[0].image }; });
    const cam2 = await page.evaluate(() => window.__oh.state.outputs.layout.cameras[1].position);
    check(`${label}: next glides to stop 2 (camera at layout camera, overlay crossfaded)`, after.stop === 1 && !after.gliding && Math.abs(after.camera.x - cam2.x) < 0.02 && Math.abs(after.camera.z - cam2.z) < 0.02 && after.overlayIsP2, JSON.stringify({ after, cam2 }));
    await page.getByRole('button', { name: /Toggle the enhanced photo/ }).click();
    await page.getByRole('button', { name: /golden-hour/ }).click();
    await page.waitForTimeout(300);
    const sunMode = await page.evaluate(() => window.__oh.viewer.debug().sun);
    check(`${label}: sun toggle`, sunMode === 'day', sunMode);

    // export: one self-contained HTML with the viewer modules, bundled addons, images and the report data
    const exp = await page.evaluate(async () => { const m = await import('../src/export.js'); const b = await m.buildTourHtml(window.__oh.state, { title: 'E2E tour' }); return { bytes: b.bytes, inlined: b.inlined, filename: b.filename, trace: b.trace, imgs: (b.html.match(/data:image\/jpeg;base64,/g) || []).length, addons: b.html.includes('class GTAOPass'), report: b.html.includes('"photosRedone":1') }; });
    check(`${label}: export inlines three.js + addons + 6 images + report`, exp.inlined && exp.bytes > 1_800_000 && exp.imgs >= 6 && exp.addons && exp.report && exp.trace === 30, JSON.stringify(exp));

    // resume from judge via the UI: the trace grows, the report numbers follow
    await page.evaluate(() => { window.__oh.done = false; });
    await page.selectOption('#resume-step', 'judge');
    await page.getByRole('button', { name: 'Resume from step' }).click();
    await page.waitForFunction(() => window.__oh.done || window.__oh.error, null, { timeout: 180000 });
    const resumed = await page.evaluate(() => ({ archive: window.__oh.state.archive.map((a) => a.step), err: window.__oh.error || null, ingestDone: window.__oh.state.steps.ingest.status, trace: window.__oh.state.trace.length, first: window.__oh.state.trace[0].id, madeCalls: Number(document.querySelector('#made-summary [data-oh="calls"]').textContent), panelCalls: Number(window.__oh.viewer.el.querySelector('.oh-made [data-oh="calls"]').textContent) }));
    check(`${label}: resume from judge archives judge+narration and appends to the trace`, !resumed.err && resumed.archive.join() === 'judge,narrate' && resumed.ingestDone === 'done' && resumed.trace === 30 + 16 && resumed.first === 't1' && resumed.madeCalls === 46 && resumed.panelCalls === 46, JSON.stringify(resumed));

    check(`${label}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    if (viewport.width > 1000) { // keep the judge's tour renders for a human look (out/ is gitignored)
      const shots = await page.evaluate(() => Object.entries(window.__oh.state.outputs.judge.tour.shots).map(([id, s]) => [id, s.image]));
      await fs.mkdir(path.join(ROOT, 'out'), { recursive: true });
      for (const [id, img] of shots) await fs.writeFile(path.join(ROOT, 'out', `tour-${id}.png`), Buffer.from(img.split(',')[1], 'base64'));
    }
    await page.close();

    if (viewport.width < 500) { // ?q=low: no GTAO, smaller shadow map, still renders
      const low = await browser.newPage({ viewport, deviceScaleFactor: 1, hasTouch: true });
      const lowErrors = [];
      low.on('pageerror', (e) => lowErrors.push(e.message));
      await low.goto(`http://localhost:${port}/demo/?q=low`);
      const lowErr = await runDemo(low);
      await low.waitForTimeout(300);
      const ld = await low.evaluate(() => window.__oh.viewer.debug());
      check(`${label}: ?q=low disables GTAO and still renders`, !lowErr && ld.quality === 'low' && ld.gtao === false && ld.passes === 6 && ld.frames > 3 && ld.furniture === 27 && lowErrors.length === 0, JSON.stringify({ ld, lowErr, lowErrors }));
      await low.close();
    }
  }

  // the exported file itself runs standalone
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto(`http://localhost:${port}/demo/`);
  await runDemo(page);
  const html = await page.evaluate(async () => (await (await import('../src/export.js')).buildTourHtml(window.__oh.state, { title: 'Standalone' })).html);
  const outDir = path.join(ROOT, 'out');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'standalone.html'), html);
  const standalone = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const sErrors = [];
  standalone.on('pageerror', (e) => sErrors.push(e.message));
  await standalone.goto(`http://localhost:${port}/out/standalone.html`);
  await standalone.waitForFunction(() => window.__openHouseViewer && window.__openHouseViewer.debug().frames > 3, null, { timeout: 60000 });
  await standalone.getByRole('button', { name: /How it was made/ }).click();
  const sdbg = await standalone.evaluate(() => window.__openHouseViewer.debug());
  const sTrace = await standalone.evaluate(() => document.getElementById('trace-link').href.startsWith('blob:'));
  check('standalone export renders furnished with the report panel and a trace.json link', sdbg.stops === 6 && sdbg.triangles > 50000 && sdbg.furniture === 27 && sdbg.made && sdbg.report && sdbg.report.calls === 30 && sTrace && sErrors.length === 0, JSON.stringify({ sdbg, sErrors }));
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
