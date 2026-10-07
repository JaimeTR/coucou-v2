// What this PC tells the phone.
import test from "node:test";
import assert from "node:assert/strict";
import { remoteState } from "../.test-build/island/remoteState.js";

const task = (over) => ({
  id: "integration_claude", name: "Claude Code", color: "#D97757", state: "working",
  steps: ["Lee main.rs", "Edita lib.rs"], stepIndex: 1, source: "claudeCode", isIntegration: false,
  sessionCwd: "C:\\Users\\Jaime\\proyectos\\coucou", ...over,
});

test("agents go up with their step and project; integrations and idle ones stay home", () => {
  const s = remoteState("JAIME-PC", [
    task({}),
    task({ id: "integration_github", source: "n8n" }),
    task({ id: "agent_gemini", state: "idle", source: "agent" }),
  ], null);
  assert.equal(s.name, "JAIME-PC");
  assert.deepEqual(s.tasks.map((t) => t.id), ["integration_claude"]);
  assert.equal(s.tasks[0].step, "Edita lib.rs");
  assert.equal(s.tasks[0].project, "coucou");
  assert.equal(s.approval, null);
});

test("a waiting approval goes up without its rule, the command cut", () => {
  const s = remoteState("PC", [], { requestId: "r1", tool: "Bash", command: "x".repeat(900), rule: { secret: 1 } });
  assert.deepEqual(Object.keys(s.approval), ["requestId", "tool", "command"]);
  assert.equal(s.approval.command.length, 600);
});
