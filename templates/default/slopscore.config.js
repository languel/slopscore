// slopscore.config.js — Starter Project Manifest
export default {
  title: "My Audiovisual Piece",
  artist: "Slopscore Creator",
  version: "1.0.0",
  audio: {
    bpm: 166,
    timeSignature: [4, 4],
    durationSeconds: 185.06,
    scorePath: "score/score.wav",
    stemsDir: "score/stems/"
  },
  renderer: "threejs", // "native" | "webgpu" | "threejs" | "fframes" | "hyperframes" | "pixijs" | "p5js"
  aspectRatio: "16:9",
  resolution: [1280, 720],
  fps: 30,
  chapters: [
    {
      id: "ch-0",
      name: "I. Machine for Making Choices",
      startBar: 1,
      endBar: 16,
      particleRig: "gears",
      mood: "intro",
      vp: [0.42, 0.46],
      camera: { type: "dollyPush", startDist: 17.0, endDist: 13.0, panX: 0.45 },
      shaders: { crtScanlines: true, chromaticAberration: 0.16, lumaRelief: true }
    },
    {
      id: "ch-1",
      name: "II. Machine for Making Sense",
      startBar: 17,
      endBar: 32,
      particleRig: "crystals",
      mood: "verse",
      vp: [0.55, 0.44],
      camera: { type: "lateralTrack", startDist: 14.0, endDist: 11.5, speed: 1.2, amplitude: 0.08 },
      shaders: { crtScanlines: true, chromaticAberration: 0.22, lumaRelief: true }
    },
    {
      id: "ch-2",
      name: "III. Machine for Sending Letters",
      startBar: 33,
      endBar: 48,
      particleRig: "helix",
      mood: "buildup",
      vp: [0.48, 0.52],
      camera: { type: "lateralTrack", startDist: 15.0, endDist: 11.0, speed: 1.5, amplitude: 0.10 },
      shaders: { crtScanlines: true, chromaticAberration: 0.28, lumaRelief: true }
    },
    {
      id: "ch-3",
      name: "IV. Machine for Measuring Regret",
      startBar: 49,
      endBar: 64,
      particleRig: "spiral",
      mood: "drop",
      vp: [0.38, 0.50],
      camera: { type: "recoilShake", startDist: 12.0, endDist: 10.0, recoil: 1.5, shake: 0.015 },
      shaders: { crtScanlines: true, chromaticAberration: 0.35, lumaRelief: true }
    },
    {
      id: "ch-4",
      name: "V. Machine for Harvesting Static",
      startBar: 65,
      endBar: 80,
      particleRig: "sparkRings",
      mood: "dub",
      vp: [0.52, 0.46],
      camera: { type: "lateralTrack", startDist: 13.5, endDist: 12.0, speed: 0.8, amplitude: 0.06 },
      shaders: { crtScanlines: true, chromaticAberration: 0.30, lumaRelief: true }
    },
    {
      id: "ch-5",
      name: "VI. Machine for Forgetting Names",
      startBar: 81,
      endBar: 96,
      particleRig: "voxels",
      mood: "breakdown",
      vp: [0.46, 0.42],
      camera: { type: "dollyPush", startDist: 16.5, endDist: 14.0, panX: 0.50 },
      shaders: { crtScanlines: true, chromaticAberration: 0.15, lumaRelief: true }
    },
    {
      id: "ch-6",
      name: "VII. Machine for Predicting Thunder",
      startBar: 97,
      endBar: 112,
      particleRig: "butterflies",
      mood: "climax",
      vp: [0.50, 0.48],
      camera: { type: "recoilShake", startDist: 13.0, endDist: 9.5, recoil: 1.8, shake: 0.020 },
      shaders: { crtScanlines: true, chromaticAberration: 0.40, lumaRelief: true }
    },
    {
      id: "ch-7",
      name: "VIII. Machine for Remembering the Sun",
      startBar: 113,
      endBar: 128,
      particleRig: "relief",
      mood: "outro",
      vp: [0.50, 0.42],
      camera: { type: "pullBack", startDist: 11.0, endDist: 18.5, panX: 0.50 },
      shaders: { crtScanlines: true, chromaticAberration: 0.12, lumaRelief: true }
    }
  ]
};
