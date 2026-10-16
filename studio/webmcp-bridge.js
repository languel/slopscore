// studio/webmcp-bridge.js — In-Browser WebMCP Tool Registry (CONTRACTS.md §11).
// Connects `window.slopscore.studio` to `@jason.today/webmcp` so external MCP clients
// and the embedded Genereti Assistant can inspect and control live Studio state.

export const WEBMCP_TOOL_SCHEMAS = [
  {
    name: 'studio_get_state',
    description: 'Return current live transport, playhead bar/time, active chapter, renderer, loop IN/OUT, and active version.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'studio_seek',
    description: 'Seek the Studio transport playhead by time (seconds) or musical bar (1-based).',
    inputSchema: {
      type: 'object',
      properties: {
        time: { type: 'number', description: 'Target timestamp in seconds' },
        bar: { type: 'number', description: '1-based musical bar number (e.g. 41 or 24.5)' }
      }
    }
  },
  {
    name: 'studio_play',
    description: 'Start playback in the Studio transport.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'studio_pause',
    description: 'Pause playback in the Studio transport.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'loop_automatch',
    description: 'Run seamless A/B loop seam auto-matcher on a source video around current IN/OUT.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: 'Source filename or ID (defaults to currently selected source)' },
        tolerance: { type: 'number', description: 'Optional match tolerance' },
        window: { type: 'number', description: 'Search window in seconds around IN/OUT (default 1.0)' }
      }
    }
  },
  {
    name: 'set_shader_param',
    description: 'Update a live shader uniform (crtScanlines, chromaticAberration, lumaRelief, reliefDepth, vignette, plexus, plexusDistance, phosphorGlow) globally or for a specific chapter.',
    inputSchema: {
      type: 'object',
      required: ['param', 'value'],
      properties: {
        param: { type: 'string', description: 'Shader parameter name' },
        value: { description: 'New parameter value (number or boolean)' },
        chapterId: { type: 'string', description: 'Optional chapter ID (e.g. ch-0); global when omitted' }
      }
    }
  },
  {
    name: 'set_camera_param',
    description: 'Update a camera spline parameter (type, dist, panX, panY, fov, roll, charScale) globally or for a specific chapter.',
    inputSchema: {
      type: 'object',
      required: ['param', 'value'],
      properties: {
        param: { type: 'string', description: 'Camera parameter name' },
        value: { description: 'New parameter value' },
        chapterId: { type: 'string', description: 'Optional chapter ID; global when omitted' }
      }
    }
  },
  {
    name: 'bind_clip',
    description: 'Bind a saved clip from the Clip Library to a timeline chapter.',
    inputSchema: {
      type: 'object',
      required: ['clipId', 'chapterIndex'],
      properties: {
        clipId: { type: 'string', description: 'Clip ID from feedback/clips.json' },
        chapterIndex: { type: 'number', description: '0-based chapter index' }
      }
    }
  },
  {
    name: 'save_clip',
    description: 'Save a seamless loop clip to feedback/clips.json.',
    inputSchema: {
      type: 'object',
      required: ['name', 'inSec', 'outSec'],
      properties: {
        name: { type: 'string' },
        sourceId: { type: 'string' },
        inSec: { type: 'number' },
        outSec: { type: 'number' },
        mode: { type: 'string', enum: ['loop', 'pingpong', 'reverse', 'once'] },
        speed: { type: 'number' },
        tags: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' }
      }
    }
  },
  {
    name: 'add_note',
    description: 'Pin a director annotation to a musical measure/timestamp and persist to feedback/notes.json.',
    inputSchema: {
      type: 'object',
      required: ['title', 'text'],
      properties: {
        title: { type: 'string' },
        text: { type: 'string' },
        timeStart: { type: 'number' },
        timeEnd: { type: 'number' },
        target: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  {
    name: 'run_command',
    description: 'Trigger a Studio build/render preset (sheet, build, audio, preview, video, bank, features).',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['sheet', 'build', 'audio', 'preview', 'video', 'bank', 'features', 'full'] },
        range: { type: 'string', description: 'Optional start:end range in seconds for preview' }
      }
    }
  },
  {
    name: 'capture_frame',
    description: 'Capture the current video/canvas preview frame as a JPEG data URL.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'list_clips',
    description: 'Return all saved clips in the project Clip Library.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_project',
    description: 'Return the full normalized project manifest, chapters, cues, clips, and overrides.',
    inputSchema: { type: 'object', properties: {} }
  }
];

function loadWebMcpScript() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.WebMCP) return Promise.resolve(window.WebMCP);
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = '/slopscore/node_modules/@jason.today/webmcp/build/webmcp.js';
    script.async = true;
    script.onload = () => resolve(window.WebMCP || null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
}

/**
 * Initialize WebMCP and register all 14 live Studio tools on `window.slopscore.webmcp`.
 * @param {any} [studio] window.slopscore.studio instance
 */
export async function initWebMcpBridge(studio = window.slopscore?.studio) {
  const getStudio = () => studio || window.slopscore?.studio;

  const handlers = {
    studio_get_state: async () => getStudio().getState(),
    studio_seek: async (args = {}) => getStudio().seek(args),
    studio_play: async () => getStudio().play(),
    studio_pause: async () => getStudio().pause(),
    loop_automatch: async (args = {}) => getStudio().automatchLoop(args),
    set_shader_param: async (args = {}) => getStudio().setShaderParam(args),
    set_camera_param: async (args = {}) => getStudio().setCameraParam(args),
    bind_clip: async (args = {}) => getStudio().bindClip(args),
    save_clip: async (args = {}) => getStudio().saveClip(args),
    add_note: async (args = {}) => getStudio().addNote(args),
    run_command: async (args = {}) => getStudio().runCommand(args),
    capture_frame: async () => ({ dataUrl: await getStudio().captureFrame() }),
    list_clips: async () => ({ clips: await getStudio().getClips() }),
    get_project: async () => getStudio().getProject()
  };

  const WebMCPClass = await loadWebMcpScript();
  let widget = null;
  if (WebMCPClass) {
    try {
      widget = new WebMCPClass({
        color: '#64b5a0',
        position: 'bottom-right',
        size: '26px',
        padding: '14px'
      });
      for (const tool of WEBMCP_TOOL_SCHEMAS) {
        widget.registerTool(tool.name, tool.description, tool.inputSchema, async (args) => {
          const res = await handlers[tool.name](args || {});
          return typeof res === 'string' ? res : JSON.stringify(res);
        });
      }
    } catch (err) {
      console.warn('[WebMCP] Widget initialization fallback:', err);
    }
  }

  const bridge = {
    widget,
    tools: WEBMCP_TOOL_SCHEMAS,
    handlers,
    async callTool(name, args = {}) {
      const fn = handlers[name];
      if (!fn) throw new Error(`Unknown WebMCP tool: ${name}`);
      return await fn(args);
    }
  };

  window.slopscore = window.slopscore || {};
  window.slopscore.webmcp = bridge;
  return bridge;
}
