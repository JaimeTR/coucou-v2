// Mochi the pet: this page lives in a transparent window that Rust places
// against a screen edge. Now and then it slides Mochi in, does a bit of mischief
// and says something that suits the moment (see brain.ts and phrases.ts), and
// slides it out again; between visits the window is hidden and nothing runs but
// one timer.

import { Bridge, IS_TAURI, onEvent } from "../core/bridge";
import type { ModeInfo } from "../core/modes";
import { Sound } from "../core/sound";
import { applyLanguage, uiLanguage } from "../core/i18n";
import { State, type Settings } from "../core/state";
import { speakAuto, stopSpeaking } from "../core/voice";
import { BotEngine } from "../mochi/engine";
import { isOutfit, resolve, wear } from "../mochi/outfits";
import {
  bubbleBox, isFrequency, mochiBox, nextGapMs, pickEdge, plan, scriptFor, slideOffset, squareOrigin, SQUARE, visitLength, WINDOW,
  type Act, type Beat, type Box, type Edge,
} from "./brain";
import { chooseTopic, classifyMedia, pickPhrase, QUIET, readingMs, type Context, type Topic } from "./phrases";

const canvas = document.getElementById("pet") as HTMLCanvasElement;
const bubble = document.getElementById("bubble") as HTMLDivElement;
const ctx2d = canvas.getContext("2d")!;
const engine = new BotEngine();

let edge: Edge = "bottom";
let rise = 0;
let riseTarget = 0;
let visiting = false;
let startled = false;
let timers: number[] = [];
let nextVisit: number | null = null;
let lastEdge: Edge | null = null;
let lastVisitEnd = 0;
let raf = 0;
let last = 0;
/** Where Mochi looks when nobody is near, set by the script. */
let look = { x: 0, y: 0 };
/** The pointer, in window coordinates (from Rust, anywhere on the screen). */
let pointer: { x: number; y: number } | null = null;

// What is going on, for choosing what to say.
let context: Context = { ...QUIET };
const said: Partial<Record<Topic, number>> = {};
let visitTopic: Topic = "chat";
let lastPhrase = "";
let detectedName = "";
let bubbleUntil = 0;
let bubbleTimer: number | null = null;
let hitSent = "";
let hitAt = 0;

function sizeCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(WINDOW.w * dpr);
  canvas.height = Math.round(WINDOW.h * dpr);
}

/** One frame: ease the slide, step Mochi, draw it turned toward its edge. */
export function frame(dt: number) {
  rise += (riseTarget - rise) * (1 - Math.exp(-dt * 7));
  if (Math.abs(riseTarget - rise) < 0.002) rise = riseTarget;

  const dpr = canvas.width / WINDOW.w;
  const o = squareOrigin(edge);
  const off = slideOffset(edge, rise);
  let lx = look.x;
  let ly = look.y;
  if (pointer) {
    // Where the pointer is, from Mochi's own centre: its eyes follow it.
    lx = Math.tanh((pointer.x - (o.x + SQUARE / 2 + off.x)) / 120);
    ly = -Math.tanh((pointer.y - (o.y + SQUARE / 2 + off.y)) / 100);
  }
  engine.lookX = lx;
  engine.lookY = ly;
  engine.update(dt);

  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.clearRect(0, 0, WINDOW.w, WINDOW.h);
  ctx2d.save();
  // Upright whichever edge it comes from; clipped by the window, as if by the edge.
  ctx2d.translate(o.x + off.x, o.y + off.y);
  engine.draw(ctx2d, SQUARE, SQUARE);
  ctx2d.restore();

  pushHit();
}

/** Tells Rust which parts of the window take the mouse: Mochi's body and the bubble. */
function pushHit() {
  const now = performance.now();
  if (now - hitAt < 100) return;
  hitAt = now;
  const rects: Box[] = [];
  if (rise > 0.08) rects.push(mochiBox(edge, rise));
  if (bubble.classList.contains("show")) {
    rects.push({ x: bubble.offsetLeft, y: bubble.offsetTop, w: bubble.offsetWidth, h: bubble.offsetHeight });
  }
  const key = rects.map((r) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`).join("|");
  if (key === hitSent) return;
  hitSent = key;
  if (IS_TAURI) void Bridge.petHit(rects.map((r) => [r.x, r.y, r.w, r.h]));
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

// ── Talking ──────────────────────────────────────────────────────────────────

function hideBubble() {
  if (bubbleTimer != null) window.clearTimeout(bubbleTimer);
  bubbleTimer = null;
  bubble.classList.remove("show");
  bubbleUntil = 0;
}

function showBubble(text: string) {
  bubble.textContent = text;
  bubble.className = `edge-${edge}`;
  bubble.style.maxWidth = `${edge === "bottom" ? 280 : 150}px`;
  bubble.style.visibility = "hidden";
  bubble.classList.add("show");
  const box = bubbleBox(edge, riseTarget || 0.75, bubble.offsetWidth, bubble.offsetHeight);
  bubble.style.left = `${box.x}px`;
  bubble.style.top = `${box.y}px`;
  bubble.style.visibility = "visible";
  const ms = readingMs(text);
  bubbleUntil = performance.now() + ms;
  if (bubbleTimer != null) window.clearTimeout(bubbleTimer);
  bubbleTimer = window.setTimeout(hideBubble, ms);
}

/** Says something that suits the moment: in the bubble, and aloud if voice is on. */
function say() {
  if (!State.settings.petSpeech) return;
  const vars = {
    name: State.settings.userName.trim() || detectedName,
    friend: State.settings.petFriend.trim(),
    minutes: Math.round(context.workedToday),
  };
  const text = pickPhrase(visitTopic, uiLanguage(), State.settings.petPhrases, State.settings.petOnlyMine, vars, Math.random, lastPhrase);
  if (!text) return;
  lastPhrase = text;
  said[visitTopic] = Date.now();
  showBubble(text);
  // Someone watching a video is not talked over.
  if (visitTopic !== "video") speakAuto("pet", text);
}

function act(a: Act) {
  switch (a) {
    case "say": say(); break;
    case "wave": engine.greet(); break;
    case "yawn": if (visitTopic !== "video") Sound.play("yawn"); engine.triggerEmote("yawn"); break;
    case "wink": engine.triggerEmote("wink"); break;
    case "love": if (visitTopic !== "video") Sound.play("love"); engine.triggerEmote("love", 2.4); break;
    case "proud": engine.triggerEmote("proud"); break;
    case "sleep": engine.setState("sleeping"); break;
    case "wake": engine.setState("idle"); Sound.play("pop"); engine.triggerEmote("surprised"); break;
    case "dance": engine.isDancing = true; break;
    case "stop-dance": engine.isDancing = false; break;
    case "look-left": look = { x: -0.9, y: 0.1 }; break;
    case "look-right": look = { x: 0.9, y: 0.1 }; break;
    case "look-up": look = { x: 0, y: 0.8 }; break;
    case "look-front": look = { x: 0, y: 0 }; break;
  }
}

// ── A visit ──────────────────────────────────────────────────────────────────

function inRust(call: Promise<unknown>) {
  // In a plain browser (the preview) there is no window to place: only the drawing matters.
  if (IS_TAURI) call.catch((e) => void Bridge.log(`pet: ${String(e)}`));
}

function later(ms: number, fn: () => void) {
  timers.push(window.setTimeout(fn, ms));
}

/** What is playing now, as music, video or nothing. */
async function listen(): Promise<void> {
  const now = IS_TAURI ? await Bridge.nowPlaying() : null;
  context = { ...context, media: classifyMedia(!!now?.playing, now?.app ?? "") };
}

/** Over a game: says a line aloud, nothing on screen, if the person wants it. */
async function cheerInGame(): Promise<boolean> {
  const m = await Bridge.modeInfo();
  if (!m || m.mode !== "game" || !State.settings.petGameCheer || !State.settings.petSpeech || !State.settings.petEnabled) return false;
  State.workMode = m.mode; // lets speakAuto allow the pet's voice, and only that
  const vars = {
    name: State.settings.userName.trim() || detectedName,
    friend: State.settings.petFriend.trim(),
    minutes: Math.round(context.workedToday),
  };
  const text = pickPhrase("chat", uiLanguage(), State.settings.petPhrases, State.settings.petOnlyMine, vars, Math.random, lastPhrase);
  if (!text) return false;
  lastPhrase = text;
  return speakAuto("pet", text);
}

/** Plays a visit about `topic` (or what suits the moment); resolves when it starts. */
async function visit(forceEdge?: Edge, forceTopic?: Topic, force = false) {
  if (visiting || (!State.settings.petEnabled && !force)) return;
  if (IS_TAURI && !(await Bridge.petAllowed())) {
    // In a game only a voice may cheer (no window); in a meeting or over a video, nothing.
    if (!force && (await cheerInGame())) return schedule();
    return schedule(2 * 60_000); // busy: try again soon
  }
  await listen();
  visitTopic = forceTopic ?? chooseTopic(context, new Date(), Date.now(), said);
  visiting = true;
  startled = false;
  edge = forceEdge ?? pickEdge(lastEdge);
  lastEdge = edge;
  rise = 0;
  riseTarget = 0;
  look = { x: 0, y: 0 };
  hideBubble();
  engine.setState("idle");
  let along = 0.15 + Math.random() * 0.7;
  inRust(Bridge.petShow(edge, along));
  Sound.resume();
  startLoop();

  const beats: Beat[] = plan(scriptFor(visitTopic));
  const lastAt = Math.max(...beats.map((b) => b.at));
  for (const b of beats) {
    later(b.at, () => {
      if (b.move !== undefined) {
        along = b.move;
        inRust(Bridge.petShow(edge, along));
      }
      if (b.rise !== undefined) {
        // The last slide out waits for the bubble to be read.
        if (b.rise === 0 && b.at === lastAt && bubbleUntil > performance.now()) {
          later(bubbleUntil - performance.now() + 400, () => (riseTarget = 0));
          return;
        }
        riseTarget = b.rise;
        if (b.rise > 0 && rise < 0.05 && visitTopic !== "video") Sound.play("peek");
      }
      if (b.act) act(b.act);
    });
  }
  // The visit ends once the last beat has played and the bubble has been read.
  later(visitLength(beats) + 400, () => {
    const wait = Math.max(0, bubbleUntil - performance.now() + 700);
    later(wait, finish);
  });
}

function finish() {
  timers.forEach(clearTimeout);
  timers = [];
  riseTarget = 0;
  engine.isDancing = false;
  hideBubble();
  stopSpeaking();
  // Let the slide out play, then put the window away.
  window.setTimeout(() => {
    visiting = false;
    lastVisitEnd = Date.now();
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
  hideBubble();
  stopSpeaking();
  later(after, finish);
}

function schedule(ms?: number) {
  if (nextVisit != null) window.clearTimeout(nextVisit);
  nextVisit = null;
  if (!State.settings.petEnabled) return;
  nextVisit = window.setTimeout(() => void visit(), ms ?? nextGapMs(isFrequency(State.settings.petFrequency) ? State.settings.petFrequency : "normal"));
}

// ── Touching Mochi ───────────────────────────────────────────────────────────

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

// A click on the bubble puts it away.
bubble.addEventListener("mousedown", () => hideBubble());

// ── Settings and what the island tells us ────────────────────────────────────

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

/** The island says an agent finished or failed: a good moment to cheer, if Mochi has not just been. */
function onContext(c: Partial<Context>) {
  const before = context;
  context = { ...context, ...c };
  const fresh = (now: number | null, was: number | null) => now != null && now !== was && Date.now() - now < 20_000;
  const topic: Topic | null = fresh(context.failedAt, before.failedAt) ? "error" : fresh(context.finishedAt, before.finishedAt) ? "finished" : null;
  if (!topic || visiting || !State.settings.petEnabled) return;
  if (Date.now() - lastVisitEnd < 3 * 60_000) return;
  window.setTimeout(() => void visit(undefined, topic), 2500);
}

async function main() {
  sizeCanvas();
  void Sound.preload();
  const boot = await Bridge.boot();
  if (boot) {
    detectedName = boot.detectedName ?? "";
    apply(boot.settings, true);
  }
  await onEvent<Settings>("settings-changed", (s) => apply(s));
  await onEvent<ModeInfo>("mode-changed", (m) => {
    State.workMode = m.mode;
    if (m.mode !== "work") {
      stopSpeaking();
      if (visiting) flee();
    }
  });
  await onEvent<Partial<Context>>("pet-context", (c) => onContext(c));
  await onEvent<null>("pet-visit-now", () => void visit(undefined, undefined, true));
  await onEvent<{ x: number; y: number }>("pet-pointer", (p) => (pointer = p));
  window.setInterval(() => {
    const outfit = isOutfit(State.settings.mochiOutfit) ? State.settings.mochiOutfit : "auto";
    wear(resolve(outfit, new Date()));
  }, 3600_000);

  if (!IS_TAURI) {
    // Browser preview: coucouPet.visit("right", "working") shows a visit at once;
    // coucouPet.frame(dt) steps it by hand.
    (window as unknown as { coucouPet: object }).coucouPet = {
      frame,
      visit: (e?: Edge, topic?: Topic) => {
        State.settings = { ...State.settings, petEnabled: true };
        return visit(e, topic);
      },
      state: () => ({ edge, rise, riseTarget, visiting, topic: visitTopic, bubble: bubble.textContent, shown: bubble.classList.contains("show") }),
      context: (c: Partial<Context>) => (context = { ...context, ...c }),
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
