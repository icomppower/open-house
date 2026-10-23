// Demo wiring: upload -> runHarness (mock model) -> tour + judge report + export + resume.
import { runHarness, STEPS, finalImageFor } from '../src/harness.js';
import { createViewer } from '../src/viewer/viewer.js';
import { downloadTour } from '../src/export.js';
import { createMockCallers, loadSamplePhotos } from '../fixtures/mock.js';

const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);

let photos = [];
let state = null;
let viewer = null;
const events = [];
window.__oh = { events, get state() { return state; }, get viewer() { return viewer; }, STEPS }; // for tests / #debug

// ---- photos
$('btn-sample').addEventListener('click', async () => {
  $('btn-sample').disabled = true;
  try {
    photos = await loadSamplePhotos();
    renderThumbs(photos.map((p) => ({ name: p.name, dataUrl: p.dataUrl })));
    await run();
  } finally { $('btn-sample').disabled = false; }
});
$('file').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  photos = files;
  renderThumbs(await Promise.all(files.map(async (f) => ({ name: f.name, dataUrl: URL.createObjectURL(f) }))));
  await run();
});
function renderThumbs(list) {
  $('thumbs').innerHTML = list.map((p, i) => `<figure style="margin:0"><img src="${p.dataUrl}" alt=""><figcaption>p${i + 1} · ${esc(p.name)}</figcaption></figure>`).join('');
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- run
function callers() {
  return createMockCallers({ delay: Number($('pace').value) });
}

async function run() {
  resetUi();
  show('progress');
  try {
    state = await runHarness({ photos, ...callers(), captureStops, onProgress });
    finish();
  } catch (e) {
    fail(e);
  }
}

async function resume() {
  if (!state) return;
  const fromStep = $('resume-step').value;
  $('log').textContent = '';
  for (const s of STEPS) setStep(s, STEPS.indexOf(s) < STEPS.indexOf(fromStep) ? 'done' : 'pending');
  note(`resuming from "${fromStep}" with the saved state; earlier outputs are reused, later ones are archived`);
  try {
    state = await runHarness({ resume: state, fromStep, ...callers(), captureStops, onProgress });
    finish();
  } catch (e) {
    fail(e);
  }
}

function resetUi() {
  events.length = 0;
  $('log').textContent = '';
  $('steps').innerHTML = STEPS.map((s) => `<span class="step" data-step="${s}">${s}</span>`).join('');
  ['tour', 'judge', 'narration', 'actions'].forEach((id) => show(id, false));
  if (viewer) { viewer.dispose(); viewer = null; }
  $('report').innerHTML = '';
}
function setStep(name, status) {
  const el = document.querySelector(`.step[data-step="${name}"]`);
  if (el) el.className = `step ${status}`;
}
function log(msg) {
  const el = $('log');
  el.textContent += `${msg}\n`;
  el.scrollTop = el.scrollHeight;
}
function note(msg) { $('action-note').textContent = msg; }

function onProgress(ev, st) {
  events.push(ev);
  state = st;
  if (ev.type === 'run:start') $('run-id').textContent = st.id;
  if (ev.type === 'step:start') setStep(ev.step, 'running');
  if (ev.type === 'step:done') { setStep(ev.step, 'done'); afterStep(ev.step, st); }
  if (ev.type === 'step:error') setStep(ev.step, 'error');
  if (ev.type === 'retry') log(`  retry ${ev.attempt}/${ev.of} — ${ev.errors.join('; ')}`);
  if (ev.message) log(`[${ev.step || 'run'}] ${ev.message}`);
}

function afterStep(step, st) {
  if (step === 'layout') mountViewer(st);
  if (step === 'enhance' && viewer) viewer.setImages(imagesFor(st));
  if (step === 'judge') { if (viewer) viewer.setImages(imagesFor(st)); renderJudge(st); }
  if (step === 'narrate' && viewer) viewer.setNarration(st.outputs.narration);
}

function imagesFor(st) {
  return Object.fromEntries(st.inputs.photos.map((p) => [p.id, finalImageFor(st, p.id)]).filter(([, v]) => v));
}

function mountViewer(st) {
  if (viewer) viewer.dispose();
  show('tour');
  viewer = createViewer({
    container: $('viewer'),
    layout: st.outputs.layout,
    spec: st.outputs.spec,
    narration: st.outputs.narration || null,
    images: imagesFor(st),
    order: st.inputs.photos.map((p) => p.id),
  });
}

// The judge asks for a render per stop; the demo answers with the live viewer.
async function captureStops({ state: st }) {
  if (!viewer) mountViewer(st);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return viewer.captureStops({ width: 960, height: 720 });
}

function finish() {
  renderJudge(state);
  renderNarration(state);
  show('actions');
  note(`run ${state.id} complete — ${state.archive.length ? `${state.archive.length} archived output(s) from re-run steps` : 'no re-runs'}`);
  window.__oh.done = true;
}
function fail(e) {
  log(`ERROR: ${e.message}`);
  if (e.attempts) for (const a of e.attempts) log(`  attempt ${a.attempt}: ${a.errors.join('; ')}`);
  if (e.state) { state = e.state; show('actions'); note(`the run stopped at "${e.step}". Fix the model or prompt, then resume from that step.`); }
  window.__oh.error = e.message;
}

// ---- judge report
function renderJudge(st) {
  const judge = st.outputs.judge;
  if (!judge) return;
  show('judge');
  const s = judge.summary;
  $('judge-summary').textContent = `mean ${s.meanEnhance}/5 over ${s.photos} photos · redone: ${s.redone.join(', ') || 'none'} · flagged: ${s.flagged.join(', ') || 'none'}` + (s.meanTour !== null ? ` · tour ${s.meanTour}/5` : ' · tour not judged');
  const rows = st.inputs.photos.map((p) => {
    const ph = judge.photos[p.id];
    const fin = judge.final[p.id];
    const last = ph.verdicts[ph.verdicts.length - 1];
    const first = ph.verdicts[0];
    const tour = judge.tour && judge.tour.shots[p.id];
    const scores = (v) => Object.entries(v.scores).map(([k, n]) => `<span class="score s${n}" title="${k}">${n}</span>`).join('');
    const defects = (v) => (v.defects.length ? `<ul class="defects">${v.defects.map((d) => `<li>[${d.kind}] ${esc(d.detail)}</li>`).join('')}</ul>` : '<div class="defects">no defects</div>');
    return `<div class="pr" data-photo="${p.id}">
      <figure style="margin:0"><img src="${p.dataUrl}" alt=""><figcaption>${p.id} original</figcaption></figure>
      <figure style="margin:0"><img src="${finalImageFor(st, p.id)}" alt=""><figcaption>enhanced${fin.source === 'redo' ? ' (redo)' : ''} · overall ${fin.overall}/5</figcaption></figure>
      <div class="meta">
        <div><b>Enhance:</b> ${scores(last)} overall <b>${last.overall}</b>${ph.verdicts.length > 1 ? `<span class="badge redo">redone · first ${first.overall}/5</span>` : ''}${fin.overall < s.threshold ? '<span class="badge flag">flagged</span>' : ''}</div>
        ${ph.verdicts.length > 1 ? `<div style="color:var(--dim);font-size:12px">first attempt defects:</div>${defects(first)}` : ''}
        ${defects(last)}
        ${tour ? `<div style="margin-top:8px"><b>Tour stop:</b> ${scores(tour.verdict)} overall <b>${tour.verdict.overall}</b></div>${defects(tour.verdict)}<img src="${tour.image}" alt="" style="margin-top:6px;max-width:240px;border-radius:8px;display:block">` : ''}
      </div>
    </div>`;
  });
  $('report').innerHTML = rows.join('');
}

function renderNarration(st) {
  const n = st.outputs.narration;
  if (!n) return;
  show('narration');
  const names = Object.fromEntries(st.outputs.spec.rooms.map((r) => [r.id, r.name]));
  $('narr-intro').textContent = n.intro || '';
  $('narr-lines').innerHTML = n.lines.map((l) => `<li><b>${esc(names[l.room] || l.room)}</b>${esc(l.text)}</li>`).join('');
}

// ---- export / state / resume
$('btn-export').addEventListener('click', async () => {
  const built = await downloadTour(state, { title: 'Home tour' });
  note(`exported ${built.filename} (${(built.bytes / 1e6).toFixed(1)} MB, three.js ${built.inlined ? 'inlined' : 'from CDN'})`);
});
$('btn-state').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
});
$('btn-resume').addEventListener('click', resume);
$('state-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  state = JSON.parse(await f.text());
  resetUi();
  show('progress');
  for (const s of STEPS) setStep(s, state.steps[s]?.status || 'pending');
  renderThumbs(state.inputs.photos);
  if (state.outputs.layout) mountViewer(state);
  if (viewer && state.outputs.narration) viewer.setNarration(state.outputs.narration);
  finish();
  note(`loaded ${state.id}; pick a step and press Resume to re-run from there`);
});
