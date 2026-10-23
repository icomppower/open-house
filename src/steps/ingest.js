// ingest: photos -> spec.json (rooms, photo->room map, materials, objects with counts, light).
// The model decides everything here; the harness only validates.

import { checkSpec } from '../validate.js';

export const name = 'ingest';
export const outputKey = 'spec';
export const description = 'read the photos into spec.json';

export function photoList(prepared) {
  return prepared.photos.map((p, i) => `Image ${i + 1} = photo id "${p.id}" (${p.name}${p.width ? `, ${p.width}x${p.height}` : ''})`).join('\n');
}

export async function run(ctx) {
  const prepared = ctx.output('prepare');
  const photoIds = prepared.photos.map((p) => p.id);
  const schema = await ctx.schema('spec');
  const tpl = await ctx.prompt('ingest');
  const vars = { PHOTOS: photoList(prepared), SCHEMA: schema, PHOTO_COUNT: String(photoIds.length) };
  const { data, attempts } = await ctx.modelJSON({
    step: name,
    system: ctx.fill(tpl.system, vars),
    prompt: ctx.fill(tpl.user, vars),
    images: prepared.photos.map((p) => p.image),
    schemaName: 'spec',
    promptName: 'ingest',
    check: (spec) => checkSpec(spec, photoIds),
  });
  ctx.state.steps[name].attempts = attempts;
  return data;
}
