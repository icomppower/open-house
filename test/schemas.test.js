import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSchema, parsePrompt, loadPrompt, fillTemplate } from '../src/harness.js';
import { validateSchema, formatErrors } from '../src/validate.js';
import { fixture, clone } from '../fixtures/helpers.js';

const SCHEMAS = ['spec', 'layout', 'enhance', 'judge', 'narration'];

test('every schema loads and is a draft 2020-12 object schema', async () => {
  for (const name of SCHEMAS) {
    const s = await loadSchema(name);
    assert.equal(s.type, 'object', name);
    assert.ok(Array.isArray(s.required), name);
    assert.equal(s.additionalProperties, false, `${name} must reject unknown keys`);
  }
});

test('recorded mock responses validate against their schemas', async () => {
  const spec = await fixture('spec');
  assert.deepEqual(validateSchema(await loadSchema('spec'), spec), []);
  const layout = await fixture('layout');
  assert.deepEqual(validateSchema(await loadSchema('layout'), layout), []);
  const enhance = await fixture('enhance');
  for (const plans of Object.values(enhance)) for (const plan of plans) assert.deepEqual(validateSchema(await loadSchema('enhance'), plan), []);
  for (const file of ['judge', 'judge-tour']) {
    const judge = await fixture(file);
    for (const verdicts of Object.values(judge)) for (const v of verdicts) assert.deepEqual(validateSchema(await loadSchema('judge'), v), []);
  }
  assert.deepEqual(validateSchema(await loadSchema('narration'), await fixture('narration')), []);
});

test('schema validator reports paths for type, enum, range, required and unknown keys', async () => {
  const schema = await loadSchema('judge');
  const good = (await fixture('judge')).p1[0];
  const bad = clone(good);
  bad.scores.geometry = 7;
  bad.verdict = 'maybe';
  bad.defects[0].kind = 'weird';
  delete bad.overall;
  bad.extra = 1;
  const errors = formatErrors(validateSchema(schema, bad));
  assert.ok(errors.some((e) => e.startsWith('$.scores.geometry: must be <= 5')), errors.join('\n'));
  assert.ok(errors.some((e) => e.startsWith('$.verdict: must be one of')), errors.join('\n'));
  assert.ok(errors.some((e) => e.startsWith('$.defects[0].kind: must be one of')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('missing required property "overall"')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('unexpected property "extra"')), errors.join('\n'));
  assert.deepEqual(validateSchema(schema, good), []);
});

test('schema validator handles $ref, const, integer and exclusiveMinimum', async () => {
  const schema = await loadSchema('layout');
  const layout = clone(await fixture('layout'));
  layout.units = 'feet';
  layout.rooms[0].rect.w = 0;
  layout.openings[0].mullions = 2.5;
  layout.cameras[0].position = { x: 1, y: 1 };
  const errors = formatErrors(validateSchema(schema, layout));
  assert.ok(errors.some((e) => e.startsWith('$.units: must equal "metres"')), errors.join('\n'));
  assert.ok(errors.some((e) => e.startsWith('$.rooms[0].rect.w: must be > 0')), errors.join('\n'));
  assert.ok(errors.some((e) => e.startsWith('$.openings[0].mullions: expected integer')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('$.cameras[0].position: missing required property "z"')), errors.join('\n'));
});

test('prompt files parse into system + user and fill their placeholders', async () => {
  for (const name of ['ingest', 'layout', 'enhance', 'judge', 'judge-tour', 'narrate']) {
    const p = await loadPrompt(name);
    assert.ok(p.system.length > 100, `${name} system`);
    assert.ok(p.user.length > 20, `${name} user`);
    assert.ok(p.system.includes('{{SCHEMA}}'), `${name} embeds the schema`);
  }
  assert.throws(() => parsePrompt('no sections here'), /needs "## System" and "## User"/);
  assert.equal(fillTemplate('a {{X}} b {{ Y }}', { X: 'x', Y: { k: 1 } }), 'a x b {\n  "k": 1\n}');
  assert.throws(() => fillTemplate('{{MISSING}}', {}), /unfilled placeholders: MISSING/);
});
