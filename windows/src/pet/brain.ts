// What Mochi the pet gets up to, as plain data: when it comes, from which edge,
// and the little script of each visit. Pure, so it can be tested; the page
// (main.ts) plays it.

export type Edge = "left" | "right" | "bottom";
export type Frequency = "rare" | "normal" | "often";

/** Minutes between visits, by frequency: [shortest, longest]. */
export const GAP_MINUTES: Record<Frequency, [number, number]> = {
  rare: [25, 50],
  normal: [8, 20],
  often: [3, 8],
};

export function isFrequency(v: unknown): v is Frequency {
  return v === "rare" || v === "normal" || v === "often";
}

/** Milliseconds until the next visit; `rand` is Math.random, or a fixed value in a test. */
export function nextGapMs(freq: Frequency, rand: () => number = Math.random): number {
  const [lo, hi] = GAP_MINUTES[isFrequency(freq) ? freq : "normal"];
  return Math.round((lo + (hi - lo) * rand()) * 60_000);
}

const EDGES: Edge[] = ["bottom", "left", "right"];

/** Never the same edge twice in a row: a pet that always comes from one place is a sticker. */
export function pickEdge(previous: Edge | null, rand: () => number = Math.random): Edge {
  const options = EDGES.filter((e) => e !== previous);
  return options[Math.min(options.length - 1, Math.floor(rand() * options.length))];
}

export type Act =
  | "wave" | "yawn" | "wink" | "love" | "sleep" | "wake" | "proud"
  | "look-left" | "look-right" | "look-up" | "look-front"
  /** Say something fitting the moment (a speech bubble, and aloud if voice is on). */
  | "say"
  | "dance" | "stop-dance";

/** One step of a visit: at `at` ms, rise to `rise` (0 = hidden, 1 = fully out) and/or do `act`. */
export interface Beat {
  at: number;
  rise?: number;
  /** Move along the edge while hidden (0..1). */
  move?: number;
  act?: Act;
}

type Script = (rand: () => number) => Beat[];

const SCRIPTS: Record<string, Script> = {
  // Hello: out, a wave, a word, away.
  hola: () => [
    { at: 0, rise: 0.72 },
    { at: 900, act: "wave" },
    { at: 1400, act: "say" },
    { at: 3200, rise: 0 },
  ],
  // Curious: out a little, looks around, a wink.
  curioso: () => [
    { at: 0, rise: 0.62 },
    { at: 900, act: "look-left" },
    { at: 1900, act: "look-right" },
    { at: 2800, act: "look-up" },
    { at: 3500, rise: 0.78, act: "look-front" },
    { at: 4300, act: "wink" },
    { at: 4600, act: "say" },
    { at: 5600, rise: 0 },
  ],
  // Falls asleep on the job and is startled awake.
  dormilon: () => [
    { at: 0, rise: 0.75 },
    { at: 900, act: "yawn" },
    { at: 1200, act: "say" },
    { at: 2300, act: "sleep" },
    { at: 6500, act: "wake", rise: 0.95 },
    { at: 7300, rise: 0 },
  ],
  // Hide and seek: out, back in, out somewhere else.
  escondidillas: (rand) => [
    { at: 0, rise: 0.65 },
    { at: 1500, rise: 0 },
    { at: 2100, move: Math.round(rand() * 100) / 100 },
    { at: 2300, rise: 0.65 },
    { at: 3400, act: "wave" },
    { at: 3700, act: "say" },
    { at: 5600, rise: 0 },
  ],
  // Sweet: out and a few hearts.
  carinoso: () => [
    { at: 0, rise: 0.75 },
    { at: 1000, act: "love" },
    { at: 1300, act: "say" },
    { at: 3400, rise: 0 },
  ],
  // To the music: it dances while it says something.
  baile: () => [
    { at: 0, rise: 0.78 },
    { at: 600, act: "dance" },
    { at: 900, act: "say" },
    { at: 4200, act: "stop-dance" },
    { at: 4600, rise: 0 },
  ],
  // For someone watching a video: a quiet wave, no sound.
  silencioso: () => [
    { at: 0, rise: 0.58 },
    { at: 1000, act: "wave" },
    { at: 1400, act: "say" },
    { at: 3200, rise: 0 },
  ],
  // Cheering someone on while they work.
  animo: () => [
    { at: 0, rise: 0.8 },
    { at: 700, act: "wink" },
    { at: 1000, act: "say" },
    { at: 3200, act: "proud" },
    { at: 4000, rise: 0 },
  ],
  // A job is done.
  celebra: () => [
    { at: 0, rise: 0.88 },
    { at: 500, act: "proud" },
    { at: 800, act: "say" },
    { at: 1800, act: "love" },
    { at: 3800, rise: 0 },
  ],
};

/** The script that suits a topic of conversation (see phrases.ts). */
export function scriptFor(topic: string, rand: () => number = Math.random): string {
  switch (topic) {
    case "music": return "baile";
    case "video": return "silencioso";
    case "working": return "animo";
    case "finished": return "celebra";
    case "error": return "carinoso";
    case "late": return "dormilon";
    case "break":
    case "morning":
    case "afternoon":
    case "evening": return "hola";
    default: {
      const options = ["hola", "curioso", "escondidillas", "carinoso"];
      return options[Math.min(options.length - 1, Math.floor(rand() * options.length))];
    }
  }
}

export const SCRIPT_NAMES = Object.keys(SCRIPTS);

export function pickScript(rand: () => number = Math.random): string {
  return SCRIPT_NAMES[Math.min(SCRIPT_NAMES.length - 1, Math.floor(rand() * SCRIPT_NAMES.length))];
}

export function plan(name: string, rand: () => number = Math.random): Beat[] {
  return (SCRIPTS[name] ?? SCRIPTS.hola)(rand);
}

/** How long a visit lasts: the time of its last beat plus the slide out. */
export function visitLength(beats: Beat[]): number {
  return Math.max(0, ...beats.map((b) => b.at)) + 600;
}

/**
 * How far Mochi is pushed toward the edge it comes from, in px of a `size` window:
 * rise 0 = the whole body beyond the edge, 1 = sitting on it. The body's size and
 * the engine's own offset (see BotEngine.draw: R = 0.3 * size, centre at size / 2 + 0.06 R)
 * are folded in here.
 */
export function slideShift(rise: number, size: number): number {
  const R = size * 0.3;
  const ry = R * 0.88;
  const cy = size / 2 + R * 0.06;
  const hidden = size + ry - cy;
  const out = size - ry - cy;
  return hidden + (out - hidden) * Math.min(1, Math.max(0, rise));
}

// ── Where things are in the window ───────────────────────────────────────────

/** The window, in logical px (see pet.rs), and the square Mochi is drawn in. */
export const WINDOW = { w: 340, h: 220 };
export const SQUARE = 180;

/** Top-left of Mochi's square in the window, by the edge it sits against. */
export function squareOrigin(edge: Edge): { x: number; y: number } {
  switch (edge) {
    case "bottom": return { x: (WINDOW.w - SQUARE) / 2, y: WINDOW.h - SQUARE };
    case "right": return { x: WINDOW.w - SQUARE, y: (WINDOW.h - SQUARE) / 2 };
    case "left": return { x: 0, y: (WINDOW.h - SQUARE) / 2 };
  }
}

/** Mochi is never turned: against a side edge it peeks out sideways, standing as always. */
export const TURN: Record<Edge, number> = { bottom: 0, right: 0, left: 0 };

/**
 * How far Mochi is pushed toward its edge at `rise` (0 hidden, 1 sitting on it):
 * down against the bottom, across against a side. Upright in every case.
 */
export function slideOffset(edge: Edge, rise: number, size: number = SQUARE): { x: number; y: number } {
  if (edge === "bottom") return { x: 0, y: slideShift(rise, size) };
  const rx = size * 0.3 * 1.14;
  const hidden = size / 2 + rx;
  const out = size / 2 - rx;
  const s = hidden + (out - hidden) * Math.min(1, Math.max(0, rise));
  return { x: edge === "right" ? s : -s, y: 0 };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The part of the window Mochi's body covers at `rise`, with a margin: where a
 * click should hit it. Worked out the way the page draws it (the slide along the
 * edge's normal), clipped to the window.
 */
export function mochiBox(edge: Edge, rise: number, margin = 6): Box {
  const R = SQUARE * 0.3;
  const hw = R * 1.14 + margin;
  const hh = R * 0.88 + margin;
  const o = squareOrigin(edge);
  const off = slideOffset(edge, rise);
  const cx = o.x + SQUARE / 2 + off.x;
  const cy = o.y + SQUARE / 2 + R * 0.06 + off.y;
  const x0 = Math.max(0, cx - hw);
  const y0 = Math.max(0, cy - hh);
  const x1 = Math.min(WINDOW.w, cx + hw);
  const y1 = Math.min(WINDOW.h, cy + hh);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** Where a speech bubble of `w` x `h` goes: beside Mochi toward the screen's middle, or above it. */
export function bubbleBox(edge: Edge, rise: number, w: number, h: number): Box {
  const body = mochiBox(edge, rise, 0);
  const gap = 10;
  let x: number;
  let y: number;
  if (edge === "bottom") {
    x = body.x + body.w / 2 - w / 2;
    y = body.y - gap - h;
  } else if (edge === "right") {
    x = body.x - gap - w;
    y = body.y + body.h / 2 - h / 2;
  } else {
    x = body.x + body.w + gap;
    y = body.y + body.h / 2 - h / 2;
  }
  return {
    x: Math.max(2, Math.min(WINDOW.w - w - 2, x)),
    y: Math.max(2, Math.min(WINDOW.h - h - 2, y)),
    w,
    h,
  };
}
