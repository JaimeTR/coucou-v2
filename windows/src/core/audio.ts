// The sound side of talking to Mochi: cutting the microphone stream into
// utterances, turning one into a WAV, and spotting "Oye Mochi" in what was
// said. All pure (no microphone, no DOM), so it can be tested.

export interface SegmenterOptions {
  sampleRate: number;
  /** Sound kept from before speech began, so the first syllable is not lost. */
  preRollMs?: number;
  /** Silence that ends an utterance. */
  silenceMs?: number;
  /** Shorter than this is a click or a cough, not speech. */
  minSpeechMs?: number;
  /** An utterance is cut here even if the person is still talking. */
  maxMs?: number;
}

export function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / Math.max(1, frame.length));
}

/**
 * Feeds on microphone frames; hands back one utterance (pre-roll included) each
 * time somebody finishes talking. The threshold follows the room's noise.
 */
export class Segmenter {
  private readonly rate: number;
  private readonly preRoll: number;
  private readonly silence: number;
  private readonly minSpeech: number;
  private readonly maxSamples: number;

  private floor = 0.004;
  private ring: Float32Array[] = [];
  private ringSamples = 0;
  private active: Float32Array[] | null = null;
  private activeSamples = 0;
  private speechSamples = 0;
  private quietSamples = 0;

  constructor(o: SegmenterOptions) {
    this.rate = o.sampleRate;
    this.preRoll = Math.round((o.preRollMs ?? 500) * (this.rate / 1000));
    this.silence = Math.round((o.silenceMs ?? 700) * (this.rate / 1000));
    this.minSpeech = Math.round((o.minSpeechMs ?? 300) * (this.rate / 1000));
    this.maxSamples = Math.round((o.maxMs ?? 6000) * (this.rate / 1000));
  }

  /** True while somebody is talking. */
  get speaking(): boolean {
    return this.active != null;
  }

  /** What has been said so far in the utterance in progress, or null. */
  snapshot(): Float32Array | null {
    return this.active ? join(this.active) : null;
  }

  reset() {
    this.ring = [];
    this.ringSamples = 0;
    this.active = null;
    this.activeSamples = 0;
    this.speechSamples = 0;
    this.quietSamples = 0;
  }

  push(frame: Float32Array): Float32Array | null {
    const level = rms(frame);
    const loud = level > Math.max(0.015, this.floor * 3);
    if (!this.active) {
      // The noise floor only learns from quiet frames.
      if (!loud) this.floor = this.floor * 0.98 + level * 0.02;
      this.keep(frame);
      if (!loud) return null;
      this.active = [...this.ring];
      this.activeSamples = this.ringSamples;
      this.speechSamples = frame.length;
      this.quietSamples = 0;
      return null;
    }
    this.active.push(frame);
    this.activeSamples += frame.length;
    if (loud) {
      this.speechSamples += frame.length;
      this.quietSamples = 0;
    } else {
      this.quietSamples += frame.length;
    }
    const over = this.activeSamples >= this.maxSamples;
    if (this.quietSamples >= this.silence || over) {
      const done = this.speechSamples >= this.minSpeech ? join(this.active) : null;
      this.reset();
      return done;
    }
    return null;
  }

  private keep(frame: Float32Array) {
    this.ring.push(frame);
    this.ringSamples += frame.length;
    while (this.ringSamples - this.ring[0].length >= this.preRoll && this.ring.length > 1) {
      this.ringSamples -= this.ring.shift()!.length;
    }
  }
}

function join(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Linear downsampling to the 16 kHz speech models want. */
export function downsample(samples: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return samples;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const a = Math.floor(pos);
    const frac = pos - a;
    out[i] = samples[a] * (1 - frac) + (samples[Math.min(a + 1, samples.length - 1)] ?? 0) * frac;
  }
  return out;
}

/** 16-bit mono PCM in a WAV container. */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

// ── "Oye Mochi" ───────────────────────────────────────────────────────────────

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const WAKE = /\b(oye|oiga|hey|ey|ok|okay|hola|hi|hello)\s+(mochi|mochy|moche|mochis|mochigan)\b/;

export interface Wake {
  heard: boolean;
  /** What came after the name, if the person kept talking ("oye Mochi, ¿qué hora es?"). */
  rest: string;
}

export function matchWake(said: string): Wake {
  if (!WAKE.test(plain(said))) return { heard: false, rest: "" };
  // What follows the name, taken from the original so accents and punctuation stay.
  const name = /moch[a-z]*/i.exec(said);
  const after = name ? said.slice(name.index + name[0].length) : "";
  return { heard: true, rest: after.replace(/^[\s,.:;!?¡¿-]+/, "").trim() };
}
