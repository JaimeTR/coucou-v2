// What Mochi says aloud, and with which voice.
import test from "node:test";
import assert from "node:assert/strict";
import { pickVoice, speakable } from "../.test-build/core/voice.js";

test("markdown and code are not read out", () => {
  assert.equal(speakable("Hola **mundo**, mira `npm test`"), "Hola mundo, mira npm test");
  assert.equal(speakable("Antes\n```js\nconsole.log(1)\n```\nDespués"), "Antes Después");
  assert.equal(speakable("[la guía](https://x.y/z) es corta"), "la guía es corta");
});

test("a long reply is cut at the end of a sentence", () => {
  const long = "Primera frase. ".repeat(80);
  const said = speakable(long, 100);
  assert.ok(said.length <= 100);
  assert.ok(said.endsWith("."));
});

test("the best voice of the language is chosen", () => {
  const voices = [
    { lang: "en-US", name: "Microsoft David" },
    { lang: "es-ES", name: "Microsoft Helena" },
    { lang: "es-MX", name: "Microsoft Dalia Online (Natural)" },
  ];
  assert.equal(pickVoice(voices, "es").name, "Microsoft Dalia Online (Natural)");
  assert.equal(pickVoice(voices, "en").name, "Microsoft David");
  assert.equal(pickVoice([], "es"), null);
});
