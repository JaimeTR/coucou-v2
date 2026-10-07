// Mochi the pet: this page lives in a small transparent window that Rust places
// against a screen edge. Now and then it slides Mochi in, does a bit of mischief
// (see brain.ts), and slides it out again; between visits the window is hidden
// and nothing runs but one timer.

import { Bridge, IS_TAURI, onEvent } from "../core/bridge";
import { Sound } from "../core/sound";
import { applyLanguage } from "../core/i18n";
import { State, type Settings } from "../core/state";
import { BotEngine } from "../mochi/engine";
import { isOutfit, resolve, wear } from "../mochi/outfits";
import { isFrequency, nextGapMs, pickEdge, pickScript, plan, slideShift, visitLength, type Act, type Beat, type Edge } from "./brain";

const SIZE = 180;
/** Radians to turn the picture so "the bottom" is the edge Mochi comes from. */
const TURN: Record<Edge, number> = { bottom: 0, right: -Math.PI / 2, left: Math.PI / 2 };

const canvas = document.getElementById("pet") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const engine = new BotEngine();

let edge: Edge = "bottom";
let rise = 0;
let riseTarget = 0;
let visiting = false;
let startled = false;
let timers: number[] = [];
let nextVisit: number | null = null;
let lastEdge: Edge | null = null;
let raf = 0;
let last = 0;
/** Where Mochi looks when nobody is near, set by the script. */
let look = { x: 0, y: 0 };
let mouse: { x: number; y: number } | null = null;

function sizeCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(SIZE * dpr);
  canvas.height = Math.round(SIZE * dpr);
}

/** One frame: ease the slide, step Mochi, draw it turned toward its edge. */
export function frame(dt: number) {
  rise += (riseTarget - rise) * (1 - Math.exp(-dt * 7));
  if (Math.abs(riseTarget - rise) < 0.002) rise = riseTarget;

  const dpr = canvas.width / SIZE;
  const theta = TURN[edge];
  // The pointer, taken back into the picture's own (unturned) frame.
  let lx = look.x;
  let ly = look.y;
  if (mouse) {
    const dx = mouse.x - SIZE / 2;
    const dy = mouse.y - SIZE / 2;
    const ux = dx * Math.cos(theta) + dy * Math.sin(theta);
    const uy = -dx * Math.sin(theta) + dy * Math.cos(theta);
    lx = Math.tanh(ux / 120);
    ly = -Math.tanh((uy - slideShift(rise, SIZE)) / 100);
  }
  engine.lookX = lx;
  engine.lookY = ly;
  engine.update(dt);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.save();
  ctx.translate(SIZE / 2, SIZE / 2);
  ctx.rotate(theta);
  ctx.translate(-SIZE / 2, -SIZE / 2 + slideShift(rise, SIZE));
  engine.draw(ctx, SIZE, SIZE);
  ctx.restore();
}

function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frame(dt);
  if (visiting) raf = requestAnimationFrame(loop);
}

function startLoop() {
  last = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
}

function act(a: Act) {
  switch (a) {
    case "wave": engine.greet(); break;
    case "yawn": Sound.play("yawn"); engine.triggerEmote("yawn"); break;
    case "wink": Sound.play("wink"); engine.triggerEmote("wink"); break;
    case "love": Sound.play("love"); engine.triggerEmote("love", 2.4); break;
    case "sleep": engine.setState("sleeping"); break;
    case "wake": engine.setState("idle"); Sound.play("pop"); engine.triggerEmote("surprised"); break;
    case "look-left": look = { x: -0.9, y: 0.1 }; break;
    case "look-right": look = { x: 0.9, y: 0.1 }; break;
    case "look-up": look = { x: 0, y: 0.8 }; break;
    case "look-front": look = { x: 0, y: 0 }; break;
  }
}

function inRust(call: Promise<unknown>) {
  // In a plain browser (the preview) there is no window to place: only the drawing matters.
  if (IS_TAURI) call.catch((e) => void Bridge.log(`pet: ${String(e)}`));
}

function later(ms: number, fn: () => void) {
  timers.push(window.setTimeout(fn, ms));
}

/** Plays a visit; resolves into the next appointment. */
async function visit(forceEdge?: Edge) {
  if (visiting || !State.settings.petEnabled) return;
  if (IS_TAURI && !(await Bridge.petAllowed())) return schedule(2 * 60_000); // busy: try again soon
  visiting = true;
  startled = false;
  edge = forceEdge ?? pickEdge(lastEdge);
  lastEdge = edge;
  rise = 0;
  riseTarget = 0;
  look = { x: 0, y: 0 };
  engine.setState("idle");
  let along = 0.15 + Math.random() * 0.7;
  inRust(Bridge.petShow(edge, along));
  Sound.resume();
  startLoop();

  const beats: Beat[] = plan(pickScript());
  for (const b of beats) {
    later(b.at, () => {
      if (b.move !== undefined) {
        along = b.move;
        inRust(Bridge.petShow(edge, along));
      }
      if (b.rise !== undefined) {
        riseTarget = b.rise;
        if (b.rise > 0 && rise < 0.05) Sound.play("peek");
      }
      if (b.act) act(b.act);
    });
  }
  later(visitLength(beats), finish);
}

function finish() {
  timers.forEach(clearTimeout);
  timers = [];
  riseTarget = 0;
  // Let the slide out play, then put the window away.
  window.setTimeout(() => {
    visiting = false;
    cancelAnimationFrame(raf);
    inRust(Promise.resolve(Bridge.petHide()));
    Sound.idle();
    schedule();
  }, 700);
}

/** Runs away: the script is dropped and Mochi slides out at once. */
function flee(after = 0) {
  if (!visiting) return;
  timers.forEach(clearTimeout);
  timers = [];
  later(after, finish);
}

function schedule(ms?: number) {
  if (nextVisit != null) window.clearTimeout(nextVisit);
  nextVisit = null;
  if (!State.settings.petEnabled) return;
  nextVisit = window.setTimeout(() => void visit(), ms ?? nextGapMs(isFrequency(State.settings.petFrequency) ? State.settings.petFrequency : "normal"));
}

// ── Touching Mochi ───────────────────────────────────────────────────────────

canvas.addEventListener("mousemove", (e) => {
  const r = canvas.getBoundingClientRect();
  mouse = { x: ((e.clientX - r.left) / r.width) * SIZE, y: ((e.clientY - r.top) / r.height) * SIZE };
});
canvas.addEventListener("mouseleave", () => (mouse = null));

// Someone comes close: half the time Mochi is startled and dives back in.
canvas.addEventListener("mouseenter", () => {
  if (!visiting || startled) return;
  startled = true;
  if (Math.random() < 0.5) {
    Sound.play("pop");
    engine.triggerEmote("surprised");
    flee(650);
  }
});

// A click is not welcome: Mochi gets annoyed, and goes.
canvas.addEventListener("mousedown", () => {
  if (!visiting) return;
  Sound.resume();
  const result = engine.slap();
  flee(result === "dizzy" ? 2200 : 700);
});

// ── Settings ─────────────────────────────────────────────────────────────────

function apply(next: Settings, first = false) {
  const was = State.settings;
  State.settings = { ...State.settings, ...next };
  Sound.setEnabled(State.settings.soundEnabled);
  Sound.setVolume(State.settings.soundVolume);
  applyLanguage(State.settings.language);
  const outfit = isOutfit(State.settings.mochiOutfit) ? State.settings.mochiOutfit : "auto";
  wear(resolve(outfit, new Date()));
  if (!State.settings.petEnabled) {
    if (nextVisit != null) window.clearTimeout(nextVisit);
    nextVisit = null;
    if (visiting) flee();
  } else if (first || !was.petEnabled) {
    // Just switched on: the first visit comes soon, so the person sees what they asked for.
    schedule(8_000 + Math.random() * 7_000);
  } else if (was.petFrequency !== State.settings.petFrequency) {
    schedule();
  }
}

async function main() {
  sizeCanvas();
  void Sound.preload();
  const boot = await Bridge.boot();
  if (boot) apply(boot.settings, true);
  await onEvent<Settings>("settings-changed", (s) => apply(s));
  window.setInterval(() => {
    const outfit = isOutfit(State.settings.mochiOutfit) ? State.settings.mochiOutfit : "auto";
    wear(resolve(outfit, new Date()));
  }, 3600_000);

  if (!IS_TAURI) {
    // Browser preview: ?edge=left|right|bottom shows a visit at once; coucouPet.frame(dt) steps it by hand.
    (window as unknown as { coucouPet: object }).coucouPet = {
      frame,
      visit: (e?: Edge) => {
        State.settings = { ...State.settings, petEnabled: true };
        return visit(e);
      },
      state: () => ({ edge, rise, riseTarget, visiting }),
      stop: () => {
        timers.forEach(clearTimeout);
        timers = [];
        visiting = false;
        cancelAnimationFrame(raf);
      },
    };
  }
}

void main();
