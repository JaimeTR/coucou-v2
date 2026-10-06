// Cutting the microphone into utterances, WAV encoding and "Oye Mochi".
import test from "node:test";
import assert from "node:assert/strict";
import { Segmenter, encodeWav, downsample, matchWake } from "../.test-build/core/audio.js";

const RATE = 16000;
const frame = (level, n = 1600) => new Float32Array(n).fill(level);

function run(seg, plan) {
  const out = [];
  for (const [level, frames] of plan) {
    for (let i = 0; i < frames; i++) {
      const done = seg.push(frame(level));
      if (done) out.push(done);
    }
  }
  return out;
}

test("an utterance is cut out once the person stops, with a little sound from before", () => {
  const seg = new Segmenter({ sampleRate: RATE, preRollMs: 200, silenceMs: 500, minSpeechMs: 300 });
  const out = run(seg, [[0.001, 10], [0.3, 6], [0.001, 8]]);
  assert.equal(out.length, 1);
  // 6 loud frames + 5 quiet ones until the silence limit + pre-roll
  assert.ok(out[0].length >= 6 * 1600 && out[0].length <= 14 * 1600);
});

test("a click is not speech, and the room's noise is not either", () => {
  const seg = new Segmenter({ sampleRate: RATE, silenceMs: 400, minSpeechMs: 300 });
  assert.equal(run(seg, [[0.001, 5], [0.3, 1], [0.001, 8]]).length, 0, "100 ms is a click");
  assert.equal(run(seg, [[0.004, 40]]).length, 0, "a steady hum never triggers");
});

test("a very long utterance is cut at the limit", () => {
  const seg = new Segmenter({ sampleRate: RATE, maxMs: 1000, silenceMs: 500 });
  const out = run(seg, [[0.3, 25]]);
  assert.ok(out.length >= 2);
  assert.ok(out[0].length <= 1000 * 16 + 1600);
});

test("a WAV file has its header and the samples", () => {
  const wav = encodeWav(new Float32Array([0, 1, -1]), 16000);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
  assert.equal(wav.length, 44 + 3 * 2);
  const view = new DataView(wav.buffer);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getInt16(46, true), 32767);
  assert.equal(view.getInt16(48, true), -32768);
});

test("downsampling shrinks by the ratio", () => {
  assert.equal(downsample(new Float32Array(48000), 48000, 16000).length, 16000);
  assert.equal(downsample(new Float32Array(100), 16000, 16000).length, 100);
});

test("Oye Mochi is heard however Whisper writes it", () => {
  assert.equal(matchWake("Oye Mochi").heard, true);
  assert.equal(matchWake("Oye, Mochi.").heard, true);
  assert.equal(matchWake("hey mochi").heard, true);
  assert.equal(matchWake("Hola Mochi, ¿qué hora es?").heard, true);
  assert.equal(matchWake("el mochi está rico").heard, false);
  assert.equal(matchWake("Gracias por ver el vídeo").heard, false);
});

test("what follows the name becomes the question", () => {
  assert.equal(matchWake("Oye Mochi, ¿qué hora es?").rest, "qué hora es?");
  assert.equal(matchWake("oye mochi").rest, "");
});
