// renderers/shared/capture.mjs
// Headless browser & pure-Node software fallback frame capture runner for Slopscore 2.0.
// Supports:
//   - renderBrowserFrames({ loaded, rendererId, startFrame, endFrame, frameIndices, output, onProgress, chromePath })
//   - renderBrowserVideo({ loaded, rendererId, startFrame, endFrame, outPath, audioPath, onProgress, chromePath })
//   - renderBrowserSheet({ loaded, rendererId, times, frames, outPath, cols, thumbW, onProgress, chromePath })

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTimeline } from '../../kit/frame-context.js';
import { clamp, lerp } from '../../kit/measure-clock.js';
import { loadClips, readJson } from '../../kit/config-loader.mjs';
import { computeDualParticles, curlVelocity2D, defaultProceduralSample } from './dual-particles.js';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium'
].filter(Boolean);

export function findChromeExecutable(customPath) {
  if (customPath && fs.existsSync(customPath)) return customPath;
  for (const p of CHROME_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.bin': 'application/octet-stream'
};

/**
 * Start an ephemeral local HTTP server implementing the CONTRACTS.md §7 URL space.
 */
export async function startCaptureServer(loaded) {
  const { root, project, paths } = loaded;
  const clips = loadClips(paths);
  const bank = readJson(paths.bankMeta, null);
  const overrides = readJson(path.join(paths.feedback, 'overrides.json'), { shaders: {}, camera: {}, chapters: {} });
  const hasFeatures = fs.existsSync(paths.features);

  const server = http.createServer((req, res) => {
    const urlObj = new URL(req.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(urlObj.pathname);

    if (pathname === '/api/project') {
      const payload = {
        root,
        title: project.title,
        project,
        clips,
        bank,
        overrides,
        featuresUrl: hasFeatures ? '/project/out/features.bin' : null,
        renderers: []
      };
      const body = JSON.stringify(payload);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(body);
      return;
    }

    let filePath = null;
    if (pathname.startsWith('/slopscore/')) {
      filePath = path.join(REPO_ROOT, pathname.slice('/slopscore/'.length));
    } else if (pathname.startsWith('/project/')) {
      filePath = path.join(root, pathname.slice('/project/'.length));
    } else if (pathname.startsWith('/out/') || pathname.startsWith('/assets/') || pathname.startsWith('/feedback/')) {
      filePath = path.join(root, pathname.slice(1));
    } else if (pathname.startsWith('/studio/')) {
      filePath = path.join(REPO_ROOT, pathname.slice(1));
    }

    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*'
    });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    server,
    origin,
    close: () => new Promise(resolve => server.close(() => resolve()))
  };
}

/**
 * Pure-Node software rasterizer fallback using the isomorphic Dual Particle Constellation engine.
 * Produces an RGBA buffer (`Uint8Array(W * H * 4)`) deterministically for any frame context.
 */
export function softwareRenderFrameRGBA(ctx, W, H, bankBytes = null, bankW = 320, bankH = 180) {
  const rgba = new Uint8Array(W * H * 4);
  const t = ctx.time || 0;
  const ch = ctx.chapter || 0;
  const af = ctx.audio || { rms: 0, bass: 0, mid: 0, high: 0, transient: 0, glitch: 0 };
  const [vpU, vpV] = ctx.vp || [0.5, 0.46];
  const scanlineAmt = ctx.shaders?.crtScanlines === false ? 0 : 0.12;
  const vigAmt = ctx.shaders?.vignette ?? 0.24;

  const frameBytes = bankW * bankH * 3;
  const sampleUV = (u, v) => {
    const cu = clamp(u, 0, 0.999);
    const cv = clamp(v, 0, 0.999);
    if (bankBytes && ctx.clip?.a?.frame >= 0) {
      const total = Math.floor(bankBytes.length / frameBytes);
      if (total > 0) {
        const f = ((ctx.clip.a.frame % total) + total) % total;
        const bx = Math.floor(cu * bankW);
        const by = Math.floor(cv * bankH);
        const idx = f * frameBytes + (by * bankW + bx) * 3;
        if (idx + 2 < bankBytes.length) {
          const r = bankBytes[idx] / 255;
          const g = bankBytes[idx + 1] / 255;
          const b = bankBytes[idx + 2] / 255;
          return { r, g, b, luma: 0.299 * r + 0.587 * g + 0.114 * b };
        }
      }
    }
    return defaultProceduralSample(cu, cv, t, ch);
  };

  // 1. Background fluid field + archival viewport projection + CRT scanlines/vignette
  for (let y = 0; y < H; y++) {
    const v = y / H;
    const ny = v * 2 - 1;
    const scan = y % 2 === 0 ? 1.0 : 1.0 - scanlineAmt;
    const fvy = Math.cos(v * 7.2 - t * 1.3);
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const nx = u * 2 - 1;
      const fvx = Math.sin(u * 8.5 + t * 1.6) * fvy;
      const fluidGlow = clamp(Math.abs(fvx) * 0.45 + af.bass * 0.15, 0, 1);

      let r = 0.03 + fluidGlow * 0.10;
      let g = 0.05 + fluidGlow * 0.22;
      let b = 0.10 + fluidGlow * 0.32;

      const dx = (u - vpU) * 1.18;
      const dy = v - vpV;
      const vpMask = clamp(1.28 - Math.sqrt(dx * dx + dy * dy) * 2.1, 0, 1);
      if (vpMask > 0.01) {
        const au = clamp((u - vpU) * 1.35 + 0.5, 0, 0.999);
        const av = clamp((v - vpV) * 1.25 + 0.5, 0, 0.999);
        const samp = sampleUV(au, av);
        r = lerp(r, samp.r * 0.85, vpMask * 0.65);
        g = lerp(g, samp.g * 0.88, vpMask * 0.65);
        b = lerp(b, samp.b * 0.92, vpMask * 0.65);
      }

      const r2 = nx * nx + ny * ny;
      const vig = clamp(1.08 - r2 * vigAmt, 0.2, 1.0);
      const mult = scan * vig;

      const idx = (y * W + x) * 4;
      rgba[idx] = Math.min(255, Math.max(0, Math.round(r * mult * 255)));
      rgba[idx + 1] = Math.min(255, Math.max(0, Math.round(g * mult * 255)));
      rgba[idx + 2] = Math.min(255, Math.max(0, Math.round(b * mult * 255)));
      rgba[idx + 3] = 255;
    }
  }

  // Helper to blend a pixel
  const blendPixel = (px, py, pr, pg, pb, pa) => {
    if (px < 0 || px >= W || py < 0 || py >= H) return;
    const idx = (py * W + px) * 4;
    const inv = 1 - pa;
    rgba[idx] = Math.min(255, Math.round(rgba[idx] * inv + pr * pa));
    rgba[idx + 1] = Math.min(255, Math.round(rgba[idx + 1] * inv + pg * pa));
    rgba[idx + 2] = Math.min(255, Math.round(rgba[idx + 2] * inv + pb * pa));
  };

  // Helper to draw a Bresenham line
  const drawLine = (x0, y0, x1, y1, pr, pg, pb, pa) => {
    let ix0 = Math.round(x0), iy0 = Math.round(y0);
    const ix1 = Math.round(x1), iy1 = Math.round(y1);
    const dx = Math.abs(ix1 - ix0), sx = ix0 < ix1 ? 1 : -1;
    const dy = -Math.abs(iy1 - iy0), sy = iy0 < iy1 ? 1 : -1;
    let err = dx + dy;
    let steps = 0;
    while (steps++ < 2000) {
      blendPixel(ix0, iy0, pr, pg, pb, pa);
      if (ix0 === ix1 && iy0 === iy1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; ix0 += sx; }
      if (e2 <= dx) { err += dx; iy0 += sy; }
    }
  };

  // 2. Dual Particle Constellation + Plexus Lines
  const state = computeDualParticles(ctx, { sampleUV });
  for (const ln of state.lines) {
    drawLine(
      ln.sx0, ln.sy0, ln.sx1, ln.sy1,
      Math.round(clamp(ln.r, 0, 1) * 255),
      Math.round(clamp(ln.g, 0, 1) * 255),
      Math.round(clamp(ln.b, 0, 1) * 255),
      clamp(ln.alpha, 0, 1)
    );
  }

  for (const p of state.particles) {
    if (!p.visible) continue;
    const fog = clamp(14.0 / (p.depth + 2.0), 0.35, 1.15);
    const pr = Math.round(clamp(p.r * fog, 0, 1) * 255);
    const pg = Math.round(clamp(p.g * fog, 0, 1) * 255);
    const pb = Math.round(clamp(p.b * fog, 0, 1) * 255);
    const pa = clamp(p.alpha * clamp(fog, 0.3, 1.0), 0, 1);
    const half = Math.max(1, Math.round(p.size * 0.5));
    const cx = Math.round(p.sx);
    const cy = Math.round(p.sy);
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const isCore = Math.abs(dx) <= half * 0.45 && Math.abs(dy) <= half * 0.45;
        blendPixel(
          cx + dx,
          cy + dy,
          isCore ? Math.min(255, pr + 85) : pr,
          isCore ? Math.min(255, pg + 85) : pg,
          isCore ? Math.min(255, pb + 85) : pb,
          pa
        );
      }
    }
  }

  return rgba;
}

function buildLoadedTimeline(loaded) {
  const { project, paths } = loaded;
  let features = null;
  if (fs.existsSync(paths.features)) {
    const buf = fs.readFileSync(paths.features);
    features = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  }
  const clips = loadClips(paths);
  const bank = readJson(paths.bankMeta, null);
  const overrides = readJson(path.join(paths.feedback, 'overrides.json'), { shaders: {}, camera: {}, chapters: {} });
  const bankBytes = fs.existsSync(paths.bank) ? fs.readFileSync(paths.bank) : null;
  const timeline = createTimeline(project, { features, clips, bank, overrides });
  return { timeline, bankBytes, bank };
}

/**
 * Render a sequence of frames `[startFrame, endFrame)` (or explicit `frameIndices`) using headless Chrome
 * (or pure-Node software fallback if Chrome is unavailable), piping raw RGBA (`width*height*4` bytes/frame)
 * to `output`.
 */
export async function renderBrowserFrames({
  loaded,
  rendererId,
  startFrame = 0,
  endFrame,
  frameIndices = null,
  output,
  onProgress,
  chromePath
} = {}) {
  const { project } = loaded;
  const [W, H] = project.resolution || [1280, 720];
  const { timeline, bankBytes, bank } = buildLoadedTimeline(loaded);
  const indices = Array.isArray(frameIndices)
    ? frameIndices
    : Array.from(
        { length: Math.max(0, (endFrame ?? timeline.frameCount) - startFrame) },
        (_, i) => startFrame + i
      );

  const resolvedChrome = findChromeExecutable(chromePath);
  if (resolvedChrome) {
    let capServer = null;
    let browser = null;
    try {
      const puppeteer = await import('puppeteer-core');
      capServer = await startCaptureServer(loaded);
      browser = await puppeteer.default.launch({
        executablePath: resolvedChrome,
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--enable-unsafe-webgpu',
          '--use-gl=angle',
          '--ignore-gpu-blocklist',
          `--window-size=${W},${H}`
        ],
        defaultViewport: { width: W, height: H, deviceScaleFactor: 1 }
      });

      const page = await browser.newPage();
      const targetRenderer = rendererId || project.renderer || 'threejs';
      const hostUrl = `${capServer.origin}/slopscore/renderers/shared/host.html?renderer=${encodeURIComponent(targetRenderer)}&api=${encodeURIComponent(capServer.origin)}&w=${W}&h=${H}`;
      await page.goto(hostUrl, { waitUntil: 'networkidle0', timeout: 15000 });
      await page.evaluate(() => window.__slopscore.ready);

      for (let i = 0; i < indices.length; i++) {
        const f = indices[i];
        const b64 = await page.evaluate(async (frameIndex) => {
          await window.__slopscore.renderFrame(frameIndex);
          const rgba = window.__slopscore.getRGBA();
          if (!rgba) return null;
          // Encode Uint8ClampedArray into binary string for fast transfer
          let binary = '';
          const chunk = 0x8000;
          for (let j = 0; j < rgba.length; j += chunk) {
            binary += String.fromCharCode.apply(null, rgba.subarray(j, j + chunk));
          }
          return btoa(binary);
        }, f);

        let buf;
        if (b64) {
          buf = Buffer.from(b64, 'base64');
        } else {
          // For DOM-based renderers (hyperframes / fframes), fall back to screenshot or software rasterizer
          const ctx = timeline.contextForFrame(f);
          buf = Buffer.from(softwareRenderFrameRGBA(ctx, W, H, bankBytes, bank?.width, bank?.height));
        }

        if (output) {
          const ok = output.write(buf);
          if (!ok) await new Promise(r => output.once('drain', r));
        }
        onProgress?.({ index: i + 1, total: indices.length, frame: f });
      }
      return { width: W, height: H, frames: indices.length, mode: 'puppeteer' };
    } catch (err) {
      console.warn(`[Slopscore Capture] Headless Chrome capture failed (${err.message}); falling back to software renderer.`);
    } finally {
      if (browser) await browser.close().catch(() => {});
      if (capServer) await capServer.close().catch(() => {});
    }
  }

  // Pure-Node deterministic software fallback
  for (let i = 0; i < indices.length; i++) {
    const f = indices[i];
    const ctx = timeline.contextForFrame(f);
    const rgba = softwareRenderFrameRGBA(ctx, W, H, bankBytes, bank?.width || 320, bank?.height || 180);
    if (output) {
      const ok = output.write(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength));
      if (!ok) await new Promise(r => output.once('drain', r));
    }
    onProgress?.({ index: i + 1, total: indices.length, frame: f });
  }
  return { width: W, height: H, frames: indices.length, mode: 'software' };
}

/**
 * Render an MP4 video from a browser renderer (or software fallback) using ffmpeg.
 */
export async function renderBrowserVideo({
  loaded,
  rendererId,
  startFrame = 0,
  endFrame,
  outPath,
  audioPath,
  onProgress,
  chromePath
} = {}) {
  const { project, paths } = loaded;
  const [W, H] = project.resolution || [1280, 720];
  const fps = project.fps || 30;
  const totalF = Math.ceil((project.audio?.durationSeconds || 60) * fps);
  const endF = endFrame ?? totalF;
  const dest = outPath || paths.video;
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const resolvedAudio = audioPath || (fs.existsSync(paths.outScore) ? paths.outScore : fs.existsSync(paths.score) ? paths.score : null);
  const startSec = startFrame / fps;
  const durSec = Math.max(0.1, (endF - startFrame) / fps);

  const ffArgs = [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${W}x${H}`,
    '-r', String(fps),
    '-i', 'pipe:0'
  ];
  if (resolvedAudio) {
    ffArgs.push('-ss', String(startSec), '-t', String(durSec), '-i', resolvedAudio, '-c:a', 'aac', '-b:a', '192k', '-shortest');
  }
  ffArgs.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '19', dest);

  const ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'ignore', 'pipe'] });
  let ffErr = '';
  ff.stderr.on('data', d => { ffErr += d.toString(); });

  const result = await renderBrowserFrames({
    loaded,
    rendererId,
    startFrame,
    endFrame: endF,
    output: ff.stdin,
    onProgress,
    chromePath
  });

  ff.stdin.end();
  await new Promise((resolve, reject) => {
    ff.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${ffErr.slice(-400)}`));
    });
  });

  return { outPath: dest, ...result };
}

/**
 * Render a multi-frame contact sheet (`out/sheet.jpg`) from a browser renderer (or software fallback).
 */
export async function renderBrowserSheet({
  loaded,
  rendererId,
  times,
  frames,
  outPath,
  cols = 3,
  thumbW = 640,
  onProgress,
  chromePath
} = {}) {
  const { project, paths } = loaded;
  const [W, H] = project.resolution || [1280, 720];
  const fps = project.fps || 30;
  const dest = outPath || paths.sheet;
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const frameIndices = Array.isArray(frames) && frames.length
    ? frames
    : (times || project.sheet?.times || [0, 5, 10, 15]).map(t => Math.max(0, Math.round(t * fps)));

  const count = frameIndices.length;
  const rows = Math.max(1, Math.ceil(count / cols));
  const thumbH = Math.round((thumbW * H) / W);
  const sheetW = cols * thumbW;
  const sheetH = rows * thumbH;
  const sheetRGBA = Buffer.alloc(sheetW * sheetH * 4, 255);

  const chunks = [];
  const frameBytes = W * H * 4;
  let received = Buffer.alloc(0);
  let frameCursor = 0;

  const collector = {
    write(buf) {
      received = Buffer.concat([received, buf]);
      while (received.length >= frameBytes && frameCursor < count) {
        const frameBuf = received.subarray(0, frameBytes);
        received = received.subarray(frameBytes);
        const col = frameCursor % cols;
        const row = Math.floor(frameCursor / cols);
        for (let ty = 0; ty < thumbH; ty++) {
          const sy = Math.min(H - 1, Math.floor((ty * H) / thumbH));
          for (let tx = 0; tx < thumbW; tx++) {
            const sx = Math.min(W - 1, Math.floor((tx * W) / thumbW));
            const sIdx = (sy * W + sx) * 4;
            const dIdx = ((row * thumbH + ty) * sheetW + (col * thumbW + tx)) * 4;
            sheetRGBA[dIdx] = frameBuf[sIdx];
            sheetRGBA[dIdx + 1] = frameBuf[sIdx + 1];
            sheetRGBA[dIdx + 2] = frameBuf[sIdx + 2];
            sheetRGBA[dIdx + 3] = 255;
          }
        }
        frameCursor++;
      }
      return true;
    },
    once() {}
  };

  await renderBrowserFrames({
    loaded,
    rendererId,
    frameIndices,
    output: collector,
    onProgress,
    chromePath
  });

  const ff = spawn('ffmpeg', [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${sheetW}x${sheetH}`,
    '-i', 'pipe:0',
    '-frames:v', '1',
    '-q:v', '3',
    dest
  ], { stdio: ['pipe', 'ignore', 'pipe'] });

  ff.stdin.write(sheetRGBA);
  ff.stdin.end();
  await new Promise((resolve, reject) => {
    ff.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg sheet encode exited ${code}`))));
  });

  return { outPath: dest, width: sheetW, height: sheetH, count };
}
