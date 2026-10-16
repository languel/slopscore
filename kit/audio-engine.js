// audio-engine.js - Procedural Slopscore Audio Engine & Multi-Stem Preview Mixer
// Ported and generalized from mtv-willnever-v4/kit/audio-engine.js.
// Isomorphic: works in both Node.js and the browser.

import { MeasureClock } from './measure-clock.js';

export function audioBufferToWav(buffer, opt = {}) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = opt.float32 ? 3 : 1;
  const bitDepth = format === 3 ? 32 : 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const length = buffer.length * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + length);
  const view = new DataView(arrayBuffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, length, true);

  const channels = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      if (format === 1) {
        const s = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, s, true);
        offset += 2;
      } else {
        view.setFloat32(offset, sample, true);
        offset += 4;
      }
    }
  }
  return arrayBuffer;
}

/** Decode a PCM16 or Float32 WAV ArrayBuffer/Uint8Array into an AudioBuffer-like object. */
export function wavToAudioBuffer(bytes) {
  const buf = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const view = new DataView(buf);
  let offset = 12;
  let format = 1, numChannels = 2, sampleRate = 44100, bitDepth = 16, dataOffset = 44, dataLen = buf.byteLength - 44;
  while (offset + 8 <= buf.byteLength) {
    const id = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      format = view.getUint16(offset + 8, true);
      numChannels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitDepth = view.getUint16(offset + 22, true);
    } else if (id === 'data') {
      dataOffset = offset + 8;
      dataLen = Math.min(size, buf.byteLength - dataOffset);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  const bytesPerSample = bitDepth / 8;
  const totalFrames = Math.floor(dataLen / (numChannels * bytesPerSample));
  const channels = Array.from({ length: numChannels }, () => new Float32Array(totalFrames));
  let ptr = dataOffset;
  for (let i = 0; i < totalFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      if (format === 3 && bitDepth === 32) {
        channels[c][i] = view.getFloat32(ptr, true);
      } else if (bitDepth === 16) {
        channels[c][i] = view.getInt16(ptr, true) / 0x8000;
      } else if (bitDepth === 8) {
        channels[c][i] = (view.getUint8(ptr) - 128) / 128;
      }
      ptr += bytesPerSample;
    }
  }
  return {
    sampleRate,
    length: totalFrames,
    duration: totalFrames / sampleRate,
    numberOfChannels: numChannels,
    getChannelData(c) { return channels[Math.min(c, numChannels - 1)]; }
  };
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function hash32(n) {
  let x = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export class ProceduralScore {
  constructor({ bpm = 164, duration = 180, sampleRate = 44100, rootNote = 53, chapters = null } = {}) {
    this.bpm = bpm;
    this.duration = duration;
    this.sampleRate = sampleRate;
    this.rootNote = rootNote;
    this.chapters = chapters;
    this.beatSec = 60 / bpm;
    this.stepSec = this.beatSec / 4; // 16th note
    this.barSec = this.stepSec * 16;
    this.clock = new MeasureClock({ bpm, duration });
  }

  mtof(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  // Maps any song duration onto the 8-part reference narrative structure
  // (Exact 180s timestamps preserved bit-for-bit when duration === 180).
  canonTime(t) {
    return this.duration === 180 ? t : (t / Math.max(1, this.duration)) * 180;
  }

  partAt(t) {
    if (Array.isArray(this.chapters) && this.chapters.length) {
      const bar = Math.floor(t / this.barSec) + 1;
      const chIdx = this.chapters.findIndex(c => bar >= (c.startBar || 1) && bar <= (c.endBar || 9999));
      if (chIdx !== -1) {
        const ch = this.chapters[chIdx];
        if (ch.mood) {
          const MOOD_MAP = {
            intro: 0, sparse: 0, ambient: 0,
            verse: 1, arp: 1,
            buildup: 2, level1: 2, electro: 2, letters: 2,
            drop: 3, hook: 3, heavy: 3, regret: 3,
            dub: 4, groove: 4, halftime: 4, static: 4,
            breakdown: 5, minimal: 5, forgetting: 5,
            crescendo: 5,
            climax: 6, peak: 6, max: 6, thunder: 6,
            outro: 7, coda: 7, release: 7, sun: 7
          };
          const m = String(ch.mood).toLowerCase();
          if (MOOD_MAP[m] !== undefined) return MOOD_MAP[m];
        }
        return chIdx % 8;
      }
    }
    const ct = this.canonTime(t);
    if (ct < 20.0) return 0;       // 0..20s: Sparse Intro -> Rhythmic Buildup -> 20s "ON"
    if (ct < 34.0) return 1;       // 20..34s: Verse A -> Gentle Glitch Buildup (26..33s) -> Drop Vacuum
    if (ct < 58.536) return 2;     // 34..58.54s: Machine Level 1 (Hook A, locked 164 BPM grid -> 58.0s Stutter)
    if (ct < 82.0) return 3;       // 58.54..82s: Half-Time Dub Groove (FM Marimba, Sub Bass)
    if (ct < 108.0) return 4;      // 82..108s: Microscopic Ambient Breakdown
    if (ct < 124.0) return 5;      // 108..124s: Golden Spiral Crescendo Buildup
    if (ct < 159.512) return 6;    // 124..159.51s: Grand Climax (Hook B, Butterfly Field -> 158.5s Break)
    return 7;                      // 159.51..180s: Coda (Fmaj9 Picardy Major Release -> Ambient Sunset)
  }

  async synthesize({ returnStems = false } = {}) {
    const sr = this.sampleRate;
    const totalSamples = Math.ceil(this.duration * sr);
    const left = new Float32Array(totalSamples);
    const right = new Float32Array(totalSamples);

    const stemBuffers = returnStems ? {
      bass: [new Float32Array(totalSamples), new Float32Array(totalSamples)],
      pads: [new Float32Array(totalSamples), new Float32Array(totalSamples)],
      lead: [new Float32Array(totalSamples), new Float32Array(totalSamples)],
      drums: [new Float32Array(totalSamples), new Float32Array(totalSamples)],
      melodic: [new Float32Array(totalSamples), new Float32Array(totalSamples)],
      glitch: [new Float32Array(totalSamples), new Float32Array(totalSamples)]
    } : null;

    const addSample = (stemKey, idx, valL, valR) => {
      left[idx] += valL;
      right[idx] += valR;
      if (stemBuffers && stemBuffers[stemKey]) {
        stemBuffers[stemKey][0][idx] += valL;
        stemBuffers[stemKey][1][idx] += valR;
      }
    };

    const stepSec = this.stepSec;
    const barSec = stepSec * 16;

    const noiseLen = sr * 2;
    const white = new Float32Array(noiseLen);
    const pink = new Float32Array(noiseLen);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < noiseLen; i++) {
      const w = hash32(i + 999) * 2 - 1;
      white[i] = w;
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      pink[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
    }

    const progVerse = [
      [53, 60, 63, 67, 70], // Fm9
      [49, 56, 60, 63, 68], // Dbmaj9
      [46, 53, 58, 61, 65], // Bbm9
      [51, 58, 63, 67, 70]  // Ebmaj9
    ];
    const progBridge = [
      [44, 51, 56, 60, 63], // Abmaj9
      [41, 48, 53, 56, 60], // Fm11
      [49, 56, 60, 65, 68], // Dbmaj9
      [48, 55, 58, 64, 67]  // C7alt
    ];
    const progClimax = [
      [53, 60, 65, 68, 72], // Fm(add9)
      [49, 56, 61, 65, 68], // Dbmaj7
      [44, 51, 56, 60, 63], // Abmaj7
      [51, 58, 63, 67, 70]  // Eb6/9
    ];
    const progOutro = [
      [53, 60, 65, 69, 72], // Fmaj9 (Picardy major release!)
      [49, 56, 60, 65, 68], // Dbmaj9
      [53, 60, 65, 69, 72], // Fmaj9
      [53, 60, 65, 69, 72]
    ];

    const chordAtTime = (t) => {
      const p = this.partAt(t);
      const bar = Math.floor(t / barSec);
      const idx = Math.floor(bar / 2) % 4;
      if (p === 4 || p === 5) return progBridge[idx];
      if (p === 6) return progClimax[idx];
      if (p === 7) return progOutro[idx];
      return progVerse[idx];
    };

    // LAYER 1: CONTINUOUS PADS, BASS ARCHITECTURE, RISERS & SMOOTH-DECAY LEAD
    let subPhase = 0, reese1 = 0, reese2 = 0;
    const padPhases = [0, 0, 0, 0, 0];
    let leadPhase = 0, leadVib = 0, curLeadFreq = 440;
    let riserPhase = 0;
    let lpL = 0, lpR = 0;

    for (let i = 0; i < totalSamples; i++) {
      const rawT = i / sr;
      const t = this.canonTime(rawT);
      const part = this.partAt(rawT);
      const chord = chordAtTime(rawT);

      // Chapter-aware transition analysis
      let isChapterEnd = false;
      let chapterBarFrac = 0;
      let inChapterDropSilence = false;
      let inChapterRiser = false;
      let curChapter = null;

      if (Array.isArray(this.chapters) && this.chapters.length) {
        const curBar = Math.floor(rawT / barSec) + 1;
        const ch = this.chapters.find(c => curBar >= (c.startBar || 1) && curBar <= (c.endBar || 9999));
        if (ch) {
          curChapter = ch;
          if (curBar === ch.endBar) {
            isChapterEnd = true;
            chapterBarFrac = (rawT % barSec) / barSec;
            if (chapterBarFrac >= 0.72) inChapterDropSilence = true;
            if (chapterBarFrac >= 0.35) inChapterRiser = true;
          }
        }
      } else {
        if ((t >= 33.1 && t < 34.0) || (t >= 123.1 && t < 124.0)) inChapterDropSilence = true;
        if ((t >= 26.5 && t < 33.1) || (t >= 112.0 && t < 123.1)) inChapterRiser = true;
      }

      const inDropSilence = inChapterDropSilence || (t >= 33.1 && t < 34.0) || (t >= 123.1 && t < 124.0);

      // BIOELECTRIC GROUNDING HUM (60Hz fundamental + 120Hz/180Hz mains lab grounding)
      const humFund = Math.sin(2 * Math.PI * 60.0 * rawT);
      const hum2 = Math.sin(2 * Math.PI * 120.0 * rawT) * 0.35;
      const hum3 = Math.sin(2 * Math.PI * 180.0 * rawT) * 0.15;
      const humDrift = 1.0 + 0.03 * Math.sin(2 * Math.PI * 0.12 * rawT);
      const humRaw = (humFund + hum2 + hum3) * humDrift;
      const humAmp = (part === 0 || part === 4 || part === 5 || part === 7) ? 0.026 : 0.014;
      const humL = Math.tanh(humRaw * 1.5) * humAmp;
      const humR = Math.tanh((humRaw + Math.sin(2 * Math.PI * 60.08 * rawT) * 0.18) * 1.5) * humAmp;
      addSample('glitch', i, humL, humR);

      // IONIZING CRACKLE & CORONA SPARKS (Bioelectricity)
      const sparkProb = (part === 4) ? 0.0032 : (part === 6 || inChapterRiser) ? 0.0024 : 0.0006;
      if (hash32(i + 1337) < sparkProb) {
        const sparkDur = Math.min(totalSamples - i, Math.floor(0.005 * sr));
        const arcFreq = 2200 + hash32(i + 42) * 5400;
        let arcP = 0;
        const sparkPan = 0.2 + 0.6 * hash32(i + 99);
        for (let sj = 0; sj < sparkDur; sj++) {
          const sdt = sj / sr;
          arcP += (arcFreq * (1.0 - sdt * 60)) / sr;
          const arcSig = (Math.sin(2 * Math.PI * arcP) * 0.45 + white[(i + sj) % noiseLen] * 0.85) * Math.exp(-sdt * 350) * 0.22;
          addSample('glitch', i + sj, arcSig * sparkPan, arcSig * (1 - sparkPan));
        }
      }

      let padAmp = 0.28;
      if (part === 0) {
        padAmp = 0.12 + 0.20 * Math.min(1.0, (rawT % (barSec * 16)) / (barSec * 16));
      } else if (part === 1) {
        padAmp = 0.35 + 0.15 * Math.min(1.0, (rawT % (barSec * 16)) / (barSec * 16));
      } else if (part === 2) {
        padAmp = 0.42;
      } else if (part === 3) {
        padAmp = 0.45;
      } else if (part === 4) {
        padAmp = 0.30;
      } else if (part === 5) {
        padAmp = 0.85; // ambient wash
      } else if (part === 6) {
        padAmp = 0.78; // climax
      } else {
        const outProg = Math.min(1.0, (rawT % (barSec * 16)) / (barSec * 16));
        padAmp = 0.75 * Math.max(0, 1.0 - outProg);
      }

      const wow = 1.0 + 0.0018 * Math.sin(2 * Math.PI * 0.45 * rawT);
      let padL = 0, padR = 0;
      for (let v = 0; v < 5; v++) {
        const f = this.mtof(chord[v]) * wow * (1 + (v - 2) * 0.0012);
        padPhases[v] = (padPhases[v] + f / sr) % 1.0;
        const p = padPhases[v];
        const tri = 1.0 - 4.0 * Math.abs(Math.round(p - 0.25) - (p - 0.25));
        const saw = p * 2.0 - 1.0;
        const sig = (tri * 0.7 + saw * 0.3) * 0.14;
        if (v % 2 === 0) { padL += sig * 1.1; padR += sig * 0.7; }
        else { padL += sig * 0.7; padR += sig * 1.1; }
      }
      addSample('pads', i, padL * padAmp, padR * padAmp);

      if (!inDropSilence && part !== 5) {
        let bassMidi = chord[0] - 12;
        const step = Math.floor(rawT / stepSec);
        const s16 = step % 16;
        const curBar = Math.floor(step / 16);

        if (part === 0) {
          if (s16 === 8) bassMidi += 12;
        } else if (part === 2) {
          if (s16 === 3 || s16 === 7 || s16 === 11 || s16 === 14) bassMidi += 12;
        } else if (part === 3) {
          if (s16 === 3 || s16 === 7 || s16 === 14) bassMidi += 12;
          else if (s16 === 11) bassMidi += 7;
        } else if (part === 4) {
          if (s16 === 7 || s16 === 14) bassMidi += 12;
        } else if (part === 6 && (s16 % 4 === 2)) {
          bassMidi += 12;
        }

        let bassFreq = this.mtof(bassMidi);

        // Sub Dive Bomb on Chapter 3 (drop) and Chapter 6 (climax) downbeats
        if (curChapter) {
          const barInCh = (curBar + 1) - curChapter.startBar;
          if (barInCh === 0 && (part === 3 || part === 6)) {
            const diveFrac = (rawT % barSec) / (barSec * 0.5);
            if (diveFrac < 1.0) {
              bassFreq *= (1.0 - 0.42 * Math.sin(diveFrac * Math.PI * 0.5));
            }
          }
        } else if (t >= 57.5 && t < 58.54) {
          const dive = (t - 57.5) / 1.04;
          bassFreq *= (1.0 - 0.32 * Math.sin(dive * Math.PI));
        }

        subPhase = (subPhase + bassFreq / sr) % 1.0;
        reese1 = (reese1 + (bassFreq * 0.994) / sr) % 1.0;
        reese2 = (reese2 + (bassFreq * 1.006) / sr) % 1.0;

        const stepPhase = (rawT % stepSec) / stepSec;
        let bassEnv = 1.0;
        let cutoff = 0.06;

        if (part === 0) {
          bassEnv = (s16 === 0 || s16 === 8) ? Math.exp(-stepPhase * 3.5) * 0.65 : 0.0;
          cutoff = 0.045;
        } else if (part === 1) {
          bassEnv = Math.exp(-stepPhase * 4.5) * 0.70;
          cutoff = 0.05 + 0.15 * Math.exp(-stepPhase * 4.0);
        } else if (part === 2) {
          // Fast electro bass
          bassEnv = Math.exp(-stepPhase * 3.8) * 0.85;
          cutoff = 0.08 + 0.16 * Math.exp(-stepPhase * 6.0);
        } else if (part === 3 || part === 6) {
          // Wobble Bass
          const wobbleFreq = this.bpm / 30;
          const wobble = 0.5 + 0.5 * Math.sin(2 * Math.PI * wobbleFreq * rawT);
          bassEnv = 0.88;
          cutoff = 0.07 + 0.20 * wobble;
        } else if (part === 4) {
          // Deep Dub Sub
          bassEnv = 0.82;
          cutoff = 0.042;
        } else {
          bassEnv = 0.75;
          cutoff = 0.04;
        }

        const sub = Math.sin(2 * Math.PI * subPhase);
        const rawL = (reese1 * 2 - 1) * 0.55 + sub * 0.75;
        const rawR = (reese2 * 2 - 1) * 0.55 + sub * 0.75;
        lpL += cutoff * (rawL - lpL);
        lpR += cutoff * (rawR - lpR);

        addSample('bass', i, lpL * bassEnv * 0.44, lpR * bassEnv * 0.44);
      }

      // DYNAMIC CHAPTER TRANSITION RISER SWELLS
      if (inChapterRiser) {
        const p = (chapterBarFrac - 0.35) / 0.65;
        const rFreq = 140 * Math.pow(2, p * 3.4);
        riserPhase = (riserPhase + rFreq / sr) % 1.0;
        const rNoise = white[i % noiseLen] * 0.45 + pink[i % noiseLen] * 0.55;
        const rSig = (Math.sin(2 * Math.PI * riserPhase) * 0.4 + rNoise * 0.6) * Math.pow(p, 2.2) * 0.35;
        addSample('glitch', i, rSig * 0.88, rSig * 1.12);

        // Pre-drop sharp static snap on the final 50ms
        if (chapterBarFrac >= 0.95) {
          const snapSig = (white[i % noiseLen] * 0.7 + Math.sin(2 * Math.PI * 3200 * rawT) * 0.3) * 0.35;
          addSample('glitch', i, snapSig, snapSig);
        }
      } else if (!this.chapters) {
        if (part === 0 && t >= 14.5 && t < 19.8) {
          const p = (t - 14.5) / 5.3;
          const rFreq = 110 * Math.pow(2, p * 3.0);
          riserPhase = (riserPhase + rFreq / sr) % 1.0;
          const rSig = (Math.sin(2 * Math.PI * riserPhase) * 0.45 + pink[i % noiseLen] * 0.55) * p * p * 0.24;
          addSample('glitch', i, rSig * 0.9, rSig * 1.1);
        }
        if (part === 1 && t >= 26.5 && t < 33.1) {
          const p = (t - 26.5) / 6.6;
          const rFreq = 220 * Math.pow(2, p * 2.2);
          riserPhase = (riserPhase + rFreq / sr) % 1.0;
          const rSig = (Math.sin(2 * Math.PI * riserPhase) * 0.35 + pink[i % noiseLen] * 0.35) * Math.pow(p, 2.5) * 0.16;
          addSample('glitch', i, rSig * 0.9, rSig * 1.1);
        }
        if (part === 5 && t >= 112.0 && t < 123.1) {
          const p = (t - 112) / 11.1;
          const rFreq = 220 * Math.pow(2, p * 2.5);
          riserPhase = (riserPhase + rFreq / sr) % 1.0;
          const rSig = (Math.sin(2 * Math.PI * riserPhase) * 0.5 + pink[i % noiseLen] * 0.5) * p * p * 0.22;
          addSample('glitch', i, rSig, rSig);
        }
      }

      // LEAD SYNTHESIS (Hook A during Drop/Machine 3, Hook B during Climax/Machine 6)
      const playLead = (part === 3 || part === 6 || (!this.chapters && ((t >= 34.0 && t < 60.5) || (t >= 124.0 && t < 164.5))));
      if (playLead && !inDropSilence) {
        const isClimax = (part === 6 || t >= 124.0);
        const mStep = Math.floor(rawT / (stepSec * 2));
        const hookA = [72, 75, 77, 80, 79, 75, 72, 68, 70, 72, 75, 77, 75, 72, 70, 67];
        const hookB = [77, 80, 84, 82, 80, 77, 75, 72, 75, 77, 80, 84, 87, 84, 80, 77];
        const mel = isClimax ? hookB : hookA;
        let targetMidi = mel[mStep % mel.length];

        const targetFreq = this.mtof(targetMidi);
        curLeadFreq += (targetFreq - curLeadFreq) * 0.0020;
        leadVib = (leadVib + 5.5 / sr) % 1.0;
        const vib = 1.0 + 0.005 * Math.sin(2 * Math.PI * leadVib);
        leadPhase = (leadPhase + (curLeadFreq * vib) / sr) % 1.0;

        const leadAmp = (isClimax ? 0.17 : 0.13);
        const sig = (Math.sin(2 * Math.PI * leadPhase) * 0.65 + ((leadPhase * 2 - 1) * 0.35)) * leadAmp;
        addSample('lead', i, sig * 0.88, sig * 1.12);
      }
    }

    // LAYER 2: STRICT QUANTIZED STEP SEQUENCER
    const introMelody = [72, 0, 75, 77, 0, 80, 79, 0, 75, 72, 0, 70, 68, 0, 70, 72];
    const totalSteps = Math.floor(this.duration / stepSec);

    for (let step = 0; step < totalSteps; step++) {
      const rawT0 = step * stepSec;
      const t0 = this.canonTime(rawT0);
      const startIdx = Math.floor(rawT0 * sr);
      if (startIdx >= totalSamples) break;

      const part = this.partAt(rawT0);
      const s16 = step % 16;
      const bar = Math.floor(step / 16);
      const chord = chordAtTime(rawT0);
      let inChapterDropSilence = false;
      if (Array.isArray(this.chapters) && this.chapters.length) {
        const curBar = Math.floor(rawT0 / barSec) + 1;
        const ch = this.chapters.find(c => curBar >= (c.startBar || 1) && curBar <= (c.endBar || 9999));
        if (ch && curBar === ch.endBar) {
          const frac = (rawT0 % barSec) / barSec;
          if (frac >= 0.72) inChapterDropSilence = true;
        }
      } else {
        if ((t0 >= 33.1 && t0 < 34.0) || (t0 >= 123.1 && t0 < 124.0)) inChapterDropSilence = true;
      }
      const inDropSilence = inChapterDropSilence;

      let playRhodes = false;
      if (part === 0) {
        if (t0 < 7.5) playRhodes = (s16 === 0 || s16 === 6 || s16 === 12) && introMelody[s16] > 0;
        else if (t0 < 14.5) playRhodes = (introMelody[s16] > 0);
        else playRhodes = (introMelody[s16] > 0 || s16 % 4 === 0);
      } else if (part === 1 || part === 4 || part === 5 || part === 7) {
        playRhodes = (introMelody[s16] > 0 || (part >= 4 && s16 % 2 === 0));
      } else {
        playRhodes = (s16 % 3 === 0);
      }

      if (playRhodes && !inDropSilence) {
        const midi = (part === 0 && introMelody[s16] > 0)
          ? introMelody[s16]
          : (chord[(step + bar) % chord.length] + ((step % 4 === 0) ? 12 : 0));
        const freq = this.mtof(midi);
        const dur = Math.floor(Math.min(0.45, stepSec * 2.8) * sr);
        const pan = 0.5 + 0.38 * Math.sin(step * 0.8);
        let vol = (part === 0 || part === 4 || part === 7) ? 0.22 : 0.14;
        if (t0 < 7.5) vol *= 0.75;
        if (t0 > 168.0) vol *= Math.max(0, (179.5 - t0) / 11.5);

        let cP = 0, mP = 0;
        for (let j = 0; j < dur && startIdx + j < totalSamples; j++) {
          const dt = j / sr;
          mP += (freq * 2.0) / sr;
          const modEnv = Math.exp(-dt * 24) * 0.9;
          cP += (freq + Math.sin(2 * Math.PI * mP) * freq * modEnv) / sr;
          const env = Math.exp(-dt * 7.0) * vol;
          const sig = Math.sin(2 * Math.PI * cP) * env;
          addSample('melodic', startIdx + j, sig * pan, sig * (1 - pan));
        }
      }

      // FM METALLIC BELL-MARIMBA (Active in Chapter 4 / Static Harvesting)
      const playFmBell = (part === 4 || (t0 >= 58.54 && t0 < 84.0)) && (s16 === 0 || s16 === 3 || s16 === 6 || s16 === 10 || s16 === 13);
      if (playFmBell && !inDropSilence) {
        const mMidi = chord[s16 % chord.length] + 12;
        const mFreq = this.mtof(mMidi);
        const mDur = Math.floor(0.18 * sr);
        let cP = 0, mP = 0;
        for (let j = 0; j < mDur && startIdx + j < totalSamples; j++) {
          const dt = j / sr;
          mP += (mFreq * 4.0) / sr;
          cP += (mFreq + Math.sin(2 * Math.PI * mP) * mFreq * Math.exp(-dt * 55) * 1.8) / sr;
          const sig = Math.sin(2 * Math.PI * cP) * Math.exp(-dt * 22) * 0.25;
          addSample('melodic', startIdx + j, sig * (s16 % 2 === 0 ? 1.15 : 0.75), sig * (s16 % 2 === 0 ? 0.75 : 1.15));
        }
      }

      // TB-303 SCREAMING ACID RESONANT LINE (Active in Chapter 6 / Predicting Thunder)
      if (part === 6 && !inDropSilence) {
        const acidRiff = [41, 41, 53, 44, 41, 56, 41, 48, 41, 41, 53, 56, 58, 56, 53, 48];
        const aMidi = acidRiff[s16];
        const aFreq = this.mtof(aMidi);
        const aDur = Math.floor(stepSec * 0.88 * sr);
        let aPhase = 0;
        let flt = 0;
        const resCutoff = 0.08 + 0.35 * Math.exp(-(s16 % 4 === 0 ? 0.05 : 0.25) * 8.0);
        for (let j = 0; j < aDur && startIdx + j < totalSamples; j++) {
          const dt = j / sr;
          aPhase = (aPhase + aFreq / sr) % 1.0;
          const saw = aPhase * 2.0 - 1.0;
          flt += resCutoff * (saw - flt);
          const sig = flt * Math.exp(-dt * 12.0) * 0.22;
          addSample('bass', startIdx + j, sig * 0.95, sig * 1.05);
        }
      }

      if (part === 5 && (bar % 16) < 8) continue; // silence drums in first 8 bars of breakdown
      if (t0 > 182.0 || inDropSilence) continue;

      let drumAmp = 0.90;
      let isKick = false;
      let isSnare = false;
      let isGhost = false;
      let isDrillRoll = false;
      let isReverseShuffle = false;
      let isMicroClick = false;

      if (part === 0) {
        if (s16 === 0 || s16 === 8) isKick = true;
        if (s16 % 4 === 2) isMicroClick = true;
        if (bar >= 8 && (s16 === 4 || s16 === 12)) isGhost = true;
      } else if (part === 1) {
        isKick = (s16 === 0 || s16 === 10);
        isSnare = (s16 === 4 || s16 === 12);
        isGhost = (s16 === 7 || s16 === 14);
        isReverseShuffle = (s16 === 3 || s16 === 11 || s16 === 15);
      } else if (part === 2) {
        // Fast broken-beat electro & telegraph transmission (Ch 2: Sending Letters)
        isKick = (s16 === 0 || s16 === 3 || s16 === 8 || s16 === 11);
        isSnare = (s16 === 4 || s16 === 12);
        isGhost = (s16 === 6 || s16 === 14);
        isMicroClick = (s16 === 2 || s16 === 5 || s16 === 9 || s16 === 15);
        isReverseShuffle = (s16 === 7 || s16 === 13);
        isDrillRoll = (bar % 2 === 1 && (s16 === 14 || s16 === 15));
      } else if (part === 3) {
        // Heavy Drop / Measuring Regret
        const fillBar = (bar % 4 === 3);
        isKick = (s16 === 0 || s16 === 6 || s16 === 10 || (fillBar && s16 === 11));
        isSnare = (s16 === 4 || s16 === 12 || (fillBar && s16 === 14));
        isGhost = (s16 === 7 || s16 === 9 || s16 === 15);
        isDrillRoll = (fillBar && (s16 === 13 || s16 === 15));
      } else if (part === 4) {
        // Half-Time Dub / Static Harvesting
        isKick = (s16 === 0 || s16 === 7 || s16 === 14);
        isSnare = (s16 === 8);
        isGhost = (s16 === 11 || s16 === 15);
        isMicroClick = (s16 % 4 === 2);
      } else if (part === 5) {
        // Ambient Breakdown & Golden Spiral Crescendo / Forgetting Names
        const prog = (bar % 16) / 16;
        if (prog >= 0.5) {
          isKick = (prog > 0.75) ? (s16 % 2 === 0) : (s16 % 4 === 0);
          isSnare = (prog > 0.65 && (s16 === 4 || s16 === 12));
          isReverseShuffle = (s16 === 3 || s16 === 11);
          isDrillRoll = (prog > 0.85 && (s16 === 14 || s16 === 15));
        }
      } else if (part === 6) {
        // Grand Climax / Predicting Thunder
        const fillBar = (bar % 4 === 3);
        isKick = (s16 % 4 === 0 || s16 === 10 || (fillBar && s16 === 11));
        isSnare = (s16 === 4 || s16 === 12 || (fillBar && s16 === 14));
        isGhost = (s16 === 7 || s16 === 9 || s16 === 15);
        isDrillRoll = (fillBar && (s16 === 13 || s16 === 15));
      } else if (part === 7) {
        // Outro / Remembering the Sun
        const prog = (bar % 16) / 16;
        if (prog < 0.6) {
          isKick = (s16 === 0 || s16 === 10);
          isGhost = (s16 === 4 || s16 === 12);
          isMicroClick = (s16 % 4 === 2);
        }
      }
      if (t0 >= 159.512) {
        drumAmp = 0.90 * Math.max(0, 1.0 - (t0 - 159.512) / 10.0);
      }

      if (isKick) {
        const dur = Math.floor(0.20 * sr);
        let phase = 0;
        for (let j = 0; j < dur && startIdx + j < totalSamples; j++) {
          const dt = j / sr;
          const freq = 48 + 138 * Math.exp(-dt * 44);
          phase += freq / sr;
          const env = Math.exp(-dt * 15) * 0.68 * drumAmp;
          const click = dt < 0.006 ? white[j] * 0.35 : 0;
          const sig = (Math.sin(2 * Math.PI * phase) + click) * env;
          addSample('drums', startIdx + j, sig, sig);
        }
      }

      if (isSnare || isGhost) {
        const dur = Math.floor((isSnare ? 0.16 : 0.07) * sr);
        const vol = (isSnare ? 0.60 : 0.24) * drumAmp;
        let bp = 0;
        for (let j = 0; j < dur && startIdx + j < totalSamples; j++) {
          const dt = j / sr;
          bp += (195 + 90 * Math.exp(-dt * 55)) / sr;
          const body = Math.sin(2 * Math.PI * bp) * Math.exp(-dt * 28);
          const snap = (white[(startIdx + j) % noiseLen] * 0.65 + pink[(startIdx + j) % noiseLen] * 0.45) * Math.exp(-dt * (isSnare ? 20 : 38));
          const sig = (body * 0.55 + snap * 0.85) * vol;
          addSample('drums', startIdx + j, sig * 0.96, sig * 1.04);
        }
      }

      if (isMicroClick) {
        const dur = Math.floor(0.025 * sr);
        const pan = (s16 === 4) ? 0.25 : 0.75;
        for (let j = 0; j < dur && startIdx + j < totalSamples; j++) {
          const dt = j / sr;
          const click = (white[(startIdx + j) % noiseLen] * 0.6 + Math.sin(2 * Math.PI * 1800 * dt) * 0.4) * Math.exp(-dt * 120) * 0.35;
          addSample('glitch', startIdx + j, click * pan, click * (1 - pan));
        }
      }

      if (isReverseShuffle) {
        const dur = Math.floor(stepSec * 0.95 * sr);
        const pan = 0.5 + 0.42 * Math.cos(step * 2.1);
        const pitchStart = 320 + (s16 % 5) * 110;
        let bp = 0;
        for (let j = 0; j < dur && startIdx + j < totalSamples; j++) {
          const frac = j / dur;
          const revEnv = Math.exp(-(1.0 - frac) * 4.2) * (1.0 - Math.pow(frac, 16.0));
          bp += (pitchStart * (0.75 + 0.5 * frac)) / sr;
          const metallic = Math.sin(2 * Math.PI * bp) * 0.45 + pink[(startIdx + dur - j) % noiseLen] * 0.75;
          const sig = metallic * revEnv * 0.48 * drumAmp;
          addSample('glitch', startIdx + j, sig * pan, sig * (1.0 - pan));
        }
      }

      if (isDrillRoll) {
        const subCount = 4;
        const subDur = Math.floor((stepSec / subCount) * sr);
        for (let k = 0; k < subCount; k++) {
          const idx = startIdx + k * subDur;
          const pitchMult = 1.0 + k * 0.22;
          let bp = 0;
          for (let j = 0; j < subDur * 0.9 && idx + j < totalSamples; j++) {
            const dt = j / sr;
            bp += (240 * pitchMult) / sr;
            const sig = (Math.sin(2 * Math.PI * bp) * 0.6 + white[(idx + j) % noiseLen] * 0.7) * Math.exp(-dt * 60) * 0.40 * drumAmp;
            addSample('glitch', idx + j, sig * (k % 2 === 0 ? 1.2 : 0.6), sig * (k % 2 === 0 ? 0.6 : 1.2));
          }
        }
      }

      const playHats = (part >= 1 && part <= 6) || (part === 0 && t0 >= 14.5);
      if (playHats) {
        const isOpenHat = (s16 % 4 === 2);
        const hatDur = Math.floor((isOpenHat ? 0.055 : 0.022) * sr);
        const hatVol = (isOpenHat ? 0.18 : 0.10) * drumAmp;
        const pan = 0.5 + 0.32 * Math.sin(step * 1.5);
        for (let j = 0; j < hatDur && startIdx + j < totalSamples; j++) {
          const dt = j / sr;
          const diff = white[(startIdx + j) % noiseLen] - white[(startIdx + j + 1) % noiseLen];
          const sig = diff * Math.exp(-dt * (isOpenHat ? 42 : 70)) * hatVol;
          addSample('drums', startIdx + j, sig * pan, sig * (1 - pan));
        }
      }
    }

    // LAYER 3: STEREO DUB DELAY & MASTER LIMITER
    const delayL = Math.floor(stepSec * 3 * sr);
    const delayR = Math.floor(stepSec * 4 * sr);
    for (let i = delayR; i < totalSamples; i++) {
      const t = this.canonTime(i / sr);
      const fb = ((t >= 56 && t < 62) || (t >= 158 && t < 170)) ? 0.26 : 0.18;
      left[i] += right[i - delayL] * fb;
      right[i] += left[i - delayR] * fb;
    }

    for (let i = 0; i < totalSamples; i++) {
      const rawT = i / sr;
      let fade = 1.0;
      const fadeOutLen = Math.min(3.5, this.duration * 0.15);
      if (rawT < 0.3) fade = rawT / 0.3;
      else if (rawT > this.duration - fadeOutLen) fade = Math.max(0, (this.duration - rawT) / fadeOutLen);
      left[i] = Math.tanh(left[i] * 1.22 * fade) * 0.94;
      right[i] = Math.tanh(right[i] * 1.22 * fade) * 0.94;
    }

    const result = {
      sampleRate: sr,
      length: totalSamples,
      duration: this.duration,
      numberOfChannels: 2,
      getChannelData(c) {
        return c === 0 ? left : right;
      }
    };

    if (returnStems && stemBuffers) {
      result.stems = {};
      for (const [key, chs] of Object.entries(stemBuffers)) {
        for (let i = 0; i < totalSamples; i++) {
          chs[0][i] = Math.tanh(chs[0][i] * 1.15) * 0.92;
          chs[1][i] = Math.tanh(chs[1][i] * 1.15) * 0.92;
        }
        result.stems[key] = {
          sampleRate: sr,
          length: totalSamples,
          duration: this.duration,
          numberOfChannels: 2,
          getChannelData(c) {
            return c === 0 ? chs[0] : chs[1];
          }
        };
      }
    }

    return result;
  }

  static extractFeatures(audioBuffer, fps = 30) {
    const sampleRate = audioBuffer.sampleRate;
    const totalSamples = audioBuffer.length;
    const duration = totalSamples / sampleRate;
    const totalFrames = Math.ceil(duration * fps);
    const samplesPerFrame = Math.floor(sampleRate / fps);

    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;

    const frames = [];
    let prevRms = 0;

    for (let f = 0; f < totalFrames; f++) {
      const startSample = f * samplesPerFrame;
      const endSample = Math.min(startSample + samplesPerFrame, totalSamples);
      const count = endSample - startSample;

      let sumSq = 0, bassSum = 0, midSum = 0, highSum = 0;
      for (let i = startSample; i < endSample; i++) {
        const s = (left[i] + right[i]) * 0.5;
        sumSq += s * s;
        const absVal = Math.abs(s);
        bassSum += absVal;
        if (i > startSample) {
          const diff = Math.abs(s - (left[i - 1] + right[i - 1]) * 0.5);
          highSum += diff * 2.5;
          midSum += Math.abs(absVal - diff);
        }
      }

      const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
      const bass = count > 0 ? Math.min(1.0, (bassSum / count) * 2.4) : 0;
      const high = count > 0 ? Math.min(1.0, (highSum / count) * 3.5) : 0;
      const mid = count > 0 ? Math.min(1.0, (midSum / count) * 2.1) : 0;
      const transient = Math.max(0, rms - prevRms) * 4.8;
      const glitch = (high > 0.38 && transient > 0.12) || transient > 0.28 ? Math.min(1.0, transient * 1.7 + high * 0.5) : 0.0;
      prevRms = rms;

      frames.push({
        time: f / fps,
        frame: f,
        rms: Math.min(1.0, rms * 2.2),
        bass,
        mid,
        high,
        transient: Math.min(1.0, transient),
        glitch
      });
    }

    return {
      frames,
      fps,
      duration,
      at(t) {
        const frameIdx = Math.max(0, Math.min(Math.floor(t * fps), frames.length - 1));
        return frames[frameIdx];
      }
    };
  }
}

/**
 * Browser / studio stem preview mixer with mute, solo, volume and MeasureClock sync.
 */
export class StemMixer {
  constructor({ bpm = 164, timeSignature = [4, 4], duration = 180, stems = [] } = {}) {
    this.clock = new MeasureClock({ bpm, timeSignature, duration });
    this.tracks = new Map();
    for (const s of stems) {
      this.tracks.set(s.id, {
        ...s,
        mute: false,
        solo: false,
        volume: 1.0,
        audio: null
      });
    }
  }

  setTrackState(id, { mute, solo, volume } = {}) {
    const t = this.tracks.get(id);
    if (!t) return null;
    if (typeof mute === 'boolean') t.mute = mute;
    if (typeof solo === 'boolean') t.solo = solo;
    if (typeof volume === 'number') t.volume = Math.max(0, Math.min(1, volume));
    this.applyGains();
    return { ...t, audio: undefined };
  }

  applyGains() {
    const anySolo = Array.from(this.tracks.values()).some(t => t.solo);
    for (const t of this.tracks.values()) {
      const audible = !t.mute && (!anySolo || t.solo);
      if (t.audio) {
        t.audio.muted = !audible;
        t.audio.volume = audible ? t.volume : 0;
      }
    }
  }

  seek(timeSec) {
    for (const t of this.tracks.values()) {
      if (t.audio) t.audio.currentTime = Math.max(0, timeSec);
    }
  }
}
