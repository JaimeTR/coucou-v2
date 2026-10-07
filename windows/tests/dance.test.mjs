// Mochi's dance: it fades in with the music, hops on a 112 BPM beat, and every
// save() it opens is closed. Drawn against a recording stand-in for the canvas.
import test from "node:test";
import assert from "node:assert/strict";

// What the engine touches that node does not have.
const recorder = () => {
  const calls = [];
  const make = (path) =>
    new Proxy(function () {}, {
      get: (_, prop) => (prop === "calls" ? calls : make(path.concat(String(prop)))),
      set: () => true,
      apply: (_, __, args) => {
        calls.push([path.at(-1), ...args]);
        return make(path.concat("()"));
      },
    });
  return make([]);
};
globalThis.Path2D = class { constructor() { return recorder(); } };
let fakeNow = 10_000;
globalThis.performance = { now: () => fakeNow };

const { BotEngine } = await import("../.test-build/mochi/engine.js");

function drawn(engine) {
  const ctx = recorder();
  engine.draw(ctx, 200, 200);
  return ctx.calls;
}

test("music fades Mochi into the dance and the music stopping fades it out", () => {
  const e = new BotEngine();
  assert.equal(e.dancingLevel, 0);
  e.isDancing = true;
  for (let i = 0; i < 30; i++) e.update(0.016); // ~0.5 s
  assert.equal(e.dancingLevel, 1, "in over 0.3 s");
  assert.ok(e.busy, "the frame loop must keep running while it dances");
  e.isDancing = false;
  e.update(0.25);
  assert.ok(e.dancingLevel > 0 && e.dancingLevel < 1, "out over 0.5 s, not at once");
  for (let i = 0; i < 40; i++) e.update(0.016);
  assert.equal(e.dancingLevel, 0);
});

test("a dancing Mochi hops on the beat, and every save is closed", () => {
  const e = new BotEngine();
  e.isDancing = true;
  for (let i = 0; i < 30; i++) e.update(0.016);

  const at = (ms) => { fakeNow = ms; return drawn(e); };
  const first = at(10_000);
  const quiet = new BotEngine();
  const still = drawn(quiet);
  const opening = (calls) => calls.slice(0, 5).map((c) => c[0]).join(",");
  assert.equal(opening(first), "save,translate,rotate,scale,translate", "the dance wraps the whole drawing in its own transform");
  assert.notEqual(opening(still), opening(first), "a Mochi that is not dancing is drawn as before");

  const balance = (calls) => calls.filter((c) => c[0] === "save").length - calls.filter((c) => c[0] === "restore").length;
  assert.equal(balance(first), 0);
  assert.equal(balance(still), 0);

  // A quarter of a beat later (112 BPM) the hop is somewhere else.
  const ty = (calls) => calls.find((c) => c[0] === "translate")[2];
  assert.notEqual(ty(at(10_000)), ty(at(10_000 + 134)));
});
