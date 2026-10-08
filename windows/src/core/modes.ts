// Work modes, as the page sees them (the detection is Rust's: src-tauri/src/modes.rs).
//
//   work     everything on
//   game     no window over it, no sounds; the pet may cheer by voice only
//   meeting  silent, nothing on screen (it may be shared)
//   video    as quiet as a meeting
//
// Pure, so the rules can be tested.

export type WorkMode = "work" | "game" | "meeting" | "video";
export type ModeChoice = "auto" | WorkMode;

export interface ModeInfo {
  mode: WorkMode;
  /** True when it was detected, false when chosen by hand. */
  auto: boolean;
  /** The game being played, when it is known by name. */
  game: string | null;
}

export const MODE_CHOICES: ModeChoice[] = ["auto", "work", "game", "meeting", "video"];

/** As they read in Settings and on the Mode pill. */
export const MODE_NAMES: Record<ModeChoice, string> = {
  auto: "Automático",
  work: "Trabajo",
  game: "Juego",
  meeting: "Reunión",
  video: "Vídeo",
};

export const MODE_COLORS: Record<WorkMode, string> = {
  work: "#22C55E",
  game: "#A78BFA",
  meeting: "#F5A524",
  video: "#38BDF8",
};

export function isModeChoice(v: unknown): v is ModeChoice {
  return typeof v === "string" && (MODE_CHOICES as string[]).includes(v);
}

export function isWorkMode(v: unknown): v is WorkMode {
  return v === "work" || v === "game" || v === "meeting" || v === "video";
}

/** What the Mode pill says is going on. */
export function modeLabel(info: ModeInfo): string {
  switch (info.mode) {
    case "work": return "Trabajando";
    case "game": return info.game ? `Jugando: ${info.game}` : "Jugando";
    case "meeting": return "En reunión";
    case "video": return "Viendo un vídeo";
  }
}

/** Sound effects only in Work: over a game or a call they are noise. */
export function mayPlaySound(mode: WorkMode): boolean {
  return mode === "work";
}

/** Windows notifications and anything that would pop up. */
export function mayNotify(mode: WorkMode): boolean {
  return mode === "work";
}

/**
 * A permission or a question goes back to the terminal in every mode but Work:
 * the island is not on screen to answer it, and Claude Code must not wait.
 */
export function mustDecline(mode: WorkMode): boolean {
  return mode !== "work";
}

/**
 * May Mochi speak aloud? Always in Work; in a game only the pet's cheering, if the
 * person wants it (it is a voice, not a window); never in a meeting or over a video.
 */
export function voiceAllowed(mode: WorkMode, occasion: string, gameCheer: boolean): boolean {
  if (mode === "work") return true;
  if (mode === "game") return occasion === "pet" && gameCheer;
  return false;
}
