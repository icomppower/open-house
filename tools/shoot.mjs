// Development helper: render the sample house through the viewer and save PNGs to out/
// without touching fixtures/. Same Playwright setup as render-fixtures.mjs.
//   node tools/shoot.mjs [sun=day|golden] [q=high|low]

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')));
const sun = args.sun || 'golden';
async function resolvePlaywright() {
  const p = process.env.PLAYWRIGHT_MODULE;
  if (!p) return 'playwright';
  if (/^(file|node):/.test(p)) return p;
  const stat = await fs.stat(p).catch(() => null);
  return pathToFileURL(stat && stat.isDirectory() ? path.join(p, 'index.mjs') : p).href;
}
const { chromium } = await import(await resolvePlaywright());
const server = createServer();
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error('console:', m.text()); });
  await page.goto(`http://localhost:${port}/tools/fixture-scene.html?sun=${sun}${args.q ? `&q=${args.q}` : ''}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const t0 = Date.now();
  const shots = await page.evaluate(() => window.shoot({ grade: false }));
  console.log('rendered', shots.length, 'stops in', Date.now() - t0, 'ms');
  const dbg = await page.evaluate(() => window.__viewer.debug());
  console.log(JSON.stringify(dbg));
  await fs.mkdir(path.join(ROOT, 'out'), { recursive: true });
  for (const s of shots) {
    const file = path.join(ROOT, 'out', `shoot-${sun}-${s.photoId}.jpg`);
    await fs.writeFile(file, Buffer.from(s.jpeg.split(',')[1], 'base64'));
  }
  console.log('wrote out/shoot-*.jpg');
} finally {
  await browser.close();
  server.close();
}
