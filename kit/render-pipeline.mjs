// render-pipeline.mjs — Unified build, audio synthesis, contact sheet, and video render pipeline.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ProceduralScore, audioBufferToWav } from './audio-engine.js';
import { extractFeaturesFromBuffer, extractFeaturesFromFile, readFeaturesBin, writeFeaturesBin } from './feature-extractor.mjs';
import { buildAssetBank } from './asset-bank.mjs';
import { createTimeline, encodeContextBin, CONTEXT_LAYOUT, CONTEXT_STRIDE } from './frame-context.js';
import { loadClips, readJson, writeJson } from './config-loader.mjs';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * Compile the Objective-C / CoreGraphics native renderer into `out/native-render`.
 */
export function buildNative(loaded) {
  const { root, project, paths } = loaded;
  fs.mkdirSync(paths.out, { recursive: true });
  const srcFile = project.native?.source
    ? path.resolve(root, project.native.source)
    : path.join(REPO_ROOT, 'renderers', 'native', 'native-render-core.m');
  const outBin = paths.nativeBin;
  const args = [
    '-O3', '-fobjc-arc',
    '-framework', 'Foundation',
    '-framework', 'CoreGraphics',
    '-framework', 'CoreText',
    '-framework', 'ImageIO',
    srcFile,
    '-o', outBin
  ];
  const r = spawnSync('clang', args, { stdio: 'pipe', encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`clang build failed:\n${r.stderr || r.stdout}`);
  }
  return outBin;
}

/**
 * Synthesize or load the project score, export stems if requested, and write `out/features.bin`.
 */
export async function synthesizeAudio(loaded, { stems = false, outPath = null } = {}) {
  const { project, paths } = loaded;
  fs.mkdirSync(paths.out, { recursive: true });
  const targetWav = outPath ? path.resolve(loaded.root, outPath) : paths.outScore;
  fs.mkdirSync(path.dirname(targetWav), { recursive: true });

  const { bpm, durationSeconds: duration, sampleRate = 44100 } = project.audio;
  let audioBuffer;

  if (project.audio.synth === null && fs.existsSync(paths.score)) {
    const res = extractFeaturesFromFile(paths.score, paths.features, { fps: project.fps, sampleRate });
    if (path.resolve(paths.score) !== path.resolve(targetWav)) {
      fs.copyFileSync(paths.score, targetWav);
    }
    return { scorePath: targetWav, featuresPath: paths.features, duration: res.duration };
  }

  const scoreGen = new ProceduralScore({ bpm, duration, sampleRate });
  audioBuffer = await scoreGen.synthesize({ returnStems: stems });
  const wavBytes = audioBufferToWav(audioBuffer);
  fs.writeFileSync(targetWav, Buffer.from(wavBytes));

  // Also copy to project.audio.scorePath if inside score/
  if (paths.score && !fs.existsSync(paths.score)) {
    fs.mkdirSync(path.dirname(paths.score), { recursive: true });
    fs.copyFileSync(targetWav, paths.score);
  }

  const feat = extractFeaturesFromBuffer(audioBuffer, project.fps);
  writeFeaturesBin(paths.features, feat.floats);

  const exportedStems = [];
  if (stems && audioBuffer.stems) {
    fs.mkdirSync(paths.outStems, { recursive: true });
    const writeStem = (name, buf) => {
      const wavFile = path.join(paths.outStems, `${name}.wav`);
      const mp3File = path.join(paths.outStems, `${name}.mp3`);
      fs.writeFileSync(wavFile, Buffer.from(audioBufferToWav(buf)));
      const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', wavFile, '-b:a', '192k', mp3File]);
      if (r.status === 0) {
        exportedStems.push(mp3File);
      } else {
        exportedStems.push(wavFile);
      }
    };
    writeStem('master', audioBuffer);
    for (const [name, buf] of Object.entries(audioBuffer.stems)) {
      writeStem(name, buf);
    }
  }

  return { scorePath: targetWav, featuresPath: paths.features, stems: exportedStems, duration };
}

/**
 * Ensure `features.bin`, `archive_bank.bin`, `bank.json`, and `context.bin` exist for the frame range.
 */
export async function prepareRenderContext(loaded, { startFrame = 0, endFrame = null } = {}) {
  const { project, paths } = loaded;
  fs.mkdirSync(paths.out, { recursive: true });

  if (!fs.existsSync(paths.features)) {
    if (fs.existsSync(paths.outScore)) {
      extractFeaturesFromFile(paths.outScore, paths.features, { fps: project.fps });
    } else if (fs.existsSync(paths.score)) {
      extractFeaturesFromFile(paths.score, paths.features, { fps: project.fps });
    } else {
      await synthesizeAudio(loaded, { stems: false });
    }
  }

  const features = readFeaturesBin(paths.features);
  const bank = await buildAssetBank(loaded);
  const clips = loadClips(paths);
  const overrides = readJson(path.join(paths.feedback, 'overrides.json'), { shaders: {}, camera: {}, chapters: {} });
  const timeline = createTimeline(project, { features, clips, bank, overrides });

  const end = endFrame ?? timeline.frameCount;
  const ctxFloats = encodeContextBin(timeline, startFrame, end);
  fs.writeFileSync(paths.context, Buffer.from(ctxFloats.buffer, ctxFloats.byteOffset, ctxFloats.byteLength));
  writeJson(paths.contextMeta, {
    width: project.resolution[0],
    height: project.resolution[1],
    fps: project.fps,
    frameCount: end - startFrame,
    start: startFrame,
    stride: CONTEXT_STRIDE,
    layout: CONTEXT_LAYOUT
  });

  return { timeline, bank, features, startFrame, endFrame: end };
}

/**
 * Render a contact sheet (`out/sheet.jpg`).
 */
export async function renderSheet(loaded, { outPath = null, times = null, renderer = null } = {}) {
  const { root, project, paths } = loaded;
  const engine = renderer || project.renderer || 'native';
  const targetOut = outPath ? path.resolve(root, outPath) : paths.sheet;
  fs.mkdirSync(path.dirname(targetOut), { recursive: true });

  const sheetTimes = Array.isArray(times)
    ? times.map(Number)
    : typeof times === 'string'
      ? times.split(',').map(Number)
      : project.sheet.times;

  await prepareRenderContext(loaded);

  if (engine === 'native') {
    const bin = fs.existsSync(paths.nativeBin) ? paths.nativeBin : buildNative(loaded);
    const timesStr = sheetTimes.join(',');
    let args;
    if (project.native?.legacy) {
      args = ['sheet', paths.features, targetOut, timesStr];
    } else {
      const frameIndices = sheetTimes.map(t => Math.max(0, Math.round(t * project.fps))).join(',');
      args = [
        'sheet',
        '--ctx', paths.context,
        '--bank', paths.bank,
        '--bank-w', String(project.bank?.width || 320),
        '--bank-h', String(project.bank?.height || 180),
        '--w', String(project.resolution[0]),
        '--h', String(project.resolution[1]),
        '--out', targetOut,
        '--frames', frameIndices,
        '--feat', paths.features,
        '--times', timesStr
      ];
    }
    const r = spawnSync(bin, args, { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`Native contact sheet failed with status ${r.status}`);
    return { outPath: targetOut, times: sheetTimes, renderer: engine };
  }

  const { renderBrowserSheet } = await import('../renderers/shared/capture.mjs');
  await renderBrowserSheet({ loaded, rendererId: engine, times: sheetTimes, outPath: targetOut });
  return { outPath: targetOut, times: sheetTimes, renderer: engine };
}

/**
 * Render a video (`out/video.mp4` or custom range/output).
 */
export async function renderVideo(loaded, { outPath = null, range = null, renderer = null } = {}) {
  const { root, project, paths } = loaded;
  const engine = renderer || project.renderer || 'native';
  const targetOut = outPath ? path.resolve(root, outPath) : paths.video;
  fs.mkdirSync(path.dirname(targetOut), { recursive: true });

  const duration = project.audio.durationSeconds;
  const [startSec, endSec] = range
    ? (Array.isArray(range) ? range.map(Number) : String(range).split(':').map(Number))
    : [0, duration];
  const fps = project.fps;
  const startFrame = Math.max(0, Math.round(startSec * fps));
  const endFrame = Math.max(startFrame + 1, Math.round(endSec * fps));
  const clipDuration = (endFrame - startFrame) / fps;

  if (!fs.existsSync(paths.outScore)) {
    await synthesizeAudio(loaded, { stems: false });
  }
  await prepareRenderContext(loaded, { startFrame, endFrame });

  const [W, H] = project.resolution;

  if (engine === 'native') {
    const bin = fs.existsSync(paths.nativeBin) ? paths.nativeBin : buildNative(loaded);
    const args = project.native?.legacy
      ? ['video', paths.features, String(startFrame), String(endFrame), String(fps)]
      : [
          'video',
          '--ctx', paths.context,
          '--bank', paths.bank,
          '--bank-w', String(project.bank?.width || 320),
          '--bank-h', String(project.bank?.height || 180),
          '--w', String(W),
          '--h', String(H),
          '--start', '0',
          '--end', String(endFrame - startFrame),
          '--fps', String(fps),
          '--feat', paths.features
        ];

    const rendererProc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    const ff = spawn('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(fps), '-i', '-',
      '-ss', String(startSec), '-t', String(clipDuration), '-i', paths.outScore,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', targetOut
    ], { stdio: ['pipe', 'inherit', 'inherit'] });

    ff.stdin.on('error', () => {});
    rendererProc.stdout.on('error', () => {});
    rendererProc.stdout.pipe(ff.stdin);
    await new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error(`FFmpeg exited with code ${c}`))));
    return { outPath: targetOut, frames: endFrame - startFrame, duration: clipDuration, renderer: engine };
  }

  const { renderBrowserVideo } = await import('../renderers/shared/capture.mjs');
  await renderBrowserVideo({
    loaded,
    rendererId: engine,
    startFrame,
    endFrame,
    audioPath: paths.outScore,
    startSec,
    clipDuration,
    outPath: targetOut
  });
  return { outPath: targetOut, frames: endFrame - startFrame, duration: clipDuration, renderer: engine };
}
