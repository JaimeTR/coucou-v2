// The phone app's logic: JSON paths, GitHub, your own apps, and English.
import test from "node:test";
import assert from "node:assert/strict";
import { extract } from "../.test-build/extract.js";
import { parsePulse, attention, fetchPulse, GithubError } from "../.test-build/github.js";
import { sanitizeApps, readOnce, CustomError, CUSTOM_LIMIT } from "../.test-build/custom.js";
import { toEnglish, agoEs, partOfDayEs, resolveLanguage } from "../.test-build/translate.js";

test("a dotted path reads one value", () => {
  const v = { data: { open: 7, items: [{ name: "a" }, { name: "b" }], ok: true, nope: null } };
  assert.equal(extract(v, "data.open"), "7");
  assert.equal(extract(v, "data.items.1.name"), "b");
  assert.equal(extract(v, "data.ok"), "true");
  assert.equal(extract(v, "data.nope"), null);
  assert.equal(extract(v, "data.missing"), null);
  assert.equal(extract(v, "data.items.9"), null);
});

const node = (number, author, ci, reviewers = []) => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  isDraft: false,
  author: { login: author },
  repository: { nameWithOwner: "o/r" },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: ci } } }] },
  reviews: { nodes: reviewers.map((r) => ({ author: { login: r } })) },
});

test("Copilot's work is listed apart from the reviews asked of you", () => {
  const pulse = parsePulse({
    data: {
      mine: { nodes: [node(1, "jaime", "SUCCESS", ["copilot-pull-request-reviewer"]), node(2, "jaime", "FAILURE")] },
      review: { nodes: [node(10, "ana", "SUCCESS"), node(11, "Copilot", "SUCCESS")] },
      assigned: { nodes: [node(11, "Copilot", "SUCCESS"), node(12, "copilot-swe-agent", "FAILURE")] },
    },
  });
  assert.deepEqual(pulse.toReview.map((p) => p.number), [10]);
  assert.deepEqual(pulse.copilot.map((p) => p.number), [11, 12], "merged once each");
  assert.equal(pulse.copilotReviewedMine, 1);
  assert.deepEqual(attention(pulse), { reviews: 1, failing: 1, copilot: 2 });
});

test("GitHub's errors are explained", async () => {
  const answer = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });
  await assert.rejects(fetchPulse("x", answer(401, {})), GithubError);
  await assert.rejects(fetchPulse("x", answer(200, { errors: [{ message: "nope" }] })), /nope/);
  const ok = await fetchPulse("x", answer(200, { data: { mine: { nodes: [] }, review: { nodes: [] }, assigned: { nodes: [] } } }));
  assert.equal(ok.mine.length, 0);
});

test("your own apps are cleaned: bad ones dropped, values clamped", () => {
  const good = { id: "custom_ab12", name: "Mi API", color: "#22C55E", url: "https://x.y/z", path: "a.b", every: 5, authHeader: "X Bad", openUrl: "javascript:alert(1)" };
  const [app] = sanitizeApps([good, { ...good, id: "nope" }, { ...good, id: "custom_ab12" }, { ...good, id: "custom_u", url: "file:///etc" }]);
  assert.equal(sanitizeApps([good]).length, 1);
  assert.equal(app.every, 30);
  assert.equal(app.authHeader, "Authorization");
  assert.equal(app.openUrl, "");
  assert.equal(sanitizeApps(Array.from({ length: 20 }, (_, i) => ({ ...good, id: `custom_a${i}` }))).length, CUSTOM_LIMIT);
  assert.deepEqual(sanitizeApps("garbage"), []);
});

test("one reading of a URL", async () => {
  const app = sanitizeApps([{ id: "custom_t1", name: "T", color: "#000000", url: "https://x.y", path: "data.open", every: 60, authHeader: "Authorization", openUrl: "" }])[0];
  const seen = [];
  const fetcher = (status, body) => async (url, init) => {
    seen.push(init.headers);
    return { ok: status < 400, status, json: async () => body };
  };
  assert.equal(await readOnce(app, "tok", fetcher(200, { data: { open: 3 } })), "3");
  assert.equal(seen[0].Authorization, "Bearer tok");
  await assert.rejects(readOnce(app, null, fetcher(401, {})), /rechazado/);
  await assert.rejects(readOnce(app, null, fetcher(200, { data: {} })), CustomError);
  await assert.rejects(readOnce(app, null, async () => { throw new Error("offline"); }), /Sin conexión: offline/);
});

test("English comes from the dictionary, and unknown text is left alone", () => {
  assert.equal(toEnglish("Ajustes"), "Settings");
  assert.equal(toEnglish("Hola Jaime"), "Hello Jaime");
  assert.equal(toEnglish("hace 5 min"), "5 min ago");
  assert.equal(toEnglish("2 revisiones pedidas · 1 CI fallando · 1 PR de Copilot"), "2 reviews requested · 1 CI failing · 1 Copilot PR");
  assert.equal(toEnglish("Acceso rechazado (401). Revisa el token."), "Access refused (401). Check the token.");
  assert.equal(toEnglish("Algo que nadie tradujo"), "Algo que nadie tradujo");
  assert.equal(resolveLanguage("auto", "es-PE"), "es");
  assert.equal(resolveLanguage("auto", "en-US"), "en");
});

test("how long ago, and the part of the day", () => {
  const now = Date.UTC(2026, 9, 6, 12, 0, 0);
  assert.equal(agoEs("2026-10-06T11:55:00Z", now), "hace 5 min");
  assert.equal(agoEs("2026-10-06T09:00:00Z", now), "hace 3 h");
  assert.equal(agoEs("2026-10-05T08:00:00Z", now), "ayer");
  assert.equal(agoEs("", now), "");
  assert.equal(partOfDayEs(8), "Buenos días");
  assert.equal(partOfDayEs(15), "Buenas tardes");
  assert.equal(partOfDayEs(23), "Buenas noches");
});
