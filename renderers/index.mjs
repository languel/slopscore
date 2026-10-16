// renderers/index.mjs
// Central registry and helper exports for all 7 Slopscore 2.0 renderers:
//   native, webgpu, threejs, fframes, hyperframes, pixijs, p5js.

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { meta as nativeMeta } from './native/index.js';
import { meta as webgpuMeta } from './webgpu/index.js';
import { meta as threejsMeta } from './threejs/index.js';
import { meta as fframesMeta } from './fframes/index.js';
import { meta as hyperframesMeta } from './hyperframes/index.js';
import { meta as pixijsMeta } from './pixijs/index.js';
import { meta as p5jsMeta } from './p5js/index.js';
import {
  findChromeExecutable,
  renderBrowserFrames,
  renderBrowserVideo,
  renderBrowserSheet,
  softwareRenderFrameRGBA,
  startCaptureServer
} from './shared/capture.mjs';

export const RENDERERS_DIR = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
export const NATIVE_SOURCE_PATH = path.join(RENDERERS_DIR, 'native', 'native-render-core.m');
export const NATIVE_HEADER_PATH = path.join(RENDERERS_DIR, 'native', 'context.h');
export const NATIVE_DEFAULT_BIN = path.join(RENDERERS_DIR, 'native', 'native-render');
export const HOST_HTML_PATH = path.join(RENDERERS_DIR, 'shared', 'host.html');

export const RENDERER_LIST = [
  {
    ...nativeMeta,
    adapterPath: path.join(RENDERERS_DIR, 'native', 'index.js'),
    sourcePath: NATIVE_SOURCE_PATH,
    binaryPath: NATIVE_DEFAULT_BIN,
    browserUrl: '/slopscore/renderers/native/index.js'
  },
  {
    ...webgpuMeta,
    adapterPath: path.join(RENDERERS_DIR, 'webgpu', 'index.js'),
    browserUrl: '/slopscore/renderers/webgpu/index.js'
  },
  {
    ...threejsMeta,
    adapterPath: path.join(RENDERERS_DIR, 'threejs', 'index.js'),
    browserUrl: '/slopscore/renderers/threejs/index.js'
  },
  {
    ...fframesMeta,
    adapterPath: path.join(RENDERERS_DIR, 'fframes', 'index.js'),
    cargoPath: path.join(RENDERERS_DIR, 'fframes', 'Cargo.toml'),
    browserUrl: '/slopscore/renderers/fframes/index.js'
  },
  {
    ...hyperframesMeta,
    adapterPath: path.join(RENDERERS_DIR, 'hyperframes', 'index.js'),
    browserUrl: '/slopscore/renderers/hyperframes/index.js'
  },
  {
    ...pixijsMeta,
    adapterPath: path.join(RENDERERS_DIR, 'pixijs', 'index.js'),
    browserUrl: '/slopscore/renderers/pixijs/index.js'
  },
  {
    ...p5jsMeta,
    adapterPath: path.join(RENDERERS_DIR, 'p5js', 'index.js'),
    browserUrl: '/slopscore/renderers/p5js/index.js'
  }
];

export const RENDERERS = Object.fromEntries(RENDERER_LIST.map(r => [r.id, r]));

export function listRenderers() {
  return RENDERER_LIST;
}

export function getRenderer(id = 'native') {
  return RENDERERS[id] || RENDERERS.threejs;
}

/**
 * Compile `native-render-core.m` (or a custom `.m` source file) into `outBin`.
 */
export function compileNativeRenderer({
  source = NATIVE_SOURCE_PATH,
  outBin = NATIVE_DEFAULT_BIN
} = {}) {
  const args = [
    '-O3',
    '-fobjc-arc',
    '-I', path.join(RENDERERS_DIR, 'native'),
    '-framework', 'Foundation',
    '-framework', 'CoreGraphics',
    '-framework', 'CoreText',
    '-framework', 'ImageIO',
    source,
    '-o', outBin
  ];
  execFileSync('clang', args, { stdio: 'inherit' });
  return outBin;
}

export {
  findChromeExecutable,
  renderBrowserFrames,
  renderBrowserVideo,
  renderBrowserSheet,
  softwareRenderFrameRGBA,
  startCaptureServer
};

export default RENDERERS;
