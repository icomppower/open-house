// narrate: one realtor line per room -> narration.json. TTS is optional and injected.

import { checkNarration } from '../validate.js';

export const name = 'narrate';
export const outputKey = 'narration';
export const description = 'one realtor line per room';

export async function run(ctx) {
  const spec = ctx.output('spec');
  const layout = ctx.output('layout');
  const judge = ctx.output('judge');
  const schema = await ctx.schema('narration');
  const tpl = await ctx.prompt('narrate');
  const vars = {
    SPEC: spec,
    ROOMS: layout.rooms.map((r) => `${r.id}: ${r.name}, ${r.rect.w} x ${r.rect.d} m, level ${r.level}`).join('\n'),
    JUDGE: judge.summary,
    SCHEMA: schema,
  };
  const { data, attempts } = await ctx.modelJSON({
    step: name,
    system: ctx.fill(tpl.system, vars),
    prompt: ctx.fill(tpl.user, vars),
    images: [],
    schemaName: 'narration',
    check: (n) => checkNarration(n, spec),
  });
  ctx.state.steps[name].attempts = attempts;
  const narration = { ...data };
  if (typeof ctx.tts === 'function') {
    narration.audio = {};
    for (const line of data.lines) {
      ctx.progress({ type: 'item:start', step: name, room: line.room, message: `tts ${line.room}` });
      const blob = await ctx.tts(line.text, { room: line.room });
      if (blob && typeof blob.arrayBuffer === 'function') narration.audio[line.room] = await ctx.blobToDataUrl(blob);
      ctx.progress({ type: 'item:done', step: name, room: line.room });
    }
  }
  return narration;
}
