// loop-finder.mjs — Pixel discontinuity metric & seamless loop auto-matcher.
// Core math is isomorphic (works on any RGBA/RGB Uint8 buffers: canvas ImageData in the
// browser, ffmpeg rawvideo in Node). Node-only helpers (ffmpeg frame grabbing) are
// loaded lazily so this module can be imported from the Studio unchanged.
//
// Ported from mtv-willnever-v4/studio.html computeLoopDifference() / autoMatchLoop().

/**
 * Normalized mean squared error between two frames.
 * @param {Uint8Array|Uint8ClampedArray} a
 * @param {Uint8Array|Uint8ClampedArray} b
 * @param {number} [channels=4] bytes per pixel (4 = RGBA ImageData, 3 = rgb24)
 * @param {number} [step=1] pixel stride for fast approximate scans
 * @returns {{mse:number, mad:number, match:number}} mse/mad in 0..1, match = 0..100 (%)
 *   match = (1 - mad) * 100 — identical to the v4 studio badge (>95 teal, >90 gold, else coral).
 */
export function frameDifference(a, b, channels = 4, step = 1) {
  const n = Math.min(a.length, b.length);
  let sq = 0, abs = 0, count = 0;
  const stride = channels * step;
  for (let i = 0; i + 2 < n; i += stride) {
    const dr = a[i] - b[i], dg = a[i + 1] - b[i + 1], db = a[i + 2] - b[i + 2];
    sq += dr * dr + dg * dg + db * db;
    abs += Math.abs(dr) + Math.abs(dg) + Math.abs(db);
    count += 3;
  }
  const mse = count ? sq / (count * 255 * 255) : 1;
  const mad = count ? abs / (count * 255) : 1;
  const match = Math.max(0, Math.min(100, (1 - mad) * 100));
  return { mse, mad, match };
}

/**
 * Search for the best loop seam near (inSec, outSec).
 * `grab(timeSec)` must resolve to a Uint8 pixel buffer for that time (same size for all calls).
 *
 * Strategy (as in v4 "⚡ Automatch Loop"): hold IN fixed and scan OUT across ±window, then
 * refine IN around the best OUT, keeping the minimum MSE. Enforces a minimum loop length.
 *
 * @returns {Promise<{inSec:number, outSec:number, match:number, mse:number, candidates:Array}>}
 */
export async function autoMatchLoop(grab, {
  inSec, outSec, duration = Infinity, window = 1.0, step = 1 / 15, minLength = 0.5,
  channels = 4, refineIn = true, onProgress
} = {}) {
  const candidates = [];
  const cache = new Map();
  const get = async (t) => {
    const k = t.toFixed(3);
    if (!cache.has(k)) cache.set(k, await grab(t));
    return cache.get(k);
  };
  const score = async (i, o) => {
    const r = frameDifference(await get(i), await get(o), channels, 2);
    const c = { inSec: +i.toFixed(3), outSec: +o.toFixed(3), ...r };
    candidates.push(c);
    return c;
  };

  let best = await score(inSec, outSec);
  const outLo = Math.max(inSec + minLength, outSec - window);
  const outHi = Math.min(duration, outSec + window);
  const totalSteps = Math.ceil((outHi - outLo) / step) + (refineIn ? Math.ceil((2 * window) / step) : 0);
  let done = 0;
  for (let o = outLo; o <= outHi + 1e-9; o += step) {
    const c = await score(inSec, o);
    if (c.mse < best.mse) best = c;
    onProgress?.(++done / totalSteps, best);
  }
  if (refineIn) {
    const inLo = Math.max(0, best.inSec - window);
    const inHi = Math.min(best.outSec - minLength, best.inSec + window);
    for (let i = inLo; i <= inHi + 1e-9; i += step) {
      const c = await score(i, best.outSec);
      if (c.mse < best.mse) best = c;
      onProgress?.(++done / totalSteps, best);
    }
  }
  candidates.sort((x, y) => x.mse - y.mse);
  return { inSec: best.inSec, outSec: best.outSec, match: best.match, mse: best.mse, candidates: candidates.slice(0, 10) };
}

/**
 * Node helper: grab a small rgb24 frame from a media file with ffmpeg.
 * @returns {Promise<Uint8Array>}
 */
export async function ffmpegGrab(file, timeSec, { width = 160, height = 90 } = {}) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-v', 'error', '-ss', String(Math.max(0, timeSec)), '-i', file, '-frames:v', '1',
      '-vf', `scale=${width}:${height}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'
    ]);
    const chunks = [];
    ff.stdout.on('data', d => chunks.push(d));
    let err = '';
    ff.stderr.on('data', d => { err += d; });
    ff.on('close', code => {
      const buf = Buffer.concat(chunks);
      if (code !== 0 || buf.length < width * height * 3) return reject(new Error(`ffmpeg grab failed @${timeSec}s: ${err.trim() || 'no frame'}`));
      resolve(new Uint8Array(buf.buffer, buf.byteOffset, width * height * 3));
    });
  });
}

/** Node helper: probe media duration (seconds) via ffprobe. */
export async function probeDuration(file) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
  const d = parseFloat(r.stdout);
  return Number.isFinite(d) ? d : null;
}

/** Node convenience: automatch a loop directly on a media file. */
export async function autoMatchFile(file, opts = {}) {
  const duration = opts.duration ?? (await probeDuration(file)) ?? Infinity;
  const inSec = opts.inSec ?? 0;
  const outSec = opts.outSec ?? Math.min(duration, inSec + 3);
  return autoMatchLoop((t) => ffmpegGrab(file, t, opts), { ...opts, inSec, outSec, duration, channels: 3 });
}
