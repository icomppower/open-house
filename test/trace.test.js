import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHarness } from '../src/harness.js';
import { sha256Hex, sha256Bytes, summarize, SUMMARY_MAX } from '../src/trace.js';
import { buildReport, reportMarkdown } from '../src/report.js';
import { samplePhotos, createMockCallers, fakeCaptureStops, clone } from './helpers.js';

const HEX64 = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

test('every callModel / callImage call produces exactly one trace entry, in order, with every field', async () => {
  const photos = await samplePhotos();
  const mock = createMockCallers();
  const state = await runHarness({ photos, ...mock, captureStops: fakeCaptureStops });
  assert.equal(state.trace.length, mock.calls.length, 'one entry per call');
  assert.deepEqual(state.trace.map((t) => t.kind), mock.calls.map((c) => c.kind), 'same order as the calls');
  assert.deepEqual(state.trace.map((t) => t.step), mock.calls.map((c) => c.meta.step));
  assert.deepEqual(state.trace.map((t) => t.photoId), mock.calls.map((c) => c.meta.photoId ?? null));
  state.trace.forEach((t, i) => {
    assert.equal(t.id, `t${i + 1}`);
    assert.deepEqual(Object.keys(t), ['id', 'step', 'photoId', 'attempt', 'startedAt', 'ms', 'kind', 'promptFile', 'inputSummary', 'outputHash', 'validator', 'judgeScore', 'redoOf']);
    assert.equal(t.attempt, 1, 'the mock never needs a retry');
    assert.match(t.startedAt, ISO);
    assert.ok(Number.isInteger(t.ms) && t.ms >= 0);
    assert.ok(['model', 'image'].includes(t.kind));
    assert.match(t.promptFile, /^(ingest|layout|enhance|judge|judge-tour|narrate)\.md$/);
    assert.ok(t.inputSummary.length > 10 && t.inputSummary.length <= 200, t.inputSummary);
    assert.match(t.outputHash, HEX64);
    assert.equal(t.validator, 'pass');
    if (t.step === 'judge') assert.ok(Number.isInteger(t.judgeScore) && t.judgeScore >= 1 && t.judgeScore <= 5);
    else assert.equal(t.judgeScore, null);
  });
  // the p4 redo: plan, image and second verdict each point back at the entry they supersede
  const redos = state.trace.filter((t) => t.redoOf !== null);
  assert.deepEqual(redos.map((t) => [t.kind, t.step, t.photoId, t.promptFile]), [['model', 'enhance', 'p4', 'enhance.md'], ['image', 'enhance', 'p4', 'enhance.md'], ['model', 'judge', 'p4', 'judge.md']]);
  for (const r of redos) {
    const target = state.trace.find((t) => t.id === r.redoOf);
    assert.ok(target && target.kind === r.kind && target.photoId === 'p4' && target.promptFile === r.promptFile && target.redoOf === null);
    assert.ok(Number(target.id.slice(1)) < Number(r.id.slice(1)), 'points backwards');
  }
  assert.deepEqual(state.trace.filter((t) => t.step === 'judge' && t.promptFile === 'judge.md' && t.photoId === 'p4').map((t) => t.judgeScore), [3, 4]);
  // identical images -> identical hashes (Node mock returns the original bytes); different photos differ
  const imageHashes = state.trace.filter((t) => t.kind === 'image').map((t) => t.outputHash);
  assert.equal(new Set(imageHashes).size, 6, '6 distinct photos, p4 redone with the same bytes');
  // the trace holds no image data and stays small
  const json = JSON.stringify(state.trace);
  assert.ok(!json.includes('data:image'));
  assert.ok(json.length < 40_000, `trace is ${json.length} bytes`);
  assert.deepEqual(JSON.parse(json), state.trace, 'plain data');
});

test('retries are traced as attempts 1..3 with the validator errors; the final good answer is attempt 3', async () => {
  const photos = await samplePhotos();
  const mock = createMockCallers();
  let n = 0;
  const callModel = async (args) => {
    if (args.meta.step !== 'ingest') return mock.callModel(args);
    n++;
    if (n === 1) return 'Sure! Here is the spec: {rooms: [';
    if (n === 2) return { rooms: [], photos: [] };
    return mock.callModel(args);
  };
  const state = await runHarness({ photos, callModel, callImage: mock.callImage });
  const ingest = state.trace.filter((t) => t.step === 'ingest');
  assert.deepEqual(ingest.map((t) => t.attempt), [1, 2, 3]);
  assert.ok(Array.isArray(ingest[0].validator) && ingest[0].validator[0].includes('not valid JSON'));
  assert.ok(Array.isArray(ingest[1].validator) && ingest[1].validator.some((e) => e.includes('missing required property "materials"')));
  assert.equal(ingest[2].validator, 'pass');
  assert.match(ingest[0].outputHash, HEX64, 'the bad string is still hashed');
  assert.equal(ingest[0].outputHash, await sha256Hex('Sure! Here is the spec: {rooms: ['));
  assert.ok(ingest.every((t) => t.inputSummary.includes(`attempt ${t.attempt}`)));
  assert.equal(state.trace.length, mock.calls.length + 2, 'the two rejected attempts are traced too');
});

test('a run that stops after 3 failed attempts leaves 3 failed entries in err.state.trace; a thrown call has no hash', async () => {
  const photos = await samplePhotos();
  const mock = createMockCallers();
  const callModel = async (args) => {
    if (args.meta.step !== 'layout') return mock.callModel(args);
    if (args.meta.attempt === 2) throw new Error('503 from the model');
    const layout = await mock.callModel(args);
    layout.rooms[0].rect.x = -3;
    return layout;
  };
  const err = await runHarness({ photos, callModel, callImage: mock.callImage }).catch((e) => e);
  assert.equal(err.step, 'layout');
  const layout = err.state.trace.filter((t) => t.step === 'layout');
  assert.deepEqual(layout.map((t) => t.attempt), [1, 2, 3]);
  assert.ok(layout.every((t) => Array.isArray(t.validator)));
  assert.ok(layout[0].validator[0].includes('does not fit inside the footprint'));
  assert.ok(layout[1].validator[0].includes('model call failed: 503'));
  assert.equal(layout[1].outputHash, null);
  assert.match(layout[2].outputHash, HEX64);
  assert.equal(err.state.outputs.layout, undefined);
});

test('resume appends to the trace and never rewrites earlier entries', async () => {
  const photos = await samplePhotos();
  const done = await runHarness({ photos, ...createMockCallers(), captureStops: fakeCaptureStops });
  const before = clone(done.trace);
  const mock = createMockCallers();
  const state = await runHarness({ resume: clone(done), fromStep: 'judge', ...mock, captureStops: fakeCaptureStops });
  assert.equal(state.trace.length, before.length + mock.calls.length);
  assert.deepEqual(state.trace.slice(0, before.length), before, 'earlier entries untouched');
  assert.deepEqual(state.trace.slice(before.length).map((t) => t.id), mock.calls.map((_, i) => `t${before.length + i + 1}`), 'ids continue');
  assert.deepEqual(done.trace, before, 'the original state object is untouched');
  // a failed run resumed without fromStep also appends
  const mock2 = createMockCallers();
  let fail = true;
  const flaky = async (args) => { if (args.meta.step === 'enhance' && fail) { fail = false; throw new Error('image model down'); } return mock2.callModel(args); };
  const err = await runHarness({ photos, callModel: flaky, callImage: mock2.callImage, options: { maxRetries: 0 } }).catch((e) => e);
  const failedLen = err.state.trace.length;
  assert.ok(Array.isArray(err.state.trace[failedLen - 1].validator));
  const resumed = await runHarness({ resume: err.state, ...createMockCallers() });
  assert.ok(resumed.trace.length > failedLen);
  assert.deepEqual(resumed.trace.slice(0, failedLen), err.state.trace);
});

test('callImage failures are traced and stop the step', async () => {
  const photos = await samplePhotos();
  const mock = createMockCallers();
  const callImage = async (args) => { if (args.meta.photoId === 'p2') throw new Error('quota exceeded'); return mock.callImage(args); };
  const err = await runHarness({ photos, callModel: mock.callModel, callImage }).catch((e) => e);
  assert.equal(err.step, 'enhance');
  assert.equal(err.photoId, 'p2');
  const last = err.state.trace[err.state.trace.length - 1];
  assert.equal(last.kind, 'image');
  assert.equal(last.photoId, 'p2');
  assert.deepEqual(last.validator, ['$: image call failed: quota exceeded']);
  assert.equal(last.outputHash, null);
  const notBlob = async () => 'not a blob';
  const err2 = await runHarness({ photos, callModel: mock.callModel, callImage: notBlob }).catch((e) => e);
  assert.match(err2.message, /did not return a Blob/);
  assert.ok(err2.state.trace.at(-1).validator[0].includes('did not return a Blob'));
});

test('report numbers equal an independent recount of the trace, and no model-written summary is quoted', async () => {
  const photos = await samplePhotos();
  const mock = createMockCallers();
  let n = 0;
  const callModel = async (args) => { // one narration retry so the report has a retry to count
    if (args.meta.step === 'narrate' && n++ === 0) return 'not json';
    return mock.callModel(args);
  };
  const state = await runHarness({ photos, callModel, callImage: mock.callImage, captureStops: fakeCaptureStops });
  const report = buildReport(state);
  const tr = state.trace;
  const count = (pred) => tr.filter(pred).length;
  assert.equal(report.totals.calls, tr.length);
  assert.equal(report.totals.modelCalls, count((t) => t.kind === 'model'));
  assert.equal(report.totals.imageCalls, count((t) => t.kind === 'image'));
  assert.equal(report.totals.retries, count((t) => t.attempt > 1));
  assert.equal(report.totals.retries, 1);
  assert.equal(report.totals.failed, count((t) => t.validator !== 'pass'));
  assert.equal(report.totals.redoCalls, count((t) => t.redoOf !== null));
  assert.equal(report.totals.ms, tr.reduce((a, t) => a + t.ms, 0));
  assert.equal(report.totals.photos, 6);
  assert.equal(report.totals.photosRedone, 1);
  assert.equal(report.steps.reduce((a, s) => a + s.calls, 0), tr.length, 'steps partition the trace');
  for (const s of report.steps) {
    assert.equal(s.calls, count((t) => t.step === s.step), s.step);
    assert.equal(s.retries, count((t) => t.step === s.step && t.attempt > 1), s.step);
    assert.equal(s.failed, count((t) => t.step === s.step && t.validator !== 'pass'), s.step);
  }
  const narrate = report.steps.find((s) => s.step === 'narrate');
  assert.deepEqual([narrate.calls, narrate.retries, narrate.failed], [2, 1, 1]);
  for (const p of report.photos) {
    assert.equal(p.calls, count((t) => t.photoId === p.photoId));
    const scores = tr.filter((t) => t.photoId === p.photoId && t.promptFile === 'judge.md' && t.validator === 'pass').map((t) => t.judgeScore);
    assert.deepEqual(p.scores, scores);
    assert.equal(p.score, scores.at(-1));
    assert.equal(p.redone, tr.some((t) => t.photoId === p.photoId && t.redoOf !== null));
  }
  const p4 = report.photos.find((p) => p.photoId === 'p4');
  assert.deepEqual([p4.firstScore, p4.score, p4.redone, p4.tourScore !== null], [3, 4, true, true]);
  assert.equal(p4.defects.length, 1, 'defects of the final (redo) verdict');
  const meanFromTrace = report.photos.reduce((a, p) => a + p.score, 0) / 6;
  assert.equal(report.totals.meanScore, Number(meanFromTrace.toFixed(2)));

  const md = reportMarkdown(report);
  assert.ok(md.startsWith('# How it was made'));
  assert.ok(md.includes(`Calls: ${tr.length} (`));
  assert.ok(md.includes('| p4 | ') && md.includes('| yes |'));
  assert.ok(!md.includes(state.outputs.spec.summary), 'spec.summary is model-written and must not appear');
  assert.ok(!md.includes(state.outputs.narration.intro), 'narration is model-written and must not appear');
  const notes = Object.values(state.outputs.judge.photos).flatMap((p) => p.verdicts.map((v) => v.notes)).filter(Boolean);
  assert.ok(notes.length > 0 && notes.every((note) => !md.includes(note)), 'judge notes are model-written and must not appear');
  assert.ok(!md.includes(state.outputs.layout.notes));
  // the report is a pure function of trace + judge: wiping other outputs changes nothing
  const stripped = clone(state);
  for (const k of ['spec', 'layout', 'enhance', 'narration', 'prepare']) delete stripped.outputs[k];
  const again = buildReport(stripped);
  assert.deepEqual({ ...again, generatedAt: null }, { ...report, generatedAt: null });
});

test('sha-256 fallback matches Web Crypto and the known test vector; summaries are clipped to 200 chars', async () => {
  const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  assert.equal(hex(sha256Bytes(new TextEncoder().encode('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(hex(sha256Bytes(new Uint8Array(0))), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  for (const s of ['', 'a', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'y'.repeat(1000), '{"a":1}']) {
    const bytes = new TextEncoder().encode(s);
    assert.equal(hex(sha256Bytes(bytes)), hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))), `len ${s.length}`);
    assert.equal(await sha256Hex(s), hex(sha256Bytes(bytes)));
  }
  const long = summarize('word '.repeat(100));
  assert.equal(long.length, SUMMARY_MAX);
  assert.ok(long.endsWith('…'));
  assert.equal(summarize('  a   b  '), 'a b');
});
