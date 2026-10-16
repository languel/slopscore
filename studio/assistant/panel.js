// studio/assistant/panel.js — Embedded Genereti Multi-Provider Studio Assistant Drawer.
// Implements CONTRACTS.md §10:
//   export function mountAssistant({ studio, root })
// Features:
//   - Provider & Model selector (Built-in Offline Director, Ollama, LM Studio, MLX, Unsloth, Gemini, Claude, OpenAI, OpenRouter)
//   - Pluggable Creative Skill pills (@anatomy, @ff-tracker, @codeanimation, @slopscore)
//   - @ Context Attachment Picker (@clip:..., @bar:..., @chapter:..., @note:...)
//   - Interactive Proposal Review Cards with Apply, Dismiss, and one-click Undo (via studio.getOverrides() / setOverrides())

const DEFAULT_PROVIDERS = [
  { id: 'builtin', name: 'Built-in Director (Offline)', kind: 'builtin', defaultUrl: 'builtin://director', defaultModel: 'slopscore-director-v2', models: ['slopscore-director-v2', 'slopscore-shader-synthesizer', 'slopscore-loop-curator'] },
  { id: 'ollama', name: 'Ollama (Local)', kind: 'local', defaultUrl: 'http://localhost:11434', defaultModel: 'qwen2.5-coder:7b', models: ['qwen2.5-coder:7b', 'llama3.2:latest'] },
  { id: 'lmstudio', name: 'LM Studio (Local)', kind: 'local', defaultUrl: 'http://localhost:1234/v1', defaultModel: 'local-model', models: ['local-model'] },
  { id: 'mlx', name: 'MLX / llama.cpp (Local)', kind: 'local', defaultUrl: 'http://localhost:8080/v1', defaultModel: 'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit', models: ['mlx-community/Qwen2.5-Coder-7B-Instruct-4bit'] },
  { id: 'unsloth', name: 'Unsloth (Local)', kind: 'local', defaultUrl: 'http://localhost:8000/v1', defaultModel: 'unsloth-model', models: ['unsloth-model'] },
  { id: 'gemini', name: 'Google Gemini', kind: 'cloud', defaultUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.5-flash', models: ['gemini-2.5-flash', 'gemini-2.5-pro'] },
  { id: 'anthropic', name: 'Anthropic Claude', kind: 'cloud', defaultUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-20250514', models: ['claude-sonnet-4-20250514', 'claude-3-7-sonnet-latest'] },
  { id: 'openai', name: 'OpenAI', kind: 'cloud', defaultUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', models: ['gpt-4o-mini', 'gpt-4o'] },
  { id: 'openrouter', name: 'OpenRouter', kind: 'cloud', defaultUrl: 'https://openrouter.ai/api/v1', defaultModel: 'anthropic/claude-3.5-sonnet', models: ['anthropic/claude-3.5-sonnet', 'google/gemini-2.5-flash'] }
];

const DEFAULT_SKILLS = [
  { id: 'anatomy', name: 'anatomy', trigger: '@anatomy', description: 'Isometric SVG/WebGL dial gauges & test rigs' },
  { id: 'ff-tracker', name: 'ff-tracker', trigger: '@ff-tracker', description: 'Optical flow & luma relief contour tracking' },
  { id: 'codeanimation', name: 'codeanimation', trigger: '@codeanimation', description: '2D p5.js & p5.brush motion graphics' },
  { id: 'slopscore', name: 'slopscore', trigger: '@slopscore', description: 'Dual particle constellation & CRT shaders' }
];

function injectStyles() {
  if (document.getElementById('slopscore-assistant-styles')) return;
  const style = document.createElement('style');
  style.id = 'slopscore-assistant-styles';
  style.textContent = `
    .ss-assistant-panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      width: 100%;
      background: var(--bg-secondary, #141518);
      color: var(--text-primary, #e4e5e8);
      font-size: 12px;
      user-select: none;
      overflow: hidden;
    }
    .ss-asst-header {
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-color, #262830);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      background: var(--bg-secondary, #141518);
    }
    .ss-asst-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--accent-teal, #64b5a0);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .ss-asst-toolbar {
      padding: 8px 10px;
      border-bottom: 1px solid var(--border-color, #262830);
      background: var(--bg-tertiary, #1b1d22);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .ss-asst-row {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .ss-asst-select, .ss-asst-input {
      background: var(--bg-primary, #0e0f12);
      border: 1px solid var(--border-color, #262830);
      color: var(--text-primary, #e4e5e8);
      border-radius: 4px;
      padding: 4px 6px;
      font-size: 11px;
      font-family: inherit;
      min-width: 0;
    }
    .ss-asst-select:focus, .ss-asst-input:focus, .ss-asst-textarea:focus {
      outline: none;
      border-color: var(--accent-teal, #64b5a0);
    }
    .ss-skills-bar {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      padding: 6px 10px;
      border-bottom: 1px solid var(--border-color, #262830);
      background: var(--bg-secondary, #141518);
    }
    .ss-skill-pill {
      background: var(--bg-tertiary, #1b1d22);
      border: 1px solid var(--border-color, #262830);
      color: var(--accent-gold, #c6a66d);
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      cursor: pointer;
      transition: all 0.12s ease;
    }
    .ss-skill-pill:hover {
      border-color: var(--accent-gold, #c6a66d);
      background: color-mix(in srgb, var(--accent-gold, #c6a66d) 15%, transparent);
    }
    .ss-asst-messages {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      user-select: text;
    }
    .ss-msg {
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid var(--border-color, #262830);
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .ss-msg-user {
      background: var(--bg-tertiary, #1b1d22);
      align-self: flex-end;
      max-width: 92%;
    }
    .ss-msg-assistant {
      background: var(--bg-primary, #0e0f12);
      border-color: color-mix(in srgb, var(--accent-teal, #64b5a0) 35%, var(--border-color, #262830));
    }
    .ss-msg-role {
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted, #62666f);
      margin-bottom: 3px;
      display: flex;
      justify-content: space-between;
    }
    .ss-proposal-card {
      background: var(--bg-tertiary, #1b1d22);
      border: 1px solid color-mix(in srgb, var(--accent-gold, #c6a66d) 45%, var(--border-color, #262830));
      border-radius: 6px;
      padding: 9px 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 4px;
    }
    .ss-proposal-card.applied {
      border-color: var(--accent-teal, #64b5a0);
      background: color-mix(in srgb, var(--accent-teal, #64b5a0) 8%, var(--bg-tertiary, #1b1d22));
    }
    .ss-proposal-card.dismissed {
      opacity: 0.5;
      border-style: dashed;
    }
    .ss-proposal-title {
      font-size: 11.5px;
      font-weight: 700;
      color: var(--text-primary, #e4e5e8);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
    }
    .ss-proposal-summary {
      font-size: 11px;
      color: var(--text-secondary, #9a9ea6);
    }
    .ss-proposal-calls {
      background: var(--bg-primary, #0e0f12);
      border: 1px solid var(--border-color, #262830);
      border-radius: 4px;
      padding: 5px 7px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10px;
      color: var(--accent-teal, #64b5a0);
      max-height: 110px;
      overflow-y: auto;
      white-space: pre-wrap;
    }
    .ss-proposal-actions {
      display: flex;
      gap: 6px;
      align-items: center;
      justify-content: flex-end;
    }
    .ss-asst-footer {
      border-top: 1px solid var(--border-color, #262830);
      padding: 8px 10px;
      background: var(--bg-secondary, #141518);
      display: flex;
      flex-direction: column;
      gap: 6px;
      position: relative;
    }
    .ss-chips-row {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .ss-chip {
      background: color-mix(in srgb, var(--accent-teal, #64b5a0) 15%, var(--bg-tertiary, #1b1d22));
      border: 1px solid var(--accent-teal, #64b5a0);
      color: var(--accent-teal, #64b5a0);
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
    }
    .ss-picker-popover {
      position: absolute;
      bottom: calc(100% + 4px);
      left: 10px;
      right: 10px;
      max-height: 220px;
      overflow-y: auto;
      background: var(--bg-secondary, #141518);
      border: 1px solid var(--border-focus, #424654);
      border-radius: 6px;
      box-shadow: 0 -6px 20px rgba(0,0,0,0.55);
      z-index: 600;
      padding: 6px;
      display: none;
      flex-direction: column;
      gap: 3px;
    }
    .ss-picker-popover.open {
      display: flex;
    }
    .ss-picker-item {
      background: transparent;
      border: none;
      color: var(--text-primary, #e4e5e8);
      text-align: left;
      padding: 5px 8px;
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .ss-picker-item:hover {
      background: var(--bg-hover, #24262d);
      color: var(--accent-teal, #64b5a0);
    }
    .ss-asst-textarea {
      width: 100%;
      min-height: 58px;
      max-height: 130px;
      resize: vertical;
      background: var(--bg-primary, #0e0f12);
      border: 1px solid var(--border-color, #262830);
      border-radius: 5px;
      color: var(--text-primary, #e4e5e8);
      padding: 6px 8px;
      font-family: inherit;
      font-size: 11.5px;
      line-height: 1.4;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Mount the Genereti Studio Assistant into `root`.
 * @param {{ studio?: any, root?: HTMLElement } | HTMLElement} opts
 */
export function mountAssistant(opts = {}) {
  injectStyles();
  const rootEl = opts instanceof HTMLElement ? opts : (opts.root || document.getElementById('assistant-drawer-host'));
  const getStudio = () => (opts && opts.studio) || window.slopscore?.studio;
  if (!rootEl) return null;

  let providers = [...DEFAULT_PROVIDERS];
  let skills = [...DEFAULT_SKILLS];
  let messages = [];
  let attachments = [];
  let undoStack = []; // [{ label, overrides, state }]
  let selectedProvider = localStorage.getItem('slopscore.assistant.provider') || 'builtin';
  let selectedModel = localStorage.getItem('slopscore.assistant.model') || '';
  let customUrl = localStorage.getItem('slopscore.assistant.url') || '';
  let sessionApiKey = '';

  rootEl.innerHTML = '';
  const panel = document.createElement('section');
  panel.className = 'ss-assistant-panel';
  panel.setAttribute('aria-label', 'Genereti Studio Assistant');

  panel.innerHTML = `
    <div class="ss-asst-header">
      <div class="ss-asst-title">
        <svg class="icon" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg>
        <span>Genereti Studio Assistant</span>
      </div>
      <div style="display:flex; gap:4px; align-items:center;">
        <button type="button" id="ss-asst-undo-btn" class="btn btn-sm" title="Undo last applied proposal" disabled>Undo</button>
        <button type="button" id="ss-asst-clear-btn" class="btn btn-sm" title="New conversation">Clear</button>
        <button type="button" id="ss-asst-close-btn" class="btn btn-icon-only" title="Close Assistant Drawer" style="border:none;">
          <svg class="icon" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
    </div>

    <div class="ss-asst-toolbar">
      <div class="ss-asst-row">
        <select id="ss-asst-provider" class="ss-asst-select" style="flex:1;" title="LLM Provider"></select>
        <select id="ss-asst-model" class="ss-asst-select" style="flex:1.1;" title="Model"></select>
        <button type="button" id="ss-asst-cfg-toggle" class="btn btn-icon-only" title="Endpoint & API Key Settings">
          <svg class="icon icon-sm" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75"/></svg>
        </button>
      </div>
      <div id="ss-asst-cfg-box" style="display:none; flex-direction:column; gap:5px; padding-top:4px;">
        <input type="text" id="ss-asst-url" class="ss-asst-input" placeholder="Server URL (e.g. http://localhost:11434)">
        <input type="password" id="ss-asst-key" class="ss-asst-input" placeholder="Optional API Key (session only, never stored)" autocomplete="off">
      </div>
    </div>

    <div id="ss-skills-bar" class="ss-skills-bar" title="Click a Creative Skill pill to insert into prompt"></div>

    <div id="ss-asst-messages" class="ss-asst-messages"></div>

    <div class="ss-asst-footer">
      <div id="ss-picker-popover" class="ss-picker-popover"></div>
      <div id="ss-chips-row" class="ss-chips-row"></div>
      <textarea id="ss-asst-input" class="ss-asst-textarea" placeholder="Direct the piece… Type @ to attach clip/bar/chapter/note, or click @anatomy / @ff-tracker"></textarea>
      <div class="ss-asst-row" style="justify-content:space-between;">
        <div style="display:flex; gap:4px; align-items:center;">
          <button type="button" id="ss-asst-attach-btn" class="btn btn-sm" title="Attach @clip, @bar, @chapter, or @note">+ @Context</button>
          <span id="ss-asst-status" style="font-size:10px; color:var(--text-muted);">Ready</span>
        </div>
        <button type="button" id="ss-asst-send-btn" class="btn btn-sm btn-teal">Send Proposal</button>
      </div>
    </div>
  `;

  rootEl.appendChild(panel);

  const selProvider = panel.querySelector('#ss-asst-provider');
  const selModel = panel.querySelector('#ss-asst-model');
  const inpUrl = panel.querySelector('#ss-asst-url');
  const inpKey = panel.querySelector('#ss-asst-key');
  const cfgBox = panel.querySelector('#ss-asst-cfg-box');
  const skillsBar = panel.querySelector('#ss-skills-bar');
  const msgContainer = panel.querySelector('#ss-asst-messages');
  const chipsRow = panel.querySelector('#ss-chips-row');
  const pickerPopover = panel.querySelector('#ss-picker-popover');
  const txtInput = panel.querySelector('#ss-asst-input');
  const statusEl = panel.querySelector('#ss-asst-status');
  const undoBtn = panel.querySelector('#ss-asst-undo-btn');

  function setStatus(txt) {
    if (statusEl) statusEl.textContent = txt;
  }

  function renderProviderSelect() {
    selProvider.innerHTML = '';
    for (const p of providers) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === selectedProvider) opt.selected = true;
      selProvider.appendChild(opt);
    }
    updateModelOptions();
  }

  function updateModelOptions(customList) {
    const prov = providers.find(p => p.id === selectedProvider) || providers[0];
    const list = Array.isArray(customList) && customList.length ? customList : (prov.models || [prov.defaultModel]);
    selModel.innerHTML = '';
    for (const m of list) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      if (m === selectedModel) opt.selected = true;
      selModel.appendChild(opt);
    }
    if (!selectedModel || !list.includes(selectedModel)) {
      selectedModel = list[0] || prov.defaultModel;
      selModel.value = selectedModel;
    }
    inpUrl.value = customUrl || prov.defaultUrl || '';
  }

  function renderSkillsBar() {
    skillsBar.innerHTML = '';
    for (const s of skills) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ss-skill-pill';
      btn.textContent = `@${s.name}`;
      btn.title = s.description || s.name;
      btn.addEventListener('click', () => {
        const token = `@${s.name} `;
        if (!txtInput.value.includes(`@${s.name}`)) {
          txtInput.value = (txtInput.value ? txtInput.value.trimEnd() + ' ' : '') + token;
        }
        txtInput.focus();
      });
      skillsBar.appendChild(btn);
    }
  }

  function renderAttachmentChips() {
    chipsRow.innerHTML = '';
    attachments.forEach((att, idx) => {
      const chip = document.createElement('span');
      chip.className = 'ss-chip';
      chip.innerHTML = `<span>${att.token}</span><span style="opacity:0.7;">×</span>`;
      chip.title = att.label || att.token;
      chip.addEventListener('click', () => {
        attachments.splice(idx, 1);
        renderAttachmentChips();
      });
      chipsRow.appendChild(chip);
    });
  }

  async function openContextPicker(filter = '') {
    const studio = getStudio();
    const items = [];
    try {
      const st = studio ? await studio.getState() : null;
      if (st) {
        const barNum = st.bar ? st.bar.toFixed(1) : '1.0';
        items.push({
          token: `@bar:${barNum}`,
          label: `Current Playhead — Bar ${barNum} (${(st.time || 0).toFixed(2)}s)`,
          kind: 'bar',
          data: { bar: parseFloat(barNum), time: st.time }
        });
      }
      const proj = studio ? await studio.getProject() : null;
      for (const ch of (proj?.project?.chapters || proj?.chapters || [])) {
        items.push({
          token: `@chapter:${ch.id}`,
          label: `Chapter ${ch.index}: ${ch.name} (Bar ${ch.startBar}–${ch.endBar})`,
          kind: 'chapter',
          data: ch
        });
      }
      const clips = studio ? await studio.getClips() : [];
      for (const c of (clips || [])) {
        items.push({
          token: `@clip:${c.id}`,
          label: `Clip: ${c.name} (${c.sourceId || ''})`,
          kind: 'clip',
          data: c
        });
      }
      const notes = studio ? await studio.getNotes() : [];
      for (const n of (notes || []).slice(0, 12)) {
        items.push({
          token: `@note:${n.id}`,
          label: `Note: ${n.title} (@${(n.timeStart || 0).toFixed(1)}s)`,
          kind: 'note',
          data: n
        });
      }
    } catch {
      // fallback static item
    }

    const q = filter.toLowerCase();
    const matched = items.filter(it => !q || it.token.toLowerCase().includes(q) || it.label.toLowerCase().includes(q));

    pickerPopover.innerHTML = '';
    if (matched.length === 0) {
      pickerPopover.classList.remove('open');
      return;
    }

    matched.slice(0, 16).forEach(it => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ss-picker-item';
      btn.innerHTML = `<span style="font-family:monospace; color:var(--accent-teal);">${it.token}</span><span style="color:var(--text-secondary); font-size:10px; margin-left:8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${it.label}</span>`;
      btn.addEventListener('click', () => {
        if (!attachments.some(a => a.token === it.token)) {
          attachments.push(it);
          renderAttachmentChips();
        }
        // Replace trailing @query in textarea if triggered by typing @
        txtInput.value = txtInput.value.replace(/@[a-zA-Z0-9_:.-]*$/, '') + `${it.token} `;
        pickerPopover.classList.remove('open');
        txtInput.focus();
      });
      pickerPopover.appendChild(btn);
    });
    pickerPopover.classList.add('open');
  }

  async function executeToolCall(call) {
    const studio = getStudio();
    const webmcp = window.slopscore?.webmcp;
    if (webmcp && typeof webmcp.callTool === 'function') {
      return await webmcp.callTool(call.tool, call.args || {});
    }
    if (!studio) throw new Error('Studio API not initialized');
    const a = call.args || {};
    switch (call.tool) {
      case 'studio_get_state': return await studio.getState();
      case 'studio_seek': return await studio.seek(a);
      case 'studio_play': return await studio.play();
      case 'studio_pause': return await studio.pause();
      case 'loop_automatch': return await studio.automatchLoop(a);
      case 'set_shader_param': return await studio.setShaderParam(a);
      case 'set_camera_param': return await studio.setCameraParam(a);
      case 'bind_clip': return await studio.bindClip(a);
      case 'save_clip': return await studio.saveClip(a);
      case 'add_note': return await studio.addNote(a);
      case 'run_command': return await studio.runCommand(a);
      case 'capture_frame': return await studio.captureFrame();
      case 'list_clips': return await studio.getClips();
      case 'get_project': return await studio.getProject();
      default:
        throw new Error(`Unknown tool: ${call.tool}`);
    }
  }

  async function applyProposal(proposal, cardEl, applyBtn) {
    const studio = getStudio();
    try {
      applyBtn.disabled = true;
      applyBtn.textContent = 'Applying…';
      // Snapshot overrides & state for one-click Undo
      const prevOverrides = studio ? structuredClone(await studio.getOverrides()) : {};
      const prevState = studio ? structuredClone(await studio.getState()) : {};

      const results = [];
      for (const call of (proposal.calls || [])) {
        results.push(await executeToolCall(call));
      }

      undoStack.push({
        label: proposal.title,
        overrides: prevOverrides,
        state: prevState
      });
      undoBtn.disabled = false;

      cardEl.classList.add('applied');
      applyBtn.textContent = 'Applied ✓';
      setStatus(`Applied: ${proposal.title}`);
      return results;
    } catch (err) {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Apply';
      setStatus(`Error: ${err.message}`);
    }
  }

  async function undoLastProposal() {
    const last = undoStack.pop();
    if (!last) return;
    undoBtn.disabled = undoStack.length === 0;
    const studio = getStudio();
    if (!studio) return;
    try {
      if (last.overrides) await studio.setOverrides(last.overrides);
      if (last.state && typeof last.state.time === 'number') {
        await studio.seek({ time: last.state.time });
      }
      setStatus(`Undid: ${last.label}`);
      appendMessage('assistant', `Restored prior snapshot (undid **${last.label}**).`, []);
    } catch (err) {
      setStatus(`Undo error: ${err.message}`);
    }
  }

  function createProposalCard(proposal) {
    const card = document.createElement('div');
    card.className = 'ss-proposal-card';
    card.dataset.proposalId = proposal.id || '';

    const skillBadge = proposal.skill ? `<span class="ss-skill-pill" style="cursor:default;">@${proposal.skill}</span>` : '';
    const callsPreview = (proposal.calls || [])
      .map(c => `${c.tool}(${JSON.stringify(c.args || {})})`)
      .join('\n');

    card.innerHTML = `
      <div class="ss-proposal-title">
        <span>${proposal.title || 'Studio Proposal'}</span>
        ${skillBadge}
      </div>
      <div class="ss-proposal-summary">${proposal.summary || ''}</div>
      <div class="ss-proposal-calls">${callsPreview}</div>
      <div class="ss-proposal-actions">
        <button type="button" class="btn btn-sm ss-btn-dismiss">Dismiss</button>
        <button type="button" class="btn btn-sm btn-gold ss-btn-apply">Apply</button>
      </div>
    `;

    const applyBtn = card.querySelector('.ss-btn-apply');
    const dismissBtn = card.querySelector('.ss-btn-dismiss');

    applyBtn.addEventListener('click', () => applyProposal(proposal, card, applyBtn));
    dismissBtn.addEventListener('click', () => {
      card.classList.add('dismissed');
      applyBtn.disabled = true;
      dismissBtn.disabled = true;
      dismissBtn.textContent = 'Dismissed';
      setStatus(`Dismissed: ${proposal.title}`);
    });

    return card;
  }

  function appendMessage(role, text, proposals = [], meta = {}) {
    const wrap = document.createElement('div');
    wrap.className = `ss-msg ss-msg-${role}`;

    const roleHeader = document.createElement('div');
    roleHeader.className = 'ss-msg-role';
    roleHeader.innerHTML = `<span>${role === 'user' ? 'Director' : 'Genereti Assistant'}</span><span>${meta.modelUsed || ''}</span>`;

    const body = document.createElement('div');
    body.textContent = text;

    wrap.appendChild(roleHeader);
    wrap.appendChild(body);

    for (const prop of (proposals || [])) {
      wrap.appendChild(createProposalCard(prop));
    }

    msgContainer.appendChild(wrap);
    msgContainer.scrollTop = msgContainer.scrollHeight;
  }

  async function sendPrompt() {
    const content = txtInput.value.trim();
    if (!content) return;

    txtInput.value = '';
    pickerPopover.classList.remove('open');

    const activeAttachments = [...attachments];
    attachments = [];
    renderAttachmentChips();

    messages.push({ role: 'user', content });
    appendMessage('user', content);
    setStatus('Synthesizing proposal…');

    const studio = getStudio();
    let projectContext = {};
    try {
      if (studio) {
        const [st, overrides] = await Promise.all([studio.getState(), studio.getOverrides()]);
        projectContext = { state: st, overrides };
      }
    } catch {
      // ignore
    }

    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProvider,
          model: selectedModel,
          url: inpUrl.value.trim() || undefined,
          apiKey: sessionApiKey || undefined,
          messages: messages.slice(-12),
          attachments: activeAttachments,
          projectContext
        })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);

      messages.push({ role: 'assistant', content: data.reply || data.text || '' });
      appendMessage('assistant', data.reply || data.text || '', data.proposals || [], {
        modelUsed: data.modelUsed || selectedModel
      });
      setStatus(data.fallbackReason ? `Offline Director (${data.fallbackReason})` : `Ready · ${data.providerUsed || selectedProvider}`);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
      appendMessage('assistant', `Assistant error: ${err.message}`);
    }
  }

  // Event wiring
  selProvider.addEventListener('change', async () => {
    selectedProvider = selProvider.value;
    localStorage.setItem('slopscore.assistant.provider', selectedProvider);
    const prov = providers.find(p => p.id === selectedProvider);
    customUrl = prov?.defaultUrl || '';
    inpUrl.value = customUrl;
    updateModelOptions();
    try {
      const res = await fetch('/api/assistant/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: selectedProvider, url: customUrl, apiKey: sessionApiKey })
      });
      const data = await res.json();
      if (Array.isArray(data.models) && data.models.length) updateModelOptions(data.models);
    } catch {
      // keep defaults
    }
  });

  selModel.addEventListener('change', () => {
    selectedModel = selModel.value;
    localStorage.setItem('slopscore.assistant.model', selectedModel);
  });

  inpUrl.addEventListener('change', () => {
    customUrl = inpUrl.value.trim();
    localStorage.setItem('slopscore.assistant.url', customUrl);
  });

  inpKey.addEventListener('input', () => {
    sessionApiKey = inpKey.value.trim();
  });

  panel.querySelector('#ss-asst-cfg-toggle').addEventListener('click', () => {
    cfgBox.style.display = cfgBox.style.display === 'none' ? 'flex' : 'none';
  });

  panel.querySelector('#ss-asst-attach-btn').addEventListener('click', () => {
    if (pickerPopover.classList.contains('open')) {
      pickerPopover.classList.remove('open');
    } else {
      openContextPicker('');
    }
  });

  panel.querySelector('#ss-asst-send-btn').addEventListener('click', sendPrompt);
  undoBtn.addEventListener('click', undoLastProposal);

  panel.querySelector('#ss-asst-clear-btn').addEventListener('click', () => {
    messages = [];
    attachments = [];
    renderAttachmentChips();
    msgContainer.innerHTML = '';
    appendMessage('assistant', 'Ready. Ask to adjust shaders, camera splines, chapter clips, or trigger @anatomy / @ff-tracker / @codeanimation.');
    setStatus('Cleared');
  });

  panel.querySelector('#ss-asst-close-btn').addEventListener('click', () => {
    const drawer = document.getElementById('assistant-drawer');
    if (drawer) drawer.classList.remove('open');
  });

  txtInput.addEventListener('input', () => {
    const beforeCursor = txtInput.value.slice(0, txtInput.selectionStart);
    const m = beforeCursor.match(/@([a-zA-Z0-9_:.-]*)$/);
    if (m) {
      openContextPicker(m[1] || '');
    } else {
      pickerPopover.classList.remove('open');
    }
  });

  txtInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if ((e.metaKey || e.ctrlKey || !e.shiftKey) && e.key === 'Enter') {
      e.preventDefault();
      sendPrompt();
    } else if (e.key === 'Escape') {
      pickerPopover.classList.remove('open');
    }
  });

  // Initial render + async hydration from server
  renderProviderSelect();
  renderSkillsBar();
  appendMessage(
    'assistant',
    'Welcome to the Slopscore 2.0 Director Assistant. Select any Local (Ollama, LM Studio, MLX) or Cloud (Gemini, Claude, OpenAI, OpenRouter) model, or use the Built-in Offline Director.\n\nTry clicking `@anatomy`, `@ff-tracker`, or `+ @Context` to propose live shader, camera, or loop changes.'
  );

  (async () => {
    try {
      const [pRes, sRes] = await Promise.all([
        fetch('/api/assistant/providers'),
        fetch('/api/assistant/skills')
      ]);
      if (pRes.ok) {
        const pData = await pRes.json();
        if (Array.isArray(pData.providers) && pData.providers.length) {
          providers = pData.providers;
          renderProviderSelect();
        }
      }
      if (sRes.ok) {
        const sData = await sRes.json();
        if (Array.isArray(sData.skills) && sData.skills.length) {
          skills = sData.skills;
          renderSkillsBar();
        }
      }
    } catch {
      // use defaults
    }
  })();

  return {
    panel,
    sendPrompt,
    undoLastProposal,
    openContextPicker
  };
}
