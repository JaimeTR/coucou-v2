// The microphone: raw frames for the utterance cutter, and "record one question".
// Nothing is recorded to disk; sound only goes to Groq's Whisper, and only the
// utterances that were cut out of the stream.

import { Segmenter, downsample, encodeWav } from "./audio";

const SPEECH_RATE = 16000;

export interface Mic {
  readonly sampleRate: number;
  stop(): void;
}

/** Opens the default microphone; `onFrame` receives mono float samples. */
export async function openMic(onFrame: (frame: Float32Array) => void): Promise<Mic> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este equipo no permite usar el micrófono aquí.");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch {
    throw new Error("No se pudo abrir el micrófono. Revisa que Windows permita a Coucou usarlo (Configuración → Privacidad → Micrófono).");
  }
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(2048, 1, 1);
  processor.onaudioprocess = (e) => onFrame(new Float32Array(e.inputBuffer.getChannelData(0)));
  // The processor only runs when it is wired to an output; the gain keeps it silent.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(ctx.destination);
  return {
    sampleRate: ctx.sampleRate,
    stop() {
      processor.onaudioprocess = null;
      source.disconnect();
      processor.disconnect();
      mute.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}

/** One utterance as a 16 kHz WAV, ready for Whisper. */
export function toWav(samples: Float32Array, rate: number): Uint8Array {
  return encodeWav(downsample(samples, rate, SPEECH_RATE), Math.min(rate, SPEECH_RATE));
}

/**
 * Listens until the person says something and stops talking. Resolves with the
 * recording, or null if nobody spoke within `waitMs`. `cancel()` ends it early.
 */
export function recordOnce(
  opts: {
    waitMs?: number;
    maxMs?: number;
    /** Called every ~1.5 s while the person is talking, with everything said so far. */
    onPartial?: (wav: Uint8Array) => void;
  } = {},
) {
  let finish: (wav: Uint8Array | null) => void = () => {};
  const done = new Promise<Uint8Array | null>((resolve) => (finish = resolve));
  let mic: Mic | null = null;
  let over = false;
  const end = (wav: Uint8Array | null) => {
    if (over) return;
    over = true;
    window.clearTimeout(timer);
    window.clearInterval(partials);
    mic?.stop();
    finish(wav);
  };
  const timer = window.setTimeout(() => end(null), opts.waitMs ?? 8000);
  // The text can follow the voice: hand over what has been said so far, now and then.
  const partials = window.setInterval(() => {
    if (over || !opts.onPartial || !mic || !segmenter) return;
    const so_far = segmenter.snapshot();
    if (so_far && so_far.length > mic.sampleRate * 0.8) opts.onPartial(toWav(so_far, mic.sampleRate));
  }, 1500);

  openMic((frame) => {
    if (!segmenter || over) return;
    const utterance = segmenter.push(frame);
    // Once somebody is talking, the "nobody spoke" timeout no longer applies.
    if (segmenter.speaking) window.clearTimeout(timer);
    if (utterance && mic) end(toWav(utterance, mic.sampleRate));
  }).then(
    (m) => {
      mic = m;
      segmenter = new Segmenter({ sampleRate: m.sampleRate, silenceMs: 1000, maxMs: opts.maxMs ?? 20000 });
      if (over) m.stop();
    },
    (err) => {
      window.clearTimeout(timer);
      window.clearInterval(partials);
      over = true;
      finish(null);
      failure = err instanceof Error ? err : new Error(String(err));
    },
  );
  let segmenter: Segmenter | null = null;
  let failure: Error | null = null;

  return {
    /** The recording, or null; throws when the microphone could not be opened. */
    async result(): Promise<Uint8Array | null> {
      const wav = await done;
      if (failure) throw failure;
      return wav;
    },
    cancel: () => end(null),
  };
}
