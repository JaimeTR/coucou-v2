// Mochi's wardrobe: what it wears by the calendar, and that every piece draws.
import test from "node:test";
import assert from "node:assert/strict";
import { OUTFITS, easter, seasonal, resolve, isOutfit, drawOutfitBack, drawOutfitFront } from "../.test-build/mochi/outfits.js";

const day = (y, m, d) => new Date(y, m - 1, d, 12);

test("Easter falls where the calendar says", () => {
  assert.deepEqual(easter(2024), { month: 3, day: 31 });
  assert.deepEqual(easter(2025), { month: 4, day: 20 });
  assert.deepEqual(easter(2026), { month: 4, day: 5 });
  assert.deepEqual(easter(2027), { month: 3, day: 28 });
});

test("the season picks the outfit, with the Mac's priorities", () => {
  assert.equal(seasonal(day(2026, 12, 31)), "partyHat");
  assert.equal(seasonal(day(2027, 1, 2)), "partyHat");
  assert.equal(seasonal(day(2026, 12, 25)), "santaHat");
  assert.equal(seasonal(day(2026, 12, 27)), "none");
  assert.equal(seasonal(day(2026, 10, 31)), "witchHat");
  assert.equal(seasonal(day(2026, 11, 1)), "witchHat");
  assert.equal(seasonal(day(2026, 11, 2)), "none");
  // Easter 2026 is 5 April: two days before to one day after.
  assert.equal(seasonal(day(2026, 4, 3)), "bunnyEars");
  assert.equal(seasonal(day(2026, 4, 6)), "bunnyEars");
  assert.equal(seasonal(day(2026, 4, 2)), "none");
  assert.equal(seasonal(day(2026, 4, 7)), "none");
  assert.equal(seasonal(day(2026, 6, 20)), "none");
  assert.equal(seasonal(day(2026, 6, 21)), "sunglasses");
  assert.equal(seasonal(day(2026, 8, 31)), "sunglasses");
  assert.equal(seasonal(day(2026, 9, 1)), "none");
});

test("auto follows the date; anything chosen is worn as chosen; junk is not an outfit", () => {
  assert.equal(resolve("auto", day(2026, 12, 10)), "santaHat");
  assert.equal(resolve("crown", day(2026, 12, 10)), "crown");
  assert.equal(resolve("none", day(2026, 12, 10)), "none");
  assert.ok(OUTFITS.every(isOutfit));
  assert.ok(!isOutfit("fedora") && !isOutfit(undefined));
});

test("every piece draws, looking any way, and leaves the canvas as it found it", () => {
  const calls = [];
  const make = (path) => new Proxy(function () {}, {
    get: (_, p) => make(path.concat(String(p))),
    set: () => true,
    apply: (_, __, a) => { calls.push(path.at(-1)); return make(path.concat("()")); },
  });
  globalThis.Path2D = class {};
  for (const outfit of OUTFITS) {
    for (const [yaw, pitch, roll] of [[0, 0, 0], [0.9, 0.2, 0], [-1.3, -0.3, 0.5], [3, 0, 0]]) {
      calls.length = 0;
      const head = { R: 60, rx: 68, ry: 53, yaw, pitch, roll, eyeSpread: 0.37, eyePitch: -0.12 };
      const ctx = make([]);
      drawOutfitBack(ctx, outfit, head);
      drawOutfitFront(ctx, outfit, head);
      const opened = calls.filter((c) => c === "save").length;
      const closed = calls.filter((c) => c === "restore").length;
      assert.equal(opened, closed, `${outfit} at yaw ${yaw}`);
      // Facing us, a piece is on; "none" and "auto" draw nothing (auto is resolved before drawing).
      if (yaw === 0) assert.equal(calls.length > 0, outfit !== "none" && outfit !== "auto", outfit);
    }
  }
});
