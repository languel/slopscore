// project-schema.js — slopscore.config.js schema, defaults, and validation.
// Isomorphic: used by the Node config loader, the Studio (via /api/project), and MCP tools.

import { MeasureClock } from './measure-clock.js';

export const RENDERERS = ['native', 'webgpu', 'threejs', 'fframes', 'hyperframes', 'pixijs', 'p5js'];

/** Particle rig ids shared by every renderer (index = numeric id used in context.bin). */
export const PARTICLE_RIGS = [
  'none',        // 0
  'gears',       // 1 clockwork gears
  'voxels',      // 2 cybernetic voxel cubes
  'sparkRings',  // 3 high-voltage spark rings
  'crystals',    // 4 nested icosahedral crystals
  'helix',       // 5 double-helix ribbons
  'spiral',      // 6 golden spiral
  'butterflies', // 7 origami butterfly swarm
  'relief'       // 8 archival luma relief only (no attractor)
];

/** Camera move types evaluated by kit/frame-context.js (index = numeric id). */
export const CAMERA_TYPES = [
  'static', 'dollyPush', 'lateralTrack', 'breathing', 'recoilShake', 'vertigo', 'vista', 'pullBack', 'orbit'
];

export const CLIP_LOOP_MODES = ['loop', 'pingpong', 'reverse', 'once'];

export const DEFAULT_STEMS = [
  { id: 'master', name: 'Master Bus', color: '#00ffcc', role: 'Full stereo mix' },
  { id: 'drums', name: 'Drums', color: '#fbbf24', role: 'Kick, snare, hats, micro-percussion' },
  { id: 'bass', name: 'Bass', color: '#38bdf8', role: 'Sub + reese bass' },
  { id: 'lead', name: 'Lead', color: '#f43f5e', role: 'Portamento lead synth' },
  { id: 'pads', name: 'Pads', color: '#a855f7', role: 'Chord pads' },
  { id: 'melodic', name: 'Melodic', color: '#4ade80', role: 'Rhodes / FM marimba' },
  { id: 'glitch', name: 'Glitch FX', color: '#ec4899', role: 'Rolls, risers, reverse grains' }
];

export const DEFAULT_SHADERS = {
  crtScanlines: true,
  chromaticAberration: 0.2,
  lumaRelief: true,
  reliefDepth: 2.8,
  vignette: 0.24,
  plexus: true,
  plexusDistance: 2.05,
  phosphorGlow: 1.0
};

export const DEFAULT_CAMERA = { type: 'static', dist: 14, panX: 0.5, panY: 0.5, fov: 56, roll: 0, charScale: 1 };

const CHAPTER_COLORS = ['#00ffcc', '#38bdf8', '#fbbf24', '#a855f7', '#f43f5e', '#4ade80', '#ec4899', '#f97316'];

/** Identity helper so configs get editor hints: `export default defineConfig({...})`. */
export function defineConfig(cfg) { return cfg; }

/**
 * Normalize a raw config object into the canonical project shape.
 * Never throws; collects problems into `project.diagnostics` (use validateProject for strictness).
 */
export function normalizeProject(raw = {}) {
  const diagnostics = [];
  const audioIn = raw.audio || {};
  const bpm = num(audioIn.bpm ?? raw.bpm, 120);
  const timeSignature = Array.isArray(audioIn.timeSignature) ? audioIn.timeSignature.map(Number) : [4, 4];
  const duration = num(audioIn.durationSeconds ?? audioIn.duration ?? raw.duration, 60);
  const clock = new MeasureClock({ bpm, timeSignature, duration });

  const resolution = Array.isArray(raw.resolution) ? raw.resolution.map(Number) : [1280, 720];
  const fps = num(raw.fps, 30);
  const renderer = raw.renderer || 'native';
  if (!RENDERERS.includes(renderer)) diagnostics.push({ level: 'error', path: 'renderer', message: `Unknown renderer "${renderer}". Expected one of ${RENDERERS.join(', ')}` });

  const stems = (audioIn.stems || DEFAULT_STEMS).map((s, i) => ({
    color: CHAPTER_COLORS[i % CHAPTER_COLORS.length], role: '', ...s, name: s.name || s.id
  }));

  const chaptersIn = Array.isArray(raw.chapters) && raw.chapters.length ? raw.chapters : [{ id: 'ch-0', name: 'Main', startBar: 1, endBar: Math.max(1, Math.round(clock.totalBars)) }];
  const chapters = chaptersIn.map((c, i) => {
    const startBar = num(c.startBar, i === 0 ? 1 : null);
    const endBar = num(c.endBar, null);
    let start = c.start != null ? +c.start : (startBar != null ? clock.timeAtBar(startBar) : null);
    // endBar is inclusive: bar 14 ends where bar 15 begins.
    let end = c.end != null ? +c.end : (endBar != null ? clock.timeAtBar(endBar + 1) : null);
    return {
      index: i,
      id: c.id || `ch-${i}`,
      name: c.name || `Chapter ${i + 1}`,
      startBar, endBar, start, end,
      color: c.color || CHAPTER_COLORS[i % CHAPTER_COLORS.length],
      mood: c.mood || null,
      clipLoopId: c.clipLoopId || null,
      asset: c.asset || null,
      particleRig: c.particleRig || 'relief',
      vp: Array.isArray(c.vp) ? c.vp.map(Number) : [0.5, 0.46],
      camera: { ...DEFAULT_CAMERA, ...(c.camera || {}) },
      shaders: { ...DEFAULT_SHADERS, ...(raw.shaders || {}), ...(c.shaders || {}) },
      transitionBars: num(c.transitionBars, 1.5),
      notes: c.notes || '',
      params: c.params || {}
    };
  });
  // Fill gaps: a chapter without explicit start begins where the previous ended; missing end runs to next start / duration.
  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i];
    if (c.start == null) c.start = i === 0 ? 0 : chapters[i - 1].end;
    if (c.end == null) c.end = i + 1 < chapters.length && chapters[i + 1].start != null ? chapters[i + 1].start : duration;
    if (c.startBar == null) c.startBar = clock.barAt(c.start);
    if (c.endBar == null) c.endBar = clock.barAt(c.end) - 1;
    if (c.end <= c.start) diagnostics.push({ level: 'error', path: `chapters[${i}]`, message: `Chapter "${c.name}" ends before it starts` });
    if (!PARTICLE_RIGS.includes(c.particleRig)) diagnostics.push({ level: 'warn', path: `chapters[${i}].particleRig`, message: `Unknown particleRig "${c.particleRig}"` });
    if (!CAMERA_TYPES.includes(c.camera.type)) diagnostics.push({ level: 'warn', path: `chapters[${i}].camera.type`, message: `Unknown camera type "${c.camera.type}"` });
    if (i > 0 && c.start < chapters[i - 1].end - 1e-6) diagnostics.push({ level: 'warn', path: `chapters[${i}]`, message: `Chapter "${c.name}" overlaps previous chapter` });
  }

  const cues = (raw.cues || chapters.map(c => ({ bar: c.startBar, label: c.name }))).map(c => ({
    bar: num(c.bar, 1), label: c.label || `Bar ${c.bar}`, time: clock.timeAtBar(num(c.bar, 1))
  }));

  const sheetTimes = raw.sheet?.times || defaultSheetTimes(chapters, raw.sheet?.count || 12, duration);

  return {
    title: raw.title || 'Untitled Slopscore',
    artist: raw.artist || '',
    version: raw.version || '0.1.0',
    audio: {
      bpm, timeSignature, durationSeconds: duration,
      scorePath: audioIn.scorePath || 'score/score.wav',
      stemsDir: audioIn.stemsDir || 'score/stems/',
      synth: audioIn.synth === undefined ? 'procedural' : audioIn.synth, // 'procedural' | null | './path/to/synth.js'
      key: audioIn.key || 'F minor',
      sampleRate: num(audioIn.sampleRate, 44100),
      stems
    },
    renderer,
    layers: Array.isArray(raw.layers) ? raw.layers : null,
    aspectRatio: raw.aspectRatio || `${resolution[0]}:${resolution[1]}`,
    resolution,
    fps,
    assetsDir: raw.assetsDir || 'assets',
    scene: raw.scene || null,           // browser renderer scene module (project-relative)
    native: { source: null, legacy: false, ...(raw.native || {}) },
    bank: { width: 320, height: 180, fps: 15, maxFrames: 150, ...(raw.bank || {}) },
    shaders: { ...DEFAULT_SHADERS, ...(raw.shaders || {}) },
    chapters,
    cues,
    sheet: { times: sheetTimes },
    studio: { port: 8989, ...(raw.studio || {}) },
    assistant: raw.assistant || {},
    diagnostics
  };
}

/** Strict validation: returns { ok, errors, warnings }. */
export function validateProject(project) {
  const p = project.chapters ? project : normalizeProject(project);
  const errors = p.diagnostics.filter(d => d.level === 'error');
  const warnings = p.diagnostics.filter(d => d.level !== 'error');
  return { ok: errors.length === 0, errors, warnings };
}

function defaultSheetTimes(chapters, count, duration) {
  // Spread keyframes across chapters proportionally, sampling each chapter at its 40% point first.
  const times = chapters.map(c => +(c.start + (c.end - c.start) * 0.4).toFixed(2));
  let k = 1;
  while (times.length < count) {
    const t = +((duration * (k - 0.5)) / count).toFixed(2);
    if (!times.some(x => Math.abs(x - t) < duration / (count * 2))) times.push(t);
    k++;
    if (k > count * 4) break;
  }
  return times.slice(0, count).sort((a, b) => a - b);
}

function num(v, fallback) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : fallback;
}
