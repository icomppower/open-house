// open-house harness: step runner, progress events, resume, retries.
// The harness is plumbing. It never decides anything about a house; every
// judgment comes from the injected callModel / callImage.

import { validateSchema, formatErrors } from './validate.js';
import * as prepare from './steps/prepare.js';
import * as ingest from './steps/ingest.js';
import * as layout from './steps/layout.js';
import * as enhance from './steps/enhance.js';
import * as judge from './steps/judge.js';
import * as narrate from './steps/narrate.js';

export const VERSION = 1;
export const TEXT_RULE =
  'TEXT RULE: no readable text, logos, brand names, book titles, album art with words or faces, or real names anywhere in the image.';

const STEP_MODULES = [prepare, ingest, layout, enhance, judge, narrate];
export const STEPS = STEP_MODULES.map((m) => m.name);
// Each step writes exactly one named output and never touches another step's output.
export const OUTPUT_KEY = Object.fromEntries(STEP_MODULES.map((m) => [m.name, m.outputKey]));

export const DEFAULT_OPTIONS = Object.freeze({
  maxRetries: 2, // retries after the first attempt, with validator errors appended
  judgeThreshold: 4, // overall < threshold -> enhance redo once
  modelImageMaxSide: 1600, // browser only: photos are downscaled for model calls (originals untouched)
  judgeTour: true,
});

export class HarnessError extends Error {
  constructor(message, info = {}) {
    super(message);
    this.name = 'HarnessError';
    Object.assign(this, info);
  }
}

// ---------------------------------------------------------------- resources

const BASE = new URL('./', import.meta.url);
const cache = new Map();

export async function loadResource(relPath) {
  if (cache.has(relPath)) return cache.get(relPath);
  const url = new URL(relPath, BASE);
  let text;
  if (url.protocol === 'file:') {
    const fs = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    text = await fs.readFile(fileURLToPath(url), 'utf8');
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new HarnessError(`failed to load ${relPath}: HTTP ${res.status}`, { relPath });
    text = await res.text();
  }
  cache.set(relPath, text);
  return text;
}

export async function loadSchema(name, overrides) {
  if (overrides && overrides[name]) return overrides[name];
  return JSON.parse(await loadResource(`./schemas/${name}.json`));
}

// A prompt file has a "## System" section and a "## User" section.
export async function loadPrompt(name, overrides) {
  const text = overrides && overrides[name] ? overrides[name] : await loadResource(`./prompts/${name}.md`);
  return parsePrompt(text, name);
}

export function parsePrompt(text, name = 'prompt') {
  const sys = text.match(/^## System\s*\n([\s\S]*?)(?=^## User\s*$)/m);
  const usr = text.match(/^## User\s*\n([\s\S]*)$/m);
  if (!sys || !usr) throw new HarnessError(`prompt "${name}" needs "## System" and "## User" sections`, { name });
  return { system: sys[1].trim(), user: usr[1].trim() };
}

export function fillTemplate(text, vars) {
  const missing = new Set();
  const out = text.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_, key) => {
    if (!(key in vars)) { missing.add(key); return `{{${key}}}`; }
    const v = vars[key];
    return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  });
  if (missing.size) throw new HarnessError(`prompt has unfilled placeholders: ${[...missing].join(', ')}`, { missing: [...missing] });
  return out;
}

// ---------------------------------------------------------------- images

export function bytesToBase64(bytes) {
  if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

export async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const type = blob.type || 'image/png';
  return `data:${type};base64,${bytesToBase64(bytes)}`;
}

async function normalizePhoto(photo, index) {
  const id = `p${index + 1}`;
  if (typeof photo === 'string') return { id, name: `${id}.jpg`, dataUrl: photo };
  if (typeof Blob !== 'undefined' && photo instanceof Blob) {
    return { id, name: photo.name || `${id}.jpg`, type: photo.type || undefined, dataUrl: await blobToDataUrl(photo) };
  }
  if (photo && typeof photo.dataUrl === 'string') return { id, name: photo.name || `${id}.jpg`, type: photo.type, dataUrl: photo.dataUrl };
  throw new HarnessError(`photo ${index} must be a Blob/File, a data URL string, or { name, dataUrl }`, { index });
}

function assertDataUrl(photo) {
  if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(photo.dataUrl)) {
    throw new HarnessError(`photo ${photo.id} is not a base64 image data URL`, { photoId: photo.id });
  }
}

// ---------------------------------------------------------------- state

export async function createState({ photos }) {
  if (!Array.isArray(photos) || photos.length === 0) throw new HarnessError('runHarness needs at least one photo');
  const normalized = [];
  for (let i = 0; i < photos.length; i++) {
    const p = await normalizePhoto(photos[i], i);
    assertDataUrl(p);
    if (p.type === undefined) delete p.type;
    normalized.push(p);
  }
  const state = {
    version: VERSION,
    id: `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    inputs: { photos: normalized },
    outputs: {},
    steps: Object.fromEntries(STEPS.map((s) => [s, { status: 'pending' }])),
    archive: [],
    log: [],
  };
  deepFreeze(state.inputs);
  return state;
}

export function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) deepFreeze(v);
  }
  return obj;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

function prepareResume(resume, fromStep) {
  if (!resume || typeof resume !== 'object' || resume.version !== VERSION) {
    throw new HarnessError('resume must be a run state produced by this harness version', { version: resume && resume.version });
  }
  const state = clone(resume);
  state.archive ||= [];
  state.log ||= [];
  state.steps ||= {};
  for (const s of STEPS) state.steps[s] ||= { status: 'pending' };
  deepFreeze(state.inputs);

  let start = fromStep;
  if (!start) start = STEPS.find((s) => state.steps[s].status !== 'done') || null;
  if (start === null) return { state, startIndex: STEPS.length };
  const startIndex = STEPS.indexOf(start);
  if (startIndex < 0) throw new HarnessError(`unknown step "${start}" (steps: ${STEPS.join(', ')})`, { fromStep: start });
  for (let i = 0; i < startIndex; i++) {
    const s = STEPS[i];
    if (state.steps[s].status !== 'done' || state.outputs[OUTPUT_KEY[s]] === undefined) {
      throw new HarnessError(`cannot resume from "${start}": step "${s}" has no finished output`, { fromStep: start, missing: s });
    }
  }
  // Steps being re-run keep their previous output in the archive; nothing is overwritten silently.
  for (let i = startIndex; i < STEPS.length; i++) {
    const s = STEPS[i], key = OUTPUT_KEY[s];
    if (state.outputs[key] !== undefined) {
      state.archive.push({ step: s, key, archivedAt: new Date().toISOString(), output: state.outputs[key] });
      delete state.outputs[key];
    }
    state.steps[s] = { status: 'pending' };
  }
  return { state, startIndex };
}

// ---------------------------------------------------------------- model calls

const RETRY_HEADER = 'YOUR PREVIOUS ANSWER WAS REJECTED BY THE VALIDATOR. Fix every error below and answer again with JSON only:';

async function modelJSON(ctx, { step, system, prompt, images = [], schemaName, check, meta = {} }) {
  const schema = await ctx.schema(schemaName);
  const attempts = [];
  let errorsText = '';
  const total = 1 + ctx.options.maxRetries;
  for (let attempt = 1; attempt <= total; attempt++) {
    const fullPrompt = errorsText ? `${prompt}\n\n${RETRY_HEADER}\n${errorsText}` : prompt;
    let out;
    let errors = [];
    try {
      out = await ctx.callModel({ system, prompt: fullPrompt, images, json: true, meta: { ...meta, step, attempt } });
    } catch (e) {
      errors = [{ path: '$', message: `model call failed: ${e && e.message ? e.message : e}` }];
    }
    if (!errors.length && typeof out === 'string') {
      try { out = JSON.parse(stripFences(out)); } catch (e) { errors = [{ path: '$', message: `response is not valid JSON: ${e.message}` }]; }
    }
    if (!errors.length && (out === null || typeof out !== 'object')) errors = [{ path: '$', message: `response must be a JSON object, got ${typeof out}` }];
    if (!errors.length) errors = validateSchema(schema, out);
    if (!errors.length && check) errors = check(out);
    const formatted = formatErrors(errors);
    attempts.push({ attempt, errors: formatted });
    if (!errors.length) return { data: out, attempts: attempt };
    if (attempt < total) ctx.progress({ type: 'retry', step, attempt, of: total, errors: formatted, ...meta });
    errorsText = formatted.map((e) => `- ${e}`).join('\n');
  }
  throw new HarnessError(`${step}: model output failed validation after ${total} attempts`, { step, attempts, ...meta });
}

const stripFences = (s) => s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

// ---------------------------------------------------------------- runner

export async function runHarness(opts = {}) {
  const { callModel, callImage, captureStops = null, tts = null, onProgress = () => {}, prompts = null, schemas = null } = opts;
  if (typeof callModel !== 'function') throw new HarnessError('runHarness needs callModel({ system, prompt, images, json }) -> JSON');
  if (typeof callImage !== 'function') throw new HarnessError('runHarness needs callImage({ image, prompt }) -> Blob');
  const options = { ...DEFAULT_OPTIONS, ...(opts.options || {}) };

  let state, startIndex;
  if (opts.resume) ({ state, startIndex } = prepareResume(opts.resume, opts.fromStep));
  else {
    if (opts.fromStep) throw new HarnessError('fromStep needs resume: a previous run state');
    state = await createState({ photos: opts.photos });
    startIndex = 0;
  }

  const progress = (ev) => {
    const event = { at: new Date().toISOString(), ...ev };
    if (ev.message) state.log.push({ at: event.at, step: ev.step || null, message: ev.message });
    try { onProgress(event, state); } catch { /* a UI error must not stop the run */ }
  };

  const ctx = {
    state,
    options,
    callModel,
    callImage,
    captureStops,
    tts,
    progress,
    textRule: TEXT_RULE,
    schema: (name) => loadSchema(name, schemas),
    prompt: (name) => loadPrompt(name, prompts),
    fill: fillTemplate,
    modelJSON: (args) => modelJSON(ctx, args),
    blobToDataUrl,
    // accepts a step name ('ingest') or its output key ('spec')
    output: (name) => state.outputs[OUTPUT_KEY[name] || name],
  };

  progress({ type: 'run:start', from: STEPS[startIndex] || null, steps: STEPS, message: startIndex ? `resuming from ${STEPS[startIndex]}` : 'starting run' });
  for (let i = startIndex; i < STEPS.length; i++) {
    const mod = STEP_MODULES[i];
    const rec = state.steps[mod.name];
    rec.status = 'running';
    rec.startedAt = new Date().toISOString();
    delete rec.error;
    progress({ type: 'step:start', step: mod.name, index: i, total: STEPS.length, message: `${mod.name}: ${mod.description}` });
    try {
      const output = await mod.run(ctx);
      if (state.outputs[mod.outputKey] !== undefined) throw new HarnessError(`${mod.name} would overwrite outputs.${mod.outputKey}`, { step: mod.name });
      state.outputs[mod.outputKey] = output;
      rec.status = 'done';
      rec.finishedAt = new Date().toISOString();
      progress({ type: 'step:done', step: mod.name, index: i, total: STEPS.length, message: `${mod.name} done` });
    } catch (e) {
      rec.status = 'error';
      rec.finishedAt = new Date().toISOString();
      rec.error = { message: e.message, attempts: e.attempts, photoId: e.photoId, kind: e.kind };
      progress({ type: 'step:error', step: mod.name, index: i, total: STEPS.length, error: rec.error, message: `${mod.name} failed: ${e.message}` });
      const err = e instanceof HarnessError ? e : new HarnessError(`${mod.name}: ${e.message}`, { cause: e });
      err.step = mod.name;
      // the partial state is attached for resume, but hidden from console dumps (it holds image data)
      Object.defineProperty(err, 'state', { value: state, enumerable: false, writable: true });
      progress({ type: 'run:error', step: mod.name, error: rec.error });
      throw err;
    }
  }
  progress({ type: 'run:done', message: 'run complete' });
  return state;
}

// Resolve which image is the final one for a photo after judging:
// the judge's redo if it exists, else the enhance step's output.
export function finalImageFor(state, photoId) {
  const judge = state.outputs.judge;
  const fin = judge && judge.final && judge.final[photoId];
  if (fin) {
    if (fin.source === 'redo') return judge.redos[photoId].image;
    const item = state.outputs.enhance && state.outputs.enhance.items[photoId];
    if (item) return item.attempts[fin.index].image;
  }
  const item = state.outputs.enhance && state.outputs.enhance.items[photoId];
  return item ? item.attempts[item.attempts.length - 1].image : null;
}
