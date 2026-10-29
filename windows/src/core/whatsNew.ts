// A new version waits, and what a new version brings — the pure half of
// island/updates.ts, so it can be tested. From the original Coucou's Windows
// 0.5.2: Mochi wears a blue arrow while a newer Coucou waits ("Later" hides it
// for a day), and once Coucou updated itself the island shows, once, what the
// new version brings and what you did with Coucou so far.

import type { RecapData } from "../island/recap";

/** "Más tarde" on the update card: which version, and when. */
export interface Later {
  version: string;
  at: number;
}

export const LATER_MS = 24 * 3600 * 1000;

/** True when `a` is a newer version than `b` ("1.10.0" > "1.9.2"; anything after "-" is ignored). */
export function isNewer(a: string, b: string): boolean {
  const parts = (v: string) => v.trim().replace(/^v/i, "").split("-")[0].split(".").map((n) => Number.parseInt(n, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** Whether Mochi wears the blue arrow: a version waits, and "Más tarde" for it is over a day old. */
export function updateWaiting(version: string | null, later: Later | null, now: number): boolean {
  if (!version) return false;
  if (later && later.version === version && now - later.at < LATER_MS) return false;
  return true;
}

/** "What's new" shows once, on the first launch of a newer version (not on a first install). */
export function showWhatsNew(previous: string | null, current: string): boolean {
  return previous != null && previous !== "" && isNewer(current, previous);
}

/**
 * The highlights of each version, at most three short lines each. A version
 * with nothing here shows only "Tu Coucou hasta ahora".
 */
export const WHATS_NEW: Record<string, string[]> = {
  "1.6.0": [
    "GitLab y Gitea: pills como la de GitHub, para gitlab.com o tu instancia.",
    "Una flecha azul en Mochi cuando hay versión nueva (con «Solo avisar»).",
    "Reloj opcional en la isla compacta; las preguntas de Antigravity avisan.",
  ],
};

export interface SoFar {
  sessions: number;
  minutes: number;
  lines: number;
  approvals: number;
}

/** What the recap kept (the last twelve weeks, on this computer only), added up. */
export function soFar(data: RecapData): SoFar {
  let minutes = 0;
  let lines = 0;
  for (const t of data.turns) {
    minutes += Math.max(0, (t.end - t.start) / 60_000);
    lines += Math.max(0, t.added);
  }
  return {
    sessions: data.turns.length,
    minutes: Math.round(minutes),
    lines,
    approvals: data.decisions.filter((d) => d.decision !== "deny").length,
  };
}

/** One line for the card, or null when there is nothing yet to count. */
export function soFarLine(s: SoFar, lang: "es" | "en" = "es"): string | null {
  if (s.sessions === 0 && s.approvals === 0) return null;
  const es = lang === "es";
  const time = s.minutes >= 60 ? `${Math.floor(s.minutes / 60)} h ${s.minutes % 60} min` : `${s.minutes} min`;
  const plural = (n: number, one: string, many: string) => `${n.toLocaleString(lang)} ${n === 1 ? one : many}`;
  const bits = [es ? plural(s.sessions, "sesión", "sesiones") : plural(s.sessions, "session", "sessions"), time];
  if (s.lines > 0) bits.push(es ? plural(s.lines, "línea", "líneas") : plural(s.lines, "line", "lines"));
  if (s.approvals > 0) {
    bits.push(es ? `${plural(s.approvals, "aprobación", "aprobaciones")} desde la isla` : `${plural(s.approvals, "approval", "approvals")} from the island`);
  }
  return bits.join(" · ");
}
