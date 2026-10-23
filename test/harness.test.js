import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHarness, STEPS, OUTPUT_KEY, TEXT_RULE, finalImageFor } from '../src/harness.js';
import { samplePhotos, createMockCallers, fakeCaptureStops } from './helpers.js';

test('full run with the mock: six steps, named outputs, judge redo, narration', async () => {
  const photos = await samplePhotos();
  const mock = createMockCallers();
  const events = [];
  const state = await runHarness({ photos, ...mock, captureStops: fakeCaptureStops, onProgress: (e) => events.push(e) });

  assert.deepEqual(STEPS, ['prepare', 'ingest', 'layout', 'enhance', 'judge', 'narrate']);
  assert.deepEqual(Object.keys(state.outputs), STEPS.map((s) => OUTPUT_KEY[s]));
  for (const s of STEPS) assert.equal(state.steps[s].status, 'done', s);
  assert.equal(state.inputs.photos.length, 6);
  assert.equal(state.outputs.spec.rooms.length, 6);
  assert.equal(state.outputs.layout.cameras.length, 6);
  assert.equal(Object.keys(state.outputs.enhance.items).length, 6);
  assert.equal(state.outputs.narration.lines.length, 6);

  // the judge gave p4 a 3 -> one redo, recorded in the judge output; final picks the better one
  assert.deepEqual(Object.keys(state.outputs.judge.redos), ['p4']);
  assert.equal(state.outputs.judge.photos.p4.verdicts.length, 2);
  assert.equal(state.outputs.judge.photos.p1.verdicts.length, 1);
  assert.deepEqual(state.outputs.judge.final.p4, { source: 'redo', index: 1, overall: 4 });
  assert.deepEqual(state.outputs.judge.summary.redone, ['p4']);
  assert.deepEqual(state.outputs.judge.summary.flagged, []);
  assert.equal(state.outputs.judge.summary.tourStops, 6);
  assert.equal(finalImageFor(state, 'p4'), state.outputs.judge.redos.p4.image);
  assert.equal(finalImageFor(state, 'p1'), state.outputs.enhance.items.p1.attempts[0].image);

  // progress events
  const types = events.map((e) => e.type);
  assert.equal(types[0], 'run:start');
  assert.equal(types[types.length - 1], 'run:done');
  assert.equal(types.filter((t) => t === 'step:start').length, 6);
  assert.equal(types.filter((t) => t === 'step:done').length, 6);
  assert.equal(types.filter((t) => t === 'retry').length, 0);

  // state is plain data
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

test('every image prompt carries the text rule; the judge is a fresh call with its own system prompt', async () => {
  const photos = await samplePhotos();
  const mock = createMockCallers();
  await runHarness({ photos, ...mock, captureStops: fakeCaptureStops });
  const imageCalls = mock.calls.filter((c) => c.kind === 'image');
  assert.equal(imageCalls.length, 7, '6 photos + 1 redo');
  for (const c of imageCalls) {
    assert.ok(c.prompt.includes(TEXT_RULE), `image prompt for ${c.meta.photoId} lacks the text rule`);
    assert.ok(c.prompt.startsWith('Edit this photo'), 'edit prompt comes from the model plan');
  }
  const modelCalls = mock.calls.filter((c) => c.kind === 'model');
  assert.ok(modelCalls.every((c) => c.json === true && c.meta.step));
  const enhanceSys = modelCalls.find((c) => c.meta.step === 'enhance').system;
  const judgeCalls = modelCalls.filter((c) => c.meta.step === 'judge');
  assert.equal(judgeCalls.length, 7 + 6, '6 first verdicts + 1 redo verdict + 6 tour stops');
  for (const j of judgeCalls) {
    assert.notEqual(j.system, enhanceSys, 'judge must not share the enhance system prompt');
    assert.ok(j.system.includes('independent'), 'judge system prompt declares independence');
    assert.equal(j.imageCount, 2, 'judge sees source + output only');
    assert.ok(!j.prompt.includes('editPrompt'), 'judge never sees the edit plan');
  }
  const tourJudges = judgeCalls.filter((c) => c.meta.kind === 'tour');
  assert.equal(tourJudges.length, 6);
  assert.ok(tourJudges[0].system.includes('3D tour stop') || tourJudges[0].system.includes('rendered 3D tour'));
  // the redo plan received the first judge's defects
  const redoPlan = modelCalls.find((c) => c.meta.step === 'enhance' && c.meta.redo);
  assert.ok(redoPlan.prompt.includes('rejected by an independent judge'));
  assert.ok(redoPlan.prompt.includes('legible lettering'));
});

test('judge tour scoring is skipped cleanly without captureStops', async () => {
  const photos = await samplePhotos();
  const state = await runHarness({ photos, ...createMockCallers() });
  assert.equal(state.outputs.judge.tour, null);
  assert.equal(state.outputs.judge.summary.meanTour, null);
  assert.ok(state.log.some((l) => l.message.includes('no captureStops')));
});

test('inputs are accepted as Blobs, data URLs or { name, dataUrl }', async () => {
  const [p] = await samplePhotos();
  const bytes = Uint8Array.from(atob(p.dataUrl.split(',')[1]), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const mock = createMockCallers();
  // only the prepare step needs to run for this; stop early by making ingest fail fast
  const err = await runHarness({ photos: [blob, p.dataUrl, p], callModel: async () => { throw new Error('stop'); }, callImage: mock.callImage, options: { maxRetries: 0 } }).catch((e) => e);
  assert.equal(err.step, 'ingest');
  assert.equal(err.state.inputs.photos.length, 3);
  assert.deepEqual(err.state.inputs.photos.map((x) => x.id), ['p1', 'p2', 'p3']);
  assert.ok(err.state.inputs.photos.every((x) => x.dataUrl.startsWith('data:image/jpeg;base64,')));
  await assert.rejects(runHarness({ photos: [{ nope: 1 }], ...mock }), /must be a Blob\/File, a data URL string, or/);
  await assert.rejects(runHarness({ photos: [], ...mock }), /at least one photo/);
  await assert.rejects(runHarness({ photos: [p] }), /needs callModel/);
});
