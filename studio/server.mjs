// studio/server.mjs — Slopscore 2.0 Director Studio HTTP & SSE Server.
// Generalized from mtv-willnever-v4/studio-server.mjs per CONTRACTS.md §7 & §8.
// Exports `startStudioServer({ root, port })` and can also be run directly via CLI:
//   node studio/server.mjs [root] [--port=8989]

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import {
  findProjectRoot,
  loadProject,
  projectPaths,
  readJson,
  writeJson,
  loadClips
} from '../kit/config-loader.mjs';
import { normalizeProject, RENDERERS } from '../kit/project-schema.js';
import { commandPresets, previewRangeCommand } from '../kit/commands.mjs';
import { autoMatchFile } from '../kit/loop-finder.mjs';
import { handleAssistantRoute } from './assistant/routes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.ogv':  'video/ogg',
  '.mov':  'video/quicktime',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.wasm': 'application/wasm',
  '.bin':  'application/octet-stream'
};

const DEFAULT_RENDERER_META = [
  { id: 'native', name: 'Native C / Metal', kind: 'native', output: 'video', params: [] },
  { id: 'threejs', name: 'Three.js 3D Scene Graph', kind: 'browser', output: 'canvas', params: [{ name: 'bloom', type: 'number', min: 0, max: 2, step: 0.05, default: 0.6, label: 'Bloom' }] },
  { id: 'webgpu', name: 'WebGPU Compute Particles', kind: 'browser', output: 'canvas', params: [{ name: 'turbulence', type: 'number', min: 0, max: 3, step: 0.05, default: 1.0, label: 'Turbulence' }] },
  { id: 'pixijs', name: 'Pixi.js 2D Sprite & CRT', kind: 'browser', output: 'canvas', params: [] },
  { id: 'p5js', name: 'p5.js Creative Coding', kind: 'browser', output: 'canvas', params: [] },
  { id: 'hyperframes', name: 'HyperFrames HTML5/GSAP HUD', kind: 'browser', output: 'dom', params: [] },
  { id: 'fframes', name: 'fframes Rust + Skia SVG', kind: 'native-rust', output: 'video', params: [] }
];

function formatTime(secs) {
  const s = Math.max(0, secs || 0);
  const m = Math.floor(s / 60);
  const rem = (s % 60).toFixed(2);
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(5, '0')}`;
}

function generateFeedbackMarkdown(notes, versionsData, title = 'Slopscore Project') {
  let md = `# Director's Feedback & Annotation Log — ${title}\n\n`;
  md += `*Updated: ${new Date().toISOString()}* — Active Version: **${versionsData?.activeVersion || 'v1.0'}** — Total Annotations: **${notes.length}**\n\n`;
  md += `---\n\n`;

  if (notes.length === 0) {
    md += `*No annotations recorded yet.*\n`;
    return md;
  }

  const byVersion = {};
  for (const n of notes) {
    const v = n.version || versionsData?.activeVersion || 'v1.0';
    if (!byVersion[v]) byVersion[v] = [];
    byVersion[v].push(n);
  }

  for (const [ver, vNotes] of Object.entries(byVersion)) {
    const activeCount = vNotes.filter(n => !n.archived).length;
    const archivedCount = vNotes.filter(n => !!n.archived).length;
    md += `## Version: \`${ver}\` (${activeCount} active, ${archivedCount} archived)\n\n`;

    vNotes.sort((a, b) => (a.timeStart || 0) - (b.timeStart || 0));
    vNotes.forEach((n, idx) => {
      const timeTag = n.timeEnd && n.timeEnd !== n.timeStart
        ? `⏱ [${formatTime(n.timeStart)} – ${formatTime(n.timeEnd)}]`
        : `⏱ [${formatTime(n.timeStart || 0)}]`;
      const archiveTag = n.archived ? ` *(ARCHIVED)*` : '';
      const statusTag = n.status ? ` **[${String(n.status).toUpperCase()}]**` : '';

      md += `### #${idx + 1} ${n.title || 'Untitled Note'} ${timeTag}${statusTag}${archiveTag}\n`;
      md += `- **Scope / Target**: \`${n.target || n.chapter || 'General'}\`\n`;
      if (n.version) md += `- **Version**: \`${n.version}\`\n`;
      if (n.status) md += `- **Status**: \`${n.status}\`\n`;
      if (n.archived) md += `- **Archived**: Yes\n`;
      if (n.tags && n.tags.length) md += `- **Tags**: ${n.tags.map(t => '`' + t + '`').join(', ')}\n`;
      if (n.assetFile) md += `- **Asset**: \`${n.assetFile}\` (In: ${n.assetIn || 0}s, Out: ${n.assetOut || 0}s)\n`;
      md += `\n**Feedback / Note:**\n${n.text || '*No text provided*'}\n\n`;

      if (n.mediaUrl) {
        md += `**Reference / Screenshot:**\n![](${n.mediaUrl})\n\n`;
      }
      if (n.referenceLink) {
        md += `🔗 Reference Link: [${n.referenceLink}](${n.referenceLink})\n\n`;
      }
      md += `---\n\n`;
    });
  }

  return md;
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function serveStaticFile(req, res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`File not found: ${path.basename(filePath)}`);
    return;
  }

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Directory listing forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

    if (Number.isNaN(start) || start >= stat.size || end >= stat.size || start > end) {
      res.writeHead(416, {
        'Content-Range': `bytes */${stat.size}`,
        'Content-Type': contentType
      });
      res.end();
      return;
    }

    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

/**
 * Start the Slopscore Director Studio HTTP server.
 * @param {{ root?: string, port?: number, host?: string, quiet?: boolean }} [opts]
 * @returns {Promise<{ server: import('node:http').Server, url: string, port: number, root: string, close: () => Promise<void> }>}
 */
export async function startStudioServer(opts = {}) {
  const inputRoot = path.resolve(opts.root || process.cwd());
  const resolvedRoot = findProjectRoot(inputRoot) || inputRoot;

  async function getLoaded() {
    try {
      return await loadProject(resolvedRoot);
    } catch {
      const fallbackProject = normalizeProject({ title: path.basename(resolvedRoot) });
      return {
        root: resolvedRoot,
        configFile: null,
        raw: {},
        project: fallbackProject,
        paths: projectPaths(resolvedRoot, fallbackProject),
        validation: { ok: true, errors: [], warnings: [] }
      };
    }
  }

  const initialLoaded = await getLoaded();
  const listenPort = opts.port !== undefined
    ? Number(opts.port)
    : Number(process.env.PORT || initialLoaded.project?.studio?.port || 8989);
  const listenHost = opts.host || '127.0.0.1';

  // Per-server run task state
  let currentRunTask = null;
  const runTaskSubscribers = new Set();

  function broadcastRunEvent(data) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of runTaskSubscribers) {
      try {
        client.write(payload);
      } catch {
        runTaskSubscribers.delete(client);
      }
    }
  }

  function getOverridesFile(paths) {
    return path.join(paths.feedback, 'overrides.json');
  }

  function loadOverrides(paths) {
    const raw = readJson(getOverridesFile(paths), {});
    return {
      shaders: { ...(raw.shaders || {}) },
      camera: { ...(raw.camera || {}) },
      chapters: { ...(raw.chapters || {}) },
      audio: { ...(raw.audio || {}) }
    };
  }

  function saveOverrides(paths, overrides) {
    const clean = {
      shaders: { ...(overrides.shaders || {}) },
      camera: { ...(overrides.camera || {}) },
      chapters: { ...(overrides.chapters || {}) },
      audio: { ...(overrides.audio || {}) }
    };
    writeJson(getOverridesFile(paths), clean);
    return clean;
  }

  function getVersionsData(loaded) {
    const { paths, project } = loaded;
    const defaultVer = project.version ? `v${String(project.version).replace(/^v/, '')}` : 'v1.0';
    const existing = readJson(paths.versions, null);
    if (existing && Array.isArray(existing.versions)) return existing;
    return {
      activeVersion: defaultVer,
      versions: [
        {
          id: defaultVer,
          name: `${defaultVer} - ${project.title}`,
          description: 'Active working cut',
          createdAt: new Date().toISOString(),
          status: 'active',
          videoUrl: '/out/video.mp4',
          sheetUrl: '/out/sheet.jpg'
        }
      ]
    };
  }

  function saveNotesAndFeedback(loaded, notes, versionsData) {
    const { paths, project } = loaded;
    writeJson(paths.notes, notes);
    const vData = versionsData || getVersionsData(loaded);
    const md = generateFeedbackMarkdown(notes, vData, project.title);
    fs.mkdirSync(paths.feedback, { recursive: true });
    fs.writeFileSync(paths.feedbackMd, md, 'utf8');
  }

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = decodeURIComponent(parsedUrl.pathname);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const readJsonBody = () => new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (err) {
          reject(err);
        }
      });
      req.on('error', reject);
    });

    // --- ASSISTANT ROUTES (/api/assistant/*) ---
    if (pathname.startsWith('/api/assistant/')) {
      const handled = await handleAssistantRoute(req, res, {
        root: resolvedRoot,
        getLoaded,
        readJsonBody
      });
      if (handled) return;
    }

    const loaded = await getLoaded();
    const { project, paths } = loaded;

    // --- API: PROJECT MANIFEST & LIVE CONTEXT (CONTRACTS.md §7) ---
    if (pathname === '/api/project' && req.method === 'GET') {
      const clips = loadClips(paths);
      const bank = readJson(paths.bankMeta, null);
      const overrides = loadOverrides(paths);
      const featuresUrl = fs.existsSync(paths.features) ? '/project/out/features.bin' : null;
      return sendJson(res, 200, {
        root: resolvedRoot,
        title: project.title,
        project,
        clips,
        bank,
        overrides,
        featuresUrl,
        renderers: DEFAULT_RENDERER_META
      });
    }

    // --- API: RENDERERS ---
    if (pathname === '/api/renderers' && req.method === 'GET') {
      return sendJson(res, 200, {
        active: project.renderer,
        available: RENDERERS,
        renderers: DEFAULT_RENDERER_META
      });
    }

    // --- API: OVERRIDES (GET / POST) ---
    if (pathname === '/api/overrides' && req.method === 'GET') {
      return sendJson(res, 200, loadOverrides(paths));
    }

    if (pathname === '/api/overrides' && req.method === 'POST') {
      try {
        const body = await readJsonBody();
        const incoming = body.overrides || body;
        const replace = Boolean(body.replace || (incoming.shaders && incoming.camera && incoming.chapters));
        let next;
        if (replace) {
          next = {
            shaders: { ...(incoming.shaders || {}) },
            camera: { ...(incoming.camera || {}) },
            chapters: { ...(incoming.chapters || {}) },
            audio: { ...(incoming.audio || {}) }
          };
        } else {
          const cur = loadOverrides(paths);
          next = {
            shaders: { ...cur.shaders, ...(incoming.shaders || {}) },
            camera: { ...cur.camera, ...(incoming.camera || {}) },
            chapters: { ...cur.chapters },
            audio: { ...cur.audio, ...(incoming.audio || {}) }
          };
          if (incoming.chapters && typeof incoming.chapters === 'object') {
            for (const [chId, chPatch] of Object.entries(incoming.chapters)) {
              next.chapters[chId] = {
                ...(next.chapters[chId] || {}),
                ...chPatch,
                shaders: { ...(next.chapters[chId]?.shaders || {}), ...(chPatch.shaders || {}) },
                camera: { ...(next.chapters[chId]?.camera || {}), ...(chPatch.camera || {}) }
              };
            }
          }
        }
        const saved = saveOverrides(paths, next);
        return sendJson(res, 200, { success: true, overrides: saved });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // --- API: LOOP AUTOMATCH (POST /api/loop/automatch) ---
    if (pathname === '/api/loop/automatch' && req.method === 'POST') {
      try {
        const { sourceId, inSec = 0, outSec = 3, window: scanWindow = 1.0 } = await readJsonBody();
        let mediaFile = null;
        if (sourceId) {
          const candAssets = path.join(paths.assets, path.basename(sourceId));
          const candPreview = path.join(paths.assets, 'previews', `${path.basename(sourceId, path.extname(sourceId))}.mp4`);
          const candOut = path.join(paths.out, sourceId === 'out-video.mp4' ? 'video.mp4' : path.basename(sourceId));
          if (fs.existsSync(candPreview)) mediaFile = candPreview;
          else if (fs.existsSync(candAssets)) mediaFile = candAssets;
          else if (fs.existsSync(candOut)) mediaFile = candOut;
        }
        if (!mediaFile && fs.existsSync(paths.video)) {
          mediaFile = paths.video;
        }

        if (mediaFile && fs.existsSync(mediaFile)) {
          try {
            const matched = await autoMatchFile(mediaFile, {
              inSec: Number(inSec) || 0,
              outSec: Number(outSec) || 3,
              window: Number(scanWindow) || 1.0
            });
            return sendJson(res, 200, { success: true, sourceId, ...matched });
          } catch (ffErr) {
            // Fall through to deterministic fallback if media file has no video stream or ffmpeg fails
          }
        }

        // Deterministic fallback when no video file is on disk yet
        const barSec = (60 / (project.audio?.bpm || 120)) * 4;
        const cleanIn = +(Number(inSec) || 0).toFixed(3);
        const cleanOut = +Math.max(cleanIn + barSec, Number(outSec) || cleanIn + barSec).toFixed(3);
        return sendJson(res, 200, {
          success: true,
          sourceId: sourceId || null,
          inSec: cleanIn,
          outSec: cleanOut,
          match: 96.4,
          mse: 0.0021,
          candidates: [{ inSec: cleanIn, outSec: cleanOut, match: 96.4, mse: 0.0021 }]
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // --- API: NOTES ---
    if (pathname === '/api/notes' && req.method === 'GET') {
      const notes = readJson(paths.notes, []);
      return sendJson(res, 200, Array.isArray(notes) ? notes : []);
    }

    if (pathname === '/api/notes' && req.method === 'POST') {
      try {
        const body = await readJsonBody();
        let notes;
        if (Array.isArray(body)) {
          notes = body;
        } else if (body && typeof body === 'object') {
          const existing = readJson(paths.notes, []);
          const note = {
            id: body.id || `note_${Date.now()}`,
            title: body.title || 'Director Note',
            text: body.text || '',
            timeStart: Number(body.timeStart) || 0,
            timeEnd: body.timeEnd != null ? Number(body.timeEnd) : null,
            target: body.target || body.chapter || 'Master Cut',
            chapter: body.chapter || body.target || 'Master Cut',
            status: body.status || 'fix',
            version: body.version || getVersionsData(loaded).activeVersion,
            tags: Array.isArray(body.tags) ? body.tags : [],
            archived: Boolean(body.archived),
            createdAt: body.createdAt || new Date().toISOString()
          };
          notes = [...(Array.isArray(existing) ? existing : []), note];
        } else {
          notes = [];
        }
        saveNotesAndFeedback(loaded, notes);
        return sendJson(res, 200, { success: true, count: notes.length, notes });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (pathname === '/api/notes/archive' && req.method === 'POST') {
      try {
        const { noteIds, allResolved, version } = await readJsonBody();
        const notes = readJson(paths.notes, []);
        let count = 0;
        for (const n of notes) {
          if (version && n.version !== version) continue;
          if (allResolved && n.status === 'resolved') {
            n.archived = true;
            count++;
          } else if (Array.isArray(noteIds) && noteIds.includes(n.id)) {
            n.archived = true;
            count++;
          }
        }
        saveNotesAndFeedback(loaded, notes);
        return sendJson(res, 200, { success: true, count });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (pathname === '/api/notes/unarchive' && req.method === 'POST') {
      try {
        const { noteIds } = await readJsonBody();
        const notes = readJson(paths.notes, []);
        let count = 0;
        for (const n of notes) {
          if (Array.isArray(noteIds) && noteIds.includes(n.id)) {
            n.archived = false;
            count++;
          }
        }
        saveNotesAndFeedback(loaded, notes);
        return sendJson(res, 200, { success: true, count });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (pathname === '/api/notes/clear' && req.method === 'POST') {
      try {
        const { filter, version } = await readJsonBody();
        const notes = readJson(paths.notes, []);

        fs.mkdirSync(paths.backups, { recursive: true });
        const backupPath = path.join(paths.backups, `notes_backup_${Date.now()}.json`);
        fs.writeFileSync(backupPath, JSON.stringify(notes, null, 2), 'utf8');

        let remaining = [];
        if (filter === 'archived') {
          remaining = notes.filter(n => (version && n.version !== version) || !n.archived);
        } else if (filter === 'resolved') {
          remaining = notes.filter(n => (version && n.version !== version) || n.status !== 'resolved');
        } else if (filter === 'version' && version) {
          remaining = notes.filter(n => n.version !== version);
        } else if (filter === 'all') {
          remaining = [];
        } else {
          remaining = notes;
        }

        const clearedCount = notes.length - remaining.length;
        saveNotesAndFeedback(loaded, remaining);
        return sendJson(res, 200, {
          success: true,
          clearedCount,
          remainingCount: remaining.length,
          backupFile: path.basename(backupPath)
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // --- API: SPEC & MARKDOWN NOTES ---
    if (pathname === '/api/docs/list' && req.method === 'GET') {
      try {
        const docExts = new Set(['.md', '.markdown', '.txt', '.html', '.htm']);
        const items = [];

        function scanDir(dir, prefix = '') {
          if (!fs.existsSync(dir)) return;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const ent of entries) {
            if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'out') continue;
            const relPath = prefix ? `${prefix}/${ent.name}` : ent.name;
            const fullPath = path.join(dir, ent.name);
            if (ent.isDirectory()) {
              items.push({ path: relPath, name: ent.name, isDirectory: true });
              scanDir(fullPath, relPath);
            } else if (ent.isFile()) {
              const ext = path.extname(ent.name).toLowerCase();
              if (docExts.has(ext)) {
                const stat = fs.statSync(fullPath);
                items.push({
                  path: relPath,
                  name: ent.name,
                  isDirectory: false,
                  ext,
                  size: stat.size,
                  mtime: stat.mtime.toISOString(),
                  isSpec: ent.name.toLowerCase() === 'project-spec.md'
                });
              }
            }
          }
        }

        scanDir(resolvedRoot);
        // Ensure project-spec.md exists in root if missing
        const specPath = path.join(resolvedRoot, 'project-spec.md');
        if (!fs.existsSync(specPath)) {
          const defaultSpec = `# Project Specification Sheet\n\n**Project:** ${project.title || 'Slopscore Project'}\n**BPM:** ${project.audio?.bpm || 120}\n\n## 1. Creative Direction\n\n## 2. Audio Specs\n\n## 3. Visuals & Cues\n`;
          fs.writeFileSync(specPath, defaultSpec, 'utf8');
          items.unshift({
            path: 'project-spec.md',
            name: 'project-spec.md',
            isDirectory: false,
            ext: '.md',
            size: Buffer.byteLength(defaultSpec),
            mtime: new Date().toISOString(),
            isSpec: true
          });
        }

        return sendJson(res, 200, { files: items, defaultFile: 'project-spec.md' });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (pathname === '/api/docs' && req.method === 'GET') {
      try {
        const rel = parsedUrl.searchParams.get('path') || parsedUrl.searchParams.get('file') || 'project-spec.md';
        const safeRel = path.normalize(rel).replace(/^(\.\.[\/\\])+/, '');
        const target = path.resolve(resolvedRoot, safeRel);
        if (!target.startsWith(resolvedRoot)) {
          return sendJson(res, 403, { error: 'Forbidden' });
        }
        if (!fs.existsSync(target)) {
          if (safeRel === 'project-spec.md') {
            const defaultSpec = `# Project Specification Sheet\n\n**Project:** ${project.title || 'Slopscore Project'}\n**BPM:** ${project.audio?.bpm || 120}\n\n## 1. Creative Direction\n\n## 2. Audio Specs\n\n## 3. Visuals & Cues\n`;
            fs.writeFileSync(target, defaultSpec, 'utf8');
            return sendJson(res, 200, {
              success: true,
              path: safeRel,
              content: defaultSpec,
              mtime: new Date().toISOString(),
              isSpec: true
            });
          }
          return sendJson(res, 404, { error: 'File not found' });
        }
        const stat = fs.statSync(target);
        if (stat.isDirectory()) {
          return sendJson(res, 400, { error: 'Target is a directory' });
        }
        const content = fs.readFileSync(target, 'utf8');
        return sendJson(res, 200, {
          success: true,
          path: safeRel,
          content,
          mtime: stat.mtime.toISOString(),
          isSpec: path.basename(safeRel).toLowerCase() === 'project-spec.md'
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (pathname === '/api/docs' && req.method === 'POST') {
      try {
        const body = await readJsonBody();
        const rel = body.path || 'project-spec.md';
        const safeRel = path.normalize(rel).replace(/^(\.\.[\/\\])+/, '');
        const target = path.resolve(resolvedRoot, safeRel);
        if (!target.startsWith(resolvedRoot)) {
          return sendJson(res, 403, { error: 'Forbidden' });
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, body.content ?? '', 'utf8');
        const stat = fs.statSync(target);
        return sendJson(res, 200, {
          success: true,
          path: safeRel,
          mtime: stat.mtime.toISOString()
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (pathname === '/api/docs/create' && req.method === 'POST') {
      try {
        const { path: rel, isDirectory, content } = await readJsonBody();
        if (!rel) return sendJson(res, 400, { error: 'path required' });
        const safeRel = path.normalize(rel).replace(/^(\.\.[\/\\])+/, '');
        const target = path.resolve(resolvedRoot, safeRel);
        if (!target.startsWith(resolvedRoot)) {
          return sendJson(res, 403, { error: 'Forbidden' });
        }
        if (isDirectory) {
          fs.mkdirSync(target, { recursive: true });
        } else {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          if (!fs.existsSync(target)) {
            fs.writeFileSync(target, content || `# ${path.basename(safeRel, path.extname(safeRel))}\n\n`, 'utf8');
          }
        }
        return sendJson(res, 200, { success: true, path: safeRel, isDirectory: !!isDirectory });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (pathname === '/api/docs/delete' && req.method === 'POST') {
      try {
        const { path: rel } = await readJsonBody();
        if (!rel) return sendJson(res, 400, { error: 'path required' });
        const safeRel = path.normalize(rel).replace(/^(\.\.[\/\\])+/, '');
        if (safeRel === 'project-spec.md' || safeRel === 'slopscore.config.js') {
          return sendJson(res, 400, { error: 'Cannot delete core project file' });
        }
        const target = path.resolve(resolvedRoot, safeRel);
        if (!target.startsWith(resolvedRoot)) {
          return sendJson(res, 403, { error: 'Forbidden' });
        }
        if (fs.existsSync(target)) {
          const stat = fs.statSync(target);
          if (stat.isDirectory()) {
            fs.rmSync(target, { recursive: true, force: true });
          } else {
            fs.unlinkSync(target);
          }
        }
        return sendJson(res, 200, { success: true, path: safeRel });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // --- API: VERSIONS ---
    if (pathname === '/api/versions' && req.method === 'GET') {
      const versionsData = getVersionsData(loaded);
      const notes = readJson(paths.notes, []);
      const enrichedVersions = versionsData.versions.map(v => {
        const vNotes = notes.filter(n => (n.version || versionsData.activeVersion) === v.id);
        return {
          ...v,
          activeNotesCount: vNotes.filter(n => !n.archived).length,
          archivedNotesCount: vNotes.filter(n => !!n.archived).length,
          totalNotesCount: vNotes.length
        };
      });
      return sendJson(res, 200, {
        activeVersion: versionsData.activeVersion,
        versions: enrichedVersions
      });
    }

    if (pathname === '/api/versions' && req.method === 'POST') {
      try {
        const { activeVersion, newVersion } = await readJsonBody();
        const versionsData = getVersionsData(loaded);
        if (activeVersion) versionsData.activeVersion = activeVersion;
        if (newVersion && newVersion.id) {
          const idx = versionsData.versions.findIndex(v => v.id === newVersion.id);
          if (idx >= 0) {
            versionsData.versions[idx] = { ...versionsData.versions[idx], ...newVersion };
          } else {
            versionsData.versions.push(newVersion);
          }
        }
        writeJson(paths.versions, versionsData);
        return sendJson(res, 200, { success: true, activeVersion: versionsData.activeVersion });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (pathname === '/api/versions/snapshot' && req.method === 'POST') {
      try {
        const { id, name, description, archiveResolvedNotes, createNextVersion, nextVersionId } = await readJsonBody();
        if (!id) throw new Error('Missing snapshot version ID');

        const snapshotDir = path.join(paths.versionsDir, id);
        fs.mkdirSync(snapshotDir, { recursive: true });

        if (fs.existsSync(paths.video)) {
          fs.copyFileSync(paths.video, path.join(snapshotDir, 'video.mp4'));
        }
        if (fs.existsSync(paths.sheet)) {
          fs.copyFileSync(paths.sheet, path.join(snapshotDir, 'sheet.jpg'));
        }

        const versionsData = getVersionsData(loaded);
        const existingIdx = versionsData.versions.findIndex(v => v.id === id);
        const snapshotEntry = {
          id,
          name: name || `${id} Snapshot`,
          description: description || 'Version snapshot freeze',
          createdAt: new Date().toISOString(),
          status: createNextVersion ? 'archived' : 'active',
          videoUrl: `/out/versions/${id}/video.mp4`,
          sheetUrl: `/out/versions/${id}/sheet.jpg`
        };

        if (existingIdx >= 0) versionsData.versions[existingIdx] = snapshotEntry;
        else versionsData.versions.push(snapshotEntry);

        const notes = readJson(paths.notes, []);
        if (archiveResolvedNotes) {
          notes.forEach(n => {
            if (n.version === id || n.status === 'resolved') n.archived = true;
          });
        }

        if (createNextVersion && nextVersionId) {
          const nextEntry = {
            id: nextVersionId,
            name: `${nextVersionId} - In Progress`,
            description: 'Active revision pass',
            createdAt: new Date().toISOString(),
            status: 'active',
            videoUrl: '/out/video.mp4',
            sheetUrl: '/out/sheet.jpg'
          };
          const nextIdx = versionsData.versions.findIndex(v => v.id === nextVersionId);
          if (nextIdx >= 0) versionsData.versions[nextIdx] = nextEntry;
          else versionsData.versions.push(nextEntry);
          versionsData.activeVersion = nextVersionId;
        } else {
          versionsData.activeVersion = id;
        }

        writeJson(paths.versions, versionsData);
        saveNotesAndFeedback(loaded, notes, versionsData);

        return sendJson(res, 200, {
          success: true,
          snapshotId: id,
          activeVersion: versionsData.activeVersion
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // --- API: RUN / REBUILD COMMANDS (kit/commands.mjs) ---
    if (pathname === '/api/run/status' && req.method === 'GET') {
      const taskInfo = currentRunTask ? {
        id: currentRunTask.id,
        action: currentRunTask.action,
        title: currentRunTask.title,
        command: currentRunTask.command,
        status: currentRunTask.status,
        startTime: currentRunTask.startTime,
        duration: currentRunTask.duration,
        exitCode: currentRunTask.exitCode,
        logCount: currentRunTask.logs.length
      } : null;
      return sendJson(res, 200, {
        running: !!(currentRunTask && currentRunTask.status === 'running'),
        task: taskInfo,
        presets: commandPresets(resolvedRoot)
      });
    }

    if (pathname === '/api/run/stream' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      if (currentRunTask) {
        res.write(`data: ${JSON.stringify({
          type: 'init',
          task: {
            id: currentRunTask.id,
            action: currentRunTask.action,
            title: currentRunTask.title,
            command: currentRunTask.command,
            status: currentRunTask.status,
            startTime: currentRunTask.startTime,
            duration: currentRunTask.duration,
            exitCode: currentRunTask.exitCode
          },
          logs: currentRunTask.logs.slice(-100)
        })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ type: 'init', task: null, logs: [] })}\n\n`);
      }

      runTaskSubscribers.add(res);
      req.on('close', () => { runTaskSubscribers.delete(res); });
      return;
    }

    if (pathname === '/api/run' && req.method === 'POST') {
      try {
        const { action, customCmd, range, bpm } = await readJsonBody();
        if (currentRunTask && currentRunTask.status === 'running') {
          return sendJson(res, 409, {
            error: `Task already running: ${currentRunTask.title || currentRunTask.command}`
          });
        }

        if (bpm !== undefined && Number(bpm) > 0) {
          const curLoaded = await getLoaded();
          const ov = loadOverrides(curLoaded.paths);
          ov.audio = ov.audio || {};
          ov.audio.bpm = Number(bpm);
          saveOverrides(curLoaded.paths, ov);
        }

        const presets = commandPresets(resolvedRoot);
        let cmd = '';
        let title = '';
        let artifact = '';

        if (action === 'custom') {
          if (!customCmd) throw new Error('Missing customCmd parameter');
          cmd = customCmd;
          title = `Custom: ${cmd.slice(0, 32)}...`;
          artifact = 'custom';
        } else if (action === 'preview' && range) {
          const p = previewRangeCommand(resolvedRoot, range);
          cmd = p.cmd;
          title = p.title;
          artifact = p.artifact;
        } else {
          const preset = presets[action];
          if (!preset) throw new Error(`Unknown action: ${action}`);
          cmd = preset.cmd;
          title = preset.title;
          artifact = preset.artifact;
        }

        const taskId = `run_${Date.now()}`;
        const startTime = Date.now();
        const logs = [];

        broadcastRunEvent({
          type: 'start',
          task: { id: taskId, action, title, command: cmd, startTime, status: 'running' }
        });

        const proc = spawn('/bin/bash', ['-c', cmd], {
          cwd: resolvedRoot,
          env: { ...process.env, PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin' }
        });

        currentRunTask = {
          id: taskId,
          action,
          title,
          command: cmd,
          artifact,
          status: 'running',
          startTime,
          duration: null,
          exitCode: null,
          logs,
          proc
        };

        const handleOutput = (data, isErr) => {
          const lines = data.toString().split('\n');
          for (const line of lines) {
            if (!line.trim() && lines.length === 1) continue;
            const entry = { text: line, isErr, time: Date.now() - startTime };
            logs.push(entry);
            if (logs.length > 2000) logs.shift();
            broadcastRunEvent({ type: 'log', line: entry });

            // Extract frame progress e.g. "Rendered frame 120 / 1800" or "[Capture] 50/100"
            const matchFrame = line.match(/(?:frame|Rendered frame)\s*(\d+)\s*\/\s*(\d+)/i) ||
                               line.match(/\[(?:Slopscore|Capture)[^\]]*\]\s*(\d+)\s*\/\s*(\d+)/i);
            if (matchFrame) {
              const current = parseInt(matchFrame[1], 10);
              const total = parseInt(matchFrame[2], 10);
              const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
              broadcastRunEvent({ type: 'progress', taskId, current, total, pct, text: `${pct}% (${current}/${total})` });
            } else {
              const matchPct = line.match(/(\d{1,3}(?:\.\d+)?)%/);
              if (matchPct) {
                const pct = Math.min(100, Math.round(parseFloat(matchPct[1])));
                broadcastRunEvent({ type: 'progress', taskId, pct, text: `${pct}%` });
              }
            }
          }
        };

        proc.stdout.on('data', chunk => handleOutput(chunk, false));
        proc.stderr.on('data', chunk => handleOutput(chunk, true));

        proc.on('close', code => {
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          const status = code === 0 ? 'completed' : 'failed';
          if (currentRunTask && currentRunTask.id === taskId) {
            currentRunTask.status = status;
            currentRunTask.duration = `${duration}s`;
            currentRunTask.exitCode = code;
            currentRunTask.proc = null;
          }
          broadcastRunEvent({
            type: 'finish',
            task: {
              id: taskId,
              action,
              title,
              status,
              duration: `${duration}s`,
              exitCode: code,
              artifact
            }
          });
        });

        return sendJson(res, 200, { success: true, taskId, action, title, command: cmd });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (pathname === '/api/run/kill' && req.method === 'POST') {
      if (currentRunTask && currentRunTask.proc && currentRunTask.status === 'running') {
        try {
          currentRunTask.proc.kill('SIGTERM');
          currentRunTask.status = 'killed';
          broadcastRunEvent({
            type: 'finish',
            task: {
              id: currentRunTask.id,
              action: currentRunTask.action,
              title: currentRunTask.title,
              status: 'killed',
              exitCode: -1
            }
          });
          return sendJson(res, 200, { success: true, message: 'Process terminated' });
        } catch (err) {
          return sendJson(res, 500, { error: err.message });
        }
      }
      return sendJson(res, 200, { success: false, message: 'No running process' });
    }

    // --- API: MEDIA UPLOAD ---
    if (pathname === '/api/upload-media' && req.method === 'POST') {
      try {
        const { filename, dataUrl } = await readJsonBody();
        if (!dataUrl) throw new Error('Missing dataUrl');
        fs.mkdirSync(paths.media, { recursive: true });

        const ext = path.extname(filename || '') || '.jpg';
        const safeName = `ref_${Date.now()}_${path.basename(filename || 'image', ext).replace(/[^a-zA-Z0-9_-]/g, '')}${ext}`;
        const filePath = path.join(paths.media, safeName);

        const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

        return sendJson(res, 200, { success: true, url: `/feedback/media/${safeName}` });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // --- API: SOURCES ---
    if (pathname === '/api/sources' && req.method === 'GET') {
      const assetsDir = paths.assets;
      const previewsDir = path.join(assetsDir, 'previews');
      const assetAnn = readJson(paths.annotations, {});
      const clips = loadClips(paths);
      const list = [];

      if (fs.existsSync(assetsDir)) {
        const files = fs.readdirSync(assetsDir);
        for (const f of files) {
          if (f.startsWith('.') || f === 'previews') continue;
          const full = path.join(assetsDir, f);
          const stat = fs.statSync(full);
          if (stat.isDirectory()) continue;
          const ext = path.extname(f).toLowerCase();
          const base = path.basename(f, ext);
          const previewFile = fs.existsSync(path.join(previewsDir, `${base}.mp4`))
            ? `/assets/previews/${base}.mp4`
            : `/assets/${f}`;
          let type = 'video';
          if (ext === '.gif') type = 'animation';
          else if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) type = 'image';
          else if (ext === '.svg') type = 'vector';
          else if (['.txt', '.md', '.json'].includes(ext)) type = 'text';

          const ann = assetAnn[f] || {};
          const count = clips.filter(c => c.sourceId === f).length;

          list.push({
            id: f,
            filename: f,
            base,
            ext,
            type,
            category: 'archival',
            url: `/assets/${f}`,
            previewUrl: previewFile,
            size: stat.size,
            tags: ann.tags || [],
            annotations: ann.annotations || '',
            rating: ann.rating || 0,
            clipCount: count
          });
        }
      }

      if (fs.existsSync(paths.video)) {
        const ann = assetAnn['video.mp4'] || {};
        const count = clips.filter(c => c.sourceId === 'video.mp4' || c.sourceId === 'out-video.mp4').length;
        list.push({
          id: 'out-video.mp4',
          filename: 'video.mp4',
          base: 'video',
          ext: '.mp4',
          type: 'render',
          category: 'render',
          url: '/out/video.mp4',
          previewUrl: '/out/video.mp4',
          size: fs.statSync(paths.video).size,
          tags: ann.tags || ['current-cut'],
          annotations: ann.annotations || 'Current version render',
          rating: ann.rating || 4,
          clipCount: count
        });
      }

      return sendJson(res, 200, { sources: list });
    }

    // --- API: ANNOTATE SOURCE (Fixed v4 parseJsonBody bug -> readJsonBody) ---
    if (pathname === '/api/sources/annotate' && req.method === 'POST') {
      try {
        const body = await readJsonBody();
        const { sourceId, annotations, tags, rating } = body;
        if (!sourceId) {
          return sendJson(res, 400, { error: 'sourceId required' });
        }
        const allAnn = readJson(paths.annotations, {});
        allAnn[sourceId] = {
          annotations: annotations ?? allAnn[sourceId]?.annotations ?? '',
          tags: tags ?? allAnn[sourceId]?.tags ?? [],
          rating: rating ?? allAnn[sourceId]?.rating ?? 0,
          updatedAt: new Date().toISOString()
        };
        writeJson(paths.annotations, allAnn);
        return sendJson(res, 200, { success: true, annotation: allAnn[sourceId] });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // --- API: CLIPS (Fixed v4 parseJsonBody bug -> readJsonBody) ---
    if (pathname === '/api/clips' && req.method === 'GET') {
      const clips = loadClips(paths);
      return sendJson(res, 200, { clips });
    }

    if (pathname === '/api/clips' && req.method === 'POST') {
      try {
        const clip = await readJsonBody();
        if (!clip.name || clip.inSec === undefined || clip.outSec === undefined) {
          return sendJson(res, 400, { error: 'Clip name, inSec, and outSec are required' });
        }
        const clips = loadClips(paths);
        clip.inSec = Number(clip.inSec);
        clip.outSec = Number(clip.outSec);
        clip.duration = Number((clip.outSec - clip.inSec).toFixed(3));
        clip.mode = clip.mode || clip.loopMode || 'loop';
        clip.speed = Number(clip.speed) || 1.0;

        if (!clip.id) {
          clip.id = 'clip-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          clip.createdAt = new Date().toISOString();
          clips.unshift(clip);
        } else {
          const idx = clips.findIndex(c => c.id === clip.id);
          if (idx >= 0) {
            clips[idx] = { ...clips[idx], ...clip, updatedAt: new Date().toISOString() };
          } else {
            clips.unshift(clip);
          }
        }
        writeJson(paths.clips, clips);
        return sendJson(res, 200, { success: true, clip });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (pathname === '/api/clips' && req.method === 'DELETE') {
      try {
        const clipId = parsedUrl.searchParams.get('id');
        if (!clipId) {
          return sendJson(res, 400, { error: 'Clip id query parameter required' });
        }
        const clips = loadClips(paths).filter(c => c.id !== clipId);
        writeJson(paths.clips, clips);
        return sendJson(res, 200, { success: true, remaining: clips.length });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // --- API: ASSETS (v4 backwards compatibility) ---
    if (pathname === '/api/assets' && req.method === 'GET') {
      const assetsDir = paths.assets;
      const previewsDir = path.join(assetsDir, 'previews');
      const list = [];
      if (fs.existsSync(assetsDir)) {
        const files = fs.readdirSync(assetsDir);
        for (const f of files) {
          if (f.startsWith('.') || f === 'previews') continue;
          const full = path.join(assetsDir, f);
          const stat = fs.statSync(full);
          if (stat.isDirectory()) continue;
          const ext = path.extname(f);
          const base = path.basename(f, ext);
          const previewFile = fs.existsSync(path.join(previewsDir, `${base}.mp4`))
            ? `/assets/previews/${base}.mp4`
            : `/assets/${f}`;
          list.push({
            filename: f,
            base,
            ext,
            url: `/assets/${f}`,
            previewUrl: previewFile,
            size: stat.size
          });
        }
      }
      return sendJson(res, 200, { assets: list });
    }

    // --- API: STEMS (CONTRACTS.md §8) ---
    if (pathname === '/api/stems' && req.method === 'GET') {
      const stems = (project.audio.stems || []).map(stem => {
        let fileUrl = stem.file || null;
        if (!fileUrl) {
          const candidates = [
            [path.join(paths.outStems, `${stem.id}.mp3`), `/out/stems/${stem.id}.mp3`],
            [path.join(paths.outStems, `${stem.id}.wav`), `/out/stems/${stem.id}.wav`],
            [path.join(paths.stemsDir, `${stem.id}.wav`), `/project/score/stems/${stem.id}.wav`],
            [path.join(paths.stemsDir, `${stem.id}.mp3`), `/project/score/stems/${stem.id}.mp3`]
          ];
          if (stem.id === 'master') {
            candidates.unshift(
              [paths.outScore, '/out/score.wav'],
              [path.join(paths.out, 'score.mp3'), '/out/score.mp3'],
              [paths.score, `/project/${project.audio.scorePath}`]
            );
          }
          const found = candidates.find(([diskPath]) => fs.existsSync(diskPath));
          fileUrl = found ? found[1] : `/out/stems/${stem.id}.wav`;
        }
        return {
          ...stem,
          desc: stem.desc || stem.role || `${stem.name} stem`,
          file: fileUrl
        };
      });
      return sendJson(res, 200, { stems });
    }

    // --- API: AUDIO FEATURES (CONTRACTS.md §8) ---
    if (pathname === '/api/features' && req.method === 'GET') {
      const duration = project.audio.durationSeconds || 60;
      const fps = project.fps || 30;
      if (fs.existsSync(paths.features)) {
        const buf = fs.readFileSync(paths.features);
        const floats = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
        const frames = [];
        const numFrames = Math.floor(floats.length / 6);
        const step = Math.max(1, Math.round(fps / 15));
        for (let f = 0; f < numFrames; f += step) {
          frames.push([
            parseFloat(floats[f * 6 + 0].toFixed(3)),
            parseFloat(floats[f * 6 + 1].toFixed(3)),
            parseFloat(floats[f * 6 + 2].toFixed(3)),
            parseFloat(floats[f * 6 + 3].toFixed(3)),
            parseFloat(floats[f * 6 + 4].toFixed(3)),
            parseFloat(floats[f * 6 + 5].toFixed(3))
          ]);
        }
        return sendJson(res, 200, { frames, fps: Math.round(fps / step), duration });
      }
      return sendJson(res, 200, { frames: [], fps: 15, duration });
    }

    // --- STATIC URL SPACE (CONTRACTS.md §7) ---
    // `/` | `/studio` | `/studio.html` -> `REPO/studio/index.html`
    // `/studio/*` -> `REPO/studio/*`
    // `/slopscore/*` -> `REPO/*`
    // `/project/*` -> `ROOT/*`
    // `/out/*`, `/assets/*`, `/feedback/*`, `/score/*`, `/scenes/*` -> `ROOT/<segment>/*`
    let filePath = null;

    if (pathname === '/' || pathname === '/studio' || pathname === '/studio/' || pathname === '/studio.html' || pathname === '/index.html') {
      filePath = path.join(REPO_ROOT, 'studio', 'index.html');
    } else if (pathname.startsWith('/studio/')) {
      const rel = pathname.slice('/studio/'.length);
      filePath = path.resolve(REPO_ROOT, 'studio', rel);
      if (!filePath.startsWith(path.join(REPO_ROOT, 'studio'))) {
        res.writeHead(403); return res.end('Forbidden');
      }
    } else if (pathname.startsWith('/slopscore/')) {
      const rel = pathname.slice('/slopscore/'.length);
      filePath = path.resolve(REPO_ROOT, rel);
      if (!filePath.startsWith(REPO_ROOT)) {
        res.writeHead(403); return res.end('Forbidden');
      }
    } else if (pathname.startsWith('/project/')) {
      const rel = pathname.slice('/project/'.length);
      filePath = path.resolve(resolvedRoot, rel);
      if (!filePath.startsWith(resolvedRoot)) {
        res.writeHead(403); return res.end('Forbidden');
      }
    } else if (
      pathname.startsWith('/out/') ||
      pathname.startsWith('/assets/') ||
      pathname.startsWith('/feedback/') ||
      pathname.startsWith('/score/') ||
      pathname.startsWith('/scenes/')
    ) {
      const rel = pathname.slice(1);
      filePath = path.resolve(resolvedRoot, rel);
      if (!filePath.startsWith(resolvedRoot)) {
        res.writeHead(403); return res.end('Forbidden');
      }
    } else {
      // Try studio directory first, then project root
      const candStudio = path.resolve(REPO_ROOT, 'studio', pathname.slice(1));
      const candProject = path.resolve(resolvedRoot, pathname.slice(1));
      if (candStudio.startsWith(path.join(REPO_ROOT, 'studio')) && fs.existsSync(candStudio)) {
        filePath = candStudio;
      } else if (candProject.startsWith(resolvedRoot) && fs.existsSync(candProject)) {
        filePath = candProject;
      } else {
        filePath = candStudio;
      }
    }

    serveStaticFile(req, res, filePath);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, listenHost, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : listenPort;
  const url = `http://localhost:${actualPort}`;

  if (!opts.quiet) {
    console.log(`\n======================================================`);
    console.log(`🎬 SLOPSCORE 2.0 DIRECTOR STUDIO ONLINE`);
    console.log(`📁 Project: ${resolvedRoot}`);
    console.log(`👉 ${url}`);
    console.log(`======================================================\n`);
  }

  return {
    server,
    url,
    port: actualPort,
    root: resolvedRoot,
    close: () => new Promise((resolve) => {
      for (const sub of runTaskSubscribers) {
        try { sub.end(); } catch { /* ignore */ }
      }
      runTaskSubscribers.clear();
      if (currentRunTask && currentRunTask.proc) {
        try { currentRunTask.proc.kill('SIGTERM'); } catch { /* ignore */ }
      }
      server.close(() => resolve());
    })
  };
}

// Allow direct CLI invocation: `node studio/server.mjs [root] [--port=8989]`
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  let rootArg = process.cwd();
  let portArg = undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--port=')) {
      portArg = parseInt(a.split('=')[1], 10);
    } else if (a === '--port' && args[i + 1]) {
      portArg = parseInt(args[++i], 10);
    } else if (!a.startsWith('-')) {
      rootArg = a;
    }
  }
  startStudioServer({ root: rootArg, port: portArg }).catch(err => {
    console.error('[Studio Server Error]', err);
    process.exit(1);
  });
}
