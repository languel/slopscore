// slopscore.config.js — Starter Project Manifest
export default {
  title: "My Audiovisual Piece",
  artist: "Slopscore Creator",
  version: "1.0.0",
  audio: {
    bpm: 128,
    timeSignature: [4, 4],
    durationSeconds: 60,
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
      name: "I. Ignition",
      startBar: 1,
      endBar: 8,
      particleRig: "gears",
      vp: [0.42, 0.46],
      camera: { type: "dollyPush", startDist: 16.8, endDist: 13.0, panX: 0.48 },
      shaders: { crtScanlines: true, chromaticAberration: 0.18, lumaRelief: true }
    },
    {
      id: "ch-1",
      name: "II. Lattice Pulse",
      startBar: 9,
      endBar: 16,
      particleRig: "crystals",
      vp: [0.55, 0.44],
      camera: { type: "lateralTrack", startDist: 13.5, endDist: 11.8, speed: 1.2, amplitude: 0.06 },
      shaders: { crtScanlines: true, chromaticAberration: 0.24, lumaRelief: true }
    },
    {
      id: "ch-2",
      name: "III. Golden Attractor",
      startBar: 17,
      endBar: 24,
      particleRig: "spiral",
      vp: [0.38, 0.50],
      camera: { type: "recoilShake", startDist: 12.0, endDist: 10.5, recoil: 1.4, shake: 0.012 },
      shaders: { crtScanlines: true, chromaticAberration: 0.32, lumaRelief: true }
    },
    {
      id: "ch-3",
      name: "IV. Horizon Coda",
      startBar: 25,
      endBar: 32,
      particleRig: "butterflies",
      vp: [0.50, 0.42],
      camera: { type: "pullBack", startDist: 11.5, endDist: 19.0 },
      shaders: { crtScanlines: true, chromaticAberration: 0.12, lumaRelief: true }
    }
  ]
};
