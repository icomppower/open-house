# open-house

Phone photos of a home → a walkable three.js tour + photoreal edits, in the browser, with no build step.

**The harness is plumbing. The model makes every decision.** open-house never looks at a house itself: it does not detect rooms, guess dimensions, pick what to declutter, or decide whether an edit is good. Those judgments all come from the model you inject (built for Gemini 4 Argon; any model that returns JSON and edits images will do). The harness loads the prompts, hands the photos over, validates every answer against a JSON schema and a set of plan checks, retries with the validator's errors, keeps every input and output untouched, traces every call, and renders the result.

## What it does

| Step | Model decides | Harness does |
|---|---|---|
| `prepare` | — | reads photo sizes, downscales copies for model calls (originals untouched) |
| `ingest` | rooms, photo → room map, materials, objects **with counts**, light | validates `spec.json`: every photo mapped, ids consistent |
| `layout` | rooms as rectangles in metres, floor levels, openings, glass walls, adjacency, one camera per photo matched to that photo's view, **catalog keys** for every surface, the **furniture it sees** (counts match the spec) and the **environment** outside | validates `layout.json`: rooms fit the footprint and don't overlap, every camera inside its room, every opening on a shared wall, every key in the catalog, every piece of furniture inside its room and not overlapping another by more than 20 % |
| `enhance` | per photo: the edit prompt (golden-hour light, staging, declutter — same walls, windows, layout) | appends the text rule, calls `callImage` on **that** photo, stores the result as a new output |
| `judge` | **fresh call, separate system prompt**, sees only source + output + spec: scores 1–5 for geometry kept, nothing invented, text rule, artifacts, photoreal; lists defects. Also scores tour screenshots vs photos | overall `< 4` → re-runs enhance **once** with the defects, judges again, keeps the better one as a new output |
| `narrate` | one realtor line per room | validates every room has exactly one line; optional injected TTS |

The viewer (`src/viewer/`) builds the house from `layout.json`: clean architectural geometry (walls, floor slabs at their levels, doors, windows and glass walls with black steel mullions), procedural PBR materials and furniture from the catalog at real-world sizes, a two-scene render (the house in front, sky and the chosen environment behind, so every window shows something), a Sky shader with a PMREM environment, sun from `layout.sun`, PCF soft shadows, RectAreaLight bounce at glass walls, GTAO, bloom, FXAA and a warm grade with vignette and grain. The camera glides stop to stop (one stop per photo, using the layout cameras), drag to look, prev / next / play, a caption per stop, a **Photoreal** toggle that crossfades to that stop's enhanced photo, and a **How it was made** panel built from the call trace. `captureStops()` returns a PNG per stop for the judge. `src/export.js` writes the whole tour as one self-contained HTML file (three.js + addons inlined) plus `trace.json` and `report.md`.

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
- Every model and image call, including every failed attempt, leaves one entry in `state.trace`. The trace is append-only and survives resume.
- Text rule, in every image prompt: *no readable text, logos, brand names, book titles, album art with words or faces, or real names.*

## Quick start (offline demo)

```sh
git clone https://github.com/icomppower/open-house && cd open-house
npm install
npm test            # node tests: schemas, validators, catalog, trace, report, resume, retry-on-bad-JSON, never-overwrite, export
npm run demo        # -> http://localhost:8765/demo/
npx playwright install chromium   # first run: npx playwright install chromium
npm run e2e         # headless browser e2e check (phone + desktop)
```

Press **Use the 6 sample photos**. The demo runs the whole pipeline against a mock model that replays recorded answers from `fixtures/mock/` (one of them, `p4`, scores 3/5 on purpose so you can watch the judge force a redo). You get the furnished tour with the Photoreal toggle, the judge report, the narration, the **How it was made** numbers, a one-file export, `trace.json` / `report.md` downloads, and a resume-from-step control. ES modules don't load from `file://`, so use the little server (or any static server). On a slow phone add `?q=low` to the URL.

## Plug in a real model

`src/adapters/gemini.js` turns a `GoogleGenAI` client into the two functions. The key comes from your host app, never from this repo.

```js
import { GoogleGenAI } from 'https://esm.sh/@google/genai@1';
import { runHarness } from 'https://cdn.jsdelivr.net/gh/icomppower/open-house@v1.1.2/src/harness.js';
import { makeGeminiCallers } from 'https://cdn.jsdelivr.net/gh/icomppower/open-house@v1.1.2/src/adapters/gemini.js';

const ai = new GoogleGenAI({ apiKey: userSuppliedKey });
const { callModel, callImage } = makeGeminiCallers({
  ai,
  textModel: 'gemini-4-argon',
  imageModel: ['gemini-3.1-flash-image', 'gemini-2.5-flash-image'],  // tried in order; a 404 falls through to the next
  thinkingLevels: { layout: 'high', narrate: 'low' },                // Argon thinking is a level, not a budget
  log: console.log,                                                  // transport retries + image-model fallbacks
});
const state = await runHarness({ photos: files, callModel, callImage, onProgress: console.log });
```

Argon outputs text only, so every image edit goes to the separate `imageModel`. Argon ignores `temperature` / `topP` / `topK` and has no explicit caching, so the adapter sends neither. Transport errors (429, 5xx, network) are retried inside the adapter with backoff and never use up the harness's validation retries. Model ids are parameters on purpose: check the current list in AI Studio. The adapter follows the `@google/genai` v1 request shape (`generateContent` with `inlineData` parts, `systemInstruction`, `responseMimeType`, `responseModalities`); `test/adapter.test.js` covers it offline with a fake client. Anything else works too — write two async functions with the signatures above.

### Embed in an AI Studio app (10 lines)

```html
<input id="photos" type="file" accept="image/*" multiple> <div id="tour"></div>
<script type="module">
import { runHarness, finalImageFor } from 'https://cdn.jsdelivr.net/gh/icomppower/open-house@v1.1.2/src/harness.js';
import { makeGeminiCallers } from 'https://cdn.jsdelivr.net/gh/icomppower/open-house@v1.1.2/src/adapters/gemini.js';
import { createViewer } from 'https://cdn.jsdelivr.net/gh/icomppower/open-house@v1.1.2/src/viewer/viewer.js';
import { GoogleGenAI } from 'https://esm.sh/@google/genai@1';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });            // AI Studio injects this at build time
const { callModel, callImage } = makeGeminiCallers({ ai, textModel: 'gemini-4-argon', thinkingLevels: { layout: 'high' } });
const input = document.getElementById('photos');
const files = await new Promise((r) => input.onchange = () => r([...input.files]));
const state = await runHarness({ photos: files, callModel, callImage, onProgress: (e) => console.log(e.type, e.step, e.message ?? '') });
createViewer({ container: tour, layout: state.outputs.layout, spec: state.outputs.spec, narration: state.outputs.narration,
  images: Object.fromEntries(state.inputs.photos.map((p) => [p.id, finalImageFor(state, p.id)])) });
</script>
```

Pass `captureStops: ({ state }) => viewer.captureStops()` to `runHarness` if you want the judge to score the tour renders too (mount the viewer on the `step:done` event for `layout`, as `demo/app.js` does). Pass `report: buildReport(state)` (from `src/report.js`) to `createViewer`, or call `viewer.setReport(...)` later, to fill the **How it was made** panel.

## Trace (`state.trace`, `trace.json`)

The harness appends one entry for **every** `callModel` and `callImage` call, failed attempts included. Entries hold hashes and counts, never images or model text, so the trace stays a few KB and lives inside the run state. Resume appends; nothing is ever rewritten.

```js
{ id: 't21', step: 'judge', photoId: 'p4', attempt: 1, startedAt: '2026-10-22T…', ms: 812,
  kind: 'model',                       // or 'image'
  promptFile: 'judge.md',              // the prompt file behind the call (image calls: enhance.md)
  inputSummary: 'model judge · photo p4 · kind enhance · attempt 1 · 2 images · system 2810 chars · prompt 1460 chars · redo',   // <= 200 chars, counts only
  outputHash: '9f3c…',                 // sha-256 of the raw output (string, JSON or image bytes); null when the call threw
  validator: 'pass',                   // or the list of validator errors for that attempt
  judgeScore: 4,                       // the judge's overall score, judge calls only
  redoOf: 't18' }                      // the entry this call supersedes (redo plan, redo image, second verdict); else null
```

`src/export.js` writes it as `trace.json` (`traceJson(state)`, `downloadTrace(state)`), and `src/report.js` builds `report.md` and the viewer's **How it was made** data **only** from the trace and the judge output: calls and retries per step, score / defects / redone per photo, totals. It never reads or quotes a model-written summary. The tests prove every number equals an independent recount of the trace.

## Catalog (`src/viewer/catalog.js`)

The layout step chooses keys; the viewer alone decides how a key looks. Unknown keys are rejected with the valid list in the error.

- **materials** (`rooms[].floor`, `rooms[].walls`, optional `rooms[].ceiling`, optional `furniture[].material`): `walnut`, `white_oak`, `terrazzo`, `board_concrete`, `marble_viola`, `marble_white`, `plaster`, `limestone`, `redwood_deck`, `tile_white`, `carpet_wool`, `painted_brick`, `cladding_dark`
- **furniture** (`furniture[].item`): `sofa_l`, `sofa_straight`, `lounge_chair`, `ottoman`, `coffee_table_plinth`, `dining_table`, `dining_chair`, `island_waterfall`, `counter_run`, `bar_stool`, `bed_king`, `bed_queen`, `nightstand`, `bench`, `credenza`, `bookshelf_wall`, `fireplace_concrete`, `tub_freestanding`, `vanity_double`, `desk`, `rug`, `plant_tree`, `plant_small`, `pendant_globe`, `floor_lamp`, `table_lamp`
- **environments** (top-level `environment`): `bay_view`, `city_view`, `garden`, `forest`, `neutral_sky`

A furniture entry is `{ id, room, item, x, z, rotation, material? }`: `x, z` is the centre of the footprint in plan metres, `rotation` is degrees clockwise from north (0 faces north, 90 east, 180 south, 270 west). Footprints and heights are real-world sizes fixed in the catalog. Validation: every item sits inside its room's rectangle (rotation included); two floor-standing items may overlap by at most 20 % of the smaller footprint; rugs lie under, pendants hang above and table lamps / small plants sit on other items, so those pairs are free. The prompt tells the model to place only what it sees and to match `spec.objects` counts.

## Resume

```js
const saved = JSON.stringify(state);                       // after any run, finished or failed (err.state)
const again = await runHarness({ resume: JSON.parse(saved), fromStep: 'judge', callModel, callImage });
```

Steps before `fromStep` are reused; `fromStep` and everything after it run again, and their previous outputs move to `state.archive`. Without `fromStep`, the run continues after the last finished step. The trace keeps growing across resumes.

## Progress events

`onProgress(event, state)` receives `run:start`, `step:start`, `item:start` / `item:done` (per photo), `retry` (with the validator errors), `log`, `step:done`, `step:error`, `run:done` / `run:error`. The second argument is the live state, so a UI can render each output as it lands.

## Options

```js
runHarness({ ..., options: { maxRetries: 2, judgeThreshold: 4, modelImageMaxSide: 1600, judgeTour: true },
             prompts: { ingest: '...' }, schemas: { spec: {...} }, tts: async (text) => Blob })
createViewer({ ..., options: { sun: 'golden' | 'day', quality: 'high' | 'low', environment: 'garden', autoplayMs, glideMs, showControls } })
```

`prompts` and `schemas` override the files in `src/prompts/` and `src/schemas/` (the files are also editable in place — they're loaded at runtime, no code changes needed). Each prompt file has a `## System` and a `## User` section; `{{PLACEHOLDERS}}` are filled by the step. The harness passes a `meta` field (`{ step, photoId, attempt, kind, redo }`) on every call for logging and mocks; real adapters can ignore it. The viewer's quality is `?q=low` / `?q=high` in the page URL, else `options.quality`, else automatic (low on a small touch screen). Low drops GTAO and halves the shadow map.

## Layout

```
src/harness.js          step runner, progress events, resume, retries, trace wiring, resource loading
src/trace.js            trace entries, sha-256 (Web Crypto with a pure-JS fallback)
src/report.js           report.md + "How it was made" data, from the trace and the judge output only
src/steps/              prepare, ingest, layout, enhance, judge, narrate
src/validate.js         JSON Schema subset validator + plan checks (rooms, openings, cameras, catalog keys, furniture)
src/prompts/*.md        one prompt file per step (judge has two: photos and tour stops)
src/schemas/*.json      spec, layout (with the catalog enums), enhance, judge, narration
src/viewer/viewer.js    three.js 0.170 tour: two-scene render, sky + PMREM, shadows, GTAO, bloom, FXAA, grade, controls, report panel
src/viewer/catalog.js   material / furniture / environment keys with real-world sizes (data only)
src/viewer/textures.js  procedural PBR maps for every material key
src/viewer/furniture.js builders for every furniture key (rounded boxes + cylinders)
src/viewer/scenery.js   sky, far backdrop per environment, near ground / deck / instanced foliage
src/export.js           one-file HTML export, trace.json, report.md
src/adapters/           gemini.js
demo/                   upload page + progress + tour + judge report + How it was made + export, wired to the mock
fixtures/               6 sample photos, recorded mock responses, mock.js
test/                   node --test
tools/                  static server, fixture renderer, addon bundler, browser e2e check (Playwright, optional)
vendor/                 three.module.js 0.170 + three-addons.module.js (the example addons the viewer uses, one file; MIT)
```

The sample photos are renders of the sample house (catalog materials and furniture from the recorded layout) made by `tools/render-fixtures.mjs`, so the fixtures carry no real people, text or brands.

---

Copyright (c) 2026 icomppower. All rights reserved.
