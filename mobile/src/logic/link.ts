// The link to your computers, through your own sync server (sync/ at the repo
// root). Same scheme as the desktop (windows/src-tauri/src/sync.rs), byte for
// byte: from the 64-hex account code come, with SHA-256 and a label each, the
// account id, the bearer token and the AES-256-GCM key. The server only ever
// sees blobs it cannot read. Pure: the random nonce and fetch are passed in.

import { gcm } from "@noble/ciphers/aes";
import { bytesToUtf8, utf8ToBytes } from "@noble/ciphers/utils";
import { sha256 } from "@noble/hashes/sha256";

/** https only, except a server running on this machine while developing. */
export const isServerUrl = (u: string) => /^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)[:/])/.test(u.trim());

/**
 * What the PC's QR holds: coucou://pair?server=<address>&code=<code>. Anything
 * else (a web page, a wrong code, a server that is not https) is refused, so a
 * QR from somewhere else cannot point the phone at a stranger's server.
 */
export function parsePairing(text: string): { server: string; code: string } | null {
  const m = /^coucou:\/\/pair\?(.*)$/.exec(text.trim());
  if (!m) return null;
  const params: Record<string, string> = {};
  for (const part of m[1].split("&")) {
    const [k, v = ""] = part.split("=");
    try {
      params[k] = decodeURIComponent(v);
    } catch {
      return null;
    }
  }
  const server = (params.server ?? "").trim();
  const code = (params.code ?? "").trim();
  return isServerUrl(server) && deriveKeys(code) ? { server, code } : null;
}

export interface Keys {
  id: string;
  token: string;
  key: Uint8Array;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function labelled(label: string, secret: Uint8Array): Uint8Array {
  const l = utf8ToBytes(label);
  const all = new Uint8Array(l.length + secret.length);
  all.set(l);
  all.set(secret, l.length);
  return sha256(all);
}

/** The code as typed or scanned: 64 hex digits, dashes and spaces allowed. */
export function deriveKeys(code: string): Keys | null {
  if (/[^0-9a-fA-F\s-]/.test(code)) return null;
  const digits = code.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (digits.length !== 64) return null;
  const secret = new Uint8Array(32);
  for (let i = 0; i < 32; i++) secret[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16);
  return {
    id: hex(labelled("coucou-id:", secret)).slice(0, 32),
    token: hex(labelled("coucou-auth:", secret)),
    key: labelled("coucou-key:", secret),
  };
}

// Standard base64, by hand: the phone's engine and the test runner disagree on atob/btoa.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function toB64(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < b.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < b.length ? B64[n & 63] : "=";
  }
  return out;
}

function fromB64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, "");
  const out: number[] = [];
  let bits = 0;
  let acc = 0;
  for (const c of clean) {
    const v = B64.indexOf(c);
    if (v < 0) throw new Error("bad base64");
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
    }
  }
  return Uint8Array.from(out);
}

/** base64(nonce ‖ ciphertext+tag), like the desktop. `nonce` must be 12 random bytes. */
export function seal(keys: Keys, value: unknown, nonce: Uint8Array): string {
  const ct = gcm(keys.key, nonce).encrypt(utf8ToBytes(JSON.stringify(value)));
  const out = new Uint8Array(12 + ct.length);
  out.set(nonce);
  out.set(ct, 12);
  return toB64(out);
}

export function open<T = unknown>(keys: Keys, blob: string): T | null {
  try {
    const raw = fromB64(blob);
    if (raw.length < 28) return null;
    return JSON.parse(bytesToUtf8(gcm(keys.key, raw.slice(0, 12)).decrypt(raw.slice(12)))) as T;
  } catch {
    return null;
  }
}

// ── What the computers say (windows/src/island/remoteState.ts) ─────────────────

export interface RemoteTask {
  id: string;
  name: string;
  color: string;
  state: string;
  step: string;
  project: string;
}

export interface Computer {
  id: string;
  /** When it last reported (ms). */
  at: number;
  name: string;
  tasks: RemoteTask[];
  approval: { requestId: string; tool: string; command: string } | null;
}

type Fetch = (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const url = (server: string, keys: Keys, path: string) => `${server.replace(/\/+$/, "")}/v1/${keys.id}/${path}`;
const auth = (keys: Keys) => ({ authorization: `Bearer ${keys.token}`, "content-type": "application/json" });

function problem(status: number): string {
  if (status === 403) return "Ese código no corresponde a esta cuenta.";
  if (status === 404) return "No hay nada con ese código todavía.";
  return `El servidor respondió ${status}.`;
}

export async function fetchComputers(fetcher: Fetch, server: string, keys: Keys): Promise<Computer[]> {
  const res = await fetcher(url(server, keys, "devices"), { headers: auth(keys) });
  if (!res.ok) throw new Error(problem(res.status));
  const list = (await res.json()) as { id: string; blob: string; at: number }[];
  const out: Computer[] = [];
  for (const d of list) {
    const state = open<Omit<Computer, "id" | "at">>(keys, d.blob);
    if (!state || !Array.isArray(state.tasks)) continue;
    out.push({ id: d.id, at: d.at, name: String(state.name ?? d.id), tasks: state.tasks, approval: state.approval ?? null });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** The shared settings the computers wrote (name, language…), or null. */
export async function fetchSharedSettings(fetcher: Fetch, server: string, keys: Keys): Promise<Record<string, unknown> | null> {
  const res = await fetcher(url(server, keys, "settings"), { headers: auth(keys) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(problem(res.status));
  const body = (await res.json()) as { blob?: string };
  return body.blob ? open<Record<string, unknown>>(keys, body.blob) : null;
}

/** A tap on Allow / Deny. The computer applies it only to the card it still shows. */
export async function sendDecision(
  fetcher: Fetch, server: string, keys: Keys, device: string,
  requestId: string, decision: "allow" | "deny", nonce: Uint8Array, now = Date.now(),
): Promise<void> {
  const blob = seal(keys, { requestId, decision, at: now }, nonce);
  const res = await fetcher(url(server, keys, `decisions/${encodeURIComponent(device)}`), {
    method: "POST",
    headers: auth(keys),
    body: JSON.stringify({ blob }),
  });
  if (!res.ok) throw new Error(problem(res.status));
}
