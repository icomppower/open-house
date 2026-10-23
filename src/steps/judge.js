// judge: a FRESH call with its own system prompt. It sees only the source photo,
// the output image and the room's spec slice. Scores 1-5; overall < threshold ->
// the enhance step is redone once for that photo (recorded here as a redo, so the
// enhance output itself is never modified). Also scores tour screenshots vs photos.

import { checkJudge } from '../validate.js';
import { enhanceOne, roomSlice } from './enhance.js';

export const name = 'judge';
export const outputKey = 'judge';
export const description = 'independent scoring of every edit and tour stop';

async function judgeImage(ctx, { promptName, photoId, kind, sourceImage, outputImage, extra = {}, meta = {} }) {
  const spec = ctx.output('spec');
  const specPhoto = spec.photos.find((p) => p.id === photoId);
  const schema = await ctx.schema('judge');
  const tpl = await ctx.prompt(promptName);
  const vars = { PHOTO_ID: photoId, PHOTO: specPhoto, ROOM: roomSlice(spec, specPhoto.room), SCHEMA: schema, THRESHOLD: String(ctx.options.judgeThreshold), TEXT_RULE: ctx.textRule, ...extra };
  const { data, attempts } = await ctx.modelJSON({
    step: name,
    system: ctx.fill(tpl.system, vars),
    prompt: ctx.fill(tpl.user, vars),
    images: [sourceImage, outputImage],
    schemaName: 'judge',
    check: (v) => checkJudge(v, photoId, ctx.options.judgeThreshold),
    meta: { photoId, kind, ...meta },
  });
  return { ...data, kind, validatorAttempts: attempts, judgedAt: new Date().toISOString() };
}

export async function run(ctx) {
  const { state, options, progress } = ctx;
  const prepared = ctx.output('prepare');
  const enhance = ctx.output('enhance');
  const photos = {};
  const redos = {};
  const final = {};
  const total = prepared.photos.length;

  for (let i = 0; i < total; i++) {
    const { id, image: sourceImage } = prepared.photos[i];
    const item = enhance.items[id];
    if (!item) throw new Error(`no enhance output for ${id}`);
    const idx = item.attempts.length - 1;
    progress({ type: 'item:start', step: name, photoId: id, index: i, total, message: `judge ${id}` });
    const first = await judgeImage(ctx, { promptName: 'judge', photoId: id, kind: 'enhance', sourceImage, outputImage: item.attempts[idx].image, meta: { target: 'enhance', attemptIndex: idx } });
    const verdicts = [{ target: { source: 'enhance', index: idx }, ...first }];
    final[id] = { source: 'enhance', index: idx, overall: first.overall };

    if (first.overall < options.judgeThreshold) {
      progress({ type: 'log', step: name, photoId: id, message: `${id} scored ${first.overall}/5 — redoing the enhance once` });
      const redo = await enhanceOne(ctx, id, { feedback: first.defects, meta: { attemptIndex: idx + 1, redo: true } });
      redos[id] = redo;
      const second = await judgeImage(ctx, { promptName: 'judge', photoId: id, kind: 'enhance', sourceImage, outputImage: redo.image, meta: { target: 'redo', attemptIndex: idx + 1 } });
      verdicts.push({ target: { source: 'redo', index: idx + 1 }, ...second });
      // The better of the two is final; the harness only compares the judge's numbers.
      if (second.overall >= first.overall) final[id] = { source: 'redo', index: idx + 1, overall: second.overall };
      if (second.overall < options.judgeThreshold) progress({ type: 'log', step: name, photoId: id, message: `${id} still ${second.overall}/5 after redo — flagged` });
    }
    photos[id] = { verdicts };
    progress({ type: 'item:done', step: name, photoId: id, index: i, total, overall: final[id].overall });
  }

  let tour = null;
  if (options.judgeTour && typeof ctx.captureStops === 'function') {
    progress({ type: 'log', step: name, message: 'capturing tour stops for the judge' });
    const shots = await ctx.captureStops({ state });
    tour = { shots: {} };
    for (const shot of shots || []) {
      const prep = prepared.photos.find((p) => p.id === shot.photoId);
      if (!prep || !shot.image) continue;
      progress({ type: 'item:start', step: name, photoId: shot.photoId, kind: 'tour', message: `judge tour stop ${shot.photoId}` });
      const verdict = await judgeImage(ctx, {
        promptName: 'judge-tour', photoId: shot.photoId, kind: 'tour', sourceImage: prep.image, outputImage: shot.image,
        extra: { CAMERA: (ctx.output('layout').cameras || []).find((c) => c.photoId === shot.photoId) || null },
        meta: { target: 'tour' },
      });
      tour.shots[shot.photoId] = { image: shot.image, verdict };
      progress({ type: 'item:done', step: name, photoId: shot.photoId, kind: 'tour', overall: verdict.overall });
    }
  } else {
    progress({ type: 'log', step: name, message: 'no captureStops provided — tour screenshots not judged' });
  }

  const finals = Object.values(final).map((f) => f.overall);
  const tourScores = tour ? Object.values(tour.shots).map((s) => s.verdict.overall) : [];
  const summary = {
    threshold: options.judgeThreshold,
    photos: total,
    meanEnhance: finals.length ? Number((finals.reduce((a, b) => a + b, 0) / finals.length).toFixed(2)) : null,
    redone: Object.keys(redos),
    flagged: Object.entries(final).filter(([, f]) => f.overall < options.judgeThreshold).map(([id]) => id),
    tourStops: tourScores.length,
    meanTour: tourScores.length ? Number((tourScores.reduce((a, b) => a + b, 0) / tourScores.length).toFixed(2)) : null,
    tourFlagged: tour ? Object.entries(tour.shots).filter(([, s]) => s.verdict.overall < options.judgeThreshold).map(([id]) => id) : [],
  };
  return { photos, redos, final, tour, summary };
}
