---
name: slopscore
description: Universal procedural audio-visual engine, 7-engine renderer runtime (Native C/Metal, WebGPU, Three.js, fframes, HyperFrames, Pixi.js, p5.js), and interactive Director Studio with bar-locked measure timekeeping, A/B seamless loop finder, stdio MCP, and WebMCP. Use when creating, directing, scoring, looping, or rendering procedural music videos and audio-reactive visual pieces.
license: MIT
metadata:
  opencode/slash: "true"
  version: "2.0.0"
---

# Slopscore 2.0 — Agent Playbook & Director Studio Skill

**Slopscore 2.0** (`~/dev/slopscore`) is an open-source, agent-native procedural audio-visual engine, multi-engine renderer runtime, and interactive Director Studio. It unifies procedural multi-stem synthesis, 1-based musical measure timekeeping (`MeasureClock`), public-domain/archival seamless loop discovery (`loop-finder`), 3D/2D dual-particle constellation synthesis, and 100+ fps native + headless browser video rendering into a single modular framework.

Every renderer consumes the identical deterministic `RenderFrameContext` (and its 32-float binary encoding `out/context.bin`), guaranteeing bit-exact synchronization across:
1. **Interactive Human Director** — Operating the minimal AMS-style Director Studio Web UI (`slopscore studio`).
2. **External Agent Harness** — Driving projects via CLI (`bin/slopscore.mjs`) or **stdio MCP** (`mcp/server.mjs`).
3. **Embedded In-Studio Assistant** — Driving the live browser Studio tab via **WebMCP** (`studio/webmcp-bridge.js`) and the **Genereti** multi-provider assistant panel (`studio/assistant/`).

---

## 1. Quickstart & CLI Reference

All commands can be invoked via `node ~/dev/slopscore/bin/slopscore.mjs <cmd> [project-dir]` (or `slopscore <cmd>` when linked):

```bash
# 1. Scaffold a new project (templates: "default" or "willnever-reference")
node ~/dev/slopscore/bin/slopscore.mjs init ./my-piece --template=default --renderer=threejs --bpm=140

# 2. Inspect & validate project configuration
node ~/dev/slopscore/bin/slopscore.mjs inspect ./my-piece
node ~/dev/slopscore/bin/slopscore.mjs validate ./my-piece

# 3. Synthesize procedural score, export isolated stems, and extract features.bin
node ~/dev/slopscore/bin/slopscore.mjs audio ./my-piece --stems

# 4. Compile the 100+ fps Native Objective-C / CoreGraphics / Metal renderer
node ~/dev/slopscore/bin/slopscore.mjs build ./my-piece

# 5. Render a 12-keyframe contact sheet (out/sheet.jpg) in ~2s and inspect it!
node ~/dev/slopscore/bin/slopscore.mjs sheet ./my-piece --renderer=native

# 6. Render a fast preview range or full master MP4 video
node ~/dev/slopscore/bin/slopscore.mjs render ./my-piece --range=0:15 --out=out/preview.mp4
node ~/dev/slopscore/bin/slopscore.mjs render ./my-piece --out=out/video.mp4

# 7. Launch the interactive Director Studio (http://localhost:8989)
node ~/dev/slopscore/bin/slopscore.mjs studio ./my-piece --port=8989
```

---

## 2. The 7 Pluggable Render Engines

Pass `--renderer=<id>` to `slopscore sheet` or `slopscore render`, or set `renderer` in `slopscore.config.js`:

| Engine ID | Technology | Adapter Path | Best Used For |
| :--- | :--- | :--- | :--- |
| `native` | Objective-C, CoreGraphics, GCD | `renderers/native/` | 100+ fps local batch master video rendering & instant contact sheets |
| `webgpu` | WebGPU Compute + Render | `renderers/webgpu/` | In-browser GPU particle swarms, curl-noise vector fluid fields |
| `threejs` | Three.js 3D Scene Graph + GLSL | `renderers/threejs/` | 3D instanced meshes, gear/crystal/butterfly rigs, CRT post-processing |
| `fframes` | Rust + SVG / Skia Vector | `renderers/fframes/` | Razor-sharp steel-plate vector motion graphics & isometric apparatuses |
| `hyperframes` | HTML5 + CSS3 + GSAP | `renderers/hyperframes/` | Deterministic kinetic typography, telemetry HUDs, brutalist cards |
| `pixijs` | Pixi.js WebGL 2D Compositor | `renderers/pixijs/` | 16-bit pixel art, workstation protagonist, 2D sprite collage |
| `p5js` | p5.js Canvas2D Creative Coding | `renderers/p5js/` | Algorithmic math sketches, flow fields, chaotic attractors |

---

## 3. Project Manifest (`slopscore.config.js`)

Every project is driven by a declarative `slopscore.config.js` where chapters lock to 1-based musical bars (`startBar`..`endBar` inclusive):

```javascript
export default {
  title: "My Audiovisual Piece",
  version: "1.0.0",
  audio: {
    bpm: 164,
    timeSignature: [4, 4],
    durationSeconds: 180,
    scorePath: "score/score.wav",
    stemsDir: "score/stems/"
  },
  renderer: "native",
  aspectRatio: "16:9",
  resolution: [1280, 720],
  fps: 30,
  chapters: [
    {
      id: "ch-0",
      name: "The Morning Shift",
      startBar: 1,
      endBar: 14,
      clipLoopId: "clip-tc-1",
      particleRig: "gears", // gears | voxels | sparkRings | crystals | helix | spiral | butterflies | relief
      vp: [0.36, 0.46],
      camera: { type: "dollyPush", startDist: 16.8, endDist: 13.0, panX: 0.5 },
      shaders: { crtScanlines: true, chromaticAberration: 0.2, lumaRelief: true, reliefDepth: 2.8 }
    }
  ]
};
```

---

## 4. Dual MCP Workflow (stdio MCP + WebMCP)

### External Agent Tools (`mcp/server.mjs`)
Configure `node /Users/liuboto/dev/slopscore/mcp/server.mjs` in your MCP client to call:
- `slopscore_init` — Scaffold a new project from `default` or `willnever-reference`.
- `slopscore_inspect` / `slopscore_validate` — Inspect chapters, bar timings, clips, notes, and outputs.
- `slopscore_build_native` — Compile the multi-threaded native renderer.
- `slopscore_synthesize_audio` — Synthesize score, stems, and `out/features.bin`.
- `slopscore_render_sheet` — Render `out/sheet.jpg` for rapid visual inspection (`view_file`).
- `slopscore_render_video` — Render preview ranges or master MP4s.
- `slopscore_loop_automatch` — Scan candidate frames via FFmpeg to find seamless loop IN/OUT points with normalized MSE / Match %.
- `slopscore_list_clips` / `slopscore_save_clip` — Manage `feedback/clips.json`.
- `slopscore_list_notes` / `slopscore_add_note` — Pin director notes to musical bars in `feedback/notes.json`.
- `slopscore_set_override` — Live-patch shader, camera, or chapter parameters in `feedback/overrides.json`.

### Live Browser Tools (`studio/webmcp-bridge.js` & `window.slopscore.studio`)
When the Director Studio is open in the browser (`http://localhost:8989`), both WebMCP clients and the embedded Genereti Assistant can invoke:
- `studio_get_state`, `studio_seek({ bar, time })`, `studio_play`, `studio_pause`
- `loop_automatch({ assetId, tolerance })`, `save_clip`, `bind_clip({ clipId, chapterIndex })`
- `set_shader_param({ param, value })`, `set_camera_param({ param, value })`
- `add_note`, `run_command({ action })`, `capture_frame`

---

## 5. Autonomous Direction Loop (Best Practices)

1. **Always Lock to Musical Bars**: Use `MeasureClock` (`kit/measure-clock.js`) to align chapter boundaries, camera cuts, and clip loops to 1-based bars (`bar = 1 + t / barSec`).
2. **Curate Loops with A/B Seam Matching**: Before binding an archival or generated video to a chapter, run `slopscore loop <dir> --asset=<file>` (or use the Studio's **⚡ Automatch Loop** button) and aim for `Match > 92%`.
3. **Verify via Contact Sheets Before Full Renders**: Run `slopscore sheet <dir>` (~2 seconds) and inspect `out/sheet.jpg` with `view_file` to verify framing, particle density, contrast, and CRT scanlines across all chapters before running a full master render.
4. **Delegate Specialized Assets to Companion Skills**:
   - **`anatomy`**: Precision isometric SVG apparatuses, dial gauges, and consoles (rendered via `fframes` or `hyperframes`).
   - **`codeanimation`**: Hand-painted 2D `p5.brush` character cycles imported into the Clip Library.
