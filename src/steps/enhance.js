// enhance: per photo, the model writes an edit prompt; callImage edits THAT photo.
// Output is append-only: items[photoId].attempts[] (the judge may add a redo later,
// which lives in the judge output, not here).

import { checkEnhance } from '../validate.js';

export const name = 'enhance';
export const outputKey = 'enhance';
export const description = 'write an edit prompt per photo and render the edit';

export function roomSlice(spec, roomId) {
  return {
    room: spec.rooms.find((r) => r.id === roomId) || null,
    materials: spec.materials.filter((m) => !m.rooms || m.rooms.length === 0 || m.rooms.includes(roomId)),
    objects: spec.objects.filter((o) => o.room === roomId),
    light: spec.light.find((l) => l.room === roomId) || null,
  };
}

export function composeImagePrompt(plan, textRule) {
  const list = (title, arr) => (arr && arr.length ? `${title}\n${arr.map((s) => `- ${s}`).join('\n')}` : null);
  return [
    plan.editPrompt.trim(),
    plan.lighting ? `LIGHTING: ${plan.lighting}` : null,
    list('KEEP EXACTLY (same walls, windows, doors, layout, camera, proportions):', plan.keep),
    list('REMOVE (declutter only):', plan.remove),
    list('ADD (staging that fits the room; nothing structural):', plan.add),
    list('AVOID:', plan.negative),
    `HARD RULE — ${textRule}`,
  ].filter(Boolean).join('\n\n');
}

// Enhance one photo. feedback (optional) is a list of judge defects for a redo.
export async function enhanceOne(ctx, photoId, { feedback = null, meta = {} } = {}) {
  const prepared = ctx.output('prepare');
  const spec = ctx.output('spec');
  const original = ctx.state.inputs.photos.find((p) => p.id === photoId);
  const prep = prepared.photos.find((p) => p.id === photoId);
  const specPhoto = spec.photos.find((p) => p.id === photoId);
  const schema = await ctx.schema('enhance');
  const tpl = await ctx.prompt('enhance');
  const vars = {
    PHOTO_ID: photoId,
    PHOTO: specPhoto,
    ROOM: roomSlice(spec, specPhoto.room),
    SCHEMA: schema,
    TEXT_RULE: ctx.textRule,
    FEEDBACK: feedback && feedback.length
      ? `A previous edit of this photo was rejected by an independent judge. Fix these defects:\n${feedback.map((d) => `- [${d.kind}] ${d.detail}`).join('\n')}`
      : 'This is the first edit of this photo.',
  };
  const { data: plan, attempts } = await ctx.modelJSON({
    step: name,
    system: ctx.fill(tpl.system, vars),
    prompt: ctx.fill(tpl.user, vars),
    images: [prep.image],
    schemaName: 'enhance',
    promptName: 'enhance',
    check: (p) => checkEnhance(p, photoId),
    meta: { photoId, ...meta },
  });
  const imagePrompt = composeImagePrompt(plan, ctx.textRule);
  const blob = await ctx.image({ image: original.dataUrl, prompt: imagePrompt, meta: { step: name, photoId, ...meta }, promptFile: 'enhance.md' });
  const image = await ctx.blobToDataUrl(blob);
  return { photoId, plan, imagePrompt, image, planAttempts: attempts, createdAt: new Date().toISOString(), redo: Boolean(feedback) };
}

export async function run(ctx) {
  const prepared = ctx.output('prepare');
  const items = {};
  for (let i = 0; i < prepared.photos.length; i++) {
    const { id } = prepared.photos[i];
    ctx.progress({ type: 'item:start', step: name, photoId: id, index: i, total: prepared.photos.length, message: `enhance ${id}` });
    const attempt = await enhanceOne(ctx, id, { meta: { attemptIndex: 0 } });
    items[id] = { attempts: [attempt] };
    ctx.progress({ type: 'item:done', step: name, photoId: id, index: i, total: prepared.photos.length });
  }
  return { items };
}
