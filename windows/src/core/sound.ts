// SoundEngine — port of SoundEngine.swift.
// The 28 WAVs are the macOS app's own files (see SOUNDS_DIR in vite.config.ts);
// they are served at /sounds/<name>.wav. Default volume 0.12, slider range 0–0.2,
// exactly like the Mac player, and several sounds may overlap.

export const SOUND_NAMES = [
  "peek", "open", "close", "hover", "blip", "slap", "annoyed", "dizzy", "greet",
  "work", "finish", "error", "approval", "question", "approve", "gulp", "tick",
  "send", "love", "pop", "proud", "wink", "yawn", "attach", "think", "search",
  "rate", "sleep",
] as const;

export type SoundName = (typeof SOUND_NAMES)[number];

/** base64 → bytes (an ArrayBuffer, which is what decodeAudioData takes). */
function fromBase64(text: string): ArrayBuffer {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

class SoundEngine {
  enabled = true;
  /** Over a game or a call: nothing plays, whatever the setting says. */
  muted = false;
  volume = 0.12;
  /** Where a sound of your own comes from (the Tauri bridge); none in a plain browser. */
  loadCustom: ((name: string) => Promise<string | null>) | null = null;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private idleTimer: number | null = null;

  /** Creates the context and decodes every WAV. Safe to call more than once. */
  preload(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = this.volume;
      master.connect(ctx.destination);
      this.master = master;
      await Promise.all(
        SOUND_NAMES.map(async (name) => {
          try {
            const res = await fetch(`/sounds/${name}.wav`);
            if (!res.ok) return;
            const buf = await ctx.decodeAudioData(await res.arrayBuffer());
            this.buffers.set(name, buf);
          } catch {
            /* a missing sound must never break the island */
          }
        }),
      );
      await this.applyCustom();
    })();
    return this.loading;
  }

  /**
   * Sounds of your own (a file named like one of Mochi's, in the sounds folder)
   * take the place of the built-in ones. A file that cannot be decoded leaves the
   * built-in sound where it is.
   */
  async applyCustom(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    await Promise.all(
      SOUND_NAMES.map(async (name) => {
        try {
          const text = (await this.loadCustom?.(name)) ?? null;
          if (!text) return;
          this.buffers.set(name, await ctx.decodeAudioData(fromBase64(text)));
        } catch {
          /* a broken file keeps the built-in sound */
        }
      }),
    );
  }

  /** Settings → Reload sounds: built-in ones back first, then yours on top. */
  async reload(): Promise<void> {
    this.loading = null;
    this.buffers.clear();
    const ctx = this.ctx;
    if (!ctx) return this.preload();
    await Promise.all(
      SOUND_NAMES.map(async (name) => {
        try {
          const res = await fetch(`/sounds/${name}.wav`);
          if (res.ok) this.buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch {
          /* ignored */
        }
      }),
    );
    await this.applyCustom();
  }

  /** WebView2 can hand us a suspended context; call after any user input. */
  resume() {
    if (this.idleTimer != null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    void this.ctx?.resume();
  }

  /**
   * Called when the island goes quiet. A running AudioContext keeps an audio
   * thread and its render quantum alive even with nothing playing, which shows
   * up as a steady trickle of CPU on a machine that is supposed to be idle.
   *
   * The delay covers the tail of whatever just played — suspending mid-sound
   * would clip it — and `play()` resumes the context on its own.
   */
  idle() {
    if (!this.ctx || this.ctx.state !== "running" || this.idleTimer != null) return;
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      void this.ctx?.suspend();
    }, 1500);
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(0.2, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
  }

  play(name: SoundName | string) {
    if (!this.enabled || this.muted) return;
    const ctx = this.ctx;
    const master = this.master;
    const buf = this.buffers.get(name);
    if (!ctx || !master || !buf) return;
    if (this.idleTimer != null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (ctx.state === "suspended") void ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(master);
    src.start();
  }
}

export const Sound = new SoundEngine();
