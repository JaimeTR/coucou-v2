// The Spotify pill's pure parts: where the bar is, the clock, the track line.
import test from "node:test";
import assert from "node:assert/strict";
import { clock, positionAt, trackLine } from "../.test-build/core/spotify.js";

test("the bar runs on from the moment it was read while playing", () => {
  const s = { position: 10, duration: 200, playing: true, at: 1000 };
  assert.equal(positionAt(s, 1000), 10);
  assert.equal(positionAt(s, 6000), 15);
});

test("a paused track does not move, and the bar never passes the end", () => {
  assert.equal(positionAt({ position: 10, duration: 200, playing: false, at: 0 }, 99_000), 10);
  assert.equal(positionAt({ position: 195, duration: 200, playing: true, at: 0 }, 60_000), 200);
  // Spotify did not say how long: no end to stop at.
  assert.equal(positionAt({ position: 0, duration: 0, playing: true, at: 0 }, 4000), 4);
  // A clock that went back never makes the bar go back.
  assert.equal(positionAt({ position: 10, duration: 200, playing: true, at: 5000 }, 1000), 10);
});

test("the clock reads minutes and seconds, and hours when there are some", () => {
  assert.equal(clock(0), "0:00");
  assert.equal(clock(187), "3:07");
  assert.equal(clock(3723), "1:02:03");
  assert.equal(clock(-5), "0:00");
  assert.equal(clock(59.9), "0:59");
});

test("the track line leaves out what Spotify did not say", () => {
  assert.equal(trackLine({ title: "Song", artist: "Band" }), "Song — Band");
  assert.equal(trackLine({ title: "Song", artist: "" }), "Song");
  assert.equal(trackLine({ title: "", artist: "" }), "");
});
