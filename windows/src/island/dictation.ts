// Dictation anywhere: Rust watches the key and says "down", "up" or "cancel"; here
// the voice is recorded while the key is held, Groq's Whisper understands it, and
// the words are pasted where the cursor is. Nothing is kept on disk.

import { Bridge, onEvent } from "../core/bridge";
import { openMic, toWav, type Mic } from "../core/mic";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import type { Island } from "./island";

/** More than this is not a note, it is a forgotten key. */
const MAX_SECONDS = 120;

/** The words as they should be typed: no stray spaces or line breaks around them. */
export function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function registerDictation(island: Island) {
  let mic: Mic | null = null;
  let frames: Float32Array[] = [];
  let samples = 0;
  let starting = false;

  const idle = () => {
    State.dictating = null;
    State.micBusy = false;
    State.notify();
  };

  const cancel = () => {
    mic?.stop();
    mic = null;
    frames = [];
    samples = 0;
    starting = false;
    idle();
  };

  async function start() {
    if (!State.settings.dictation || mic || starting || State.paused) return;
    starting = true;
    frames = [];
    samples = 0;
    State.dictating = "listening";
    State.micBusy = true; // the "Oye Mochi" listener waits meanwhile
    State.notify();
    Sound.play("blip");
    try {
      const opened = await openMic((frame) => {
        if (samples > 48_000 * MAX_SECONDS) return;
        frames.push(frame);
        samples += frame.length;
      });
      // The key may have been let go while the microphone was opening.
      if (!starting) {
        opened.stop();
        return;
      }
      mic = opened;
    } catch (err) {
      cancel();
      State.noteMessage = err instanceof Error ? err.message : String(err);
      island.alert("note");
    } finally {
      starting = false;
    }
  }

  async function finish() {
    if (!mic) {
      // Let go before the microphone was ready: nothing was said.
      cancel();
      return;
    }
    const rate = mic.sampleRate;
    mic.stop();
    mic = null;
    const all = new Float32Array(samples);
    let at = 0;
    for (const f of frames) {
      all.set(f, at);
      at += f.length;
    }
    frames = [];
    samples = 0;
    // A tap, or only the room: not worth sending.
    if (all.length < rate * 0.4) return idle();

    State.dictating = "understanding";
    State.notify();
    try {
      const said = tidy(await Bridge.voiceTranscribe(Array.from(toWav(all, rate)), "audio/wav", "auto"));
      if (said) {
        const pasted = await Bridge.dictationPaste(said);
        Sound.play(pasted ? "finish" : "blip");
        if (!pasted) {
          State.noteMessage = "No pude pegarlo: queda copiado, pega con Ctrl+V.";
          island.alert("note");
        }
      }
    } catch (err) {
      Sound.play("error");
      State.noteMessage = String(err).replace(/^Error:\s*/, "");
      island.alert("note");
    } finally {
      idle();
    }
  }

  void onEvent<string>("dictation", (what) => {
    if (what === "down") void start();
    else if (what === "up") void finish();
    else if (what === "cancel") cancel();
  });
}
