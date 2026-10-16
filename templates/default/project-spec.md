# Project Specification Sheet

**Project Title:** Default Slopscore Project  
**Status:** In Development  
**Last Updated:** 2026-10-15  

---

## 1. Creative Vision & Concept
- **Genre / Style:** Procedural Audio-Visual / Cyberpunk Synthwave
- **Target Aesthetic:** High-contrast wireframes, dual-particle constellations, CRT scanlines, archival luma relief.
- **Narrative Arc:**
  - *Intro:* Sub-bass rumble, slow particle cluster assembly.
  - *Build:* Tempo drive, accelerating geometric attractors (gears & voxels).
  - *Climax:* Full spectrum explosion, multi-band energy pulse, harmonic resonance.
  - *Outro:* Dissolution into noise field and seamless loop return.

---

## 2. Audio & Timing Specs
| Parameter | Specification | Notes |
| :--- | :--- | :--- |
| **BPM** | 128 (Override configurable) | 4/4 Time Signature |
| **Duration** | 60.0s (1800 frames @ 30fps) | Loop-quantized to 32 bars |
| **Key / Scale** | D Minor / Dorian | Deep 45Hz sub harmonics |
| **Stems** | Master, Drums, Bass, Synths, FX | Rendered to `/project/score/stems/` |

---

## 3. Visual & Render Pipeline
- **Default Engine:** Three.js / WebGPU / Native C-Metal
- **Resolution:** 1280x720 (16:9 preview), 1920x1080 (final master)
- **Framerate:** 30 fps (preview) / 60 fps (production)
- **Active Rigs:**
  - `gears` (Bars 1–8)
  - `crystals` (Bars 9–16)
  - `sparkRings` (Bars 17–24)
  - `relief` (Bars 25–32)

---

## 4. Director Notes & Feedback Log
- [x] Initial composition arrangement & stem export
- [ ] Refine kick/bass sidechain ducking in chorus
- [ ] Dial in chromatic aberration & CRT phosphor bloom
- [ ] Verify seamless A/B loop closure at bar boundary

---

## 5. Assets & Archival Media
- Primary source bank: `/project/assets/`
- Output artifacts: `/project/out/video.mp4`, `/project/out/contact-sheet.jpg`
