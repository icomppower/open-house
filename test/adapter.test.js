import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGeminiCallers } from '../src/adapters/gemini.js';

const IMG = 'data:image/jpeg;base64,' + Buffer.from('fake').toString('base64');
const PNG_B64 = Buffer.from('png-bytes').toString('base64');
const noSleep = async () => {};

function fakeAi(script) {
  const calls = [];
  return {
    calls,
    models: {
      async generateContent(req) {
        calls.push(req);
        const step = script.shift();
        if (step instanceof Error) throw step;
        return step;
      },
    },
  };
}

test('callModel sends thinkingLevel per step, no temperature, returns raw text', async () => {
  const ai = fakeAi([{ text: '{"ok":true}' }]);
  const { callModel } = makeGeminiCallers({ ai, thinkingLevel: 'medium', thinkingLevels: { layout: 'high' }, sleep: noSleep });
  const out = await callModel({ system: 's', prompt: 'p', images: [IMG], meta: { step: 'layout' } });
  assert.equal(out, '{"ok":true}');
  const req = ai.calls[0];
  assert.equal(req.model, 'gemini-4-argon');
  assert.deepEqual(req.config.thinkingConfig, { thinkingLevel: 'high' });
  assert.equal(req.config.responseMimeType, 'application/json');
  assert.equal('temperature' in req.config, false);
  assert.equal(req.contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
});

test('callModel omits thinkingConfig when no level is set', async () => {
  const ai = fakeAi([{ text: '{}' }]);
  const { callModel } = makeGeminiCallers({ ai, sleep: noSleep });
  await callModel({ system: 's', prompt: 'p' });
  assert.equal('thinkingConfig' in ai.calls[0].config, false);
});

test('transport errors are retried with backoff, then succeed', async () => {
  const ai = fakeAi([new Error('429 RESOURCE_EXHAUSTED'), new Error('503 UNAVAILABLE'), { text: '{"a":1}' }]);
  const events = [];
  const { callModel } = makeGeminiCallers({ ai, sleep: noSleep, log: (e) => events.push(e) });
  assert.equal(await callModel({ system: 's', prompt: 'p' }), '{"a":1}');
  assert.equal(ai.calls.length, 3);
  assert.equal(events.filter((e) => e.type === 'transport-retry').length, 2);
});

test('transport retries are bounded', async () => {
  const ai = fakeAi([new Error('503'), new Error('503'), new Error('503')]);
  const { callModel } = makeGeminiCallers({ ai, sleep: noSleep, transportRetries: 2 });
  await assert.rejects(callModel({ system: 's', prompt: 'p' }), /503/);
  assert.equal(ai.calls.length, 3);
});

test('non-transport errors are not retried', async () => {
  const ai = fakeAi([new Error('400 INVALID_ARGUMENT')]);
  const { callModel } = makeGeminiCallers({ ai, sleep: noSleep });
  await assert.rejects(callModel({ system: 's', prompt: 'p' }), /INVALID_ARGUMENT/);
  assert.equal(ai.calls.length, 1);
});

test('empty model text throws with the finish reason', async () => {
  const ai = fakeAi([{ text: '', candidates: [{ finishReason: 'SAFETY' }] }]);
  const { callModel } = makeGeminiCallers({ ai, sleep: noSleep });
  await assert.rejects(callModel({ system: 's', prompt: 'p' }), /SAFETY/);
});

test('callImage falls back to the next image model on 404 and sticks with it', async () => {
  const imgRes = { candidates: [{ content: { parts: [{ inlineData: { data: PNG_B64, mimeType: 'image/png' } }] } }] };
  const ai = fakeAi([new Error('404 NOT_FOUND: model not found'), imgRes, imgRes]);
  const { callImage } = makeGeminiCallers({ ai, imageModel: ['img-new', 'img-old'], sleep: noSleep });
  const blob = await callImage({ image: IMG, prompt: 'edit', meta: { photoId: 'p1' } });
  assert.equal(blob.type, 'image/png');
  await callImage({ image: IMG, prompt: 'edit', meta: { photoId: 'p2' } });
  assert.deepEqual(ai.calls.map((c) => c.model), ['img-new', 'img-old', 'img-old']);
});

test('callImage with a single model surfaces 404 without retrying', async () => {
  const ai = fakeAi([new Error('404 NOT_FOUND')]);
  const { callImage } = makeGeminiCallers({ ai, imageModel: 'only-one', sleep: noSleep });
  await assert.rejects(callImage({ image: IMG, prompt: 'edit' }), /404/);
  assert.equal(ai.calls.length, 1);
});

test('callImage with no image part throws with the reason', async () => {
  const ai = fakeAi([{ candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [{ text: 'no' }] } }] }]);
  const { callImage } = makeGeminiCallers({ ai, imageModel: 'm', sleep: noSleep });
  await assert.rejects(callImage({ image: IMG, prompt: 'edit' }), /IMAGE_SAFETY/);
});
