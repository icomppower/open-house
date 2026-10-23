import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHarness, OUTPUT_KEY, STEPS } from '../src/harness.js';
import { samplePhotos, createMockCallers, fakeCaptureStops, clone } from './helpers.js';

test('inputs are frozen and byte-identical after a full run', async () => {
  const photos = await samplePhotos();
  const before = JSON.stringify(photos.map((p) => p.dataUrl));
  const snapshots = [];
  const state = await runHarness({
    photos, ...createMockCallers(), captureStops: fakeCaptureStops,
    onProgress: (e, st) => { if (e.type === 'step:done') snapshots.push(JSON.stringify(st.inputs)); },
  });
  assert.ok(Object.isFrozen(state.inputs));
  assert.ok(Object.isFrozen(state.inputs.photos));
  assert.ok(Object.isFrozen(state.inputs.photos[0]));
  assert.throws(() => { state.inputs.photos[0].dataUrl = 'x'; }, TypeError);
  assert.throws(() => { state.inputs.photos.push({}); }, TypeError);
  assert.equal(JSON.stringify(state.inputs.photos.map((p) => p.dataUrl)), before);
  assert.ok(snapshots.every((s) => s === snapshots[0]), 'inputs identical after every step');
  assert.equal(JSON.stringify(photos.map((p) => p.dataUrl)), before, 'caller photos untouched');
});

test('each step writes its own named output and no step modifies another step\'s output', async () => {
  const photos = await samplePhotos();
  const seen = {};
  const state = await runHarness({
    photos, ...createMockCallers(), captureStops: fakeCaptureStops,
    onProgress: (e, st) => {
      if (e.type !== 'step:done') return;
      // every output that existed before this step must be unchanged after it
      for (const [key, json] of Object.entries(seen)) assert.equal(JSON.stringify(st.outputs[key]), json, `${e.step} modified outputs.${key}`);
      seen[OUTPUT_KEY[e.step]] = JSON.stringify(st.outputs[OUTPUT_KEY[e.step]]);
    },
  });
  const keys = Object.values(OUTPUT_KEY);
  assert.equal(new Set(keys).size, STEPS.length, 'output keys are distinct');
  assert.deepEqual(Object.keys(state.outputs), keys);
  // the judge's redo is a new output inside judge, not an edit of enhance
  assert.equal(state.outputs.enhance.items.p4.attempts.length, 1);
  assert.ok(state.outputs.judge.redos.p4.image.startsWith('data:image/'));
  assert.notEqual(state.outputs.judge.redos.p4.imagePrompt, state.outputs.enhance.items.p4.attempts[0].imagePrompt);
});

test('re-running a step archives its previous output instead of overwriting it', async () => {
  const photos = await samplePhotos();
  const done = await runHarness({ photos, ...createMockCallers(), captureStops: fakeCaptureStops });
  const oldJudge = clone(done.outputs.judge);
  const oldNarration = clone(done.outputs.narration);
  const state = await runHarness({ resume: clone(done), fromStep: 'judge', ...createMockCallers(), captureStops: fakeCaptureStops });
  assert.equal(state.archive.length, 2);
  assert.deepEqual(state.archive[0], { ...state.archive[0], step: 'judge', key: 'judge', output: oldJudge });
  assert.deepEqual(state.archive[1].output, oldNarration);
  assert.ok(state.archive.every((a) => typeof a.archivedAt === 'string'));
  assert.deepEqual(done.outputs.judge, oldJudge, 'the original state object is untouched');
});

test('enhance stores the Blob from callImage as a new data URL next to, not instead of, the input', async () => {
  const photos = await samplePhotos();
  const mock = createMockCallers();
  const state = await runHarness({ photos, ...mock });
  for (const p of state.inputs.photos) {
    const attempt = state.outputs.enhance.items[p.id].attempts[0];
    assert.ok(attempt.image.startsWith('data:image/jpeg;base64,'));
    assert.ok(attempt.image.length > 10_000);
    assert.equal(attempt.photoId, p.id);
    assert.ok(typeof attempt.createdAt === 'string' && attempt.imagePrompt.length > 100);
    assert.equal(p.dataUrl, photos[Number(p.id.slice(1)) - 1].dataUrl, 'input still the caller\'s bytes');
  }
  assert.equal(mock.calls.filter((c) => c.kind === 'image').length, 7);
});
