// studio/assistant/routes.mjs — Studio HTTP route handler for the Genereti Assistant & Skills engine.
// Implements CONTRACTS.md §10:
//   export async function handleAssistantRoute(req, res, ctx): Promise<boolean>

import {
  listProviders,
  listModels,
  discoverSkills,
  chatWithAssistant
} from './providers.mjs';
import { loadClips, readJson } from '../../kit/config-loader.mjs';

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

/**
 * Handle `/api/assistant/*` routes.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ root: string, getLoaded: () => Promise<any>, readJsonBody: () => Promise<any> }} ctx
 * @returns {Promise<boolean>} true if route was handled
 */
export async function handleAssistantRoute(req, res, ctx) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  if (!pathname.startsWith('/api/assistant/')) return false;

  try {
    if (pathname === '/api/assistant/providers' && req.method === 'GET') {
      const providers = await listProviders();
      sendJson(res, 200, { providers });
      return true;
    }

    if (pathname === '/api/assistant/skills' && req.method === 'GET') {
      const skills = discoverSkills(ctx.root);
      sendJson(res, 200, { skills });
      return true;
    }

    if (pathname === '/api/assistant/models' && (req.method === 'GET' || req.method === 'POST')) {
      const body = req.method === 'POST' ? await ctx.readJsonBody() : {
        provider: parsedUrl.searchParams.get('provider') || 'builtin',
        url: parsedUrl.searchParams.get('url') || undefined
      };
      const models = await listModels(body);
      sendJson(res, 200, { models });
      return true;
    }

    if (pathname === '/api/assistant/chat' && req.method === 'POST') {
      const body = await ctx.readJsonBody();
      const {
        provider = 'builtin',
        model,
        url,
        apiKey,
        messages = [],
        attachments = [],
        projectContext: clientContext,
        stream = false
      } = body || {};

      let projectContext = clientContext || {};
      if (!projectContext.project && ctx.getLoaded) {
        try {
          const loaded = await ctx.getLoaded();
          const clips = loadClips(loaded.paths);
          const notes = readJson(loaded.paths.notes, []);
          const overrides = readJson(loaded.paths.feedback + '/overrides.json', { shaders: {}, camera: {}, chapters: {} });
          projectContext = {
            ...projectContext,
            title: loaded.project.title,
            bpm: loaded.project.audio.bpm,
            duration: loaded.project.audio.durationSeconds,
            renderer: loaded.project.renderer,
            chapters: loaded.project.chapters.map(c => ({
              index: c.index, id: c.id, name: c.name, startBar: c.startBar, endBar: c.endBar,
              clipLoopId: c.clipLoopId, particleRig: c.particleRig
            })),
            clipsCount: clips.length,
            notesCount: notes.length,
            overrides
          };
        } catch {
          // ignore if project couldn't load
        }
      }

      const skills = discoverSkills(ctx.root);
      const result = await chatWithAssistant({
        provider,
        model,
        url,
        apiKey,
        messages,
        attachments,
        projectContext,
        skills
      });

      const wantsSse = stream && (req.headers.accept || '').includes('text/event-stream');
      if (wantsSse) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        res.write(`data: ${JSON.stringify({ type: 'text', text: result.text })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'proposals', proposals: result.proposals })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done', ...result })}\n\n`);
        res.end();
        return true;
      }

      sendJson(res, 200, {
        ok: true,
        reply: result.text,
        text: result.text,
        proposals: result.proposals || [],
        providerUsed: result.providerUsed,
        modelUsed: result.modelUsed,
        fallbackReason: result.fallbackReason || null
      });
      return true;
    }

    sendJson(res, 404, { error: `Unknown assistant endpoint: ${pathname}` });
    return true;
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Assistant error' });
    return true;
  }
}
