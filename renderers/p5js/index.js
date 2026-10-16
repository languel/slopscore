// renderers/p5js/index.js
// p5.js Generative Creative Coding Adapter for Slopscore 2.0.
// Combines curl-noise flow fields, sinusoidal engraving waves, Clifford/Lorenz chaotic attractors,
// the 420-particle Dual Particle Constellation + Plexus mesh, and procedural measure telemetry.

import { clamp, lerp } from '../../kit/measure-clock.js';
import {
  computeDualParticles,
  drawDualParticles2D,
  curlVelocity2D,
  hashf
} from '../shared/dual-particles.js';

export const meta = {
  id: 'p5js',
  name: 'p5.js Creative Coding',
  kind: 'browser',
  output: 'canvas',
  description: 'Generative Canvas2D creative coding adapter with curl-noise flow fields, chaotic attractors, sinusoidal engraving waves, and Dual Particle constellation.',
  params: [
    { name: 'flowLines', type: 'number', min: 10, max: 160, step: 5, default: 65, label: 'Flow Field Ribbons' },
    { name: 'engravingDensity', type: 'number', min: 8, max: 64, step: 2, default: 28, label: 'Engraving Waves' },
    { name: 'showTelemetry', type: 'boolean', default: true, label: 'Measure Telemetry' }
  ]
};

export async function createRenderer({
  canvas,
  container,
  width = 1280,
  height = 720,
  project,
  scene: userScene,
  assets
} = {}) {
  const targetCanvas = canvas || (() => {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    if (container) container.appendChild(c);
    return c;
  })();

  let W = width;
  let H = height;
  const g = targetCanvas.getContext('2d');

  const params = {
    flowLines: 65,
    engravingDensity: 28,
    showTelemetry: true
  };

  // Provide a p5-compatible immediate drawing API for user scenes (`scene.setup(p)` / `scene.frame(ctx, p)`)
  const p5Compat = {
    canvas: targetCanvas,
    drawingContext: g,
    get width() { return W; },
    get height() { return H; },
    TWO_PI: Math.PI * 2,
    PI: Math.PI,
    HALF_PI: Math.PI * 0.5,
    background(r, gr = r, b = r, a = 255) {
      g.fillStyle = typeof r === 'string' ? r : `rgba(${r},${gr},${b},${a / 255})`;
      g.fillRect(0, 0, W, H);
    },
    fill(r, gr = r, b = r, a = 255) {
      g.fillStyle = typeof r === 'string' ? r : `rgba(${r},${gr},${b},${a / 255})`;
    },
    noFill() {
      g.fillStyle = 'rgba(0,0,0,0)';
    },
    stroke(r, gr = r, b = r, a = 255) {
      g.strokeStyle = typeof r === 'string' ? r : `rgba(${r},${gr},${b},${a / 255})`;
    },
    strokeWeight(w) {
      g.lineWidth = w;
    },
    line(x1, y1, x2, y2) {
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
    },
    circle(x, y, d) {
      g.beginPath();
      g.arc(x, y, d * 0.5, 0, Math.PI * 2);
      g.fill();
    },
    rect(x, y, w, h) {
      g.fillRect(x, y, w, h);
    },
    push() { g.save(); },
    pop() { g.restore(); },
    translate(x, y) { g.translate(x, y); },
    rotate(a) { g.rotate(a); },
    scale(sx, sy = sx) { g.scale(sx, sy); },
    noise: (x, y = 0) => hashf(x * 13.7 + y * 57.1)
  };

  if (userScene && typeof userScene.setup === 'function') {
    await userScene.setup(p5Compat);
  }

  function renderFrame(ctx) {
    const t = ctx.time || 0;
    const ch = ctx.chapter || 0;
    const af = ctx.audio || { rms: 0, bass: 0, mid: 0, high: 0, transient: 0, glitch: 0 };
    const [vpU, vpV] = ctx.vp || [0.5, 0.46];

    // 1. Deep nocturnal background
    g.fillStyle = '#050811';
    g.fillRect(0, 0, W, H);

    // 2. Sinusoidal Steel-Plate Luminance Engraving Matrix
    const waveRows = Math.max(8, Math.round(params.engravingDensity || 28));
    const sampleUV = (u, v) =>
      (ctx.assets || assets)?.sampleClipUV?.(ctx.clip?.a, u, v, t, ch) ||
      { r: 0.2, g: 0.85, b: 0.9, luma: 0.5 };

    g.lineWidth = 1.15;
    for (let row = 0; row < waveRows; row++) {
      const v = (row + 0.5) / waveRows;
      const yBase = v * H;
      const hueShift = (row / waveRows) * 0.5;
      const rCol = Math.round(lerp(36, 250, hueShift) * (0.65 + af.bass * 0.35));
      const gCol = Math.round(lerp(235, 195, hueShift));
      const bCol = Math.round(lerp(228, 95, hueShift));
      g.strokeStyle = `rgba(${rCol},${gCol},${bCol},0.28)`;
      g.beginPath();
      const steps = 64;
      for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        const samp = sampleUV(u, v);
        const luma = samp.luma ?? 0.5;
        const disp = Math.sin(u * 22.0 + t * 3.2 + luma * 9.0) * (luma * 14.0 * (1 + af.bass * 0.8));
        const px = u * W;
        const py = yBase + disp;
        if (s === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    }

    // 3. Generative Curl-Noise Flow Field Ribbons
    const flowCount = Math.max(10, Math.round(params.flowLines || 65));
    for (let i = 0; i < flowCount; i++) {
      const seed = i * 1.6180339;
      let u = (hashf(seed) + t * 0.04) % 1.0;
      let v = hashf(seed + 11.3);
      const col =
        i % 3 === 0
          ? `rgba(38, 245, 232, ${0.26 + af.high * 0.3})`
          : i % 3 === 1
          ? `rgba(255, 206, 72, ${0.24 + af.bass * 0.3})`
          : `rgba(244, 98, 210, ${0.24 + af.mid * 0.3})`;
      g.strokeStyle = col;
      g.lineWidth = 1.2 + (i % 4 === 0 ? af.transient * 1.4 : 0);
      g.beginPath();
      g.moveTo(u * W, v * H);
      for (let step = 0; step < 6; step++) {
        const vel = curlVelocity2D(u, v, t * 0.9 + step * 0.08);
        u += vel.vx * (1.2 + af.bass * 1.8);
        v += vel.vy * (1.2 + af.bass * 1.8);
        g.lineTo(u * W, v * H);
      }
      g.stroke();
    }

    // 4. Clifford Strange Attractor Harmonic Orbit around Vanishing Point
    const cx = vpU * W;
    const cy = vpV * H;
    const a = -1.4 + Math.sin(t * 0.25) * 0.25;
    const b = 1.6 + Math.cos(t * 0.2) * 0.2;
    const c = 1.0 + af.bass * 0.35;
    const d = 0.7 + af.mid * 0.25;
    let ax = 0.1, ay = 0.1;
    const scale = Math.min(W, H) * (0.16 + af.rms * 0.06);
    g.fillStyle = 'rgba(255, 240, 160, 0.48)';
    for (let k = 0; k < 180; k++) {
      const nx = Math.sin(a * ay) + c * Math.cos(a * ax);
      const ny = Math.sin(b * ax) + d * Math.cos(b * ay);
      ax = nx;
      ay = ny;
      g.fillRect(cx + ax * scale, cy + ay * scale, 2.2, 2.2);
    }

    // 5. 420-Particle Dual Particle Constellation + Plexus
    const dual = computeDualParticles(ctx);
    drawDualParticles2D(g, dual, ctx);

    // 6. Procedural Measure & Chapter Telemetry HUD
    if (params.showTelemetry) {
      g.save();
      g.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';
      g.fillStyle = 'rgba(38, 245, 232, 0.82)';
      const barStr = `BAR ${Math.floor(ctx.bar || 1)}.${(ctx.beatInBar ?? 0) + 1}  |  CH ${ch + 1}: ${(ctx.chapterName || 'MAIN').toUpperCase()}  |  RIG: ${(ctx.rig || 'relief').toUpperCase()}`;
      g.fillText(barStr, 24, H - 22);
      g.restore();
    }

    if (userScene && typeof userScene.frame === 'function') {
      userScene.frame(ctx, p5Compat);
    }
  }

  function resize(w, h) {
    W = w;
    H = h;
    targetCanvas.width = w;
    targetCanvas.height = h;
  }

  return {
    renderFrame,
    resize,
    setParam: (k, v) => { if (k in params) params[k] = v; },
    getParams: () => ({ ...params }),
    dispose: () => {}
  };
}
