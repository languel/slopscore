// measure-clock.js — Bar/beat math, quantization, and snapping for Slopscore.
// Isomorphic (browser + Node). No dependencies.
//
// Conventions (used everywhere in Slopscore):
//   - `time` is seconds from the start of the piece.
//   - Bars are 1-BASED in the UI, config and RenderFrameContext: t=0 → bar 1.0.
//     A chapter with startBar 1 / endBar 14 spans [0, 14 * barSec).
//   - `barIndex` is the 0-based integer bar (floor(bar) - 1).
//   - Musical strings are "BAR.BEAT.SIXTEENTH", all 1-based, e.g. "41.1.1".

export const clamp = (v, min = 0, max = 1) => Math.min(Math.max(v, min), max);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (min, max, v) => {
  const x = clamp((v - min) / (max - min), 0, 1);
  return x * x * (3 - 2 * x);
};
export const fract = (x) => x - Math.floor(x);

export const easings = {
  linear: t => t,
  easeInQuad: t => t * t,
  easeOutQuad: t => t * (2 - t),
  easeInOutQuad: t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInCubic: t => t * t * t,
  easeOutCubic: t => (--t) * t * t + 1,
  easeInOutCubic: t => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  easeInExpo: t => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1))),
  easeOutExpo: t => (t === 1 ? 1 : -Math.pow(2, -10 * t) + 1),
  easeOutElastic: t => {
    const p = 0.3;
    return Math.pow(2, -10 * t) * Math.sin(((t - p / 4) * (2 * Math.PI)) / p) + 1;
  },
  snap: (t, sharp = 6) => 1 / (1 + Math.exp(-sharp * (t - 0.5)))
};

// Deterministic hash / value noise (ported from v4 kit/timeline.js)
export function hash(n) {
  const x = Math.sin(n) * 43758.5453123;
  return x - Math.floor(x);
}
export function noise1d(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i), hash(i + 1), u) * 2 - 1;
}
export function noise2d(x, y) {
  const iX = Math.floor(x), iY = Math.floor(y);
  const fX = x - iX, fY = y - iY;
  const uX = fX * fX * (3 - 2 * fX), uY = fY * fY * (3 - 2 * fY);
  const a = hash(iX + iY * 57), b = hash(iX + 1 + iY * 57);
  const c = hash(iX + (iY + 1) * 57), d = hash(iX + 1 + (iY + 1) * 57);
  return lerp(lerp(a, b, uX), lerp(c, d, uX), uY) * 2 - 1;
}

/** Snap modes understood by MeasureClock.snap() and the Studio snap selector. */
export const SNAP_MODES = ['free', 'bar', 'half', 'beat', 'eighth', 'sixteenth'];

export class MeasureClock {
  /**
   * @param {object} opts
   * @param {number} opts.bpm
   * @param {[number, number]} [opts.timeSignature=[4,4]]
   * @param {number} [opts.duration] seconds
   * @param {number} [opts.phraseBars=4]
   */
  constructor({ bpm = 120, timeSignature = [4, 4], duration = 0, phraseBars = 4 } = {}) {
    this.bpm = bpm;
    this.timeSignature = timeSignature;
    this.beatsPerBar = timeSignature[0];
    // Beat length respects the denominator (6/8 at 120 bpm → eighth-note beats).
    this.beatSec = (60 / bpm) * (4 / timeSignature[1]);
    this.barSec = this.beatSec * this.beatsPerBar;
    this.sixteenthSec = this.beatSec / 4;
    this.phraseBars = phraseBars;
    this.duration = duration;
  }

  get totalBars() { return this.duration / this.barSec; }
  get totalBeats() { return this.duration / this.beatSec; }

  /** 1-based fractional bar at time t. */
  barAt(t) { return 1 + t / this.barSec; }

  /** Seconds at 1-based fractional bar. */
  timeAtBar(bar) { return (bar - 1) * this.barSec; }

  /** Full position breakdown for time t. */
  positionAt(t) {
    const rawBeat = t / this.beatSec;
    const beatIndex = Math.floor(rawBeat);
    const beatPhase = rawBeat - beatIndex;
    const rawBar = t / this.barSec;
    const barIndex = Math.floor(rawBar);
    const measurePhase = rawBar - barIndex;
    const beatInBar = ((beatIndex % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar;
    const sixteenth = Math.floor(beatPhase * 4);
    const phrase4Bar = fract(rawBar / this.phraseBars);
    const pulse = Math.exp(-beatPhase * 6.0);
    const isDownbeat = beatInBar === 0;
    return {
      time: t,
      bar: 1 + rawBar,
      barIndex,
      beatIndex,
      beatInBar,
      sixteenth,
      beatPhase,
      measurePhase,
      phrase4Bar,
      pulse,
      isDownbeat,
      downbeatPulse: isDownbeat ? Math.exp(-beatPhase * 4.0) : 0
    };
  }

  /** "41.1.1" style string (1-based bar.beat.sixteenth). */
  format(t) {
    const p = this.positionAt(Math.max(0, t));
    return `${p.barIndex + 1}.${p.beatInBar + 1}.${p.sixteenth + 1}`;
  }

  /** Inverse of format(): (bar, beat, sixteenth) all 1-based → seconds. */
  toSeconds(bar, beat = 1, sixteenth = 1) {
    return (bar - 1) * this.barSec + (beat - 1) * this.beatSec + (sixteenth - 1) * this.sixteenthSec;
  }

  /** Parse "41", "41.2", "41.2.3", "B41.2" or "bar 41.2" → seconds (null when unparseable). */
  parse(str) {
    if (typeof str === 'number') return this.timeAtBar(str);
    const m = String(str).trim().replace(/^(bar|b)\s*/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
    if (!m) return null;
    return this.toSeconds(+m[1], m[2] ? +m[2] : 1, m[3] ? +m[3] : 1);
  }

  /** Grid step in seconds for a snap mode. */
  gridFor(mode) {
    switch (mode) {
      case 'bar': return this.barSec;
      case 'half': return this.barSec / 2;
      case 'beat': return this.beatSec;
      case 'eighth': return this.beatSec / 2;
      case 'sixteenth': return this.sixteenthSec;
      default: return 0;
    }
  }

  /** Quantize t to the nearest grid line of the given mode. */
  snap(t, mode = 'beat') {
    const g = this.gridFor(mode);
    if (!g) return t;
    const s = Math.round(t / g) * g;
    return this.duration ? clamp(s, 0, this.duration) : Math.max(0, s);
  }

  /** Bar marker list (1-based) every `every` bars, for timeline grids. */
  barMarkers(every = 8) {
    const out = [];
    const n = Math.floor(this.totalBars);
    for (let b = 1; b <= n + 1; b += every) out.push({ bar: b, time: this.timeAtBar(b), label: `B${b}` });
    return out;
  }
}

/** Clock-time formatting "MM:SS.ss". */
export function formatClock(secs) {
  const s = Math.max(0, secs || 0);
  const m = Math.floor(s / 60);
  const rem = (s % 60).toFixed(2);
  return `${String(m).padStart(2, '0')}:${rem.padStart(5, '0')}`;
}
