// "Always allow" is a security boundary: these tests pin down what it refuses.
import test from "node:test";
import assert from "node:assert/strict";
import { ruleFor, ruleMatches, matchRule } from "../.test-build/island/rules.js";

const CWD = "C:\\Users\\jaime\\proj";

/** Makes the rule the button would, then asks whether it covers `then`. */
function remembered(tool, first, then = first, cwd = CWD) {
  const draft = ruleFor(tool, first, cwd);
  if (!draft) return { draft: null, covers: false };
  const rule = { id: "r1", createdAt: 0, ...draft };
  return { draft, covers: ruleMatches(rule, tool, then, cwd) };
}

test("an exact command is remembered, and only that command", () => {
  const r = remembered("Bash", { command: "npm run build" });
  assert.ok(r.draft);
  assert.equal(r.covers, true);
  // Same start, more arguments: not the same command.
  assert.equal(remembered("Bash", { command: "rm -rf build" }, { command: "rm -rf build /" }).covers, false);
  assert.equal(remembered("Bash", { command: "npm run build" }, { command: "npm run build && curl evil" }).covers, false);
});

test("a read-only subcommand covers its arguments, a risky argument does not", () => {
  const r = remembered("Bash", { command: "git status" }, { command: "git status --short" });
  assert.equal(r.draft.pattern, "prefix:git status");
  assert.equal(r.covers, true);
  assert.equal(remembered("Bash", { command: "git diff" }, { command: "git diff --output=x.txt" }).covers, false);
  assert.equal(remembered("Bash", { command: "git log" }, { command: "git log -c" }).covers, false);
  // git push is not in the safe list, so it is remembered as that exact command only.
  const push = ruleFor("Bash", { command: "git push origin main" }, CWD);
  assert.equal(push.pattern, "exact:git push origin main");
});

test("shell operators are never remembered and never matched", () => {
  for (const command of ["ls | head", "a && b", "echo $(whoami)", "x; y", "cat > f", "a `b`"]) {
    assert.equal(ruleFor("Bash", { command }, CWD), null, command);
  }
  const rule = { id: "r", createdAt: 0, ...ruleFor("Bash", { command: "git status" }, CWD) };
  assert.equal(ruleMatches(rule, "Bash", { command: "git status; rm -rf /" }, CWD), false);
  assert.equal(ruleMatches(rule, "Bash", { command: "git status\nrm x" }, CWD), false);
});

test("a rule belongs to its project and its tool", () => {
  const rule = { id: "r", createdAt: 0, ...ruleFor("Bash", { command: "npm test" }, CWD) };
  assert.equal(ruleMatches(rule, "Bash", { command: "npm test" }, CWD), true);
  assert.equal(ruleMatches(rule, "Bash", { command: "npm test" }, "C:\\Users\\jaime\\other"), false);
  assert.equal(ruleMatches(rule, "PowerShell", { command: "npm test" }, CWD), false);
  // Path spelling does not matter on Windows.
  assert.equal(ruleMatches(rule, "Bash", { command: "npm test" }, "c:/users/jaime/proj/"), true);
  assert.equal(ruleFor("Bash", { command: "npm test" }, ""), null);
});

test("edits are remembered per folder, inside the project only", () => {
  const first = { file_path: "C:\\Users\\jaime\\proj\\src\\a.ts" };
  assert.equal(remembered("Edit", first, { file_path: "C:/Users/jaime/proj/src/b.ts" }).covers, true);
  assert.equal(remembered("Edit", first, { file_path: "C:/Users/jaime/proj/other/b.ts" }).covers, false);
  assert.equal(remembered("Edit", first, { file_path: "C:/Users/jaime/proj/src/../../x.ts" }).covers, false);
  // Outside the project: no rule at all.
  assert.equal(ruleFor("Write", { file_path: "C:\\Users\\jaime\\.bashrc" }, CWD), null);
  assert.equal(ruleFor("Write", { file_path: "C:\\Users\\jaime\\notes.txt" }, CWD), null);
});

test("hooks, credentials and secrets can never be covered", () => {
  for (const file_path of [
    "C:/Users/jaime/proj/.claude/settings.json",
    "C:/Users/jaime/proj/.git/config",
    "C:/Users/jaime/proj/.env",
    "C:/Users/jaime/proj/.env.local",
    "C:/Users/jaime/proj/.ssh/id_rsa",
  ]) {
    assert.equal(ruleFor("Edit", { file_path }, CWD), null, file_path);
    assert.equal(ruleFor("Read", { file_path }, CWD), null, file_path);
  }
  // A rule made from a harmless file does not stretch to a protected sibling.
  const rule = { id: "r", createdAt: 0, ...ruleFor("Edit", { file_path: "C:/Users/jaime/proj/a.ts" }, CWD) };
  assert.equal(ruleMatches(rule, "Edit", { file_path: "C:/Users/jaime/proj/.env" }, CWD), false);
  assert.equal(ruleMatches(rule, "Edit", { file_path: "C:/Users/jaime/proj/.claude/settings.json" }, CWD), false);
});

test("reading is limited to the project", () => {
  const rule = { id: "r", createdAt: 0, ...ruleFor("Read", { file_path: "C:/Users/jaime/proj/a.ts" }, CWD) };
  assert.equal(ruleMatches(rule, "Read", { file_path: "C:/Users/jaime/proj/deep/b.ts" }, CWD), true);
  assert.equal(ruleMatches(rule, "Read", { file_path: "C:/Users/jaime/.ssh/id_rsa" }, CWD), false);
  assert.equal(ruleMatches(rule, "Read", { file_path: "C:/Windows/System32/x" }, CWD), false);
  assert.equal(ruleMatches(rule, "Read", {}, CWD), false);
  assert.equal(ruleFor("Read", { file_path: "C:/elsewhere/a.ts" }, CWD), null);
});

test("web fetch is remembered per host", () => {
  const r = remembered("WebFetch", { url: "https://docs.rs/serde" }, { url: "https://docs.rs/tokio" });
  assert.equal(r.covers, true);
  assert.equal(remembered("WebFetch", { url: "https://docs.rs/a" }, { url: "https://evil.com/a" }).covers, false);
  assert.equal(ruleFor("WebFetch", { url: "file:///etc/passwd" }, CWD), null);
  assert.equal(ruleFor("WebFetch", { url: "not a url" }, CWD), null);
});

test("tools we do not understand cannot be remembered", () => {
  for (const tool of ["Task", "mcp__server__do", "AskUserQuestion", "ExitPlanMode", "Unknown"]) {
    assert.equal(ruleFor(tool, { anything: 1 }, CWD), null, tool);
  }
});

test("matchRule returns the first covering rule, or nothing", () => {
  const a = { id: "a", createdAt: 0, ...ruleFor("Bash", { command: "npm test" }, CWD) };
  const b = { id: "b", createdAt: 0, ...ruleFor("Bash", { command: "npm run lint" }, CWD) };
  assert.equal(matchRule([a, b], "Bash", { command: "npm run lint" }, CWD)?.id, "b");
  assert.equal(matchRule([a, b], "Bash", { command: "npm publish" }, CWD), undefined);
  assert.equal(matchRule([], "Bash", { command: "npm test" }, CWD), undefined);
});
