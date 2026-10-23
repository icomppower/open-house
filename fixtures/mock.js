// Mock callModel / callImage that replay recorded responses from fixtures/mock/.
// Works in the browser (demo) and in Node (tests). No model, no keys, no network.
//
// Dispatch uses the `meta` field the harness adds to every call ({ step, photoId, kind, attempt }).
// A real adapter can ignore `meta`.

const BASE = new URL('./', import.meta.url);

export async function loadText(relPath) {
  const url = new URL(relPath, BASE);
  if (url.protocol === 'file:') {
    const fs = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    return fs.readFile(fileURLToPath(url), 'utf8');
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`mock: failed to load ${relPath} (${res.status})`);
  return res.text();
}

export async function loadBytes(relPath) {
  const url = new URL(relPath, BASE);
  if (url.protocol === 'file:') {
    const fs = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    return new Uint8Array(await fs.readFile(fileURLToPath(url)));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`mock: failed to load ${relPath} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

// The six sample photos as { name, dataUrl } (what runHarness accepts).
export async function loadSamplePhotos() {
  const manifest = JSON.parse(await loadText('./manifest.json'));
  const photos = [];
  for (const p of manifest.photos) {
    const bytes = await loadBytes(`./${p.file}`);
    photos.push({ name: p.file.split('/').pop(), dataUrl: `data:image/jpeg;base64,${toBase64(bytes)}`, caption: p.caption });
  }
  return photos;
}

export function toBase64(bytes) {
  if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const clone = (v) => JSON.parse(JSON.stringify(v));

// options.delay: ms per call (demo pacing). options.log: fn(call) for the demo.
export function createMockCallers(options = {}) {
  const { delay = 0, log = null } = options;
  const recorded = {};
  const counters = {};
  const calls = [];
  const wait = () => (delay ? new Promise((r) => setTimeout(r, delay)) : null);

  async function rec(name) {
    if (!recorded[name]) recorded[name] = JSON.parse(await loadText(`./mock/${name}.json`));
    return recorded[name];
  }
  // Recorded answers for per-photo steps are arrays; the n-th call for a key gets the n-th answer
  // (the last one repeats), which is how the p4 redo is replayed.
  function nth(list, key) {
    const i = counters[key] || 0;
    counters[key] = i + 1;
    return clone(list[Math.min(i, list.length - 1)]);
  }

  async function callModel({ system, prompt, images = [], json, meta = {} }) {
    const call = { kind: 'model', meta, system, prompt, imageCount: images.length, json };
    calls.push(call);
    if (log) log(call);
    await wait();
    const step = meta.step || stepFromSystem(system);
    switch (step) {
      case 'ingest': return clone(await rec('spec'));
      case 'layout': return clone(await rec('layout'));
      case 'enhance': return nth((await rec('enhance'))[meta.photoId], `enhance:${meta.photoId}`);
      case 'judge': {
        const file = meta.kind === 'tour' ? 'judge-tour' : 'judge';
        return nth((await rec(file))[meta.photoId], `${file}:${meta.photoId}`);
      }
      case 'narrate': return clone(await rec('narration'));
      default: throw new Error(`mock callModel: unknown step "${step}"`);
    }
  }

  async function callImage({ image, prompt, meta = {} }) {
    const call = { kind: 'image', meta, prompt, imageLength: image.length };
    calls.push(call);
    if (log) log(call);
    await wait();
    if (typeof document !== 'undefined') return gradeInBrowser(image, meta);
    return dataUrlToBlob(image); // Node: the "edit" is the original bytes
  }

  return { callModel, callImage, calls, counters };
}

function stepFromSystem(system = '') {
  const m = /open-house \/ ([a-z-]+)/.exec(system);
  return m ? m[1].replace(/-.*/, '') : null;
}

export function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const type = /data:([^;]+)/.exec(head)[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

// Demo stand-in for a photoreal edit: golden-hour grade with a soft warm glow.
// Deterministic, so the demo looks the same every run.
async function gradeInBrowser(dataUrl, meta) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.filter = 'saturate(1.12) contrast(1.06) brightness(1.04)';
  ctx.drawImage(img, 0, 0);
  ctx.filter = 'none';
  const warm = ctx.createLinearGradient(0, 0, canvas.width, canvas.height * 0.6);
  warm.addColorStop(0, 'rgba(255,170,80,0.28)');
  warm.addColorStop(0.6, 'rgba(255,200,120,0.12)');
  warm.addColorStop(1, 'rgba(80,60,120,0.10)');
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'multiply';
  const vig = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.45, canvas.width / 2, canvas.height / 2, canvas.height * 0.95);
  vig.addColorStop(0, 'rgba(255,255,255,1)');
  vig.addColorStop(1, 'rgba(210,190,170,1)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
  if (meta.redo) { // make the redo visibly different from the first attempt
    ctx.fillStyle = 'rgba(255,235,200,0.08)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
}
