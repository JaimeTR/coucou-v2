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

export type Act = "wave" | "yawn" | "wink" | "love" | "sleep" | "wake" | "look-left" | "look-right" | "look-up" | "look-front";

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
  // Hello: out, a wave, away.
  hola: () => [
    { at: 0, rise: 0.72 },
    { at: 900, act: "wave" },
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
    { at: 5600, rise: 0 },
  ],
  // Falls asleep on the job and is startled awake.
  dormilon: () => [
    { at: 0, rise: 0.75 },
    { at: 900, act: "yawn" },
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
    { at: 5600, rise: 0 },
  ],
  // Sweet: out and a few hearts.
  carinoso: () => [
    { at: 0, rise: 0.75 },
    { at: 1000, act: "love" },
    { at: 3400, rise: 0 },
  ],
};

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
