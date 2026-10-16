// renderers/shared/host-runtime.js
// Universal browser host runtime for mounting any Slopscore 2.0 renderer adapter
// in either the interactive Director Studio or the headless capture page.

import { createTimeline } from '../../kit/frame-context.js';
import { normalizeProject } from '../../kit/project-schema.js';
import { createAssetManager } from './asset-manager.js';

const BROWSER_RENDERERS = new Set(['threejs', 'webgpu', 'pixijs', 'p5js', 'hyperframes', 'fframes']);

/**
 * Mount a browser renderer adapter inside `container` (and/or `canvas`).
 *
 * @param {object} opts
 * @param {HTMLElement} [opts.container]
 * @param {HTMLCanvasElement} [opts.canvas]
 * @param {string} [opts.rendererId]
 * @param {object} opts.projectData JSON payload from GET /api/project (or { project, clips, bank, overrides, features })
 * @param {number} [opts.width]
 * @param {number} [opts.height]
 * @param {string} [opts.baseUrl='/project']
 */
export async function mountRenderer({
  container,
  canvas: existingCanvas,
  rendererId,
  projectData = {},
  width,
  height,
  baseUrl = '/project'
} = {}) {
  const rawProject = projectData.project || projectData;
  const project = rawProject.chapters && rawProject.audio ? rawProject : normalizeProject(rawProject);
  const [W, H] = [width || project.resolution?.[0] || 1280, height || project.resolution?.[1] || 720];

  const requestedId = rendererId || project.renderer || 'threejs';
  const effectiveId = BROWSER_RENDERERS.has(requestedId) ? requestedId : 'threejs';

  // Ensure container and canvas exist
  const hostEl = container || (existingCanvas ? existingCanvas.parentElement : document.body);
  let canvas = existingCanvas;
  if (!canvas && hostEl) {
    canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    hostEl.appendChild(canvas);
  } else if (canvas) {
    canvas.width = W;
    canvas.height = H;
  }

  // Load features.bin if featuresUrl is provided and features aren't already in projectData
  let features = projectData.features || null;
  if (!features && projectData.featuresUrl && typeof fetch !== 'undefined') {
    try {
      const res = await fetch(projectData.featuresUrl);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        features = new Float32Array(buf);
      }
    } catch {}
  }

  // Initialize AssetManager
  const assets = createAssetManager({
    baseUrl,
    project,
    clips: projectData.clips || [],
    bank: projectData.bank || null,
    bankBuffer: projectData.bankBuffer || null
  });
  await assets.ready();

  // Optionally load user scene module
  let scene = null;
  if (project.scene) {
    const sceneUrl = project.scene.startsWith('/')
      ? project.scene
      : `${String(baseUrl).replace(/\/+$/, '')}/${String(project.scene).replace(/^\.?\//, '')}`;
    try {
      scene = await import(/* @vite-ignore */ sceneUrl);
    } catch (err) {
      console.warn(`[Slopscore] Could not load custom scene module "${sceneUrl}":`, err);
    }
  }

  // Dynamically import the renderer adapter
  const modUrl = `/slopscore/renderers/${effectiveId}/index.js`;
  const mod = await import(/* @vite-ignore */ modUrl);

  let currentOverrides = projectData.overrides || { shaders: {}, camera: {}, chapters: {} };
  let timeline = createTimeline(project, {
    features,
    clips: projectData.clips || [],
    bank: projectData.bank || null,
    overrides: currentOverrides
  });

  const instance = await mod.createRenderer({
    canvas,
    container: hostEl,
    width: W,
    height: H,
    project,
    scene,
    assets
  });

  async function renderContext(ctx) {
    ctx.assets = assets;
    return await instance.renderFrame(ctx);
  }

  async function renderAt(t) {
    const ctx = timeline.contextAt(t);
    ctx.assets = assets;
    await instance.renderFrame(ctx);
    return ctx;
  }

  async function renderFrame(frameIndex) {
    const ctx = timeline.contextForFrame(frameIndex);
    ctx.assets = assets;
    await instance.renderFrame(ctx);
    return ctx;
  }

  function setOverrides(nextOverrides) {
    currentOverrides = nextOverrides || { shaders: {}, camera: {}, chapters: {} };
    timeline = createTimeline(project, {
      features,
      clips: projectData.clips || [],
      bank: projectData.bank || null,
      overrides: currentOverrides
    });
  }

  return {
    rendererId: effectiveId,
    meta: mod.meta,
    canvas,
    container: hostEl,
    assets,
    get timeline() { return timeline; },
    instance,
    renderAt,
    renderFrame,
    renderContext,
    setOverrides,
    setParam: (name, value) => instance.setParam?.(name, value),
    getParams: () => instance.getParams?.() || {},
    resize: (w, h) => {
      if (canvas) {
        canvas.width = w;
        canvas.height = h;
      }
      instance.resize?.(w, h);
    },
    dispose: () => instance.dispose?.()
  };
}
