// renderers/shared/asset-manager.js
// Browser AssetManager for Slopscore 2.0.
// Loads images, videos, SVGs, and optional binary archive_bank.bin, providing both
// CanvasImageSource frames (`getClipFrame`) and fast UV luminance/RGB sampling (`sampleClipUV`)
// for the 420-particle Archival Relief engine.

import { clamp } from '../../kit/measure-clock.js';
import { defaultProceduralSample } from './dual-particles.js';

const VIDEO_EXT_RE = /\.(mp4|webm|ogv|mov)(\?.*)?$/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif)(\?.*)?$/i;

export function createAssetManager({
  baseUrl = '/project',
  project = {},
  clips = [],
  bank = null,
  bankBuffer = null
} = {}) {
  const cleanBase = String(baseUrl || '/project').replace(/\/+$/, '');
  const assetsDir = String(project?.assetsDir || 'assets').replace(/^\/+|\/+$/g, '');
  const clipsById = new Map((clips || []).map(c => [c.id, c]));
  const images = new Map();
  const videos = new Map();
  const pending = [];

  // Optional raw RGB24 archive_bank.bin bytes (width * height * 3 per frame)
  let bankBytes = bankBuffer ? new Uint8Array(bankBuffer) : null;
  const bankW = bank?.width || project?.bank?.width || 320;
  const bankH = bank?.height || project?.bank?.height || 180;
  const frameBytes = bankW * bankH * 3;

  // Offscreen sampling canvas for live <video> / <img> UV reads when bankBytes isn't loaded
  let sampleCanvas = null;
  let sampleCtx = null;
  let lastSampleKey = null;
  let lastSampleData = null;
  const sampW = 160;
  const sampH = 90;

  if (typeof document !== 'undefined') {
    sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = sampW;
    sampleCanvas.height = sampH;
    sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  }

  function url(name) {
    if (!name) return null;
    if (/^(https?:|data:|blob:|\/)/.test(name)) return name;
    if (name.startsWith('assets/') || name.startsWith('out/') || name.startsWith('feedback/')) {
      return `${cleanBase}/${name}`;
    }
    return `${cleanBase}/${assetsDir}/${name}`;
  }

  function list() {
    const names = new Set();
    for (const c of clips || []) if (c.sourceId) names.add(c.sourceId);
    for (const ch of project?.chapters || []) {
      if (ch.asset) names.add(ch.asset);
      if (ch.clipLoopId && clipsById.has(ch.clipLoopId)) {
        const cl = clipsById.get(ch.clipLoopId);
        if (cl?.sourceId) names.add(cl.sourceId);
      }
    }
    return Array.from(names);
  }

  function getImage(name) {
    if (!name || typeof Image === 'undefined') return null;
    if (images.has(name)) return images.get(name).el;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const entry = { el: img, loaded: false, error: false };
    const p = new Promise(resolve => {
      const timer = setTimeout(resolve, 1500);
      img.onload = () => { entry.loaded = true; clearTimeout(timer); resolve(); };
      img.onerror = () => { entry.error = true; clearTimeout(timer); resolve(); };
    });
    img.src = url(name);
    images.set(name, entry);
    pending.push(p);
    return img;
  }

  function getVideo(name) {
    if (!name || typeof document === 'undefined') return null;
    if (videos.has(name)) return videos.get(name).el;
    const vid = document.createElement('video');
    vid.crossOrigin = 'anonymous';
    vid.muted = true;
    vid.loop = true;
    vid.playsInline = true;
    vid.preload = 'auto';
    const entry = { el: vid, loaded: false, error: false, lastSeek: -1 };
    const p = new Promise(resolve => {
      const timer = setTimeout(resolve, 1800);
      vid.onloadeddata = () => { entry.loaded = true; clearTimeout(timer); resolve(); };
      vid.onerror = () => { entry.error = true; clearTimeout(timer); resolve(); };
    });
    vid.src = url(name);
    videos.set(name, entry);
    pending.push(p);
    return vid;
  }

  // Try to fetch archive_bank.bin in browser if bank manifest exists and has frames
  if (typeof fetch !== 'undefined' && !bankBytes && bank && bank.totalFrames > 0) {
    const bankUrl = `${cleanBase}/out/archive_bank.bin`;
    const p = fetch(bankUrl)
      .then(r => (r.ok ? r.arrayBuffer() : null))
      .then(buf => { if (buf && buf.byteLength >= frameBytes) bankBytes = new Uint8Array(buf); })
      .catch(() => {});
    pending.push(p);
  }

  // Pre-warm declared project assets
  for (const name of list()) {
    if (VIDEO_EXT_RE.test(name)) getVideo(name);
    else if (IMAGE_EXT_RE.test(name)) getImage(name);
  }

  function resolveSource(clipRef) {
    if (!clipRef) return null;
    if (typeof clipRef === 'string') {
      const cl = clipsById.get(clipRef);
      return cl ? cl.sourceId : clipRef;
    }
    if (clipRef.sourceId) return clipRef.sourceId;
    if (clipRef.id && clipsById.has(clipRef.id)) return clipsById.get(clipRef.id).sourceId;
    return null;
  }

  function getClipFrame(clipRef, localTime = 0) {
    const srcName = resolveSource(clipRef);
    const t = clipRef?.localTime ?? localTime ?? 0;

    if (srcName) {
      if (IMAGE_EXT_RE.test(srcName)) {
        const img = getImage(srcName);
        const entry = images.get(srcName);
        if (entry?.loaded) return img;
      } else if (VIDEO_EXT_RE.test(srcName)) {
        const vid = getVideo(srcName);
        const entry = videos.get(srcName);
        if (vid && entry?.loaded) {
          const dur = vid.duration || 10;
          const target = ((t % dur) + dur) % dur;
          if (Math.abs((vid.currentTime || 0) - target) > 0.04) {
            try { vid.currentTime = target; } catch {}
          }
          return vid;
        }
      }
    }

    // If bankBytes has the pre-decoded RGB24 frame, draw it into sampleCanvas and return it
    if (bankBytes && sampleCtx && typeof clipRef === 'object' && clipRef?.frame >= 0) {
      const f = clipRef.frame;
      const offset = f * frameBytes;
      if (offset + frameBytes <= bankBytes.length) {
        const key = `bank:${f}`;
        if (lastSampleKey !== key) {
          const imgData = sampleCtx.createImageData(sampW, sampH);
          const dst = imgData.data;
          for (let y = 0; y < sampH; y++) {
            const by = Math.min(bankH - 1, Math.floor((y * bankH) / sampH));
            for (let x = 0; x < sampW; x++) {
              const bx = Math.min(bankW - 1, Math.floor((x * bankW) / sampW));
              const si = offset + (by * bankW + bx) * 3;
              const di = (y * sampW + x) * 4;
              dst[di] = bankBytes[si];
              dst[di + 1] = bankBytes[si + 1];
              dst[di + 2] = bankBytes[si + 2];
              dst[di + 3] = 255;
            }
          }
          sampleCtx.putImageData(imgData, 0, 0);
          lastSampleKey = key;
          lastSampleData = dst;
        }
        return sampleCanvas;
      }
    }

    return null;
  }

  /**
   * Sample normalized (u, v) in [0, 1] from the active clip or archive bank, returning {r, g, b, luma} in 0..1.
   */
  function sampleClipUV(clipRef, u, v, time = 0, chapter = 0) {
    const cu = clamp(u, 0, 0.999);
    const cv = clamp(v, 0, 0.999);

    // 1. Direct binary bank lookup if available
    if (bankBytes && clipRef && typeof clipRef.frame === 'number' && clipRef.frame >= 0) {
      const totalFrames = Math.floor(bankBytes.length / frameBytes);
      if (totalFrames > 0) {
        const f = ((clipRef.frame % totalFrames) + totalFrames) % totalFrames;
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

    // 2. Live DOM <video> / <img> raster cache
    const src = getClipFrame(clipRef, clipRef?.localTime ?? time);
    if (src && sampleCtx) {
      const key = `${resolveSource(clipRef)}:${Math.floor((clipRef?.localTime ?? time) * 15)}`;
      if (key !== lastSampleKey) {
        try {
          sampleCtx.drawImage(src, 0, 0, sampW, sampH);
          lastSampleData = sampleCtx.getImageData(0, 0, sampW, sampH).data;
          lastSampleKey = key;
        } catch {
          lastSampleData = null;
        }
      }
      if (lastSampleData) {
        const sx = Math.floor(cu * sampW);
        const sy = Math.floor(cv * sampH);
        const idx = (sy * sampW + sx) * 4;
        const r = lastSampleData[idx] / 255;
        const g = lastSampleData[idx + 1] / 255;
        const b = lastSampleData[idx + 2] / 255;
        return { r, g, b, luma: 0.299 * r + 0.587 * g + 0.114 * b };
      }
    }

    // 3. Deterministic procedural fallback
    return defaultProceduralSample(cu, cv, time, chapter);
  }

  async function ready() {
    await Promise.allSettled(pending);
  }

  function setBankBuffer(buf) {
    bankBytes = buf ? new Uint8Array(buf) : null;
  }

  return {
    list,
    url,
    getImage,
    getVideo,
    getClipFrame,
    sampleClipUV,
    setBankBuffer,
    ready
  };
}
