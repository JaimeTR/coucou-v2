import test from "node:test";
import assert from "node:assert/strict";
import { voiceAllowed, mustDecline, mayNotify, mayPlaySound, modeLabel, isModeChoice } from "../.test-build/core/modes.js";

test("work lets everything through", () => {
  assert.ok(voiceAllowed("work", "events", false) && mayNotify("work") && mayPlaySound("work"));
  assert.equal(mustDecline("work"), false);
});

test("in a game only the pet may cheer, and only if wanted; no sounds, no popups", () => {
  assert.ok(voiceAllowed("game", "pet", true));
  assert.equal(voiceAllowed("game", "pet", false), false);
  assert.equal(voiceAllowed("game", "events", true), false);
  assert.equal(mayPlaySound("game") || mayNotify("game"), false);
  assert.ok(mustDecline("game"));
});

test("meetings and videos are silent", () => {
  for (const m of ["meeting", "video"]) {
    assert.equal(voiceAllowed(m, "pet", true), false);
    assert.ok(mustDecline(m));
  }
});

test("labels and choices", () => {
  assert.equal(modeLabel({ mode: "game", auto: true, game: "Dota 2" }), "Jugando: Dota 2");
  assert.ok(isModeChoice("auto") && !isModeChoice("nope"));
});
