// The left half of the welcome screen.
import test from "node:test";
import assert from "node:assert/strict";
import { agoEs, panelRows, panelHasRows } from "../.test-build/greetingPanel.js";

const NOW = Date.UTC(2026, 9, 5, 18, 0, 0);
const secs = (msAgo) => NOW / 1000 - msAgo / 1000;
const MIN = 60_000, H = 3_600_000, D = 86_400_000;

test("how long ago reads naturally in Spanish", () => {
  assert.equal(agoEs(0, NOW), "");
  assert.equal(agoEs(secs(20_000), NOW), "ahora");
  assert.equal(agoEs(secs(5 * MIN), NOW), "hace 5 min");
  assert.equal(agoEs(secs(2 * H), NOW), "hace 2 h");
  assert.equal(agoEs(secs(30 * H), NOW), "ayer");
  assert.equal(agoEs(secs(3 * D), NOW), "hace 3 d");
  // A clock a little ahead of the file's time never shows a negative.
  assert.equal(agoEs(secs(-5 * MIN), NOW), "ahora");
});

test("the last project is the first row, with how long ago", () => {
  const rows = panelRows(
    { claudeConnected: true, lastProject: { name: "coucou", path: "C:/x/coucou", lastActive: secs(2 * H) } },
    NOW,
  );
  assert.deepEqual(rows.last, { name: "coucou", path: "C:/x/coucou", ago: "hace 2 h" });
  assert.equal(rows.pending, null, "nothing pending is no row, not an empty one");
});

test("an unconnected Claude Code is what needs you first", () => {
  const rows = panelRows({ claudeConnected: false, github: { reviews: 3, failing: 0, copilot: 0 } }, NOW);
  assert.deepEqual(rows.pending, { text: "Falta conectar Claude Code", target: "settings" });
});

test("GitHub's news is summed up in one short line", () => {
  const rows = panelRows({ claudeConnected: true, github: { reviews: 2, failing: 1, copilot: 1 } }, NOW);
  assert.equal(rows.pending.text, "2 revisiones pedidas · 1 CI fallando · 1 PR de Copilot");
  assert.equal(rows.pending.target, "github");
  assert.equal(panelRows({ claudeConnected: true, github: { reviews: 1, failing: 0, copilot: 0 } }, NOW).pending.text, "1 revisión pedida");
  assert.equal(panelRows({ claudeConnected: true, github: { reviews: 0, failing: 0, copilot: 2 } }, NOW).pending.text, "2 PRs de Copilot");
});

test("a quiet setup leaves the panel empty, and the welcome does not wait for it", () => {
  const quiet = panelRows({ claudeConnected: true, github: { reviews: 0, failing: 0, copilot: 0 } }, NOW);
  assert.equal(quiet.last, null);
  assert.equal(quiet.pending, null);
  assert.equal(panelHasRows(quiet), false);
  assert.equal(panelHasRows(panelRows({ claudeConnected: true, lastProject: { name: "a", path: "p", lastActive: 1 } }, NOW)), true);
  // GitHub not answered yet (or not configured) is the same as nothing to report.
  assert.equal(panelRows({ claudeConnected: true, github: null }, NOW).pending, null);
});
