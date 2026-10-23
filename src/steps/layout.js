// layout: spec + photos -> layout.json (rooms as rectangles in metres, levels,
// openings, glass walls, adjacency, one camera per photo).

import { checkLayout } from '../validate.js';
import { photoList } from './ingest.js';

export const name = 'layout';
export const outputKey = 'layout';
export const description = 'place rooms, openings and one camera per photo';

export async function run(ctx) {
  const prepared = ctx.output('prepare');
  const spec = ctx.output('spec');
  const schema = await ctx.schema('layout');
  const tpl = await ctx.prompt('layout');
  const vars = { PHOTOS: photoList(prepared), SPEC: spec, SCHEMA: schema };
  const { data, attempts } = await ctx.modelJSON({
    step: name,
    system: ctx.fill(tpl.system, vars),
    prompt: ctx.fill(tpl.user, vars),
    images: prepared.photos.map((p) => p.image),
    schemaName: 'layout',
    check: (layout) => checkLayout(layout, spec),
  });
  ctx.state.steps[name].attempts = attempts;
  return data;
}
