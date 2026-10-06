// Your own apps: a pill that checks an address every so often and shows one
// value out of its JSON answer. (On a phone nothing can listen for webhooks, so
// this is the polling half of the desktop's "Mis apps".)

import { extract } from "./extract";
import type { Fetcher } from "./github";

export interface CustomApp {
  /** "custom_" + lowercase letters and digits. */
  id: string;
  name: string;
  /** "#rrggbb" */
  color: string;
  url: string;
  /** Dotted path of the value inside the JSON; empty = the whole answer. */
  path: string;
  /** Seconds between checks (at least 30). */
  every: number;
  /** Header that carries the token; "Authorization" adds "Bearer " by itself. */
  authHeader: string;
  /** Opened when the card is tapped. */
  openUrl: string;
}

export const CUSTOM_LIMIT = 8;

const isWeb = (u: string) => u.startsWith("http://") || u.startsWith("https://");

/** Keeps only well-formed apps, so a bad value cannot reach a style or a header. */
export function sanitizeApps(list: unknown): CustomApp[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: CustomApp[] = [];
  for (const raw of list as Partial<CustomApp>[]) {
    const id = String(raw?.id ?? "");
    if (!/^custom_[a-z0-9]{1,24}$/.test(id) || seen.has(id)) continue;
    const name = String(raw?.name ?? "").trim().slice(0, 24);
    const url = String(raw?.url ?? "").trim();
    if (!name || !isWeb(url) || url.length > 500) continue;
    seen.add(id);
    const color = /^#[0-9a-fA-F]{6}$/.test(String(raw?.color)) ? String(raw.color) : "#8C8C8C";
    const header = String(raw?.authHeader ?? "");
    const openUrl = String(raw?.openUrl ?? "").trim();
    out.push({
      id,
      name,
      color,
      url,
      path: String(raw?.path ?? "").trim().slice(0, 120),
      every: Math.min(86_400, Math.max(30, Math.round(Number(raw?.every) || 120))),
      authHeader: /^[A-Za-z0-9-]{1,40}$/.test(header) ? header : "Authorization",
      openUrl: isWeb(openUrl) && openUrl.length <= 500 ? openUrl : "",
    });
    if (out.length >= CUSTOM_LIMIT) break;
  }
  return out;
}

export class CustomError extends Error {}

/** One reading: the value to show. Throws a CustomError that says what went wrong. */
export async function readOnce(app: CustomApp, token: string | null, fetcher: Fetcher): Promise<string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) {
    const bearer = app.authHeader.toLowerCase() === "authorization" && !token.toLowerCase().startsWith("bearer ");
    headers[app.authHeader] = bearer ? `Bearer ${token}` : token;
  }
  let response;
  try {
    response = await fetcher(app.url, { headers });
  } catch (err) {
    throw new CustomError(`Sin conexión: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new CustomError(`Acceso rechazado (${response.status}). Revisa el token.`);
  }
  if (response.status === 404) throw new CustomError("La dirección no existe (404).");
  if (!response.ok) throw new CustomError(`La dirección respondió ${response.status}.`);
  if (!app.path) {
    const text = await (response as unknown as { text(): Promise<string> }).text?.();
    return String(text ?? "").trim().slice(0, 80);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new CustomError("La respuesta no es JSON.");
  }
  const value = extract(json, app.path);
  if (value === null) throw new CustomError(`No hay nada en «${app.path}» dentro de la respuesta.`);
  return value;
}
