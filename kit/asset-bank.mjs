// asset-bank.mjs — Samples project media clips/assets into `out/archive_bank.bin` and `out/bank.json`.
// Supports real video/image assets via ffmpeg and deterministic procedural patterns when assets are absent.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadClips, writeJson } from './config-loader.mjs';

/**
 * Build `out/archive_bank.bin` and `out/bank.json` for a loaded project.
 * If an existing `archive_bank.bin` is already present and `force` is false (e.g. legacy 7-clip bank),
 * ensures `bank.json` is written to match.
 */
export async function buildAssetBank(loaded, { force = false } = {}) {
  const { project, paths } = loaded;
  const W = project.bank?.width || 320;
  const H = project.bank?.height || 180;
  const fps = project.bank?.fps || 15;
  const maxFrames = project.bank?.maxFrames || 100;
  const frameBytes = W * H * 3;

  fs.mkdirSync(paths.out, { recursive: true });
  const savedClips = loadClips(paths);
  const clipsById = new Map(savedClips.map(c => [c.id, c]));

  // Collect ordered unique clip keys referenced by chapters + saved clips + assets dir
  const requestedKeys = [];
  const addKey = (k) => { if (k && !requestedKeys.includes(k)) requestedKeys.push(k); };
  for (const ch of project.chapters) {
    if (ch.clipLoopId) addKey(ch.clipLoopId);
    else if (ch.asset) addKey(ch.asset);
  }
  for (const c of savedClips) addKey(c.id);
  if (fs.existsSync(paths.assets)) {
    for (const f of fs.readdirSync(paths.assets)) {
      if (!f.startsWith('.') && /\.(mp4|webm|ogv|mov|gif|jpg|jpeg|png)$/i.test(f)) addKey(f);
    }
  }
  if (requestedKeys.length === 0) addKey('procedural-default');

  // If archive_bank.bin already exists and we are not forcing a rebuild, synthesize a matching manifest if missing.
  if (!force && fs.existsSync(paths.bank) && fs.statSync(paths.bank).size >= frameBytes) {
    if (fs.existsSync(paths.bankMeta)) {
      return JSON.parse(fs.readFileSync(paths.bankMeta, 'utf8'));
    }
    const stat = fs.statSync(paths.bank);
    const totalFrames = Math.floor(stat.size / frameBytes);
    const perClip = Math.max(1, Math.min(100, Math.floor(totalFrames / Math.max(1, requestedKeys.length))));
    const clipsMeta = requestedKeys.map((key, idx) => {
      const c = clipsById.get(key);
      return {
        key,
        index: idx,
        sourceId: c?.sourceId || key,
        inSec: c?.inSec ?? 0,
        outSec: c?.outSec ?? (perClip / fps),
        offset: Math.min(idx * perClip, Math.max(0, totalFrames - perClip)),
        count: perClip,
        fps
      };
    });
    const manifest = { width: W, height: H, fps, frameBytes, totalFrames, clips: clipsMeta };
    writeJson(paths.bankMeta, manifest);
    return manifest;
  }

  const chunks = [];
  const clipsMeta = [];
  let offsetFrames = 0;

  for (let idx = 0; idx < requestedKeys.length; idx++) {
    const key = requestedKeys[idx];
    const clipObj = clipsById.get(key);
    const sourceId = clipObj?.sourceId || key;
    const assetPath = path.join(paths.assets, sourceId);
    const inSec = clipObj?.inSec ?? 0;
    const outSec = clipObj?.outSec ?? (inSec + maxFrames / fps);
    const dur = Math.max(0.2, outSec - inSec);
    const targetFrames = Math.max(1, Math.min(maxFrames, Math.round(dur * fps)));

    let rawBuf = null;
    if (fs.existsSync(assetPath)) {
      const r = spawnSync('ffmpeg', [
        '-v', 'error',
        '-ss', String(Math.max(0, inSec)),
        '-t', String(dur),
        '-i', assetPath,
        '-vf', `fps=${fps},scale=${W}:${H}:flags=bicubic`,
        '-frames:v', String(targetFrames),
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'
      ], { maxBuffer: 128 * 1024 * 1024 });
      if (r.status === 0 && r.stdout && r.stdout.length >= frameBytes) {
        const count = Math.floor(r.stdout.length / frameBytes);
        rawBuf = r.stdout.subarray(0, count * frameBytes);
      }
    }

    if (!rawBuf) {
      // Deterministic procedural cellular/relief pattern so native renderer always has rich luma texture
      const count = Math.min(32, targetFrames);
      rawBuf = Buffer.alloc(count * frameBytes);
      for (let f = 0; f < count; f++) {
        const phase = (f / count) * Math.PI * 2;
        for (let y = 0; y < H; y++) {
          const ny = (y / H) * 2 - 1;
          for (let x = 0; x < W; x++) {
            const nx = (x / W) * 2 - 1;
            const r2 = Math.sqrt(nx * nx + ny * ny);
            const wave = 0.5 + 0.5 * Math.sin(r2 * 10 - phase + idx * 1.7) * Math.cos(nx * 6 + phase);
            const p = (f * H * W + y * W + x) * 3;
            rawBuf[p] = Math.round(wave * 220);
            rawBuf[p + 1] = Math.round(wave * 240);
            rawBuf[p + 2] = Math.round((0.3 + 0.7 * wave) * 255);
          }
        }
      }
    }

    const count = Math.floor(rawBuf.length / frameBytes);
    chunks.push(rawBuf);
    clipsMeta.push({
      key,
      index: idx,
      sourceId,
      inSec,
      outSec,
      offset: offsetFrames,
      count,
      fps
    });
    offsetFrames += count;
  }

  const finalBuf = Buffer.concat(chunks);
  fs.writeFileSync(paths.bank, finalBuf);
  const manifest = { width: W, height: H, fps, frameBytes, totalFrames: offsetFrames, clips: clipsMeta };
  writeJson(paths.bankMeta, manifest);
  return manifest;
}
