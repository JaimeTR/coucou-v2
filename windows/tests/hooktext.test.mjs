import test from "node:test";
import assert from "node:assert/strict";
import { promptStep, settledElsewhere } from "../.test-build/island/hookText.js";

test("injected prompts show as their summary or command, never as raw tags", () => {
  const note = "<task-notification>\n<task-id>bq1</task-id>\n<summary>Agent finished</summary>\n</task-notification>";
  assert.equal(promptStep(note), "Agent finished");
  assert.equal(promptStep("<task-notification><task-id>x</task-id></task-notification>"), null);
  assert.equal(promptStep("<command-name>/compact</command-name>\n<command-message>compact</command-message>"), "/compact");
  assert.equal(promptStep("<system-reminder>noise</system-reminder>"), null);
  assert.equal(promptStep("fix the <b>bug</b> please"), "fix the bug please");
  assert.equal(promptStep("x".repeat(80)).length, 60);
});

test("a card is settled by the turn ending or by its own call running, nothing else", () => {
  const card = { requestId: "r", sessionId: "s", tool: "Bash", command: "npm test" };
  const claude = "integration_claude";
  const on = (name, over = {}) => {
    const e = { pill: claude, session: "s", tool: "Bash", target: "npm test", ...over };
    return settledElsewhere(over.card ?? card, name, e.pill, e.session, e.tool, e.target);
  };
  for (const name of ["Stop", "StopFailure", "UserPromptSubmit", "SessionEnd", "Interrupt"]) assert.ok(on(name), name);
  assert.ok(on("PostToolUse"));
  assert.ok(on("PostToolUseFailure"));
  assert.ok(!on("PreToolUse"));
  assert.ok(!on("PostToolUse", { target: "ls" }));
  assert.ok(!on("PostToolUse", { tool: "Read" }));
  assert.ok(!on("Stop", { pill: "agent_codex" }));
  assert.ok(!on("Stop", { session: "other" }));
  assert.ok(!on("Stop", { card: { ...card, remote: { device: "d", name: "n" } } }));
});
