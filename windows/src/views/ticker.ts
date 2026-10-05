// Overview task ticker — port of TickerView (V2) from IslandViewContent.swift.
//
// Three rows: completed (A), current → completed (B), incoming (C). Every row
// position is recomputed from a single clock in `tick()`, driven by the island's
// frame loop — no CSS transitions and no timers. Chaining CSS transitions with a
// reset timer let two rows land on the same line when steps arrived in bursts,
// and any step that arrived mid-animation was dropped outright. Steps are now
// queued instead, so a burst scrolls past rather than vanishing.

import { h, svg } from "./dom";
import { ICONS } from "./icons";
import { cubicBezier, clamp, lerp } from "../core/anim";
import type { AgentTask } from "../core/state";

const ROW_H = 22;
/** One step transition, milliseconds. */
const DURATION = 380;
/** Beyond this many queued steps we stop trying to show them all. */
const MAX_QUEUE = 4;
const COMPLETED_SCALE = 11.5 / 13; // 0.885 — the completed font size
const EASE = cubicBezier(0.4, 0, 0.2, 1);

interface Row {
  el: HTMLElement;
  chevron: SVGElement;
  check: SVGElement;
  shimmer: HTMLElement;
  dim: HTMLElement;
  text: string;
  /** The live diff behind this step, when it is an edit. */
  diffId: string | null;
}

/** One step waiting its turn to scroll in. */
interface QueuedStep {
  text: string;
  diffId: string | null;
}

/** `Modifie · app.ts  +3 −1`: the tally at the end is what gets its colours. */
const TALLY = /^(.*?)\s+\+(\d+)\s+−(\d+)$/;

function makeRow(): Row {
  const chevron = svg(ICONS.chevronRight, 9, { stroke: 2.4 });
  const check = svg(ICONS.check, 8, { stroke: 2.2 });
  check.style.color = "#454850"; // the completed tick is dimmer than the chevron
  check.style.position = "absolute";
  chevron.style.position = "absolute";
  const shimmer = h("span", { class: "tick-text shimmer" });
  const dim = h("span", {
    class: "tick-text",
    style: "position:absolute;left:0;right:0;color:#6b7079",
  });
  const el = h(
    "div",
    { class: "ticker-row" },
    h("span", { class: "tick-icon", style: "position:relative" }, chevron, check),
    h("span", { style: "position:relative;flex:1 1 auto;min-width:0" }, shimmer, dim),
  );
  return { el, chevron, check, shimmer, dim, text: "", diffId: null };
}

/** The text of a step, with the tally of an edit in green and red. */
function paint(target: HTMLElement, text: string) {
  const m = TALLY.exec(text);
  if (!m) {
    target.textContent = text;
    return;
  }
  target.replaceChildren(
    document.createTextNode(`${m[1]} `),
    h("span", { class: "d-add", text: `+${m[2]}` }),
    document.createTextNode(" "),
    h("span", { class: "d-del", text: `−${m[3]}` }),
  );
}

function setText(row: Row, text: string, diffId: string | null = null) {
  if (row.text === text && row.diffId === diffId) return;
  row.text = text;
  row.diffId = diffId;
  paint(row.shimmer, text);
  paint(row.dim, text);
  row.el.classList.toggle("has-diff", diffId != null);
}

/**
 * Places a row. `phase` 0 = current (shimmering, full size), 1 = completed
 * (dim, shifted up-left and scaled down) — same crossfades as the Swift view.
 */
function place(row: Row, y: number, phase: number, opacity: number) {
  const scale = 1 - phase * (1 - COMPLETED_SCALE);
  row.el.style.transform = `translate(${-phase * 10}px, ${y}px) scale(${scale})`;
  row.el.style.opacity = String(opacity);
  row.chevron.style.opacity = String(clamp(1 - phase * 2, 0, 1));
  row.check.style.opacity = String(clamp(phase * 2 - 1, 0, 1));
  row.shimmer.style.opacity = String(clamp(1 - phase * 1.6, 0, 1));
  row.dim.style.opacity = String(clamp(phase * 2 - 0.4, 0, 1));
}

export class Ticker {
  readonly el: HTMLElement;
  private a = makeRow(); // completed
  private b = makeRow(); // current
  private c = makeRow(); // incoming
  private queue: QueuedStep[] = [];
  private startMs: number | null = null;
  /** Absolute index (steps appended so far) of the step on the current row. */
  private displayIndex = -1;

  /** `onOpenDiff` runs when an edit's row is clicked. */
  constructor(private onOpenDiff?: (diffId: string) => void) {
    this.el = h("div", { class: "ticker" }, this.a.el, this.b.el, this.c.el);
    for (const row of [this.a, this.b, this.c]) {
      row.el.addEventListener("click", () => {
        if (row.diffId) this.onOpenDiff?.(row.diffId);
      });
    }
    this.rest();
  }

  /** The state between transitions: completed on top, current below. */
  private rest() {
    place(this.a, 0, 1, 1);
    place(this.b, ROW_H, 0, 1);
    place(this.c, ROW_H * 2, 0, 0);
  }

  get animating(): boolean {
    return this.startMs != null || this.queue.length > 0;
  }

  sync(task: AgentTask | null) {
    const real = task != null && task.steps.length > 0;
    const steps = real ? task.steps : ["…"];
    const metas = (real && task.stepDiffs) || [];
    // Steps are addressed by how many the session has appended in total, not by
    // their place in the 20 kept: once the list starts dropping its oldest, the
    // place of the newest never changes and the ticker would stop moving.
    const seq = real ? Math.max(task.seq ?? steps.length, steps.length) : 1;
    const base = seq - steps.length; // absolute index of steps[0]
    const idx = task ? (real ? seq - 1 : 0) : -1;
    const textAt = (abs: number) => steps[abs - base] ?? "…";
    const diffAt = (abs: number) => metas[abs - base] ?? null;

    // First render: drop straight into place, no animation.
    if (this.displayIndex < 0) {
      this.displayIndex = idx;
      this.seed(textAt, diffAt, idx);
      return;
    }

    // The session restarted (steps were cleared): re-seed rather than scroll.
    if (idx < this.displayIndex) {
      this.queue = [];
      this.startMs = null;
      this.displayIndex = idx;
      this.seed(textAt, diffAt, idx);
      return;
    }

    for (let i = Math.max(this.displayIndex + 1, base); i <= idx; i++) {
      this.queue.push({ text: textAt(i), diffId: diffAt(i) });
    }
    this.displayIndex = idx;
    if (this.queue.length > MAX_QUEUE) {
      this.queue = this.queue.slice(-MAX_QUEUE);
    }

    // A step already on screen can change under us: an edit announced as
    // "Modifie · app.ts" becomes "Modifie · app.ts  +3 −1" once it has run.
    for (let i = 0; i < this.queue.length; i++) {
      const abs = idx - (this.queue.length - 1 - i);
      this.queue[i] = { text: textAt(abs), diffId: diffAt(abs) };
    }
    if (this.startMs != null && this.queue.length > 0) {
      setText(this.c, this.queue[0].text, this.queue[0].diffId);
    }
    const current = idx - this.queue.length; // the step on the middle row
    if (current >= 0) {
      setText(this.b, textAt(current), diffAt(current));
      if (current > 0) setText(this.a, textAt(current - 1), diffAt(current - 1));
    }
  }

  private seed(
    textAt: (abs: number) => string,
    diffAt: (abs: number) => string | null,
    idx: number,
  ) {
    const at = Math.max(idx, 0);
    if (idx > 0) setText(this.a, textAt(idx - 1), diffAt(idx - 1));
    else setText(this.a, "…");
    setText(this.b, textAt(at), diffAt(at));
    this.rest();
  }

  /** Called every frame by the island while the overview is on screen. */
  tick(nowMs: number) {
    if (this.startMs == null) {
      if (this.queue.length === 0) return;
      setText(this.c, this.queue[0].text, this.queue[0].diffId);
      place(this.c, ROW_H * 2, 0, 0);
      this.startMs = nowMs;
    }

    const p = clamp((nowMs - this.startMs) / DURATION, 0, 1);
    const e = EASE(p);

    // A leaves upwards and fades a little faster than it moves, as on macOS.
    place(this.a, lerp(0, -ROW_H, e), 1, clamp(1 - p * 1.35, 0, 1));
    place(this.b, lerp(ROW_H, 0, e), e, 1);
    place(this.c, lerp(ROW_H * 2, ROW_H, e), 0, e);

    if (p < 1) return;

    // Commit: the current row becomes the completed one, the incoming row the
    // current one. Texts move, elements stay put — no reordering, no overlap.
    setText(this.a, this.b.text, this.b.diffId);
    setText(this.b, this.c.text, this.c.diffId);
    this.queue.shift();
    this.startMs = null;
    this.rest();
  }
}
