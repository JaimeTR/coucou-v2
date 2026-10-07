// The phone link: same keys and same blobs as the desktop (windows/src-tauri/src/sync.rs).
import test from "node:test";
import assert from "node:assert/strict";
import { deriveKeys, seal, open, fetchComputers, sendDecision } from "../.test-build/link.js";

const CODE = "00112233-44556677-8899aabb-ccddeeff-00112233-44556677-8899aabb-ccddeeff";

test("the code gives the desktop's ids, however it is typed", () => {
  const k = deriveKeys(CODE);
  assert.equal(k.id, "b05514a88905b56bc0759045b144d6c6");
  assert.equal(k.token, "cab3e097264fc0b4d7179b27a269f895295d6caca26782931977a18759c37016");
  assert.equal(deriveKeys(CODE.replace(/-/g, "").toUpperCase()).id, k.id);
  assert.equal(deriveKeys("nope"), null);
  assert.equal(deriveKeys(CODE.slice(0, 60)), null);
});

test("sealed blobs open only with the same code", () => {
  const k = deriveKeys(CODE);
  const blob = seal(k, { a: 1 }, new Uint8Array(12).fill(7));
  assert.deepEqual(open(k, blob), { a: 1 });
  assert.equal(open(deriveKeys("f".repeat(64)), blob), null);
  assert.equal(open(k, "AAAA"), null);
});

test("computers are read from the server, unreadable ones skipped; a decision goes to one PC", async () => {
  const k = deriveKeys(CODE);
  const good = seal(k, { name: "JAIME-PC", tasks: [], approval: { requestId: "r1", tool: "Bash", command: "ls" } }, new Uint8Array(12));
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => [{ id: "pc-1", blob: good, at: 5 }, { id: "pc-2", blob: "AAAA", at: 9 }] };
  };
  const list = await fetchComputers(fetcher, "https://s.example/", k);
  assert.deepEqual(list.map((c) => c.name), ["JAIME-PC"]);
  assert.equal(calls[0].url, `https://s.example/v1/${k.id}/devices`);
  assert.equal(calls[0].init.headers.authorization, `Bearer ${k.token}`);

  await sendDecision(fetcher, "https://s.example", k, "pc-1", "r1", "allow", new Uint8Array(12), 42);
  const posted = JSON.parse(calls[1].init.body).blob;
  assert.deepEqual(open(k, posted), { requestId: "r1", decision: "allow", at: 42 });
  assert.equal(calls[1].url, `https://s.example/v1/${k.id}/decisions/pc-1`);
});

test("the PC's QR is accepted only if it points at an https server with a real code", async () => {
  const { parsePairing } = await import("../.test-build/link.js");
  const server = encodeURIComponent("https://coucou-sync.me.workers.dev");
  const ok = parsePairing(`coucou://pair?server=${server}&code=${CODE}`);
  assert.deepEqual(ok, { server: "https://coucou-sync.me.workers.dev", code: CODE });
  assert.ok(parsePairing(`coucou://pair?server=${encodeURIComponent("http://127.0.0.1:8787")}&code=${CODE}`), "a server on this machine is fine for development");
  assert.equal(parsePairing(`coucou://pair?server=${encodeURIComponent("http://evil.example")}&code=${CODE}`), null);
  assert.equal(parsePairing(`coucou://pair?server=${server}&code=1234`), null);
  assert.equal(parsePairing(`https://coucou-sync.me.workers.dev/?code=${CODE}`), null);
  assert.equal(parsePairing(`coucou://pair?server=%E0%A4%A&code=${CODE}`), null, "bad escapes are refused, not thrown");
});

test("push: only a real Expo token is registered, to this phone's own route, and it can be taken back", async () => {
  const { registerPush, isExpoToken } = await import("../.test-build/link.js");
  const k = deriveKeys(CODE);
  assert.ok(isExpoToken("ExponentPushToken[abcdefgh12345678]") && isExpoToken("ExpoPushToken[abcdefgh-1234_5678]"));
  assert.ok(!isExpoToken("https://evil.example") && !isExpoToken("ExponentPushToken[short]") && !isExpoToken("ExponentPushToken[a b c d e f g h]"));

  const calls = [];
  const fetcher = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 204, json: async () => ({}) }; };
  await registerPush(fetcher, "https://s.example/", k, "phone-ab12", "ExponentPushToken[abcdefgh12345678]");
  assert.equal(calls[0].url, `https://s.example/v1/${k.id}/push/phone-ab12`);
  assert.equal(calls[0].init.method, "PUT");
  assert.deepEqual(JSON.parse(calls[0].init.body), { token: "ExponentPushToken[abcdefgh12345678]" });
  assert.equal(calls[0].init.headers.authorization, `Bearer ${k.token}`);

  await registerPush(fetcher, "https://s.example", k, "phone-ab12", null);
  assert.equal(calls[1].init.method, "DELETE");

  await assert.rejects(() => registerPush(fetcher, "https://s.example", k, "p", "nope"), /no válido/);
  const refused = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(() => registerPush(refused, "https://s.example", k, "p", "ExponentPushToken[abcdefgh12345678]"), /no corresponde/);
});
