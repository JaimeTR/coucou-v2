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
