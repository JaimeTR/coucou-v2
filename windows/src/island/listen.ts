// "Oye Mochi": while it is switched on, the microphone is cut into utterances;
// each one is understood by Groq's Whisper and, if it starts with the wake
// phrase, the island opens on the chat. It listens only while the setting is on
// (and the island's mic button says so), and it can be paused from a shortcut.

import { Bridge } from "../core/bridge";
import { matchWake, Segmenter } from "../core/audio";
import { openMic, toWav, type Mic } from "../core/mic";
import { uiLanguage } from "../core/i18n";

export interface ListenHooks {
  /** "Oye Mochi" was heard; `rest` is what came after, if anything. */
  onWake(rest: string): void;
  /** Something stopped it (no microphone, no key): say why. */
  onProblem(message: string): void;
  /** The chat is using the microphone: do not listen for the wake phrase meanwhile. */
  busy(): boolean;
}

export class WakeListener {
  private mic: Mic | null = null;
  private starting = false;
  private inFlight = false;
  private paused = false;

  constructor(private readonly hooks: ListenHooks) {}

  get running(): boolean {
    return this.mic != null;
  }

  /** Stops listening for the wake phrase while the chat is using the microphone. */
  pause(on: boolean) {
    this.paused = on;
  }

  async start() {
    if (this.mic || this.starting) return;
    this.starting = true;
    try {
      let segmenter: Segmenter | null = null;
      const mic = await openMic((frame) => {
        if (!segmenter || this.paused || this.hooks.busy()) return;
        const utterance = segmenter.push(frame);
        if (utterance) void this.understand(toWav(utterance, mic.sampleRate));
      });
      segmenter = new Segmenter({ sampleRate: mic.sampleRate, silenceMs: 600, maxMs: 6000 });
      this.mic = mic;
    } catch (err) {
      this.hooks.onProblem(err instanceof Error ? err.message : String(err));
    } finally {
      this.starting = false;
    }
  }

  stop() {
    this.mic?.stop();
    this.mic = null;
  }

  private async understand(wav: Uint8Array) {
    // One request at a time: speech heard meanwhile is let go, not queued.
    if (this.inFlight || !this.mic) return;
    this.inFlight = true;
    try {
      const said = await Bridge.voiceTranscribe(Array.from(wav), "audio/wav", uiLanguage());
      const wake = matchWake(said);
      if (wake.heard) this.hooks.onWake(wake.rest);
    } catch (err) {
      // A bad key or no connection would repeat for every utterance: stop and say so.
      this.stop();
      this.hooks.onProblem(String(err).replace(/^Error:\s*/, ""));
    } finally {
      this.inFlight = false;
    }
  }
}
