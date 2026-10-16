// renderers/webgpu/index.js
// WebGPU Compute & Render Particle Pipeline Adapter for Slopscore 2.0.
// Uses WGSL compute shaders for 3D rig attractors + divergence-free curl-noise fluid advection,
// and gracefully falls back to an isomorphic Canvas2D high-density curl-noise + Dual Particle
// renderer when `navigator.gpu` is unavailable.

import { clamp, lerp } from '../../kit/measure-clock.js';
import { PARTICLE_RIGS } from '../../kit/project-schema.js';
import {
  computeDualParticles,
  drawDualParticles2D,
  curlVelocity2D,
  hashf
} from '../shared/dual-particles.js';

export const meta = {
  id: 'webgpu',
  name: 'WebGPU Compute',
  kind: 'browser',
  output: 'canvas',
  description: 'WebGPU WGSL compute & render particle swarm pipeline with curl-noise turbulence and automatic Canvas2D fallback.',
  params: [
    { name: 'swarmDensity', type: 'number', min: 1, max: 5, step: 1, default: 2, label: 'Swarm Density' },
    { name: 'curlStrength', type: 'number', min: 0, max: 3, step: 0.05, default: 1.25, label: 'Curl Turbulence' },
    { name: 'glowSize', type: 'number', min: 0.5, max: 3, step: 0.05, default: 1.2, label: 'Phosphor Size' }
  ]
};

const WGSL_COMPUTE_AND_RENDER = /* wgsl */ `
struct Uniforms {
  time: f32,
  bass: f32,
  mid: f32,
  high: f32,
  transient: f32,
  glitch: f32,
  camDist: f32,
  fovPx: f32,
  panX: f32,
  panY: f32,
  width: f32,
  height: f32,
  rigId: f32,
  curlStrength: f32,
  glowSize: f32,
  pad0: f32,
};

struct Particle {
  pos: vec4<f32>,
  col: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;

fn hash1(n: f32) -> f32 {
  return fract(sin(n * 127.1 + 311.7) * 43758.5453123);
}

@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  let total = arrayLength(&particles);
  if (idx >= total) { return; }

  let fi = f32(idx);
  let fnTotal = f32(total);
  let t = u.time;
  let rig = i32(u.rigId);

  var x = 0.0;
  var y = 0.0;
  var z = 0.0;
  var r = 0.2;
  var g = 0.95;
  var b = 0.92;

  if (rig == 1) {
    // Clockwork gears
    let ang = (fi / fnTotal) * 12.56637 + t * 0.9;
    let rad = 2.6 + select(-0.25, 0.38, (idx % 6u) < 3u) + u.bass * 0.55;
    x = cos(ang) * rad;
    y = sin(ang) * rad;
    z = sin(t * 2.0 + fi * 0.08) * 0.8;
    r = 0.98; g = 0.78; b = 0.24;
  } else if (rig == 2) {
    // Voxels
    let gx = f32(idx % 12u) - 5.5;
    let gy = f32((idx / 12u) % 12u) - 5.5;
    let gz = f32((idx / 144u) % 8u) - 3.5;
    x = gx * 0.65;
    y = gy * 0.65;
    z = gz * 0.75;
    r = 0.15; g = 0.98; b = 0.88;
  } else if (rig == 3) {
    // Spark rings
    let ang = (fi / fnTotal) * 18.84955 + t * 2.6;
    let burst = select(0.0, u.bass * 2.4 + u.transient * 1.5, (idx % 7u) == 0u);
    let rad = 2.9 + burst;
    x = cos(ang) * rad;
    y = sin(ang) * rad * 0.68;
    z = cos(t * 3.2 + fi * 0.1) * 1.2;
    r = 1.0; g = 0.86; b = 0.32;
  } else if (rig == 5) {
    // Double helix
    let uNorm = fi / fnTotal;
    let hAng = uNorm * 25.1327 + t * 1.6;
    let strand = select(-1.0, 1.0, (idx % 2u) == 0u);
    x = sin(hAng) * 2.6;
    y = (uNorm - 0.5) * 7.0;
    z = cos(hAng) * 2.6 * strand;
    r = 0.98; g = 0.42; b = 0.88;
  } else {
    // Golden spiral / crystal vortex
    let gold = fi * 2.3999632 + t * 1.2;
    let rad = sqrt(fi / fnTotal) * (4.2 + u.bass * 1.1);
    x = cos(gold) * rad;
    y = ((fi / fnTotal) - 0.5) * 5.4;
    z = sin(gold) * rad;
    r = 0.22 + 0.75 * fract(fi * 0.13);
    g = 0.92;
    b = 0.88;
  }

  // Curl turbulence perturbation
  let cx = sin(y * 1.7 + t * 1.8) * cos(z * 1.5 - t * 1.3) * 0.35 * u.curlStrength;
  let cy = cos(x * 1.7 - t * 1.5) * sin(z * 1.6 + t * 1.4) * 0.35 * u.curlStrength;
  x += cx;
  y += cy;

  let alpha = clamp(0.45 + 0.4 * sin(t * 3.5 + fi * 0.05) + u.transient * 0.25, 0.2, 0.95);
  particles[idx].pos = vec4<f32>(x, y, z, 1.0);
  particles[idx].col = vec4<f32>(r, g, b, alpha);
}

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) uv: vec2<f32>,
};

@vertex
fn vsMain(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0)
  );
  let p = particles[iid];
  let z = p.pos.z + u.camDist;
  var out: VSOut;
  if (z < 0.7) {
    out.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    out.color = vec4<f32>(0.0);
    out.uv = vec2<f32>(0.0);
    return out;
  }

  let sx = u.width * u.panX + (p.pos.x / z) * u.fovPx;
  let sy = u.height * u.panY + (p.pos.y / z) * u.fovPx;
  let sz = clamp(24.0 / z, 2.0, 7.5) * u.glowSize * (1.0 + u.transient * 0.7);
  let q = quad[vid];
  let px = sx + q.x * sz * 0.5;
  let py = sy + q.y * sz * 0.5;

  let ndcX = (px / u.width) * 2.0 - 1.0;
  let ndcY = 1.0 - (py / u.height) * 2.0;

  out.position = vec4<f32>(ndcX, ndcY, 0.5, 1.0);
  out.color = p.col;
  out.uv = q;
  return out;
}

@fragment
fn fsMain(in: VSOut) -> @location(0) vec4<f32> {
  let d = length(in.uv);
  if (d > 1.0) { discard; }
  let glow = pow(1.0 - d, 1.4);
  return vec4<f32>(in.color.rgb * (1.0 + glow * 0.45), in.color.a * glow);
}
`;

export async function createRenderer({
  canvas,
  container,
  width = 1280,
  height = 720,
  project,
  scene: userScene,
  assets
} = {}) {
  const targetCanvas = canvas || (() => {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    if (container) container.appendChild(c);
    return c;
  })();

  let W = width;
  let H = height;
  const ctx2d = targetCanvas.getContext('2d');

  const params = {
    swarmDensity: 2,
    curlStrength: 1.25,
    glowSize: 1.2
  };

  // Attempt to initialize WebGPU on an offscreen canvas so we can composite WebGPU compute swarm
  // with archival relief & plexus lines onto targetCanvas deterministically.
  let gpuState = null;
  const gpuCount = 2048;

  if (typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        const device = await adapter.requestDevice();
        const gpuCanvas = document.createElement('canvas');
        gpuCanvas.width = W;
        gpuCanvas.height = H;
        const gpuCtx = gpuCanvas.getContext('webgpu');
        const format = navigator.gpu.getPreferredCanvasFormat();
        gpuCtx.configure({ device, format, alphaMode: 'premultiplied' });

        const module = device.createShaderModule({ code: WGSL_COMPUTE_AND_RENDER });
        const uniformBuffer = device.createBuffer({
          size: 16 * 4,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        const particleBuffer = device.createBuffer({
          size: gpuCount * 32,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });

        const bindGroupLayout = device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX, buffer: { type: 'storage' } }
          ]
        });
        const roBindGroupLayout = device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }
          ]
        });

        const computePipeline = device.createComputePipeline({
          layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
          compute: { module, entryPoint: 'csMain' }
        });

        const renderPipeline = device.createRenderPipeline({
          layout: device.createPipelineLayout({ bindGroupLayouts: [roBindGroupLayout] }),
          vertex: { module, entryPoint: 'vsMain' },
          fragment: {
            module,
            entryPoint: 'fsMain',
            targets: [{
              format,
              blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
                alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }
              }
            }]
          },
          primitive: { topology: 'triangle-list' }
        });

        const computeBG = device.createBindGroup({
          layout: bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: { buffer: particleBuffer } }
          ]
        });
        const renderBG = device.createBindGroup({
          layout: roBindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: { buffer: particleBuffer } }
          ]
        });

        gpuState = {
          device,
          gpuCanvas,
          gpuCtx,
          uniformBuffer,
          computePipeline,
          renderPipeline,
          computeBG,
          renderBG
        };
      }
    } catch (err) {
      console.warn('[Slopscore WebGPU] Falling back to Canvas2D compute emulation:', err.message);
    }
  }

  const userApi = { canvas: targetCanvas, ctx2d, gpuState, assets, project };
  if (userScene && typeof userScene.setup === 'function') {
    await userScene.setup(userApi);
  }

  async function renderFrame(ctx) {
    const t = ctx.time || 0;
    const ch = ctx.chapter || 0;
    const af = ctx.audio || { rms: 0, bass: 0, mid: 0, high: 0, transient: 0, glitch: 0 };
    const cam = ctx.camera || { panX: 0.5, panY: 0.5, dist: 14, fov: 56 };
    const [vpU, vpV] = ctx.vp || [0.5, 0.46];

    // 1. Deep cybernetic void background + archival clip projection
    ctx2d.fillStyle = '#04070f';
    ctx2d.fillRect(0, 0, W, H);

    const clipFrame = (ctx.assets || assets)?.getClipFrame?.(ctx.clip?.a, ctx.clip?.a?.localTime ?? t);
    if (clipFrame) {
      try {
        ctx2d.save();
        ctx2d.globalAlpha = 0.38;
        const pw = W * 0.76;
        const ph = H * 0.76;
        ctx2d.drawImage(clipFrame, vpU * W - pw * 0.5, vpV * H - ph * 0.5, pw, ph);
        ctx2d.restore();
      } catch {}
    }

    // 2. Curl-noise fluid ribbons
    const ribbonCount = Math.floor(32 * (params.swarmDensity || 2));
    for (let i = 0; i < ribbonCount; i++) {
      const seed = i * 1.371;
      const life = (hashf(seed) + t * (0.22 + 0.18 * hashf(seed + 5.0))) % 1.0;
      const u0 = lerp(vpU, 0.5, life) + (hashf(seed + 1.0) - 0.5) * 0.65;
      const v0 = lerp(vpV, 0.5, life) + (hashf(seed + 2.0) - 0.5) * 0.65;
      const c1 = curlVelocity2D(u0, v0, t + (i % 5) * 0.1);
      const scale1 = (1.2 + af.bass * 2.5) * params.curlStrength;
      const u1 = u0 + c1.vx * scale1;
      const v1 = v0 + c1.vy * scale1;
      const c2 = curlVelocity2D(u1, v1, t + 0.15);
      const scale2 = (1.5 + af.high * 2.2) * params.curlStrength;
      const u2 = u1 + c2.vx * scale2;
      const v2 = v1 + c2.vy * scale2;

      const fade = Math.sin(life * Math.PI) * 0.32;
      const col = i % 3 === 0 ? `rgba(38,242,235,${fade})` : i % 3 === 1 ? `rgba(255,209,71,${fade})` : `rgba(242,97,217,${fade})`;
      ctx2d.strokeStyle = col;
      ctx2d.lineWidth = 1.1;
      ctx2d.beginPath();
      ctx2d.moveTo(u0 * W, v0 * H);
      ctx2d.quadraticCurveTo(u1 * W, v1 * H, u2 * W, v2 * H);
      ctx2d.stroke();
    }

    // 3. Dual Particle Constellation + Plexus
    const dual = computeDualParticles(ctx);

    // 4. WebGPU compute + render swarm pass if GPU device is active
    if (gpuState) {
      const rigIdx = Math.max(0, PARTICLE_RIGS.indexOf(ctx.rig || 'gears'));
      const uData = new Float32Array([
        t, af.bass || 0, af.mid || 0, af.high || 0,
        af.transient || 0, af.glitch || 0, cam.dist || 14, dual.fovPx,
        cam.panX ?? 0.5, cam.panY ?? 0.5, W, H,
        rigIdx, params.curlStrength, params.glowSize, 0
      ]);
      gpuState.device.queue.writeBuffer(gpuState.uniformBuffer, 0, uData);

      const encoder = gpuState.device.createCommandEncoder();
      const cPass = encoder.beginComputePass();
      cPass.setPipeline(gpuState.computePipeline);
      cPass.setBindGroup(0, gpuState.computeBG);
      cPass.dispatchWorkgroups(Math.ceil(gpuCount / 64));
      cPass.end();

      const rPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: gpuState.gpuCtx.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store'
        }]
      });
      rPass.setPipeline(gpuState.renderPipeline);
      rPass.setBindGroup(0, gpuState.renderBG);
      rPass.draw(6, gpuCount);
      rPass.end();

      gpuState.device.queue.submit([encoder.finish()]);
      ctx2d.drawImage(gpuState.gpuCanvas, 0, 0, W, H);
    }

    drawDualParticles2D(ctx2d, dual, ctx);

    // 5. CRT scanlines & HUD telemetry bar
    if (ctx.shaders?.crtScanlines !== false) {
      ctx2d.fillStyle = 'rgba(0, 0, 0, 0.14)';
      for (let y = 1; y < H; y += 2) {
        ctx2d.fillRect(0, y, W, 1);
      }
    }

    if (userScene && typeof userScene.frame === 'function') {
      userScene.frame(ctx, userApi);
    }
  }

  function resize(w, h) {
    W = w;
    H = h;
    targetCanvas.width = w;
    targetCanvas.height = h;
    if (gpuState) {
      gpuState.gpuCanvas.width = w;
      gpuState.gpuCanvas.height = h;
    }
  }

  return {
    renderFrame,
    resize,
    setParam: (k, v) => { if (k in params) params[k] = v; },
    getParams: () => ({ ...params }),
    dispose: () => {
      if (gpuState?.device) gpuState.device.destroy();
    }
  };
}
