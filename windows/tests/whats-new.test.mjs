// The blue arrow while a new version waits, and "what's new" after an update.
import test from "node:test";
import assert from "node:assert/strict";
import { LATER_MS, isNewer, showWhatsNew, soFar, soFarLine, updateWaiting, WHATS_NEW } from "../.test-build/core/whatsNew.js";

test("versions compare by number, not by text", () => {
  assert.ok(isNewer("1.10.0", "1.9.2"));
  assert.ok(isNewer("v2.0.0", "1.99.99"));
  assert.ok(isNewer("1.6.0", "1.5"));
  assert.ok(!isNewer("1.5.0", "1.5.0"));
  assert.ok(!isNewer("1.5.0-beta", "1.5.0"));
  assert.ok(!isNewer("1.4.9", "1.5.0"));
});

test("the arrow shows while a version waits, and Más tarde hides that version for a day", () => {
  const now = 1_000_000_000;
  assert.equal(updateWaiting(null, null, now), false);
  assert.equal(updateWaiting("1.6.0", null, now), true);
  assert.equal(updateWaiting("1.6.0", { version: "1.6.0", at: now - 1000 }, now), false);
  assert.equal(updateWaiting("1.6.0", { version: "1.6.0", at: now - LATER_MS }, now), true, "a day later it is back");
  assert.equal(updateWaiting("1.7.0", { version: "1.6.0", at: now - 1000 }, now), true, "a newer version is news again");
});

test("what's new shows on the first launch of a newer version only", () => {
  assert.equal(showWhatsNew(null, "1.6.0"), false, "not on a first install");
  assert.equal(showWhatsNew("", "1.6.0"), false);
  assert.equal(showWhatsNew("1.5.0", "1.6.0"), true);
  assert.equal(showWhatsNew("1.6.0", "1.6.0"), false);
  assert.equal(showWhatsNew("1.7.0", "1.6.0"), false, "not after going back to an older one");
  for (const lines of Object.values(WHATS_NEW)) assert.ok(lines.length <= 3, "three lines fit the card");
});

test("so far adds up the recap and says nothing before there is something", () => {
  assert.equal(soFarLine(soFar({ turns: [], decisions: [] })), null);
  const turn = (minutes, added) => ({ pillId: "integration_claude", project: "p", start: 0, end: minutes * 60_000, files: 1, added, removed: 0, commands: 0, questions: 0 });
  const s = soFar({
    turns: [turn(50, 120), turn(25, 0)],
    decisions: [{ pillId: "x", at: 0, decision: "allow" }, { pillId: "x", at: 0, decision: "always" }, { pillId: "x", at: 0, decision: "deny" }],
  });
  assert.deepEqual(s, { sessions: 2, minutes: 75, lines: 120, approvals: 2 });
  assert.equal(soFarLine(s), "2 sesiones · 1 h 15 min · 120 líneas · 2 aprobaciones desde la isla");
});

test("so far speaks English too", () => {
  const s = { sessions: 1, minutes: 5, lines: 1200, approvals: 1 };
  assert.equal(soFarLine(s, "en"), "1 session · 5 min · 1,200 lines · 1 approval from the island");
});
