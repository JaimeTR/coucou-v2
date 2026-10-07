// Mochi the pet: when it comes, from where, and what it does.
import test from "node:test";
import assert from "node:assert/strict";
import { GAP_MINUTES, nextGapMs, pickEdge, pickScript, plan, SCRIPT_NAMES, visitLength, slideShift } from "../.test-build/pet/brain.js";

test("the wait between visits follows the frequency, at both ends", () => {
  for (const [freq, [lo, hi]] of Object.entries(GAP_MINUTES)) {
    assert.equal(nextGapMs(freq, () => 0), lo * 60_000, freq);
    assert.equal(nextGapMs(freq, () => 1), hi * 60_000, freq);
  }
  assert.ok(nextGapMs("often", () => 0.5) < nextGapMs("rare", () => 0.5));
  assert.equal(nextGapMs("nonsense", () => 0), GAP_MINUTES.normal[0] * 60_000, "an unknown setting means normal");
});

test("it never comes from the same edge twice running, and never from the top", () => {
  for (const previous of ["bottom", "left", "right", null]) {
    for (const r of [0, 0.3, 0.5, 0.99, 1]) {
      const edge = pickEdge(previous, () => r);
      assert.notEqual(edge, previous);
      assert.ok(["bottom", "left", "right"].includes(edge), edge);
    }
  }
});

test("every visit starts hidden, ends hidden, and stays in order", () => {
  assert.ok(SCRIPT_NAMES.length >= 5);
  for (const name of SCRIPT_NAMES) {
    for (const r of [0, 0.5, 1]) {
      const beats = plan(name, () => r);
      assert.equal(beats[0].at, 0, name);
      assert.ok(beats[0].rise > 0, `${name} starts by coming out`);
      assert.equal(beats.at(-1).rise, 0, `${name} ends by going away`);
      assert.deepEqual(beats.map((b) => b.at), [...beats.map((b) => b.at)].sort((a, b) => a - b), `${name} in order`);
      for (const b of beats) {
        assert.ok(b.rise === undefined || (b.rise >= 0 && b.rise <= 1), name);
        assert.ok(b.move === undefined || (b.move >= 0 && b.move <= 1), name);
      }
      assert.ok(visitLength(beats) >= 3000 && visitLength(beats) <= 15_000, `${name} lasts ${visitLength(beats)} ms`);
    }
  }
  assert.ok(SCRIPT_NAMES.includes(pickScript(() => 0.999)));
  assert.deepEqual(plan("no-such-script", () => 0), plan("hola", () => 0), "an unknown script is a hello");
});

test("hide and seek moves along the edge only while Mochi is hidden", () => {
  const beats = plan("escondidillas", () => 0.8);
  const move = beats.findIndex((b) => b.move !== undefined);
  assert.ok(move > 0);
  assert.equal(beats[move - 1].rise, 0, "it is out of sight when it moves");
  assert.equal(beats[move].move, 0.8);
});

test("the slide takes the whole body past the edge and back to sitting on it", () => {
  const size = 180, R = size * 0.3, ry = R * 0.88, cy = size / 2 + R * 0.06;
  assert.ok(Math.abs(cy + slideShift(0, size) - ry - size) < 1e-9, "hidden: the top of the body is at the edge");
  assert.ok(Math.abs(cy + slideShift(1, size) + ry - size) < 1e-9, "out: the bottom of the body rests on the edge");
  assert.ok(slideShift(0.5, size) < slideShift(0, size) && slideShift(0.5, size) > slideShift(1, size));
  assert.equal(slideShift(-3, size), slideShift(0, size));
  assert.equal(slideShift(9, size), slideShift(1, size));
});
