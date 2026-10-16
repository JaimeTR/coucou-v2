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
  assert.equal(s.tasks[0].source, "claudeCode");
  assert.equal(s.approval, null);
});

test("a waiting approval goes up without its rule, the command cut", () => {
  const s = remoteState("PC", [], { requestId: "r1", tool: "Bash", command: "x".repeat(900), rule: { secret: 1 } });
  assert.deepEqual(Object.keys(s.approval), ["requestId", "tool", "command"]);
  assert.equal(s.approval.command.length, 600);
});

import { waitingElsewhere, ONLINE_MS } from "../.test-build/island/remoteState.js";

const dev = (id, at, state) => ({ id, at, state });
const NOW = 1_000_000;

test("what waits on another computer that is on is offered; offline and answered ones are not", () => {
  const ask = { requestId: "r1", tool: "Bash", command: "ls" };
  const on = dev("laptop-1", NOW - 5_000, { name: "LAPTOP", approval: ask });
  assert.equal(waitingElsewhere([on], new Set(), NOW).kind, "approval");
  assert.equal(waitingElsewhere([on], new Set(), NOW).name, "LAPTOP");
  assert.equal(waitingElsewhere([dev("old", NOW - ONLINE_MS - 1, { approval: ask })], new Set(), NOW), null, "off");
  assert.equal(waitingElsewhere([on], new Set(["r1"]), NOW), null, "already answered here");
  const q = { requestId: "q1", questions: [] };
  assert.equal(waitingElsewhere([dev("b", NOW, { question: q })], new Set(), NOW).kind, "question");
});

test("the question and the music go up small", () => {
  const long = "x".repeat(900);
  const s = remoteState("PC", [], null, {
    question: { requestId: "q", questions: [{ question: long, header: long, multiSelect: false, options: Array.from({ length: 9 }, () => ({ label: long, description: long })) }] },
    music: { title: long, artist: "a" },
    mode: "game",
  });
  assert.equal(s.question.questions[0].options.length, 6);
  assert.equal(s.question.questions[0].question.length, 300);
  assert.equal(s.music.title.length, 100);
  assert.equal(s.mode, "game");
  assert.equal(remoteState("PC", [], null).question, null);
});
