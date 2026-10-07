// Coucou sync — a Cloudflare Worker with one Durable Object per account.
//
// It links your computers and your phone: the settings you made on one, the
// live state of each computer's sessions, and the Allow / Deny you tap on the
// phone. Everything it holds is encrypted on the devices with a key derived
// from the account code, which never reaches the server: it stores opaque
// blobs and can read none of them.
//
// The account id and the bearer token are both derived from that code too
// (SHA-256 with different labels), so knowing the id is not enough to read or
// write: the first request claims the account with the token's hash.

export interface Env {
  ACCOUNT: DurableObjectNamespace;
  /** Where push messages go. Expo's service by default; a test points it elsewhere. */
  EXPO_PUSH_URL?: string;
}

const ID = /^[a-f0-9]{32}$/;
const DEVICE = /^[a-z0-9-]{1,40}$/;
const TOKEN = /^[a-f0-9]{64}$/;
const BLOB = /^[A-Za-z0-9+/=]+$/;
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,80}\]$/;
const EXPO_PUSH = "https://exp.host/--/api/v2/push/send";
/** A phone is not pinged more than once in this time per computer: a loop on a PC cannot flood it. */
const NOTIFY_EVERY_MS = 15_000;
const NOTIFY_KINDS = new Set(["approval", "question"]);

/** Bytes of base64 per kind of blob. */
const MAX = { settings: 96 * 1024, device: 48 * 1024, decision: 4 * 1024 };
/** A computer that has not reported for this long is dropped from the list. */
const DEVICE_TTL_MS = 7 * 24 * 3600 * 1000;
/** A decision nobody picked up is stale: the agent stopped waiting long ago. */
const DECISION_TTL_MS = 10 * 60 * 1000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    if (request.method === "GET" && url.pathname === "/") return cors(text(200, "Coucou sync"));

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "v1" || !ID.test(parts[1] ?? "")) return cors(text(404, "not found"));
    const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!TOKEN.test(token)) return cors(text(401, "no token"));

    const stub = env.ACCOUNT.get(env.ACCOUNT.idFromName(parts[1]));
    return cors(await stub.fetch(request));
  },
};

interface Stored {
  blob: string;
  at: number;
}

export class Account {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const [, , what, device] = url.pathname.split("/").filter(Boolean);
    const store = this.state.storage;

    // Claim on first use, then every request must carry the same token.
    const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const hash = await sha256hex(token);
    const claim = await store.get<string>("claim");
    if (claim === undefined) await store.put("claim", hash);
    else if (claim !== hash) return text(403, "wrong token");

    if (device !== undefined && !DEVICE.test(device)) return text(400, "bad device");
    const m = request.method;
    const now = Date.now();

    if (what === "settings" && device === undefined) {
      if (m === "GET") {
        const s = await store.get<Stored & { rev: number }>("settings");
        return s ? json(s) : text(404, "no settings yet");
      }
      if (m === "PUT") {
        const blob = await readBlob(request, MAX.settings);
        if (typeof blob !== "string") return blob;
        // ponytail: last writer wins; a merge per field if two machines fight over it.
        const prev = await store.get<{ rev: number }>("settings");
        const rev = (prev?.rev ?? 0) + 1;
        await store.put("settings", { rev, blob, at: now });
        return json({ rev });
      }
    }

    if (what === "devices") {
      if (m === "GET" && device === undefined) {
        const all = await store.list<Stored>({ prefix: "dev:" });
        const out: Array<Stored & { id: string }> = [];
        for (const [key, value] of all) {
          if (now - value.at > DEVICE_TTL_MS) await store.delete(key);
          else out.push({ id: key.slice(4), ...value });
        }
        return json(out);
      }
      if (m === "PUT" && device !== undefined) {
        const blob = await readBlob(request, MAX.device);
        if (typeof blob !== "string") return blob;
        await store.put(`dev:${device}`, { blob, at: now });
        return new Response(null, { status: 204 });
      }
      if (m === "DELETE" && device !== undefined) {
        await store.delete([`dev:${device}`, `dec:${device}`]);
        return new Response(null, { status: 204 });
      }
    }

    // The phone registers where to reach it (its Expo push token). The server reads
    // this one: it has to, to send. It never sees a command, a path or a project.
    if (what === "push" && device !== undefined) {
      if (m === "PUT") {
        let body: { token?: unknown };
        try {
          body = await request.json();
        } catch {
          return text(400, "bad json");
        }
        if (typeof body.token !== "string" || !EXPO_TOKEN.test(body.token)) return text(400, "bad token");
        await store.put(`push:${device}`, { token: body.token, at: now });
        return new Response(null, { status: 204 });
      }
      if (m === "DELETE") {
        await store.delete(`push:${device}`);
        return new Response(null, { status: 204 });
      }
    }

    // A computer asks to ping every registered phone: "Claude Code needs you".
    if (what === "notify" && device !== undefined && m === "POST") {
      let body: { kind?: unknown; title?: unknown; body?: unknown };
      try {
        body = await request.json();
      } catch {
        return text(400, "bad json");
      }
      const title = typeof body.title === "string" ? body.title.slice(0, 60) : "";
      const message = typeof body.body === "string" ? body.body.slice(0, 140) : "";
      if (typeof body.kind !== "string" || !NOTIFY_KINDS.has(body.kind) || !title || !message) return text(400, "bad notice");
      const lastKey = `last:${device}`;
      const last = (await store.get<number>(lastKey)) ?? 0;
      if (now - last < NOTIFY_EVERY_MS) return json({ sent: 0, reason: "too soon" });
      await store.put(lastKey, now);
      const phones = await store.list<{ token: string; at: number }>({ prefix: "push:" });
      const messages = [...phones.values()].map((p) => ({
        to: p.token,
        title,
        body: message,
        sound: "default",
        priority: "high",
        channelId: "approvals",
        data: { kind: body.kind, device },
      }));
      if (!messages.length) return json({ sent: 0, reason: "no phone" });
      let sent = 0;
      let status = 0;
      try {
        const res = await fetch(this.env.EXPO_PUSH_URL ?? EXPO_PUSH, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(messages),
        });
        const answer = (await res.json().catch(() => null)) as { data?: { status?: string; details?: { error?: string } }[] } | null;
        status = res.status;
        const keys = [...phones.keys()];
        answer?.data?.forEach((ticket, i) => {
          if (ticket.status === "ok") sent += 1;
          // The phone removed the app or the token: forget it, so it is not tried again.
          else if (ticket.details?.error === "DeviceNotRegistered") void store.delete(keys[i]);
        });
      } catch {
        return json({ sent: 0, reason: "push service unreachable" });
      }
      return json({ sent, status });
    }

    // Decisions go from the phone to one computer, which takes them once.
    if (what === "decisions" && device !== undefined) {
      const key = `dec:${device}`;
      if (m === "POST") {
        const blob = await readBlob(request, MAX.decision);
        if (typeof blob !== "string") return blob;
        const list = ((await store.get<Stored[]>(key)) ?? []).filter((d) => now - d.at < DECISION_TTL_MS);
        list.push({ blob, at: now });
        await store.put(key, list.slice(-20));
        return new Response(null, { status: 204 });
      }
      if (m === "GET") {
        const list = ((await store.get<Stored[]>(key)) ?? []).filter((d) => now - d.at < DECISION_TTL_MS);
        if (list.length) await store.delete(key);
        return json(list);
      }
    }

    return text(404, "not found");
  }
}

async function readBlob(request: Request, max: number): Promise<string | Response> {
  if (Number(request.headers.get("content-length") ?? "0") > max + 64) return text(413, "too large");
  let body: { blob?: unknown };
  try {
    body = await request.json();
  } catch {
    return text(400, "bad json");
  }
  const blob = body.blob;
  if (typeof blob !== "string" || blob.length === 0 || blob.length > max || !BLOB.test(blob)) {
    return text(400, "bad blob");
  }
  return blob;
}

async function sha256hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

/** The phone app may run in a browser preview (Expo web): let it call. */
function cors(response: Response): Response {
  const r = new Response(response.body, response);
  r.headers.set("access-control-allow-origin", "*");
  r.headers.set("access-control-allow-headers", "authorization, content-type");
  r.headers.set("access-control-allow-methods", "GET, PUT, POST, DELETE, OPTIONS");
  return r;
}
