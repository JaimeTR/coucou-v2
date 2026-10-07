// Where the island sits when it is left against an edge of the screen.
import test from "node:test";
import assert from "node:assert/strict";
import { placement, undockNudge, isDock } from "../.test-build/island/dock.js";

const PW = 720, PH = 320;
const at = (dock, w, h, free = true) => placement(dock, free, false, w, h, 14, PW, PH);

test("fixed mode and the top edge are the usual shape: centred, flush with the top", () => {
  for (const p of [at(null, 288, 32, false), at("top", 288, 32), at("top", 640, 160)]) {
    assert.equal(p.top, 0);
    assert.equal(p.transform, "");
    assert.match(p.radius, /^0 0 /);
  }
  assert.equal(at("top", 288, 32).left, (PW - 288) / 2);
});

test("floating is rounded all round and keeps its place", () => {
  const p = at(null, 288, 32);
  assert.equal(p.radius, "14px");
  assert.deepEqual(p.rect, { x: 216, y: 0, w: 288, h: 32 });
});

test("the bottom edge: flush with the bottom of the window, rounded on top", () => {
  const p = at("bottom", 640, 160);
  assert.deepEqual(p.rect, { x: 40, y: 160, w: 640, h: 160 });
  assert.equal(p.radius, "14px 14px 0 0");
  assert.equal(at("bottom", 288, 32).rect.y, PH - 32);
});

test("a side edge: a vertical capsule at rest and the usual card open, both flush, never turned", () => {
  const rest = at("left", 46, 104);
  assert.deepEqual(rest.rect, { x: 0, y: 0, w: 46, h: 104 });
  assert.equal(rest.transform, "", "Mochi and the text stay upright");
  assert.equal(rest.radius, "0 14px 14px 0", "flat on the edge side");
  assert.deepEqual(at("left", 640, 160).rect, { x: 0, y: 0, w: 640, h: 160 });

  const right = at("right", 46, 104);
  assert.deepEqual(right.rect, { x: PW - 46, y: 0, w: 46, h: 104 });
  assert.equal(right.transform, "");
  assert.equal(right.radius, "14px 0 0 14px");
  assert.deepEqual(at("right", 640, 160).rect, { x: 80, y: 0, w: 640, h: 160 });
});

test("nothing is ever turned, whatever the edge", () => {
  for (const dock of [null, "top", "bottom", "left", "right"]) {
    for (const [w, h] of [[288, 32], [46, 104], [640, 160]]) assert.equal(at(dock, w, h).transform, "", `${dock} ${w}x${h}`);
  }
});

test("leaving an edge keeps the island where it was seen, even though it changes size", () => {
  const capsule = { w: 46, h: 104 }, bar = { w: 288, h: 32 };
  // Left capsule centre (23, 52); the floating bar's centre is (360, 16).
  assert.deepEqual(undockNudge("left", capsule, bar, 14, PW, PH), { dx: 23 - 360, dy: 52 - 16 });
  assert.deepEqual(undockNudge("right", capsule, bar, 14, PW, PH), { dx: PW - 23 - 360, dy: 52 - 16 });
  assert.deepEqual(undockNudge("top", bar, bar, 14, PW, PH), { dx: 0, dy: 0 }, "at the top it was already there");
  assert.deepEqual(undockNudge("bottom", bar, bar, 14, PW, PH), { dx: 0, dy: PH - 32 });
});

test("only the four edges are docks", () => {
  assert.ok(["top", "bottom", "left", "right"].every(isDock));
  assert.ok(!isDock("middle") && !isDock(null) && !isDock(undefined));
});
