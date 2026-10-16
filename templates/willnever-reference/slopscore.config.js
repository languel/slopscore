// slopscore.config.js — Reference Realization: "Will Never Make Art / GRAMMATIZATOR" (v5.0)
// 180s @ 164 BPM (123 bars in 4/4), 8 bar-locked chapters, Dual Particle Constellations.

export default {
  title: "GRAMMATIZATOR (Will Never Make Art)",
  artist: "10,000 CHOICES",
  version: "5.0.0",
  audio: {
    bpm: 164,
    timeSignature: [4, 4],
    durationSeconds: 180,
    scorePath: "score/score.wav",
    stemsDir: "score/stems/",
    key: "F minor"
  },
  renderer: "native", // "native" | "webgpu" | "threejs" | "fframes" | "hyperframes" | "pixijs" | "p5js"
  aspectRatio: "16:9",
  resolution: [1280, 720],
  fps: 30,
  native: {
    legacy: true
  },
  sheet: {
    times: [4, 16, 50, 70, 90, 105, 120, 140, 155, 160, 168, 174]
  },
  cues: [
    { bar: 1, label: "Bar 1 Intro" },
    { bar: 15, label: "Bar 15 Matrix" },
    { bar: 24, label: "Bar 24 Hook A" },
    { bar: 41, label: "Bar 41 Dub Bridge" },
    { bar: 57, label: "Bar 57 Serpent" },
    { bar: 74, label: "Bar 74 Spiral" },
    { bar: 85, label: "Bar 85 Climax" },
    { bar: 109, label: "Bar 109 Picardy Coda" }
  ],
  chapters: [
    {
      id: "ch-0",
      name: "0. The Morning Shift",
      startBar: 1,
      endBar: 14,
      start: 0.0,
      end: 20.488,
      clipLoopId: "clip-tc-1",
      asset: "westinghouse_timechecks_1904.webm",
      particleRig: "gears",
      vp: [0.36, 0.46],
      camera: { type: "dollyPush", startDist: 16.8, endDist: 13.0, panX: 0.50 },
      shaders: { crtScanlines: true, chromaticAberration: 0.18, lumaRelief: true, reliefDepth: 2.8 }
    },
    {
      id: "ch-1",
      name: "1. Synthetic Matrix",
      startBar: 15,
      endBar: 24,
      start: 20.488,
      end: 34.0,
      clipLoopId: "clip-horse-1",
      asset: "edison_sneeze_1894.webm",
      particleRig: "voxels",
      vp: [0.50, 0.44],
      camera: { type: "lateralTrack", startDist: 13.0, endDist: 11.4, speed: 1.1, amplitude: 0.05 },
      shaders: { crtScanlines: true, chromaticAberration: 0.22, lumaRelief: true, reliefDepth: 2.8 }
    },
    {
      id: "ch-2",
      name: "2. The Big Ring",
      startBar: 25,
      endBar: 40,
      start: 34.0,
      end: 58.537,
      clipLoopId: "clip-weld-1",
      asset: "westinghouse_welding_1904.webm",
      particleRig: "sparkRings",
      vp: [0.32, 0.46],
      camera: { type: "recoilShake", startDist: 12.2, endDist: 10.8, recoil: 1.5, shake: 0.014 },
      shaders: { crtScanlines: true, chromaticAberration: 0.30, lumaRelief: true, reliefDepth: 3.1 }
    },
    {
      id: "ch-3",
      name: "3. Crystalline Pulse",
      startBar: 41,
      endBar: 56,
      start: 58.537,
      end: 81.951,
      clipLoopId: "clip-crys-1",
      asset: "crystal_microscope.ogv",
      particleRig: "crystals",
      vp: [0.68, 0.38],
      camera: { type: "breathing", startDist: 13.8, endDist: 12.6, speed: 1.6, amplitude: 0.55 },
      shaders: { crtScanlines: true, chromaticAberration: 0.16, lumaRelief: true, reliefDepth: 2.6 }
    },
    {
      id: "ch-4",
      name: "4. Serpentine Metamorphosis",
      startBar: 57,
      endBar: 73,
      start: 81.951,
      end: 106.829,
      clipLoopId: "clip-serp-1",
      asset: "edison_serpentine_1894.ogv",
      particleRig: "helix",
      vp: [0.66, 0.50],
      camera: { type: "vista", dist: 15.2, fromPanX: 0.40, toPanX: 0.60 },
      shaders: { crtScanlines: true, chromaticAberration: 0.12, lumaRelief: true, reliefDepth: 2.5 }
    },
    {
      id: "ch-5",
      name: "5. Golden Spiral Crescendo",
      startBar: 74,
      endBar: 84,
      start: 106.829,
      end: 124.0,
      clipLoopId: "clip-sun-1",
      asset: "sunflower_timelapse.ogv",
      particleRig: "spiral",
      vp: [0.28, 0.50],
      camera: { type: "vertigo", startDist: 16.5, endDist: 10.2, fov: 56 },
      shaders: { crtScanlines: true, chromaticAberration: 0.26, lumaRelief: true, reliefDepth: 2.9 }
    },
    {
      id: "ch-6",
      name: "6. Butterfly Swarm Climax",
      startBar: 85,
      endBar: 108,
      start: 124.0,
      end: 159.512,
      clipLoopId: "clip-bfly-1",
      asset: "edison_butterfly_1894.ogv",
      particleRig: "butterflies",
      vp: [0.36, 0.50],
      camera: { type: "orbit", startDist: 11.8, endDist: 10.4, radius: 0.09 },
      shaders: { crtScanlines: true, chromaticAberration: 0.34, lumaRelief: true, reliefDepth: 3.2 }
    },
    {
      id: "ch-7",
      name: "7. Picardy Major Sunset Coda",
      startBar: 109,
      endBar: 123,
      start: 159.512,
      end: 180.0,
      clipLoopId: "clip-tc-3",
      asset: "westinghouse_timechecks_1904.webm",
      particleRig: "gears",
      vp: [0.50, 0.42],
      camera: { type: "pullBack", startDist: 12.0, endDist: 20.5, endCharScale: 0.82 },
      shaders: { crtScanlines: true, chromaticAberration: 0.14, lumaRelief: true, reliefDepth: 2.2 }
    }
  ]
};
