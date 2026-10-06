// Spanish → English for the interface text.
import test from "node:test";
import assert from "node:assert/strict";
import { toEnglish } from "../.test-build/core/translate.js";

test("known strings are translated, unknown ones left alone", () => {
  assert.equal(toEnglish("Permitir"), "Allow");
  assert.equal(toEnglish("Denegar"), "Deny");
  assert.equal(toEnglish("Texto que nadie tradujo"), "Texto que nadie tradujo");
  assert.equal(toEnglish("npm test"), "npm test");
});

test("whitespace around a string is kept", () => {
  assert.equal(toEnglish("  Permitir "), "  Allow ");
});

test("strings with variable parts are matched as patterns", () => {
  assert.equal(toEnglish("Abrir Claude Code"), "Open Claude Code");
  assert.equal(toEnglish("Chat con Gemini"), "Chat with Gemini");
  assert.equal(toEnglish("hace 5 min"), "5 min ago");
  assert.equal(toEnglish("Permitir siempre: git status"), "Always allow: git status");
  assert.equal(toEnglish("Ejecuta npm test"), "Runs npm test");
});

test("the most specific pattern wins", () => {
  assert.equal(toEnglish("Abrir OpenCode en coucou"), "Open OpenCode in coucou");
});

test("joined pieces are translated one by one", () => {
  assert.equal(
    toEnglish("2 revisiones pedidas · 1 CI fallando · 1 PR de Copilot"),
    "2 reviews requested · 1 CI failing · 1 Copilot PR",
  );
  assert.equal(toEnglish("coucou · hace 2 h"), "coucou · 2 h ago");
});

test("provider errors read well in English", () => {
  assert.equal(
    toEnglish("Groq rechazó la clave de API (401). Revísala en Ajustes."),
    "Groq rejected the API key (401). Check it in Settings.",
  );
});

test("English never gets translated twice", () => {
  assert.equal(toEnglish("Allow"), "Allow");
  assert.equal(toEnglish("Open Claude Code"), "Open Claude Code");
});
