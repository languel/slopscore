// renderers/shared/dual-particles.js
// Isomorphic implementation of the 420-particle Dual Particle Constellation System:
//   - Archival footage luma-relief unprojection: Z = (L - 0.45) * depthScale + bassKick
//   - 3D geometric attractors for all PARTICLE_RIGS (gears, voxels, sparkRings, crystals,
//     helix, spiral, butterflies, relief)
//   - Continuous chapter morphing (rig -> nextRig via chMorphT + 4-bar phrase breathing)
//   - Plexus constellation line pair generation within 3D distance threshold (d < 2.05)

import { clamp, lerp } from '../../kit/measure-clock.js';
import { PARTICLE_RIGS } from '../../kit/project-schema.js';

export const DUAL_PARTICLE_COUNT = 420;
export const GOLDEN_ANGLE = 2.399963229728653;
export const PHI = 1.618033988749895;

export function hashf(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

export function hash2f(x, y) {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return v - Math.floor(v);
}

/** Focal length in pixels for a projection of height H at vertical FOV in degrees. */
export function fovDegreesToPixels(fovDeg = 56, height = 720) {
  const rad = (clamp(fovDeg, 15, 140) * Math.PI) / 360;
  return (height * 0.5) / Math.tan(rad);
}

/** Project a 3D world point (x, y, z) onto screen space (sx, sy, depth). */
export function projectVP(v, camDist, fovScale, panX, panY, W, H) {
  const z = v.z + camDist;
  if (z < 0.7) return null;
  return {
    sx: W * panX + (v.x / z) * fovScale,
    sy: H * panY + (v.y / z) * fovScale,
    depth: z
  };
}

/** Unproject normalized (u, v) on plane zPlane into 3D world coordinates. */
export function unprojectUV(u, v, zPlane, camDist, fovScale, panX, panY, W, H) {
  const z = zPlane + camDist;
  return {
    x: ((u - panX) * W * z) / fovScale,
    y: ((v - panY) * H * z) / fovScale,
    z: zPlane
  };
}

/** Divergence-free 2D curl-noise velocity field matching native-render.m. */
export function curlVelocity2D(u, v, t) {
  const eps = 0.01;
  const psiY1 =
    Math.sin(u * 8.5 + t * 1.6) * Math.cos((v + eps) * 7.2 - t * 1.3) +
    0.5 * Math.cos((u - v - eps) * 14.0 + t * 2.4);
  const psiY0 =
    Math.sin(u * 8.5 + t * 1.6) * Math.cos((v - eps) * 7.2 - t * 1.3) +
    0.5 * Math.cos((u - v + eps) * 14.0 + t * 2.4);
  const psiX1 =
    Math.sin((u + eps) * 8.5 + t * 1.6) * Math.cos(v * 7.2 - t * 1.3) +
    0.5 * Math.cos((u + eps - v) * 14.0 + t * 2.4);
  const psiX0 =
    Math.sin((u - eps) * 8.5 + t * 1.6) * Math.cos(v * 7.2 - t * 1.3) +
    0.5 * Math.cos((u - eps - v) * 14.0 + t * 2.4);
  return {
    vx: ((psiY1 - psiY0) / (2.0 * eps)) * 0.018,
    vy: -((psiX1 - psiX0) / (2.0 * eps)) * 0.018
  };
}

/**
 * Evaluate the 3D geometric attractor target and RGB color for particle `i` in `rig`.
 * Supports both string names ('gears', 'voxels', ...) and numeric rig indices (0..8).
 */
export function evaluateRigAttractor(i, rig, t, audio = {}, count = DUAL_PARTICLE_COUNT) {
  const rigName = typeof rig === 'number' ? (PARTICLE_RIGS[rig] || 'relief') : (rig || 'relief');
  const bass = audio.bass || 0;
  const mid = audio.mid || 0;
  const high = audio.high || 0;
  const transient = audio.transient || 0;

  let x = 0, y = 0, z = 0;
  let r = 0.2, g = 0.9, b = 0.9;

  switch (rigName) {
    case 'gears': {
      const gAngle = (i / count) * 4.0 * Math.PI + t * 0.9;
      const gRadius = 2.4 + (i % 6 < 3 ? 0.35 : -0.25) + bass * 0.45;
      x = Math.cos(gAngle) * gRadius + 1.2;
      y = Math.sin(gAngle) * gRadius - 0.3;
      z = Math.sin(t * 2.0 + i * 0.1) * 0.6;
      r = 0.98; g = 0.78; b = 0.24;
      break;
    }
    case 'voxels': {
      const gx = (i % 7) - 3;
      const gy = (Math.floor(i / 7) % 7) - 3;
      const gz = Math.floor(i / 49) - 4;
      x = gx * 0.82;
      y = gy * 0.82 + 0.2;
      z = gz * 0.90;
      r = 0.15; g = 0.98; b = 0.88;
      break;
    }
    case 'sparkRings': {
      const sAng = (i / count) * 6.0 * Math.PI + t * 2.8;
      const sparkBurst = i % 7 === 0 ? bass * 2.4 + transient * 1.6 : 0.0;
      const sRad = 2.8 + sparkBurst;
      x = Math.cos(sAng) * sRad;
      y = Math.sin(sAng) * sRad * 0.65;
      z = Math.cos(t * 3.5 + i) * 1.1;
      r = 1.00; g = 0.86; b = 0.32;
      break;
    }
    case 'crystals': {
      const k = i * 0.21;
      const cRad = 1.6 + (i % 8) * 0.42 + mid * 0.75;
      x = Math.sin(k * PHI + t * 0.7) * cRad - 0.8;
      y = Math.cos(k + t * 0.5) * cRad;
      z = Math.sin(k * 2.2 - t * 0.6) * cRad;
      r = 0.22; g = 0.95; b = 0.98;
      break;
    }
    case 'helix': {
      const u = i / count;
      const hAng = u * 8.0 * Math.PI + t * 1.6;
      const strand = i % 2 === 0 ? 1.0 : -1.0;
      x = Math.sin(hAng) * 2.6;
      y = (u - 0.5) * 6.8;
      z = Math.cos(hAng) * 2.6 * strand;
      r = 0.98; g = 0.42; b = 0.88;
      break;
    }
    case 'spiral': {
      const goldAng = i * GOLDEN_ANGLE + t * 1.3;
      const coneR = Math.sqrt(i / count) * 4.4;
      x = Math.cos(goldAng) * coneR + 0.5;
      y = (i / count) * 5.2 - 2.6;
      z = Math.sin(goldAng) * coneR;
      r = 1.00; g = 0.82 + 0.18 * Math.sin(i * 0.08); b = 0.25;
      break;
    }
    case 'butterflies': {
      const bIdx = i % 48;
      const flight = (hashf(bIdx * 3.3) + t * 0.20) % 1.0;
      const orbAng = bIdx * 0.55 + t * 1.1;
      const orbRad = 2.0 + (bIdx % 6) * 0.75;
      x = Math.cos(orbAng) * orbRad + (hashf(i * 1.7) - 0.5) * 1.4;
      y = Math.sin(orbAng * 1.4) * 2.0 + Math.cos(t * 1.8 + bIdx) * 0.7;
      z = lerp(-5.0, 4.5, flight);
      r = i % 3 === 0 ? 0.18 : i % 3 === 1 ? 1.00 : 0.98;
      g = i % 3 === 0 ? 0.98 : i % 3 === 1 ? 0.45 : 0.85;
      b = i % 3 === 0 ? 0.90 : i % 3 === 1 ? 0.82 : 0.32;
      break;
    }
    case 'none':
    case 'relief':
    default: {
      const gx = (i % 20) - 10;
      const gz = Math.floor(i / 20);
      const rawZ = (gz * 1.9 - t * 2.2) % 19.0;
      const zP = (rawZ < 0 ? rawZ + 19.0 : rawZ) - 7.0;
      x = gx * 1.35;
      y = 3.2 + Math.sin(gx * 0.6 + t) * 0.35;
      z = zP;
      r = 0.95; g = 0.68; b = 0.42 + high * 0.25;
      break;
    }
  }

  return { x, y, z, r, g, b };
}

/**
 * Default procedural fallback archival sampler when no video/image bank frame is bound.
 * Produces rich sinusoidal steel-plate / fluid interference luminance and RGB values.
 */
export function defaultProceduralSample(u, v, t, chapter = 0) {
  const wave1 = Math.sin(u * 14.0 + t * 1.4) * Math.cos(v * 11.0 - t * 1.1);
  const wave2 = Math.cos((u - v) * 19.0 + t * 2.1 + chapter * 0.7);
  const luma = clamp(0.46 + 0.28 * wave1 + 0.18 * wave2, 0.05, 0.98);
  const r = clamp(luma * (0.75 + 0.25 * Math.sin(chapter + u * 4.0)), 0, 1);
  const g = clamp(luma * (0.85 + 0.15 * Math.cos(t * 0.7 + v * 5.0)), 0, 1);
  const b = clamp(luma * (0.92 + 0.08 * Math.sin(u * 6.0 - t)), 0, 1);
  return { r, g, b, luma };
}

/**
 * Compute the full 420-particle Dual Particle Constellation state and Plexus line segments
 * for a given `RenderFrameContext`.
 *
 * @param {object} ctx RenderFrameContext from kit/frame-context.js
 * @param {object} [opts]
 * @param {(u:number, v:number) => {r:number,g:number,b:number,luma:number}} [opts.sampleUV]
 * @param {number} [opts.count=420]
 * @param {number} [opts.maxLines=320]
 */
export function computeDualParticles(ctx, opts = {}) {
  const count = opts.count || DUAL_PARTICLE_COUNT;
  const maxLines = opts.maxLines ?? 320;
  const [W, H] = ctx.resolution || [1280, 720];
  const t = ctx.time || 0;
  const ch = ctx.chapter || 0;
  const af = ctx.audio || { rms: 0, bass: 0, mid: 0, high: 0, transient: 0, glitch: 0 };
  const cam = ctx.camera || { panX: 0.5, panY: 0.5, dist: 14, fov: 56, roll: 0, charScale: 1 };
  const [vpU, vpV] = ctx.vp || [0.5, 0.46];
  const shaders = ctx.shaders || {};
  const phrase4Bar = ctx.phrase4Bar || 0;
  const chMorphT = ctx.chMorphT || 0;

  const fovPx = fovDegreesToPixels(cam.fov ?? 56, H);
  const reliefEnabled = shaders.lumaRelief !== false;
  const reliefDepth = reliefEnabled ? (Number(shaders.reliefDepth) || 2.8) : 0;
  const depthScale = reliefDepth + af.bass * 2.2;
  const bassKick = af.bass * 0.45 + af.transient * 0.25;
  const plexusEnabled = shaders.plexus !== false;
  const plexusDist = Number(shaders.plexusDistance) || 2.05;

  const rigA = ctx.rig || 'gears';
  const rigB = ctx.nextRig || rigA;

  const baseBreathe = 0.35 + 0.35 * Math.sin(phrase4Bar * 2.0 * Math.PI);
  const targetBlend = rigA === 'relief' ? 0.12 : rigA === 'none' ? 0.0 : (ch % 2 === 0 ? 0.88 : 0.22);
  const blendFactor = clamp(lerp(baseBreathe, targetBlend, chMorphT), 0.0, 1.0);

  const sampleUV =
    opts.sampleUV ||
    (ctx.assets && typeof ctx.assets.sampleClipUV === 'function'
      ? (u, v) => ctx.assets.sampleClipUV(ctx.clip?.a, u, v, t, ch)
      : (u, v) => defaultProceduralSample(u, v, t, ch));

  const particles = new Array(count);

  for (let i = 0; i < count; i++) {
    // A. Archival footage Fibonacci disk sampling & 3D relief unprojection
    const theta = i * GOLDEN_ANGLE;
    const radius = Math.sqrt((i + 0.5) / count) * 0.44;
    const au = clamp(0.5 + Math.cos(theta) * radius, 0.02, 0.98);
    const av = clamp(0.5 + Math.sin(theta) * radius, 0.02, 0.98);

    const samp = sampleUV(au, av) || defaultProceduralSample(au, av, t, ch);
    const lA = samp.luma ?? (0.299 * samp.r + 0.587 * samp.g + 0.114 * samp.b);

    // Z = (L - 0.45) * depthScale + bassKick
    const reliefZ = (lA - 0.45) * depthScale + bassKick;
    const pArch = unprojectUV(
      vpU + (au - 0.5) * 0.72,
      vpV + (av - 0.5) * 0.65,
      reliefZ,
      cam.dist,
      fovPx,
      cam.panX,
      cam.panY,
      W,
      H
    );

    const curl = curlVelocity2D(au, av, t * 0.8 + i * 0.005);
    pArch.x += curl.vx * (1.8 + af.transient * 1.5);
    pArch.y += curl.vy * (1.8 + af.transient * 1.5);

    const rArch = samp.r * 0.90 + 0.10;
    const gArch = samp.g * 0.95 + 0.05;
    const bArch = samp.b * 0.90 + 0.15;

    // B. Generative 3D attractor target (with chapter morphing rigA -> rigB)
    const gA = evaluateRigAttractor(i, rigA, t, af, count);
    let pGfx = gA;
    if (chMorphT > 0.001 && rigB !== rigA) {
      const gB = evaluateRigAttractor(i, rigB, t, af, count);
      pGfx = {
        x: lerp(gA.x, gB.x, chMorphT),
        y: lerp(gA.y, gB.y, chMorphT),
        z: lerp(gA.z, gB.z, chMorphT),
        r: lerp(gA.r, gB.r, chMorphT),
        g: lerp(gA.g, gB.g, chMorphT),
        b: lerp(gA.b, gB.b, chMorphT)
      };
    }

    // C. Continuous morph between archival relief and 3D attractor construct
    const pos = {
      x: lerp(pArch.x, pGfx.x, blendFactor),
      y: lerp(pArch.y, pGfx.y, blendFactor),
      z: lerp(pArch.z, pGfx.z, blendFactor)
    };
    const r = lerp(rArch, pGfx.r, blendFactor);
    const g = lerp(gArch, pGfx.g, blendFactor);
    const b = lerp(bArch, pGfx.b, blendFactor);
    const alpha = clamp(0.55 + 0.35 * Math.sin(t * 4.0 + i * 0.1) + af.transient * 0.3, 0.30, 0.95);

    const proj = projectVP(pos, cam.dist, fovPx, cam.panX, cam.panY, W, H);
    const depth = proj ? proj.depth : cam.dist;
    const size = clamp(28.0 / depth, 2.2, 6.8) * (1.0 + af.transient * 0.8);

    particles[i] = {
      index: i,
      u: au,
      v: av,
      luma: lA,
      posArch: pArch,
      posGfx: { x: pGfx.x, y: pGfx.y, z: pGfx.z },
      pos,
      r,
      g,
      b,
      alpha,
      sx: proj ? proj.sx : -9999,
      sy: proj ? proj.sy : -9999,
      depth,
      size,
      visible: Boolean(proj)
    };
  }

  // D. Plexus constellation line pairs within 3D distance < plexusDist
  const lines = [];
  if (plexusEnabled) {
    for (let i = 0; i < count && lines.length < maxLines; i++) {
      const pi = particles[i];
      if (!pi.visible) continue;
      const partners = [(i + 1) % count, (i + 7) % count];
      for (let p = 0; p < 2; p++) {
        const pj = particles[partners[p]];
        if (!pj.visible) continue;
        const dx = pi.pos.x - pj.pos.x;
        const dy = pi.pos.y - pj.pos.y;
        const dz = pi.pos.z - pj.pos.z;
        const dist3D = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist3D < plexusDist) {
          const lineAlpha = (1.0 - dist3D / plexusDist) * 0.55 * pi.alpha;
          lines.push({
            i,
            j: partners[p],
            ax: pi.pos.x, ay: pi.pos.y, az: pi.pos.z,
            bx: pj.pos.x, by: pj.pos.y, bz: pj.pos.z,
            sx0: pi.sx, sy0: pi.sy,
            sx1: pj.sx, sy1: pj.sy,
            r: pi.r, g: pi.g, b: pi.b,
            alpha: lineAlpha,
            dist: dist3D
          });
        }
      }
    }
  }

  return { particles, lines, blendFactor, fovPx };
}

/**
 * Render the computed Dual Particle Constellation + Plexus + Phosphor cores onto a 2D canvas context.
 */
export function drawDualParticles2D(g, state, ctx) {
  const { particles, lines } = state;
  const af = ctx.audio || { transient: 0 };
  const glowScale = ctx.shaders?.phosphorGlow ?? 1.0;

  // Pass 1: Plexus constellation lines
  g.lineWidth = 1.1;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const r = Math.round(clamp(ln.r, 0, 1) * 255);
    const gr = Math.round(clamp(ln.g, 0, 1) * 255);
    const b = Math.round(clamp(ln.b, 0, 1) * 255);
    g.strokeStyle = `rgba(${r},${gr},${b},${ln.alpha.toFixed(3)})`;
    g.beginPath();
    g.moveTo(ln.sx0, ln.sy0);
    g.lineTo(ln.sx1, ln.sy1);
    g.stroke();
  }

  // Pass 2: Phosphor core glow & specular transient halos
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (!p.visible) continue;
    const d = p.depth;
    const sz = p.size * glowScale;
    const fog = clamp(14.0 / (d + 2.0), 0.35, 1.15);
    const pr = clamp(p.r * fog, 0, 1);
    const pg = clamp(p.g * fog, 0, 1);
    const pb = clamp(p.b * fog, 0, 1);
    const pa = clamp(p.alpha * clamp(fog, 0.3, 1.0), 0, 1);

    g.fillStyle = `rgba(${Math.round(pr * 255)},${Math.round(pg * 255)},${Math.round(pb * 255)},${pa.toFixed(3)})`;
    g.fillRect(p.sx - sz * 0.5, p.sy - sz * 0.5, sz, sz);

    const coreSz = sz * 0.45;
    const cr = Math.round(clamp(pr + 0.35, 0, 1) * 255);
    const cg = Math.round(clamp(pg + 0.35, 0, 1) * 255);
    const cb = Math.round(clamp(pb + 0.35, 0, 1) * 255);
    g.fillStyle = `rgba(${cr},${cg},${cb},${pa.toFixed(3)})`;
    g.fillRect(p.sx - coreSz * 0.5, p.sy - coreSz * 0.5, coreSz, coreSz);

    if (af.transient > 0.28 && i % 4 === 0) {
      const haloSz = sz * 2.4;
      g.strokeStyle = `rgba(255,255,255,${(pa * 0.55).toFixed(3)})`;
      g.lineWidth = 0.85;
      g.beginPath();
      g.arc(p.sx, p.sy, haloSz * 0.5, 0, Math.PI * 2);
      g.stroke();
    }
  }
}
