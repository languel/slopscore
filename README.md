# Slopscore 2.0

**Slopscore 2.0** is an open-source, agent-native procedural audio-visual engine, 7-engine renderer runtime, and interactive Director Studio.

It unifies:
- **Musical Measure Timekeeper & Multi-Stem Engine (`kit/measure-clock.js`, `kit/audio-engine.js`, `kit/feature-extractor.mjs`)**: 1-based bar/beat quantization, 6-band analytical audio feature extraction (`rms`, `bass`, `mid`, `high`, `transient`, `glitch`), and real-time multi-stem preview mixing (`Master`, `Drums`, `Bass`, `Lead`, `Pads`, `Melodic`, `Glitch FX`).
- **Unified Render Frame Contract (`kit/frame-context.js`)**: Every visual adapter receives the exact same deterministic `RenderFrameContext` (and 32-float `context.bin` binary encoding).
- **7 Pluggable Render Engines (`renderers/`)**:
  - `native` — Multi-threaded Objective-C / CoreGraphics / Metal / Grand Central Dispatch renderer (100+ fps).
  - `webgpu` — WebGPU compute + render particle swarms and fluid fields.
  - `threejs` — 3D scene graphs, instanced dual-particle constellations, geometric attractors, and CRT post-processing shaders.
  - `fframes` — Rust + Skia/SVG razor-sharp vector motion graphics adapter.
  - `hyperframes` — Deterministic HTML5 + CSS3 + GSAP kinetic typography and telemetry HUDs.
  - `pixijs` — Hardware-accelerated 2D WebGL sprite & pixel-art compositor.
  - `p5js` — Algorithmic creative coding sketches, flow fields, and chaotic attractors.
- **Minimal AMS Director Studio (`studio/`)**: Clean SVG Heroicons UI, dark/light themes, dual clock/measure timeline, stereo waveform & stem mixer, 12-keyframe contact sheet, **Asset & Clip Library with A/B Seam Compare & ⚡ Automatch Loop**, bar-pinned Director Notes, and Version Snapshots.
- **Dual Model Context Protocol (`mcp/server.mjs` + `studio/webmcp-bridge.js`)**: Drive projects externally from Antigravity/Claude/Cursor over `stdio MCP` or live in the browser via [WebMCP](https://webmcp.dev).
- **Embedded Genereti Studio Assistant (`studio/assistant/`)**: Multi-provider local (Ollama, LM Studio, MLX/llama.cpp, Unsloth) and cloud (Gemini, Claude, OpenAI, OpenRouter) slide-over assistant with interactive **Apply / Dismiss / Undo** review cards and `@` context chips.

---

## Quickstart

```bash
# Install dependencies
npm install

# Check toolchain (Node, clang, ffmpeg, cargo, Chrome)
node bin/slopscore.mjs doctor

# Initialize a new project
node bin/slopscore.mjs init ./my-project

# Compile native renderer, synthesize audio, render contact sheet & master video
node bin/slopscore.mjs build ./my-project
node bin/slopscore.mjs audio ./my-project --stems
node bin/slopscore.mjs sheet ./my-project
node bin/slopscore.mjs render ./my-project

# Launch the interactive Director Studio
node bin/slopscore.mjs studio ./my-project
# -> http://localhost:8989
```

## Reference Realization: *Will Never Make Art (GRAMMATIZATOR v5.0)*

The complete 180-second, 164 BPM, 8-chapter realization is included at `templates/willnever-reference/`:

```bash
node bin/slopscore.mjs inspect templates/willnever-reference
node bin/slopscore.mjs sheet templates/willnever-reference
node bin/slopscore.mjs render templates/willnever-reference --range=0:15 --out=out/preview.mp4
```

## Directory Structure

```
~/dev/slopscore/
├── bin/slopscore.mjs         # Global CLI: init, studio, build, audio, sheet, render, loop, mcp
├── studio/                   # AMS Director Studio UI, HTTP daemon, Genereti Assistant, WebMCP
├── kit/                      # MeasureClock, AudioEngine, FeatureExtractor, LoopFinder, FrameContext
├── renderers/                # native, webgpu, threejs, fframes, hyperframes, pixijs, p5js + shared
├── mcp/                      # Stdio MCP server & tool handlers
├── templates/                # default starter & willnever-reference (v5.0)
├── docs/CONTRACTS.md         # Internal binary & API contracts
├── SPEC.md                   # Complete Technical Specification
├── HANDOFF.md                # Architecture Handoff Blueprint
└── SKILL.md                  # Agent Playbook & Skill Definition
```
