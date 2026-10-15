# Slopscore 2.0: Master Handoff & Architecture Blueprint

## Executive Summary
This document outlines the architecture, roadmap, and transition plan to establish `~/dev/slopscore` as the primary repository for **Slopscore 2.0**: a universal procedural audio-visual engine, director studio, and agent skill.

During the development of *Will Never Make Art (mtv-willnever-v4)*, we invented and battle-tested several major creative-tech subsystems:
1. **Fast Native Renderer (`kit/native-render.m`)**: Multi-threaded C/CoreGraphics/Metal rendering yielding 100+ fps.
2. **Dual Particle Constellation System**: 3D bas-relief footage sampling blended into generative 3D geometric attractors with vector constellation lines and CRT phosphor glow.
3. **Director Studio Web UI**: Minimal AMS-style UI with dark/light modes, stems audio preview mixer, and command runners.
4. **Musical Measure Synchronizer**: Quantized bar/beat timekeeping (164 BPM grid snapping, metric modulation, chord progressions).
5. **Asset & Clip Library + Loop Finder**: Live scrub IN/OUT, dual A/B seam compare view with pixel difference metric, and automated loop matching.

The goal now is to decouple these tools from the specific song and 1904 footage, establishing a **pluggable, multi-engine framework** that can be driven by human creators, external agents (via MCP), and an embedded in-studio assistant (via WebMCP).

---

## Architectural Pillars

### 1. Unified Render Contract (`RenderFrameContext`)
Every renderer implements the exact same deterministic frame contract:
```typescript
interface RenderFrameContext {
  time: number;          // Timestamp in seconds (e.g. 24.52s)
  bar: number;           // Exact musical measure (e.g. 17.25)
  beatPhase: number;     // 0.0 .. 1.0 within the current beat
  measurePhase: number;  // 0.0 .. 1.0 within the current 4-beat bar
  phrase4Bar: number;    // 0.0 .. 1.0 within a 4-bar phrase
  chapter: number;       // Current chapter index (0..N)
  chProgress: number;    // 0.0 .. 1.0 within current chapter
  chMorphT: number;      // Transition ramp factor into next scene
  audio: AudioFeatures;  // { rms, bass, mid, high, transient, glitch }
  stems?: StemBuffers;   // Optional stem spectral/audio buffers
  camera: CameraState;   // { panX, panY, dist, fov, roll, charScale }
  assets: AssetManager;  // Access to active clip frame textures, buffers, SVGs
}
```

### 2. The 7 Pluggable Render Engines
Slopscore supports pluggable visual adapters selectable per project or composited across layers:
- **WebGPU Compute**: Real-time client-side particle simulations (100k+ particles), fluid fields, compute shaders.
- **Three.js**: 3D scene graphs, instanced geometries, GLTF character rigs, PBR lighting, and post-processing passes.
- **fframes (`dmtrKovalenko/fframes`)**: Rust + Skia + SVG + libav/FFmpeg for razor-sharp vector graphics, steel-plate procedural lines, and Rust CLI rendering.
- **HyperFrames (`heygen-com/hyperframes`)**: Agent-native HTML5 + CSS3 + GSAP web animation rendered deterministically via headless Chrome.
- **Pixi.js**: Hardware-accelerated 2D WebGL sprite batching, retro pixel art, and 2D GLSL filters.
- **p5.js**: Algorithmic math sketches, flow fields, chaotic attractors, and procedural typography.
- **Native C / Metal**: Multi-core `dispatch_apply` batch rendering at 100+ fps for final 4K video exports.

### 3. Dual Model Context Protocol (MCP + WebMCP)
- **External Agent Bridge (`stdio MCP`)**: For coding assistants (Antigravity, Claude Desktop, Cursor) to manage projects, run loop finders, trigger builds, and inspect contact sheets.
- **Browser-Native Bridge (`WebMCP` via https://webmcp.dev)**: Embedded in `studio.html` so an LLM or browser agent can directly inspect live canvas state, seek the timeline, test loops, and adjust shader uniforms in the active tab.

### 4. Embedded Studio Assistant (`~/dev/genereti` Architecture)
- A slide-over assistant panel inside `studio.html`.
- Pluggable provider backend supporting local and cloud LLMs:
  - Local: Ollama (`http://localhost:11434`), LM Studio (`http://localhost:1234/v1`), MLX / llama.cpp (`http://localhost:8080/v1`), Unsloth.
  - Cloud: Google Gemini, Claude API, OpenAI, OpenRouter.
- Actions render as interactive **Apply / Dismiss** review cards with one-click **Undo**.

### 5. Pluggable Creative Skills
The assistant dynamically mounts and delegates to specialized skills in `~/.agents/skills/`:
- **`anatomy`**: Generates precision isometric SVG apparatuses, dial gauges, and consoles.
- **`ff-tracker`**: Computer vision optical flow and contour extraction for particle anchors.
- **`codeanimation`**: Procedural 2D p5.brush character animation loops.

---

## Proven Code References to Port

| Feature | Source Location | Destination in `~/dev/slopscore` |
| :--- | :--- | :--- |
| **Director Studio UI** | `mtv-willnever-v4/studio.html` | `studio/index.html` (generalized, renderer-agnostic) |
| **Studio API Server** | `mtv-willnever-v4/studio-server.mjs` | `studio/server.mjs` (generalized routes) |
| **A/B Loop Finder & Matcher** | `mtv-willnever-v4/studio.html` (L900-1150) | `kit/loop-finder.mjs` & studio loop widget |
| **Stems & Measure Engine** | `mtv-willnever-v4/kit/audio-engine.js` | `kit/audio-engine.js` (abstracted score/stem loader) |
| **Native Multi-Threaded C Renderer** | `mtv-willnever-v4/kit/native-render.m` | `renderers/native/native-render-core.m` |
| **Dual Particle System** | `mtv-willnever-v4/kit/native-render.m` (L512-700) | `renderers/shared/dual-particles.*` |
| **Genereti Assistant Engine** | `~/dev/genereti/integrations/genereti_comfy_agent/` | `studio/assistant/` (multi-provider connectors) |
| **WebMCP Integration** | `@jason.today/webmcp` | `studio/webmcp-bridge.js` |

---

## Directory Blueprint for `~/dev/slopscore`

```
~/dev/slopscore/
├── bin/
│   └── slopscore.mjs             # Global CLI: slopscore init, studio, render, sheet
├── studio/
│   ├── index.html                # AMS minimal UI, Loop Finder, Stems mixer
│   ├── server.mjs                # Fastify/Express API daemon
│   ├── assistant/                # Multi-provider local/cloud assistant (Genereti port)
│   └── webmcp-bridge.js          # WebMCP browser tool registry
├── kit/
│   ├── audio-engine.js           # Stems audio player & measure timekeeper
│   ├── feature-extractor.mjs     # Analytical energy curve generator (bass, glitch, etc.)
│   ├── loop-finder.mjs           # Pixel difference & seam auto-matcher
│   └── project-manifest.js       # slopscore.config.js schema & loader
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
│   ├── default/                  # Starter project template
│   └── reference-willnever/      # Export of the v5.0 project as reference realization
├── SKILL.md                      # Antigravity Agent Playbook & Prescriptions
├── package.json
└── README.md
```

---

## Recommended Step 1 in Fresh Session
1. Open new session in `~/dev/slopscore`.
2. Scaffold `package.json` with dependencies (`three`, `pixi.js`, `p5`, `@jason.today/webmcp`).
3. Port the generalized Director Studio (`studio/index.html` & `studio/server.mjs`).
4. Port the core audio/measure and loop-finder kits.
5. Implement the `mcp/server.mjs` and `studio/assistant/` connectors.
6. Verify with `slopscore init my-project` and launch the studio!
