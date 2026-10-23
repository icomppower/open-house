// Renders the six sample "phone photos" in fixtures/photos/ from tools/fixture-scene.html.
// Needs Playwright with a Chromium build (not a dependency of the harness):
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node tools/render-fixtures.mjs
// or `npx playwright install chromium` and plain `npm run fixtures`.

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
const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'fixtures/manifest.json'), 'utf8'));

const server = createServer();
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

// PLAYWRIGHT_EXECUTABLE lets an already-downloaded Chromium be used when versions differ.
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`http://localhost:${port}/tools/fixture-scene.html`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  const shots = await page.evaluate(() => window.shoot());
  for (const s of shots) {
    const entry = manifest.photos.find((p) => p.id === s.photoId);
    const file = path.join(ROOT, 'fixtures', entry.file);
    await fs.writeFile(file, Buffer.from(s.jpeg.split(',')[1], 'base64'));
    console.log('wrote', entry.file, (await fs.stat(file)).size, 'bytes');
  }
} finally {
  await browser.close();
  server.close();
}
