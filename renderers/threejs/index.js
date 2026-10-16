// renderers/threejs/index.js
// Three.js 3D Scene Graph & Post-Processing Adapter for Slopscore 2.0.
// Combines the 420-particle Dual Particle Constellation System, Plexus 3D line mesh,
// procedural 3D mechanical/crystal/voxel/butterfly rigs (ported from mtv-willnever-v4/kit/three-rigs.js
// and native-render.m), archival backdrop plane, and ping-pong Glitch + HUD + CRT shader stack
// (ported from mtv-willnever-v4/kit/shaders.js).

import * as THREE from 'three';
import { clamp, lerp } from '../../kit/measure-clock.js';
import { computeDualParticles, DUAL_PARTICLE_COUNT, hashf, hash2f } from '../shared/dual-particles.js';

export const meta = {
  id: 'threejs',
  name: 'Three.js 3D',
  kind: 'browser',
  output: 'canvas',
  description: 'WebGL 3D Scene Graph with instanced Dual Particles, Plexus constellation mesh, 3D mechanical/crystal/butterfly rigs, and CRT/glitch post-processing.',
  params: [
    { name: 'bloom', type: 'number', min: 0, max: 2, step: 0.01, default: 0.65, label: 'Phosphor Glow' },
    { name: 'rigOpacity', type: 'number', min: 0, max: 1, step: 0.01, default: 0.85, label: '3D Rig Opacity' },
    { name: 'curvature', type: 'number', min: 0, max: 1, step: 0.01, default: 0.35, label: 'CRT Curvature' },
    { name: 'hudOverlay', type: 'boolean', default: true, label: 'Cybernetic HUD' }
  ]
};

const QUAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const POST_COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uTime;
  uniform float uGlitch;
  uniform float uChroma;
  uniform float uBass;
  uniform float uHigh;
  uniform float uScanlines;
  uniform float uVignette;
  uniform float uCurvature;
  uniform float uHud;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  vec2 curveUV(vec2 uv, float amt) {
    if (amt <= 0.001) return uv;
    vec2 centered = (uv - 0.5) * 2.0;
    centered *= 1.0 + 0.06 * amt;
    centered.x *= 1.0 + pow(abs(centered.y) / 5.0, 2.0) * amt;
    centered.y *= 1.0 + pow(abs(centered.x) / 4.0, 2.0) * amt;
    return (centered * 0.5) + 0.5;
  }

  void main() {
    vec2 uv = curveUV(vUv, uCurvature);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    float g = clamp(uGlitch + (uBass > 0.72 ? (uBass - 0.72) * 1.2 : 0.0), 0.0, 1.2);
    float timeSeed = floor(uTime * 24.0);

    if (g > 0.06) {
      float blockY = floor(uv.y * 28.0);
      float sliceNoise = hash(vec2(blockY, timeSeed));
      if (sliceNoise < g * 0.36) {
        float shift = (hash(vec2(blockY * 2.3, timeSeed + 7.0)) - 0.5) * 0.06 * g;
        uv.x = fract(uv.x + shift);
      }
    }

    float split = (0.0015 + uChroma * 0.008 + g * 0.012 + uBass * 0.003);
    float r = texture2D(tDiffuse, vec2(clamp(uv.x + split, 0.0, 1.0), uv.y)).r;
    float grn = texture2D(tDiffuse, uv).g;
    float b = texture2D(tDiffuse, vec2(clamp(uv.x - split, 0.0, 1.0), uv.y)).b;
    vec3 col = vec3(r, grn, b);

    // Scanlines
    if (uScanlines > 0.001) {
      float scan = sin(uv.y * uResolution.y * 3.14159) * 0.5 + 0.5;
      col *= 1.0 - scan * 0.14 * uScanlines;
    }

    // Phosphor subpixel RGB mask
    float mask = mod(gl_FragCoord.x, 3.0);
    if (mask < 1.0) col.r *= 1.05;
    else if (mask < 2.0) col.g *= 1.05;
    else col.b *= 1.05;

    // Cybernetic HUD corner reticles
    if (uHud > 0.5) {
      vec2 borderDist = min(vUv, 1.0 - vUv);
      if (min(borderDist.x, borderDist.y) < 0.008) {
        if (vUv.x < 0.06 || vUv.x > 0.94 || vUv.y < 0.06 || vUv.y > 0.94) {
          col += vec3(0.15, 0.92, 0.78) * 0.28;
        }
      }
    }

    // Corner vignette
    vec2 n = uv * 2.0 - 1.0;
    float r2 = dot(n, n);
    float vig = clamp(1.10 - r2 * uVignette, 0.18, 1.0);
    col *= vig;

    gl_FragColor = vec4(col, 1.0);
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

  const params = {
    bloom: 0.65,
    rigOpacity: 0.85,
    curvature: 0.35,
    hudOverlay: true
  };

  const renderer = new THREE.WebGLRenderer({
    canvas: targetCanvas,
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true
  });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x050811, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050811, 0.032);

  const camera = new THREE.PerspectiveCamera(56, width / height, 0.5, 120);
  camera.position.set(0, 0, 14);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x283858, 1.4);
  scene.add(ambientLight);

  const dirLight1 = new THREE.DirectionalLight(0xffe6a3, 2.2);
  dirLight1.position.set(8, 12, 10);
  scene.add(dirLight1);

  const dirLight2 = new THREE.DirectionalLight(0x22f0e8, 1.6);
  dirLight2.position.set(-10, -8, 8);
  scene.add(dirLight2);

  // Archival Backdrop Canvas & Plane
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = 320;
  bgCanvas.height = 180;
  const bgCtx = bgCanvas.getContext('2d');
  const bgTexture = new THREE.CanvasTexture(bgCanvas);
  bgTexture.minFilter = THREE.LinearFilter;
  bgTexture.magFilter = THREE.LinearFilter;

  const bgPlaneGeo = new THREE.PlaneGeometry(26, 14.625, 32, 18);
  const bgPlaneMat = new THREE.MeshBasicMaterial({
    map: bgTexture,
    transparent: true,
    opacity: 0.52,
    depthWrite: false
  });
  const bgPlane = new THREE.Mesh(bgPlaneGeo, bgPlaneMat);
  bgPlane.position.set(0, 0, -6.5);
  scene.add(bgPlane);

  // 1. 420-Particle Dual Particle Constellation (InstancedMesh + Hot Cores)
  const particleGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
  const particleMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.92
  });
  const particleMesh = new THREE.InstancedMesh(particleGeo, particleMat, DUAL_PARTICLE_COUNT);
  particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(particleMesh);

  const coreGeo = new THREE.BoxGeometry(0.075, 0.075, 0.075);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.98,
    blending: THREE.AdditiveBlending
  });
  const coreMesh = new THREE.InstancedMesh(coreGeo, coreMat, DUAL_PARTICLE_COUNT);
  coreMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(coreMesh);

  // 2. Plexus Constellation LineSegments (max 320 pairs = 640 vertices)
  const maxLines = 320;
  const linePositions = new Float32Array(maxLines * 6);
  const lineColors = new Float32Array(maxLines * 6);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3).setUsage(THREE.DynamicDrawUsage));
  lineGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3).setUsage(THREE.DynamicDrawUsage));
  const lineMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.65,
    blending: THREE.AdditiveBlending
  });
  const plexusLines = new THREE.LineSegments(lineGeo, lineMat);
  scene.add(plexusLines);

  // 3. 3D Construct Rigs Group (gears, voxels, crystals/monument, butterflies)
  const rigsRoot = new THREE.Group();
  scene.add(rigsRoot);

  // 3a. Clockwork Gears & Pistons Rig
  const gearsGroup = new THREE.Group();
  rigsRoot.add(gearsGroup);
  const gearTeethMeshes = [];
  const toothGeo = new THREE.BoxGeometry(0.48, 0.48, 0.55);
  const gearMatA = new THREE.MeshStandardMaterial({ color: 0xf5b83d, metalness: 0.75, roughness: 0.25, wireframe: false });
  const gearMatB = new THREE.MeshStandardMaterial({ color: 0x33e0f2, metalness: 0.75, roughness: 0.25, wireframe: false });
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Mesh(toothGeo, i < 10 ? gearMatA : gearMatB);
    gearsGroup.add(m);
    gearTeethMeshes.push(m);
  }

  // 3b. Crystalline Monument Rig (ported from MonumentRig in three-rigs.js)
  const crystalGroup = new THREE.Group();
  rigsRoot.add(crystalGroup);
  const icosaMesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(3.6, 1),
    new THREE.MeshBasicMaterial({ color: 0x38f2ff, wireframe: true, transparent: true, opacity: 0.75 })
  );
  const octaCore = new THREE.Mesh(
    new THREE.OctahedronGeometry(2.0, 0),
    new THREE.MeshStandardMaterial({
      color: 0x0a101d,
      metalness: 0.9,
      roughness: 0.15,
      emissive: new THREE.Color(0x183848),
      emissiveIntensity: 0.5
    })
  );
  crystalGroup.add(icosaMesh, octaCore);
  const crystalRings = [];
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(4.2 + i * 1.1, 0.05, 8, 64),
      new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0xffb838 : 0x00e5ff, transparent: true, opacity: 0.7 })
    );
    ring.rotation.x = Math.PI * (i / 3);
    ring.rotation.y = Math.PI * (i / 2);
    crystalGroup.add(ring);
    crystalRings.push(ring);
  }

  // 3c. Voxel Pillars Instanced Rig
  const voxelCount = 63; // 9x7 grid
  const voxelGeo = new THREE.BoxGeometry(0.82, 1.0, 0.82);
  const voxelMat = new THREE.MeshStandardMaterial({ color: 0x26f7d8, metalness: 0.5, roughness: 0.35 });
  const voxelInst = new THREE.InstancedMesh(voxelGeo, voxelMat, voxelCount);
  rigsRoot.add(voxelInst);

  // 3d. 48-Butterfly Origami Swarm Rig
  const butterflyGroup = new THREE.Group();
  rigsRoot.add(butterflyGroup);
  const butterflies = [];
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0.45,
    -0.65, 0.2, 0,
    0, 0.08, -0.45,
    0, 0, 0.45,
    0, 0.08, -0.45,
    0.65, 0.2, 0
  ]), 3));
  wingGeo.computeVertexNormals();
  for (let b = 0; b < 48; b++) {
    const col = b % 3 === 0 ? 0x2efae6 : b % 3 === 1 ? 0xff73d1 : 0xffd952;
    const mat = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, wireframe: false, transparent: true, opacity: 0.88 });
    const mesh = new THREE.Mesh(wingGeo, mat);
    butterflyGroup.add(mesh);
    butterflies.push(mesh);
  }

  // Post-processing render target & full-screen quad
  let renderTarget = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat
  });
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const postScene = new THREE.Scene();
  const postMat = new THREE.ShaderMaterial({
    vertexShader: QUAD_VERTEX,
    fragmentShader: POST_COMPOSITE_FRAG,
    uniforms: {
      tDiffuse: { value: renderTarget.texture },
      uTime: { value: 0 },
      uGlitch: { value: 0 },
      uChroma: { value: 0.2 },
      uBass: { value: 0 },
      uHigh: { value: 0 },
      uScanlines: { value: 1.0 },
      uVignette: { value: 0.24 },
      uCurvature: { value: params.curvature },
      uHud: { value: 1.0 },
      uResolution: { value: new THREE.Vector2(width, height) }
    }
  });
  const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat);
  postScene.add(postQuad);

  // User custom scene hook
  const userApi = { THREE, renderer, scene, camera, rigsRoot, assets, project };
  if (userScene && typeof userScene.setup === 'function') {
    await userScene.setup(userApi);
  }

  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  function updateArchivalBackdrop(ctx) {
    const t = ctx.time || 0;
    const ch = ctx.chapter || 0;
    const af = ctx.audio || {};
    const clipFrame = (ctx.assets || assets)?.getClipFrame?.(ctx.clip?.a, ctx.clip?.a?.localTime ?? t);

    bgCtx.fillStyle = '#050811';
    bgCtx.fillRect(0, 0, 320, 180);

    if (clipFrame) {
      try {
        bgCtx.globalAlpha = 0.85;
        bgCtx.drawImage(clipFrame, 0, 0, 320, 180);
        bgCtx.globalAlpha = 1.0;
      } catch {}
    } else {
      // Procedural steel-plate / fluid cybernetic backdrop
      const grad = bgCtx.createLinearGradient(0, 0, 320, 180);
      grad.addColorStop(0, '#071224');
      grad.addColorStop(0.5, '#0c263b');
      grad.addColorStop(1, '#18102b');
      bgCtx.fillStyle = grad;
      bgCtx.fillRect(0, 0, 320, 180);

      bgCtx.strokeStyle = `rgba(34, 240, 232, ${0.22 + (af.bass || 0) * 0.25})`;
      bgCtx.lineWidth = 1.2;
      for (let row = 0; row < 18; row++) {
        const y0 = (row / 18) * 180;
        bgCtx.beginPath();
        for (let x = 0; x <= 320; x += 16) {
          const wave = Math.sin(x * 0.04 + t * 2.2 + row * 0.5) * (4 + (af.mid || 0) * 8);
          if (x === 0) bgCtx.moveTo(x, y0 + wave);
          else bgCtx.lineTo(x, y0 + wave);
        }
        bgCtx.stroke();
      }
    }

    bgTexture.needsUpdate = true;
    const [vpU, vpV] = ctx.vp || [0.5, 0.46];
    bgPlane.position.set((vpU - 0.5) * 10, (0.5 - vpV) * 6, -6.5);
  }

  function updateConstructRigs(ctx) {
    const t = ctx.time || 0;
    const af = ctx.audio || { bass: 0, mid: 0, high: 0, transient: 0 };
    const rig = ctx.rig || 'gears';
    const nextRig = ctx.nextRig || rig;
    const morph = ctx.chMorphT || 0;

    const showRig = (name) => rig === name || (morph > 0.05 && nextRig === name);

    gearsGroup.visible = showRig('gears') || showRig('sparkRings');
    crystalGroup.visible = showRig('crystals') || showRig('helix') || showRig('spiral');
    voxelInst.visible = showRig('voxels') || showRig('relief');
    butterflyGroup.visible = showRig('butterflies') || rig === 'gears';

    if (gearsGroup.visible) {
      for (let i = 0; i < gearTeethMeshes.length; i++) {
        const m = gearTeethMeshes[i];
        const isInner = i >= 10;
        const count = isInner ? 6 : 10;
        const idx = isInner ? i - 10 : i;
        const ang = (idx / count) * Math.PI * 2 + t * (isInner ? -2.1 : 1.4);
        const rad = (isInner ? 1.65 : 2.8) + (idx % 2 === 0 ? 0.25 : -0.15) + af.bass * 0.35;
        m.position.set(Math.cos(ang) * rad + 1.4, Math.sin(ang) * rad - 0.2, isInner ? -0.9 : 0.2);
        m.rotation.set(0.35, -0.45, ang);
      }
    }

    if (crystalGroup.visible) {
      icosaMesh.rotation.x = t * 0.25;
      icosaMesh.rotation.y = t * 0.38;
      const s = 1.0 + af.bass * 0.32 + (ctx.pulse || 0) * 0.12;
      icosaMesh.scale.set(s, s, s);
      octaCore.rotation.x = -t * 0.4;
      octaCore.rotation.z = t * 0.22;
      const cs = 1.0 + af.mid * 0.28;
      octaCore.scale.set(cs, cs, cs);
      crystalRings.forEach((r, idx) => {
        r.rotation.z = t * (0.5 + idx * 0.2) * (idx % 2 === 0 ? 1 : -1);
      });
    }

    if (voxelInst.visible) {
      let idx = 0;
      for (let gx = -4; gx <= 4; gx++) {
        for (let gz = -3; gz <= 3; gz++) {
          const st = hash2f(gx + Math.floor(t * 4.0), gz + Math.floor(t * 3.0));
          const h = 0.25 + st * (1.2 + af.bass * 1.6);
          dummy.position.set(gx * 1.35, -3.2 + h * 0.5, gz * 1.45 - 1.5);
          dummy.scale.set(0.85, h, 0.85);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          voxelInst.setMatrixAt(idx, dummy.matrix);
          tmpColor.setRGB(0.15 + st * 0.35, 0.88, 0.65 + (Math.abs(gx) % 2) * 0.25);
          voxelInst.setColorAt(idx, tmpColor);
          idx++;
        }
      }
      voxelInst.instanceMatrix.needsUpdate = true;
      if (voxelInst.instanceColor) voxelInst.instanceColor.needsUpdate = true;
    }

    if (butterflyGroup.visible) {
      const activeCount = rig === 'butterflies' ? 48 : 14;
      for (let b = 0; b < butterflies.length; b++) {
        const mesh = butterflies[b];
        mesh.visible = b < activeCount;
        if (!mesh.visible) continue;
        const seed = b * 2.39996;
        const flight = (hashf(seed) + t * (0.16 + 0.12 * hashf(seed + 1.0))) % 1.0;
        const orbitAng = t * 1.1 + b * 0.42;
        const orbitRad = 1.8 + (b % 6) * 0.95;
        mesh.position.set(
          Math.cos(orbitAng) * orbitRad + (hashf(seed + 2.0) - 0.5) * 1.8,
          Math.sin(orbitAng * 1.4) * 1.7 + Math.cos(t * 1.2 + b) * 0.7,
          lerp(-5.0, 4.0, flight)
        );
        const flap = Math.sin(t * (12.0 + (b % 4) * 2.5) + b * 1.8) * 0.55;
        mesh.rotation.set(flap * 0.35, orbitAng * 0.3, flap);
        const sc = 0.55 + (b % 3) * 0.18 + af.mid * 0.22;
        mesh.scale.set(sc, sc, sc);
      }
    }
  }

  function renderFrame(ctx) {
    const t = ctx.time || 0;
    const af = ctx.audio || { rms: 0, bass: 0, mid: 0, high: 0, transient: 0, glitch: 0 };
    const cam = ctx.camera || { panX: 0.5, panY: 0.5, dist: 14, fov: 56, roll: 0 };
    const shaders = ctx.shaders || {};

    // Update camera from RenderFrameContext
    camera.fov = clamp(cam.fov || 56, 20, 125);
    camera.updateProjectionMatrix();
    const panOffsetX = ((cam.panX ?? 0.5) - 0.5) * -10.0;
    const panOffsetY = ((cam.panY ?? 0.5) - 0.5) * 6.0;
    camera.position.set(panOffsetX, panOffsetY, cam.dist || 14);
    camera.lookAt(panOffsetX * 0.35, panOffsetY * 0.35, 0);
    camera.rotation.z = cam.roll || 0;

    updateArchivalBackdrop(ctx);
    updateConstructRigs(ctx);

    // Update 420 Dual Particles & Plexus Lines
    const dual = computeDualParticles(ctx);
    const glowScale = (shaders.phosphorGlow ?? 1.0) * (0.7 + params.bloom * 0.5);

    for (let i = 0; i < dual.particles.length; i++) {
      const p = dual.particles[i];
      // Note: screen Y in native-render is top-down while Three.js world Y is bottom-up
      dummy.position.set(p.pos.x, -p.pos.y, -p.pos.z);
      const sc = clamp((0.6 + af.transient * 0.7) * glowScale, 0.25, 2.4);
      dummy.scale.set(sc, sc, sc);
      dummy.rotation.set(t * 0.8 + i * 0.1, t * 1.1 + i * 0.07, 0);
      dummy.updateMatrix();
      particleMesh.setMatrixAt(i, dummy.matrix);

      tmpColor.setRGB(clamp(p.r, 0, 1), clamp(p.g, 0, 1), clamp(p.b, 0, 1));
      particleMesh.setColorAt(i, tmpColor);

      dummy.scale.set(sc * 0.55, sc * 0.55, sc * 0.55);
      dummy.updateMatrix();
      coreMesh.setMatrixAt(i, dummy.matrix);
      tmpColor.setRGB(clamp(p.r + 0.35, 0, 1), clamp(p.g + 0.35, 0, 1), clamp(p.b + 0.35, 0, 1));
      coreMesh.setColorAt(i, tmpColor);
    }
    particleMesh.instanceMatrix.needsUpdate = true;
    if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;
    coreMesh.instanceMatrix.needsUpdate = true;
    if (coreMesh.instanceColor) coreMesh.instanceColor.needsUpdate = true;

    // Update Plexus line segments
    const lineCount = Math.min(maxLines, dual.lines.length);
    for (let i = 0; i < lineCount; i++) {
      const ln = dual.lines[i];
      const base = i * 6;
      linePositions[base] = ln.ax;
      linePositions[base + 1] = -ln.ay;
      linePositions[base + 2] = -ln.az;
      linePositions[base + 3] = ln.bx;
      linePositions[base + 4] = -ln.by;
      linePositions[base + 5] = -ln.bz;

      const fade = clamp(ln.alpha * 1.5, 0, 1);
      lineColors[base] = ln.r * fade;
      lineColors[base + 1] = ln.g * fade;
      lineColors[base + 2] = ln.b * fade;
      lineColors[base + 3] = ln.r * fade;
      lineColors[base + 4] = ln.g * fade;
      lineColors[base + 5] = ln.b * fade;
    }
    lineGeo.setDrawRange(0, lineCount * 2);
    lineGeo.attributes.position.needsUpdate = true;
    lineGeo.attributes.color.needsUpdate = true;

    if (userScene && typeof userScene.frame === 'function') {
      userScene.frame(ctx, userApi);
    }

    // Pass 1: Render 3D scene into offscreen target
    renderer.setRenderTarget(renderTarget);
    renderer.clear();
    renderer.render(scene, camera);

    // Pass 2: Composite Glitch + Chromatic Aberration + CRT Scanlines + Vignette to screen
    postMat.uniforms.tDiffuse.value = renderTarget.texture;
    postMat.uniforms.uTime.value = t;
    postMat.uniforms.uGlitch.value = af.glitch || 0;
    postMat.uniforms.uChroma.value = Number(shaders.chromaticAberration ?? 0.2);
    postMat.uniforms.uBass.value = af.bass || 0;
    postMat.uniforms.uHigh.value = af.high || 0;
    postMat.uniforms.uScanlines.value = shaders.crtScanlines === false ? 0.0 : Number(shaders.crtScanlines ?? 1.0);
    postMat.uniforms.uVignette.value = Number(shaders.vignette ?? 0.24);
    postMat.uniforms.uCurvature.value = Number(params.curvature ?? 0.35);
    postMat.uniforms.uHud.value = params.hudOverlay ? 1.0 : 0.0;

    renderer.setRenderTarget(null);
    renderer.render(postScene, postCamera);
  }

  function resize(w, h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderTarget.setSize(w, h);
    postMat.uniforms.uResolution.value.set(w, h);
  }

  function setParam(name, value) {
    if (name in params) params[name] = value;
  }

  function getParams() {
    return { ...params };
  }

  function dispose() {
    renderTarget.dispose();
    particleGeo.dispose();
    particleMat.dispose();
    coreGeo.dispose();
    coreMat.dispose();
    lineGeo.dispose();
    lineMat.dispose();
    postMat.dispose();
    renderer.dispose();
  }

  return {
    renderFrame,
    resize,
    setParam,
    getParams,
    dispose
  };
}
