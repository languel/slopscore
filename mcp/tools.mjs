// mcp/tools.mjs — Shared MCP tool definitions and handlers for Slopscore 2.0.
// Exposes project initialization, inspection, validation, native compilation,
// audio synthesis, contact sheets, video rendering, loop automatching, clip cataloging,
// director notes, and live override mutations.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject, readJson, writeJson, loadClips } from '../kit/config-loader.mjs';
import { validateProject, RENDERERS, PARTICLE_RIGS, CAMERA_TYPES } from '../kit/project-schema.js';
import { buildNative, synthesizeAudio, renderSheet, renderVideo } from '../kit/render-pipeline.mjs';
import { autoMatchFile } from '../kit/loop-finder.mjs';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export const MCP_TOOLS = [
  {
    name: 'slopscore_init',
    description: 'Initialize a new Slopscore 2.0 project directory from a template ("default" or "willnever-reference").',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Target project directory path' },
        template: { type: 'string', enum: ['default', 'willnever-reference'], description: 'Template name (default: "default")' },
        title: { type: 'string', description: 'Optional project title override' },
        renderer: { type: 'string', enum: RENDERERS, description: 'Optional default renderer engine' },
        bpm: { type: 'number', description: 'Optional tempo in BPM' }
      },
      required: ['dir']
    }
  },
  {
    name: 'slopscore_inspect',
    description: 'Inspect a Slopscore project directory: returns normalized config, chapters, cues, clips count, notes count, and generated output artifacts.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path (defaults to cwd)' }
      }
    }
  },
  {
    name: 'slopscore_validate',
    description: 'Validate a project slopscore.config.js and report any errors or warnings.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path' }
      }
    }
  },
  {
    name: 'slopscore_build_native',
    description: 'Compile the multi-threaded Objective-C/CoreGraphics/Metal native renderer into out/native-render.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path' }
      }
    }
  },
  {
    name: 'slopscore_synthesize_audio',
    description: 'Synthesize or process the project audio score, optionally export isolated stems, and extract out/features.bin.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path' },
        stems: { type: 'boolean', description: 'Export isolated stems to out/stems/' },
        out: { type: 'string', description: 'Optional output WAV path' }
      }
    }
  },
  {
    name: 'slopscore_render_sheet',
    description: 'Render a multi-keyframe contact sheet (out/sheet.jpg) using the active or specified renderer.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path' },
        out: { type: 'string', description: 'Optional output JPEG path (default: out/sheet.jpg)' },
        times: { type: 'string', description: 'Comma-separated keyframe timestamps in seconds' },
        renderer: { type: 'string', enum: RENDERERS, description: 'Optional renderer override' }
      }
    }
  },
  {
    name: 'slopscore_render_video',
    description: 'Render a master or preview MP4 video (out/video.mp4) using any of the 7 pluggable renderers.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path' },
        out: { type: 'string', description: 'Optional output MP4 path (default: out/video.mp4)' },
        range: { type: 'string', description: 'Optional time range "start:end" in seconds (e.g. "0:15")' },
        renderer: { type: 'string', enum: RENDERERS, description: 'Optional renderer override' }
      }
    }
  },
  {
    name: 'slopscore_loop_automatch',
    description: 'Scan a video/animation asset for the lowest-MSE seamless loop seam around (inSec, outSec).',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path' },
        asset: { type: 'string', description: 'Asset filename inside assets/ or absolute path' },
        inSec: { type: 'number', description: 'Starting IN timestamp in seconds' },
        outSec: { type: 'number', description: 'Starting candidate OUT timestamp in seconds' },
        window: { type: 'number', description: 'Search window in seconds around in/out (default: 1.5)' }
      },
      required: ['asset']
    }
  },
  {
    name: 'slopscore_list_clips',
    description: 'List all curated loops in the project Clip Library (feedback/clips.json).',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path' }
      }
    }
  },
  {
    name: 'slopscore_save_clip',
    description: 'Save or update a curated loop in the project Clip Library (feedback/clips.json).',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path' },
        id: { type: 'string', description: 'Optional clip ID (generated if omitted)' },
        name: { type: 'string', description: 'Clip display name' },
        sourceId: { type: 'string', description: 'Source asset filename' },
        inSec: { type: 'number', description: 'Loop IN point in seconds' },
        outSec: { type: 'number', description: 'Loop OUT point in seconds' },
        mode: { type: 'string', enum: ['loop', 'pingpong', 'reverse', 'once'] },
        speed: { type: 'number', description: 'Playback speed multiplier (default: 1.0)' },
        tags: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' }
      },
      required: ['name', 'sourceId', 'inSec', 'outSec']
    }
  },
  {
    name: 'slopscore_list_notes',
    description: 'List director annotations and feedback notes (feedback/notes.json).',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path' }
      }
    }
  },
  {
    name: 'slopscore_add_note',
    description: 'Add a bar-locked directorial note to feedback/notes.json.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path' },
        title: { type: 'string', description: 'Short note title' },
        text: { type: 'string', description: 'Detailed feedback or direction' },
        timeStart: { type: 'number', description: 'Start timestamp in seconds' },
        timeEnd: { type: 'number', description: 'End timestamp in seconds' },
        bar: { type: 'number', description: 'Optional 1-based musical bar (converted to timeStart if timeStart omitted)' },
        target: { type: 'string', description: 'Target chapter or subsystem' },
        tags: { type: 'array', items: { type: 'string' } }
      },
      required: ['title', 'text']
    }
  },
  {
    name: 'slopscore_set_override',
    description: 'Update live shader, camera, or chapter overrides in feedback/overrides.json.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path' },
        shaders: { type: 'object', description: 'Shader parameter overrides (e.g. { chromaticAberration: 0.45, crtScanlines: true })' },
        camera: { type: 'object', description: 'Camera parameter overrides (e.g. { dist: 12.5, fov: 62 })' },
        chapterId: { type: 'string', description: 'Optional chapter ID to scope overrides (`ch-0`, etc.)' },
        chapterPatch: { type: 'object', description: 'Chapter-level override (e.g. { clipLoopId, particleRig })' }
      }
    }
  }
];

export async function scaffoldProject({ dir, template = 'default', title, renderer, bpm }) {
  const targetDir = path.resolve(dir);
  const tplName = template === 'reference-willnever' ? 'willnever-reference' : template;
  const tplDir = path.join(REPO_ROOT, 'templates', tplName);
  if (!fs.existsSync(tplDir)) {
    throw new Error(`Template "${template}" not found at ${tplDir}`);
  }
  fs.mkdirSync(targetDir, { recursive: true });
  copyRecursive(tplDir, targetDir);

  const cfgPath = path.join(targetDir, 'slopscore.config.js');
  if (fs.existsSync(cfgPath) && (title || renderer || bpm)) {
    let text = fs.readFileSync(cfgPath, 'utf8');
    if (title) text = text.replace(/title:\s*['"][^'"]*['"]/, `title: ${JSON.stringify(title)}`);
    if (renderer) text = text.replace(/renderer:\s*['"][^'"]*['"]/, `renderer: ${JSON.stringify(renderer)}`);
    if (bpm) text = text.replace(/bpm:\s*\d+(\.\d+)?/, `bpm: ${Number(bpm)}`);
    fs.writeFileSync(cfgPath, text, 'utf8');
  }
  return { dir: targetDir, configFile: cfgPath, template: tplName };
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (entry === 'node_modules' || entry === '.DS_Store') continue;
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else if (!fs.existsSync(dest)) {
    fs.copyFileSync(src, dest);
  }
}

export async function executeMcpTool(name, args = {}) {
  const dir = args.dir || process.cwd();
  switch (name) {
    case 'slopscore_init': {
      return await scaffoldProject(args);
    }
    case 'slopscore_inspect': {
      const loaded = await loadProject(dir);
      const { project, paths, validation } = loaded;
      const clips = loadClips(paths);
      const notes = readJson(paths.notes, []);
      return {
        root: loaded.root,
        configFile: loaded.configFile,
        title: project.title,
        version: project.version,
        renderer: project.renderer,
        resolution: project.resolution,
        fps: project.fps,
        audio: project.audio,
        chaptersCount: project.chapters.length,
        chapters: project.chapters.map(c => ({
          id: c.id, name: c.name, startBar: c.startBar, endBar: c.endBar,
          start: +c.start.toFixed(2), end: +c.end.toFixed(2),
          particleRig: c.particleRig, clipLoopId: c.clipLoopId
        })),
        clipsCount: clips.length,
        notesCount: notes.length,
        artifacts: {
          score: fs.existsSync(paths.outScore),
          features: fs.existsSync(paths.features),
          bank: fs.existsSync(paths.bank),
          nativeBin: fs.existsSync(paths.nativeBin),
          sheet: fs.existsSync(paths.sheet),
          video: fs.existsSync(paths.video)
        },
        validation
      };
    }
    case 'slopscore_validate': {
      const loaded = await loadProject(dir);
      return { root: loaded.root, ...validateProject(loaded.project) };
    }
    case 'slopscore_build_native': {
      const loaded = await loadProject(dir);
      const bin = buildNative(loaded);
      return { success: true, binary: bin };
    }
    case 'slopscore_synthesize_audio': {
      const loaded = await loadProject(dir);
      return await synthesizeAudio(loaded, { stems: !!args.stems, outPath: args.out || null });
    }
    case 'slopscore_render_sheet': {
      const loaded = await loadProject(dir);
      return await renderSheet(loaded, { outPath: args.out || null, times: args.times || null, renderer: args.renderer || null });
    }
    case 'slopscore_render_video': {
      const loaded = await loadProject(dir);
      return await renderVideo(loaded, { outPath: args.out || null, range: args.range || null, renderer: args.renderer || null });
    }
    case 'slopscore_loop_automatch': {
      const loaded = await loadProject(dir);
      const candidatePath = path.isAbsolute(args.asset)
        ? args.asset
        : fs.existsSync(path.join(loaded.paths.assets, args.asset))
          ? path.join(loaded.paths.assets, args.asset)
          : path.resolve(loaded.root, args.asset);
      return await autoMatchFile(candidatePath, {
        inSec: args.inSec ?? 0,
        outSec: args.outSec ?? 3,
        window: args.window ?? 1.5
      });
    }
    case 'slopscore_list_clips': {
      const loaded = await loadProject(dir);
      return { clips: loadClips(loaded.paths) };
    }
    case 'slopscore_save_clip': {
      const loaded = await loadProject(dir);
      const clips = loadClips(loaded.paths);
      const barSec = (60 / loaded.project.audio.bpm) * 4;
      const clip = {
        id: args.id || `clip-${Date.now().toString(36)}`,
        name: args.name,
        sourceId: args.sourceId,
        inSec: Number(args.inSec),
        outSec: Number(args.outSec),
        inBar: +(1 + Number(args.inSec) / barSec).toFixed(2),
        outBar: +(1 + Number(args.outSec) / barSec).toFixed(2),
        mode: args.mode || 'loop',
        speed: args.speed ?? 1.0,
        tags: args.tags || [],
        notes: args.notes || '',
        updatedAt: new Date().toISOString()
      };
      const idx = clips.findIndex(c => c.id === clip.id);
      if (idx >= 0) clips[idx] = { ...clips[idx], ...clip };
      else clips.unshift({ ...clip, createdAt: clip.updatedAt });
      writeJson(loaded.paths.clips, clips);
      return { success: true, clip };
    }
    case 'slopscore_list_notes': {
      const loaded = await loadProject(dir);
      return { notes: readJson(loaded.paths.notes, []) };
    }
    case 'slopscore_add_note': {
      const loaded = await loadProject(dir);
      const notes = readJson(loaded.paths.notes, []);
      const barSec = (60 / loaded.project.audio.bpm) * 4;
      const timeStart = args.timeStart != null
        ? Number(args.timeStart)
        : args.bar != null
          ? (Number(args.bar) - 1) * barSec
          : 0;
      const note = {
        id: `note-${Date.now().toString(36)}`,
        title: args.title,
        text: args.text,
        timeStart,
        timeEnd: args.timeEnd != null ? Number(args.timeEnd) : timeStart,
        target: args.target || 'General',
        tags: args.tags || [],
        status: 'open',
        version: loaded.project.version || 'v1.0',
        createdAt: new Date().toISOString()
      };
      notes.push(note);
      writeJson(loaded.paths.notes, notes);
      return { success: true, note };
    }
    case 'slopscore_set_override': {
      const loaded = await loadProject(dir);
      const ovPath = path.join(loaded.paths.feedback, 'overrides.json');
      const cur = readJson(ovPath, { shaders: {}, camera: {}, chapters: {} });
      if (args.shaders) cur.shaders = { ...(cur.shaders || {}), ...args.shaders };
      if (args.camera) cur.camera = { ...(cur.camera || {}), ...args.camera };
      if (args.chapterId && args.chapterPatch) {
        cur.chapters = cur.chapters || {};
        cur.chapters[args.chapterId] = { ...(cur.chapters[args.chapterId] || {}), ...args.chapterPatch };
      }
      writeJson(ovPath, cur);
      return { success: true, overrides: cur };
    }
    default:
      throw new Error(`Unknown MCP tool: ${name}`);
  }
}
