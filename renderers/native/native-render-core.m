// renderers/native/native-render-core.m — Slopscore 2.0 Native CoreGraphics / GCD Renderer
// Generalized from V4 "GRAMMATIZATOR" (`mtv-willnever-v4/kit/native-render.m`).
//
// Supports BOTH:
//   1. Generalized Slopscore 2.0 `--ctx <context.bin>` protocol (CONTRACTS.md §3 & §5):
//      - native-render video --ctx <context.bin> [--bank <bank.bin> --bank-w 320 --bank-h 180] --w 1280 --h 720
//      - native-render sheet --ctx <context.bin> [--bank ...] --w 1280 --h 720 --out sheet.jpg --frames 0,120,240 [--cols 3] [--thumb-w 640]
//      - native-render frame --ctx <context.bin> [--bank ...] --w 1280 --h 720 --index 120 --out frame.jpg
//   2. Legacy V4 positional protocol (`willnever-reference` compatibility):
//      - native-render sheet <features.bin> <out.jpg> <t1,t2,...>
//      - native-render video <features.bin> <startFrame> <endFrame> <fps>

#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <CoreText/CoreText.h>
#import <ImageIO/ImageIO.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "context.h"

#define AW 320
#define AH 180
#define AFRAME_BYTES (AW * AH * 3)
#define MAX_TRIS 2800
#define DUAL_PARTICLE_COUNT 420

typedef struct {
    float rms;
    float bass;
    float mid;
    float high;
    float transient;
    float glitch;
} AudioFeat;

typedef struct {
    float cx, cy, vx, vy;
    float contour[16];
    float kp[32];
    float kpScore[8];
} CVTrack;

typedef struct {
    float x, y, z;
} Vec3;

typedef struct {
    Vec3 a, b, c;
    float r, g, bl, alpha;
    int wire;
} Tri3D;

typedef struct {
    float sx[3], sy[3];
    float depth;
    float r, g, b, alpha;
    int wire;
} ProjTri;

typedef struct {
    Vec3 posArch;
    Vec3 posGfx;
    Vec3 pos;
    float rArch, gArch, bArch;
    float rGfx, gGfx, bGfx;
    float r, g, b, alpha;
    float sx, sy, depth;
    int visible;
} DualParticle;

static inline float clampf(float v, float lo, float hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}
static inline float lerpf(float a, float b, float t) {
    return a + (b - a) * t;
}
static inline float smoothstepf(float a, float b, float x) {
    float t = clampf((x - a) / (b - a), 0.0f, 1.0f);
    return t * t * (3.0f - 2.0f * t);
}
static inline float hashf(float n) {
    float x = sinf(n * 127.1f + 311.7f) * 43758.5453123f;
    return x - floorf(x);
}
static inline float hash2f(float x, float y) {
    float v = sinf(x * 127.1f + y * 311.7f) * 43758.5453123f;
    return v - floorf(v);
}

static inline Vec3 v3add(Vec3 a, Vec3 b) { return (Vec3){a.x + b.x, a.y + b.y, a.z + b.z}; }
static inline Vec3 v3sub(Vec3 a, Vec3 b) { return (Vec3){a.x - b.x, a.y - b.y, a.z - b.z}; }
static inline Vec3 v3scale(Vec3 a, float s) { return (Vec3){a.x * s, a.y * s, a.z * s}; }
static inline float v3dot(Vec3 a, Vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
static inline Vec3 v3cross(Vec3 a, Vec3 b) {
    return (Vec3){a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
static inline Vec3 v3norm(Vec3 a) {
    float len = sqrtf(v3dot(a, a)) + 1e-6f;
    return (Vec3){a.x / len, a.y / len, a.z / len};
}
static inline Vec3 rotX(Vec3 v, float a) {
    float c = cosf(a), s = sinf(a);
    return (Vec3){v.x, v.y * c - v.z * s, v.y * s + v.z * c};
}
static inline Vec3 rotY(Vec3 v, float a) {
    float c = cosf(a), s = sinf(a);
    return (Vec3){v.x * c + v.z * s, v.y, -v.x * s + v.z * c};
}
static inline Vec3 rotZ(Vec3 v, float a) {
    float c = cosf(a), s = sinf(a);
    return (Vec3){v.x * c - v.y * s, v.x * s + v.y * c, v.z};
}

static inline int projectVP(Vec3 v, float camDist, float fovScale, float vpU, float vpV, int W, int H, float *sx, float *sy, float *depth) {
    float z = v.z + camDist;
    if (z < 0.7f) return 0;
    *sx = (W * vpU) + (v.x / z) * fovScale;
    *sy = (H * vpV) + (v.y / z) * fovScale;
    *depth = z;
    return 1;
}

static inline Vec3 unprojectUV(float u, float v, float zPlane, float camDist, float fovScale, float vpU, float vpV, int W, int H) {
    float z = zPlane + camDist;
    float x = ((u - vpU) * W * z) / fovScale;
    float y = ((v - vpV) * H * z) / fovScale;
    return (Vec3){x, y, zPlane};
}

// Legacy V4 archive bank sampler (fixed 7 clips x 100 frames @ 320x180)
static inline void sampleArchive(const uint8_t *bank, int clipId, int frameOffset, float u, float v, float *r, float *g, float *b, float *luma) {
    if (!bank) {
        float w1 = sinf(u * 14.0f + frameOffset * 0.08f) * cosf(v * 11.0f - frameOffset * 0.06f);
        float l = clampf(0.46f + 0.30f * w1, 0.05f, 0.96f);
        *r = l * 0.82f; *g = l * 0.90f; *b = l * 0.95f; *luma = l;
        return;
    }
    int c = clipId < 0 ? 0 : (clipId > 6 ? 6 : clipId);
    int f;
    if (c == 0) {
        f = 68 + (((frameOffset % 32) + 32) % 32);
    } else if (c == 2) {
        f = 54 + (((frameOffset % 46) + 46) % 46);
    } else {
        f = ((frameOffset % 100) + 100) % 100;
    }
    int absFrame = c * 100 + f;
    int x = (int)(clampf(u, 0.0f, 0.999f) * AW);
    int y = (int)(clampf(v, 0.0f, 0.999f) * AH);
    const uint8_t *p = bank + (size_t)absFrame * AFRAME_BYTES + (y * AW + x) * 3;
    *r = p[0] / 255.0f;
    *g = p[1] / 255.0f;
    *b = p[2] / 255.0f;
    *luma = 0.299f * (*r) + 0.587f * (*g) + 0.114f * (*b);
}

// Generalized Slopscore 2.0 archive bank sampler using absolute `frameA` index and configurable bank dimensions
static inline void sampleBankAbs(const uint8_t *bank, int totalBankFrames, int bankW, int bankH, int absFrame, float t, int ch, float u, float v, float *r, float *g, float *b, float *luma) {
    if (!bank || totalBankFrames <= 0 || absFrame < 0) {
        float w1 = sinf(u * 14.0f + t * 1.4f) * cosf(v * 11.0f - t * 1.1f);
        float w2 = cosf((u - v) * 19.0f + t * 2.1f + ch * 0.7f);
        float l = clampf(0.46f + 0.28f * w1 + 0.18f * w2, 0.05f, 0.96f);
        *r = clampf(l * (0.76f + 0.22f * sinf(ch + u * 4.0f)), 0.0f, 1.0f);
        *g = clampf(l * (0.86f + 0.14f * cosf(t * 0.7f + v * 5.0f)), 0.0f, 1.0f);
        *b = clampf(l * (0.92f + 0.08f * sinf(u * 6.0f - t)), 0.0f, 1.0f);
        *luma = l;
        return;
    }
    int f = ((absFrame % totalBankFrames) + totalBankFrames) % totalBankFrames;
    int x = (int)(clampf(u, 0.0f, 0.999f) * bankW);
    int y = (int)(clampf(v, 0.0f, 0.999f) * bankH);
    size_t frameBytes = (size_t)bankW * (size_t)bankH * 3;
    const uint8_t *p = bank + (size_t)f * frameBytes + (size_t)(y * bankW + x) * 3;
    *r = p[0] / 255.0f;
    *g = p[1] / 255.0f;
    *b = p[2] / 255.0f;
    *luma = 0.299f * (*r) + 0.587f * (*g) + 0.114f * (*b);
}

static inline CVTrack getTrack(const CVTrack *tracks, int clipId, int frameOffset) {
    if (!tracks) return (CVTrack){0.5f, 0.5f, 0, 0};
    int c = clipId < 0 ? 0 : (clipId > 6 ? 6 : clipId);
    int f;
    if (c == 0) {
        f = 68 + (((frameOffset % 32) + 32) % 32);
    } else if (c == 2) {
        f = 54 + (((frameOffset % 46) + 46) % 46);
    } else {
        f = ((frameOffset % 100) + 100) % 100;
    }
    return tracks[c * 100 + f];
}

static inline void pushQuad3D(Tri3D *tris, int *numTris, Vec3 p0, Vec3 p1, Vec3 p2, Vec3 p3, float r, float g, float b, float a, int wire) {
    if (*numTris + 2 >= MAX_TRIS) return;
    tris[(*numTris)++] = (Tri3D){p0, p1, p2, r, g, b, a, wire};
    tris[(*numTris)++] = (Tri3D){p0, p2, p3, r, g, b, a, wire};
}

static void pushBox3D(Tri3D *tris, int *numTris, Vec3 center, Vec3 size, float rx, float ry, float rz, float r, float g, float b, float a) {
    float hx = size.x * 0.5f, hy = size.y * 0.5f, hz = size.z * 0.5f;
    Vec3 v[8] = {
        {-hx,-hy,-hz}, {hx,-hy,-hz}, {hx,hy,-hz}, {-hx,hy,-hz},
        {-hx,-hy, hz}, {hx,-hy, hz}, {hx,hy, hz}, {-hx,hy, hz}
    };
    for (int i = 0; i < 8; i++) {
        Vec3 p = rotZ(rotY(rotX(v[i], rx), ry), rz);
        v[i] = v3add(center, p);
    }
    const int faces[6][4] = {
        {0,1,2,3}, {5,4,7,6}, {4,0,3,7}, {1,5,6,2}, {3,2,6,7}, {4,5,1,0}
    };
    for (int f = 0; f < 6; f++) {
        pushQuad3D(tris, numTris, v[faces[f][0]], v[faces[f][1]], v[faces[f][2]], v[faces[f][3]], r, g, b, a, 1);
    }
}

static void pushGear3D(Tri3D *tris, int *numTris, Vec3 center, float radius, float thickness, int teeth, float rotAngle, float tiltX, float tiltY, float r, float g, float b, float a) {
    for (int i = 0; i < teeth; i++) {
        float a0 = (i / (float)teeth) * 2.0f * (float)M_PI + rotAngle;
        float rOuter = (i % 2 == 0) ? radius * 1.22f : radius * 0.92f;
        Vec3 localPos = {cosf(a0) * rOuter, sinf(a0) * rOuter, 0.0f};
        localPos = rotY(rotX(localPos, tiltX), tiltY);
        Vec3 toothPos = v3add(center, localPos);
        pushBox3D(tris, numTris, toothPos, (Vec3){radius * 0.22f, radius * 0.22f, thickness}, tiltX, tiltY, a0, r, g, b, a);
    }
}

static void flushMeshScene3D(CGContextRef ctx, const Tri3D *tris, int numTris, float camDist, float fovScale, float vpU, float vpV, int W, int H) {
    if (numTris <= 0) return;
    ProjTri *proj = (ProjTri *)malloc(sizeof(ProjTri) * numTris);
    int pCount = 0;

    Vec3 light1 = v3norm((Vec3){0.55f, -0.70f, -0.65f});
    Vec3 light2 = v3norm((Vec3){-0.65f, 0.45f, -0.45f});

    for (int i = 0; i < numTris; i++) {
        Tri3D t = tris[i];
        float sx0, sy0, d0, sx1, sy1, d1, sx2, sy2, d2;
        if (!projectVP(t.a, camDist, fovScale, vpU, vpV, W, H, &sx0, &sy0, &d0)) continue;
        if (!projectVP(t.b, camDist, fovScale, vpU, vpV, W, H, &sx1, &sy1, &d1)) continue;
        if (!projectVP(t.c, camDist, fovScale, vpU, vpV, W, H, &sx2, &sy2, &d2)) continue;

        float avgD = (d0 + d1 + d2) / 3.0f;
        Vec3 e1 = v3sub(t.b, t.a);
        Vec3 e2 = v3sub(t.c, t.a);
        Vec3 N = v3norm(v3cross(e1, e2));
        float ndl1 = fabsf(v3dot(N, light1));
        float ndl2 = fabsf(v3dot(N, light2));

        Vec3 center = v3scale(v3add(v3add(t.a, t.b), t.c), 0.3333f);
        center.z += camDist;
        Vec3 V = v3norm(v3scale(center, -1.0f));
        Vec3 Hvec = v3norm(v3add(light1, V));
        float spec = powf(fabsf(v3dot(N, Hvec)), 18.0f) * 0.52f;

        float fog = clampf(16.0f / (avgD + 4.0f), 0.24f, 1.15f);
        float shade = (0.30f + 0.60f * ndl1 + 0.25f * ndl2) * fog;

        ProjTri pt;
        pt.sx[0] = sx0; pt.sy[0] = sy0;
        pt.sx[1] = sx1; pt.sy[1] = sy1;
        pt.sx[2] = sx2; pt.sy[2] = sy2;
        pt.depth = avgD;
        pt.r = clampf(t.r * shade + spec, 0.0f, 1.0f);
        pt.g = clampf(t.g * shade + spec, 0.0f, 1.0f);
        pt.b = clampf(t.bl * shade + spec, 0.0f, 1.0f);
        pt.alpha = clampf(t.alpha * clampf(fog * 1.1f, 0.35f, 1.0f), 0.05f, 0.96f);
        pt.wire = t.wire;
        proj[pCount++] = pt;
    }

    qsort_b(proj, pCount, sizeof(ProjTri), ^int(const void *p1, const void *p2) {
        float d1 = ((const ProjTri *)p1)->depth;
        float d2 = ((const ProjTri *)p2)->depth;
        return (d1 < d2) ? 1 : ((d1 > d2) ? -1 : 0);
    });

    for (int i = 0; i < pCount; i++) {
        ProjTri pt = proj[i];
        CGContextSetRGBFillColor(ctx, pt.r, pt.g, pt.b, pt.alpha);
        CGContextBeginPath(ctx);
        CGContextMoveToPoint(ctx, pt.sx[0], pt.sy[0]);
        CGContextAddLineToPoint(ctx, pt.sx[1], pt.sy[1]);
        CGContextAddLineToPoint(ctx, pt.sx[2], pt.sy[2]);
        CGContextClosePath(ctx);
        if (pt.wire) {
            CGContextSetRGBStrokeColor(ctx, clampf(pt.r + 0.22f, 0, 1), clampf(pt.g + 0.22f, 0, 1), clampf(pt.b + 0.22f, 0, 1), pt.alpha * 0.65f);
            CGContextSetLineWidth(ctx, clampf(9.0f / pt.depth, 0.5f, 1.8f));
            CGContextDrawPath(ctx, kCGPathFillStroke);
        } else {
            CGContextFillPath(ctx);
        }
    }

    free(proj);
}

static inline void curlVelocity2D(float u, float v, float t, float *vx, float *vy) {
    float eps = 0.01f;
    float psi_y1 = sinf((u) * 8.5f + t * 1.6f) * cosf((v + eps) * 7.2f - t * 1.3f)
                 + 0.5f * cosf((u - v - eps) * 14.0f + t * 2.4f);
    float psi_y0 = sinf((u) * 8.5f + t * 1.6f) * cosf((v - eps) * 7.2f - t * 1.3f)
                 + 0.5f * cosf((u - v + eps) * 14.0f + t * 2.4f);
    float psi_x1 = sinf((u + eps) * 8.5f + t * 1.6f) * cosf((v) * 7.2f - t * 1.3f)
                 + 0.5f * cosf((u + eps - v) * 14.0f + t * 2.4f);
    float psi_x0 = sinf((u - eps) * 8.5f + t * 1.6f) * cosf((v) * 7.2f - t * 1.3f)
                 + 0.5f * cosf((u - eps - v) * 14.0f + t * 2.4f);
    *vx = (psi_y1 - psi_y0) / (2.0f * eps) * 0.018f;
    *vy = -(psi_x1 - psi_x0) / (2.0f * eps) * 0.018f;
}

static void drawCurlFluidAndParticles(CGContextRef ctx, int W, int H, float t, AudioFeat af, float srcU, float srcV, float dstU, float dstV, int count, float alphaBoost, int ch) {
    for (int i = 0; i < count; i++) {
        float seed = i * 1.371f;
        float life = fmodf(hashf(seed) + t * (0.22f + 0.18f * hashf(seed + 5.0f)), 1.0f);
        float u = lerpf(srcU, dstU, life) + (hashf(seed + 1.0f) - 0.5f) * 0.55f;
        float v = lerpf(srcV, dstV, life) + (hashf(seed + 2.0f) - 0.5f) * 0.55f;

        float px0 = u * W, py0 = v * H;
        float vx, vy;
        curlVelocity2D(u, v, t + (i % 5) * 0.1f, &vx, &vy);
        float u1 = u + vx * (1.2f + af.bass * 2.5f);
        float v1 = v + vy * (1.2f + af.bass * 2.5f);
        float vx2, vy2;
        curlVelocity2D(u1, v1, t + 0.15f, &vx2, &vy2);
        float u2 = u1 + vx2 * (1.5f + af.high * 2.2f);
        float v2 = v1 + vy2 * (1.5f + af.high * 2.2f);

        float px1 = u1 * W, py1 = v1 * H;
        float px2 = u2 * W, py2 = v2 * H;

        float fade = sinf(life * (float)M_PI) * alphaBoost * 0.35f;
        float r = (i % 3 == 0) ? 0.15f : ((i % 3 == 1) ? 1.0f : 0.95f);
        float g = (i % 3 == 0) ? 0.95f : ((i % 3 == 1) ? 0.82f : 0.38f);
        float b = (i % 3 == 0) ? 0.92f : ((i % 3 == 1) ? 0.28f : 0.85f);

        CGContextSetRGBStrokeColor(ctx, r, g, b, fade * 0.40f);
        CGContextSetLineWidth(ctx, 0.85f);
        CGContextBeginPath(ctx);
        CGContextMoveToPoint(ctx, px0, py0);
        CGContextAddQuadCurveToPoint(ctx, px1, py1, px2, py2);
        CGContextStrokePath(ctx);

        if (i % 3 == 0) {
            float sz = 2.2f + af.transient * 2.2f;
            if (ch == 6 || af.high > 0.28f) {
                float flap = fabsf(sinf(t * 18.0f + i * 1.5f)) * 3.0f;
                float bsz = sz * 1.25f;
                CGContextSetRGBFillColor(ctx, 1.0f, 0.95f, 0.45f, fade * 0.90f);
                CGContextFillRect(ctx, CGRectMake(px2 - 1.0f, py2 - bsz * 0.5f, 2.0f, bsz));
                CGContextSetRGBFillColor(ctx, 0.15f, 0.98f, 0.90f, fade * 0.80f);
                CGContextFillRect(ctx, CGRectMake(px2 - 1.0f - flap, py2 - bsz * 0.5f, flap, bsz));
                CGContextSetRGBFillColor(ctx, 1.0f, 0.45f, 0.78f, fade * 0.80f);
                CGContextFillRect(ctx, CGRectMake(px2 + 1.0f, py2 - bsz * 0.5f, flap, bsz));
            } else {
                CGContextSetRGBFillColor(ctx, 1.0f, 0.96f, 0.78f, fade * 0.65f);
                CGContextFillRect(ctx, CGRectMake(px2 - sz * 0.5f, py2 - sz * 0.5f, sz, sz));
            }
        }
    }
}

static void drawPixelProtagonistAndMiniGame(CGContextRef ctx, int W, int H, float t, int ch, AudioFeat af, CVTrack tr, float *outProtU, float *outProtV, float charScale) {
    int stage = 0;
    if (ch <= 1) stage = 0;
    else if (ch <= 4) stage = 1;
    else if (ch == 5) stage = 2;
    else stage = 3;

    float pu = 0.68f, pv = 0.50f;
    if (ch == 0) {
        float hopCycle = fmodf(t * 0.65f, 1.0f);
        float arc = -4.0f * hopCycle * (1.0f - hopCycle) * 0.14f;
        pu = lerpf(tr.cx, 0.76f, hopCycle);
        pv = lerpf(tr.cy, 0.54f, hopCycle) + arc;
    } else if (ch == 1) {
        pu = 0.50f + 0.30f * sinf(t * 1.1f);
        pv = 0.56f + 0.16f * cosf(t * 2.2f) - fabsf(sinf(t * 4.5f)) * 0.08f;
    } else if (ch == 2) {
        pu = 0.54f + 0.24f * cosf(t * 1.4f);
        pv = 0.50f + 0.18f * sinf(t * 2.1f);
    } else if (ch == 3 || ch == 4) {
        pu = 0.48f + 0.28f * sinf(t * 0.95f);
        pv = 0.48f + 0.20f * sinf(t * 1.90f + 0.8f);
    } else if (ch == 5) {
        pu = 0.68f + 0.02f * sinf(t * 6.0f);
        pv = 0.48f + 0.02f * cosf(t * 5.0f);
    } else if (ch == 6) {
        pu = 0.68f + 0.16f * sinf(t * 1.5f);
        pv = 0.46f + 0.18f * sinf(t * 3.0f);
    } else {
        pu = 0.50f + 0.22f * sinf(t * 0.85f);
        pv = 0.42f + 0.10f * cosf(t * 1.4f);
    }

    *outProtU = pu;
    *outProtV = pv;

    float px = pu * W, py = pv * H;

    float platW = 90.0f * charScale;
    float platH = 7.0f * charScale;
    float platY = py + 22.0f * charScale;

    // 1. Grounding Drop Shadow
    CGContextSetRGBFillColor(ctx, 0.02f, 0.05f, 0.08f, 0.65f);
    CGContextFillEllipseInRect(ctx, CGRectMake(px - 14.0f * charScale, platY - 4.0f, 28.0f * charScale, 7.0f));

    // 2. Physical Walking Gantry / Platform Beam
    CGContextSetRGBFillColor(ctx, 0.08f, 0.14f, 0.20f, 0.82f);
    CGContextFillRect(ctx, CGRectMake(px - platW * 0.5f, platY, platW, platH));
    CGContextSetRGBStrokeColor(ctx, 0.22f, 0.95f, 0.90f, 0.85f);
    CGContextSetLineWidth(ctx, 1.4f);
    CGContextStrokeRect(ctx, CGRectMake(px - platW * 0.5f, platY, platW, 1.5f));
    CGContextSetRGBFillColor(ctx, 0.15f, 0.25f, 0.35f, 0.65f);
    CGContextFillRect(ctx, CGRectMake(px - platW * 0.4f, platY + platH, 4.0f, 25.0f * charScale));
    CGContextFillRect(ctx, CGRectMake(px + platW * 0.4f - 4.0f, platY + platH, 4.0f, 25.0f * charScale));

    // 3. Interactive Machine Console Workstation & Lever
    float conX = px + 26.0f * charScale;
    float conY = py - 8.0f * charScale;
    CGContextSetRGBFillColor(ctx, 0.12f, 0.18f, 0.26f, 0.90f);
    CGContextFillRect(ctx, CGRectMake(conX, conY, 18.0f * charScale, 28.0f * charScale));
    float screenGlow = 0.65f + 0.35f * sinf(t * 8.0f);
    CGContextSetRGBFillColor(ctx, 0.18f * screenGlow, 0.95f * screenGlow, 0.75f * screenGlow, 0.95f);
    CGContextFillRect(ctx, CGRectMake(conX + 2.0f, conY + 3.0f, 14.0f * charScale, 10.0f * charScale));
    float leverAngle = sinf(t * 4.0f + af.transient * 3.0f) * 0.45f;
    float lx0 = conX + 9.0f * charScale;
    float ly0 = conY + 16.0f * charScale;
    float lx1 = lx0 + sinf(leverAngle) * 12.0f * charScale;
    float ly1 = ly0 - cosf(leverAngle) * 12.0f * charScale;
    CGContextSetRGBStrokeColor(ctx, 1.0f, 0.85f, 0.25f, 0.95f);
    CGContextSetLineWidth(ctx, 2.0f);
    CGContextBeginPath(ctx);
    CGContextMoveToPoint(ctx, lx0, ly0);
    CGContextAddLineToPoint(ctx, lx1, ly1);
    CGContextStrokePath(ctx);

    float ledSpacing = 4.0f * charScale;
    float ledY = conY + 22.0f * charScale;
    CGContextSetRGBFillColor(ctx, 1.0f, 0.25f + af.bass * 0.75f, 0.20f, 0.65f + af.bass * 0.35f);
    CGContextFillRect(ctx, CGRectMake(conX + 3.0f * charScale, ledY, 3.0f * charScale, 3.0f * charScale));
    CGContextSetRGBFillColor(ctx, 0.25f + af.mid * 0.70f, 0.95f, 0.25f, 0.65f + af.mid * 0.35f);
    CGContextFillRect(ctx, CGRectMake(conX + 3.0f * charScale + ledSpacing, ledY, 3.0f * charScale, 3.0f * charScale));
    CGContextSetRGBFillColor(ctx, 0.20f, 0.85f + af.high * 0.15f, 1.00f, 0.65f + af.high * 0.35f);
    CGContextFillRect(ctx, CGRectMake(conX + 3.0f * charScale + ledSpacing * 2.0f, ledY, 3.0f * charScale, 3.0f * charScale));

    for (int h = 8; h >= 1; h--) {
        float ht = t - h * 0.045f;
        float hu = pu - cosf(ht * 2.0f) * h * 0.008f;
        float hv = pv - sinf(ht * 2.5f) * h * 0.008f;
        float sz = (10.0f - h) * 1.8f * charScale;
        float alpha = (1.0f - h / 9.0f) * 0.45f;
        CGContextSetRGBFillColor(ctx, 0.15f, 0.95f, 0.88f, alpha);
        CGContextFillRect(ctx, CGRectMake(hu * W - sz * 0.5f, hv * H - sz * 0.5f, sz, sz));
    }

    static const int SPRITE_STAGE0[7][7] = {
        {0,0,1,2,1,0,0},
        {0,1,2,2,2,1,0},
        {1,2,1,2,1,2,1},
        {1,1,2,2,2,1,1},
        {0,1,1,1,1,1,0},
        {0,1,0,0,0,1,0},
        {1,0,0,0,0,0,1}
    };
    static const int SPRITE_STAGE1[7][9] = {
        {0,0,0,1,2,1,0,0,0},
        {0,1,1,2,2,2,1,1,0},
        {1,2,2,1,2,1,2,2,1},
        {1,1,1,2,2,2,1,1,1},
        {0,1,0,1,2,1,0,1,0},
        {0,0,1,0,1,0,1,0,0},
        {0,1,0,0,0,0,0,1,0}
    };
    static const int SPRITE_STAGE2[7][9] = {
        {0,0,2,2,2,2,2,0,0},
        {0,1,1,2,2,2,1,1,0},
        {0,1,2,2,1,2,2,1,0},
        {0,1,2,1,2,1,2,1,0},
        {0,1,1,2,2,2,1,1,0},
        {0,0,1,1,2,1,1,0,0},
        {0,0,0,1,2,1,0,0,0}
    };
    static const int SPRITE_STAGE3[7][9] = {
        {0,0,1,2,2,2,1,0,0},
        {0,1,2,1,2,1,2,1,0},
        {1,2,2,2,2,2,2,2,1},
        {1,1,2,2,1,2,2,1,1},
        {0,1,2,1,1,1,2,1,0},
        {0,1,0,1,0,1,0,1,0},
        {1,0,0,0,0,0,0,0,1}
    };

    float pixSize = ((stage == 3) ? (5.2f + af.bass * 1.8f) : (4.8f + af.bass * 1.4f)) * charScale;
    int cols = (stage == 0) ? 7 : 9;
    int rows = 7;

    for (int r = 0; r < rows; r++) {
        for (int c = 0; c < cols; c++) {
            int val = 0;
            if (stage == 0) val = SPRITE_STAGE0[r][c];
            else if (stage == 1) val = SPRITE_STAGE1[r][c];
            else if (stage == 2) val = SPRITE_STAGE2[r][c];
            else val = SPRITE_STAGE3[r][c];
            if (val == 0) continue;

            float rx = px + (c - cols * 0.5f) * (pixSize + 1.0f);
            float ry = py + (r - rows * 0.5f) * (pixSize + 1.0f);

            if (val == 1) CGContextSetRGBFillColor(ctx, 0.15f, 0.98f, 0.90f, 0.95f);
            else if (val == 2) CGContextSetRGBFillColor(ctx, 1.00f, 0.94f, 0.45f, 0.98f);
            else CGContextSetRGBFillColor(ctx, 1.00f, 0.45f, 0.78f, 0.92f);

            CGContextFillRect(ctx, CGRectMake(rx, ry, pixSize, pixSize));
        }
    }
}

static inline void evalRigConstruct(int i, int rigType, float t, AudioFeat af, Vec3 *outPos, float *rG, float *gG, float *bG) {
    Vec3 pGfx = {0, 0, 0};
    float r = 0.2f, g = 0.9f, b = 0.9f;

    if (rigType == 1) { // gears (v4 ch 0)
        float gAngle = (i / (float)DUAL_PARTICLE_COUNT) * 4.0f * (float)M_PI + t * 0.9f;
        float gRadius = 2.4f + ((i % 6) < 3 ? 0.35f : -0.25f) + af.bass * 0.45f;
        pGfx = (Vec3){cosf(gAngle) * gRadius + 1.2f, sinf(gAngle) * gRadius - 0.3f, sinf(t * 2.0f + i * 0.1f) * 0.6f};
        r = 0.98f; g = 0.78f; b = 0.24f;
    } else if (rigType == 2) { // voxels (v4 ch 1)
        int gx = (i % 7) - 3;
        int gy = ((i / 7) % 7) - 3;
        int gz = (i / 49) - 4;
        pGfx = (Vec3){gx * 0.82f, gy * 0.82f + 0.2f, gz * 0.90f};
        r = 0.15f; g = 0.98f; b = 0.88f;
    } else if (rigType == 3) { // sparkRings (v4 ch 2)
        float sAng = (i / (float)DUAL_PARTICLE_COUNT) * 6.0f * (float)M_PI + t * 2.8f;
        float sparkBurst = (i % 7 == 0) ? (af.bass * 2.4f + af.transient * 1.6f) : 0.0f;
        float sRad = 2.8f + sparkBurst;
        pGfx = (Vec3){cosf(sAng) * sRad, sinf(sAng) * sRad * 0.65f, cosf(t * 3.5f + i) * 1.1f};
        r = 1.00f; g = 0.86f; b = 0.32f;
    } else if (rigType == 4) { // crystals (v4 ch 3)
        float phi = 1.6180339887f;
        float k = i * 0.21f;
        float cRad = 1.6f + (i % 8) * 0.42f + af.mid * 0.75f;
        pGfx = (Vec3){sinf(k * phi + t * 0.7f) * cRad - 0.8f, cosf(k + t * 0.5f) * cRad, sinf(k * 2.2f - t * 0.6f) * cRad};
        r = 0.22f; g = 0.95f; b = 0.98f;
    } else if (rigType == 5) { // helix (v4 ch 4)
        float u = (float)i / (float)DUAL_PARTICLE_COUNT;
        float hAng = u * 8.0f * (float)M_PI + t * 1.6f;
        float strand = (i % 2 == 0) ? 1.0f : -1.0f;
        pGfx = (Vec3){sinf(hAng) * 2.6f, (u - 0.5f) * 6.8f, cosf(hAng) * 2.6f * strand};
        r = 0.98f; g = 0.42f; b = 0.88f;
    } else if (rigType == 6) { // spiral (v4 ch 5)
        float goldAng = i * 2.3999632f + t * 1.3f;
        float coneR = sqrtf((float)i / (float)DUAL_PARTICLE_COUNT) * 4.4f;
        pGfx = (Vec3){cosf(goldAng) * coneR + 0.5f, ((float)i / (float)DUAL_PARTICLE_COUNT) * 5.2f - 2.6f, sinf(goldAng) * coneR};
        r = 1.00f; g = 0.82f + 0.18f * sinf(i * 0.08f); b = 0.25f;
    } else if (rigType == 7) { // butterflies (v4 ch 6)
        int bIdx = i % 48;
        float flight = fmodf(hashf(bIdx * 3.3f) + t * 0.20f, 1.0f);
        float orbAng = bIdx * 0.55f + t * 1.1f;
        float orbRad = 2.0f + (bIdx % 6) * 0.75f;
        pGfx = (Vec3){
            cosf(orbAng) * orbRad + (hashf(i * 1.7f) - 0.5f) * 1.4f,
            sinf(orbAng * 1.4f) * 2.0f + cosf(t * 1.8f + bIdx) * 0.7f,
            lerpf(-5.0f, 4.5f, flight)
        };
        r = (i % 3 == 0) ? 0.18f : ((i % 3 == 1) ? 1.00f : 0.98f);
        g = (i % 3 == 0) ? 0.98f : ((i % 3 == 1) ? 0.45f : 0.85f);
        b = (i % 3 == 0) ? 0.90f : ((i % 3 == 1) ? 0.82f : 0.32f);
    } else { // relief / horizon (v4 ch 7)
        int gx = (i % 20) - 10;
        int gz = (i / 20);
        float zP = fmodf(gz * 1.9f - t * 2.2f, 19.0f) - 7.0f;
        pGfx = (Vec3){gx * 1.35f, 3.2f + sinf(gx * 0.6f + t) * 0.35f, zP};
        r = 0.95f; g = 0.68f; b = 0.42f;
    }

    *outPos = pGfx;
    *rG = r; *gG = g; *bG = b;
}

static void updateAndRenderDualParticles(
    CGContextRef ctx,
    const uint8_t *bank,
    int useCtxBank,
    int totalBankFrames,
    int bankW,
    int bankH,
    int clipId,
    int filmFrame,
    int W, int H,
    float t,
    int ch,
    int rigType,
    float reliefDepth,
    AudioFeat af,
    float camDist,
    float fov,
    float camPanX,
    float camPanY,
    float vpU,
    float vpV,
    float phrase4Bar,
    float chMorphT
) {
    float baseBreathe = 0.35f + 0.35f * sinf(phrase4Bar * 2.0f * (float)M_PI);
    float blendFactor = clampf(lerpf(baseBreathe, (ch % 2 == 0 ? 0.88f : 0.15f), chMorphT), 0.0f, 1.0f);

    DualParticle particles[DUAL_PARTICLE_COUNT];

    for (int i = 0; i < DUAL_PARTICLE_COUNT; i++) {
        float theta = i * 2.3999632f;
        float radius = sqrtf((i + 0.5f) / (float)DUAL_PARTICLE_COUNT) * 0.44f;
        float au = clampf(0.5f + cosf(theta) * radius, 0.02f, 0.98f);
        float av = clampf(0.5f + sinf(theta) * radius, 0.02f, 0.98f);

        float rA, gA, bA, lA;
        if (useCtxBank) {
            sampleBankAbs(bank, totalBankFrames, bankW, bankH, filmFrame, t, ch, au, av, &rA, &gA, &bA, &lA);
        } else {
            sampleArchive(bank, clipId, filmFrame, au, av, &rA, &gA, &bA, &lA);
        }

        float reliefZ = (lA - 0.45f) * (reliefDepth + af.bass * 2.2f);
        Vec3 pArch = unprojectUV(vpU + (au - 0.5f) * 0.72f, vpV + (av - 0.5f) * 0.65f, reliefZ, camDist, fov, camPanX, camPanY, W, H);

        float cvx, cvy;
        curlVelocity2D(au, av, t * 0.8f + i * 0.005f, &cvx, &cvy);
        pArch.x += cvx * (1.8f + af.transient * 1.5f);
        pArch.y += cvy * (1.8f + af.transient * 1.5f);

        particles[i].posArch = pArch;
        particles[i].rArch = rA * 0.90f + 0.10f;
        particles[i].gArch = gA * 0.95f + 0.05f;
        particles[i].bArch = bA * 0.90f + 0.15f;

        Vec3 pGfx;
        float rG, gG, bG;
        evalRigConstruct(i, rigType, t, af, &pGfx, &rG, &gG, &bG);

        particles[i].posGfx = pGfx;
        particles[i].rGfx = rG;
        particles[i].gGfx = gG;
        particles[i].bGfx = bG;

        Vec3 pBlended = v3add(v3scale(pArch, 1.0f - blendFactor), v3scale(pGfx, blendFactor));
        particles[i].pos = pBlended;
        particles[i].r = lerpf(particles[i].rArch, particles[i].rGfx, blendFactor);
        particles[i].g = lerpf(particles[i].gArch, particles[i].gGfx, blendFactor);
        particles[i].b = lerpf(particles[i].bArch, particles[i].bGfx, blendFactor);
        particles[i].alpha = clampf(0.55f + 0.35f * sinf(t * 4.0f + i * 0.1f) + af.transient * 0.3f, 0.30f, 0.95f);

        float sx, sy, d;
        if (projectVP(pBlended, camDist, fov, camPanX, camPanY, W, H, &sx, &sy, &d)) {
            particles[i].sx = sx;
            particles[i].sy = sy;
            particles[i].depth = d;
            particles[i].visible = 1;
        } else {
            particles[i].visible = 0;
        }
    }

    // Pass 1: Constellation Mesh Lines
    CGContextSetLineWidth(ctx, 1.1f);
    int lineDrawn = 0;
    for (int i = 0; i < DUAL_PARTICLE_COUNT && lineDrawn < 320; i++) {
        if (!particles[i].visible) continue;
        int partners[2] = {(i + 1) % DUAL_PARTICLE_COUNT, (i + 7) % DUAL_PARTICLE_COUNT};
        for (int p = 0; p < 2; p++) {
            int j = partners[p];
            if (!particles[j].visible) continue;
            Vec3 diff = v3sub(particles[i].pos, particles[j].pos);
            float dist3D = sqrtf(v3dot(diff, diff));
            if (dist3D < 2.05f) {
                float lineAlpha = (1.0f - dist3D / 2.05f) * 0.55f * particles[i].alpha;
                CGContextSetRGBStrokeColor(ctx, particles[i].r, particles[i].g, particles[i].b, lineAlpha);
                CGContextBeginPath(ctx);
                CGContextMoveToPoint(ctx, particles[i].sx, particles[i].sy);
                CGContextAddLineToPoint(ctx, particles[j].sx, particles[j].sy);
                CGContextStrokePath(ctx);
                lineDrawn++;
            }
        }
    }

    // Pass 2: Phosphor Core Glow & Specular Highlight
    for (int i = 0; i < DUAL_PARTICLE_COUNT; i++) {
        if (!particles[i].visible) continue;
        float d = particles[i].depth;
        float sz = clampf(28.0f / d, 2.2f, 6.8f) * (1.0f + af.transient * 0.8f);

        float fog = clampf(14.0f / (d + 2.0f), 0.35f, 1.15f);
        float pr = clampf(particles[i].r * fog, 0.0f, 1.0f);
        float pg = clampf(particles[i].g * fog, 0.0f, 1.0f);
        float pb = clampf(particles[i].b * fog, 0.0f, 1.0f);
        float pa = particles[i].alpha * clampf(fog, 0.3f, 1.0f);

        CGContextSetRGBFillColor(ctx, pr, pg, pb, pa);
        CGContextFillRect(ctx, CGRectMake(particles[i].sx - sz * 0.5f, particles[i].sy - sz * 0.5f, sz, sz));

        float coreSz = sz * 0.45f;
        CGContextSetRGBFillColor(ctx, clampf(pr + 0.35f, 0, 1), clampf(pg + 0.35f, 0, 1), clampf(pb + 0.35f, 0, 1), pa);
        CGContextFillRect(ctx, CGRectMake(particles[i].sx - coreSz * 0.5f, particles[i].sy - coreSz * 0.5f, coreSz, coreSz));

        if (af.transient > 0.28f && (i % 4 == 0)) {
            float haloSz = sz * 2.4f;
            CGContextSetRGBStrokeColor(ctx, 1.0f, 1.0f, 1.0f, pa * 0.55f);
            CGContextSetLineWidth(ctx, 0.85f);
            CGContextStrokeEllipseInRect(ctx, CGRectMake(particles[i].sx - haloSz * 0.5f, particles[i].sy - haloSz * 0.5f, haloSz, haloSz));
        }
    }
}

static void buildAndFlushChapterMeshes(CGContextRef ctx, int ch, float t, AudioFeat af, Vec3 subjCenter3D, float camDist, float fov, float camPanX, float camPanY, int W, int H) {
    Tri3D *tris = (Tri3D *)malloc(sizeof(Tri3D) * MAX_TRIS);
    int numTris = 0;

    if (ch == 0) {
        Vec3 machCenter = unprojectUV(0.76f, 0.50f, 1.0f, camDist, fov, camPanX, camPanY, W, H);
        pushGear3D(tris, &numTris, machCenter, 2.4f, 0.55f, 12, t * 1.4f, 0.4f, -0.5f, 0.95f, 0.72f, 0.25f, 0.88f);
        pushGear3D(tris, &numTris, v3add(machCenter, (Vec3){-2.2f, 1.8f, -0.8f}), 1.6f, 0.45f, 8, -t * 2.1f, 0.4f, -0.5f, 0.20f, 0.88f, 0.95f, 0.88f);
        for (int p = 0; p < 5; p++) {
            float stroke = sinf(t * 8.0f + p * 1.2f) * (0.8f + af.bass * 1.2f);
            Vec3 pPos = v3add(machCenter, (Vec3){(p - 2) * 1.1f, -2.2f + stroke, -0.5f});
            pushBox3D(tris, &numTris, pPos, (Vec3){0.55f, 1.6f, 0.55f}, 0.2f, -0.4f, 0, 0.92f, 0.48f, 0.22f, 0.86f);
        }
        for (int b = 0; b < 16; b++) {
            float flight = fmodf(hashf(b * 3.1f) + t * 0.24f, 1.0f);
            Vec3 bPos = {lerpf(-6.5f, 6.5f, flight), sinf(t * 2.5f + b) * 2.8f - 0.5f, lerpf(6.0f, -7.5f, flight)};
            float flap = sinf(t * 9.5f + b * 1.7f) * 0.75f;
            float sc = 0.58f;
            Vec3 nose = v3add(bPos, (Vec3){0, 0, -sc * 1.2f});
            Vec3 tail = v3add(bPos, (Vec3){0, sc * 0.2f, sc * 1.2f});
            Vec3 lMid = v3add(bPos, (Vec3){-sc * 1.4f, sinf(flap) * sc * 0.9f, 0});
            Vec3 rMid = v3add(bPos, (Vec3){ sc * 1.4f, sinf(flap) * sc * 0.9f, 0});
            if (numTris + 2 < MAX_TRIS) {
                tris[numTris++] = (Tri3D){nose, lMid, tail, 0.22f, 0.92f, 0.98f, 0.88f, 1};
                tris[numTris++] = (Tri3D){nose, tail, rMid, 1.00f, 0.80f, 0.28f, 0.88f, 1};
            }
        }
    } else if (ch == 1) {
        for (int gx = -6; gx <= 6; gx++) {
            for (int gz = -4; gz <= 4; gz++) {
                float state = hash2f(gx + floorf(t * 5.0f), gz + floorf(t * 3.0f));
                if (state < 0.52f) continue;
                float h = 0.35f + state * (1.4f + af.bass * 1.8f);
                Vec3 cPos = {gx * 1.35f, 3.2f - h * 0.5f, gz * 1.55f};
                pushBox3D(tris, &numTris, cPos, (Vec3){0.85f, h, 0.85f}, 0, 0, 0,
                          0.15f + state * 0.35f, 0.88f, 0.65f + (gx % 2) * 0.25f, 0.84f);
            }
        }
        for (int g = 0; g < 6; g++) {
            float swing = sinf(t * 4.5f + g * 0.9f) * 0.65f;
            Vec3 gPos = {(g - 2.5f) * 2.4f, -2.2f + cosf(swing) * 1.2f, -1.5f + sinf(swing) * 1.5f};
            pushBox3D(tris, &numTris, gPos, (Vec3){0.55f, 1.8f, 0.55f}, swing, 0.3f, 0, 1.0f, 0.78f, 0.25f, 0.90f);
        }
    } else if (ch == 2) {
        Vec3 turbCenter = unprojectUV(0.74f, 0.50f, 0.5f, camDist, fov, camPanX, camPanY, W, H);
        pushGear3D(tris, &numTris, turbCenter, 3.0f, 0.75f, 16, t * 1.8f, 0.35f, -0.65f, 0.98f, 0.58f, 0.18f, 0.90f);
        pushGear3D(tris, &numTris, v3add(turbCenter, (Vec3){0, 0, -1.6f}), 1.8f, 0.65f, 10, -t * 2.8f, 0.35f, -0.65f, 0.18f, 0.88f, 0.98f, 0.90f);
        for (int k = 0; k < 10; k++) {
            float p = fmodf(k * 0.1f + t * 0.45f, 1.0f);
            Vec3 pPos = unprojectUV(lerpf(0.28f, 0.74f, p), lerpf(0.46f, 0.50f, p) + sinf(p * (float)M_PI * 2.0f) * 0.08f, -1.2f, camDist, fov, camPanX, camPanY, W, H);
            pushBox3D(tris, &numTris, pPos, (Vec3){0.55f, 0.55f, 0.85f}, t * 2.0f + k, t * 1.5f, 0, 1.0f, 0.85f, 0.28f, 0.88f);
        }
    } else if (ch == 3) {
        for (int k = 0; k < 22; k++) {
            float angle = k * 0.65f + t * 0.9f;
            float rad = 1.2f + (k / 22.0f) * 6.8f;
            Vec3 cPos = {cosf(angle) * rad - 1.5f, sinf(angle * 1.3f) * 2.8f + 0.5f, sinf(angle) * 3.5f - 1.0f};
            float sz = 0.52f + (k % 3) * 0.28f + af.mid * 0.4f;
            pushBox3D(tris, &numTris, cPos, (Vec3){sz, sz * 1.5f, sz}, t * 0.8f + k, angle, 0.4f,
                      0.18f + (k % 2) * 0.35f, 0.94f, 0.82f, 0.84f);
        }
    } else if (ch == 4) {
        for (int p = 0; p < 14; p++) {
            float freq = 1.5f + p * 0.14f;
            float angle = sinf(t * freq) * 0.68f;
            float anchorX = -6.5f + p * 0.48f;
            float len = 3.2f + p * 0.18f;
            Vec3 bobPos = {anchorX + sinf(angle) * len, -3.5f + cosf(angle) * len, -2.5f + p * 0.35f};
            pushBox3D(tris, &numTris, bobPos, (Vec3){0.48f, 0.48f, 0.48f}, angle, t, 0,
                      0.98f, 0.82f - p * 0.03f, 0.32f + p * 0.04f, 0.90f);
        }
    } else if (ch == 5) {
        Vec3 incCenter = unprojectUV(0.68f, 0.48f, 0.0f, camDist, fov, camPanX, camPanY, W, H);
        float crescendo = clampf((t - 108.0f) / 16.0f, 0.25f, 1.0f);
        for (int p = 0; p < 28; p++) {
            float golden = p * 2.3999632f + t * 1.1f;
            float phi = acosf(1.0f - 2.0f * (p + 0.5f) / 28.0f);
            float rad = (2.2f + crescendo * 1.8f + af.bass * 0.9f);
            Vec3 offset = {sinf(phi) * cosf(golden) * rad, sinf(phi) * sinf(golden) * rad, cosf(phi) * rad};
            pushBox3D(tris, &numTris, v3add(incCenter, offset), (Vec3){0.42f, 0.68f, 0.32f},
                      phi, golden, t, 0.25f + crescendo * 0.70f, 0.95f, 0.55f + (p % 2) * 0.35f, 0.84f);
        }
    } else if (ch == 6) {
        for (int b = 0; b < 48; b++) {
            float bSeed = b * 2.39996f;
            float flight = fmodf(hashf(bSeed) + t * (0.16f + 0.12f * hashf(bSeed + 1.0f)), 1.0f);
            float orbitAng = t * 1.1f + b * 0.42f;
            float orbitRad = 1.8f + (b % 6) * 1.1f + sinf(t * 0.5f + b) * 0.6f;

            Vec3 bPos = {
                subjCenter3D.x + cosf(orbitAng) * orbitRad + (hashf(bSeed + 2.0f) - 0.5f) * 2.0f,
                subjCenter3D.y + sinf(orbitAng * 1.4f) * 1.8f + cosf(t * 1.2f + b) * 0.8f,
                subjCenter3D.z + lerpf(-5.0f, 4.0f, flight) + af.bass * sinf(b) * 1.2f
            };

            float flap = sinf(t * (14.0f + (b % 4) * 2.5f) + b * 1.8f) * 0.85f;
            float bsc = 0.38f + (b % 3) * 0.18f + af.mid * 0.22f;

            Vec3 nose = v3add(bPos, (Vec3){0, 0, bsc * 1.1f});
            Vec3 tail = v3add(bPos, (Vec3){0, bsc * 0.15f, -bsc * 1.1f});
            Vec3 lTip = v3add(bPos, (Vec3){-bsc * 1.6f, sinf(flap) * bsc * 1.2f, 0});
            Vec3 rTip = v3add(bPos, (Vec3){ bsc * 1.6f, sinf(flap) * bsc * 1.2f, 0});

            float wr = (b % 3 == 0) ? 0.18f : ((b % 3 == 1) ? 1.00f : 0.98f);
            float wg = (b % 3 == 0) ? 0.98f : ((b % 3 == 1) ? 0.45f : 0.85f);
            float wb = (b % 3 == 0) ? 0.90f : ((b % 3 == 1) ? 0.82f : 0.32f);

            if (numTris + 2 < MAX_TRIS) {
                tris[numTris++] = (Tri3D){nose, lTip, tail, wr, wg, wb, 0.88f, 1};
                tris[numTris++] = (Tri3D){nose, tail, rTip, wr * 0.85f, wg * 0.85f, wb * 0.85f, 0.88f, 1};
            }
        }
    } else {
        for (int gz = 0; gz < 9; gz++) {
            float zPos = fmodf(gz * 2.2f - t * 3.2f, 19.8f);
            if (zPos < -7.0f) zPos += 19.8f;
            for (int gx = -5; gx <= 5; gx += 2) {
                float elev = sinf(gx * 0.7f + t * 1.5f) * 0.45f;
                Vec3 tilePos = {gx * 1.6f, 3.4f + elev, zPos};
                pushBox3D(tris, &numTris, tilePos, (Vec3){1.2f, 0.14f, 1.4f}, 0, 0, 0,
                          0.20f, 0.85f, 0.95f, 0.55f);
            }
        }
        for (int b = 0; b < 24; b++) {
            float flight = fmodf(hashf(b * 2.9f) + t * 0.18f, 1.0f);
            Vec3 bPos = {(hashf(b * 1.7f) - 0.5f) * 14.0f + sinf(t + b) * 0.9f,
                         (hashf(b * 4.1f) - 0.5f) * 5.0f - 1.2f,
                         lerpf(-6.0f, 9.5f, flight)};
            float flap = sinf(t * 8.5f + b * 1.5f) * 0.70f;
            float sc = 0.55f;
            Vec3 nose = v3add(bPos, (Vec3){0, 0, sc * 1.2f});
            Vec3 tail = v3add(bPos, (Vec3){0, sc * 0.2f, -sc * 1.2f});
            Vec3 lMid = v3add(bPos, (Vec3){-sc * 1.4f, sinf(flap) * sc * 0.85f, 0});
            Vec3 rMid = v3add(bPos, (Vec3){ sc * 1.4f, sinf(flap) * sc * 0.85f, 0});
            if (numTris + 2 < MAX_TRIS) {
                tris[numTris++] = (Tri3D){nose, lMid, tail, 1.0f, 0.82f, 0.35f, 0.85f, 1};
                tris[numTris++] = (Tri3D){nose, tail, rMid, 0.25f, 0.94f, 0.96f, 0.85f, 1};
            }
        }
    }

    flushMeshScene3D(ctx, tris, numTris, camDist, fov, camPanX, camPanY, W, H);
    free(tris);
}

static void renderBackgroundPixels(
    uint8_t *rgba,
    const uint8_t *bank,
    int useCtxBank,
    int totalBankFrames,
    int bankW,
    int bankH,
    int clipA,
    int filmFrame,
    int W, int H,
    float t,
    int ch,
    float vpU,
    float vpV,
    float codaSyntheticMix
) {
    for (int y = 0; y < H; y++) {
        float v = (float)y / H;
        for (int x = 0; x < W; x++) {
            float u = (float)x / W;

            float au = clampf((u - vpU) * 1.35f + 0.5f, 0.0f, 0.999f);
            float av = clampf((v - vpV) * 1.25f + 0.5f, 0.0f, 0.999f);
            float distViewport = sqrtf((u - vpU) * (u - vpU) * 1.4f + (v - vpV) * (v - vpV));
            float vpMask = clampf(1.38f - distViewport * 2.15f, 0.0f, 1.0f);

            float rA, gA, bA, lA;
            if (useCtxBank) {
                sampleBankAbs(bank, totalBankFrames, bankW, bankH, filmFrame, t, ch, au, av, &rA, &gA, &bA, &lA);
            } else {
                sampleArchive(bank, clipA, filmFrame, au, av, &rA, &gA, &bA, &lA);
            }

            float treatR = rA, treatG = gA, treatB = bA;

            if (ch == 1) {
                float pu = floorf(au * 54.0f) / 54.0f;
                float pv = floorf(av * 32.0f) / 32.0f;
                float pR, pG, pB, pL;
                if (useCtxBank) {
                    sampleBankAbs(bank, totalBankFrames, bankW, bankH, filmFrame, t, ch, pu, pv, &pR, &pG, &pB, &pL);
                } else {
                    sampleArchive(bank, clipA, filmFrame, pu, pv, &pR, &pG, &pB, &pL);
                }
                float subpixelX = fmodf((float)x, 3.0f);
                float phosphorR = (subpixelX < 1.0f) ? 1.4f : 0.35f;
                float phosphorG = (subpixelX >= 1.0f && subpixelX < 2.0f) ? 1.4f : 0.35f;
                float phosphorB = (subpixelX >= 2.0f) ? 1.4f : 0.35f;
                treatR = pL * 0.95f * phosphorR;
                treatG = pL * 0.82f * phosphorG;
                treatB = pL * 0.45f * phosphorB;
            } else if (ch == 2) {
                float lR_s, lD_s, dummy;
                if (useCtxBank) {
                    sampleBankAbs(bank, totalBankFrames, bankW, bankH, filmFrame, t, ch, au + 0.008f, av, &dummy, &dummy, &dummy, &lR_s);
                    sampleBankAbs(bank, totalBankFrames, bankW, bankH, filmFrame, t, ch, au, av + 0.012f, &dummy, &dummy, &dummy, &lD_s);
                } else {
                    sampleArchive(bank, clipA, filmFrame, au + 0.008f, av, &dummy, &dummy, &dummy, &lR_s);
                    sampleArchive(bank, clipA, filmFrame, au, av + 0.012f, &dummy, &dummy, &dummy, &lD_s);
                }
                float edge = sqrtf((lR_s - lA) * (lR_s - lA) + (lD_s - lA) * (lD_s - lA)) * 3.5f;
                float scan = 0.5f + 0.5f * sinf(v * 240.0f + t * 6.0f);
                if (edge > 0.20f) {
                    treatR = 0.18f + edge * 0.85f;
                    treatG = 0.98f;
                    treatB = 0.90f + edge * 0.15f;
                } else {
                    treatR = lA * 0.35f * scan;
                    treatG = lA * 0.55f * scan;
                    treatB = lA * 0.75f * scan;
                }
            } else if (ch == 0 || ch == 3) {
                float linePhase = sinf(v * 220.0f + lA * 16.0f + t * 3.5f);
                float lineMask = smoothstepf(0.12f, 0.72f, linePhase);
                treatR = lA * (0.55f + lineMask * 0.70f) * 0.92f;
                treatG = lA * (0.55f + lineMask * 0.70f) * 0.75f;
                treatB = lA * (0.55f + lineMask * 0.70f) * 0.45f;
            } else if (ch == 5) {
                float hx = fmodf(u * 65.0f, 1.0f) - 0.5f;
                float hy = fmodf(v * 65.0f, 1.0f) - 0.5f;
                float hDist = sqrtf(hx * hx + hy * hy);
                float hRadius = lA * 0.56f;
                float dot = (hDist < hRadius) ? 1.0f : 0.0f;
                treatR = rA * 0.45f + dot * 0.95f;
                treatG = gA * 0.55f + dot * 0.88f;
                treatB = bA * 0.45f + dot * 0.35f;
            }

            float fvx, fvy;
            curlVelocity2D(u, v, t * 0.6f, &fvx, &fvy);
            float fluidGlow = clampf((fabsf(fvx) + fabsf(fvy)) * 18.0f, 0.0f, 1.0f);
            float bgR = 0.03f + fluidGlow * 0.10f;
            float bgG = 0.05f + fluidGlow * 0.22f;
            float bgB = 0.10f + fluidGlow * 0.32f;

            float outR = bgR, outG = bgG, outB = bgB;

            if (ch == 0) {
                outR = lerpf(bgR, treatR, vpMask);
                outG = lerpf(bgG, treatG, vpMask);
                outB = lerpf(bgB, treatB + 0.04f, vpMask);
            } else if (ch == 1) {
                int cellX = (int)(u * 48.0f), cellY = (int)(v * 27.0f);
                float caState = hash2f(cellX + floorf(t * 6.0f), cellY + floorf(t * 4.0f));
                float caAlive = (caState > 0.72f) ? (0.35f + 0.45f * sinf(t * 8.0f + cellX)) : 0.0f;
                outR = lerpf(bgR + caAlive * 0.15f, treatR, vpMask * 0.88f);
                outG = lerpf(bgG + caAlive * 0.65f, treatG, vpMask * 0.88f);
                outB = lerpf(bgB + caAlive * 0.55f, treatB, vpMask * 0.88f);
            } else if (ch == 2) {
                outR = lerpf(bgR, treatR, vpMask);
                outG = lerpf(bgG, treatG, vpMask);
                outB = lerpf(bgB, treatB, vpMask);
            } else if (ch == 3) {
                float lensMask = clampf(1.15f - distViewport * 2.6f, 0.0f, 1.0f);
                outR = lerpf(bgR + fluidGlow * 0.25f, treatR, lensMask);
                outG = lerpf(bgG + fluidGlow * 0.52f, treatG, lensMask);
                outB = lerpf(bgB + fluidGlow * 0.65f, treatB, lensMask);
            } else if (ch == 4) {
                float silkKey = clampf((lA - 0.14f) * 1.65f, 0.0f, 1.0f) * vpMask;
                outR = bgR + silkKey * 0.88f;
                outG = bgG + silkKey * 0.84f;
                outB = bgB + 0.08f + silkKey * 0.96f;
            } else if (ch == 5) {
                float scopeMask = clampf(1.20f - distViewport * 2.4f, 0.0f, 1.0f);
                outR = lerpf(bgR, treatR, scopeMask);
                outG = lerpf(bgG, treatG, scopeMask);
                outB = lerpf(bgB, treatB, scopeMask);
            } else if (ch == 6) {
                float wingKey = clampf((lA - 0.12f) * 1.75f, 0.0f, 1.0f) * vpMask;
                float warmTint = 0.5f + 0.5f * sinf((u - vpU) * 6.0f + t * 2.2f);
                outR = 0.05f + fluidGlow * 0.18f + wingKey * lerpf(1.00f, 0.42f, warmTint);
                outG = 0.06f + fluidGlow * 0.28f + wingKey * lerpf(0.68f, 0.96f, warmTint);
                outB = 0.12f + fluidGlow * 0.38f + wingKey * (0.72f + 0.28f * cosf(v * 5.0f));
            } else {
                float skyGrad = clampf(1.0f - v * 1.4f, 0.0f, 1.0f);
                float synR = 0.06f + skyGrad * 0.52f + fluidGlow * 0.18f;
                float synG = 0.05f + skyGrad * 0.28f + fluidGlow * 0.28f;
                float synB = 0.14f + (1.0f - v) * 0.48f + fluidGlow * 0.35f;
                float archR = lA * 0.75f * vpMask;
                float archG = lA * 0.82f * vpMask;
                float archB = lA * 0.92f * vpMask;
                float fadeEnd = t > 175.0f ? clampf((180.0f - t) / 5.0f, 0.0f, 1.0f) : 1.0f;
                outR = lerpf(archR + bgR, synR, codaSyntheticMix) * fadeEnd;
                outG = lerpf(archG + bgG, synG, codaSyntheticMix) * fadeEnd;
                outB = lerpf(archB + bgB, synB, codaSyntheticMix) * fadeEnd;
            }

            int idx = (y * W + x) * 4;
            rgba[idx + 0] = (uint8_t)clampf(outR * 255.0f, 0.0f, 255.0f);
            rgba[idx + 1] = (uint8_t)clampf(outG * 255.0f, 0.0f, 255.0f);
            rgba[idx + 2] = (uint8_t)clampf(outB * 255.0f, 0.0f, 255.0f);
            rgba[idx + 3] = 255;
        }
    }
}

static const float CHAPTER_TIMES[9] = {
    0.000f, 20.488f, 34.000f, 58.537f, 81.951f, 106.829f, 124.000f, 159.512f, 180.000f
};
static const int CHAPTER_CLIP[8] = {0, 1, 2, 3, 4, 5, 4, 0};
static const float CHAPTER_VP[8][2] = {
    {0.36f, 0.46f}, {0.50f, 0.44f}, {0.32f, 0.46f}, {0.68f, 0.38f},
    {0.66f, 0.50f}, {0.28f, 0.50f}, {0.36f, 0.50f}, {0.50f, 0.42f}
};

// Legacy V4 scene renderer
static void renderChapterSceneV4(uint8_t *rgba, CGContextRef ctx, const uint8_t *bank, const CVTrack *tracks, int W, int H, float t, float bpm, AudioFeat af) {
    float beatDur = 60.0f / bpm;
    float barDur = beatDur * 4.0f;
    float currentBar = t / barDur;
    float phrase4Bar = fmodf(currentBar, 4.0f) / 4.0f;

    int ch = 0;
    for (int i = 0; i < 8; i++) {
        if (t >= CHAPTER_TIMES[i] && t < CHAPTER_TIMES[i + 1]) { ch = i; break; }
    }
    int nextCh = (ch < 7) ? (ch + 1) : 7;
    float chStart = CHAPTER_TIMES[ch];
    float chEnd = CHAPTER_TIMES[ch + 1];
    float chDuration = chEnd - chStart;
    float chProgress = clampf((t - chStart) / chDuration, 0.0f, 1.0f);

    float transTime = barDur * 1.5f;
    float morphT = (ch < 7 && t > chEnd - transTime) ? smoothstepf(chEnd - transTime, chEnd, t) : 0.0f;

    int clipA = CHAPTER_CLIP[ch];
    if (ch == 5 && t >= 116.0f) clipA = 6;
    int clipB = CHAPTER_CLIP[nextCh];

    int filmFrame = (int)floorf(t * 15.0f);
    if (t >= 158.0f && t < 164.5f) {
        float revWave = sinf(t * 18.0f) * 12.0f;
        filmFrame = (int)floorf((164.5f - (t - 158.0f) * 1.4f) * 15.0f + revWave);
    }

    CVTrack trA = getTrack(tracks, clipA, filmFrame);
    CVTrack trB = getTrack(tracks, clipB, filmFrame);

    float vpU = lerpf(CHAPTER_VP[ch][0], CHAPTER_VP[nextCh][0], morphT);
    float vpV = lerpf(CHAPTER_VP[ch][1], CHAPTER_VP[nextCh][1], morphT);

    CVTrack tr;
    tr.cx = clampf(lerpf(trA.cx, trB.cx, morphT) * 0.65f + (vpU - 0.32f), 0.12f, 0.88f);
    tr.cy = clampf(lerpf(trA.cy, trB.cy, morphT) * 0.75f + (vpV - 0.38f), 0.15f, 0.85f);
    tr.vx = lerpf(trA.vx, trB.vx, morphT);
    tr.vy = lerpf(trA.vy, trB.vy, morphT);

    float codaSyntheticMix = (t >= 158.5f) ? smoothstepf(158.5f, 164.0f, t) : 0.0f;

    float camDist = 14.0f;
    float fov = 680.0f + af.bass * 40.0f;
    float camPanX = 0.5f;
    float camPanY = 0.5f;
    float charScale = 1.0f;

    if (ch == 0) {
        camDist = lerpf(16.8f, 13.0f, chProgress * chProgress);
        camPanX = lerpf(0.44f, 0.50f, chProgress);
        charScale = lerpf(0.85f, 1.15f, chProgress);
    } else if (ch == 1) {
        camDist = 13.0f + sinf(t * 2.2f) * 0.65f - chProgress * 1.6f;
        camPanX = 0.50f + sinf(t * 1.1f) * 0.05f;
        charScale = 1.25f + sinf(t * 2.8f) * 0.12f;
    } else if (ch == 2) {
        camDist = 10.4f - af.bass * 1.6f + sinf(chProgress * (float)M_PI) * 0.9f;
        camPanX = 0.48f + cosf(t * 0.9f) * 0.07f;
        camPanY = 0.50f - af.transient * 0.04f;
        charScale = 1.55f + af.bass * 0.35f;
    } else if (ch == 3) {
        camDist = 14.2f + sinf(t * 0.65f) * 0.6f;
        camPanX = lerpf(0.40f, 0.60f, chProgress);
        charScale = 1.18f;
    } else if (ch == 4) {
        camDist = 12.8f + sinf(t * 0.45f) * 1.1f;
        camPanX = 0.50f + cosf(t * 0.5f) * 0.07f;
        camPanY = 0.50f + sinf(t * 0.4f) * 0.04f;
        charScale = 1.30f + sinf(t * 0.6f) * 0.16f;
    } else if (ch == 5) {
        camDist = lerpf(14.8f, 9.4f, chProgress * chProgress);
        fov = lerpf(680.0f, 800.0f, chProgress) + af.bass * 60.0f;
        charScale = lerpf(1.10f, 1.70f, chProgress);
    } else if (ch == 6) {
        camDist = 14.5f + sinf(t * 0.8f) * 1.5f;
        fov = 740.0f + af.transient * 65.0f;
        camPanX = 0.50f + sinf(t * 0.6f) * 0.09f;
        charScale = 1.35f + af.mid * 0.25f;
    } else {
        camDist = lerpf(11.5f, 18.5f, chProgress);
        camPanX = lerpf(0.50f, 0.46f, chProgress);
        charScale = lerpf(1.30f, 0.65f, chProgress);
    }

    renderBackgroundPixels(rgba, bank, 0, 0, AW, AH, clipA, filmFrame, W, H, t, ch, vpU, vpV, codaSyntheticMix);

    Vec3 subjCenter3D = unprojectUV(tr.cx, tr.cy, 0.0f, camDist, fov, camPanX, camPanY, W, H);
    buildAndFlushChapterMeshes(ctx, ch, t, af, subjCenter3D, camDist, fov, camPanX, camPanY, W, H);

    float protU = 0.68f, protV = 0.50f;
    drawPixelProtagonistAndMiniGame(ctx, W, H, t, ch, af, tr, &protU, &protV, charScale);

    int fluidCount = (ch == 6) ? 36 : 22;
    drawCurlFluidAndParticles(ctx, W, H, t, af, tr.cx, tr.cy, protU, protV, fluidCount, 0.70f, ch);

    // Map V4 chapter 0..7 to SlopRigId 1..8
    int rigType = ch + 1;
    updateAndRenderDualParticles(ctx, bank, 0, 0, AW, AH, clipA, filmFrame, W, H, t, ch, rigType, 2.8f, af, camDist, fov, camPanX, camPanY, vpU, vpV, phrase4Bar, morphT);
}

static void postProcessToRGB(uint8_t *rgba, uint8_t *scratchRGBA, uint8_t *dstRGB, int W, int H, float t, AudioFeat af, float scanlineFactor, float chromaFactor) {
    float g = clampf(af.glitch + (af.transient > 0.35f ? (af.transient - 0.35f) * 1.25f : 0.0f), 0.0f, 1.15f);
    if (t >= 158.0f && t < 162.0f) {
        g = clampf(g + 0.35f * sinf((t - 158.0f) * 12.0f), 0.18f, 0.95f);
    } else if ((t >= 82.0f && t < 108.0f) || t >= 164.0f) {
        g *= 0.22f;
    }

    int splitPx = (int)roundf((1.5f + g * 9.0f + af.bass * 2.2f) * clampf(chromaFactor * 5.0f, 0.0f, 2.5f));
    float timeSeed = floorf(t * 24.0f);

    memcpy(scratchRGBA, rgba, (size_t)W * (size_t)H * 4);

    for (int y = 0; y < H; y++) {
        int sliceIdx = y / 24;
        float sliceRand = hash2f((float)sliceIdx, timeSeed);
        int sliceShiftX = 0;
        if (g > 0.14f && sliceRand < g * 0.36f) {
            sliceShiftX = (int)((hash2f((float)sliceIdx * 2.3f, timeSeed + 7.0f) - 0.5f) * 64.0f * g);
        }

        float ny = ((float)y / H) * 2.0f - 1.0f;
        float scanline = (y % 2 == 0) ? 1.0f : (1.0f - 0.10f * clampf(scanlineFactor, 0.0f, 1.5f));

        for (int x = 0; x < W; x++) {
            float nx = ((float)x / W) * 2.0f - 1.0f;
            int sx = x + sliceShiftX;
            if (sx < 0) sx += W;
            if (sx >= W) sx -= W;

            int rx = sx + splitPx; if (rx >= W) rx = W - 1;
            int bx = sx - splitPx; if (bx < 0) bx = 0;

            float r = scratchRGBA[(y * W + rx) * 4 + 0];
            float grn = scratchRGBA[(y * W + sx) * 4 + 1];
            float b = scratchRGBA[(y * W + bx) * 4 + 2];

            float r2 = nx * nx + ny * ny;
            float vig = clampf(1.10f - r2 * 0.24f, 0.18f, 1.0f);
            float mult = scanline * vig;

            int outIdx = (y * W + x) * 3;
            dstRGB[outIdx + 0] = (uint8_t)clampf(r * mult, 0.0f, 255.0f);
            dstRGB[outIdx + 1] = (uint8_t)clampf(grn * mult, 0.0f, 255.0f);
            dstRGB[outIdx + 2] = (uint8_t)clampf(b * mult, 0.0f, 255.0f);
        }
    }
}

static void renderCompleteFrameV4(uint8_t *rgba, uint8_t *scratchRGBA, uint8_t *dstRGB, const uint8_t *bank, const CVTrack *tracks, int W, int H, float t, float bpm, AudioFeat af) {
    CGColorSpaceRef cs = CGColorSpaceCreateDeviceRGB();
    CGContextRef ctx = CGBitmapContextCreate(rgba, W, H, 8, W * 4, cs, (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
    CGContextTranslateCTM(ctx, 0, H);
    CGContextScaleCTM(ctx, 1.0, -1.0);

    renderChapterSceneV4(rgba, ctx, bank, tracks, W, H, t, bpm, af);

    CGContextRelease(ctx);
    CGColorSpaceRelease(cs);

    postProcessToRGB(rgba, scratchRGBA, dstRGB, W, H, t, af, 1.0f, 0.2f);
}

// Generalized Slopscore 2.0 `SlopContextFrame` renderer
static void renderCompleteFrameCtx(
    uint8_t *rgba,
    uint8_t *scratchRGBA,
    uint8_t *dstRGB,
    const uint8_t *bank,
    int totalBankFrames,
    int bankW,
    int bankH,
    int W, int H,
    SlopContextFrame cf
) {
    CGColorSpaceRef cs = CGColorSpaceCreateDeviceRGB();
    CGContextRef ctx = CGBitmapContextCreate(rgba, W, H, 8, W * 4, cs, (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
    CGContextTranslateCTM(ctx, 0, H);
    CGContextScaleCTM(ctx, 1.0, -1.0);

    float t = cf.time;
    int ch = ((int)cf.chapter) % 8;
    if (ch < 0) ch = 0;
    AudioFeat af = {cf.rms, cf.bass, cf.mid, cf.high, cf.transient, cf.glitch};

    float camDist = cf.dist > 0.5f ? cf.dist : 14.0f;
    float fovPx = slopFovToPixels(cf.fov > 5.0f ? cf.fov : 56.0f, H);
    float camPanX = cf.panX;
    float camPanY = cf.panY;
    float charScale = cf.charScale > 0.05f ? cf.charScale : 1.0f;
    float vpU = cf.vpU;
    float vpV = cf.vpV;
    int absFrameA = (int)roundf(cf.frameA);
    int rigType = (int)roundf(cf.rigA);
    if (rigType <= 0) rigType = (ch % 8) + 1;

    renderBackgroundPixels(rgba, bank, 1, totalBankFrames, bankW, bankH, (int)cf.clipA, absFrameA, W, H, t, ch, vpU, vpV, 0.0f);

    CVTrack tr = {vpU, vpV, 0, 0};
    Vec3 subjCenter3D = unprojectUV(vpU, vpV, 0.0f, camDist, fovPx, camPanX, camPanY, W, H);

    // Map rigType 1..8 to mesh construct chapter 0..7
    int meshCh = clampf(rigType - 1, 0, 7);
    buildAndFlushChapterMeshes(ctx, meshCh, t, af, subjCenter3D, camDist, fovPx, camPanX, camPanY, W, H);

    float protU = 0.68f, protV = 0.50f;
    drawPixelProtagonistAndMiniGame(ctx, W, H, t, ch, af, tr, &protU, &protV, charScale);

    int fluidCount = (rigType == SLOP_RIG_BUTTERFLIES) ? 36 : 22;
    drawCurlFluidAndParticles(ctx, W, H, t, af, vpU, vpV, protU, protV, fluidCount, 0.70f, meshCh);

    float reliefDepth = cf.reliefDepth >= 0.0f ? cf.reliefDepth : 2.8f;
    updateAndRenderDualParticles(
        ctx, bank, 1, totalBankFrames, bankW, bankH,
        (int)cf.clipA, absFrameA, W, H, t, ch, rigType, reliefDepth,
        af, camDist, fovPx, camPanX, camPanY, vpU, vpV, cf.phrase4Bar, cf.chMorphT
    );

    CGContextRelease(ctx);
    CGColorSpaceRelease(cs);

    postProcessToRGB(rgba, scratchRGBA, dstRGB, W, H, t, af, cf.scanlines, cf.chroma);
}

static void saveRGBAsJpeg(const uint8_t *rgb, int W, int H, NSString *outPath) {
    uint8_t *rgba = (uint8_t *)malloc((size_t)W * (size_t)H * 4);
    for (int i = 0; i < W * H; i++) {
        rgba[i * 4 + 0] = rgb[i * 3 + 0];
        rgba[i * 4 + 1] = rgb[i * 3 + 1];
        rgba[i * 4 + 2] = rgb[i * 3 + 2];
        rgba[i * 4 + 3] = 255;
    }
    CGColorSpaceRef cs = CGColorSpaceCreateDeviceRGB();
    CGContextRef c = CGBitmapContextCreate(rgba, W, H, 8, W * 4, cs, (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
    CGImageRef img = CGBitmapContextCreateImage(c);
    NSURL *url = [NSURL fileURLWithPath:outPath];
    CGImageDestinationRef dest = CGImageDestinationCreateWithURL((__bridge CFURLRef)url, CFSTR("public.jpeg"), 1, NULL);
    if (dest) {
        NSDictionary *props = @{(__bridge id)kCGImageDestinationLossyCompressionQuality: @(0.92)};
        CGImageDestinationAddImage(dest, img, (__bridge CFDictionaryRef)props);
        CGImageDestinationFinalize(dest);
        CFRelease(dest);
    }
    CGImageRelease(img);
    CGContextRelease(c);
    CGColorSpaceRelease(cs);
    free(rgba);
}

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        if (argc < 2) {
            fprintf(stderr, "Usage:\n  native-render <video|sheet|frame> --ctx <context.bin> [--bank <bank.bin> --bank-w 320 --bank-h 180] [--w 1280 --h 720] ...\n");
            return 1;
        }
        NSString *mode = [NSString stringWithUTF8String:argv[1]];

        // Detect whether `--ctx` flag is present (Slopscore 2.0 protocol) vs Legacy V4 positional args
        int hasCtxFlag = 0;
        for (int i = 2; i < argc; i++) {
            if (strcmp(argv[i], "--ctx") == 0) { hasCtxFlag = 1; break; }
        }

        if (hasCtxFlag || [mode isEqualToString:@"frame"]) {
            NSString *ctxPath = nil;
            NSString *bankPath = nil;
            NSString *outPath = nil;
            NSString *framesStr = nil;
            int bankW = 320, bankH = 180;
            int W = 1280, H = 720;
            int cols = 3, thumbW = 640;
            int singleIndex = 0;

            for (int i = 2; i < argc; i++) {
                if (strcmp(argv[i], "--ctx") == 0 && i + 1 < argc) {
                    ctxPath = [NSString stringWithUTF8String:argv[++i]];
                } else if (strcmp(argv[i], "--bank") == 0 && i + 1 < argc) {
                    bankPath = [NSString stringWithUTF8String:argv[++i]];
                } else if (strcmp(argv[i], "--bank-w") == 0 && i + 1 < argc) {
                    bankW = atoi(argv[++i]);
                } else if (strcmp(argv[i], "--bank-h") == 0 && i + 1 < argc) {
                    bankH = atoi(argv[++i]);
                } else if (strcmp(argv[i], "--w") == 0 && i + 1 < argc) {
                    W = atoi(argv[++i]);
                } else if (strcmp(argv[i], "--h") == 0 && i + 1 < argc) {
                    H = atoi(argv[++i]);
                } else if (strcmp(argv[i], "--out") == 0 && i + 1 < argc) {
                    outPath = [NSString stringWithUTF8String:argv[++i]];
                } else if ((strcmp(argv[i], "--frames") == 0 || strcmp(argv[i], "--times") == 0) && i + 1 < argc) {
                    framesStr = [NSString stringWithUTF8String:argv[++i]];
                } else if (strcmp(argv[i], "--cols") == 0 && i + 1 < argc) {
                    cols = atoi(argv[++i]);
                } else if (strcmp(argv[i], "--thumb-w") == 0 && i + 1 < argc) {
                    thumbW = atoi(argv[++i]);
                } else if (strcmp(argv[i], "--index") == 0 && i + 1 < argc) {
                    singleIndex = atoi(argv[++i]);
                }
            }

            if (!ctxPath) {
                fprintf(stderr, "[native-render] Missing --ctx <context.bin>\n");
                return 1;
            }
            NSData *ctxData = [NSData dataWithContentsOfFile:ctxPath];
            if (!ctxData || [ctxData length] < sizeof(SlopContextFrame)) {
                fprintf(stderr, "[native-render] Invalid or empty context.bin: %s\n", [ctxPath UTF8String]);
                return 1;
            }
            const SlopContextFrame *frames = (const SlopContextFrame *)[ctxData bytes];
            int numFrames = (int)([ctxData length] / sizeof(SlopContextFrame));

            if (!bankPath) {
                NSString *candidate = [[ctxPath stringByDeletingLastPathComponent] stringByAppendingPathComponent:@"archive_bank.bin"];
                if ([[NSFileManager defaultManager] fileExistsAtPath:candidate]) {
                    bankPath = candidate;
                }
            }
            NSData *bankData = bankPath ? [NSData dataWithContentsOfFile:bankPath options:NSDataReadingMappedIfSafe error:nil] : nil;
            const uint8_t *bank = bankData ? (const uint8_t *)[bankData bytes] : NULL;
            size_t bankFrameBytes = (size_t)bankW * (size_t)bankH * 3;
            int totalBankFrames = (bankData && bankFrameBytes > 0) ? (int)([bankData length] / bankFrameBytes) : 0;

            if ([mode isEqualToString:@"frame"]) {
                if (!outPath) outPath = @"frame.jpg";
                int idx = singleIndex < 0 ? 0 : (singleIndex >= numFrames ? numFrames - 1 : singleIndex);
                uint8_t *rgba = (uint8_t *)calloc((size_t)W * H * 4, 1);
                uint8_t *scratch = (uint8_t *)calloc((size_t)W * H * 4, 1);
                uint8_t *rgb = (uint8_t *)calloc((size_t)W * H * 3, 1);

                renderCompleteFrameCtx(rgba, scratch, rgb, bank, totalBankFrames, bankW, bankH, W, H, frames[idx]);
                saveRGBAsJpeg(rgb, W, H, outPath);

                free(rgba); free(scratch); free(rgb);
                return 0;
            } else if ([mode isEqualToString:@"sheet"]) {
                if (!outPath) outPath = @"sheet.jpg";
                NSArray<NSString *> *parts = framesStr ? [framesStr componentsSeparatedByString:@","] : @[@"0"];
                int count = (int)[parts count];
                if (cols < 1) cols = 3;
                int rows = (count + cols - 1) / cols;
                int thumbH = (thumbW * H) / W;
                int sheetW = cols * thumbW, sheetH = rows * thumbH;

                uint8_t *sheetRGB = (uint8_t *)calloc((size_t)sheetW * sheetH * 3, 1);
                dispatch_queue_t q = dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0);

                dispatch_apply(count, q, ^(size_t i) {
                    @autoreleasepool {
                        int fIdx = [parts[i] intValue];
                        if (fIdx < 0) fIdx = 0;
                        if (fIdx >= numFrames) fIdx = numFrames - 1;

                        uint8_t *rgba = (uint8_t *)calloc((size_t)W * H * 4, 1);
                        uint8_t *scratch = (uint8_t *)calloc((size_t)W * H * 4, 1);
                        uint8_t *frameRGB = (uint8_t *)calloc((size_t)W * H * 3, 1);

                        renderCompleteFrameCtx(rgba, scratch, frameRGB, bank, totalBankFrames, bankW, bankH, W, H, frames[fIdx]);

                        int col = (int)i % cols;
                        int row = (int)i / cols;
                        for (int ty = 0; ty < thumbH; ty++) {
                            int sy = (ty * H) / thumbH;
                            for (int tx = 0; tx < thumbW; tx++) {
                                int sx = (tx * W) / thumbW;
                                int sIdx = (sy * W + sx) * 3;
                                int dIdx = ((row * thumbH + ty) * sheetW + (col * thumbW + tx)) * 3;
                                sheetRGB[dIdx] = frameRGB[sIdx];
                                sheetRGB[dIdx + 1] = frameRGB[sIdx + 1];
                                sheetRGB[dIdx + 2] = frameRGB[sIdx + 2];
                            }
                        }

                        free(rgba); free(scratch); free(frameRGB);
                    }
                });

                saveRGBAsJpeg(sheetRGB, sheetW, sheetH, outPath);
                free(sheetRGB);
                return 0;
            } else if ([mode isEqualToString:@"video"]) {
                int batchSize = 32;
                uint8_t *batchRGBA = (uint8_t *)calloc((size_t)batchSize * W * H * 4, 1);
                uint8_t *batchScratch = (uint8_t *)calloc((size_t)batchSize * W * H * 4, 1);
                uint8_t *batchOutRGB = (uint8_t *)calloc((size_t)batchSize * W * H * 3, 1);

                dispatch_queue_t q = dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0);

                for (int base = 0; base < numFrames; base += batchSize) {
                    int count = (base + batchSize <= numFrames) ? batchSize : (numFrames - base);

                    dispatch_apply(count, q, ^(size_t k) {
                        @autoreleasepool {
                            int f = base + (int)k;
                            uint8_t *myRGBA = batchRGBA + k * ((size_t)W * H * 4);
                            uint8_t *myScratch = batchScratch + k * ((size_t)W * H * 4);
                            uint8_t *myOutRGB = batchOutRGB + k * ((size_t)W * H * 3);

                            renderCompleteFrameCtx(myRGBA, myScratch, myOutRGB, bank, totalBankFrames, bankW, bankH, W, H, frames[f]);
                        }
                    });

                    fwrite(batchOutRGB, 1, (size_t)count * W * H * 3, stdout);

                    if (base % (batchSize * 10) == 0 || base + count == numFrames) {
                        fprintf(stderr, "[Slopscore Native] Rendered frame %d / %d\n", base + count, numFrames);
                    }
                }

                fflush(stdout);
                free(batchRGBA); free(batchScratch); free(batchOutRGB);
                return 0;
            }
        }

        // Legacy V4 positional protocol:
        //   native-render sheet <features.bin> <out.jpg> <timesStr>
        //   native-render video <features.bin> <startFrame> <endFrame> <fps>
        if (argc < 5) return 1;
        NSString *featPath = [NSString stringWithUTF8String:argv[2]];
        NSData *featData = [NSData dataWithContentsOfFile:featPath];
        if (!featData) return 1;
        const AudioFeat *feats = (const AudioFeat *)[featData bytes];
        int numFeats = (int)([featData length] / sizeof(AudioFeat));

        NSString *outDir = [featPath stringByDeletingLastPathComponent];
        NSString *bankPath = [outDir stringByAppendingPathComponent:@"archive_bank.bin"];
        NSString *trackPath = [outDir stringByAppendingPathComponent:@"cv_tracks.bin"];
        NSData *bankData = [NSData dataWithContentsOfFile:bankPath options:NSDataReadingMappedIfSafe error:nil];
        NSData *trackData = [NSData dataWithContentsOfFile:trackPath options:NSDataReadingMappedIfSafe error:nil];
        const uint8_t *bank = bankData ? (const uint8_t *)[bankData bytes] : NULL;
        const CVTrack *tracks = trackData ? (const CVTrack *)[trackData bytes] : NULL;

        int W = 1280, H = 720;
        float bpm = 164.0f;

        if ([mode isEqualToString:@"sheet"]) {
            NSString *outPath = [NSString stringWithUTF8String:argv[3]];
            NSString *timesStr = [NSString stringWithUTF8String:argv[4]];
            NSArray<NSString *> *parts = [timesStr componentsSeparatedByString:@","];
            int count = (int)[parts count];
            int cols = 3;
            int rows = (count + cols - 1) / cols;
            int thumbW = 640, thumbH = 360;
            int sheetW = cols * thumbW, sheetH = rows * thumbH;

            uint8_t *sheetRGB = (uint8_t *)calloc((size_t)sheetW * sheetH * 3, 1);
            uint8_t *rgba = (uint8_t *)calloc((size_t)W * H * 4, 1);
            uint8_t *scratchRGBA = (uint8_t *)calloc((size_t)W * H * 4, 1);
            uint8_t *frameRGB = (uint8_t *)calloc((size_t)W * H * 3, 1);

            for (int i = 0; i < count; i++) {
                float t = [parts[i] floatValue];
                int fIdx = (int)floorf(t * 30.0f);
                if (fIdx < 0) fIdx = 0;
                if (fIdx >= numFeats) fIdx = numFeats - 1;

                renderCompleteFrameV4(rgba, scratchRGBA, frameRGB, bank, tracks, W, H, t, bpm, feats[fIdx]);

                int col = i % cols;
                int row = i / cols;
                for (int ty = 0; ty < thumbH; ty++) {
                    int sy = (ty * H) / thumbH;
                    for (int tx = 0; tx < thumbW; tx++) {
                        int sx = (tx * W) / thumbW;
                        int sIdx = (sy * W + sx) * 3;
                        int dIdx = ((row * thumbH + ty) * sheetW + (col * thumbW + tx)) * 3;
                        sheetRGB[dIdx] = frameRGB[sIdx];
                        sheetRGB[dIdx + 1] = frameRGB[sIdx + 1];
                        sheetRGB[dIdx + 2] = frameRGB[sIdx + 2];
                    }
                }
            }

            saveRGBAsJpeg(sheetRGB, sheetW, sheetH, outPath);
            free(sheetRGB); free(rgba); free(scratchRGBA); free(frameRGB);
            return 0;
        } else if ([mode isEqualToString:@"video"]) {
            if (argc < 6) return 1;
            int startFrame = atoi(argv[3]);
            int endFrame = atoi(argv[4]);
            float fps = atof(argv[5]);
            int totalFrames = endFrame - startFrame;

            int batchSize = 32;
            uint8_t *batchRGBA = (uint8_t *)calloc((size_t)batchSize * W * H * 4, 1);
            uint8_t *batchScratch = (uint8_t *)calloc((size_t)batchSize * W * H * 4, 1);
            uint8_t *batchOutRGB = (uint8_t *)calloc((size_t)batchSize * W * H * 3, 1);

            dispatch_queue_t q = dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0);

            for (int base = startFrame; base < endFrame; base += batchSize) {
                int count = (base + batchSize <= endFrame) ? batchSize : (endFrame - base);

                dispatch_apply(count, q, ^(size_t k) {
                    @autoreleasepool {
                        int f = base + (int)k;
                        float t = (float)f / fps;
                        int fIdx = f < numFeats ? f : (numFeats - 1);
                        uint8_t *myRGBA = batchRGBA + k * ((size_t)W * H * 4);
                        uint8_t *myScratch = batchScratch + k * ((size_t)W * H * 4);
                        uint8_t *myOutRGB = batchOutRGB + k * ((size_t)W * H * 3);

                        renderCompleteFrameV4(myRGBA, myScratch, myOutRGB, bank, tracks, W, H, t, bpm, feats[fIdx]);
                    }
                });

                fwrite(batchOutRGB, 1, (size_t)count * W * H * 3, stdout);

                if ((base - startFrame) % (batchSize * 20) == 0) {
                    fprintf(stderr, "[Slopscore V4] Rendered frame %d / %d\n", base - startFrame + count, totalFrames);
                }
            }

            fflush(stdout);
            free(batchRGBA); free(batchScratch); free(batchOutRGB);
            return 0;
        }
    }
    return 0;
}
