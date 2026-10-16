// frame-context.js — Builds the universal RenderFrameContext for every renderer.
// Isomorphic (browser + Node). This is the SINGLE source of truth for chapter timing,
// morphs, camera splines and clip-loop frame resolution. Native (C) and fframes (Rust)
// renderers do not re-implement this logic: they consume the binary encoding written
// by encodeContextBin() — see CONTEXT_LAYOUT below and renderers/CONTRACT.md.

import { MeasureClock, clamp, lerp, smoothstep, noise1d } from './measure-clock.js';
import { PARTICLE_RIGS, CAMERA_TYPES } from './project-schema.js';

/** Float32 slots per frame in context.bin. Keep in sync with renderers/native/context.h and renderers/fframes/src/context.rs */
export const CONTEXT_STRIDE = 32;
export const CONTEXT_LAYOUT = [
  'time', 'bar', 'beatPhase', 'measurePhase', 'phrase4Bar', 'chapter', 'nextChapter', 'chProgress', // 0-7
  'chMorphT', 'rms', 'bass', 'mid', 'high', 'transient', 'glitch', 'panX',                          // 8-15
  'panY', 'dist', 'fov', 'roll', 'charScale', 'clipA', 'clipB', 'frameA',                           // 16-23
  'frameB', 'rigA', 'rigB', 'vpU', 'vpV', 'scanlines', 'chroma', 'reliefDepth'                      // 24-31
];
export const CTX = Object.fromEntries(CONTEXT_LAYOUT.map((k, i) => [k, i]));

const ZERO_AUDIO = Object.freeze({ rms: 0, bass: 0, mid: 0, high: 0, transient: 0, glitch: 0 });
export const FEATURE_KEYS = ['rms', 'bass', 'mid', 'high', 'transient', 'glitch'];

/**
 * Wrap raw features (Float32Array stride 6, or {frames:[{rms..}]}) into a sampler.
 * @returns {{fps:number, count:number, at:(t:number)=>object}}
 */
export function featureSampler(features, fps = 30) {
  if (!features) return { fps, count: 0, at: () => ZERO_AUDIO };
  if (features.at && features.count != null) return features;
  if (features instanceof Float32Array || ArrayBuffer.isView(features)) {
    const arr = features;
    const count = Math.floor(arr.length / 6);
    return {
      fps, count, data: arr,
      at(t) {
        if (!count) return ZERO_AUDIO;
        const i = clamp(Math.floor(t * fps), 0, count - 1) * 6;
        return { rms: arr[i], bass: arr[i + 1], mid: arr[i + 2], high: arr[i + 3], transient: arr[i + 4], glitch: arr[i + 5] };
      }
    };
  }
  const frames = features.frames || [];
  const ffps = features.fps || fps;
  return {
    fps: ffps, count: frames.length,
    at(t) {
      if (!frames.length) return ZERO_AUDIO;
      const f = frames[clamp(Math.floor(t * ffps), 0, frames.length - 1)];
      return Array.isArray(f) ? { rms: f[0], bass: f[1], mid: f[2], high: f[3], transient: f[4], glitch: f[5] } : f;
    }
  };
}

/** Evaluate a chapter camera at chapter progress p. Returns CameraState. */
export function evaluateCamera(cam, p, t, audio, clock) {
  const a = audio || ZERO_AUDIO;
  const base = {
    panX: cam.panX ?? 0.5, panY: cam.panY ?? 0.5, dist: cam.dist ?? 14,
    fov: cam.fov ?? 56, roll: cam.roll ?? 0, charScale: cam.charScale ?? 1
  };
  const startDist = cam.startDist ?? base.dist;
  const endDist = cam.endDist ?? base.dist;
  const e = p * p * (3 - 2 * p);
  switch (cam.type) {
    case 'dollyPush': // slow cinematic push-in (v4 ch0)
      base.dist = lerp(cam.startDist ?? 16.8, cam.endDist ?? 13.0, p * p);
      base.panX = lerp(cam.startPanX ?? base.panX - 0.06, base.panX, p);
      base.charScale = lerp(cam.startCharScale ?? 0.85, cam.endCharScale ?? 1.15, p);
      break;
    case 'lateralTrack': // rhythmic lateral tracking (v4 ch1)
      base.dist = startDist + Math.sin(t * 2.2) * 0.65 - p * (cam.pushIn ?? 1.6);
      base.panX = base.panX + Math.sin(t * (cam.speed ?? 1.1)) * (cam.amplitude ?? 0.05);
      break;
    case 'breathing':
      base.dist = startDist + Math.sin(t * (cam.speed ?? 2.2)) * (cam.amplitude ?? 0.65);
      base.panY = base.panY + Math.sin(t * 0.7) * 0.015;
      break;
    case 'recoilShake': { // hero bass recoil
      const kick = a.bass * (cam.recoil ?? 1.4) + a.transient * 0.8;
      const shake = (cam.shake ?? 0.012) * (0.4 + a.transient * 2.0);
      base.dist = lerp(startDist, endDist, e) - kick;
      base.panX += noise1d(t * 13.7) * shake;
      base.panY += noise1d(t * 11.3 + 40) * shake;
      base.roll += noise1d(t * 9.1 + 80) * shake * 0.8;
      break;
    }
    case 'vertigo': { // dolly zoom: distance changes while fov compensates to keep subject size
      const d0 = cam.startDist ?? 18, d1 = cam.endDist ?? 9;
      base.dist = lerp(d0, d1, e);
      const halfH = d0 * Math.tan(((cam.fov ?? 56) * Math.PI) / 360);
      base.fov = (2 * Math.atan(halfH / base.dist) * 180) / Math.PI;
      break;
    }
    case 'vista': // panoramic slow pan
      base.dist = cam.dist ?? 20;
      base.panX = lerp(cam.fromPanX ?? 0.38, cam.toPanX ?? 0.62, e);
      base.panY = base.panY - 0.03 * Math.sin(p * Math.PI);
      break;
    case 'pullBack': // sunset pull-back
      base.dist = lerp(cam.startDist ?? 12, cam.endDist ?? 22, 1 - Math.pow(1 - p, 2));
      base.roll = (cam.roll ?? 0) + Math.sin(p * Math.PI) * 0.02;
      base.charScale = lerp(1, cam.endCharScale ?? 0.8, p);
      break;
    case 'orbit': {
      const ang = (cam.startAngle ?? 0) + p * (cam.sweep ?? Math.PI * 0.5) + t * (cam.spin ?? 0);
      base.panX = 0.5 + Math.sin(ang) * (cam.radius ?? 0.08);
      base.panY = 0.5 + Math.cos(ang) * (cam.radius ?? 0.08) * 0.4;
      base.roll = Math.sin(ang) * (cam.rollAmount ?? 0.04);
      base.dist = lerp(startDist, endDist, e);
      break;
    }
    default: // static
      base.dist = lerp(startDist, endDist, e);
  }
  // Subtle bass breathing on the lens, as in v4 (fov + bass * 40px ≈ +1.7°).
  base.fov += a.bass * (cam.bassZoom ?? 1.7);
  return base;
}

function blendCamera(a, b, t) {
  const o = {};
  for (const k of Object.keys(a)) o[k] = lerp(a[k], b[k] ?? a[k], t);
  return o;
}

/** Resolve the bank frame for a clip at a local time, honoring loop mode + speed. */
export function resolveClipFrame(bankClip, localSec, { mode = 'loop', speed = 1 } = {}) {
  if (!bankClip || !bankClip.count) return -1;
  const n = bankClip.count;
  const raw = Math.floor(localSec * speed * (bankClip.fps || 15));
  let i;
  switch (mode) {
    case 'pingpong': { const period = Math.max(1, 2 * n - 2); const m = ((raw % period) + period) % period; i = m < n ? m : period - m; break; }
    case 'reverse': i = n - 1 - (((raw % n) + n) % n); break;
    case 'once': i = clamp(raw, 0, n - 1); break;
    default: i = ((raw % n) + n) % n;
  }
  return bankClip.offset + i;
}

/**
 * Create a timeline for a normalized project.
 * @param {object} project normalized project (kit/project-schema.js)
 * @param {object} [opts]
 * @param {*} [opts.features] Float32Array (stride 6) | {frames, fps} | sampler
 * @param {Array} [opts.clips] saved clip library (feedback/clips.json)
 * @param {object} [opts.bank] bank manifest (out/bank.json) {fps, clips:[{key, index, offset, count, fps}]}
 * @param {object} [opts.overrides] live overrides { shaders:{}, camera:{}, chapters:{[id]:{...}} }
 */
export function createTimeline(project, opts = {}) {
  const clock = new MeasureClock({ bpm: project.audio.bpm, timeSignature: project.audio.timeSignature, duration: project.audio.durationSeconds });
  const fps = project.fps;
  const features = featureSampler(opts.features, fps);
  const clipsById = new Map((opts.clips || []).map(c => [c.id, c]));
  const bankClips = new Map(((opts.bank && opts.bank.clips) || []).map(c => [c.key, c]));
  const overrides = opts.overrides || { shaders: {}, camera: {}, chapters: {} };
  const chapters = project.chapters;

  function chapterIndexAt(t) {
    for (let i = chapters.length - 1; i >= 0; i--) if (t >= chapters[i].start) return i;
    return 0;
  }

  function clipFor(ch, t) {
    const clip = ch.clipLoopId ? clipsById.get(ch.clipLoopId) : null;
    const key = clip ? clip.id : (ch.asset || null);
    const bc = key ? bankClips.get(key) : null;
    const local = t - ch.start;
    return {
      id: key, sourceId: clip?.sourceId || ch.asset || null,
      index: bc ? bc.index : -1,
      frame: bc ? resolveClipFrame(bc, local, { mode: clip?.mode || 'loop', speed: clip?.speed || 1 }) : -1,
      localTime: clip ? (clip.inSec || 0) + ((local * (clip.speed || 1)) % Math.max(0.001, (clip.outSec || 0) - (clip.inSec || 0))) : local
    };
  }

  function chapterView(i) {
    const c = chapters[i];
    const o = overrides.chapters?.[c.id];
    return o ? { ...c, ...o, camera: { ...c.camera, ...(o.camera || {}) }, shaders: { ...c.shaders, ...(o.shaders || {}) } } : c;
  }

  function contextAt(t, frame = Math.round(t * fps)) {
    const pos = clock.positionAt(t);
    const ci = chapterIndexAt(t);
    const ch = chapterView(ci);
    const ni = Math.min(ci + 1, chapters.length - 1);
    const nch = chapterView(ni);
    const chDur = Math.max(1e-6, ch.end - ch.start);
    const chProgress = clamp((t - ch.start) / chDur, 0, 1);
    const trans = ch.transitionBars * clock.barSec;
    const chMorphT = ci < chapters.length - 1 && t > ch.end - trans ? smoothstep(ch.end - trans, ch.end, t) : 0;
    const audio = features.at(t);

    let camera = evaluateCamera(ch.camera, chProgress, t, audio, clock);
    if (chMorphT > 0) camera = blendCamera(camera, evaluateCamera(nch.camera, 0, t, audio, clock), chMorphT);
    if (overrides.camera) Object.assign(camera, overrides.camera);

    const shaders = { ...ch.shaders, ...(overrides.shaders || {}) };
    const vp = [lerp(ch.vp[0], nch.vp[0], chMorphT), lerp(ch.vp[1], nch.vp[1], chMorphT)];

    return {
      time: t, fps, frame,
      bar: pos.bar, barIndex: pos.barIndex, beatIndex: pos.beatIndex, beatInBar: pos.beatInBar,
      beatPhase: pos.beatPhase, measurePhase: pos.measurePhase, phrase4Bar: pos.phrase4Bar,
      pulse: pos.pulse, downbeatPulse: pos.downbeatPulse,
      chapter: ci, nextChapter: ni, chapterId: ch.id, chapterName: ch.name,
      chProgress, chMorphT,
      audio,
      stems: opts.stems ? opts.stems(t) : undefined,
      camera,
      rig: ch.particleRig, nextRig: nch.particleRig,
      vp, shaders, params: ch.params || {},
      clip: { a: clipFor(ch, t), b: clipFor(nch, t) },
      resolution: project.resolution,
      bpm: clock.bpm, barSec: clock.barSec, beatSec: clock.beatSec,
      assets: null // injected by host (AssetManager) in browser runtimes
    };
  }

  return {
    clock, fps, features, overrides, project,
    duration: project.audio.durationSeconds,
    frameCount: Math.ceil(project.audio.durationSeconds * fps),
    chapterIndexAt,
    contextAt,
    contextForFrame: (f) => contextAt(f / fps, f)
  };
}

/** Pack one context into CONTEXT_STRIDE floats at `out[offset..]`. */
export function packContext(ctx, out, offset = 0) {
  const o = out;
  const s = ctx.shaders || {};
  const v = [
    ctx.time, ctx.bar, ctx.beatPhase, ctx.measurePhase, ctx.phrase4Bar, ctx.chapter, ctx.nextChapter, ctx.chProgress,
    ctx.chMorphT, ctx.audio.rms, ctx.audio.bass, ctx.audio.mid, ctx.audio.high, ctx.audio.transient, ctx.audio.glitch, ctx.camera.panX,
    ctx.camera.panY, ctx.camera.dist, ctx.camera.fov, ctx.camera.roll, ctx.camera.charScale, ctx.clip.a.index, ctx.clip.b.index, ctx.clip.a.frame,
    ctx.clip.b.frame, Math.max(0, PARTICLE_RIGS.indexOf(ctx.rig)), Math.max(0, PARTICLE_RIGS.indexOf(ctx.nextRig)), ctx.vp[0], ctx.vp[1],
    s.crtScanlines === false ? 0 : (typeof s.crtScanlines === 'number' ? s.crtScanlines : 1),
    +s.chromaticAberration || 0,
    s.lumaRelief === false ? 0 : (+s.reliefDepth || 2.8)
  ];
  for (let i = 0; i < CONTEXT_STRIDE; i++) o[offset + i] = v[i];
  return o;
}

/** Encode frames [start, end) of a timeline into a Float32Array (CONTEXT_STRIDE per frame). */
export function encodeContextBin(timeline, start = 0, end = timeline.frameCount) {
  const n = Math.max(0, end - start);
  const out = new Float32Array(n * CONTEXT_STRIDE);
  for (let f = 0; f < n; f++) packContext(timeline.contextForFrame(start + f), out, f * CONTEXT_STRIDE);
  return out;
}

/** Decode one frame from a context.bin Float32Array (handy for tests / debugging). */
export function decodeContext(arr, frame) {
  const o = {};
  const base = frame * CONTEXT_STRIDE;
  CONTEXT_LAYOUT.forEach((k, i) => { o[k] = arr[base + i]; });
  return o;
}

export { CAMERA_TYPES, PARTICLE_RIGS };
