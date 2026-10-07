// Weekly recap — port of RecapStore.swift. Each agent turn (prompt → Stop) is
// kept on this PC with its time, files, lines and commands, plus the Allow /
// Deny decisions; twelve weeks at most. On Monday the last week is summed up
// in a card. Nothing leaves the PC. Pure apart from `RecapRecorder`'s storage,
// which is handed in, so it can be tested.

export interface RecapTurn {
  pillId: string;
  project: string;
  start: number;
  end: number;
  files: number;
  added: number;
  removed: number;
  commands: number;
  questions: number;
}

export interface RecapDecision {
  pillId: string;
  at: number;
  decision: "allow" | "always" | "deny";
}

export interface RecapData {
  turns: RecapTurn[];
  decisions: RecapDecision[];
}

export interface WeeklySummary {
  weekStart: number;
  weekEnd: number;
  minutes: number;
  sessions: number;
  files: number;
  added: number;
  removed: number;
  commands: number;
  questions: number;
  allowed: number;
  denied: number;
  topAgent: string | null;
  topProject: string | null;
  /** 0 = Sunday … 6 = Saturday. */
  busiestDay: number | null;
  longestMinutes: number;
}

const DAY = 24 * 3600 * 1000;
const KEEP_MS = 12 * 7 * DAY;
/** A turn with no event for this long is dropped: the session died without a Stop. */
const STALE_MS = 6 * 3600 * 1000;
const COMMAND_TOOLS = new Set(["Bash", "PowerShell", "Execute", "mcp__ide__executeCode"]);

/** Monday 00:00 (local time) of the week before the one `now` is in. */
export function lastWeekStart(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - sinceMonday - 7);
  return d;
}

/** Year * 100 + ISO week number: one recap per week. */
export function isoWeekKey(now: Date): number {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3); // the Thursday of this week decides the year
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / DAY - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return d.getUTCFullYear() * 100 + week;
}

/** Wall-clock time spent, parallel sessions counted once. */
function mergedMs(turns: RecapTurn[]): number {
  const spans = turns.map((t) => [t.start, Math.max(t.start, t.end)] as const).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [s, e] = spans[0] ?? [0, 0];
  for (const [a, b] of spans.slice(1)) {
    if (a <= e) e = Math.max(e, b);
    else {
      total += e - s;
      [s, e] = [a, b];
    }
  }
  return total + (e - s);
}

function top<K>(items: K[]): K | null {
  const count = new Map<K, number>();
  for (const k of items) count.set(k, (count.get(k) ?? 0) + 1);
  let best: K | null = null;
  let n = 0;
  for (const [k, c] of count) if (c > n) [best, n] = [k, c];
  return best;
}

/** The week before `now` (Monday to Sunday), or null when nothing happened in it. */
export function weeklySummary(data: RecapData, now: Date, names: Record<string, string> = {}): WeeklySummary | null {
  const start = lastWeekStart(now).getTime();
  const endDate = new Date(start);
  endDate.setDate(endDate.getDate() + 7);
  const end = endDate.getTime();
  const turns = data.turns.filter((t) => t.start >= start && t.start < end);
  if (!turns.length) return null;
  const decisions = data.decisions.filter((d) => d.at >= start && d.at < end);
  const sum = (f: (t: RecapTurn) => number) => turns.reduce((n, t) => n + f(t), 0);
  const agent = top(turns.map((t) => t.pillId));
  return {
    weekStart: start,
    weekEnd: end - 1,
    minutes: Math.round(mergedMs(turns) / 60000),
    sessions: turns.length,
    files: sum((t) => t.files),
    added: sum((t) => t.added),
    removed: sum((t) => t.removed),
    commands: sum((t) => t.commands),
    questions: sum((t) => t.questions),
    allowed: decisions.filter((d) => d.decision !== "deny").length,
    denied: decisions.filter((d) => d.decision === "deny").length,
    topAgent: agent ? names[agent] ?? agent : null,
    topProject: top(turns.map((t) => t.project).filter(Boolean)),
    busiestDay: top(turns.map((t) => new Date(t.start).getDay())),
    longestMinutes: Math.round(Math.max(...turns.map((t) => t.end - t.start)) / 60000),
  };
}

/** Minutes of agent work started today (this PC's day), parallel sessions counted once. */
export function minutesToday(data: RecapData, now: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round(mergedMs(data.turns.filter((t) => t.start >= start && t.start <= now.getTime())) / 60000);
}

/** "45m", "2h", "3h 20m". */
export function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  return m % 60 === 0 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

interface Draft {
  pillId: string;
  project: string;
  start: number;
  last: number;
  paths: Set<string>;
  added: number;
  removed: number;
  commands: number;
  questions: number;
}

export interface RecapStorage {
  load(): RecapData | null;
  save(data: RecapData): void;
}

/** Turns hook events into recap turns, keyed by session. */
export class RecapRecorder {
  data: RecapData;
  private drafts = new Map<string, Draft>();

  constructor(private storage: RecapStorage, private now: () => number = Date.now) {
    const saved = storage.load();
    this.data = {
      turns: Array.isArray(saved?.turns) ? saved.turns : [],
      decisions: Array.isArray(saved?.decisions) ? saved.decisions : [],
    };
  }

  prompt(session: string, pillId: string, project: string) {
    const t = this.now();
    for (const [k, d] of this.drafts) if (t - d.last > STALE_MS) this.drafts.delete(k);
    const draft = this.drafts.get(session);
    if (draft) draft.last = t;
    else this.drafts.set(session, { pillId, project, start: t, last: t, paths: new Set(), added: 0, removed: 0, commands: 0, questions: 0 });
  }

  tool(session: string, tool: string) {
    const d = this.touch(session);
    if (d && COMMAND_TOOLS.has(tool)) d.commands += 1;
  }

  diff(session: string, path: string, added: number, removed: number) {
    const d = this.touch(session);
    if (!d) return;
    d.paths.add(path);
    d.added += added;
    d.removed += removed;
  }

  question(session: string) {
    const d = this.touch(session);
    if (d) d.questions += 1;
  }

  stop(session: string) {
    const d = this.drafts.get(session);
    if (!d) return;
    this.drafts.delete(session);
    this.data.turns.push({
      pillId: d.pillId, project: d.project, start: d.start, end: this.now(),
      files: d.paths.size, added: d.added, removed: d.removed, commands: d.commands, questions: d.questions,
    });
    this.persist();
  }

  end(session: string) {
    this.drafts.delete(session);
  }

  decision(pillId: string, decision: RecapDecision["decision"]) {
    this.data.decisions.push({ pillId, at: this.now(), decision });
    this.persist();
  }

  clear() {
    this.data = { turns: [], decisions: [] };
    this.drafts.clear();
    this.storage.save(this.data);
  }

  private touch(session: string): Draft | undefined {
    const d = this.drafts.get(session);
    if (d) d.last = this.now();
    return d;
  }

  private persist() {
    const cutoff = this.now() - KEEP_MS;
    this.data.turns = this.data.turns.filter((t) => t.start >= cutoff);
    this.data.decisions = this.data.decisions.filter((d) => d.at >= cutoff);
    this.storage.save(this.data);
  }
}
