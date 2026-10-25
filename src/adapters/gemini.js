// Gemini adapter: turns a GoogleGenAI client into the two functions the harness needs.
// No key lives here; the caller constructs the client. Model ids are parameters because
// they change — check the model list in AI Studio.
//
//   import { GoogleGenAI } from 'https://esm.sh/@google/genai@1';
//   const ai = new GoogleGenAI({ apiKey });              // key supplied by the host app
//   const { callModel, callImage } = makeGeminiCallers({ ai });
//
// Written against the @google/genai v1 request shape (generateContent with inlineData parts,
// systemInstruction, responseMimeType, responseModalities).
//
// Gemini 4 Argon notes (ai.google.dev, Oct 2026):
// - Argon outputs text only. Every image edit goes to a separate image model (`imageModel`).
// - Thinking is a level ('low' | 'medium' | 'high', default medium), not a token budget.
// - temperature / topP / topK are ignored by Argon, so none are sent.
// - Explicit caching is not supported (implicit caching is automatic), so none is used.
//
// Transport errors (429 / 5xx / network) are retried here with backoff, so they never burn
// the harness's validation retries. Validation retries stay in the harness.

const RETRYABLE = /\b(429|500|502|503|504)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|INTERNAL|DEADLINE_EXCEEDED|overloaded|fetch failed|network|ECONNRESET|ETIMEDOUT/i;
const NOT_FOUND = /\b404\b|NOT_FOUND|not found|no longer available/i;

export function makeGeminiCallers({
  ai,
  textModel = 'gemini-4-argon',
  imageModel = ['gemini-3.1-flash-image', 'gemini-2.5-flash-image'], // string or fallback list, tried in order on 404
  thinkingLevel,            // 'low' | 'medium' | 'high'; omit for the model default
  thinkingLevels = {},      // per-step override, e.g. { layout: 'high', narrate: 'low' }
  transportRetries = 4,     // per call, on top of the harness's validation retries
  baseDelayMs = 1500,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = () => {},           // (event) => void, e.g. console.log, for watching retries live
} = {}) {
  if (!ai || !ai.models) throw new Error('makeGeminiCallers needs a GoogleGenAI client as `ai`');
  const imageModels = Array.isArray(imageModel) ? [...imageModel] : [imageModel];

  async function withBackoff(label, fn) {
    for (let i = 0; ; i++) {
      try {
        return await fn();
      } catch (e) {
        const msg = errText(e);
        if (i >= transportRetries || !RETRYABLE.test(msg) || NOT_FOUND.test(msg)) throw e;
        const delay = Math.round(baseDelayMs * 2 ** i * (0.75 + Math.random() * 0.5));
        log({ type: 'transport-retry', label, attempt: i + 1, of: transportRetries, delay, error: msg.slice(0, 200) });
        await sleep(delay);
      }
    }
  }

  async function callModel({ system, prompt, images = [], json = true, meta = {} }) {
    const parts = [{ text: prompt }, ...images.map(inlinePart)];
    const config = { systemInstruction: system };
    if (json) config.responseMimeType = 'application/json';
    const level = thinkingLevels[meta.step] ?? thinkingLevel;
    if (level !== undefined) config.thinkingConfig = { thinkingLevel: level };
    const res = await withBackoff(`model ${meta.step ?? ''}`, () =>
      ai.models.generateContent({ model: textModel, contents: [{ role: 'user', parts }], config }));
    const text = typeof res.text === 'function' ? res.text() : res.text;
    if (typeof text !== 'string' || !text.trim()) {
      const reason = res.candidates?.[0]?.finishReason || res.promptFeedback?.blockReason || 'empty response';
      throw new Error(`model returned no text (${reason})`);
    }
    // Return the raw string: the harness strips fences, parses, and turns a bad parse into a
    // validator error it can retry, instead of a thrown "model call failed".
    return text;
  }

  async function callImage({ image, prompt, meta = {} }) {
    let lastErr;
    while (imageModels.length) {
      const model = imageModels[0];
      try {
        const res = await withBackoff(`image ${meta.photoId ?? ''}`, () => ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ text: prompt }, inlinePart(image)] }],
          config: { responseModalities: ['IMAGE', 'TEXT'] },
        }));
        for (const c of res.candidates || []) {
          for (const part of (c.content && c.content.parts) || []) {
            if (part.inlineData && part.inlineData.data) {
              const bytes = Uint8Array.from(atob(part.inlineData.data), (ch) => ch.charCodeAt(0));
              return new Blob([bytes], { type: part.inlineData.mimeType || 'image/png' });
            }
          }
        }
        const reason = res.candidates?.[0]?.finishReason || res.promptFeedback?.blockReason || 'no image part';
        throw new Error(`image model ${model} returned no image (${reason})`);
      } catch (e) {
        lastErr = e;
        if (!NOT_FOUND.test(errText(e)) || imageModels.length === 1) throw e;
        log({ type: 'image-model-fallback', from: model, to: imageModels[1], error: errText(e).slice(0, 200) });
        imageModels.shift(); // this key can't use that model; stick with the next one for the rest of the run
      }
    }
    throw lastErr;
  }

  return { callModel, callImage };
}

function errText(e) {
  if (!e) return '';
  const parts = [e.message, e.status, e.code, e.error && JSON.stringify(e.error)];
  return parts.filter(Boolean).join(' ');
}

function inlinePart(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('images must be base64 data URLs');
  return { inlineData: { mimeType: m[1], data: m[2] } };
}
