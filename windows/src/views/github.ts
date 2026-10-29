// The GitHub card once the pulse is in — DOM ports of GitHubPulseCardView,
// GitHubDetailView, GitHubPRRowView, GitHubRepoCIRowView and
// GitHubActivityDetailContent. Sizes, colours and wording follow the Swift views.

import { h, svg, dot } from "./dom";
import { ICONS } from "./icons";
import { Bridge } from "../core/bridge";
import {
  CI_COLORS, GH_STRINGS, GRID_WEEKS, activityHeader, actionsUrl, ciWord,
  contributionColor, formatCount, lastDays, lastWeeks, mainCISummary, myPRsValue,
  profileUrl, safeGitHubUrl, sectionTitle, shortRepo, weekColumn, worstCI,
  type ContributionDay, type GitHubActivity, type GitHubPR, type GitHubPulse,
  type GitHubRepoCI, type GitHubSection, type GitHubStats,
} from "../core/github";

const GITHUB_RED = "#F4505E";

export interface ForgeCardOptions {
  title: string;
  color: string;
  provider?: "github" | "gitlab" | "gitea";
  refreshId?: string;
  profileUrl?: string;
}

/** Each provider keeps its selected list across re-renders. */
const openSections = new Map<string, GitHubSection>();

function open(url: string, forge: ForgeCardOptions) {
  if (forge.provider === "gitlab") { void Bridge.openGitLabUrl(url); return; }
  if (forge.provider === "gitea") { void Bridge.openGiteaUrl(url); return; }
  const safe = safeGitHubUrl(url);
  if (safe) void Bridge.openUrl(safe);
}

/** Seven small squares: the last week of contributions. */
function miniRow(activity: GitHubActivity): HTMLElement {
  const row = h("span", { class: "gh-mini" });
  for (const day of lastDays(activity, 7)) {
    row.append(h("i", { style: `background:${contributionColor(day.level)}` }));
  }
  return row;
}

function statButton(icon: SVGSVGElement, color: string, label: string, value: string, onClick: () => void): HTMLElement {
  return h(
    "button",
    { class: "int-stat gh-stat", onclick: onClick },
    h("i", { class: "int-stat-icon", style: `color:${color}` }, icon),
    h("span", { class: "int-stat-label", text: label }),
    h("span", { class: "int-stat-value", text: value }),
  );
}
// ── Card ──────────────────────────────────────────────────────────────────────

export function githubPulseCard(
  pulse: GitHubPulse,
  stats: GitHubStats | null,
  activity: GitHubActivity | null,
  openDetail: () => void,
  options: ForgeCardOptions = { title: "GitHub", color: GITHUB_RED },
): HTMLElement {
  const forge = options;
  const show = (section: GitHubSection) => {
    openSections.set(forge.provider ?? "github", section);
    if (forge.refreshId) void Bridge.refreshIntegration(forge.refreshId); else void Bridge.githubRefresh(section === "activity" ? "activity" : "pulse");
    openDetail();
  };

  const head = h("div", { class: "int-head" }, dot(forge.color, 7), h("b", { text: forge.title }));
  if (stats || activity) {
    const spark = h("button", { class: "gh-spark", onclick: () => show("activity") });
    if (stats) spark.append(h("span", { text: `★ ${formatCount(stats.totalStars)}` }));
    if (activity) spark.append(miniRow(activity));
    head.append(spark);
  } else {
    head.append(h("span", { text: GH_STRINGS.overview }));
  }

  const prColor = CI_COLORS[worstCI(pulse.myPRs.map((p) => p.ci))];
  const reviews = pulse.toReview.length;
  const main = mainCISummary(pulse.mainCI);

  return h(
    "div",
    { class: "int-card" },
    head,
    h(
      "div",
      { class: "int-stats gh-rows" },
      statButton(svg(ICONS.pull, 10, { stroke: 2.2 }), prColor, GH_STRINGS.myPRs, myPRsValue(pulse.myPRs),
        () => show("myPRs")),
      statButton(svg(ICONS.eye, 10, { stroke: 2.2 }), reviews > 0 ? "#8AB4F8" : "#6B7079", GH_STRINGS.toReview, String(reviews),
        () => show("toReview")),
      statButton(svg(ICONS.gitCompare, 10, { stroke: 2.2 }), main.includes("fallando") ? "#F4505E" : "#6B7079", GH_STRINGS.mainCI, main,
        () => show("mainCI")),
    ),
  );
}

function backButton(title: string, onBack: () => void): HTMLElement {
  return h("div", { class: "gh-detail-head" },
    h("button", { class: "int-back", title: "Volver", onclick: onBack }, svg(ICONS.chevronLeft, 10, { stroke: 2.4 })),
    h("span", { class: "gh-detail-title", text: title }));
}

function ciWord(ci: CIState): string {
  switch (ci) {
    case "failure": return GH_STRINGS.failing;
    case "pending": return GH_STRINGS.running;
    case "success": return GH_STRINGS.passing;
    default: return GH_STRINGS.unknown;
  }
}

function draftTag(isDraft: boolean): HTMLElement {
  if (!isDraft) return h("span", {});
  return h("span", { class: "gh-draft", text: GH_STRINGS.draft });
}

function prRow(pr: GitHubPR, mine: boolean, forge: ForgeCardOptions): HTMLElement {
  const row = h("div", { class: "gh-pr-row" });
  const left = h("div", { class: "gh-pr-left" });
  left.append(h("b", { text: pr.title }));
  left.append(h("span", { class: "gh-pr-meta", text: `${pr.repo}#${pr.number}` }));
  left.append(draftTag(pr.isDraft));
  row.append(left);

  const right = h("div", { class: "gh-pr-right" });
  right.append(h("span", { class: `gh-ci-${pr.ci}`, text: ciWord(pr.ci) }));
  if (!mine && pr.review !== "unknown") {
    right.append(h("span", { class: "gh-review", text: pr.review === "approved" ? "✓" : pr.review === "changesRequested" ? "!" : "?" }));
  }
  row.append(right);

  row.addEventListener("click", () => open(pr.url, forge));
  return row;
}

function repoRow(repo: GitHubRepoCI, forge: ForgeCardOptions): HTMLElement {
  const row = h("div", { class: "gh-repo-row" });
  row.append(h("b", { text: shortRepo(repo.repo) }));
  row.append(h("span", { class: `gh-ci-${repo.ci}`, text: ciWord(repo.ci) }));
  row.addEventListener("click", () => open(actionsUrl(repo.url), forge));
  return row;
}
// ── Detail ────────────────────────────────────────────────────────────────────

/** The rows of the GitHub list shown in `root`, top to bottom; none without one. */
export function listRows(root: HTMLElement): HTMLElement[] {
  const list = root.querySelector(".gh-list");
  return list ? (Array.from(list.children) as HTMLElement[]) : [];
}

/**
 * Highlights row `selection` and no other (GitHubPRRowView's `selected`).
 * `reveal`: the highlight just moved, so its row scrolls into view.
 */
export function highlightRow(rows: readonly HTMLElement[], selection: number | null, reveal: boolean) {
  rows.forEach((el, i) => el.classList.toggle("selected", i === selection));
  if (reveal && selection != null) rows[selection]?.scrollIntoView({ block: "nearest" });
}

/** Ctrl+O: does what a click on the row does. */
export function openRow(el: HTMLElement | undefined) {
  if (el) rowOpens.get(el)?.();
}

const rowOpens = new WeakMap<HTMLElement, () => void>();

function listDetail(section: Exclude<GitHubSection, "activity">, pulse: GitHubPulse, onBack: () => void, forge: ForgeCardOptions): HTMLElement {
  const rows: HTMLElement[] =
    section === "mainCI"
      ? pulse.mainCI.map((repo) => repoRow(repo, forge))
      : (section === "myPRs" ? pulse.myPRs : pulse.toReview).map((pr) => prRow(pr, section === "myPRs", forge));
  const body =
    rows.length === 0
      ? h("div", { class: "gh-empty", text: GH_STRINGS.nothingHere })
      : h("div", { class: rows.length > 3 ? "gh-list fade" : "gh-list" }, ...rows);

  return h(
    "div",
    { class: "int-card" },
    backButton(sectionTitle(section), onBack),
    body,
  );
}

// ── Detail: contribution grid ─────────────────────────────────────────────────

function activityDetail(
  activity: GitHubActivity | null,
  stats: GitHubStats | null,
  login: string,
  onBack: () => void,
  forge: ForgeCardOptions,
): HTMLElement {
  const right = h("button", {
    class: "gh-head-right",
    text: activityHeader(activity, stats, null),
    onclick: () => open(forge.profileUrl ?? profileUrl(login), forge),
  });

  let picked: ContributionDay | null = null;
  const show = (day: ContributionDay | null) => {
    picked = day;
    right.textContent = activityHeader(activity, stats, day);
  };

  const head = h("div", { class: "gh-detail-head" }, backButton(GH_STRINGS.activity, onBack));
  if (activity) head.append(right);

  if (!activity) {
    return h("div", { class: "int-card" }, head, h("div", { class: "gh-empty", text: GH_STRINGS.loading }));
  }

  const grid = h("div", { class: "gh-grid" });
  for (const week of lastWeeks(activity, GRID_WEEKS)) {
    const column = h("div", { class: "gh-week" });
    for (const day of weekColumn(week)) {
      if (!day) {
        column.append(h("i", { class: "gh-cell empty" }));
        continue;
      }
      const cell = h("i", { class: "gh-cell", style: `background:${contributionColor(day.level)}` });
      cell.addEventListener("mouseenter", () => show(day));
      cell.addEventListener("mouseleave", () => show(null));
      cell.addEventListener("click", () => show(picked?.date === day.date ? null : day));
      column.append(cell);
    }
    grid.append(column);
  }
  return h("div", { class: "int-card" }, head, grid);
}

export function githubDetail(
  pulse: GitHubPulse,
  stats: GitHubStats | null,
  activity: GitHubActivity | null,
  onBack: () => void,
  options: ForgeCardOptions = { title: "GitHub", color: GITHUB_RED },
): HTMLElement {
  const forge = options;
  const openSection = openSections.get(forge.provider ?? "github") ?? "myPRs";
  return openSection === "activity"
    ? activityDetail(activity, stats, pulse.login, onBack, forge)
    : listDetail(openSection, pulse, onBack, forge);
}