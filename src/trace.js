// trace: one append-only entry per callModel / callImage call, including failed attempts.
// Entries carry hashes and counts, never the images or the model text, so a trace stays small
// enough to live inside the run state and survive resume (append, never rewrite).
//
// { id, step, photoId|null, attempt, startedAt, ms, kind: "model"|"image", promptFile,
//   inputSummary (<=200 chars), outputHash (sha-256 hex of the raw output), validator: "pass" | [errors],
//   judgeScore|null, redoOf|null }

export const SUMMARY_MAX = 200;

// ---------------------------------------------------------------- sha-256

const encoder = new TextEncoder();

export async function sha256Hex(input) {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input instanceof Uint8Array ? input : new Uint8Array(input);
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (subtle) {
    try { return hex(new Uint8Array(await subtle.digest('SHA-256', bytes))); } catch { /* fall through (non-secure context) */ }
  }
  return hex(sha256Bytes(bytes));
}

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

// Pure-JS SHA-256 for pages served over plain http on a LAN, where crypto.subtle is missing.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Bytes(msg) {
  const len = msg.length;
  const withPad = ((len + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(withPad);
  buf.set(msg);
  buf[len] = 0x80;
  const bits = len * 8;
  buf[withPad - 4] = (bits >>> 24) & 0xff; buf[withPad - 3] = (bits >>> 16) & 0xff; buf[withPad - 2] = (bits >>> 8) & 0xff; buf[withPad - 1] = bits & 0xff;
  buf[withPad - 5] = Math.floor(bits / 2 ** 32) & 0xff;
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < withPad; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = (buf[off + i * 4] << 24) | (buf[off + i * 4 + 1] << 16) | (buf[off + i * 4 + 2] << 8) | buf[off + i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) { out[i * 4] = H[i] >>> 24; out[i * 4 + 1] = (H[i] >>> 16) & 0xff; out[i * 4 + 2] = (H[i] >>> 8) & 0xff; out[i * 4 + 3] = H[i] & 0xff; }
  return out;
}

// ---------------------------------------------------------------- entries

export function summarize(text) {
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length <= SUMMARY_MAX ? s : `${s.slice(0, SUMMARY_MAX - 1)}…`;
}

const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;

// Mechanical description of a call's inputs: counts and sizes only, no model text.
export function modelInputSummary({ step, photoId, images = [], system = '', prompt = '', attempt, meta = {} }) {
  const bits = [`model ${step}`, photoId ? `photo ${photoId}` : null, meta.kind ? `kind ${meta.kind}` : null,
    `attempt ${attempt}`, `${images.length} image${images.length === 1 ? '' : 's'}`, `system ${system.length} chars`, `prompt ${prompt.length} chars`,
    meta.redo ? 'redo' : null];
  return summarize(bits.filter(Boolean).join(' · '));
}
export function imageInputSummary({ step, photoId, image = '', prompt = '', meta = {} }) {
  const bits = [`image ${step}`, photoId ? `photo ${photoId}` : null, `source ${kb(image.length * 0.75)}`, `prompt ${prompt.length} chars`, meta.redo ? 'redo' : null];
  return summarize(bits.filter(Boolean).join(' · '));
}

// redoOf: the latest earlier entry this call supersedes (same kind, step, photo and prompt file,
// itself not a redo). null when the call is not a redo or nothing matches.
export function findRedoOf(trace, { kind, step, photoId, promptFile }) {
  for (let i = trace.length - 1; i >= 0; i--) {
    const t = trace[i];
    if (t.kind === kind && t.step === step && t.photoId === photoId && t.promptFile === promptFile && t.redoOf === null) return t.id;
  }
  return null;
}

export function nextTraceId(trace) {
  return `t${trace.length + 1}`;
}

export function appendTrace(state, entry) {
  state.trace ||= [];
  const full = {
    id: nextTraceId(state.trace),
    step: entry.step,
    photoId: entry.photoId ?? null,
    attempt: entry.attempt ?? 1,
    startedAt: entry.startedAt,
    ms: Math.max(0, Math.round(entry.ms)),
    kind: entry.kind,
    promptFile: entry.promptFile ?? null,
    inputSummary: summarize(entry.inputSummary || ''),
    outputHash: entry.outputHash ?? null,
    validator: entry.validator === 'pass' ? 'pass' : Array.isArray(entry.validator) ? entry.validator.slice() : ['unknown validator result'],
    judgeScore: entry.judgeScore ?? null,
    redoOf: entry.redoOf ?? null,
  };
  state.trace.push(full);
  return full;
}

// Raw output -> bytes for hashing. Strings and objects are hashed as text; Blobs as bytes.
export async function hashOutput(out) {
  if (out === undefined) return null;
  if (typeof out === 'string') return sha256Hex(out);
  if (out && typeof out.arrayBuffer === 'function') return sha256Hex(new Uint8Array(await out.arrayBuffer()));
  if (out instanceof Uint8Array) return sha256Hex(out);
  try { return await sha256Hex(JSON.stringify(out)); } catch { return null; }
}

export const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
