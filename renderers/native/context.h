// renderers/native/context.h
// Binary frame context contract between `kit/frame-context.js#encodeContextBin`
// and the native C / Objective-C / Metal renderer (`native-render-core.m`).
// Little-endian Float32, SLOP_CONTEXT_STRIDE = 32 floats (128 bytes) per frame.

#ifndef SLOPSCORE_CONTEXT_H
#define SLOPSCORE_CONTEXT_H

#include <math.h>
#include <stdint.h>

#define SLOP_CONTEXT_STRIDE 32

typedef enum {
    SLOP_RIG_NONE = 0,
    SLOP_RIG_GEARS = 1,
    SLOP_RIG_VOXELS = 2,
    SLOP_RIG_SPARK_RINGS = 3,
    SLOP_RIG_CRYSTALS = 4,
    SLOP_RIG_HELIX = 5,
    SLOP_RIG_SPIRAL = 6,
    SLOP_RIG_BUTTERFLIES = 7,
    SLOP_RIG_RELIEF = 8
} SlopRigId;

#pragma pack(push, 4)
typedef struct {
    float time;          // 0: absolute timestamp in seconds
    float bar;           // 1: 1-based musical bar
    float beatPhase;     // 2: 0..1 within current quarter-note beat
    float measurePhase;  // 3: 0..1 within current bar
    float phrase4Bar;    // 4: 0..1 within 4-bar phrase
    float chapter;       // 5: current chapter index
    float nextChapter;   // 6: next chapter index
    float chProgress;    // 7: 0..1 within current chapter
    float chMorphT;      // 8: 0..1 transition morph factor
    float rms;           // 9: audio RMS energy (0..1)
    float bass;          // 10: audio low-frequency energy (0..1)
    float mid;           // 11: audio mid-frequency energy (0..1)
    float high;          // 12: audio high-frequency energy (0..1)
    float transient;     // 13: audio percussive transient (0..1)
    float glitch;        // 14: audio glitch trigger intensity (0..1)
    float panX;          // 15: camera horizontal center (0..1, 0.5 = center)
    float panY;          // 16: camera vertical center (0..1, 0.5 = center)
    float dist;          // 17: camera distance from origin
    float fov;           // 18: vertical field of view in degrees (e.g. 56)
    float roll;          // 19: camera roll in radians
    float charScale;     // 20: protagonist / construct scale multiplier
    float clipA;         // 21: bank clip index for chapter A (-1 = none)
    float clipB;         // 22: bank clip index for chapter B (-1 = none)
    float frameA;        // 23: absolute frame index in archive_bank.bin (-1 = none)
    float frameB;        // 24: absolute frame index in archive_bank.bin for morph (-1 = none)
    float rigA;          // 25: SlopRigId for current chapter
    float rigB;          // 26: SlopRigId for next chapter
    float vpU;           // 27: vanishing point / subject anchor U (0..1)
    float vpV;           // 28: vanishing point / subject anchor V (0..1)
    float scanlines;     // 29: CRT scanline intensity (0..1)
    float chroma;        // 30: chromatic aberration intensity (0..1)
    float reliefDepth;   // 31: archival luma relief Z displacement scale (0 = off)
} SlopContextFrame;
#pragma pack(pop)

static inline float slopFovToPixels(float fovDeg, int H) {
    float deg = fovDeg < 15.0f ? 15.0f : (fovDeg > 140.0f ? 140.0f : fovDeg);
    float rad = (deg * (float)M_PI) / 360.0f;
    return ((float)H * 0.5f) / tanf(rad);
}

#endif // SLOPSCORE_CONTEXT_H
