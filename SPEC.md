# Slopscore 2.0: Complete Technical Specification

**Version:** 2.0.0-draft  
**Repository:** `~/dev/slopscore`  
**License:** MIT  
**Authors:** 10,000 Choices Team

---

## 1. Vision & Architecture Overview

**Slopscore 2.0** is an open-source, agent-native procedural audio-visual engine, multi-engine renderer runtime, and interactive director studio. It unifies procedural sound design, musical measure timekeeping, public domain/archival asset looping, 3D/2D particle synthesis, and multi-threaded video rendering into a single modular framework.

Unlike bespoke single-video scripts, Slopscore 2.0 decouples the **Studio Tooling & Engine Core** from any specific project realization. It can be operated in three simultaneous modes:
1. **Interactive Human Director**: Operating the minimal AMS-style Director Studio Web UI in the browser.
2. **External Agent Harness**: LLMs (Antigravity, Claude Desktop, Cursor) driving the workspace over **stdio MCP**.
3. **Embedded In-Studio Assistant**: A local or hosted LLM (Ollama, LM Studio, Gemini, Claude) living directly inside the Studio sidebar via **WebMCP** ([webmcp.dev](https://webmcp.dev)) and the **Genereti** multi-provider connector.

---

## 2. Catalog of Reusable Tooling from `mtv-willnever-v4`

Every tool developed during the *Will Never Make Art* production sprint will be generalized and ported into the `slopscore` core:

### 2.1. The Musical Measure Timekeeper & Stems Engine
* **Source Location**: `mtv-willnever-v4/kit/audio-engine.js`
* **Target Location**: `slopscore/kit/audio-engine.js` & `slopscore/kit/measure-clock.js`
* **Capabilities**:
  - **Tempo & Measure Snapping**: Quantizes all animation, camera moves, and particle bursts to musical measures (e.g. 164 BPM = 1.4634s/bar; 180s = 123 bars).
  - **Fractional Measure Tracking**: Calculates `barIndex`, `barPhase` ($0.0 \dots 1.0$), `beatPhase`, and `phrase4Bar` (4-bar musical periods) for every frame.
  - **Analytical Spectral Curves (`features.bin`)**: Pre-computes frame-by-frame float arrays for `rms`, `bass`, `mid`, `high`, `transient`, and `glitch`.
  - **Multi-Stem Audio Preview Mixer**: Real-time browser audio playback with mute/solo controls for `Master`, `Drums`, `Bass`, `Lead`, `Pads`, `Melodic`, and `Glitch FX`.

### 2.2. Ultra-Fast Multi-Threaded Native C/Metal Renderer
* **Source Location**: `mtv-willnever-v4/kit/native-render.m`
* **Target Location**: `slopscore/renderers/native/`
* **Capabilities**:
  - **100+ FPS Production Speed**: Renders 5,400 frames (180s @ 30fps) in 35 seconds via Apple CoreGraphics, Metal, and Grand Central Dispatch (`dispatch_apply`).
  - **Dual Particle System**:
    - *Archival 3D Relief*: Samples historical film/image frames, unprojecting $(u, v)$ coordinates into 3D world space displaced by luminance $Z = (L - 0.45) \times \text{depthScale} + \text{bassKick}$.
    - *Generative 3D Attractors*: Procedural geometry definitions (clockwork gears, cybernetic voxel cubes, high-voltage spark rings, nested icosahedral crystals, double-helix ribbons, golden spirals, origami butterfly swarms).
    - *Continuous Morphing*: Smooth mathematical interpolation between archival footage and 3D geometric attractors modulated by musical measure progress.
    - *Plexus Constellation Mesh*: Vector lines connecting adjacent particles within 3D distance threshold ($d < 2.05\text{m}$).
    - *Phosphor Core Shaders*: CRT phosphor glow squares with hot laser centers, transient specular halos, and depth fog attenuation.
  - **Continuous Camera Splines**: Cinematic camera trajectories (dolly push-in, lateral tracking, hero bass recoil shake, vertigo dolly zoom, panoramic vista, sunset pull-back).
  - **CRT Raster Post-Processing**: Unified scanlines, chromatic aberration split on transients/glitches, and corner vignette.
  - **Contact Sheet Subcommand**: Renders 12-keyframe contact sheets (`out/sheet.jpg`) in ~3 seconds without running full video pipelines.

### 2.3. Seamless Loop Finder & A/B Seam Comparer
* **Source Location**: `mtv-willnever-v4/studio.html` (Lines 890–1180) & `mtv-willnever-v4/studio-server.mjs`
* **Target Location**: `slopscore/studio/loop-finder.js` & `slopscore/kit/loop-matcher.mjs`
* **Capabilities**:
  - **Interactive Live-Scrubbing**: Dual range sliders (`rng-asset-in` and `rng-asset-out`) that instantly update the video playhead on thumb drag.
  - **Dual A/B Seam Compare View**: Side-by-side IN and OUT canvas previews with interactive A/B flip toggle.
  - **Pixel Discontinuity Metric**: Computes normalized Mean Squared Error (MSE) between the IN frame and OUT frame, yielding a live `Match: X%` score.
  - **`⚡ Automatch Loop` Scanner**: Automated local minima search scanning forward and backward candidate windows to discover seamless loops.
  - **Clip Library Cataloging**: Saves clips with musical measure in/out points (`inBar`, `outBar`), loop mode (`loop`, `pingpong`, `reverse`), playback speed, tags, and annotations persisted in `feedback/clips.json`.

### 2.4. Minimalist AMS Director Studio UI
* **Source Location**: `mtv-willnever-v4/studio.html` & `mtv-willnever-v4/studio-server.mjs`
* **Target Location**: `slopscore/studio/`
* **Capabilities**:
  - **Minimal AMS Styling**: Clean SVG Heroicons glyphs, hover tooltips (`title="..."`), subdued color palette, zero emojis.
  - **Dark & Light Mode Engine**: Instant theme switcher with localStorage persistence.
  - **Dual-Representation Timeline**: Toggles between clock time (`00:58.53 / 03:00.00`) and musical measures (`BAR 41.1.1`).
  - **Audio Waveform Lane**: High-resolution stereo amplitude plot aligned with bar markers (`B1`, `B9`, `B17`...).
  - **Action Command Runners**: In-browser buttons to trigger `Rebuild`, `Contact Sheet`, `Render Video`, and `Synthesize Audio` with live progress bars.
  - **Director Notes & Feedback Loop**: Pins annotations directly to musical bars, tracks resolution status, and manages version snapshots (`v1.0` -> `v2.0`).

---

## 3. The 7 Pluggable Render Engines

Slopscore 2.0 defines a universal rendering adapter contract: every visual engine receives the identical `RenderFrameContext` and outputs an RGBA frame buffer or renders live to an HTML5 canvas.

```typescript
export interface RenderFrameContext {
  time: number;          // Absolute timestamp in seconds
  fps: number;           // Target frame rate (typically 30 or 60)
  frame: number;         // Current frame integer index
  bar: number;           // Current musical bar (e.g. 24.25)
  beatPhase: number;     // 0.0 .. 1.0 within the current quarter-note beat
  measurePhase: number;  // 0.0 .. 1.0 within the current 4-beat bar
  phrase4Bar: number;    // 0.0 .. 1.0 within a 4-bar phrase
  chapter: number;       // Current chapter index
  chProgress: number;    // 0.0 .. 1.0 within current chapter
  chMorphT: number;      // Transition morph factor (0.0 .. 1.0)
  audio: AudioFeatures;  // { rms, bass, mid, high, transient, glitch }
  stems?: StemBuffers;   // Optional stem spectral data
  camera: CameraState;   // { panX, panY, dist, fov, roll, charScale }
  assets: AssetManager;  // Sampled video/GIF frames, textures, SVGs
}
```

### Supported Engine Adapters

| Engine | Technology | Adapter Path | Best Used For |
| :--- | :--- | :--- | :--- |
| **Native C / Metal** | C, CoreGraphics, Metal, GCD | `renderers/native/` | 100+ fps local batch master video rendering |
| **fframes** | Rust, Skia, SVG, `libav` | `renderers/fframes/` | Razor-sharp vector motion graphics, steel-plate lines |
| **HyperFrames** | HTML5, CSS3, GSAP, Chrome | `renderers/hyperframes/` | Agent-native kinetic typography, DOM overlays, HUDs |
| **WebGPU Compute** | WebGPU compute & render | `renderers/webgpu/` | In-browser 100k+ particle swarms, GPU vector fluid fields |
| **Three.js** | WebGL/WebGPU 3D Scene Graph | `renderers/threejs/` | 3D worlds, instanced meshes, GLTF rigs, PBR lighting |
| **Pixi.js** | WebGL 2D Sprite Compositor | `renderers/pixijs/` | 16-bit pixel art, 2D sprite games, retro CRT collage |
| **p5.js** | Canvas2D Creative Coding | `renderers/p5js/` | Algorithmic math sketches, flow fields, chaotic attractors |

---

## 4. Model Context Protocol: stdio MCP + WebMCP

Slopscore 2.0 exposes a dual MCP interface sharing identical tool schemas:

### 4.1. `stdio MCP` Server (`slopscore/mcp/server.mjs`)
For external coding agents (Antigravity, Claude Desktop, Cursor):
* Configured in agent settings:
  ```json
  {
    "mcpServers": {
      "slopscore": {
        "command": "node",
        "args": ["/Users/liuboto/dev/slopscore/mcp/server.mjs"]
      }
    }
  }
  ```
* Provides filesystem-level tools: `slopscore_init`, `slopscore_inspect`, `slopscore_render_sheet`, `slopscore_render_video`, `slopscore_build_native`.

### 4.2. `WebMCP` In-Browser Bridge (`studio/webmcp-bridge.js`)
Leverages [webmcp.dev](https://webmcp.dev) (`@jason.today/webmcp`):
* Embedded inside `studio/index.html`.
* Exposes live in-memory browser tools:
  - `studio_seek({ bar, time })`: Moves transport and scrubs video/audio.
  - `loop_automatch({ assetId, tolerance })`: Runs real-time seam analysis on the open asset.
  - `set_shader_param({ param, value })`: Dynamically updates live shader uniforms.
  - `bind_clip({ clipId, chapterIndex })`: Binds a curated clip to a timeline chapter.
* Allows Claude Desktop or web agents to connect directly to the running Studio tab and interact with live state.

---

## 5. Embedded Studio Assistant (`~/dev/genereti` Port)

Porting the proven assistant architecture from `~/dev/genereti/integrations/genereti_comfy_agent/`:
* **Docked Slide-Over Drawer**: Right sidebar in `studio/index.html`.
* **Multi-Provider Connectors**:
  - Local (No-cost/Private): Ollama (`http://localhost:11434`), LM Studio (`http://localhost:1234/v1`), MLX / llama.cpp (`http://localhost:8080/v1`), Unsloth.
  - Cloud: Google Gemini, Anthropic Claude, OpenAI, OpenRouter.
* **Interactive Proposal Cards**:
  - The assistant outputs structured action envelopes.
  - Studio displays an **Apply / Dismiss** review card.
  - Includes a one-click **Undo** mechanism restoring prior parameters.
* **Context Attachment Chips**:
  - Typing `@` opens an asset/chapter/note picker, inserting chips like `@clip:"Punch Clock"` or `@bar:24.1`.

---

## 6. Pluggable Creative Skills Engine

The Slopscore Assistant dynamically loads specialized skills from `~/.agents/skills/` or `./skills/`:

| Skill | Interaction Protocol | Output Flow into Slopscore |
| :--- | :--- | :--- |
| **`anatomy`** | Assistant prompts: *"Design an isometric dial gauge apparatus for Chapter 2"* | Emits precision SVG/WebGL code -> rendered via **fframes** or **HyperFrames** |
| **`ff-tracker`** | Assistant prompts: *"Track optical flow and contours on clip 3"* | Emits motion vectors -> saved to `cv_tracks.bin` to guide particle emitters |
| **`codeanimation`** | Assistant prompts: *"Generate a 2D p5.brush walking cycle"* | Emits p5 sketch / transparent MP4 -> imported into **Clip Library** |

---

## 7. Project Manifest Specification (`slopscore.config.js`)

Each custom song realization is a directory containing a `slopscore.config.js`:

```javascript
export default {
  title: "My Audiovisual Piece",
  version: "1.0.0",
  audio: {
    bpm: 164,
    timeSignature: [4, 4],
    durationSeconds: 180,
    scorePath: "score/score.wav",
    stemsDir: "score/stems/", // drums.wav, bass.wav, pads.wav, lead.wav...
  },
  renderer: "threejs", // "native" | "webgpu" | "threejs" | "fframes" | "hyperframes" | "pixijs" | "p5js"
  aspectRatio: "16:9",
  resolution: [1280, 720],
  chapters: [
    {
      id: "ch-0",
      name: "The Morning Shift",
      startBar: 1,
      endBar: 14,
      clipLoopId: "clip-tc-1",
      particleRig: "gears",
      camera: { type: "dollyPush", startDist: 16.8, endDist: 13.0, panX: 0.5 },
      shaders: { crtScanlines: true, chromaticAberration: 0.2, lumaRelief: true }
    },
    // ... remaining chapters
  ]
};
```

---

## 8. Directory Layout of `~/dev/slopscore`

```
~/dev/slopscore/
├── bin/
│   └── slopscore.mjs             # CLI: init, studio, render, sheet, audio
├── studio/
│   ├── index.html                # AMS minimal UI, Loop Finder, Stems mixer
│   ├── server.mjs                # Fastify/Express API daemon
│   ├── assistant/                # Genereti multi-provider assistant panel
│   └── webmcp-bridge.js          # WebMCP browser tool registry (@jason.today/webmcp)
├── kit/
│   ├── audio-engine.js           # Stems audio player & measure timekeeper
│   ├── measure-clock.js          # Bar/beat math, quantization, and snapping
│   ├── feature-extractor.mjs     # Analytical audio energy curve generator
│   ├── loop-finder.mjs           # Pixel difference & seam auto-matcher
│   └── config-loader.mjs         # slopscore.config.js validator
├── renderers/
│   ├── native/                   # C/CoreGraphics/Metal 100fps renderer
│   ├── webgpu/                   # In-browser WebGPU compute particle pipeline
│   ├── threejs/                  # 3D scene graph & post-processing passes
│   ├── fframes/                  # Rust + Skia SVG vector renderer adapter
│   ├── hyperframes/              # HTML5 + CSS3 + GSAP DOM animation adapter
│   ├── pixijs/                   # 2D WebGL sprite compositor
│   └── p5js/                     # Generative canvas creative coding adapter
├── mcp/
│   ├── server.mjs                # Stdio MCP server for external agents (AGY/Claude)
│   └── tools.mjs                 # Shared tool schemas and handlers
├── templates/
│   ├── default/                  # Blank starter project
│   └── willnever-reference/      # Port of the v5.0 project as reference realization
├── SKILL.md                      # Antigravity Agent Playbook (to be adapted)
├── HANDOFF.md                    # Engineering Handoff Document
├── SPEC.md                       # This Technical Specification
└── package.json
```

---

## 9. Phased Implementation Roadmap

* **Phase 1: Foundation & CLI**:
  - Initialize `package.json` with dependencies (`three`, `pixi.js`, `p5`, `@jason.today/webmcp`, `fastify`).
  - Implement `bin/slopscore.mjs` supporting `slopscore init <dir>` and `slopscore studio`.
* **Phase 2: Director Studio & Loop Finder**:
  - Port `mtv-willnever-v4/studio.html` and `studio-server.mjs` into `studio/`.
  - Wire the generalized A/B Loop Finder and Stems Audio Preview.
  - Embed `studio/webmcp-bridge.js`.
* **Phase 3: Core Kits**:
  - Port `kit/measure-clock.js`, `kit/audio-engine.js`, and `kit/loop-finder.mjs`.
* **Phase 4: Pluggable Renderers**:
  - Implement `renderers/native/` (C/Metal) and `renderers/threejs/`.
  - Add adapters for `renderers/hyperframes/` and `renderers/fframes/`.
* **Phase 5: Genereti Embedded Assistant**:
  - Port the multi-provider assistant drawer and review card system into `studio/`.
* **Phase 6: Reference Project & Verification**:
  - Re-host `willnever` as `templates/willnever-reference/` and verify that `slopscore render` produces identical 187 MB video.
* **Phase 7: Skill Adaptation**:
  - Rewrite `SKILL.md` to be the primary agent playbook for driving the Slopscore Studio.
