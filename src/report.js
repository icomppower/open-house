// report: "How it was made", built ONLY from state.trace and the judge output.
// It recounts calls, retries, failures, scores and redos from the trace entries; it never reads
// or quotes model-written summaries (spec.summary, judge notes, narration, layout notes).
// buildReport() returns plain data (what the viewer's panel shows); reportMarkdown() renders it.

import { STEPS } from './harness.js';

export function buildReport(state) {
  const trace = Array.isArray(state.trace) ? state.trace : [];
  const judge = (state.outputs && state.outputs.judge) || null;

  const stepRows = STEPS.filter((s) => s !== 'prepare').map((step) => {
    const entries = trace.filter((t) => t.step === step);
    return {
      step,
      calls: entries.length,
      modelCalls: entries.filter((t) => t.kind === 'model').length,
      imageCalls: entries.filter((t) => t.kind === 'image').length,
      retries: entries.filter((t) => t.attempt > 1).length,
      failed: entries.filter((t) => t.validator !== 'pass').length,
      redos: entries.filter((t) => t.redoOf !== null).length,
      ms: entries.reduce((a, t) => a + t.ms, 0),
    };
  });

  const photoIds = [];
  for (const t of trace) if (t.photoId && !photoIds.includes(t.photoId)) photoIds.push(t.photoId);
  if (judge && judge.photos) for (const id of Object.keys(judge.photos)) if (!photoIds.includes(id)) photoIds.push(id);

  const photos = photoIds.map((photoId) => {
    const mine = trace.filter((t) => t.photoId === photoId);
    const verdicts = mine.filter((t) => t.kind === 'model' && t.step === 'judge' && t.promptFile === 'judge.md' && t.validator === 'pass');
    const tourVerdicts = mine.filter((t) => t.kind === 'model' && t.step === 'judge' && t.promptFile === 'judge-tour.md' && t.validator === 'pass');
    const scores = verdicts.map((t) => t.judgeScore);
    const redone = mine.some((t) => t.redoOf !== null);
    // Defects come from the judge output for the verdict that chose the final image.
    let defects = [];
    const jp = judge && judge.photos && judge.photos[photoId];
    if (jp && Array.isArray(jp.verdicts) && jp.verdicts.length) {
      const fin = judge.final && judge.final[photoId];
      const chosen = fin ? jp.verdicts.find((v) => v.target && v.target.source === fin.source && v.target.index === fin.index) : null;
      const v = chosen || jp.verdicts[jp.verdicts.length - 1];
      defects = (v.defects || []).map((d) => ({ kind: d.kind, severity: d.severity || null, detail: d.detail }));
    }
    return {
      photoId,
      calls: mine.length,
      modelCalls: mine.filter((t) => t.kind === 'model').length,
      imageCalls: mine.filter((t) => t.kind === 'image').length,
      retries: mine.filter((t) => t.attempt > 1).length,
      failed: mine.filter((t) => t.validator !== 'pass').length,
      scores,
      firstScore: scores.length ? scores[0] : null,
      score: scores.length ? scores[scores.length - 1] : null,
      tourScore: tourVerdicts.length ? tourVerdicts[tourVerdicts.length - 1].judgeScore : null,
      redone,
      defects,
    };
  });

  const scored = photos.filter((p) => p.score !== null);
  const tourScored = photos.filter((p) => p.tourScore !== null);
  const totals = {
    calls: trace.length,
    modelCalls: trace.filter((t) => t.kind === 'model').length,
    imageCalls: trace.filter((t) => t.kind === 'image').length,
    retries: trace.filter((t) => t.attempt > 1).length,
    failed: trace.filter((t) => t.validator !== 'pass').length,
    redoCalls: trace.filter((t) => t.redoOf !== null).length,
    photosRedone: photos.filter((p) => p.redone).length,
    photos: photos.length,
    ms: trace.reduce((a, t) => a + t.ms, 0),
    meanScore: scored.length ? round2(scored.reduce((a, p) => a + p.score, 0) / scored.length) : null,
    meanTourScore: tourScored.length ? round2(tourScored.reduce((a, p) => a + p.tourScore, 0) / tourScored.length) : null,
    threshold: judge && judge.summary ? judge.summary.threshold : null,
    firstCall: trace.length ? trace[0].startedAt : null,
    lastCall: trace.length ? trace[trace.length - 1].startedAt : null,
  };
  return { runId: state.id || null, generatedAt: new Date().toISOString(), source: 'state.trace + outputs.judge', steps: stepRows, photos, totals };
}

const round2 = (n) => Number(n.toFixed(2));
const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

export function reportMarkdown(report) {
  const t = report.totals;
  const lines = [];
  lines.push('# How it was made');
  lines.push('');
  lines.push(`Run ${report.runId || '—'} · generated ${report.generatedAt} · every number below is recounted from the call trace (${t.calls} entries) and the judge output. No model-written summary is quoted.`);
  lines.push('');
  lines.push('## Totals');
  lines.push('');
  lines.push(`- Calls: ${t.calls} (${t.modelCalls} model, ${t.imageCalls} image)`);
  lines.push(`- Retries after a rejected answer: ${t.retries} · failed attempts: ${t.failed}`);
  lines.push(`- Photos: ${t.photos} · redone: ${t.photosRedone} (${t.redoCalls} redo calls)`);
  lines.push(`- Judge mean: ${t.meanScore === null ? '—' : `${t.meanScore}/5`} · tour mean: ${t.meanTourScore === null ? '—' : `${t.meanTourScore}/5`}${t.threshold !== null ? ` · redo threshold < ${t.threshold}` : ''}`);
  lines.push(`- Model time: ${fmtMs(t.ms)}`);
  lines.push('');
  lines.push('## Per step');
  lines.push('');
  lines.push('| step | calls | model | image | retries | failed | redo calls | time |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const s of report.steps) lines.push(`| ${s.step} | ${s.calls} | ${s.modelCalls} | ${s.imageCalls} | ${s.retries} | ${s.failed} | ${s.redos} | ${fmtMs(s.ms)} |`);
  lines.push('');
  lines.push('## Per photo');
  lines.push('');
  lines.push('| photo | calls | judge | first | tour | redone | retries | defects |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const p of report.photos) {
    lines.push(`| ${p.photoId} | ${p.calls} | ${p.score === null ? '—' : `${p.score}/5`} | ${p.firstScore === null ? '—' : `${p.firstScore}/5`} | ${p.tourScore === null ? '—' : `${p.tourScore}/5`} | ${p.redone ? 'yes' : 'no'} | ${p.retries} | ${p.defects.length} |`);
  }
  const withDefects = report.photos.filter((p) => p.defects.length);
  if (withDefects.length) {
    lines.push('');
    lines.push('## Defects on the final image');
    lines.push('');
    for (const p of withDefects) {
      lines.push(`- **${p.photoId}**`);
      for (const d of p.defects) lines.push(`  - [${d.kind}${d.severity ? `, ${d.severity}` : ''}] ${d.detail}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
