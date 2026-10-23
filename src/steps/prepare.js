// prepare: plumbing only. Reads photo dimensions and makes a downscaled copy of
// each photo for model calls (browser only). Originals are never touched.

export const name = 'prepare';
export const outputKey = 'prepare';
export const description = 'read photo sizes, make model-sized copies';

export async function run(ctx) {
  const { state, options, progress } = ctx;
  const photos = [];
  const canDecode = typeof document !== 'undefined' && typeof createImageBitmap === 'function';
  for (let i = 0; i < state.inputs.photos.length; i++) {
    const src = state.inputs.photos[i];
    progress({ type: 'item:start', step: name, photoId: src.id, index: i, total: state.inputs.photos.length });
    let entry = { id: src.id, name: src.name, width: null, height: null, image: src.dataUrl, scaled: false };
    if (canDecode) {
      try { entry = await downscale(src, options.modelImageMaxSide); } catch (e) {
        progress({ type: 'log', step: name, photoId: src.id, message: `could not decode ${src.name} (${e.message}); using the original for model calls` });
      }
    }
    photos.push(entry);
    progress({ type: 'item:done', step: name, photoId: src.id, index: i, total: state.inputs.photos.length });
  }
  return { photos };
}

async function downscale(src, maxSide) {
  const res = await fetch(src.dataUrl);
  const bitmap = await createImageBitmap(await res.blob());
  const { width, height } = bitmap;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  if (scale >= 1) { bitmap.close?.(); return { id: src.id, name: src.name, width, height, image: src.dataUrl, scaled: false }; }
  const w = Math.round(width * scale), h = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return { id: src.id, name: src.name, width, height, image: canvas.toDataURL('image/jpeg', 0.86), scaled: true, modelWidth: w, modelHeight: h };
}
