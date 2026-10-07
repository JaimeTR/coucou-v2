// What the pet says, and when.
import test from "node:test";
import assert from "node:assert/strict";
import { TOPICS, DEFAULTS, QUIET, chooseTopic, classifyMedia, fill, pickPhrase, readingMs } from "../.test-build/pet/phrases.js";

const at = (h) => new Date(2026, 9, 7, h, 30);
const vars = { name: "Jaime", friend: "Sven", minutes: 95 };
const NOON = at(14);

test("every topic has lines in both languages, and every blank in them is one we fill", () => {
  for (const lang of ["es", "en"]) {
    for (const t of TOPICS) {
      assert.ok(DEFAULTS[lang][t].length >= 3, `${lang}/${t}`);
      for (const line of DEFAULTS[lang][t]) {
        assert.ok(!/\{(?!name\}|friend\}|minutes\})/.test(line), `${lang}/${t}: ${line}`);
        assert.ok(line.length <= 140, `${lang}/${t} too long: ${line}`);
      }
    }
  }
});

test("blanks are filled, and a line that needs a missing one is skipped, not said wrong", () => {
  assert.equal(fill("¡Ánimo, {name}! Para la comida de {friend}.", vars), "¡Ánimo, Jaime! Para la comida de Sven.");
  assert.equal(fill("Hola {friend}", { ...vars, friend: "  " }), null);
  assert.equal(fill("Llevas {minutes} min", { ...vars, minutes: 0 }), null);
  assert.equal(fill("Sin blancos", { name: "", friend: "", minutes: 0 }), "Sin blancos");
});

test("what is playing: a music program, a browser (video), nothing", () => {
  assert.equal(classifyMedia(true, "Spotify.exe"), "music");
  assert.equal(classifyMedia(true, "Music"), "music");
  assert.equal(classifyMedia(true, "chrome.exe"), "video");
  assert.equal(classifyMedia(true, "MSEdge"), "video");
  assert.equal(classifyMedia(true, "SomethingElse"), "music");
  assert.equal(classifyMedia(false, "Spotify.exe"), "none");
});

test("the topic follows what is happening, most pressing first", () => {
  const now = 1_000_000_000;
  const topic = (ctx, date = NOON, said = {}) => chooseTopic({ ...QUIET, ...ctx }, date, now, said, () => 0.99);
  assert.equal(topic({ failedAt: now - 10_000, finishedAt: now - 5_000, media: "music" }), "error", "a failure first");
  assert.equal(topic({ finishedAt: now - 10_000, media: "music" }), "finished");
  assert.equal(topic({ finishedAt: now - 200_000, media: "music" }), "music", "finished long ago does not count");
  assert.equal(topic({ media: "video", working: true }), "video");
  assert.equal(topic({ working: true }, at(23)), "late");
  assert.equal(topic({ working: true }, at(3)), "late");
  assert.equal(topic({ workedToday: 100, working: true }), "break");
  assert.equal(topic({ working: true }), "working");
  assert.equal(topic({}), "chat", "nothing special");
  assert.equal(chooseTopic(QUIET, at(9), now, {}, () => 0), "morning");
  assert.equal(chooseTopic(QUIET, NOON, now, {}, () => 0), "afternoon");
  assert.equal(chooseTopic(QUIET, at(20), now, {}, () => 0), "evening");
});

test("it does not repeat a topic it just said", () => {
  const now = 1_000_000_000;
  const ctx = { ...QUIET, working: true, media: "music" };
  assert.equal(chooseTopic(ctx, NOON, now, {}, () => 0.99), "music");
  assert.equal(chooseTopic(ctx, NOON, now, { music: now - 60_000 }, () => 0.99), "working", "music was said a minute ago");
  assert.equal(chooseTopic(ctx, NOON, now, { music: now - 60_000, working: now - 60_000 }, () => 0.99), "chat");
  assert.equal(chooseTopic(ctx, NOON, now, { music: now - 6 * 60_000 }, () => 0.99), "music", "…but again after a while");
});

test("the persons own phrases join the built-in ones, or replace them", () => {
  const custom = { working: ["Dale, {name}, por {friend}!", "Sin nombre aquí"] };
  const all = new Set();
  for (let i = 0; i < 200; i++) all.add(pickPhrase("working", "es", custom, false, vars, Math.random));
  assert.ok(all.has("Dale, Jaime, por Sven!") && all.has("Vas genial. Sigue así."), "both mixed");
  const only = new Set();
  for (let i = 0; i < 100; i++) only.add(pickPhrase("working", "es", custom, true, vars, Math.random));
  assert.deepEqual([...only].sort(), ["Dale, Jaime, por Sven!", "Sin nombre aquí"], "only theirs");
  // Only mine, but none written for this topic: the built-in ones are still better than silence.
  assert.ok(pickPhrase("music", "es", custom, true, vars, () => 0));
  assert.equal(pickPhrase("chat", "es", { chat: ["Hola {friend}"] }, true, { ...vars, friend: "" }, () => 0) != null, true);
});

test("it avoids saying the same line twice running", () => {
  for (let i = 0; i < 100; i++) {
    const a = pickPhrase("chat", "en", {}, false, vars, Math.random, "Coucou!");
    assert.notEqual(a, "Coucou!");
  }
  assert.equal(pickPhrase("chat", "es", { chat: ["Única"] }, true, vars, () => 0, "Única"), "Única", "the only line may repeat");
});

test("a bubble stays long enough to read, not for ever", () => {
  assert.equal(readingMs("¡Coucou!"), 2600);
  assert.ok(readingMs("x".repeat(60)) > 4000);
  assert.equal(readingMs("x".repeat(1000)), 8000);
});
