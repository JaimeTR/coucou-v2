// Reads Spotify while its pill is on and the island is on screen. A hidden
// island, a paused Coucou or a pill that is off asks nothing.

import { Bridge } from "../core/bridge";
import { SPOTIFY_ID } from "../core/spotify";
import { State } from "../core/state";

const SLOW_MS = 3000;
/** While the Spotify card is the one on screen the bar and the track follow closely. */
const FAST_MS = 1000;

export function wantSpotify(): boolean {
  return State.settings.activeIntegrations.includes(SPOTIFY_ID) && State.mode !== "hidden" && !State.paused;
}

export async function refreshSpotify() {
  const s = await Bridge.spotifyRefresh();
  State.spotify = s ? { ...s, at: Date.now() } : null;
  State.notify();
}

export function startSpotify() {
  let timer: number | null = null;
  let every = 0;

  const sync = () => {
    const wanted = wantSpotify();
    const cadence = State.focusId === SPOTIFY_ID ? FAST_MS : SLOW_MS;
    if (wanted && (timer == null || every !== cadence)) {
      if (timer != null) window.clearInterval(timer);
      every = cadence;
      void refreshSpotify();
      timer = window.setInterval(() => void refreshSpotify(), cadence);
    } else if (!wanted && timer != null) {
      window.clearInterval(timer);
      timer = null;
      State.spotify = null;
    }
  };
  State.subscribe(sync);
  sync();
}
