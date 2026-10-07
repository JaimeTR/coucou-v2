// Runs against `npm run dev` (http://127.0.0.1:8787), or SYNC_URL.
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const base = process.env.SYNC_URL ?? "http://127.0.0.1:8787";
const id = randomBytes(16).toString("hex");
const token = randomBytes(32).toString("hex");
const call = (path, { method = "GET", body, tok = token } = {}) =>
  fetch(`${base}/v1/${id}${path}`, {
    method,
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });

test("settings: claim, write, read, wrong token refused", async () => {
  assert.equal((await call("/settings")).status, 404);
  const put = await call("/settings", { method: "PUT", body: { blob: "QUJD" } });
  assert.equal((await put.json()).rev, 1);
  const got = await (await call("/settings")).json();
  assert.equal(got.blob, "QUJD");
  assert.equal((await call("/settings", { tok: randomBytes(32).toString("hex") })).status, 403);
  assert.equal((await call("/settings", { method: "PUT", body: { blob: "not base64!" } })).status, 400);
});

test("devices and decisions: listed, consumed once", async () => {
  assert.equal((await call("/devices/pc-casa", { method: "PUT", body: { blob: "UEM=" } })).status, 204);
  const list = await (await call("/devices")).json();
  assert.deepEqual(list.map((d) => d.id), ["pc-casa"]);
  assert.equal((await call("/decisions/pc-casa", { method: "POST", body: { blob: "WQ==" } })).status, 204);
  assert.equal((await (await call("/decisions/pc-casa")).json()).length, 1);
  assert.equal((await (await call("/decisions/pc-casa")).json()).length, 0);
  assert.equal((await call("/devices/BAD_ID", { method: "PUT", body: { blob: "UEM=" } })).status, 400);
});
