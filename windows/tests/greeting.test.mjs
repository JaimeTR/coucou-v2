// The words of the launch greeting.
import test from "node:test";
import assert from "node:assert/strict";
import { greetingLines, greetingStatus, fillTemplate, partOfDay, resolveLanguage, DEFAULT_TEMPLATE } from "../.test-build/greetingText.js";

const at = (h) => new Date(2026, 9, 5, h, 30); // Monday 5 October 2026

const base = { name: "Jaime Tarazona", template: DEFAULT_TEMPLATE, language: "es", systemLanguage: "es-ES" };

test("it greets by the full name, in Spanish", () => {
  const g = greetingLines({ ...base, now: at(15) });
  assert.equal(g.title, "Hola Jaime Tarazona");
  assert.match(g.sub, /^Buenas tardes · Lunes, 5 de octubre$/);
});

test("the part of the day follows the hour", () => {
  assert.equal(partOfDay(4), "night");
  assert.equal(partOfDay(5), "morning");
  assert.equal(partOfDay(11), "morning");
  assert.equal(partOfDay(12), "afternoon");
  assert.equal(partOfDay(18), "afternoon");
  assert.equal(partOfDay(19), "evening");
  assert.equal(partOfDay(23), "evening");
  assert.equal(partOfDay(0), "night");
  assert.match(greetingLines({ ...base, now: at(8) }).sub, /^Buenos días/);
  assert.match(greetingLines({ ...base, now: at(22) }).sub, /^Buenas noches/);
});

test("'auto' follows the system language, and the stock template follows it too", () => {
  assert.equal(resolveLanguage("auto", "es-PE"), "es");
  assert.equal(resolveLanguage("auto", "en-US"), "en");
  assert.equal(resolveLanguage("auto", "fr-FR"), "en");
  assert.equal(resolveLanguage("es", "en-US"), "es");
  const g = greetingLines({ ...base, language: "auto", systemLanguage: "en-US", now: at(9) });
  assert.equal(g.title, "Hello Jaime Tarazona");
  assert.match(g.sub, /^Good morning · Monday, October 5$/);
});

test("a template you wrote is left as written", () => {
  const g = greetingLines({ ...base, template: "¡Qué gusto verte, {name}!", language: "en", now: at(9) });
  assert.equal(g.title, "¡Qué gusto verte, Jaime Tarazona!");
});

test("without a name the greeting still reads well", () => {
  assert.equal(fillTemplate("Hola {name}", ""), "Hola");
  assert.equal(fillTemplate("Hola, {name}!", ""), "Hola!");
  assert.equal(fillTemplate("{name}, bienvenido", ""), "bienvenido");
  assert.equal(fillTemplate("", "Ana"), "Hola Ana");
  assert.equal(greetingLines({ ...base, name: "  ", now: at(9) }).title, "Hola");
});

test("the status line says whether Claude Code is connected and where you left off", () => {
  assert.equal(greetingStatus(undefined, "es"), "");
  assert.equal(
    greetingStatus({ claudeConnected: true, lastProject: "coucou" }, "es"),
    "Claude Code conectado · último proyecto: coucou",
  );
  assert.equal(greetingStatus({ claudeConnected: true }, "es"), "Claude Code conectado");
  assert.equal(greetingStatus({ claudeConnected: false, lastProject: "x" }, "es"), "Claude Code sin conectar · mira Ajustes");
  assert.equal(
    greetingStatus({ claudeConnected: true, lastProject: "app" }, "en"),
    "Claude Code connected · last project: app",
  );
  const g = greetingLines({ ...base, now: at(10), facts: { claudeConnected: true, lastProject: "coucou" } });
  assert.equal(g.status, "Claude Code conectado · último proyecto: coucou");
  assert.equal(greetingLines({ ...base, now: at(10) }).status, "");
});
