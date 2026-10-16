// config-loader.mjs — Locate, import, normalize and validate slopscore.config.js (Node only).

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeProject, validateProject } from './project-schema.js';

export const CONFIG_NAMES = ['slopscore.config.js', 'slopscore.config.mjs', 'slopscore.config.json'];

/** Walk up from `start` to find a directory containing a slopscore config. */
export function findProjectRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  while (true) {
    for (const n of CONFIG_NAMES) if (fs.existsSync(path.join(dir, n))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Standard on-disk layout of a Slopscore project. */
export function projectPaths(root, project) {
  const out = path.join(root, 'out');
  const feedback = path.join(root, 'feedback');
  return {
    root,
    out,
    feedback,
    assets: path.resolve(root, project?.assetsDir || 'assets'),
    score: path.resolve(root, project?.audio?.scorePath || 'score/score.wav'),
    stemsDir: path.resolve(root, project?.audio?.stemsDir || 'score/stems/'),
    outScore: path.join(out, 'score.wav'),
    outStems: path.join(out, 'stems'),
    features: path.join(out, 'features.bin'),
    context: path.join(out, 'context.bin'),
    contextMeta: path.join(out, 'context.json'),
    bank: path.join(out, 'archive_bank.bin'),
    bankMeta: path.join(out, 'bank.json'),
    nativeBin: path.join(out, 'native-render'),
    sheet: path.join(out, 'sheet.jpg'),
    video: path.join(out, 'video.mp4'),
    preview: path.join(out, 'preview.mp4'),
    versionsDir: path.join(out, 'versions'),
    notes: path.join(feedback, 'notes.json'),
    clips: path.join(feedback, 'clips.json'),
    versions: path.join(feedback, 'versions.json'),
    annotations: path.join(feedback, 'asset_annotations.json'),
    feedbackMd: path.join(feedback, 'FEEDBACK.md'),
    media: path.join(feedback, 'media'),
    backups: path.join(feedback, 'backups')
  };
}

/**
 * Load a project directory.
 * @returns {Promise<{root:string, configFile:string, raw:object, project:object, paths:object, validation:object}>}
 */
export async function loadProject(dir = process.cwd(), { strict = false } = {}) {
  const root = findProjectRoot(dir);
  if (!root) throw new Error(`No slopscore.config.js found in ${path.resolve(dir)} or its parents. Run \`slopscore init <dir>\` first.`);
  const configFile = CONFIG_NAMES.map(n => path.join(root, n)).find(f => fs.existsSync(f));
  let raw;
  if (configFile.endsWith('.json')) {
    raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } else {
    // Cache-bust so long-lived processes (studio, MCP) see edits.
    const mod = await import(`${pathToFileURL(configFile).href}?t=${fs.statSync(configFile).mtimeMs}`);
    raw = mod.default || mod.config || mod;
  }
  const project = normalizeProject(raw);
  const validation = validateProject(project);
  if (strict && !validation.ok) {
    throw new Error(`Invalid ${path.basename(configFile)}:\n` + validation.errors.map(e => `  - ${e.path}: ${e.message}`).join('\n'));
  }
  return { root, configFile, raw, project, paths: projectPaths(root, project), validation };
}

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/** Saved clips (feedback/clips.json) — always an array. */
export function loadClips(paths) {
  const c = readJson(paths.clips, []);
  return Array.isArray(c) ? c : (c.clips || []);
}
