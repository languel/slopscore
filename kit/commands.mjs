// commands.mjs — Canonical Studio/MCP command presets → slopscore CLI invocations.
// The studio server (/api/run), the MCP server and docs all read from here so the
// "Rebuild / Contact Sheet / Render Video / Synthesize Audio" buttons never drift from the CLI.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const CLI = path.join(REPO_ROOT, 'bin', 'slopscore.mjs');

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const cli = (...args) => [`${q(process.execPath)} ${q(CLI)}`, ...args].join(' ');

/**
 * @param {string} root project root
 * @returns {Record<string, {title:string, cmd:string, artifact:string, description:string}>}
 */
export function commandPresets(root) {
  const r = q(root);
  return {
    build: { title: 'Recompile Native Renderer', artifact: 'binary', description: 'clang -O3 build of the native CoreGraphics renderer into out/native-render', cmd: cli('build', r) },
    audio: { title: 'Synthesize Audio & Stems', artifact: 'audio', description: 'Synthesize/load the score, export stems, extract features.bin', cmd: cli('audio', r, '--stems') },
    features: { title: 'Extract Audio Features', artifact: 'features', description: 'Analyze the score into out/features.bin (rms, bass, mid, high, transient, glitch)', cmd: cli('features', r) },
    bank: { title: 'Build Asset Bank', artifact: 'bank', description: 'Sample chapter clips/assets into out/archive_bank.bin for the native renderer', cmd: cli('bank', r) },
    sheet: { title: 'Contact Sheet (12 frames)', artifact: 'sheet', description: 'Render keyframes into out/sheet.jpg', cmd: cli('sheet', r) },
    preview: { title: 'Fast Preview Render (15s)', artifact: 'preview', description: 'Render 0–15s into out/preview.mp4', cmd: cli('render', r, '--range=0:15', '--out=out/preview.mp4') },
    video: { title: 'Full Master Video', artifact: 'video', description: 'Render the full piece into out/video.mp4', cmd: cli('render', r) },
    full: { title: 'Rebuild All & Render Master Video', artifact: 'all', description: 'build → audio → sheet → video', cmd: [cli('build', r), cli('audio', r, '--stems'), cli('sheet', r), cli('render', r)].join(' && ') }
  };
}

/** Preview render for an explicit "a:b" seconds range. */
export function previewRangeCommand(root, range) {
  if (!/^\d+(\.\d+)?:\d+(\.\d+)?$/.test(String(range))) throw new Error(`Invalid range "${range}" (expected "start:end" seconds)`);
  return { title: `Preview Range ${range}`, artifact: 'preview', cmd: cli('render', q(root), `--range=${range}`, '--out=out/preview.mp4') };
}
