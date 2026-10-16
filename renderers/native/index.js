// renderers/native/index.js
// Metadata and in-browser live preview emulator for the Native C / CoreGraphics / Metal renderer.
// Batch video and contact-sheet rendering run via the compiled `native-render` binary;
// in-browser Studio preview uses this deterministic Canvas2D mirror of the native pipeline.

import { clamp, lerp } from '../../kit/measure-clock.js';
import {
  computeDualParticles,
  drawDualParticles2D,
  curlVelocity2D,
  hashf
} from '../shared/dual-particles.js';

export const meta = {
  id: 'native',
  name: 'Native C / CoreGraphics (100+ FPS)',
  kind: 'native',
  output: 'binary',
  description: 'Multi-threaded Apple CoreGraphics & GCD native renderer (`renderers/native/native-render-core.m`) with in-browser live preview mirror.',
  params: [
    { name: 'reliefDepth', type: 'number', min: 0, max: 6, step: 0.1, default: 2.8, label: 'Relief Depth' },
    { name: 'scanlines', type: 'number', min: 0, max: 1, step: 0.05, default: 1.0, label: 'CRT Scanlines' },
    { name: 'chroma', type: 'number', min: 0, max: 1, step: 0.05, default: 0.2, label: 'Chromatic Split' }
  ]
};

export async function createRenderer({
  canvas,
  container,
  width = 1280,
  height = 720,
  project,
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
  const params = { reliefDepth: 2.8, scanlines: 1.0, chroma: 0.2 };

  function renderFrame(ctx) {
    const t = ctx.time || 0;
    const ch = ctx.chapter || 0;
    const af = ctx.audio || { rms: 0, bass: 0, mid: 0, high: 0, transient: 0, glitch: 0 };
    const [vpU, vpV] = ctx.vp || [0.5, 0.46];

    g.fillStyle = '#050811';
    g.fillRect(0, 0, W, H);

    const clipFrame = (ctx.assets || assets)?.getClipFrame?.(ctx.clip?.a, ctx.clip?.a?.localTime ?? t);
    if (clipFrame) {
      try {
        g.save();
        g.globalAlpha = 0.55;
        const pw = W * 0.78;
        const ph = H * 0.78;
        g.drawImage(clipFrame, vpU * W - pw * 0.5, vpV * H - ph * 0.5, pw, ph);
        g.restore();
      } catch {}
    }

    for (let i = 0; i < 24; i++) {
      const seed = i * 1.371;
      const life = (hashf(seed) + t * (0.22 + 0.18 * hashf(seed + 5.0))) % 1.0;
      const u = lerp(vpU, 0.68, life) + (hashf(seed + 1.0) - 0.5) * 0.55;
      const v = lerp(vpV, 0.50, life) + (hashf(seed + 2.0) - 0.5) * 0.55;
      const c1 = curlVelocity2D(u, v, t + (i % 5) * 0.1);
      const u1 = u + c1.vx * (1.2 + af.bass * 2.5);
      const v1 = v + c1.vy * (1.2 + af.bass * 2.5);
      const c2 = curlVelocity2D(u1, v1, t + 0.15);
      const u2 = u1 + c2.vx * (1.5 + af.high * 2.2);
      const v2 = v1 + c2.vy * (1.5 + af.high * 2.2);
      const fade = Math.sin(life * Math.PI) * 0.35;
      g.strokeStyle = i % 3 === 0 ? `rgba(38,242,235,${fade})` : i % 3 === 1 ? `rgba(255,209,71,${fade})` : `rgba(242,97,217,${fade})`;
      g.lineWidth = 1.0;
      g.beginPath();
      g.moveTo(u * W, v * H);
      g.quadraticCurveTo(u1 * W, v1 * H, u2 * W, v2 * H);
      g.stroke();
    }

    const dual = computeDualParticles(ctx);
    drawDualParticles2D(g, dual, ctx);

    if (params.scanlines > 0.01 && ctx.shaders?.crtScanlines !== false) {
      g.fillStyle = `rgba(0,0,0,${(0.12 * params.scanlines).toFixed(3)})`;
      for (let y = 1; y < H; y += 2) g.fillRect(0, y, W, 1);
    }
  }

  return {
    renderFrame,
    resize: (w, h) => { W = w; H = h; targetCanvas.width = w; targetCanvas.height = h; },
    setParam: (k, v) => { if (k in params) params[k] = v; },
    getParams: () => ({ ...params }),
    dispose: () => {}
  };
}
