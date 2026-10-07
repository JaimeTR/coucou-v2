// Mochi dances while music plays. The music is read from the system's media
// controls (Spotify, the browser, the media player…) every few seconds, but
// only while the island is on screen and the setting is on; a hidden island
// asks nothing, so it still costs nothing.

import { Bridge } from "../core/bridge";
import { State } from "../core/state";
import type { BotEngine } from "../mochi/engine";

const EVERY_MS = 4000;

/** Dances only when music is actually playing and Mochi is not busy being something else. */
export function shouldDance(playing: boolean, enabled: boolean, mode: string, paused: boolean): boolean {
  return playing && enabled && mode !== "hidden" && !paused;
}

export function startMusic(engine: BotEngine, wake: () => void) {
  let timer: number | null = null;
  let playing = false;

  const apply = () => {
    const dance = shouldDance(playing, State.settings.musicDance, State.mode, State.paused);
    if (engine.isDancing !== dance) {
      engine.isDancing = dance;
      wake(); // the frame loop sleeps when nothing moves
    }
  };

  const poll = async () => {
    const now = await Bridge.nowPlaying();
    playing = !!now?.playing;
    apply();
  };

  const sync = () => {
    const wanted = State.settings.musicDance && State.mode !== "hidden" && !State.paused;
    if (wanted && timer == null) {
      void poll();
      timer = window.setInterval(() => void poll(), EVERY_MS);
    } else if (!wanted && timer != null) {
      window.clearInterval(timer);
      timer = null;
      playing = false;
    }
    apply();
  };

  State.subscribe(sync);
  sync();
}
