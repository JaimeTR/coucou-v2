// The Spotify pill on the page: what src-tauri/src/spotify.rs reports.

export const SPOTIFY_ID = "integration_spotify";
export const SPOTIFY_GREEN = "#1DB954";

export interface SpotifyState {
  /** Spotify is open. */
  running: boolean;
  playing: boolean;
  title: string;
  artist: string;
  album: string;
  /** Seconds into the track, as of `at`; 0 when Spotify does not say. */
  position: number;
  duration: number;
  /** The cover as a data URL. */
  artwork: string | null;
  /** When this was read (ms); the bar runs on from it while playing. */
  at: number;
}

export type SpotifyAction = "playPause" | "next" | "previous" | "seek";

/** Where the bar is `now`: the position read, run on while playing, never past the end. */
export function positionAt(s: Pick<SpotifyState, "position" | "duration" | "playing" | "at">, now: number): number {
  const run = s.playing ? Math.max(0, (now - s.at) / 1000) : 0;
  const pos = s.position + run;
  return s.duration > 0 ? Math.min(pos, s.duration) : pos;
}

/** 3:07, or 1:02:03. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "Title — Artist", for a line of the card. */
export function trackLine(s: Pick<SpotifyState, "title" | "artist">): string {
  return [s.title, s.artist].filter(Boolean).join(" — ");
}
