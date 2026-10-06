// "Abre Claude Code" is a command; "¿qué hora es?" goes to the chat.
import test from "node:test";
import assert from "node:assert/strict";
import { parseIntent } from "../.test-build/core/intent.js";

const launch = (target, extra = {}) => ({ kind: "launch", target, resume: false, terminal: false, ...extra });

test("opening a tool is a command", () => {
  assert.deepEqual(parseIntent("Abre Claude Code"), launch("claude"));
  assert.deepEqual(parseIntent("abre claude."), launch("claude"));
  assert.deepEqual(parseIntent("open code"), launch("opencode"));
  assert.deepEqual(parseIntent("Abre OpenCode"), launch("opencode"));
  assert.deepEqual(parseIntent("abre open code"), launch("opencode"));
  assert.deepEqual(parseIntent("Lanza Gemini"), launch("gemini"));
  assert.deepEqual(parseIntent("abre antigravity"), launch("antigravity"));
  assert.deepEqual(parseIntent("Abre Visual Studio Code"), launch("vscode"));
  assert.deepEqual(parseIntent("abre vs code"), launch("vscode"));
  assert.deepEqual(parseIntent("abre GitHub"), launch("github"));
  assert.deepEqual(parseIntent("abre los ajustes"), launch("settings"));
  assert.deepEqual(parseIntent("open Claude Code"), launch("claude"));
});

test("continuing and the terminal are noticed", () => {
  assert.deepEqual(parseIntent("Continúa con Claude Code"), launch("claude", { resume: true }));
  assert.deepEqual(parseIntent("abre OpenCode en la terminal"), launch("opencode", { terminal: true }));
});

test("anything else is a question for the chat", () => {
  assert.deepEqual(parseIntent("¿Qué hora es?"), { kind: "question", text: "¿Qué hora es?" });
  assert.deepEqual(parseIntent("Explícame qué es Claude Code"), { kind: "question", text: "Explícame qué es Claude Code" });
  assert.equal(parseIntent("cuéntame un chiste").kind, "question");
});
