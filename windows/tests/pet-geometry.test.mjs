// The pet's scripts that talk, and where Mochi and its speech bubble are in the window.
import test from "node:test";
import assert from "node:assert/strict";
import { SCRIPT_NAMES, plan, scriptFor, mochiBox, bubbleBox, squareOrigin, slideOffset, WINDOW, SQUARE, TURN } from "../.test-build/pet/brain.js";

test("each topic has a script that exists", () => {
  for (const topic of ["working", "finished", "error", "music", "video", "late", "break", "morning", "afternoon", "evening", "chat"]) {
    assert.ok(SCRIPT_NAMES.includes(scriptFor(topic, () => 0.5)), topic);
  }
  assert.equal(scriptFor("music"), "baile");
  assert.equal(scriptFor("video"), "silencioso");
});

test("scripts that speak say it once Mochi is out; the dance ends before it hides", () => {
  for (const name of SCRIPT_NAMES) {
    const beats = plan(name, () => 0.5);
    const say = beats.findIndex((b) => b.act === "say");
    if (say >= 0) assert.ok(beats.slice(0, say).some((b) => b.rise > 0), `${name} says it only once out`);
  }
  const baile = plan("baile");
  assert.ok(baile.findIndex((b) => b.act === "dance") < baile.findIndex((b) => b.act === "stop-dance"));
  assert.equal(baile.at(-1).rise, 0);
  assert.ok(plan("silencioso").some((b) => b.act === "say"));
});

test("Mochi's body box follows the slide, against every edge, and stays inside the window", () => {
  for (const edge of ["bottom", "left", "right"]) {
    const hidden = mochiBox(edge, 0), half = mochiBox(edge, 0.5), out = mochiBox(edge, 1);
    for (const b of [hidden, half, out]) {
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= WINDOW.w && b.y + b.h <= WINDOW.h, `${edge} inside the window`);
    }
    const area = (b) => b.w * b.h;
    assert.ok(area(hidden) < area(half) && area(half) < area(out), `${edge}: more of it shows as it comes out`);
  }
  const bottom = mochiBox("bottom", 1);
  assert.ok(Math.abs(bottom.x + bottom.w / 2 - WINDOW.w / 2) < 1e-9, "centred over the window against the bottom");
  assert.equal(bottom.y + bottom.h, WINDOW.h, "reaching the edge");
  assert.equal(mochiBox("right", 1).x + mochiBox("right", 1).w, WINDOW.w, "reaching the right edge");
  assert.equal(mochiBox("left", 1).x, 0, "reaching the left edge");
  const side = mochiBox("right", 1);
  assert.ok(side.w > side.h, "upright: wider than tall, like the bottom one");
});

test("the speech bubble goes beside Mochi, toward the middle of the screen, and never leaves the window", () => {
  const w = 150, h = 60;
  const r = bubbleBox("right", 0.8, w, h), l = bubbleBox("left", 0.8, w, h), b = bubbleBox("bottom", 0.8, 260, 50);
  assert.ok(r.x + w <= mochiBox("right", 0.8, 0).x, "left of Mochi, against the right edge");
  assert.ok(l.x >= mochiBox("left", 0.8, 0).x + mochiBox("left", 0.8, 0).w, "right of Mochi, against the left edge");
  assert.ok(b.y + 50 <= mochiBox("bottom", 0.8, 0).y, "above Mochi, against the bottom");
  for (const box of [r, l, b]) assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= WINDOW.w && box.y + box.h <= WINDOW.h);
  assert.deepEqual(squareOrigin("bottom"), { x: 80, y: 40 });
  assert.equal(TURN.bottom, 0);
  assert.equal(SQUARE, 180);
});

test("Mochi is never turned: it slides in along its edge, standing as always", () => {
  assert.deepEqual(Object.values(TURN), [0, 0, 0]);
  const hidden = (e) => slideOffset(e, 0), out = (e) => slideOffset(e, 1);
  assert.ok(hidden("bottom").y > out("bottom").y && hidden("bottom").x === 0, "down out of sight, up to sit");
  assert.ok(hidden("right").x > out("right").x && hidden("right").y === 0, "across to the right out of sight");
  assert.ok(hidden("left").x < out("left").x && hidden("left").y === 0, "across to the left out of sight");
  assert.equal(slideOffset("right", 0.5).x, -slideOffset("left", 0.5).x, "the two sides mirror");
  // Fully out, the whole body is on screen against the side; hidden, none of it is.
  const rx = SQUARE * 0.3 * 1.14;
  assert.ok(Math.abs(SQUARE / 2 + out("right").x + rx - SQUARE) < 1e-9, "its right side rests on the edge");
  assert.ok(Math.abs(SQUARE / 2 + hidden("right").x - rx - SQUARE) < 1e-9, "hidden: its left side is at the edge");
});
