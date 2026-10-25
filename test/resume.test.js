import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHarness, STEPS } from '../src/harness.js';
import { samplePhotos, createMockCallers, fakeCaptureStops, clone } from '../fixtures/helpers.js';

async function fullRun() {
  const photos = await samplePhotos();
  return runHarness({ photos, ...createMockCallers(), captureStops: fakeCaptureStops });
}

test('resume from a serialized state re-runs only the requested step onward', async () => {
  const done = await fullRun();
  const saved = JSON.parse(JSON.stringify(done));
  const mock = createMockCallers();
  const events = [];
  const state = await runHarness({ resume: saved, fromStep: 'narrate', ...mock, onProgress: (e) => events.push(e) });
  assert.equal(mock.calls.length, 1, 'only the narrate call');
  assert.equal(mock.calls[0].meta.step, 'narrate');
  assert.deepEqual(state.outputs.spec, done.outputs.spec);
  assert.deepEqual(state.outputs.layout, done.outputs.layout);
  assert.deepEqual(state.outputs.judge, done.outputs.judge);
  assert.deepEqual(state.outputs.narration, done.outputs.narration);
  assert.equal(state.id, done.id);
  assert.equal(state.archive.length, 1);
  assert.equal(state.archive[0].step, 'narrate');
  assert.deepEqual(state.archive[0].output, done.outputs.narration);
  assert.equal(events[0].type, 'run:start');
  assert.equal(events[0].from, 'narrate');
  assert.equal(events.filter((e) => e.type === 'step:start').length, 1);
  assert.notEqual(state, saved, 'resume works on a copy');
  assert.equal(saved.archive.length, 0);
});

test('resume from judge re-runs judge and narrate, and the judge redo happens again', async () => {
  const done = await fullRun();
  const mock = createMockCallers();
  const state = await runHarness({ resume: clone(done), fromStep: 'judge', ...mock, captureStops: fakeCaptureStops });
  const steps = [...new Set(mock.calls.map((c) => c.meta.step))];
  assert.deepEqual(steps, ['judge', 'enhance', 'narrate'], 'judge, the redo it asks for, then narrate');
  assert.equal(state.archive.length, 2);
  assert.deepEqual(state.archive.map((a) => a.step), ['judge', 'narrate']);
  assert.deepEqual(Object.keys(state.outputs.judge.redos), ['p4']);
  assert.equal(state.outputs.enhance.items.p4.attempts.length, 1, 'the enhance output is reused untouched');
});

test('resume without fromStep continues after the last finished step', async () => {
  const photos = await samplePhotos();
  const mock = createMockCallers();
  const failing = async (args) => { if (args.meta.step === 'enhance') throw new Error('image model down'); return mock.callModel(args); };
  const err = await runHarness({ photos, callModel: failing, callImage: mock.callImage }).catch((e) => e);
  assert.equal(err.step, 'enhance');
  assert.equal(err.state.steps.enhance.status, 'error');
  const mock2 = createMockCallers();
  const state = await runHarness({ resume: err.state, ...mock2 });
  assert.equal(state.steps.enhance.status, 'done');
  assert.equal(state.steps.narrate.status, 'done');
  assert.ok(!mock2.calls.some((c) => c.meta.step === 'ingest' || c.meta.step === 'layout'), 'finished steps are not re-run');
  assert.equal(state.archive.length, 0, 'nothing to archive: the failed step had no output');
});

test('resume refuses unknown steps, missing prerequisites and foreign states', async () => {
  const done = await fullRun();
  const mock = createMockCallers();
  await assert.rejects(runHarness({ resume: clone(done), fromStep: 'render', ...mock }), /unknown step "render"/);
  const broken = clone(done);
  delete broken.outputs.layout;
  await assert.rejects(runHarness({ resume: broken, fromStep: 'enhance', ...mock }), /step "layout" has no finished output/);
  await assert.rejects(runHarness({ resume: { hello: 1 }, ...mock }), /run state produced by this harness/);
  await assert.rejects(runHarness({ photos: await samplePhotos(), fromStep: 'judge', ...mock }), /fromStep needs resume/);
  assert.deepEqual(STEPS.slice(0, 2), ['prepare', 'ingest']);
});

test('resuming a fully finished state with no fromStep is a no-op', async () => {
  const done = await fullRun();
  const mock = createMockCallers();
  const state = await runHarness({ resume: clone(done), ...mock });
  assert.equal(mock.calls.length, 0);
  assert.deepEqual(state.outputs, done.outputs);
});
