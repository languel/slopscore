import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MeasureClock,
  normalizeProject,
  validateProject,
  loadProject,
  createTimeline,
  encodeContextBin,
  decodeContext,
  CONTEXT_STRIDE,
  ProceduralScore,
  audioBufferToWav,
  wavToAudioBuffer,
  extractFeaturesFromBuffer,
  frameDifference,
  autoMatchLoop
} from '../kit/index.mjs';
import { executeMcpTool } from '../mcp/tools.mjs';
import { listRenderers } from '../renderers/index.mjs';
import { startStudioServer } from '../studio/server.mjs';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

test('MeasureClock 1-based bar math, formatting, parsing, and snapping', () => {
  const clock = new MeasureClock({ bpm: 164, timeSignature: [4, 4], duration: 180 });
  assert.equal(clock.barAt(0), 1);
  assert.ok(Math.abs(clock.barSec - (60 / 164) * 4) < 1e-6);
  assert.equal(clock.format(0), '1.1.1');

  const tBar41 = clock.toSeconds(41, 1, 1);
  assert.ok(Math.abs(tBar41 - 58.536585) < 1e-3);
  assert.equal(clock.format(tBar41 + 1e-4), '41.1.1');
  assert.ok(Math.abs(clock.parse('Bar 41.1.1') - tBar41) < 1e-4);

  const snapped = clock.snap(tBar41 + 0.12, 'bar');
  assert.ok(Math.abs(snapped - tBar41) < 1e-4);
});

test('Project schema normalization & template loading', async () => {
  const def = await loadProject(path.join(REPO_ROOT, 'templates', 'default'));
  assert.equal(def.validation.ok, true);
  assert.equal(def.project.chapters.length, 4);

  const ref = await loadProject(path.join(REPO_ROOT, 'templates', 'willnever-reference'));
  assert.equal(ref.validation.ok, true);
  assert.equal(ref.project.audio.bpm, 164);
  assert.equal(ref.project.chapters.length, 8);
});

test('RenderFrameContext & context.bin binary encoding roundtrip', async () => {
  const project = normalizeProject({
    title: 'Context Test',
    audio: { bpm: 120, durationSeconds: 10 },
    fps: 30,
    chapters: [
      { id: 'ch-0', name: 'One', startBar: 1, endBar: 2, particleRig: 'gears', camera: { type: 'dollyPush', startDist: 16, endDist: 12 } },
      { id: 'ch-1', name: 'Two', startBar: 3, endBar: 5, particleRig: 'crystals', camera: { type: 'orbit', startDist: 12, endDist: 10 } }
    ]
  });
  assert.equal(validateProject(project).ok, true);
  const tl = createTimeline(project);
  const ctx0 = tl.contextAt(0);
  assert.equal(ctx0.bar, 1);
  assert.equal(ctx0.chapter, 0);
  assert.equal(ctx0.rig, 'gears');

  const bin = encodeContextBin(tl, 0, 10);
  assert.equal(bin.length, 10 * CONTEXT_STRIDE);
  const decoded = decodeContext(bin, 5);
  assert.ok(Math.abs(decoded.time - 5 / 30) < 1e-5);
  assert.ok(decoded.dist > 10 && decoded.dist <= 16.5);
});

test('ProceduralScore audio synthesis, WAV roundtrip, and feature extraction', async () => {
  const score = new ProceduralScore({ bpm: 164, duration: 2, sampleRate: 22050 });
  const buf = await score.synthesize({ returnStems: true });
  assert.equal(buf.numberOfChannels, 2);
  assert.ok(buf.stems.drums && buf.stems.bass && buf.stems.lead);

  const wav = audioBufferToWav(buf);
  const decoded = wavToAudioBuffer(wav);
  assert.equal(decoded.sampleRate, 22050);
  assert.equal(decoded.length, buf.length);

  const feats = extractFeaturesFromBuffer(decoded, 30);
  assert.equal(feats.frames.length, 60);
  assert.equal(feats.floats.length, 60 * 6);
});

test('Loop finder pixel difference and automatch scanner', async () => {
  const frameA = new Uint8Array(64 * 36 * 4).fill(120);
  const frameB = new Uint8Array(64 * 36 * 4).fill(120);
  const diffIdentical = frameDifference(frameA, frameB, 4);
  assert.equal(diffIdentical.match, 100);
  assert.equal(diffIdentical.mse, 0);

  const grab = async (t) => {
    const val = Math.round(127 + 120 * Math.sin(t * Math.PI));
    return new Uint8Array(32 * 18 * 4).fill(val);
  };
  const matched = await autoMatchLoop(grab, { inSec: 0, outSec: 1.85, window: 0.4, step: 0.05, minLength: 0.5 });
  assert.ok(matched.match > 95);
  assert.ok(Math.abs(matched.outSec - 2.0) <= 0.06);
});

test('MCP tools inspect & validate', async () => {
  const res = await executeMcpTool('slopscore_inspect', {
    dir: path.join(REPO_ROOT, 'templates', 'willnever-reference')
  });
  assert.equal(res.chaptersCount, 8);
  assert.equal(res.audio.bpm, 164);
  assert.ok(res.clipsCount >= 10);
});

test('7 Pluggable Render Engines Registry', () => {
  const list = listRenderers();
  const ids = list.map(r => r.id);
  for (const expected of ['native', 'webgpu', 'threejs', 'fframes', 'hyperframes', 'pixijs', 'p5js']) {
    assert.ok(ids.includes(expected), `Missing renderer: ${expected}`);
  }
});

test('Director Studio HTTP Server, Assistant, and WebMCP routes', async () => {
  const srv = await startStudioServer({
    root: path.join(REPO_ROOT, 'templates', 'willnever-reference'),
    port: 0,
    quiet: true
  });
  try {
    const htmlRes = await fetch(`${srv.url}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.ok(html.includes('webmcp-bridge.js'));

    const projRes = await fetch(`${srv.url}/api/project`);
    assert.equal(projRes.status, 200);
    const proj = await projRes.json();
    assert.equal(proj.project.audio.bpm, 164);
    assert.equal(proj.project.chapters.length, 8);

    const chatRes = await fetch(`${srv.url}/api/assistant/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'builtin',
        messages: [{ role: 'user', content: 'Boost chromatic aberration to 0.42 and seek to bar 41' }]
      })
    });
    assert.equal(chatRes.status, 200);
    const chat = await chatRes.json();
    assert.ok(chat.reply);
    assert.ok(Array.isArray(chat.proposals));
    assert.ok(chat.proposals.length >= 1);
  } finally {
    await srv.close();
  }
});
