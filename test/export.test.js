import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHarness, finalImageFor } from '../src/harness.js';
import { buildTourHtml, tourData } from '../src/export.js';
import { samplePhotos, createMockCallers, fakeCaptureStops } from './helpers.js';

test('export builds one self-contained HTML file with layout, images, viewer and three.js inlined', async () => {
  const photos = await samplePhotos();
  const state = await runHarness({ photos, ...createMockCallers(), captureStops: fakeCaptureStops });
  const built = await buildTourHtml(state, { title: 'Sample Home Tour' });
  assert.equal(built.filename, 'sample-home-tour.html');
  assert.equal(built.inlined, true);
  assert.ok(built.html.startsWith('<!doctype html>'));
  assert.ok(built.html.includes('<title>Sample Home Tour</title>'));
  assert.ok(built.html.includes('"gw_living"'), 'layout is embedded');
  assert.ok(built.html.includes('export function createViewer'), 'viewer source is embedded');
  assert.ok(built.html.includes("const REVISION = '170'"), 'three.js 0.170 is embedded');
  assert.ok(built.html.includes(finalImageFor(state, 'p4').slice(0, 80)), 'final (redo) image for p4 is embedded');
  assert.ok(built.html.includes(state.outputs.narration.intro), 'narration intro is shown');
  assert.equal((built.html.match(/<\/script>/g) || []).length, 1, 'no embedded string can close the script early');
  const page = built.html.slice(0, built.html.indexOf('<script type="module">'));
  assert.ok(!page.includes('undefined') && !page.includes('null'), 'no leaked undefined/null in the page template');
  assert.ok(built.bytes > 1_300_000, 'three.js is really in there');
  assert.ok(!/AIza[0-9A-Za-z_-]{30,}/.test(built.html), 'no API keys');
});

test('export can fall back to the CDN build of three.js', async () => {
  const photos = await samplePhotos();
  const state = await runHarness({ photos, ...createMockCallers() });
  const built = await buildTourHtml(state, { inlineVendor: false });
  assert.equal(built.inlined, false);
  assert.ok(built.html.includes('cdn.jsdelivr.net/npm/three@0.170.0'));
  assert.equal(built.filename, 'home-tour.html');
});

test('tourData refuses a state without a layout', async () => {
  assert.throws(() => tourData({ inputs: { photos: [] }, outputs: {} }), /needs a finished layout/);
});
