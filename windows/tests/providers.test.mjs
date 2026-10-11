// The chat's AI switch: it moves on to the next one that can answer, and wraps round.
import test from "node:test";
import assert from "node:assert/strict";
import { CHAT_PROVIDERS, nextProvider, providerLabel } from "../.test-build/core/providers.js";

test("it goes to the next provider that has a key, wrapping round", () => {
  const usable = new Set(["anthropic", "groq", "local"]);
  assert.equal(nextProvider("anthropic", usable), "groq");
  assert.equal(nextProvider("groq", usable), "local");
  assert.equal(nextProvider("local", usable), "anthropic");
});

test("with nothing else usable it stays where it is", () => {
  assert.equal(nextProvider("gemini", new Set(["gemini"])), "gemini");
  assert.equal(nextProvider("gemini", new Set()), "gemini");
});

test("every provider the chat can use is on the switch, and only local works without a key", () => {
  const ids = CHAT_PROVIDERS.map((p) => p.id);
  assert.deepEqual(ids, ["anthropic", "devmark", "gemini", "groq", "openai", "openrouter", "local"]);
  assert.deepEqual(CHAT_PROVIDERS.filter((p) => p.key == null).map((p) => p.id), ["local"]);
});

test("the label says who answers and with which model", () => {
  const s = { chatProvider: "openai", openaiModel: "gpt-4o", model: "claude-x", localModel: "" };
  assert.equal(providerLabel(s), "OpenAI · gpt-4o");
  assert.equal(providerLabel({ ...s, chatProvider: "local" }), "Modelo local");
  assert.equal(providerLabel({ ...s, chatProvider: "anthropic" }), "Claude · claude-x");
});
