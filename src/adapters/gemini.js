// Gemini adapter: turns a GoogleGenAI client into the two functions the harness needs.
// No key lives here; the caller constructs the client. Model ids are parameters because
// they change — check the model list in AI Studio.
//
//   import { GoogleGenAI } from 'https://esm.sh/@google/genai@1';
//   const ai = new GoogleGenAI({ apiKey });              // key supplied by the host app
//   const { callModel, callImage } = makeGeminiCallers({ ai });
//
// Written against the @google/genai v1 request shape (generateContent with inlineData parts,
// systemInstruction, responseMimeType, responseModalities). Not exercised by the offline tests.

export function makeGeminiCallers({ ai, textModel = 'gemini-4-argon', imageModel = 'gemini-2.5-flash-image', thinkingBudget } = {}) {
  if (!ai || !ai.models) throw new Error('makeGeminiCallers needs a GoogleGenAI client as `ai`');

  async function callModel({ system, prompt, images = [], json = true }) {
    const parts = [{ text: prompt }, ...images.map(inlinePart)];
    const config = { systemInstruction: system };
    if (json) config.responseMimeType = 'application/json';
    if (thinkingBudget !== undefined) config.thinkingConfig = { thinkingBudget };
    const res = await ai.models.generateContent({ model: textModel, contents: [{ role: 'user', parts }], config });
    const text = typeof res.text === 'function' ? res.text() : res.text;
    return json ? JSON.parse(text) : text;
  }

  async function callImage({ image, prompt }) {
    const res = await ai.models.generateContent({
      model: imageModel,
      contents: [{ role: 'user', parts: [{ text: prompt }, inlinePart(image)] }],
      config: { responseModalities: ['IMAGE', 'TEXT'] },
    });
    const cands = res.candidates || [];
    for (const c of cands) {
      for (const part of (c.content && c.content.parts) || []) {
        if (part.inlineData && part.inlineData.data) {
          const bytes = Uint8Array.from(atob(part.inlineData.data), (ch) => ch.charCodeAt(0));
          return new Blob([bytes], { type: part.inlineData.mimeType || 'image/png' });
        }
      }
    }
    throw new Error('image model returned no image');
  }

  return { callModel, callImage };
}

function inlinePart(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('images must be base64 data URLs');
  return { inlineData: { mimeType: m[1], data: m[2] } };
}
