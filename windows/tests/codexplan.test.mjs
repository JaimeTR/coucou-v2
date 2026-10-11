// Codex's limits: the two windows are told apart by their length, and odd answers are no answer.
import test from "node:test";
import assert from "node:assert/strict";
import { parseCodexPlan, codexIsStale, codexResetsLabel } from "../.test-build/core/codexPlan.js";

const answer = {
  rateLimits: {
    planType: "plus",
    primary: { usedPercent: 12.5, resetsAt: 1900000000, windowDurationMins: 300 },
    secondary: { usedPercent: 140, resetsAt: 1900500000, windowDurationMins: 10080 },
  },
  rateLimitResetCredits: {
    availableCount: 2,
    credits: [
      { status: "available", expiresAt: 1900900000 },
      { status: "available", expiresAt: 1900800000 },
      { status: "used", expiresAt: 1 },
    ],
  },
};

test("a window of a day or less is the 5-hour one, the other is the week; percentages are clamped", () => {
  const u = parseCodexPlan(answer, 1000);
  assert.equal(u.planType, "plus");
  assert.equal(u.fiveHour.used, 12.5);
  assert.equal(u.fiveHour.resetsAt, 1900000000);
  assert.equal(u.sevenDay.used, 100, "clamped");
  assert.equal(u.updatedAt, 1000);
});

test("free resets are counted and the soonest expiry kept", () => {
  const u = parseCodexPlan(answer);
  assert.equal(u.resetCredits, 2);
  assert.equal(u.resetCreditExpiresAt, 1900800000);
  assert.equal(codexResetsLabel(u), "2 reinicios gratis disponibles");
  assert.equal(codexResetsLabel({ resetCredits: 1 }), "1 reinicio gratis disponible");
  assert.equal(codexResetsLabel(null), "");
});

test("a window with no duration is the week, and one without numbers is skipped", () => {
  const u = parseCodexPlan({ rateLimits: { primary: { usedPercent: 3, resetsAt: 5 }, secondary: { usedPercent: "x" } } });
  assert.equal(u.sevenDay.used, 3);
  assert.equal(u.fiveHour, null);
});

test("nothing usable is no answer", () => {
  for (const bad of [null, undefined, 3, "x", [], {}, { rateLimits: null }, { rateLimits: {} }, { rateLimits: { primary: { usedPercent: NaN, resetsAt: 1 } } }]) {
    assert.equal(parseCodexPlan(bad), null, JSON.stringify(bad));
  }
});

test("an answer is stale after a minute, or when there is none", () => {
  assert.equal(codexIsStale(null), true);
  assert.equal(codexIsStale({ updatedAt: 1000 }, 1000 + 59_000), false);
  assert.equal(codexIsStale({ updatedAt: 1000 }, 1000 + 60_000), true);
});
