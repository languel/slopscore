// studio/assistant/providers.mjs — Multi-provider LLM connector & Creative Skills discovery.
// Ported from ~/dev/genereti/integrations/genereti_comfy_agent/backend.py and adapted for Slopscore 2.0.
// Supports local servers (Ollama, LM Studio, MLX/llama.cpp, Unsloth), cloud APIs (Gemini, Claude,
// OpenAI, OpenRouter), and a deterministic built-in Director Rule-Assistant fallback so proposals
// always work offline and in automated tests.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

export const PROVIDERS = {
  builtin: {
    id: 'builtin',
    name: 'Built-in Director (Offline)',
    kind: 'builtin',
    protocol: 'builtin',
    defaultUrl: 'builtin://director',
    defaultModel: 'slopscore-director-v2',
    models: ['slopscore-director-v2', 'slopscore-shader-synthesizer', 'slopscore-loop-curator'],
    envKey: null
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (Local)',
    kind: 'local',
    protocol: 'ollama',
    defaultUrl: 'http://localhost:11434',
    defaultModel: 'qwen2.5-coder:7b',
    models: ['qwen2.5-coder:7b', 'llama3.2:latest', 'deepseek-r1:8b', 'mistral:latest'],
    envKey: null
  },
  lmstudio: {
    id: 'lmstudio',
    name: 'LM Studio (Local)',
    kind: 'local',
    protocol: 'openai',
    defaultUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    models: ['local-model'],
    envKey: null
  },
  mlx: {
    id: 'mlx',
    name: 'MLX / llama.cpp (Local)',
    kind: 'local',
    protocol: 'openai',
    defaultUrl: 'http://localhost:8080/v1',
    defaultModel: 'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit',
    models: ['mlx-community/Qwen2.5-Coder-7B-Instruct-4bit', 'local-gguf'],
    envKey: null
  },
  unsloth: {
    id: 'unsloth',
    name: 'Unsloth (Local)',
    kind: 'local',
    protocol: 'openai',
    defaultUrl: 'http://localhost:8000/v1',
    defaultModel: 'unsloth-model',
    models: ['unsloth-model'],
    envKey: null
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'cloud',
    protocol: 'google',
    defaultUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    envKey: 'GEMINI_API_KEY',
    altEnvKey: 'GOOGLE_API_KEY'
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic Claude',
    kind: 'cloud',
    protocol: 'anthropic',
    defaultUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-20250514',
    models: ['claude-sonnet-4-20250514', 'claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest'],
    envKey: 'ANTHROPIC_API_KEY'
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    kind: 'cloud',
    protocol: 'openai',
    defaultUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'o3-mini'],
    envKey: 'OPENAI_API_KEY'
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'cloud',
    protocol: 'openai',
    defaultUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    models: ['anthropic/claude-3.5-sonnet', 'google/gemini-2.5-flash', 'deepseek/deepseek-chat'],
    envKey: 'OPENROUTER_API_KEY'
  }
};

// Alias 'google' -> 'gemini' and 'claude' -> 'anthropic' for compatibility
const PROVIDER_ALIASES = {
  google: 'gemini',
  claude: 'anthropic',
  llamacpp: 'mlx'
};

export function resolveProviderId(id) {
  const key = String(id || 'builtin').toLowerCase();
  const mapped = PROVIDER_ALIASES[key] || key;
  return PROVIDERS[mapped] ? mapped : 'builtin';
}

/** Read ~/.slopscore/assistant.json if present (never sent to client). */
export function loadUserAssistantConfig() {
  try {
    const p = path.join(os.homedir(), '.slopscore', 'assistant.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    // ignore
  }
  return {};
}

export function resolveApiKey(providerId, requestKey) {
  if (requestKey && String(requestKey).trim()) return String(requestKey).trim();
  const spec = PROVIDERS[resolveProviderId(providerId)];
  if (!spec) return '';
  if (spec.envKey && process.env[spec.envKey]) return process.env[spec.envKey];
  if (spec.altEnvKey && process.env[spec.altEnvKey]) return process.env[spec.altEnvKey];
  const userCfg = loadUserAssistantConfig();
  return userCfg?.keys?.[spec.id] || userCfg?.[spec.envKey] || '';
}

/** List all providers with configuration status (never leaks API keys). */
export async function listProviders() {
  const out = [];
  for (const spec of Object.values(PROVIDERS)) {
    const hasKey = spec.kind === 'cloud' ? Boolean(resolveApiKey(spec.id)) : true;
    out.push({
      id: spec.id,
      name: spec.name,
      kind: spec.kind,
      protocol: spec.protocol,
      defaultUrl: spec.defaultUrl,
      defaultModel: spec.defaultModel,
      models: spec.models,
      configured: hasKey
    });
  }
  return out;
}

/** Query available models from a provider endpoint, falling back to preset list. */
export async function listModels({ provider = 'builtin', url, apiKey } = {}) {
  const id = resolveProviderId(provider);
  const spec = PROVIDERS[id];
  if (spec.protocol === 'builtin') return spec.models;

  const baseUrl = String(url || spec.defaultUrl).replace(/\/+$/, '');
  const key = resolveApiKey(id, apiKey);
  const headers = { 'Content-Type': 'application/json' };

  if (key) {
    if (spec.protocol === 'anthropic') {
      headers['x-api-key'] = key;
      headers['anthropic-version'] = '2023-06-01';
    } else if (spec.protocol === 'google') {
      headers['x-goog-api-key'] = key;
    } else {
      headers['Authorization'] = `Bearer ${key}`;
    }
  }

  try {
    const endpoint = spec.protocol === 'ollama' ? `${baseUrl}/api/tags` : `${baseUrl}/models`;
    const res = await fetch(endpoint, { method: 'GET', headers, signal: AbortSignal.timeout(2500) });
    if (!res.ok) return spec.models;
    const data = await res.json();
    if (spec.protocol === 'ollama' && Array.isArray(data.models)) {
      const names = data.models.map(m => m.name).filter(Boolean);
      return names.length ? names : spec.models;
    }
    if (spec.protocol === 'google' && Array.isArray(data.models)) {
      const names = data.models
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => String(m.name).replace(/^models\//, ''));
      return names.length ? names : spec.models;
    }
    if (Array.isArray(data.data)) {
      const ids = data.data.map(m => m.id).filter(Boolean);
      return ids.length ? ids : spec.models;
    }
  } catch {
    // Offline or unreachable local server; return defaults
  }
  return spec.models;
}

/** Built-in creative skill definitions guaranteed to be available. */
const BUILTIN_SKILLS = [
  {
    id: 'anatomy',
    name: 'anatomy',
    trigger: '@anatomy',
    description: 'Build crafted isometric SVG/WebGL technical figures, dial gauges, test rigs, and control apparatuses for fframes or HyperFrames chapters.',
    outputFlow: 'Emits precision SVG/WebGL code -> rendered via fframes or HyperFrames',
    builtin: true
  },
  {
    id: 'ff-tracker',
    name: 'ff-tracker',
    trigger: '@ff-tracker',
    description: 'Computer vision optical flow, contour extraction, and luminance relief tracking on archival clips to guide 3D particle emitters.',
    outputFlow: 'Emits motion vectors & relief depth parameters -> guides particle emitters',
    builtin: true
  },
  {
    id: 'codeanimation',
    name: 'codeanimation',
    trigger: '@codeanimation',
    description: 'Create hand-painted 2D animated videos and motion graphics with p5.js and p5.brush synchronized to musical measures.',
    outputFlow: 'Emits p5 sketch / loop parameters -> imported into Clip Library or p5js renderer',
    builtin: true
  },
  {
    id: 'slopscore',
    name: 'slopscore',
    trigger: '@slopscore',
    description: 'Procedural video scoring, 3D particle attractors, CRT post-processing shaders, camera splines, and quantized measure direction.',
    outputFlow: 'Emits live Studio WebMCP tool actions (shaders, camera, clips, timeline)',
    builtin: true
  }
];

function parseSkillFrontmatter(mdText, fallbackName, skillPath) {
  const match = mdText.match(/^---\s*\n([\s\S]*?)\n---/);
  let name = fallbackName;
  let description = '';
  if (match) {
    const yaml = match[1];
    const nameMatch = yaml.match(/^name:\s*(.+)$/m);
    if (nameMatch) name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
    const descMatch = yaml.match(/^description:\s*(.+)$/m);
    if (descMatch) description = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
  }
  if (!description) {
    const firstPara = mdText.replace(/^---[\s\S]*?---\s*/, '').split('\n').find(l => l.trim() && !l.startsWith('#'));
    description = firstPara ? firstPara.trim().slice(0, 220) : `Skill ${name}`;
  }
  return {
    id: name,
    name,
    trigger: `@${name}`,
    description,
    path: skillPath,
    builtin: false
  };
}

/**
 * Scan `~/.agents/skills/`, `~/.gemini/config/skills/`, and `<projectRoot>/skills/`
 * for pluggable creative skills (`anatomy`, `ff-tracker`, `codeanimation`, `slopscore`, etc.).
 */
export function discoverSkills(projectRoot = process.cwd()) {
  const byId = new Map();
  for (const b of BUILTIN_SKILLS) {
    byId.set(b.id, { ...b });
  }

  const candidateDirs = [
    path.join(os.homedir(), '.agents', 'skills'),
    path.join(os.homedir(), '.gemini', 'config', 'skills'),
    path.join(projectRoot, 'skills'),
    path.join(REPO_ROOT, 'skills')
  ];

  const PRIORITY_SKILLS = new Set(['anatomy', 'ff-tracker', 'codeanimation', 'slopscore']);

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const skillMd = path.join(dir, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillMd)) continue;
        // Include priority creative skills and any project-local skills
        if (dir.endsWith(path.join('config', 'skills')) && !PRIORITY_SKILLS.has(entry.name)) continue;
        try {
          const raw = fs.readFileSync(skillMd, 'utf8');
          const parsed = parseSkillFrontmatter(raw, entry.name, skillMd);
          const existing = byId.get(parsed.id) || {};
          byId.set(parsed.id, { ...existing, ...parsed, builtin: Boolean(existing.builtin) });
        } catch {
          // ignore unreadable skill
        }
      }
    } catch {
      // ignore unreadable directory
    }
  }

  // Also check REPO_ROOT/SKILL.md
  const repoSkillMd = path.join(REPO_ROOT, 'SKILL.md');
  if (fs.existsSync(repoSkillMd)) {
    try {
      const raw = fs.readFileSync(repoSkillMd, 'utf8');
      const parsed = parseSkillFrontmatter(raw, 'slopscore', repoSkillMd);
      byId.set('slopscore', { ...byId.get('slopscore'), ...parsed, id: 'slopscore', trigger: '@slopscore' });
    } catch {
      // ignore
    }
  }

  return Array.from(byId.values());
}

/** Extract fenced ```slopscore-action ... ``` blocks or JSON proposal envelopes from LLM text. */
export function extractProposalsFromText(rawText = '') {
  const proposals = [];
  let cleanText = String(rawText || '');

  const fenceRegex = /```(?:slopscore-action|json)\s*([\s\S]*?)```/gi;
  let match;
  let idx = 0;
  while ((match = fenceRegex.exec(rawText)) !== null) {
    const block = match[1].trim();
    try {
      const parsed = JSON.parse(block);
      const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.proposals) ? parsed.proposals : [parsed]);
      for (const item of items) {
        const calls = Array.isArray(item.calls)
          ? item.calls
          : (Array.isArray(item.actions) ? item.actions : (item.tool ? [{ tool: item.tool, args: item.args || {} }] : []));
        if (calls.length > 0) {
          proposals.push({
            id: item.id || `prop_${Date.now()}_${++idx}`,
            title: item.title || `Studio Action (${calls.map(c => c.tool).join(', ')})`,
            summary: item.summary || item.description || `Execute ${calls.length} studio tool call(s)`,
            skill: item.skill || null,
            calls: calls.map(c => ({ tool: c.tool, args: c.args || {} }))
          });
        }
      }
      cleanText = cleanText.replace(match[0], '').trim();
    } catch {
      // leave non-action code blocks alone
    }
  }

  return { text: cleanText || String(rawText || '').trim(), proposals };
}

/**
 * Deterministic Built-in Director Rule-Assistant.
 * Inspects user prompt, @skill mentions, @attachments, and projectContext to synthesize
 * helpful creative direction + concrete WebMCP tool proposals.
 */
export function builtinDirectorReply({ messages = [], attachments = [], projectContext = {}, skills = [] }) {
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  const lower = lastUserMsg.toLowerCase();
  const proposals = [];
  const notes = [];
  let activeSkill = null;

  // Check for @skill mentions
  if (lower.includes('@anatomy') || lower.includes('isometric') || lower.includes('gauge') || lower.includes('apparatus')) {
    activeSkill = 'anatomy';
  } else if (lower.includes('@ff-tracker') || lower.includes('optical flow') || lower.includes('contour') || lower.includes('relief')) {
    activeSkill = 'ff-tracker';
  } else if (lower.includes('@codeanimation') || lower.includes('p5') || lower.includes('brush') || lower.includes('walk')) {
    activeSkill = 'codeanimation';
  }

  // Parse bar / time seek intents
  const barMatch = lastUserMsg.match(/(?:@bar:|bar\s+|b)(\d+(?:\.\d+)?)/i);
  const timeMatch = lastUserMsg.match(/(?:seek\s+to\s+|at\s+)(\d+(?:\.\d+)?)\s*s\b/i);

  if (barMatch) {
    const barNum = parseFloat(barMatch[1]);
    proposals.push({
      id: `prop_seek_${Date.now()}`,
      title: `Seek Timeline to Bar ${barNum}`,
      summary: `Quantize transport playhead to musical measure Bar ${barNum}`,
      skill: activeSkill || 'slopscore',
      calls: [{ tool: 'studio_seek', args: { bar: barNum } }]
    });
    notes.push(`Prepared transport jump to **Bar ${barNum}**.`);
  } else if (timeMatch) {
    const timeSec = parseFloat(timeMatch[1]);
    proposals.push({
      id: `prop_seek_${Date.now()}`,
      title: `Seek Timeline to ${timeSec.toFixed(2)}s`,
      summary: `Move playhead to ${timeSec.toFixed(2)}s`,
      skill: activeSkill || 'slopscore',
      calls: [{ tool: 'studio_seek', args: { time: timeSec } }]
    });
    notes.push(`Prepared transport jump to **${timeSec.toFixed(2)}s**.`);
  }

  // Shader parameter adjustments
  const shaderCalls = [];
  if (lower.includes('chromatic') || lower.includes('aberration') || lower.includes('glitch')) {
    const valMatch = lastUserMsg.match(/(?:to|=)\s*(0\.\d+|\d+(?:\.\d+)?)/);
    const value = valMatch ? Math.min(1, parseFloat(valMatch[1])) : 0.48;
    shaderCalls.push({ tool: 'set_shader_param', args: { param: 'chromaticAberration', value } });
  }
  if (lower.includes('scanline') || lower.includes('crt')) {
    const off = lower.includes('off') || lower.includes('disable') || lower.includes('no ');
    shaderCalls.push({ tool: 'set_shader_param', args: { param: 'crtScanlines', value: !off } });
  }
  if (lower.includes('relief') || activeSkill === 'ff-tracker') {
    const depthMatch = lastUserMsg.match(/depth\s*(?:to|=)?\s*(\d+(?:\.\d+)?)/i);
    const depth = depthMatch ? parseFloat(depthMatch[1]) : 4.2;
    shaderCalls.push({ tool: 'set_shader_param', args: { param: 'lumaRelief', value: true } });
    shaderCalls.push({ tool: 'set_shader_param', args: { param: 'reliefDepth', value: depth } });
  }
  if (lower.includes('plexus') || lower.includes('constellation')) {
    shaderCalls.push({ tool: 'set_shader_param', args: { param: 'plexus', value: true } });
    shaderCalls.push({ tool: 'set_shader_param', args: { param: 'plexusDistance', value: 2.6 } });
  }
  if (lower.includes('phosphor') || lower.includes('glow') || lower.includes('bloom')) {
    shaderCalls.push({ tool: 'set_shader_param', args: { param: 'phosphorGlow', value: 1.45 } });
  }
  if (lower.includes('vignette')) {
    shaderCalls.push({ tool: 'set_shader_param', args: { param: 'vignette', value: 0.38 } });
  }

  if (shaderCalls.length > 0) {
    proposals.push({
      id: `prop_shader_${Date.now()}`,
      title: activeSkill === 'ff-tracker'
        ? 'Apply @ff-tracker Luma Relief & Contour Displacement'
        : 'Update Live Shader Post-Processing',
      summary: shaderCalls.map(c => `${c.args.param} = ${JSON.stringify(c.args.value)}`).join(', '),
      skill: activeSkill || 'slopscore',
      calls: shaderCalls
    });
    notes.push(`Configured live shader uniform updates (${shaderCalls.map(c => `\`${c.args.param}\``).join(', ')}).`);
  }

  // Camera adjustments
  const camCalls = [];
  for (const camType of ['dollyPush', 'lateralTrack', 'breathing', 'recoilShake', 'vertigo', 'vista', 'pullBack', 'orbit', 'static']) {
    if (lower.includes(camType.toLowerCase()) || (camType === 'recoilShake' && lower.includes('recoil')) || (camType === 'dollyPush' && lower.includes('dolly'))) {
      camCalls.push({ tool: 'set_camera_param', args: { param: 'type', value: camType } });
      break;
    }
  }
  if (lower.includes('fov') || lower.includes('wide') || lower.includes('zoom')) {
    const fov = lower.includes('wide') ? 68 : 44;
    camCalls.push({ tool: 'set_camera_param', args: { param: 'fov', value: fov } });
  }
  if (lower.includes('closer') || lower.includes('push in')) {
    camCalls.push({ tool: 'set_camera_param', args: { param: 'dist', value: 10.5 } });
  }
  if (camCalls.length > 0) {
    proposals.push({
      id: `prop_cam_${Date.now()}`,
      title: 'Adjust Camera Trajectory & Lens',
      summary: camCalls.map(c => `camera.${c.args.param} = ${JSON.stringify(c.args.value)}`).join(', '),
      skill: activeSkill || 'slopscore',
      calls: camCalls
    });
    notes.push(`Configured camera trajectory parameters.`);
  }

  // Loop automatch intent
  if (lower.includes('automatch') || lower.includes('seamless loop') || lower.includes('find loop')) {
    const sourceId = projectContext?.state?.selectedSource || projectContext?.sources?.[0]?.id || undefined;
    proposals.push({
      id: `prop_loop_${Date.now()}`,
      title: 'Automatch Seamless Loop Seam',
      summary: `Scan candidate frames around current IN/OUT to minimize pixel MSE${sourceId ? ` on ${sourceId}` : ''}`,
      skill: 'slopscore',
      calls: [{ tool: 'loop_automatch', args: { sourceId, window: 1.0 } }]
    });
    notes.push(`Queued A/B seam scanner (` + '`loop_automatch`' + `).`);
  }

  // Note creation intent
  if (lower.includes('add note') || lower.includes('annotate') || lower.includes('director note')) {
    const bar = projectContext?.state?.bar ? Math.round(projectContext.state.bar) : 1;
    proposals.push({
      id: `prop_note_${Date.now()}`,
      title: `Pin Director Note at Bar ${bar}`,
      summary: `Record director annotation in feedback/notes.json`,
      skill: activeSkill || 'slopscore',
      calls: [{
        tool: 'add_note',
        args: {
          title: `Assistant Note (Bar ${bar})`,
          text: lastUserMsg,
          timeStart: projectContext?.state?.time || 0,
          target: projectContext?.state?.chapter?.name || 'Master Cut',
          tags: [activeSkill || 'assistant']
        }
      }]
    });
    notes.push(`Prepared a pinned Director Note at Bar ${bar}.`);
  }

  // Render / command runner intent
  if (lower.includes('contact sheet') || lower.includes('render sheet')) {
    proposals.push({
      id: `prop_cmd_sheet_${Date.now()}`,
      title: 'Render 12-Keyframe Contact Sheet',
      summary: 'Run contact sheet build into out/sheet.jpg',
      skill: 'slopscore',
      calls: [{ tool: 'run_command', args: { action: 'sheet' } }]
    });
    notes.push(`Ready to render the 12-frame contact sheet.`);
  } else if (lower.includes('preview render') || lower.includes('15s preview')) {
    proposals.push({
      id: `prop_cmd_preview_${Date.now()}`,
      title: 'Render Fast 15s Preview Clip',
      summary: 'Render out/preview.mp4 for quick visual verification',
      skill: 'slopscore',
      calls: [{ tool: 'run_command', args: { action: 'preview', range: '0:15' } }]
    });
  }

  // Skill-specific default proposals if no specific proposal was triggered yet
  if (proposals.length === 0) {
    if (activeSkill === 'anatomy') {
      proposals.push({
        id: `prop_anatomy_${Date.now()}`,
        title: 'Configure @anatomy Isometric Apparatus Pass',
        summary: 'Enable crisp vector plexus lines, tighten relief depth, and frame isometric camera perspective',
        skill: 'anatomy',
        calls: [
          { tool: 'set_shader_param', args: { param: 'plexus', value: true } },
          { tool: 'set_shader_param', args: { param: 'plexusDistance', value: 2.35 } },
          { tool: 'set_camera_param', args: { param: 'fov', value: 42 } },
          { tool: 'set_camera_param', args: { param: 'dist', value: 15.0 } }
        ]
      });
      notes.push(`Synthesized an **@anatomy** isometric apparatus preset (tight 42° telephoto FOV + vector plexus armature).`);
    } else if (activeSkill === 'codeanimation') {
      proposals.push({
        id: `prop_codeanim_${Date.now()}`,
        title: 'Configure @codeanimation 2D Sketch Feel',
        summary: 'Soften CRT scanlines, boost phosphor glow, and enable breathing camera cadence',
        skill: 'codeanimation',
        calls: [
          { tool: 'set_shader_param', args: { param: 'crtScanlines', value: false } },
          { tool: 'set_shader_param', args: { param: 'phosphorGlow', value: 1.35 } },
          { tool: 'set_camera_param', args: { param: 'type', value: 'breathing' } }
        ]
      });
      notes.push(`Synthesized a **@codeanimation** hand-painted motion cadence preset.`);
    } else {
      // Always provide a helpful actionable proposal in default/testing mode
      const curCh = projectContext?.state?.chapter;
      proposals.push({
        id: `prop_default_${Date.now()}`,
        title: `Enhance Visual Polish${curCh ? ` (${curCh.name})` : ''}`,
        summary: 'Boost phosphor glow, tune chromatic aberration to 0.28, and set relief depth to 3.2',
        skill: 'slopscore',
        calls: [
          { tool: 'set_shader_param', args: { param: 'chromaticAberration', value: 0.28 } },
          { tool: 'set_shader_param', args: { param: 'reliefDepth', value: 3.2 } },
          { tool: 'set_shader_param', args: { param: 'phosphorGlow', value: 1.25 } }
        ]
      });
      notes.push(`Prepared a live shader & relief polish pass for ${curCh ? `**${curCh.name}**` : 'the active timeline'}.`);
    }
  }

  const attachSummary = attachments.length
    ? `\n\n**Attached Context:** ${attachments.map(a => `\`${a.token || a.label || a.id}\``).join(', ')}`
    : '';

  const replyText = [
    `**Director Assistant** (${activeSkill ? `Skill: \`@${activeSkill}\`` : 'Slopscore Studio'}):`,
    notes.join(' '),
    `Review the proposal card${proposals.length > 1 ? 's' : ''} below and click **Apply** to update the live Studio state (with one-click **Undo** support).`
  ].join('\n\n') + attachSummary;

  return {
    text: replyText,
    proposals,
    providerUsed: 'builtin',
    modelUsed: 'slopscore-director-v2'
  };
}

function buildSystemPrompt({ projectContext = {}, attachments = [], skills = [] }) {
  const skillLines = skills.map(s => `- @${s.name}: ${s.description}`).join('\n');
  return `You are the embedded Slopscore 2.0 Director Studio Assistant.
You help the director shape procedural audio-visual chapters, camera trajectories, shaders, and seamless archival clip loops.

Available WebMCP Studio Tools:
- studio_get_state({})
- studio_seek({ time?, bar? })
- studio_play({})
- studio_pause({})
- loop_automatch({ sourceId?, tolerance?, window? })
- set_shader_param({ param, value, chapterId? }) // params: crtScanlines (bool), chromaticAberration (0..1), lumaRelief (bool), reliefDepth (0..6), vignette (0..1), plexus (bool), plexusDistance (0.5..5), phosphorGlow (0..2)
- set_camera_param({ param, value, chapterId? }) // params: type ('static'|'dollyPush'|'lateralTrack'|'breathing'|'recoilShake'|'vertigo'|'vista'|'pullBack'|'orbit'), dist, panX, panY, fov, roll, charScale
- bind_clip({ clipId, chapterIndex })
- save_clip({ name, sourceId, inSec, outSec, mode?, speed?, tags?, notes? })
- add_note({ title, text, timeStart?, timeEnd?, target?, tags? })
- run_command({ action, range? }) // actions: 'sheet', 'build', 'audio', 'preview', 'video', 'bank', 'features'
- capture_frame({})

Pluggable Creative Skills:
${skillLines}

Current Studio Context:
${JSON.stringify(projectContext, null, 2).slice(0, 6000)}

Attached References:
${JSON.stringify(attachments, null, 2).slice(0, 3000)}

Whenever you propose changes or actions in the Studio, include a fenced \`\`\`slopscore-action JSON block:
\`\`\`slopscore-action
{
  "type": "action",
  "title": "Short descriptive title",
  "summary": "What this proposal changes",
  "skill": "slopscore",
  "calls": [
    { "tool": "set_shader_param", "args": { "param": "chromaticAberration", "value": 0.35 } }
  ]
}
\`\`\`
Keep your commentary concise and director-focused.`;
}

/**
 * Call the selected LLM provider (or built-in fallback) and return `{ text, proposals, providerUsed, modelUsed }`.
 */
export async function chatWithAssistant({
  provider = 'builtin',
  model,
  url,
  apiKey,
  messages = [],
  attachments = [],
  projectContext = {},
  skills = [],
  fallback = true
} = {}) {
  const id = resolveProviderId(provider);
  const spec = PROVIDERS[id];

  if (spec.protocol === 'builtin') {
    return builtinDirectorReply({ messages, attachments, projectContext, skills });
  }

  const chosenModel = model || spec.defaultModel;
  const baseUrl = String(url || spec.defaultUrl).replace(/\/+$/, '');
  const key = resolveApiKey(id, apiKey);
  const systemPrompt = buildSystemPrompt({ projectContext, attachments, skills });

  const fullMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({ role: m.role || 'user', content: String(m.content || '') }))
  ];

  const headers = { 'Content-Type': 'application/json' };
  if (key) {
    if (spec.protocol === 'anthropic') {
      headers['x-api-key'] = key;
      headers['anthropic-version'] = '2023-06-01';
    } else if (spec.protocol === 'google') {
      headers['x-goog-api-key'] = key;
    } else {
      headers['Authorization'] = `Bearer ${key}`;
    }
  }

  try {
    let rawReply = '';
    if (spec.protocol === 'ollama') {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: chosenModel,
          messages: fullMessages,
          stream: false,
          options: { num_ctx: 8192, num_predict: 2048, temperature: 0.3 }
        }),
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      const data = await res.json();
      rawReply = data?.message?.content || '';
    } else if (spec.protocol === 'anthropic') {
      if (!key) throw new Error('Missing ANTHROPIC_API_KEY');
      const res = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: chosenModel,
          max_tokens: 2048,
          system: systemPrompt,
          messages: fullMessages.filter(m => m.role !== 'system')
        }),
        signal: AbortSignal.timeout(45000)
      });
      if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
      const data = await res.json();
      rawReply = (data.content || []).map(p => p.text || '').join('\n');
    } else if (spec.protocol === 'google') {
      if (!key) throw new Error('Missing GEMINI_API_KEY');
      const endpoint = `${baseUrl}/models/${encodeURIComponent(chosenModel)}:generateContent`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: fullMessages.filter(m => m.role !== 'system').map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          }))
        }),
        signal: AbortSignal.timeout(45000)
      });
      if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
      const data = await res.json();
      rawReply = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('\n');
    } else {
      // OpenAI-compatible (LM Studio, MLX, Unsloth, OpenAI, OpenRouter)
      const endpoint = baseUrl.endsWith('/v1') ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: chosenModel,
          messages: fullMessages,
          stream: false,
          temperature: 0.3
        }),
        signal: AbortSignal.timeout(45000)
      });
      if (!res.ok) throw new Error(`${spec.name} HTTP ${res.status}`);
      const data = await res.json();
      rawReply = data?.choices?.[0]?.message?.content || '';
    }

    const extracted = extractProposalsFromText(rawReply);
    if (extracted.proposals.length === 0) {
      // Synthesize companion proposals using the deterministic rule assistant if model didn't emit any block
      const fallbackResult = builtinDirectorReply({ messages, attachments, projectContext, skills });
      return {
        text: extracted.text || fallbackResult.text,
        proposals: fallbackResult.proposals,
        providerUsed: id,
        modelUsed: chosenModel
      };
    }
    return {
      text: extracted.text,
      proposals: extracted.proposals,
      providerUsed: id,
      modelUsed: chosenModel
    };
  } catch (err) {
    if (!fallback) throw err;
    const fb = builtinDirectorReply({ messages, attachments, projectContext, skills });
    return {
      ...fb,
      fallbackReason: err.message
    };
  }
}
