// GitHub pulse and contribution grid — the pure half of the GitHub card.
// Spanish strings; English via core/translate's toEnglish(). No DOM here.

export type CIState = "pending" | "success" | "failure" | "unknown";
export type ReviewState = "approved" | "changesRequested" | "pending" | "unknown";
export type GitHubSection = "myPRs" | "toReview" | "mainCI" | "activity";

export interface GitHubPR {
  id: string;
  title: string;
  url: string;
  repo: string;
  number: number;
  isDraft: boolean;
  ci: CIState;
  review: ReviewState;
  headSha: string | null;
}

export interface GitHubRepoCI {
  repo: string;
  url: string;
  branch: string;
  ci: CIState;
  headSha: string | null;
}

export interface GitHubPulse {
  login: string;
  myPRs: GitHubPR[];
  toReview: GitHubPR[];
  mainCI: GitHubRepoCI[];
  fetchedAt: number;
}

export interface ContributionDay {
  date: string;
  count: number;
  level: number;
  weekday: number;
}

export interface GitHubActivity {
  total: number;
  weeks: ContributionDay[][];
  fetchedAt: number;
}

export interface GitHubStats {
  totalRepos: number;
  totalStars: number;
}

export type GitHubEvent =
  | { kind: "ciFailed"; prId: string }
  | { kind: "ciPassed"; prId: string }
  | { kind: "mainFailed"; repo: string }
  | { kind: "reviewRequested"; prId: string };

export const GH_STRINGS = {
  title: "GitHub",
  get overview() { return "Resumen"; },
  get totalStars() { return "Total estrellas"; },
  get repositories() { return "Repositorios"; },
  get myPRs() { return "Mis PRs"; },
  get toReview() { return "Por revisar"; },
  get mainCI() { return "CI rama principal"; },
  get activity() { return "Actividad"; },
  get nothingHere() { return "No hay nada"; },
  get loading() { return "Cargando…"; },
  get draft() { return "Borrador"; },
  get failing() { return "fallando"; },
  get running() { return "ejecutándose"; },
  get passing() { return "pasando"; },
  get allGreen() { return "todo verde"; },
  get noRepos() { return "sin repos"; },
  get unknown() { return "desconocido"; },
  get noContributions() { return "Sin contribuciones"; },
  oneContribution: "{count} contribución",
  contributions: (n: number) => n === 1 ? "{count} contribución" : "{count} contribuciones",
  pastYear: (total: string) => `{total} el último año`,
  repos: (n: number) => n === 1 ? "{count} repo" : "{count} repos",
};

export const CI_COLORS: Record<CIState, string> = {
  failure: "#F4505E",
  pending: "#F5A524",
  success: "#22C55E",
  unknown: "#6B7079",
};

export function contributionColor(level: number): string {
  switch (level) {
    case 1: return "#0E4429";
    case 2: return "#006D32";
    case 3: return "#26A641";
    case 4: return "#39D353";
    default: return "rgba(255,255,255,0.06)";
  }
}

// ── Alerts ────────────────────────────────────────────────────────────────────

export interface GitHubAlert {
  badge: "error" | "finished";
  sound: "error" | "question" | "finish";
}

/** handleGitHubEvents: the loudest event wins — red CI > review request > green CI. */
export function gitHubAlert(events: GitHubEvent[]): GitHubAlert | null {
  let level = 0;
  let alert: GitHubAlert | null = null;
  for (const e of events) {
    switch (e.kind) {
      case "ciFailed":
      case "mainFailed":
        if (level < 3) { level = 3; alert = { badge: "error", sound: "error" }; }
        break;
      case "reviewRequested":
        if (level < 2) { level = 2; alert = { badge: "finished", sound: "question" }; }
        break;
      case "ciPassed":
        if (level < 1) { level = 1; alert = { badge: "finished", sound: "finish" }; }
        break;
    }
  }
  return alert;
}

// ── Contribution grid ─────────────────────────────────────────────────────────

/** 7 pt squares, 1.5 pt apart, in the 202 pt the card has: 23 weeks. */
export const GRID_SQUARE = 7;
export const GRID_GAP = 1.5;
export const GRID_WEEKS = Math.floor((202 + GRID_GAP) / (GRID_SQUARE + GRID_GAP));

/** The last `n` weeks, oldest first; the last may be incomplete. */
export function lastWeeks(activity: GitHubActivity, n: number): ContributionDay[][] {
  if (n <= 0) return [];
  return activity.weeks.slice(Math.max(0, activity.weeks.length - n));
}

/** The last `n` days, oldest first. */
export function lastDays(activity: GitHubActivity, n: number): ContributionDay[] {
  if (n <= 0) return [];
  const all = activity.weeks.flat();
  return all.slice(Math.max(0, all.length - n));
}

/** One column of the grid: seven slots, Sunday first, null where a day is missing. */
export function weekColumn(week: ContributionDay[]): (ContributionDay | null)[] {
  return Array.from({ length: 7 }, (_, dow) =>
    week.find((d) => d.weekday === dow) ?? null);
}

/** "2026-01-05" → "5 ene"; anything else is returned as is. */
export function dayLabel(date: string): string {
  const parts = date.split("-");
  if (parts.length !== 3) return date;
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day)) return date;
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${day} ${months[month - 1]}`;
}

export function contributionsLabel(count: number): string {
  if (count === 0) return GH_STRINGS.noContributions;
  if (count === 1) return GH_STRINGS.oneContribution;
  return GH_STRINGS.contributions(count).replace("{count}", String(count));
}

/** 1234 → "1,234", whatever the system locale. */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** Right side of the Activity header: the picked day, or the year's total. */
export function activityHeader(
  activity: GitHubActivity | null,
  stats: GitHubStats | null,
  picked: ContributionDay | null,
): string {
  if (picked) return `${dayLabel(picked.date)} · ${contributionsLabel(picked.count)}`;
  if (!activity) return "";
  const total = GH_STRINGS.pastYear.replace("{total}", totalLabel(activity.total));
  return stats ? `${total} · ${GH_STRINGS.repos(stats.totalRepos).replace("{count}", String(stats.totalRepos))}` : total;
}

// ── Derived values for the card ───────────────────────────────────────────────

export function worstCI(cis: CIState[]): CIState {
  if (cis.includes("failure")) return "failure";
  if (cis.includes("pending")) return "pending";
  if (cis.includes("success")) return "success";
  return "unknown";
}

export function myPRsValue(prs: GitHubPR[]): string {
  const n = prs.length;
  const drafts = prs.filter(p => p.isDraft).length;
  if (n === 0) return "0";
  return drafts > 0 ? `${n} (${drafts} borrador${drafts > 1 ? "es" : ""})` : String(n);
}

export function mainCISummary(mainCI: GitHubRepoCI[]): string {
  const failing = mainCI.filter(c => c.ci === "failure").length;
  if (failing > 0) return `${failing} fallando`;
  const pending = mainCI.filter(c => c.ci === "pending").length;
  if (pending > 0) return `${pending} ejecutándose`;
  return mainCI.length > 0 ? "todo verde" : "sin repos";
}

export function sectionTitle(section: GitHubSection): string {
  switch (section) {
    case "myPRs": return "Mis PRs";
    case "toReview": return "Por revisar";
    case "mainCI": return "CI rama principal";
    case "activity": return "Actividad";
  }
}

export function shortRepo(repoUrl: string): string {
  try {
    const u = new URL(repoUrl);
    return u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "");
  } catch { return repoUrl; }
}

export function safeGitHubUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.hostname !== "github.com") return null;
    return url;
  } catch { return null; }
}

export function actionsUrl(repoUrl: string): string {
  return repoUrl.endsWith("/") ? `${repoUrl}actions` : `${repoUrl}/actions`;
}

export function profileUrl(login: string): string {
  return `https://github.com/${encodeURIComponent(login)}`;
}

// ── Reading what Rust sent ────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v != null;

export function readPulse(data: Record<string, unknown>): GitHubPulse | null {
  const p = data.pulse;
  if (!isObj(p)) return null;
  const login = typeof p.login === "string" ? p.login : "";
  const myPRs = readPRs(p.myPRs);
  const toReview = readPRs(p.toReview);
  const mainCI = readRepoCI(p.mainCI);
  const fetchedAt = typeof p.fetchedAt === "number" ? p.fetchedAt : 0;
  return { login, myPRs, toReview, mainCI, fetchedAt };
}

function readPRs(v: unknown): GitHubPR[] {
  if (!Array.isArray(v)) return [];
  return v.map(readPR).filter(Boolean) as GitHubPR[];
}

function readPR(v: unknown): GitHubPR | null {
  if (!isObj(v)) return null;
  const id = typeof v.id === "string" ? v.id : "";
  const title = typeof v.title === "string" ? v.title : "";
  const url = typeof v.url === "string" ? v.url : "";
  const repo = typeof v.repo === "string" ? v.repo : "";
  const number = typeof v.number === "number" ? v.number : 0;
  const isDraft = typeof v.isDraft === "boolean" ? v.isDraft : false;
  const ci = readCI(v.ci);
  const review = readReview(v.review);
  const headSha = typeof v.headSha === "string" ? v.headSha : null;
  return { id, title, url, repo, number, isDraft, ci, review, headSha };
}

function readRepoCI(v: unknown): GitHubRepoCI[] {
  if (!Array.isArray(v)) return [];
  return v.map(readRepoCISingle).filter(Boolean) as GitHubRepoCI[];
}

function readRepoCISingle(v: unknown): GitHubRepoCI | null {
  if (!isObj(v)) return null;
  const repo = typeof v.repo === "string" ? v.repo : "";
  const url = typeof v.url === "string" ? v.url : "";
  const branch = typeof v.branch === "string" ? v.branch : "";
  const ci = readCI(v.ci);
  const headSha = typeof v.headSha === "string" ? v.headSha : null;
  return { repo, url, branch, ci, headSha };
}

function readCI(v: unknown): CIState {
  if (typeof v !== "string") return "unknown";
  switch (v.toLowerCase()) {
    case "success": return "success";
    case "failure": case "error": return "failure";
    case "pending": case "expected": return "pending";
    default: return "unknown";
  }
}

function readReview(v: unknown): ReviewState {
  if (typeof v !== "string") return "unknown";
  switch (v.toLowerCase()) {
    case "approved": return "approved";
    case "changes_requested": return "changesRequested";
    case "review_required": return "pending";
    default: return "unknown";
  }
}

export function readActivity(data: Record<string, unknown>): GitHubActivity | null {
  const c = data.contributionsCollection;
  if (!isObj(c)) return null;
  const cal = c.contributionCalendar;
  if (!isObj(cal)) return null;
  const total = typeof cal.totalContributions === "number" ? cal.totalContributions : 0;
  const weeks = readWeeks(cal.weeks);
  const fetchedAt = typeof data.fetchedAt === "number" ? data.fetchedAt : 0;
  return { total, weeks, fetchedAt };
}

function readWeeks(v: unknown): ContributionDay[][] {
  if (!Array.isArray(v)) return [];
  return v.map(readWeek).filter(Boolean) as ContributionDay[][];
}

function readWeek(v: unknown): ContributionDay[] | null {
  if (!isObj(v)) return null;
  const days = v.contributionDays;
  if (!Array.isArray(days)) return null;
  return days.map(readDay).filter(Boolean) as ContributionDay[];
}

function readDay(v: unknown): ContributionDay | null {
  if (!isObj(v)) return null;
  const date = typeof v.date === "string" ? v.date : "";
  const count = typeof v.contributionCount === "number" ? v.contributionCount : 0;
  const level = readLevel(v.contributionLevel);
  const weekday = typeof v.weekday === "number" ? v.weekday : 0;
  if (!date) return null;
  return { date, count, level, weekday };
}

function readLevel(v: unknown): number {
  if (typeof v !== "string") return 0;
  switch (v) {
    case "FIRST_QUARTILE": return 1;
    case "SECOND_QUARTILE": return 2;
    case "THIRD_QUARTILE": return 3;
    case "FOURTH_QUARTILE": return 4;
    default: return 0;
  }
}