import { test } from "node:test";
import assert from "node:assert/strict";
import { INTEGRATION_AGENTS, DEFAULT_SETTINGS } from "../.test-build/core/state.js";

test("the Mail pill is in the catalog with a stable id", () => {
  const mail = INTEGRATION_AGENTS.find((t) => t.id === "integration_mail_thunderbird");
  assert.ok(mail, "integration_mail_thunderbird is missing from INTEGRATION_AGENTS");
  assert.equal(mail.name, "Mail");
});

test("mailWatchedAccounts defaults to an empty list", () => {
  assert.deepEqual(DEFAULT_SETTINGS.mailWatchedAccounts, []);
});

import { shortDate, oneLine, highlightCode } from "../.test-build/views/mail.js";

test("shortDate reads a date, hiding the year when it's this year", () => {
  const thisYear = new Date().getFullYear();
  assert.match(shortDate(`${thisYear}-03-14T10:00:00Z`), /14 mar/i);
  assert.match(shortDate("2019-03-14T10:00:00Z"), /2019/);
});

test("shortDate on an empty or bad date returns an empty string, never throws", () => {
  assert.equal(shortDate(""), "");
  assert.equal(shortDate("not a date"), "");
});

test("oneLine collapses whitespace and cuts long text with an ellipsis", () => {
  assert.equal(oneLine("  hello   world  "), "hello world");
  assert.equal(oneLine("x".repeat(100), 10), "xxxxxxxxx…");
});

test("highlightCode wraps a code near a trigger word in <mark>, leaves the rest as plain text", () => {
  const html = highlightCode("Tu código es 482913. No lo compartas.");
  assert.equal(html, 'Tu código es <mark>482913</mark>. No lo compartas.');
});

test("highlightCode with no code present returns the text unchanged, HTML-escaped", () => {
  assert.equal(highlightCode("Hola <mundo> & adiós"), "Hola &lt;mundo&gt; &amp; adiós");
});
