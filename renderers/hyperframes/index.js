// renderers/hyperframes/index.js
// HyperFrames HTML5 + CSS3 + GSAP Deterministic Kinetic Typography & HUD Adapter for Slopscore 2.0.
// Synchronizes `gsap.globalTimeline.seek(ctx.time)` for frame-accurate DOM animations while
// mirroring the kinetic HUD cards and Dual Particle Constellation onto the output canvas for capture.

import { gsap } from 'gsap';
import { clamp, formatClock } from '../../kit/measure-clock.js';
import { computeDualParticles, drawDualParticles2D } from '../shared/dual-particles.js';

export const meta = {
  id: 'hyperframes',
  name: 'HyperFrames (GSAP DOM)',
  kind: 'browser',
  output: 'dom',
  description: 'HTML5, CSS3 & GSAP deterministic kinetic typography, cybernetic telemetry HUD cards, and Dual Particle constellation.',
  params: [
    { name: 'hudScale', type: 'number', min: 0.6, max: 1.6, step: 0.05, default: 1.0, label: 'HUD Card Scale' },
    { name: 'showKineticTitle', type: 'boolean', default: true, label: 'Kinetic Chapter Titles' },
    { name: 'cardOpacity', type: 'number', min: 0.1, max: 1.0, step: 0.05, default: 0.88, label: 'Card Opacity' }
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
  const hostEl = container || (canvas ? canvas.parentElement : document.body);
  const targetCanvas = canvas || (() => {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    if (hostEl) hostEl.appendChild(c);
    return c;
  })();

  let W = width;
  let H = height;
  const g = targetCanvas.getContext('2d');

  const params = {
    hudScale: 1.0,
    showKineticTitle: true,
    cardOpacity: 0.88
  };

  // Create deterministic DOM HUD overlay layer inside container
  let domOverlay = null;
  let titleEl = null;
  let badgeEl = null;
  let metricEl = null;

  if (typeof document !== 'undefined' && hostEl) {
    if (getComputedStyle(hostEl).position === 'static') {
      hostEl.style.position = 'relative';
    }
    domOverlay = document.createElement('div');
    domOverlay.className = 'slopscore-hyperframes-layer';
    domOverlay.style.cssText = `
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: hidden;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: #e2f8f5;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 24px 32px;
      box-sizing: border-box;
    `;
    domOverlay.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div class="hf-badge" style="background:rgba(8,16,28,0.82);border:1px solid rgba(38,242,235,0.45);padding:8px 14px;border-radius:4px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;">
          SLOPSCORE // HYPERFRAMES
        </div>
        <div class="hf-metric" style="background:rgba(8,16,28,0.82);border:1px solid rgba(255,209,71,0.4);padding:8px 14px;border-radius:4px;font-size:11px;letter-spacing:0.08em;">
          BAR 1.1.1
        </div>
      </div>
      <div class="hf-title-wrap" style="text-align:left;max-width:70%;">
        <div class="hf-title" style="font-size:36px;font-weight:700;letter-spacing:-0.02em;color:#ffffff;text-shadow:0 2px 18px rgba(38,242,235,0.45);"></div>
      </div>
    `;
    hostEl.appendChild(domOverlay);
    titleEl = domOverlay.querySelector('.hf-title');
    badgeEl = domOverlay.querySelector('.hf-badge');
    metricEl = domOverlay.querySelector('.hf-metric');
  }

  // Build deterministic GSAP timeline keyed to project chapters
  gsap.globalTimeline.pause();
  const animState = { titleProgress: 0, cardSlide: 0, pulseGlow: 0 };
  const tl = gsap.timeline({ paused: true });
  const chapters = project?.chapters || [];
  for (const ch of chapters) {
    const start = ch.start || 0;
    const dur = Math.max(0.5, (ch.end || start + 4) - start);
    tl.fromTo(
      animState,
      { titleProgress: 0, cardSlide: -18 },
      { titleProgress: 1, cardSlide: 0, duration: Math.min(1.6, dur * 0.35), ease: 'power3.out' },
      start
    );
  }

  const userApi = { gsap, timeline: tl, domOverlay, canvas: targetCanvas, g, assets, project };
  if (userScene && typeof userScene.setup === 'function') {
    await userScene.setup(userApi);
  }

  function renderFrame(ctx) {
    const t = ctx.time || 0;
    const ch = ctx.chapter || 0;
    const af = ctx.audio || { rms: 0, bass: 0, mid: 0, high: 0, transient: 0, glitch: 0 };
    const [vpU, vpV] = ctx.vp || [0.5, 0.46];

    // Seek GSAP timelines deterministically to frame timestamp
    tl.seek(t, false);
    gsap.globalTimeline.seek(t, false);

    // 1. Render background + archival clip + Dual Particle Constellation onto canvas
    g.fillStyle = '#050811';
    g.fillRect(0, 0, W, H);

    const clipFrame = (ctx.assets || assets)?.getClipFrame?.(ctx.clip?.a, ctx.clip?.a?.localTime ?? t);
    if (clipFrame) {
      try {
        g.save();
        g.globalAlpha = 0.45;
        const pw = W * 0.78;
        const ph = H * 0.78;
        g.drawImage(clipFrame, vpU * W - pw * 0.5, vpV * H - ph * 0.5, pw, ph);
        g.restore();
      } catch {}
    }

    const dual = computeDualParticles(ctx);
    drawDualParticles2D(g, dual, ctx);

    // 2. Update DOM overlay elements & mirror HUD cards onto canvas so capture is 100% identical
    const chapterTitle = ctx.chapterName || `Chapter ${ch + 1}`;
    const barnum = Math.floor(ctx.bar || 1);
    const beatnum = (ctx.beatInBar ?? 0) + 1;
    const sixnum = Math.floor((ctx.beatPhase || 0) * 4) + 1;
    const clockStr = formatClock(t);

    if (titleEl && badgeEl && metricEl) {
      badgeEl.textContent = `${project?.title || 'SLOPSCORE'} // RIG: ${(ctx.rig || 'RELIEF').toUpperCase()}`;
      metricEl.textContent = `BAR ${barnum}.${beatnum}.${sixnum}  •  ${clockStr}`;
      titleEl.textContent = params.showKineticTitle ? chapterTitle : '';
      titleEl.style.transform = `translate3d(${animState.cardSlide.toFixed(1)}px, 0, 0)`;
      titleEl.style.opacity = String(clamp(animState.titleProgress, 0.15, 1));
    }

    // Mirror HUD cards & kinetic typography onto targetCanvas
    const sc = params.hudScale || 1.0;
    const cardAlpha = params.cardOpacity ?? 0.88;
    g.save();

    // Top-left Telemetry Card
    const padX = 28;
    const padY = 24;
    const cardW = 340 * sc;
    const cardH = 66 * sc;
    g.fillStyle = `rgba(8, 16, 28, ${cardAlpha})`;
    g.fillRect(padX, padY, cardW, cardH);
    g.strokeStyle = 'rgba(38, 242, 235, 0.65)';
    g.lineWidth = 1.4;
    g.strokeRect(padX, padY, cardW, cardH);

    g.fillStyle = '#26f2eb';
    g.font = `600 ${Math.round(11 * sc)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    g.fillText(`${(project?.title || 'SLOPSCORE 2.0').toUpperCase()} // CH 0${ch + 1}`, padX + 14, padY + 24 * sc);

    g.fillStyle = '#ffd147';
    g.font = `700 ${Math.round(14 * sc)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    g.fillText(`BAR ${barnum}.${beatnum}.${sixnum}   ${clockStr}   ${ctx.bpm || 120} BPM`, padX + 14, padY + 48 * sc);

    // Top-right Spectral Energy Card
    const specW = 240 * sc;
    const specH = 66 * sc;
    const specX = W - padX - specW;
    g.fillStyle = `rgba(8, 16, 28, ${cardAlpha})`;
    g.fillRect(specX, padY, specW, specH);
    g.strokeStyle = 'rgba(255, 209, 71, 0.55)';
    g.strokeRect(specX, padY, specW, specH);

    const bands = [
      { label: 'RMS', val: af.rms || 0, col: '#26f2eb' },
      { label: 'BAS', val: af.bass || 0, col: '#ffd147' },
      { label: 'MID', val: af.mid || 0, col: '#4ade80' },
      { label: 'HIG', val: af.high || 0, col: '#38bdf8' },
      { label: 'TRN', val: af.transient || 0, col: '#f43f5e' },
      { label: 'GLT', val: af.glitch || 0, col: '#ec4899' }
    ];
    const barSlotW = (specW - 24) / bands.length;
    for (let b = 0; b < bands.length; b++) {
      const bx = specX + 12 + b * barSlotW;
      const bh = clamp(bands[b].val, 0.05, 1) * (specH - 26);
      g.fillStyle = bands[b].col;
      g.fillRect(bx, padY + specH - 16 - bh, barSlotW - 8, bh);
    }

    // Bottom Kinetic Chapter Title Banner
    if (params.showKineticTitle) {
      const bannerY = H - 92 * sc;
      const slideX = padX + animState.cardSlide;
      g.fillStyle = `rgba(8, 16, 28, ${cardAlpha * 0.9})`;
      g.fillRect(slideX, bannerY, 460 * sc, 62 * sc);
      g.fillStyle = '#26f2eb';
      g.fillRect(slideX, bannerY, 4 * sc, 62 * sc);

      g.fillStyle = '#ffffff';
      g.font = `700 ${Math.round(24 * sc)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      g.fillText(chapterTitle.toUpperCase(), slideX + 18 * sc, bannerY + 34 * sc);

      // Chapter progress bar
      const progW = (460 * sc - 36 * sc) * clamp(ctx.chProgress || 0, 0, 1);
      g.fillStyle = 'rgba(38, 242, 235, 0.85)';
      g.fillRect(slideX + 18 * sc, bannerY + 46 * sc, progW, 4 * sc);
    }

    g.restore();

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
    resize,
    setParam: (k, v) => { if (k in params) params[k] = v; },
    getParams: () => ({ ...params }),
    dispose: () => {
      tl.kill();
      if (domOverlay && domOverlay.parentNode) {
        domOverlay.parentNode.removeChild(domOverlay);
      }
    }
  };
}
