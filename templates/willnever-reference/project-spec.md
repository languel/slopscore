# Project Specification Sheet

**Project Title:** GRAMMATIZATOR (Will Never Make Art)  
**Status:** In Production / Reference Track  
**Engine:** Native C / Metal (Primary), Three.js / WebGPU (WebGL)  

---

## 1. Creative Direction & Aesthetic
- **Concept:** Procedural generative music video driven by algorithmic typography, CRT scanlines, archival 3D relief unprojection, and dual particle constellations.
- **Narrative Arc:**
  - *Ch 0: Title Card & Boot* (0.0s – 7.3s / Bars 1–5): CRT terminal power-on, green phosphor matrix, slow sub-bass emergence.
  - *Ch 1: The Machine Awakens* (7.3s – 14.6s / Bars 5–9): Gear rigs engage, particle plexus lines snap into 3D geometry.
  - *Ch 2: Archival Relief Scan* (14.6s – 21.9s / Bars 9–13): Luma unprojection from archival footage with kick-driven depth extrusion.
  - *Ch 3: Crystal Resonance* (21.9s – 29.2s / Bars 13–17): Octahedral crystals pulsing with high-frequency harmonic energy.
  - *Ch 4: Break & Glitch* (29.2s – 36.5s / Bars 17–21): Transient spike drops, chromatic aberration surges to 0.45.
  - *Ch 5: Full Constellation* (36.5s – 43.9s / Bars 21–25): 420 dual-particle constellation running all geometric attractors in concert.
  - *Ch 6: Peak Climax* (43.9s – 51.2s / Bars 25–29): Maximum density, multi-band energy pulse, kinetic typography overlay.
  - *Ch 7: Loop Dissolution* (51.2s – 58.5s / Bars 29–33): Attractors dissolve back into noise field for seamless bar-quantized loop reset.

---

## 2. Musical & Audio Architecture
| Parameter | Value | Details |
| :--- | :--- | :--- |
| **Tempo** | 164 BPM | 1 Bar = 1.463s • 1 Beat = 0.366s |
| **Time Signature** | 4/4 | 32 Musical Measures (128 Beats) |
| **Duration** | 58.536s | Exactly 1756 frames @ 30 fps |
| **Stems** | 5 Discrete Bands | Master, Drums, Bass, Synths, FX |
| **Features** | 6 Float Channels | RMS, Bass (40–120Hz), Mid (250–2.5kHz), High (4–12kHz), Transient, Glitch |

---

## 3. Visual Pipeline & Shaders
- **Dual Particle Constellation:** 420 particles with dual coordinates:
  - Coordinate A: Archival relief unprojection `Z = (L - 0.45) * depthScale + bassKick`
  - Coordinate B: Rig attractors (`gears`, `crystals`, `sparkRings`, `relief`)
- **CRT Shader Post-processing:**
  - Chromatic Aberration: `0.20` base, modulated by high-frequency transients.
  - Scanline Density: 360 lines with 0.15 intensity.
  - Phosphor Bloom & Vignette.

---

## 4. Director Checkpoints
- [x] Align 8 narrative chapters to 4-bar boundaries
- [x] Verify seamless A/B loop closure at 58.536s
- [x] Export isolated stems and feature analysis buffers
- [ ] Review CRT blooming under light theme
