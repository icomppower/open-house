// Browser end-to-end check of demo/index.html with the mock model, on a phone viewport.
// Not part of `npm test` (needs Playwright + Chromium):
//   PLAYWRIGHT_MODULE=... PLAYWRIGHT_EXECUTABLE=... node tools/e2e-demo.mjs
// Asserts numbers (frames rendered, pixel brightness, stop index, report rows), not screenshots.

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
    await page.selectOption('#pace', '0');
    await page.getByRole('button', { name: 'Use the 6 sample photos' }).click();
    await page.waitForFunction(() => window.__oh && (window.__oh.done || window.__oh.error), null, { timeout: 120000 });
    const err = await page.evaluate(() => window.__oh.error || null);
    check(`${label}: run finished without error`, !err, err || '');

    const steps = await page.$$eval('.step', (els) => els.map((e) => e.className.replace('step', '').trim()));
    check(`${label}: six steps done`, steps.length === 6 && steps.every((s) => s === 'done'), steps.join(','));

    const summary = await page.evaluate(() => window.__oh.state.outputs.judge.summary);
    check(`${label}: judge summary (p4 redone, tour judged)`, summary.redone.join() === 'p4' && summary.tourStops === 6, JSON.stringify(summary));
    const rows = await page.$$eval('.pr', (els) => els.map((e) => ({ id: e.dataset.photo, redo: !!e.querySelector('.badge.redo'), imgs: e.querySelectorAll('img').length })));
    check(`${label}: judge report rows`, rows.length === 6 && rows.find((r) => r.id === 'p4').redo && rows.every((r) => r.imgs === 3), JSON.stringify(rows));
    const narr = await page.$$eval('#narr-lines li', (els) => els.length);
    check(`${label}: narration lines`, narr === 6, String(narr));

    // viewer: rendering real frames, geometry on screen, controls fit the viewport
    await page.waitForTimeout(400);
    const dbg = await page.evaluate(() => window.__oh.viewer.debug());
    check(`${label}: viewer renders`, dbg.frames > 5 && dbg.calls > 50 && dbg.triangles > 500 && dbg.stops === 6, JSON.stringify(dbg));
    const px = await page.evaluate(() => {
      const v = window.__oh.viewer;
      v.renderer.render(v.scene, v.camera); // a WebGL canvas is blank once its frame has been presented; read right after a render
      const src = v.renderer.domElement;
      const c = document.createElement('canvas'); c.width = 64; c.height = 48;
      const g = c.getContext('2d'); g.drawImage(src, 0, 0, 64, 48);
      const d = g.getImageData(0, 0, 64, 48).data;
      let sum = 0; const colours = new Set();
      for (let i = 0; i < d.length; i += 4) { sum += (d[i] + d[i + 1] + d[i + 2]) / 3; colours.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4)); }
      return { mean: sum / (d.length / 4), colours: colours.size };
    });
    check(`${label}: canvas has an image (not black, varied)`, px.mean > 25 && px.mean < 245 && px.colours > 12, JSON.stringify(px));
    const fit = await page.evaluate(() => {
      const bar = document.querySelector('.oh-bar'); const r = bar.getBoundingClientRect();
      const btns = [...bar.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
      return { scrollW: bar.scrollWidth, clientW: bar.clientWidth, docOverflow: document.documentElement.scrollWidth <= innerWidth, minH: Math.min(...btns.map((b) => b.height)), allInside: btns.every((b) => b.left >= r.left - 1 && b.right <= r.right + 1) };
    });
    check(`${label}: controls fit (no horizontal overflow, 44px targets)`, fit.scrollW <= fit.clientW + 1 && fit.docOverflow && fit.minH >= 44 && fit.allInside, JSON.stringify(fit));

    // photoreal toggle: real click, overlay becomes visible with the enhanced image
    await page.getByRole('button', { name: /Toggle the enhanced photo/ }).click();
    await page.waitForTimeout(600);
    const photo = await page.evaluate(() => {
      const v = window.__oh.viewer; const imgs = [...v.el.querySelectorAll('.oh-photo')];
      const on = imgs.find((i) => getComputedStyle(i).opacity === '1');
      return { photoreal: v.photoreal, visible: !!on, src: on ? on.src.slice(0, 22) : null, matches: on ? on.src === window.__oh.state.outputs.enhance.items.p1.attempts[0].image : false };
    });
    check(`${label}: photoreal toggle shows the enhanced p1`, photo.photoreal && photo.visible && photo.matches, JSON.stringify(photo));
    await page.getByRole('button', { name: 'Next stop' }).click();
    await page.waitForTimeout(2000);
    const after = await page.evaluate(() => { const v = window.__oh.viewer; const d = v.debug(); const on = [...v.el.querySelectorAll('.oh-photo')].find((i) => getComputedStyle(i).opacity === '1'); return { ...d, overlayIsP2: on && on.src === window.__oh.state.outputs.enhance.items.p2.attempts[0].image }; });
    const cam2 = await page.evaluate(() => window.__oh.state.outputs.layout.cameras[1].position);
    check(`${label}: next glides to stop 2 (camera at layout camera, overlay crossfaded)`, after.stop === 1 && !after.gliding && Math.abs(after.camera.x - cam2.x) < 0.02 && Math.abs(after.camera.z - cam2.z) < 0.02 && after.overlayIsP2, JSON.stringify({ after, cam2 }));
    await page.getByRole('button', { name: /Toggle the enhanced photo/ }).click();
    await page.getByRole('button', { name: /golden-hour/ }).click();
    const sunMode = await page.evaluate(() => window.__oh.viewer.debug().sun);
    check(`${label}: sun toggle`, sunMode === 'day', sunMode);

    // export: one self-contained HTML
    const exp = await page.evaluate(async () => { const m = await import('../src/export.js'); const b = await m.buildTourHtml(window.__oh.state, { title: 'E2E tour' }); return { bytes: b.bytes, inlined: b.inlined, filename: b.filename, imgs: (b.html.match(/data:image\/jpeg;base64,/g) || []).length }; });
    check(`${label}: export inlines three.js + 6 images`, exp.inlined && exp.bytes > 1_500_000 && exp.imgs >= 6, JSON.stringify(exp));

    // resume from judge via the UI
    await page.evaluate(() => { window.__oh.done = false; });
    await page.selectOption('#resume-step', 'judge');
    await page.getByRole('button', { name: 'Resume from step' }).click();
    await page.waitForFunction(() => window.__oh.done || window.__oh.error, null, { timeout: 120000 });
    const resumed = await page.evaluate(() => ({ archive: window.__oh.state.archive.map((a) => a.step), err: window.__oh.error || null, ingestDone: window.__oh.state.steps.ingest.status }));
    check(`${label}: resume from judge archives judge+narration`, !resumed.err && resumed.archive.join() === 'judge,narrate' && resumed.ingestDone === 'done', JSON.stringify(resumed));

    check(`${label}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    if (viewport.width > 1000) { // keep the judge's tour renders for a human look (out/ is gitignored)
      const shots = await page.evaluate(() => Object.entries(window.__oh.state.outputs.judge.tour.shots).map(([id, s]) => [id, s.image]));
      await fs.mkdir(path.join(ROOT, 'out'), { recursive: true });
      for (const [id, img] of shots) await fs.writeFile(path.join(ROOT, 'out', `tour-${id}.png`), Buffer.from(img.split(',')[1], 'base64'));
    }
    await page.close();
  }

  // the exported file itself runs standalone
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto(`http://localhost:${port}/demo/`);
  await page.selectOption('#pace', '0');
  await page.getByRole('button', { name: 'Use the 6 sample photos' }).click();
  await page.waitForFunction(() => window.__oh && window.__oh.done, null, { timeout: 120000 });
  const html = await page.evaluate(async () => (await (await import('../src/export.js')).buildTourHtml(window.__oh.state, { title: 'Standalone' })).html);
  const outDir = path.join(ROOT, 'out');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'standalone.html'), html);
  const standalone = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const sErrors = [];
  standalone.on('pageerror', (e) => sErrors.push(e.message));
  await standalone.goto(`http://localhost:${port}/out/standalone.html`);
  await standalone.waitForFunction(() => window.__openHouseViewer && window.__openHouseViewer.debug().frames > 3, null, { timeout: 30000 });
  const sdbg = await standalone.evaluate(() => window.__openHouseViewer.debug());
  check('standalone export renders', sdbg.stops === 6 && sdbg.triangles > 500 && sErrors.length === 0, JSON.stringify({ sdbg, sErrors }));
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
