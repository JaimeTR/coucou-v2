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

// ── Push ─────────────────────────────────────────────────────────────────────
// Needs the worker started with: wrangler dev --var EXPO_PUSH_URL:http://127.0.0.1:9998/
import { createServer } from "node:http";

test("push: a phone registers, a computer pings it, the push service gets a message with no secrets", async () => {
  const received = [];
  const expo = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const messages = JSON.parse(body);
      received.push(...messages);
      res.setHeader("content-type", "application/json");
      // The second phone has uninstalled the app.
      res.end(JSON.stringify({ data: messages.map((m) => (m.to.includes("Gone") ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok", id: "x" })) }));
    });
  }).listen(9998, "127.0.0.1");
  try {
    const good = "ExponentPushToken[abcdefgh12345678]";
    assert.equal((await call("/push/iphone-1", { method: "PUT", body: { token: good } })).status, 204);
    assert.equal((await call("/push/old-phone", { method: "PUT", body: { token: "ExponentPushToken[Gone-gone-gone1]" } })).status, 204);
    assert.equal((await call("/push/x", { method: "PUT", body: { token: "https://evil.example" } })).status, 400, "only an Expo token");

    const ping = { kind: "approval", title: "Coucou", body: "Claude Code pide permiso en JAIME-PC" };
    const first = await (await call("/notify/jaime-pc", { method: "POST", body: ping })).json();
    assert.equal(first.sent, 1, "one phone reached");
    assert.equal(received.length, 2);
    assert.deepEqual(Object.keys(received[0].data).sort(), ["device", "kind"], "no command, path or project goes to the push service");
    assert.equal(received[0].title, "Coucou");

    // A loop on the PC cannot flood the phone.
    const again = await (await call("/notify/jaime-pc", { method: "POST", body: ping })).json();
    assert.equal(again.sent, 0);
    assert.equal(again.reason, "too soon");

    // The uninstalled phone was forgotten: another computer pings only the good one.
    const other = await (await call("/notify/laptop", { method: "POST", body: ping })).json();
    assert.equal(other.sent, 1);
    assert.equal(received.length, 3);

    assert.equal((await call("/notify/laptop", { method: "POST", body: { kind: "rm -rf", title: "x", body: "y" } })).status, 400);
    assert.equal((await call("/notify/laptop", { method: "POST", body: { kind: "approval", title: "", body: "y" } })).status, 400);
    assert.equal((await call("/push/iphone-1", { method: "DELETE" })).status, 204);
    assert.equal((await (await call("/notify/third-pc", { method: "POST", body: ping })).json()).reason, "no phone");
  } finally {
    expo.close();
  }
});
