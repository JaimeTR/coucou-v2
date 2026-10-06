// The left half of the welcome screen: what you left off with, and what needs
// you. Two rows at most — the welcome is for a glance, not for reading — and a
// row that has nothing to say is simply not there. Pure, so it can be tested.

/** Where a row leads when it is clicked. */
export type PendingTarget = "settings" | "github";

export interface PanelFacts {
  /** Claude Code's hooks are installed. */
  claudeConnected: boolean;
  /** The project you used Claude Code in last. */
  lastProject?: { name: string; path: string; lastActive: number } | null;
  /** The GitHub pulse, once the first poll has answered. */
  github?: { reviews: number; failing: number; copilot: number } | null;
}

export interface PanelRows {
  last: { name: string; path: string; ago: string } | null;
  pending: { text: string; target: PendingTarget } | null;
}

/** "ahora", "hace 5 min", "hace 2 h", "ayer", "hace 3 d" — how long ago, in Spanish. */
export function agoEs(unixSeconds: number, nowMs: number): string {
  if (!unixSeconds) return "";
  const seconds = Math.max(0, nowMs / 1000 - unixSeconds);
  if (seconds < 90) return "ahora";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "ayer" : `hace ${days} d`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function panelRows(facts: PanelFacts, nowMs: number): PanelRows {
  const project = facts.lastProject ?? null;
  const last = project
    ? { name: project.name, path: project.path, ago: agoEs(project.lastActive, nowMs) }
    : null;

  // Something to fix beats something to look at: an unconnected Claude Code first.
  if (!facts.claudeConnected) {
    return { last, pending: { text: "Falta conectar Claude Code", target: "settings" } };
  }
  const gh = facts.github;
  const parts: string[] = [];
  if (gh && gh.reviews > 0) parts.push(plural(gh.reviews, "revisión pedida", "revisiones pedidas"));
  if (gh && gh.failing > 0) parts.push(plural(gh.failing, "CI fallando", "CI fallando"));
  if (gh && gh.copilot > 0) parts.push(plural(gh.copilot, "PR de Copilot", "PRs de Copilot"));
  return { last, pending: parts.length > 0 ? { text: parts.join(" · "), target: "github" } : null };
}

/** Does the panel have anything to show? The welcome waits for it only if so. */
export function panelHasRows(rows: PanelRows): boolean {
  return rows.last != null || rows.pending != null;
}
