// feature-extractor.mjs — Analytical audio energy curve generator (rms, bass, mid, high, transient, glitch)
// Produces and reads `out/features.bin` (Float32 stride 6 @ project.fps).

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ProceduralScore, wavToAudioBuffer } from './audio-engine.js';

export const FEATURE_STRIDE = 6;
export const FEATURE_NAMES = ['rms', 'bass', 'mid', 'high', 'transient', 'glitch'];

/**
 * Convert an AudioBuffer-like object into both a `{ frames, fps, duration, at(t) }` object
 * and a packed `Float32Array` of stride 6.
 */
export function extractFeaturesFromBuffer(audioBuffer, fps = 30) {
  const extracted = ProceduralScore.extractFeatures(audioBuffer, fps);
  const floats = new Float32Array(extracted.frames.length * FEATURE_STRIDE);
  for (let i = 0; i < extracted.frames.length; i++) {
    const f = extracted.frames[i];
    floats[i * 6 + 0] = f.rms;
    floats[i * 6 + 1] = f.bass;
    floats[i * 6 + 2] = f.mid;
    floats[i * 6 + 3] = f.high;
    floats[i * 6 + 4] = f.transient;
    floats[i * 6 + 5] = f.glitch;
  }
  return { ...extracted, floats };
}

/**
 * Decode an audio file (.wav, .mp3, .ogg, .flac, .m4a) into an AudioBuffer-like object.
 * Uses pure JS for PCM/Float32 WAV files and falls back to ffmpeg for compressed formats.
 */
export function loadAudioFile(filePath, sampleRate = 44100) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.wav') {
    const bytes = fs.readFileSync(filePath);
    return wavToAudioBuffer(bytes);
  }
  const r = spawnSync('ffmpeg', [
    '-v', 'error', '-i', filePath,
    '-f', 'f32le', '-ac', '2', '-ar', String(sampleRate), '-'
  ], { maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout || r.stdout.length === 0) {
    throw new Error(`ffmpeg failed to decode ${filePath}: ${r.stderr?.toString() || 'empty output'}`);
  }
  const allFloats = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.byteLength / 4));
  const totalFrames = Math.floor(allFloats.length / 2);
  const left = new Float32Array(totalFrames);
  const right = new Float32Array(totalFrames);
  for (let i = 0; i < totalFrames; i++) {
    left[i] = allFloats[i * 2];
    right[i] = allFloats[i * 2 + 1];
  }
  return {
    sampleRate,
    length: totalFrames,
    duration: totalFrames / sampleRate,
    numberOfChannels: 2,
    getChannelData(c) { return c === 0 ? left : right; }
  };
}

/**
 * Write packed features Float32Array to `out/features.bin`.
 */
export function writeFeaturesBin(featPath, floats) {
  fs.mkdirSync(path.dirname(featPath), { recursive: true });
  fs.writeFileSync(featPath, Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength));
  return featPath;
}

/**
 * Read `out/features.bin` as a Float32Array (or null if missing).
 */
export function readFeaturesBin(featPath) {
  if (!fs.existsSync(featPath)) return null;
  const buf = fs.readFileSync(featPath);
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

/**
 * Extract features from an audio file on disk and write `features.bin`.
 */
export function extractFeaturesFromFile(audioPath, featPath, { fps = 30, sampleRate = 44100 } = {}) {
  const audioBuffer = loadAudioFile(audioPath, sampleRate);
  const res = extractFeaturesFromBuffer(audioBuffer, fps);
  if (featPath) writeFeaturesBin(featPath, res.floats);
  return res;
}
