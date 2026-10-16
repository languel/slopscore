// renderers/pixijs/index.js
// Pixi.js 2D WebGL Sprite & Graphics Compositor Adapter for Slopscore 2.0.
// Features the evolving 4-stage 16-bit Pixel Protagonist, walking gantry catwalk,
// interactive machine console workstation (blinking CRT, tilting lever, 3-band LED meter),
// Dual Particle Constellation + Plexus lines, and CRT scanlines.

import * as PIXI from 'pixi.js';
import { clamp, lerp } from '../../kit/measure-clock.js';
import {
  computeDualParticles,
  drawDualParticles2D,
  curlVelocity2D,
  hashf
} from '../shared/dual-particles.js';

export const meta = {
  id: 'pixijs',
  name: 'Pixi.js 2D',
  kind: 'browser',
  output: 'canvas',
  description: '2D WebGL sprite & graphics compositor with evolving pixel protagonist, interactive machine console workstation, Dual Particle constellation, and CRT scanlines.',
  params: [
    { name: 'protagonistScale', type: 'number', min: 0.4, max: 2.5, step: 0.05, default: 1.0, label: 'Protagonist Scale' },
    { name: 'trailLength', type: 'number', min: 0, max: 12, step: 1, default: 8, label: 'Motion Trail' },
    { name: 'scanlineAlpha', type: 'number', min: 0, max: 0.5, step: 0.02, default: 0.16, label: 'CRT Scanlines' }
  ]
};

const SPRITE_STAGES = [
  [
    [0,0,1,2,1,0,0],
    [0,1,2,2,2,1,0],
    [1,2,1,2,1,2,1],
    [1,1,2,2,2,1,1],
    [0,1,1,1,1,1,0],
    [0,1,0,0,0,1,0],
    [1,0,0,0,0,0,1]
  ],
  [
    [0,0,0,1,2,1,0,0,0],
    [0,1,1,2,2,2,1,1,0],
    [1,2,2,1,2,1,2,2,1],
    [1,1,1,2,2,2,1,1,1],
    [0,1,0,1,2,1,0,1,0],
    [0,0,1,0,1,0,1,0,0],
    [0,1,0,0,0,0,0,1,0]
  ],
  [
    [0,0,2,2,2,2,2,0,0],
    [0,1,1,2,2,2,1,1,0],
    [0,1,2,2,1,2,2,1,0],
    [0,1,2,1,2,1,2,1,0],
    [0,1,1,2,2,2,1,1,0],
    [0,0,1,1,2,1,1,0,0],
    [0,0,0,1,2,1,0,0,0]
  ],
  [
    [0,0,1,2,2,2,1,0,0],
    [0,1,2,1,2,1,2,1,0],
    [1,2,2,2,2,2,2,2,1],
    [1,1,2,2,1,2,2,1,1],
    [0,1,2,1,1,1,2,1,0],
    [0,1,0,1,0,1,0,1,0],
    [1,0,0,0,0,0,0,0,1]
  ]
];

function computeProtagonistUV(t, ch, vpU = 0.5, vpV = 0.46) {
  if (ch === 0) {
    const hop = (t * 0.65) % 1.0;
    const arc = -4.0 * hop * (1.0 - hop) * 0.14;
    return [lerp(vpU, 0.74, hop), lerp(vpV, 0.54, hop) + arc];
  }
  if (ch === 1) return [0.50 + 0.28 * Math.sin(t * 1.1), 0.56 + 0.14 * Math.cos(t * 2.2) - Math.abs(Math.sin(t * 4.5)) * 0.07];
  if (ch === 2) return [0.54 + 0.22 * Math.cos(t * 1.4), 0.50 + 0.16 * Math.sin(t * 2.1)];
  if (ch === 3 || ch === 4) return [0.48 + 0.26 * Math.sin(t * 0.95), 0.48 + 0.18 * Math.sin(t * 1.9 + 0.8)];
  if (ch === 5) return [0.66 + 0.03 * Math.sin(t * 6.0), 0.48 + 0.03 * Math.cos(t * 5.0)];
  if (ch === 6) return [0.64 + 0.16 * Math.sin(t * 1.5), 0.46 + 0.16 * Math.sin(t * 3.0)];
  return [0.50 + 0.20 * Math.sin(t * 0.85), 0.44 + 0.10 * Math.cos(t * 1.4)];
}

function rgbToHex(r, g, b) {
  const ir = Math.min(255, Math.max(0, Math.round(r * 255)));
  const ig = Math.min(255, Math.max(0, Math.round(g * 255)));
  const ib = Math.min(255, Math.max(0, Math.round(b * 255)));
  return (ir << 16) | (ig << 8) | ib;
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

  const params = {
    protagonistScale: 1.0,
    trailLength: 8,
    scanlineAlpha: 0.16
  };

  let app = null;
  let gfxBg = null;
  let gfxParticles = null;
  let gfxProtagonist = null;
  let gfxScanlines = null;
  let fallbackCtx2D = null;

  try {
    app = new PIXI.Application();
    await app.init({
      canvas: targetCanvas,
      width: W,
      height: H,
      backgroundColor: 0x050811,
      antialias: true,
      preserveDrawingBuffer: true,
      autoStart: false,
      resolution: 1
    });
    if (app.ticker) app.ticker.stop();

    gfxBg = new PIXI.Graphics();
    gfxParticles = new PIXI.Graphics();
    gfxProtagonist = new PIXI.Graphics();
    gfxScanlines = new PIXI.Graphics();
    app.stage.addChild(gfxBg, gfxParticles, gfxProtagonist, gfxScanlines);
  } catch (err) {
    console.warn('[Slopscore Pixi.js] Falling back to 2D canvas context:', err.message);
    app = null;
    fallbackCtx2D = targetCanvas.getContext('2d');
  }

  const userApi = { PIXI, app, canvas: targetCanvas, assets, project };
  if (userScene && typeof userScene.setup === 'function') {
    await userScene.setup(userApi);
  }

  function renderPixiFrame(ctx) {
    const t = ctx.time || 0;
    const ch = ctx.chapter || 0;
    const af = ctx.audio || { rms: 0, bass: 0, mid: 0, high: 0, transient: 0, glitch: 0 };
    const [vpU, vpV] = ctx.vp || [0.5, 0.46];
    const charScale = (ctx.camera?.charScale ?? 1.0) * (params.protagonistScale || 1.0);

    gfxBg.clear();
    gfxParticles.clear();
    gfxProtagonist.clear();
    gfxScanlines.clear();

    // 1. Cybernetic grid & curl ribbons
    gfxBg.rect(0, 0, W, H).fill({ color: 0x050811, alpha: 1 });
    const [pu, pv] = computeProtagonistUV(t, ch, vpU, vpV);

    for (let i = 0; i < 24; i++) {
      const seed = i * 1.371;
      const life = (hashf(seed) + t * (0.22 + 0.18 * hashf(seed + 5.0))) % 1.0;
      const u = lerp(vpU, pu, life) + (hashf(seed + 1.0) - 0.5) * 0.55;
      const v = lerp(vpV, pv, life) + (hashf(seed + 2.0) - 0.5) * 0.55;
      const c1 = curlVelocity2D(u, v, t + (i % 5) * 0.1);
      const u1 = u + c1.vx * (1.2 + af.bass * 2.5);
      const v1 = v + c1.vy * (1.2 + af.bass * 2.5);
      const c2 = curlVelocity2D(u1, v1, t + 0.15);
      const u2 = u1 + c2.vx * (1.5 + af.high * 2.2);
      const v2 = v1 + c2.vy * (1.5 + af.high * 2.2);
      const col = i % 3 === 0 ? 0x26f2eb : i % 3 === 1 ? 0xffd147 : 0xf261d9;
      const fade = Math.sin(life * Math.PI) * 0.32;
      gfxBg
        .moveTo(u * W, v * H)
        .quadraticCurveTo(u1 * W, v1 * H, u2 * W, v2 * H)
        .stroke({ width: 1.1, color: col, alpha: fade });
    }

    // 2. Dual Particle Constellation + Plexus
    const dual = computeDualParticles(ctx);
    for (let i = 0; i < dual.lines.length; i++) {
      const ln = dual.lines[i];
      const hex = rgbToHex(ln.r, ln.g, ln.b);
      gfxParticles
        .moveTo(ln.sx0, ln.sy0)
        .lineTo(ln.sx1, ln.sy1)
        .stroke({ width: 1.1, color: hex, alpha: clamp(ln.alpha, 0.05, 0.9) });
    }

    for (let i = 0; i < dual.particles.length; i++) {
      const p = dual.particles[i];
      if (!p.visible) continue;
      const fog = clamp(14.0 / (p.depth + 2.0), 0.35, 1.15);
      const hex = rgbToHex(p.r * fog, p.g * fog, p.b * fog);
      const coreHex = rgbToHex(p.r * fog + 0.35, p.g * fog + 0.35, p.b * fog + 0.35);
      const pa = clamp(p.alpha * clamp(fog, 0.3, 1.0), 0.1, 0.98);
      const sz = p.size;
      gfxParticles.rect(p.sx - sz * 0.5, p.sy - sz * 0.5, sz, sz).fill({ color: hex, alpha: pa });
      const csz = sz * 0.45;
      gfxParticles.rect(p.sx - csz * 0.5, p.sy - csz * 0.5, csz, csz).fill({ color: coreHex, alpha: pa });
    }

    // 3. Pixel Protagonist, Catwalk & Machine Console Workstation
    const px = pu * W;
    const py = pv * H;
    const platW = 90 * charScale;
    const platH = 7 * charScale;
    const platY = py + 22 * charScale;

    // Platform beam + glowing rail + struts
    gfxProtagonist.rect(px - platW * 0.5, platY, platW, platH).fill({ color: 0x142433, alpha: 0.85 });
    gfxProtagonist.rect(px - platW * 0.5, platY, platW, 1.8).stroke({ width: 1.4, color: 0x38f2e6, alpha: 0.88 });
    gfxProtagonist.rect(px - platW * 0.4, platY + platH, 4, 25 * charScale).fill({ color: 0x264059, alpha: 0.65 });
    gfxProtagonist.rect(px + platW * 0.4 - 4, platY + platH, 4, 25 * charScale).fill({ color: 0x264059, alpha: 0.65 });

    // Console workstation & lever
    const conX = px + 26 * charScale;
    const conY = py - 8 * charScale;
    gfxProtagonist.rect(conX, conY, 18 * charScale, 28 * charScale).fill({ color: 0x1f2e42, alpha: 0.92 });
    gfxProtagonist.rect(conX + 2, conY + 3, 14 * charScale, 10 * charScale).fill({ color: 0x2ef2bf, alpha: 0.88 });

    const leverAngle = Math.sin(t * 4.0 + af.transient * 3.0) * 0.45;
    const lx0 = conX + 9 * charScale;
    const ly0 = conY + 16 * charScale;
    const lx1 = lx0 + Math.sin(leverAngle) * 12 * charScale;
    const ly1 = ly0 - Math.cos(leverAngle) * 12 * charScale;
    gfxProtagonist.moveTo(lx0, ly0).lineTo(lx1, ly1).stroke({ width: 2.0, color: 0xffd940, alpha: 0.95 });

    // 3-band LED meter
    const ledSpacing = 4 * charScale;
    const ledY = conY + 22 * charScale;
    gfxProtagonist.rect(conX + 3 * charScale, ledY, 3 * charScale, 3 * charScale).fill({ color: 0xff4d33, alpha: 0.65 + af.bass * 0.35 });
    gfxProtagonist.rect(conX + 3 * charScale + ledSpacing, ledY, 3 * charScale, 3 * charScale).fill({ color: 0x40f240, alpha: 0.65 + af.mid * 0.35 });
    gfxProtagonist.rect(conX + 3 * charScale + ledSpacing * 2, ledY, 3 * charScale, 3 * charScale).fill({ color: 0x33d9ff, alpha: 0.65 + af.high * 0.35 });

    // Motion trail
    const trailSteps = Math.max(0, Math.round(params.trailLength ?? 8));
    for (let h = trailSteps; h >= 1; h--) {
      const ht = t - h * 0.045;
      const hu = pu - Math.cos(ht * 2.0) * h * 0.008;
      const hv = pv - Math.sin(ht * 2.5) * h * 0.008;
      const sz = (10 - h) * 1.8 * charScale;
      const alpha = (1 - h / (trailSteps + 1)) * 0.42;
      gfxProtagonist.rect(hu * W - sz * 0.5, hv * H - sz * 0.5, sz, sz).fill({ color: 0x26f2e0, alpha });
    }

    // Pixel sprite matrix
    const stageIdx = ch <= 1 ? 0 : ch <= 4 ? 1 : ch === 5 ? 2 : 3;
    const grid = SPRITE_STAGES[stageIdx];
    const rows = grid.length;
    const cols = grid[0].length;
    const pixSize = ((stageIdx === 3 ? 5.2 + af.bass * 1.8 : 4.8 + af.bass * 1.4)) * charScale;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const val = grid[r][c];
        if (!val) continue;
        const rx = px + (c - cols * 0.5) * (pixSize + 1.0);
        const ry = py + (r - rows * 0.5) * (pixSize + 1.0);
        const color = val === 1 ? 0x26fae6 : val === 2 ? 0xfff073 : 0xff73c7;
        gfxProtagonist.rect(rx, ry, pixSize, pixSize).fill({ color, alpha: 0.96 });
      }
    }

    // 4. CRT scanlines
    const scanAlpha = ctx.shaders?.crtScanlines === false ? 0 : (params.scanlineAlpha ?? 0.16);
    if (scanAlpha > 0.01) {
      for (let y = 1; y < H; y += 3) {
        gfxScanlines.rect(0, y, W, 1).fill({ color: 0x000000, alpha: scanAlpha });
      }
    }

    app.renderer.render(app.stage);
  }

  function renderFallback2D(ctx) {
    const g = fallbackCtx2D;
    const t = ctx.time || 0;
    const ch = ctx.chapter || 0;
    const af = ctx.audio || { bass: 0, mid: 0, high: 0, transient: 0 };
    const [vpU, vpV] = ctx.vp || [0.5, 0.46];
    const charScale = (ctx.camera?.charScale ?? 1.0) * (params.protagonistScale || 1.0);

    g.fillStyle = '#050811';
    g.fillRect(0, 0, W, H);

    const dual = computeDualParticles(ctx);
    drawDualParticles2D(g, dual, ctx);

    const [pu, pv] = computeProtagonistUV(t, ch, vpU, vpV);
    const px = pu * W, py = pv * H;
    const stageIdx = ch <= 1 ? 0 : ch <= 4 ? 1 : ch === 5 ? 2 : 3;
    const grid = SPRITE_STAGES[stageIdx];
    const rows = grid.length, cols = grid[0].length;
    const pixSize = 5.0 * charScale;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const val = grid[r][c];
        if (!val) continue;
        g.fillStyle = val === 1 ? '#26fae6' : val === 2 ? '#fff073' : '#ff73c7';
        g.fillRect(px + (c - cols * 0.5) * (pixSize + 1), py + (r - rows * 0.5) * (pixSize + 1), pixSize, pixSize);
      }
    }
  }

  function renderFrame(ctx) {
    if (app) renderPixiFrame(ctx);
    else if (fallbackCtx2D) renderFallback2D(ctx);
    if (userScene && typeof userScene.frame === 'function') {
      userScene.frame(ctx, userApi);
    }
  }

  function resize(w, h) {
    W = w;
    H = h;
    targetCanvas.width = w;
    targetCanvas.height = h;
    if (app?.renderer) app.renderer.resize(w, h);
  }

  return {
    renderFrame,
    resize,
    setParam: (k, v) => { if (k in params) params[k] = v; },
    getParams: () => ({ ...params }),
    dispose: () => {
      if (app) app.destroy(false, { children: true });
    }
  };
}
