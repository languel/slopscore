// renderers/fframes/index.js
// fframes Precision Steel-Plate SVG / Vector Motion Graphics Adapter for Slopscore 2.0.
// Generates razor-sharp steel-plate sinusoidal luminance engraving lines, precision
// isometric dial gauge reticles, and the 420-particle Dual Particle Constellation + Plexus mesh.

import { clamp, lerp } from '../../kit/measure-clock.js';
import { computeDualParticles, drawDualParticles2D } from '../shared/dual-particles.js';

export const meta = {
  id: 'fframes',
  name: 'fframes (Vector / SVG)',
  kind: 'browser',
  output: 'canvas',
  description: 'Precision steel-plate vector motion graphics, concentric dial-gauge reticles, and SVG/Skia Dual Particle constellation.',
  params: [
    { name: 'plateLines', type: 'number', min: 16, max: 96, step: 4, default: 44, label: 'Steel-Plate Lines' },
    { name: 'reticleDetail', type: 'number', min: 1, max: 5, step: 1, default: 3, label: 'Reticle Rings' },
    { name: 'strokeWidth', type: 'number', min: 0.4, max: 2.5, step: 0.1, default: 1.1, label: 'Vector Stroke Width' }
  ]
};

/**
 * Generate a standalone SVG document string for a given `RenderFrameContext`.
 */
export function buildFrameSVG(ctx, params = {}) {
  const [W, H] = ctx.resolution || [1280, 720];
  const t = ctx.time || 0;
  const ch = ctx.chapter || 0;
  const af = ctx.audio || { rms: 0, bass: 0, mid: 0, high: 0, transient: 0 };
  const [vpU, vpV] = ctx.vp || [0.5, 0.46];
  const dual = computeDualParticles(ctx);

  const cx = (vpU * W).toFixed(1);
  const cy = (vpV * H).toFixed(1);
  const rBase = Math.min(W, H) * (0.18 + (af.bass || 0) * 0.06);

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`,
    `<rect width="${W}" height="${H}" fill="#050811"/>`,
    `<g stroke="#26f2eb" stroke-opacity="0.32" fill="none" stroke-width="${params.strokeWidth || 1.1}">`,
    `<circle cx="${cx}" cy="${cy}" r="${rBase.toFixed(1)}" stroke-dasharray="6 4"/>`,
    `<circle cx="${cx}" cy="${cy}" r="${(rBase * 1.45).toFixed(1)}" stroke="#ffd147" stroke-opacity="0.28"/>`,
    `</g>`
  ];

  // Plexus lines
  parts.push(`<g stroke-width="${params.strokeWidth || 1.0}" fill="none">`);
  for (const ln of dual.lines) {
    const r = Math.round(clamp(ln.r, 0, 1) * 255);
    const g = Math.round(clamp(ln.g, 0, 1) * 255);
    const b = Math.round(clamp(ln.b, 0, 1) * 255);
    parts.push(
      `<line x1="${ln.sx0.toFixed(1)}" y1="${ln.sy0.toFixed(1)}" x2="${ln.sx1.toFixed(1)}" y2="${ln.sy1.toFixed(1)}" stroke="rgb(${r},${g},${b})" stroke-opacity="${ln.alpha.toFixed(3)}"/>`
    );
  }
  parts.push(`</g>`);

  // Particles
  parts.push(`<g>`);
  for (const p of dual.particles) {
    if (!p.visible) continue;
    const r = Math.round(clamp(p.r, 0, 1) * 255);
    const g = Math.round(clamp(p.g, 0, 1) * 255);
    const b = Math.round(clamp(p.b, 0, 1) * 255);
    const sz = p.size.toFixed(1);
    parts.push(
      `<rect x="${(p.sx - p.size * 0.5).toFixed(1)}" y="${(p.sy - p.size * 0.5).toFixed(1)}" width="${sz}" height="${sz}" fill="rgb(${r},${g},${b})" fill-opacity="${p.alpha.toFixed(3)}"/>`
    );
  }
  parts.push(`</g>`);
  parts.push(`</svg>`);
  return parts.join('\n');
}

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
    plateLines: 44,
    reticleDetail: 3,
    strokeWidth: 1.1
  };

  const userApi = { canvas: targetCanvas, g, buildFrameSVG, assets, project };
  if (userScene && typeof userScene.setup === 'function') {
    await userScene.setup(userApi);
  }

  function renderFrame(ctx) {
    const t = ctx.time || 0;
    const ch = ctx.chapter || 0;
    const af = ctx.audio || { rms: 0, bass: 0, mid: 0, high: 0, transient: 0, glitch: 0 };
    const [vpU, vpV] = ctx.vp || [0.5, 0.46];
    const sw = params.strokeWidth || 1.1;

    // 1. Deep nocturnal background
    g.fillStyle = '#050811';
    g.fillRect(0, 0, W, H);

    // 2. Sinusoidal Steel-Plate Engraving Lines modulated by Archival Luma
    const rows = Math.max(16, Math.round(params.plateLines || 44));
    const sampleUV = (u, v) =>
      (ctx.assets || assets)?.sampleClipUV?.(ctx.clip?.a, u, v, t, ch) ||
      { r: 0.25, g: 0.85, b: 0.9, luma: 0.5 };

    g.lineWidth = sw * 0.85;
    for (let r = 0; r < rows; r++) {
      const v = (r + 0.5) / rows;
      const y0 = v * H;
      const alpha = 0.16 + 0.18 * Math.sin(v * Math.PI);
      g.strokeStyle = r % 2 === 0
        ? `rgba(245, 196, 82, ${alpha.toFixed(3)})`
        : `rgba(38, 242, 235, ${(alpha * 0.85).toFixed(3)})`;
      g.beginPath();
      const cols = 80;
      for (let c = 0; c <= cols; c++) {
        const u = c / cols;
        const samp = sampleUV(u, v);
        const luma = samp.luma ?? 0.5;
        const wave = Math.sin(v * 180.0 + luma * 14.0 + t * 3.2) * (luma * 9.5 * (1 + af.bass * 0.6));
        const px = u * W;
        const py = y0 + wave;
        if (c === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    }

    // 3. Precision Isometric Dial-Gauge Reticles around Vanishing Point
    const cx = vpU * W;
    const cy = vpV * H;
    const rings = Math.max(1, Math.round(params.reticleDetail || 3));
    const baseR = Math.min(W, H) * 0.14;

    g.save();
    g.translate(cx, cy);
    for (let k = 1; k <= rings; k++) {
      const rad = baseR * (0.75 + k * 0.42) * (1 + af.bass * 0.08);
      const rot = t * (k % 2 === 0 ? -0.35 : 0.45) + k * 0.8;
      g.save();
      g.rotate(rot);
      g.strokeStyle = k % 2 === 0 ? 'rgba(255, 209, 71, 0.42)' : 'rgba(38, 242, 235, 0.45)';
      g.lineWidth = sw;
      g.beginPath();
      g.arc(0, 0, rad, 0, Math.PI * 1.65);
      g.stroke();

      // Precision degree ticks
      const ticks = 24 + k * 8;
      for (let ti = 0; ti < ticks; ti++) {
        const a = (ti / ticks) * Math.PI * 2;
        const len = ti % 4 === 0 ? 7 : 3.5;
        const x0 = Math.cos(a) * (rad - len);
        const y0 = Math.sin(a) * (rad - len);
        const x1 = Math.cos(a) * (rad + len * 0.4);
        const y1 = Math.sin(a) * (rad + len * 0.4);
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
      }
      g.restore();
    }
    g.restore();

    // 4. Dual Particle Constellation + Vector Plexus Mesh
    const dual = computeDualParticles(ctx);
    drawDualParticles2D(g, dual, ctx);

    // 5. Technical Calibration Frame Border & Readout
    g.strokeStyle = 'rgba(38, 242, 235, 0.35)';
    g.lineWidth = 1;
    g.strokeRect(16.5, 16.5, W - 33, H - 33);
    g.fillStyle = 'rgba(245, 196, 82, 0.85)';
    g.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.fillText(
      `FFRAMES // STEEL-PLATE VECTOR ENGINE  |  BAR ${Math.floor(ctx.bar || 1)}.${(ctx.beatInBar ?? 0) + 1}  |  FOV ${(ctx.camera?.fov || 56).toFixed(1)}°`,
      28,
      H - 26
    );

    if (userScene && typeof userScene.frame === 'function') {
      userScene.frame(ctx, userApi);
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
    buildFrameSVG: (ctx) => buildFrameSVG(ctx, params),
    resize,
    setParam: (k, v) => { if (k in params) params[k] = v; },
    getParams: () => ({ ...params }),
    dispose: () => {}
  };
}
