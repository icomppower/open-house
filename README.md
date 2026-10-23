# open-house

Phone photos of a home → a walkable three.js tour + photoreal edits, in the browser, with no build step.

**The harness is plumbing. The model makes every decision.** open-house never looks at a house itself: it does not detect rooms, guess dimensions, pick what to declutter, or decide whether an edit is good. Those judgments all come from the model you inject (built for Gemini 4 Argon; any model that returns JSON and edits images will do). The harness loads the prompts, hands the photos over, validates every answer against a JSON schema and a set of plan checks, retries with the validator's errors, keeps every input and output untouched, and renders the result.

## What it does

| Step | Model decides | Harness does |
|---|---|---|
| `prepare` | — | reads photo sizes, downscales copies for model calls (originals untouched) |
| `ingest` | rooms, photo → room map, materials, objects **with counts**, light | validates `spec.json`: every photo mapped, ids consistent |
| `layout` | rooms as rectangles in metres, floor levels, openings, glass walls, adjacency, one camera per photo matched to that photo's view | validates `layout.json`: rooms fit the footprint and don't overlap, every camera inside its room, every opening on a shared wall, material names match the spec |
| `enhance` | per photo: the edit prompt (golden-hour light, staging, declutter — same walls, windows, layout) | appends the text rule, calls `callImage` on **that** photo, stores the result as a new output |
| `judge` | **fresh call, separate system prompt**, sees only source + output + spec: scores 1–5 for geometry kept, nothing invented, text rule, artifacts, photoreal; lists defects. Also scores tour screenshots vs photos | overall `< 4` → re-runs enhance **once** with the defects, judges again, keeps the better one as a new output |
| `narrate` | one realtor line per room | validates every room has exactly one line; optional injected TTS |

The viewer (`src/viewer/viewer.js`) builds clean architectural geometry from `layout.json` — walls, floor slabs at their levels, doors, windows and glass walls with black steel mullions, ACES tone mapping, soft shadows, a golden-hour sun option. The camera glides stop to stop (one stop per photo, using the layout cameras), drag to look, prev / next / play, a caption per stop, and a **Photoreal** toggle that crossfades to that stop's enhanced photo. `captureStops()` returns a PNG per stop for the judge. `src/export.js` writes the whole tour as one self-contained HTML file (three.js inlined).

## Hard rules

- Plain ES modules. No build step, no framework, no dependencies. Loads straight from a CDN.
- **No API keys anywhere in the repo.** The model is injected:
  ```js
  runHarness({ photos, callModel, callImage, onProgress })
  callModel({ system, prompt, images, json: true })  // -> parsed JSON  (images are base64 data URLs)
  callImage({ image, prompt })                       // -> image Blob
  ```
- Inputs are never overwritten. `state.inputs` is deep-frozen; every step writes its own named output (`outputs.prepare`, `.spec`, `.layout`, `.enhance`, `.judge`, `.narration`); a re-run step archives its previous output instead of replacing it.
- Every model answer is validated against `src/schemas/*.json` plus plan checks. On failure the harness retries up to 2× with the validator errors appended to the prompt, then stops and surfaces the error. It never guesses.
- State is one serializable object. `JSON.stringify(state)` is a complete checkpoint; any step can resume from it.
- Text rule, in every image prompt: *no readable text, logos, brand names, book titles, album art with words or faces, or real names.*

## Quick start (offline demo)

```sh
git clone https://github.com/icomppower/open-house && cd open-house
npm test            # node tests: schemas, validators, resume, retry-on-bad-JSON, never-overwrite, export
npm run demo        # -> http://localhost:8765/demo/
```

Press **Use the 6 sample photos**. The demo runs the whole pipeline against a mock model that replays recorded answers from `fixtures/mock/` (one of them, `p4`, scores 3/5 on purpose so you can watch the judge force a redo). You get the tour with the Photoreal toggle, the judge report, the narration, a one-file export, and a resume-from-step control. ES modules don't load from `file://`, so use the little server (or any static server).

## Plug in a real model

`src/adapters/gemini.js` turns a `GoogleGenAI` client into the two functions. The key comes from your host app, never from this repo.

```js
import { GoogleGenAI } from 'https://esm.sh/@google/genai@1';
import { runHarness } from 'https://cdn.jsdelivr.net/gh/icomppower/open-house@v1/src/harness.js';
import { makeGeminiCallers } from 'https://cdn.jsdelivr.net/gh/icomppower/open-house@v1/src/adapters/gemini.js';

const ai = new GoogleGenAI({ apiKey: userSuppliedKey });
const { callModel, callImage } = makeGeminiCallers({ ai, textModel: 'gemini-4-argon', imageModel: 'gemini-2.5-flash-image' });
const state = await runHarness({ photos: files, callModel, callImage, onProgress: console.log });
```

Model ids are parameters on purpose: check the current list in AI Studio. The adapter follows the `@google/genai` v1 request shape (`generateContent` with `inlineData` parts, `systemInstruction`, `responseMimeType`, `responseModalities`); the offline tests don't exercise it. Anything else works too — write two async functions with the signatures above.

### Embed in an AI Studio app (10 lines)

```html
<input id="photos" type="file" accept="image/*" multiple> <div id="tour"></div>
<script type="module">
import { runHarness, finalImageFor } from 'https://cdn.jsdelivr.net/gh/icomppower/open-house@v1/src/harness.js';
import { makeGeminiCallers } from 'https://cdn.jsdelivr.net/gh/icomppower/open-house@v1/src/adapters/gemini.js';
import { createViewer } from 'https://cdn.jsdelivr.net/gh/icomppower/open-house@v1/src/viewer/viewer.js';
import { GoogleGenAI } from 'https://esm.sh/@google/genai@1';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });            // AI Studio injects this at build time
const { callModel, callImage } = makeGeminiCallers({ ai, textModel: 'gemini-4-argon' });
const photos = await new Promise((r) => photos.onchange = () => r([...photos.files]));
const state = await runHarness({ photos, callModel, callImage, onProgress: (e) => console.log(e.type, e.step, e.message ?? '') });
createViewer({ container: tour, layout: state.outputs.layout, spec: state.outputs.spec, narration: state.outputs.narration,
  images: Object.fromEntries(state.inputs.photos.map((p) => [p.id, finalImageFor(state, p.id)])) });
</script>
```

Pass `captureStops: ({ state }) => viewer.captureStops()` to `runHarness` if you want the judge to score the tour renders too (mount the viewer on the `step:done` event for `layout`, as `demo/app.js` does).

## Resume

```js
const saved = JSON.stringify(state);                       // after any run, finished or failed (err.state)
const again = await runHarness({ resume: JSON.parse(saved), fromStep: 'judge', callModel, callImage });
```

Steps before `fromStep` are reused; `fromStep` and everything after it run again, and their previous outputs move to `state.archive`. Without `fromStep`, the run continues after the last finished step.

## Progress events

`onProgress(event, state)` receives `run:start`, `step:start`, `item:start` / `item:done` (per photo), `retry` (with the validator errors), `log`, `step:done`, `step:error`, `run:done` / `run:error`. The second argument is the live state, so a UI can render each output as it lands.

## Options

```js
runHarness({ ..., options: { maxRetries: 2, judgeThreshold: 4, modelImageMaxSide: 1600, judgeTour: true },
             prompts: { ingest: '...' }, schemas: { spec: {...} }, tts: async (text) => Blob })
```

`prompts` and `schemas` override the files in `src/prompts/` and `src/schemas/` (the files are also editable in place — they're loaded at runtime, no code changes needed). Each prompt file has a `## System` and a `## User` section; `{{PLACEHOLDERS}}` are filled by the step. The harness passes a `meta` field (`{ step, photoId, attempt, kind }`) on every call for logging and mocks; real adapters can ignore it.

## Layout

```
src/harness.js        step runner, progress events, resume, retries, resource loading
src/steps/            prepare, ingest, layout, enhance, judge, narrate
src/validate.js       JSON Schema subset validator + plan checks
src/prompts/*.md      one prompt file per step (judge has two: photos and tour stops)
src/schemas/*.json    spec, layout, enhance, judge, narration
src/viewer/viewer.js  three.js 0.170 tour (imports vendor/three.module.js, so it works offline from any origin)
src/export.js         one-file HTML export
src/adapters/         gemini.js
demo/                 upload page + progress + tour + judge report, wired to the mock
fixtures/             6 sample photos, recorded mock responses, mock.js
test/                 node --test
tools/                static server, fixture renderer, browser e2e check (Playwright, optional)
vendor/               three.module.js 0.170 (MIT, header kept)
```

The sample photos are renders of the sample house (with simple furniture) made by `tools/render-fixtures.mjs`, so the fixtures carry no real people, text or brands.

---

Copyright (c) 2026 icomppower. All rights reserved.
