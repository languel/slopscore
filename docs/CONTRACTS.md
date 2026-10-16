# Slopscore 2.0 — Internal Contracts

This is the binding interface spec between the subsystems (kits, CLI, studio, renderers, MCP).
If you change a contract, update this file in the same change.

Repo root: `~/dev/slopscore` (referred to as `REPO`). A *project* is any directory with a
`slopscore.config.js` (referred to as `ROOT`).

---

## 1. Project layout

```
ROOT/
├── slopscore.config.js        # export default defineConfig({...})  (see SPEC.md §7)
├── assets/                    # source media: .mp4 .webm .ogv .mov .gif .png .jpg .svg
├── score/score.wav            # optional pre-made score (otherwise synthesized)
├── score/stems/*.wav          # optional stems (drums.wav, bass.wav, ...)
├── scenes/                    # optional per-engine scene modules (browser/fframes/hyperframes)
├── feedback/
│   ├── notes.json             # director notes (array)
│   ├── clips.json             # clip library (array)
│   ├── versions.json          # { activeVersion, versions:[...] }
│   ├── asset_annotations.json # { [sourceId]: {annotations, tags, rating, updatedAt} }
│   ├── overrides.json         # live studio overrides { shaders:{}, camera:{}, chapters:{[chapterId]:{...}} }
│   ├── FEEDBACK.md            # generated from notes.json
│   ├── media/                 # uploaded reference images
│   └── backups/
└── out/                       # generated (gitignored)
    ├── score.wav  stems/<id>.wav|.mp3
    ├── features.bin           # Float32 stride 6 @ project.fps: rms,bass,mid,high,transient,glitch
    ├── context.bin            # Float32 stride 32 @ project.fps (see §3)
    ├── context.json           # { width,height,fps,frameCount,start,stride:32,layout:[...] }
    ├── archive_bank.bin       # rgb24 frames, bank.width × bank.height each (see §4)
    ├── bank.json              # bank manifest (see §4)
    ├── native-render          # compiled native binary
    ├── sheet.jpg  video.mp4  preview.mp4
    └── versions/<id>/{video.mp4,sheet.jpg}
```

Path helpers: `kit/config-loader.mjs` → `loadProject(dir)` returns `{ root, project, paths, raw, validation }`.
`project` is the **normalized** shape from `kit/project-schema.js#normalizeProject` — always use it,
never the raw config. Key normalized fields:

```js
project.audio = { bpm, timeSignature, durationSeconds, scorePath, stemsDir, synth, key, sampleRate, stems:[{id,name,color,role}] }
project.renderer        // 'native'|'webgpu'|'threejs'|'fframes'|'hyperframes'|'pixijs'|'p5js'
project.resolution      // [w, h]
project.fps
project.scene           // project-relative path of a scene module for browser/fframes/hyperframes engines, or null
project.chapters[i] = { index, id, name, startBar, endBar, start, end /*seconds*/, color, mood,
                        clipLoopId, asset, particleRig, vp:[u,v], camera:{type,...}, shaders:{...},
                        transitionBars, params }
project.cues = [{ bar, label, time }]
project.sheet.times = [seconds...]
project.bank = { width:320, height:180, fps:15, maxFrames:150 }
project.studio.port
```

Bars are **1-based** everywhere (t=0 → bar 1.0). `endBar` is inclusive.

## 2. RenderFrameContext (JS)

Built ONLY by `kit/frame-context.js#createTimeline(project, {features, clips, bank, overrides}).contextAt(t)`:

```js
{
  time, fps, frame,
  bar, barIndex, beatIndex, beatInBar, beatPhase, measurePhase, phrase4Bar, pulse, downbeatPulse,
  chapter, nextChapter, chapterId, chapterName, chProgress, chMorphT,
  audio: { rms, bass, mid, high, transient, glitch },     // 0..1
  stems,                                                  // optional
  camera: { panX, panY, dist, fov /*degrees*/, roll /*radians*/, charScale },
  rig, nextRig,                                           // particle rig names (PARTICLE_RIGS)
  vp: [u, v],                                             // vanishing point / subject anchor 0..1
  shaders: { crtScanlines, chromaticAberration, lumaRelief, reliefDepth, vignette, plexus, plexusDistance, phosphorGlow, ...custom },
  params,                                                 // chapter.params (free-form)
  clip: { a: {id, sourceId, index, frame, localTime}, b: {...} },  // a = current chapter, b = next (for morphs)
  resolution: [w, h], bpm, barSec, beatSec,
  assets                                                   // AssetManager (browser hosts inject it)
}
```

Particle rigs (`kit/project-schema.js#PARTICLE_RIGS`, numeric id = index):
`0 none, 1 gears, 2 voxels, 3 sparkRings, 4 crystals, 5 helix, 6 spiral, 7 butterflies, 8 relief`.

Camera types: `static, dollyPush, lateralTrack, breathing, recoilShake, vertigo, vista, pullBack, orbit`.

## 3. context.bin (native C / Rust consumers)

Little-endian Float32, `CONTEXT_STRIDE = 32` floats per frame, frame `i` at byte `i*128`.
Frame 0 of the file corresponds to `context.json.start` (absolute frame index).

| idx | field | idx | field | idx | field | idx | field |
|---|---|---|---|---|---|---|---|
| 0 | time | 8 | chMorphT | 16 | panY | 24 | frameB |
| 1 | bar (1-based) | 9 | rms | 17 | dist | 25 | rigA |
| 2 | beatPhase | 10 | bass | 18 | fov (deg) | 26 | rigB |
| 3 | measurePhase | 11 | mid | 19 | roll (rad) | 27 | vpU |
| 4 | phrase4Bar | 12 | high | 20 | charScale | 28 | vpV |
| 5 | chapter | 13 | transient | 21 | clipA (bank clip index, -1 none) | 29 | scanlines (0..1) |
| 6 | nextChapter | 14 | glitch | 22 | clipB | 30 | chroma (chromatic aberration 0..1) |
| 7 | chProgress | 15 | panX | 23 | frameA (ABSOLUTE bank frame, -1 none) | 31 | reliefDepth (0 = relief off) |

Focal length in pixels for a projection of height H: `f = (H/2) / tan(fov_deg * π / 360)` (fov 56° @720p ≈ 677px, matching v4's 680).

## 4. Asset bank

`out/archive_bank.bin`: concatenated rgb24 frames, each `bank.width*bank.height*3` bytes.
`out/bank.json`:

```json
{ "width": 320, "height": 180, "fps": 15, "frameBytes": 172800, "totalFrames": 700,
  "clips": [ { "key": "clip-tc-1", "index": 0, "sourceId": "westinghouse.webm", "inSec": 4.5, "outSec": 6.6, "offset": 0, "count": 32, "fps": 15 } ] }
```

`key` = clip id (from clips.json) or asset filename (chapters may reference `asset` directly).
Built by `kit/asset-bank.mjs#buildAssetBank(loaded)` (ffmpeg).

## 5. Native renderer CLI (`renderers/native/`)

Source `renderers/native/native-render-core.m` (+ `context.h`), built by `slopscore build` into `ROOT/out/native-render`:

```
clang -O3 -fobjc-arc -framework Foundation -framework CoreGraphics -framework CoreText -framework ImageIO \
      REPO/renderers/native/native-render-core.m -o ROOT/out/native-render
```

```
native-render video --ctx <context.bin> [--bank <bank.bin> --bank-w 320 --bank-h 180] --w 1280 --h 720
              → raw rgb24 frames for every record in context.bin to stdout (progress on stderr)
native-render sheet --ctx <context.bin> [--bank ...] --w 1280 --h 720 --out sheet.jpg --frames 0,120,240 [--cols 3] [--thumb-w 640]
native-render frame --ctx <context.bin> [--bank ...] --w 1280 --h 720 --index 120 --out frame.jpg
```

`--frames`/`--index` are record indices into the given context.bin. Rendering MUST be stateless per frame
(frames rendered in parallel with `dispatch_apply`).

Legacy mode (`project.native.legacy = true`, used by `templates/willnever-reference`): the project ships its own
`.m` (`project.native.source`) speaking the v4 protocol `native-render video <features.bin> <start> <end> <fps>` /
`native-render sheet <features.bin> <out.jpg> <t1,t2,...>` with `archive_bank.bin` + `cv_tracks.bin` next to features.bin.

## 6. Browser renderer adapters (`renderers/<engine>/index.js`)

Engines: `threejs`, `webgpu`, `pixijs`, `p5js`, `hyperframes`. Each is a browser ES module:

```js
export const meta = {
  id: 'threejs', name: 'Three.js', kind: 'browser', output: 'canvas' /* or 'dom' */,
  params: [ { name: 'bloom', type: 'number', min: 0, max: 2, step: 0.01, default: 0.6, label: 'Bloom' } ]
};
export async function createRenderer({ canvas, container, width, height, project, scene, assets }) {
  return {
    renderFrame(ctx) {},      // draw RenderFrameContext synchronously, or return a Promise that resolves when the frame is fully drawn
    resize(width, height) {},
    setParam(name, value) {}, getParams() { return {}; },
    dispose() {}
  };
}
```

- `scene` is the project's scene module (or `null` → the adapter's built-in default scene, which must look good
  for any project: dual-particle style archival relief + rig attractor + CRT post where the engine allows).
  Scene module shape is engine-specific but always `export function setup(api)` / `export function frame(ctx, api)`.
- Bare imports resolve through the host import map: `three`, `three/addons/`, `pixi.js`, `p5`, `gsap`.
- Renderers must be **deterministic** given ctx (no `Date.now()`/`performance.now()`/`Math.random()` for visuals;
  use ctx.time and seeded hashes) so headless capture equals the live preview.

Shared browser runtime (`renderers/shared/`):
- `asset-manager.js` — `createAssetManager({ baseUrl, project, clips, bank })` → `{ list(), url(name), getImage(name), getVideo(name), getClipFrame(clipRef, localTime) /* → CanvasImageSource, seeks a pooled <video> */, ready() }`.
- `host-runtime.js` — `mountRenderer({ container, rendererId, projectData, width, height, baseUrl }) → { renderAt(t), renderContext(ctx), setParam, getParams, timeline, resize, dispose }`.
  `projectData` = the JSON from `GET /api/project` (§7). Used by the Studio live preview AND headless capture.
- `host.html` — standalone page `host.html?renderer=threejs&api=<origin>` used for capture; exposes
  `window.__slopscore = { ready: Promise, renderFrame(index) → Promise<void>, canvas, meta }`.
- `capture.mjs` (Node) — `renderBrowserFrames({ loaded, rendererId, startFrame, endFrame, output /*Writable, raw rgba*/, onProgress, chromePath })`
  launches Chrome via puppeteer-core, serves §7 URL space itself, pipes raw RGBA (width*height*4 per frame) to `output`.

## 7. HTTP URL space (Studio server AND capture server must both serve this)

| Path | Meaning |
|---|---|
| `/` | `REPO/studio/index.html` |
| `/studio/*` | `REPO/studio/*` |
| `/slopscore/*` | `REPO/*` (kit, renderers, node_modules — used by import maps) |
| `/project/*` | `ROOT/*` (assets, out, scenes, feedback/media) |
| `/out/*`, `/assets/*`, `/feedback/*` | aliases into `ROOT/` (v4 compatibility) |
| `GET /api/project` | `{ root, title, project, clips, bank /*bank.json or null*/, overrides, featuresUrl /*'/project/out/features.bin' or null*/, renderers:[meta...] }` |

Import map used by every browser page:
```json
{ "imports": {
  "three": "/slopscore/node_modules/three/build/three.module.js",
  "three/addons/": "/slopscore/node_modules/three/examples/jsm/",
  "pixi.js": "/slopscore/node_modules/pixi.js/dist/pixi.min.mjs",
  "p5": "/slopscore/renderers/p5js/p5-esm.js",
  "gsap": "/slopscore/node_modules/gsap/index.js",
  "slopscore/": "/slopscore/kit/"
} }
```

## 8. Studio server API (`studio/server.mjs`, generalized from v4 `studio-server.mjs`)

`slopscore studio [ROOT] [--port 8989]` → `startStudioServer({ root, port }) → { server, url, close() }`.
All v4 routes retained, rooted at ROOT instead of the server's own directory:

- Notes: `GET/POST /api/notes`, `POST /api/notes/archive|unarchive|clear` (clear writes a backup first; regenerates FEEDBACK.md)
- Versions: `GET/POST /api/versions`, `POST /api/versions/snapshot`
- Run: `GET /api/run/status`, `GET /api/run/stream` (SSE: init/start/log/finish), `POST /api/run {action, range?, customCmd?}`, `POST /api/run/kill`
  — actions come from `kit/commands.mjs#commandPresets(root)`.
- Media: `POST /api/upload-media {filename, dataUrl}`
- Sources: `GET /api/sources`, `POST /api/sources/annotate`
- Clips: `GET/POST/DELETE /api/clips`
- Stems: `GET /api/stems` → project.audio.stems + `file` URL when `out/stems/<id>.(mp3|wav)` or `score/stems/<id>.wav` exists
- Features: `GET /api/features` → `{ frames:[[rms,bass,mid,high,transient,glitch]...] (decimated), fps, duration }`
- New: `GET /api/project`, `GET/POST /api/overrides`, `POST /api/loop/automatch {sourceId, inSec, outSec, window?}`,
  `GET /api/renderers`, assistant routes (§10).

## 9. Studio client API — `window.slopscore.studio`

Implemented by `studio/js/studio-api.js`; consumed by `studio/webmcp-bridge.js` and `studio/assistant/`.
All methods may be async; all return plain JSON-serializable data.

```js
getState()                       // { time, bar, musical:'41.1.1', duration, playing, tab, chapter:{index,id,name}, viewMode:'video'|'live',
                                 //   renderer, selectedSource, loop:{inSec,outSec,match}, activeVersion, snap }
seek({ time, bar })              // either; returns getState()
play() / pause()
setTab(tabId)                    // 'master'|'audio'|'sheet'|'assets'|'notes'
getProject() / getClips() / getNotes() / getSources() / getStems()
addNote({ title, text, timeStart, timeEnd, target, tags })
selectSource(sourceId)
setLoop({ inSec, outSec })
automatchLoop({ sourceId, tolerance, window })   // → { inSec, outSec, match }
saveClip({ name, sourceId, inSec, outSec, mode, speed, tags, notes })
bindClip({ clipId, chapterIndex })               // persists overrides.chapters[chapterId].clipLoopId
getOverrides() / setOverrides(overrides)         // full replace (used for Undo); persists via POST /api/overrides
setShaderParam({ param, value, chapterId? })     // global when chapterId omitted; live preview updates instantly
setCameraParam({ param, value, chapterId? })
setRendererParam({ param, value })               // forwarded to the live renderer instance
setStemMix({ stemId, mute?, solo?, volume? })
runCommand({ action, range })                    // → { taskId }
captureFrame()                                   // → dataURL (jpeg) of current preview
on(event, fn) / off(event, fn)                   // events: 'timeupdate','statechange','notes','clips','overrides','run'
```

## 10. Assistant (`studio/assistant/`)

- Server: `studio/assistant/routes.mjs` exports `async function handleAssistantRoute(req, res, ctx): Promise<boolean>`
  (returns true when it handled the request). `ctx = { root, getLoaded: () => Promise<loaded>, readJsonBody }`.
  Routes: `GET /api/assistant/providers`, `POST /api/assistant/chat` (streams SSE or returns JSON), `GET /api/assistant/skills`.
  API keys come from env (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`) or `~/.slopscore/assistant.json`; never sent to the browser.
- Client: `studio/assistant/panel.js` exports `mountAssistant({ studio /* window.slopscore.studio */, root: HTMLElement })`.
- Action envelope emitted by the model (fenced ```slopscore-action JSON):
  `{ "type": "action", "title": "...", "summary": "...", "calls": [ { "tool": "set_shader_param", "args": {...} } ] }`
  Tools are the same names as the WebMCP tools (§11). Rendered as Apply / Dismiss cards; Apply snapshots
  `getOverrides()` + `getState()` first so **Undo** restores them.

## 11. Tool names (shared by stdio MCP and WebMCP)

stdio MCP (`mcp/server.mjs`, filesystem-level): `slopscore_init`, `slopscore_inspect`, `slopscore_validate`,
`slopscore_render_sheet`, `slopscore_render_video`, `slopscore_build_native`, `slopscore_synthesize_audio`,
`slopscore_loop_automatch`, `slopscore_list_clips`, `slopscore_save_clip`, `slopscore_add_note`, `slopscore_list_notes`,
`slopscore_set_override`.

WebMCP (`studio/webmcp-bridge.js`, live browser state): `studio_get_state`, `studio_seek`, `studio_play`, `studio_pause`,
`loop_automatch`, `set_shader_param`, `set_camera_param`, `bind_clip`, `save_clip`, `add_note`, `run_command`,
`capture_frame`, `list_clips`, `get_project`.
