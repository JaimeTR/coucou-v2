// Where the island sits when it is left against an edge of the screen.
import test from "node:test";
import assert from "node:assert/strict";
import { placement, undockNudge, isDock } from "../.test-build/island/dock.js";

const PW = 720, PH = 320;
const at = (dock, expanded, w, h, free = true) => placement(dock, free, expanded, w, h, 14, PW, PH);

test("fixed mode and the top edge are the usual shape: centred, flush with the top", () => {
  for (const p of [at(null, false, 288, 32, false), at("top", false, 288, 32), at("top", true, 640, 160)]) {
    assert.equal(p.top, 0);
    assert.equal(p.transform, "");
    assert.match(p.radius, /^0 0 /);
  }
  assert.equal(at("top", false, 288, 32).left, (PW - 288) / 2);
  assert.equal(at("top", false, 288, 32, false).rect.x, (PW - 288) / 2);
});

test("floating is rounded all round and keeps its place", () => {
  const p = at(null, false, 288, 32);
  assert.equal(p.radius, "14px");
  assert.deepEqual(p.rect, { x: 216, y: 0, w: 288, h: 32 });
});

test("the bottom edge: flush with the bottom of the window, rounded on top", () => {
  const p = at("bottom", true, 640, 160);
  assert.deepEqual(p.rect, { x: 40, y: 160, w: 640, h: 160 });
  assert.equal(p.radius, "14px 14px 0 0");
  assert.equal(at("bottom", false, 288, 32).rect.y, PH - 32);
});

test("the left edge rests as a vertical capsule and opens as a card against the edge", () => {
  const rest = at("left", false, 288, 32);
  assert.deepEqual(rest.rect, { x: 0, y: 0, w: 32, h: 288 }, "the capsule: as wide as the bar was tall");
  assert.equal(rest.transform, "translateY(288px) rotate(-90deg)");
  const open = at("left", true, 640, 160);
  assert.deepEqual(open.rect, { x: 0, y: 0, w: 640, h: 160 });
  assert.equal(open.transform, "");
  assert.equal(open.radius, "0 14px 14px 0", "flat on the edge side");
});

test("the right edge mirrors it", () => {
  const rest = at("right", false, 288, 32);
  assert.deepEqual(rest.rect, { x: PW - 32, y: 0, w: 32, h: 288 });
  assert.equal(rest.transform, "rotate(90deg)");
  const open = at("right", true, 640, 160);
  assert.deepEqual(open.rect, { x: 80, y: 0, w: 640, h: 160 });
  assert.equal(open.radius, "14px 0 0 14px");
});

test("a turned capsule really lies flush on its edge (the quarter turn, worked out)", () => {
  // Turn the element's corners by hand and see where they land.
  const turn = (px, py, deg) => { const a = (deg * Math.PI) / 180; return [px * Math.cos(a) - py * Math.sin(a), px * Math.sin(a) + py * Math.cos(a)]; };
  const w = 288, h = 32;
  // Left: left:0, translateY(w) rotate(-90): the element's top edge (y = 0) must end up on x = 0.
  const left = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => { const [rx, ry] = turn(x, y, -90); return [rx, ry + w]; });
  assert.deepEqual([Math.min(...left.map((p) => p[0])), Math.max(...left.map((p) => p[0]))].map(Math.round), [0, h]);
  assert.deepEqual([Math.min(...left.map((p) => p[1])), Math.max(...left.map((p) => p[1]))].map(Math.round), [0, w]);
  const topEdge = left.slice(0, 2).map((p) => Math.round(p[0]));
  assert.deepEqual(topEdge, [0, 0], "its flat top is against the left edge");
  // Right: left:PW, rotate(90): the top edge must end up on x = PW.
  const right = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => { const [rx, ry] = turn(x, y, 90); return [rx + PW, ry]; });
  assert.deepEqual(right.slice(0, 2).map((p) => Math.round(p[0])), [PW, PW]);
  assert.deepEqual([Math.min(...right.map((p) => p[0])), Math.max(...right.map((p) => p[0]))].map(Math.round), [PW - h, PW]);
});

test("leaving an edge keeps the island where it was seen", () => {
  // Left capsule, centre (16, 144); floating compact centre is (360, 16): the window moves by the difference.
  assert.deepEqual(undockNudge("left", false, 288, 32, 14, PW, PH), { dx: 16 - 360, dy: 144 - 16 });
  // At the top it was already there: only the rounding changes.
  assert.deepEqual(undockNudge("top", false, 288, 32, 14, PW, PH), { dx: 0, dy: 0 });
  // Against the bottom, the island was PH - h down the window.
  assert.deepEqual(undockNudge("bottom", false, 288, 32, 14, PW, PH), { dx: 0, dy: PH - 32 });
});

test("only the four edges are docks", () => {
  assert.ok(["top", "bottom", "left", "right"].every(isDock));
  assert.ok(!isDock("middle") && !isDock(null) && !isDock(undefined));
});
