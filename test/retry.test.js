import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHarness, HarnessError } from '../src/harness.js';
import { samplePhotos, createMockCallers } from './helpers.js';

test('bad JSON, then a schema failure, then a good answer: two retries with validator errors appended', async () => {
  const photos = await samplePhotos();
  const mock = createMockCallers();
  const seen = [];
  let n = 0;
  const callModel = async (args) => {
    if (args.meta.step !== 'ingest') return mock.callModel(args);
    seen.push(args.prompt);
    n++;
    if (n === 1) return 'Sure! Here is the spec: {rooms: [';
    if (n === 2) return { rooms: [], photos: [] };
    return mock.callModel(args);
  };
  const events = [];
  const state = await runHarness({ photos, callModel, callImage: mock.callImage, onProgress: (e) => events.push(e) });
  assert.equal(state.steps.ingest.status, 'done');
  assert.equal(state.steps.ingest.attempts, 3);
  const retries = events.filter((e) => e.type === 'retry');
  assert.equal(retries.length, 2);
  assert.equal(retries[0].attempt, 1);
  assert.ok(retries[0].errors[0].includes('not valid JSON'));
  assert.ok(retries[1].errors.some((e) => e.includes('missing required property "materials"')));
  assert.ok(retries[1].errors.some((e) => e.includes('must have at least 1 items')));
  assert.ok(!seen[0].includes('REJECTED BY THE VALIDATOR'));
  assert.ok(seen[1].includes('REJECTED BY THE VALIDATOR') && seen[1].includes('not valid JSON'));
  assert.ok(seen[2].includes('missing required property "materials"'));
  assert.ok(!seen[2].includes('not valid JSON'), 'only the latest errors are appended');
});

test('a model that keeps failing stops the run after 1 + maxRetries attempts and surfaces the errors', async () => {
  const photos = await samplePhotos();
  const mock = createMockCallers();
  let calls = 0;
  const callModel = async (args) => {
    if (args.meta.step !== 'layout') return mock.callModel(args);
    calls++;
    const layout = await mock.callModel(args);
    layout.rooms[0].rect.x = -3; // living room pushed outside the footprint every time
    return layout;
  };
  const events = [];
  const err = await runHarness({ photos, callModel, callImage: mock.callImage, onProgress: (e) => events.push(e) }).catch((e) => e);
  assert.ok(err instanceof HarnessError);
  assert.equal(err.step, 'layout');
  assert.equal(calls, 3);
  assert.equal(err.attempts.length, 3);
  assert.ok(err.attempts.every((a) => a.errors.some((m) => m.includes('does not fit inside the footprint'))));
  assert.match(err.message, /failed validation after 3 attempts/);
  assert.equal(err.state.steps.layout.status, 'error');
  assert.equal(err.state.steps.ingest.status, 'done');
  assert.equal(err.state.outputs.layout, undefined, 'nothing invalid is ever stored');
  assert.equal(events.filter((e) => e.type === 'retry').length, 2);
  assert.equal(events.at(-1).type, 'run:error');
  assert.ok(!Object.keys(err).includes('state'), 'state is attached but not enumerable');
});

test('maxRetries is configurable and a plan-check failure also triggers a retry', async () => {
  const photos = await samplePhotos();
  const mock = createMockCallers();
  let n = 0;
  const callModel = async (args) => {
    if (args.meta.step !== 'narrate') return mock.callModel(args);
    n++;
    const narration = await mock.callModel(args);
    if (n <= 4) narration.lines.pop(); // one room missing
    return narration;
  };
  const state = await runHarness({ photos, callModel, callImage: mock.callImage, options: { maxRetries: 4 } });
  assert.equal(n, 5);
  assert.equal(state.steps.narrate.attempts, 5);
  assert.equal(state.outputs.narration.lines.length, 6);
});

test('a throwing callModel counts as a failed attempt and is retried', async () => {
  const photos = await samplePhotos();
  const mock = createMockCallers();
  let n = 0;
  const callModel = async (args) => {
    if (args.meta.step === 'ingest' && n++ === 0) throw new SyntaxError('Unexpected token < in JSON');
    return mock.callModel(args);
  };
  const state = await runHarness({ photos, callModel, callImage: mock.callImage });
  assert.equal(state.steps.ingest.attempts, 2);
});
