// Integration cards shown in the overview's left card — DOM ports of
// IntegrationCardView and friends from IslandViewContent.swift.
//
// Cal.com is the one simplification: macOS shows a three-level calendar
// (month → day → booking); here it is the list of upcoming bookings.

import { h, svg, clear, dot } from "./dom";
import { ICONS } from "./icons";
import { State, type AgentTask, type ProjectInfo } from "../core/state";
import { Bridge } from "../core/bridge";
import { miniUsage } from "./plan";

/** Same shape as the Swift `timeAgo` computed properties. */
export function timeAgo(value: unknown): string {
  const date = typeof value === "number" ? new Date(value) : new Date(String(value));
  const diff = (Date.now() - date.getTime()) / 1000;
  if (!Number.isFinite(diff)) return "";
  if (diff < 60) return "ahora";
  if (diff < 3600) return `${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h`;
  return `${Math.floor(diff / 86400)} d`;
}

function header(color: string, name: string, kind: string, extra?: Node): HTMLElement {
  const row = h("div", { class: "int-head" }, dot(color, 7), h("b", { text: name }), h("span", { text: kind }));
  if (extra) row.append(extra);
  return row;
}

/** Highlighted first row + plain rows, the layout every list card shares. */
function listRow(accent: string, first: boolean, ...children: Node[]): HTMLElement {
  const row = h("div", { class: first ? "int-row first" : "int-row" }, dot(accent, 5), ...children);
  if (first) row.style.background = `${accent}14`;
  return row;
}

function get(id: string): Record<string, unknown> {
  return (State.integrations[id]?.data ?? {}) as Record<string, unknown>;
}

function arr(id: string, key: string): Record<string, unknown>[] {
  const v = get(id)[key];
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

// ── Not configured / idle ─────────────────────────────────────────────────────

const OPEN_URLS: Record<string, string> = {
  integration_resend: "https://resend.com/emails",
  integration_vercel: "https://vercel.com/dashboard",
  integration_github: "https://github.com",
  integration_stripe: "https://dashboard.stripe.com/payments",
  integration_notion: "https://notion.so",
  integration_calcom: "https://app.cal.com/bookings",
};

function idleCard(task: AgentTask, openSettings: () => void): HTMLElement {
  const info = State.integrations[task.id];
  const configured = info?.configured ?? false;
  const error = info?.error ?? null;
  // The Claude Code pill is about hooks, not a key — the macOS wording would be
  // misleading here.
  // Other agents are connected from Settings → Agents, not with a key.
  const isAgent = task.source === "agent";
  const missing =
    task.id === "integration_claude" ? "Hooks sin instalar" : isAgent ? "Sin conectar" : "Clave sin configurar";
  const label = error ?? (configured ? (isAgent ? "Conectado · esperando actividad" : "Conectado · cargando…") : missing);
  const statusColor = error || !configured ? "#F4505E" : "#22C55E";

  const actions = h("div", { class: "int-actions" });
  if (task.id === "integration_claude") {
    actions.append(
      h("button", {
        class: "link-btn",
        style: `color:${task.color}b3`,
        text: "Abrir Visual Studio Code",
        onclick: () => void Bridge.openInVSCode(task.sessionCwd ?? null),
      }),
    );
  } else if (OPEN_URLS[task.id]) {
    actions.append(
      h("button", {
        class: "link-btn",
        style: `color:${task.color}d9`,
        text: `Abrir ${task.name}`,
        onclick: () => void Bridge.openUrl(OPEN_URLS[task.id]),
      }),
    );
  }
  if (configured && isAgent) {
    // Nothing to refresh: an agent speaks when it has something to say.
  } else if (configured) {
    actions.append(
      h("button", {
        class: "link-btn",
        style: `color:${task.color}d9`,
        text: "Actualizar",
        onclick: () => void Bridge.refreshIntegration(task.id),
      }),
    );
  } else {
    actions.append(
      h("button", { class: "link-btn", style: "color:#8e939c", text: "Ajustes…", onclick: openSettings }),
    );
  }

  return h(
    "div",
    { class: "int-card" },
    header(task.color, task.name, isAgent ? "Agente" : "Integración"),
    h("div", { class: "int-status" }, dot(statusColor, 5), h("span", { text: label })),
    actions,
  );
}

// ── Claude Code and VS Code: their own cards ──────────────────────────────────

/** "3h", "2d" — how long ago a project was last used. */
function projectAgo(unixSeconds: number): string {
  if (!unixSeconds) return "";
  return timeAgo(unixSeconds * 1000);
}

/** Up to `max` projects as links; a click opens the folder in VS Code. */
function projectLinks(projects: ProjectInfo[], color: string, max = 3): HTMLElement {
  const row = h("div", { class: "proj-row" });
  for (const p of projects.slice(0, max)) {
    row.append(
      h("button", {
        class: "link-btn proj-link",
        style: `color:${color}d9`,
        title: `${p.path}${p.lastActive ? ` · ${projectAgo(p.lastActive)}` : ""}`,
        text: p.name,
        onclick: () => void Bridge.openInVSCode(p.path),
      }),
    );
  }
  return row;
}

/**
 * Claude Code on its own: whether it is connected, what is left of the plan, and
 * the projects you used it in lately. (A live session shows the ticker instead.)
 */
function claudeCard(task: AgentTask, openSettings: () => void): HTMLElement {
  const connected = State.integrations[task.id]?.configured ?? false;
  const card = h("div", { class: "int-card" }, header(task.color, "Claude Code", connected ? "Conectado" : "Sin conectar"));

  if (!connected) {
    card.append(
      h("div", { class: "int-status" }, dot("#F4505E", 5), h("span", { text: "Hooks sin instalar" })),
      h("div", { class: "int-actions" },
        h("button", { class: "link-btn", style: "color:#8e939c", text: "Ajustes…", onclick: openSettings }),
      ),
    );
    return card;
  }

  if (State.plan) {
    card.append(miniUsage(State.plan));
  } else {
    card.append(
      h("div", { class: "int-sub", text: "El uso aparece al instalar el relay del plan" }),
    );
  }
  if (State.claudeProjects.length > 0) {
    card.append(projectLinks(State.claudeProjects, task.color));
  } else {
    card.append(h("div", { class: "int-sub", text: "Aún no hay proyectos" }));
  }
  const last = State.claudeProjects[0]?.path ?? null;
  card.append(
    h("div", { class: "int-actions" },
      h("button", { class: "link-btn", style: `color:${task.color}d9`, text: "Abrir Claude Code", onclick: () => void Bridge.launchAgent("claude", last, false) }),
      last
        ? h("button", { class: "link-btn", style: `color:${task.color}d9`, text: "Continuar", title: "claude --continue en el último proyecto", onclick: () => void Bridge.launchAgent("claude", last, true) })
        : h("span"),
    ),
  );
  return card;
}

/** What each terminal agent can do from its card. */
const AGENT_LAUNCH: Record<string, { agent: "opencode" | "gemini"; resume: boolean }> = {
  agent_opencode: { agent: "opencode", resume: true },
  agent_gemini: { agent: "gemini", resume: false },
};

/** Gemini CLI and OpenCode: start them in a project, or continue the last session. */
function agentCard(task: AgentTask, openSettings: () => void): HTMLElement {
  const spec = AGENT_LAUNCH[task.id];
  const connected = State.integrations[task.id]?.configured ?? false;
  const card = h("div", { class: "int-card" }, header(task.color, task.name, connected ? "Conectado" : "Sin conectar"));
  if (!connected) {
    card.append(
      h("div", { class: "int-status" }, dot("#F4505E", 5), h("span", { text: "Sin conectar" })),
    );
  }
  const projects = State.claudeProjects.slice(0, 3);
  if (projects.length > 0) {
    const row = h("div", { class: "proj-row" });
    for (const p of projects) {
      row.append(
        h("button", {
          class: "link-btn proj-link",
          style: `color:${task.color}d9`,
          title: `Abrir ${task.name} en ${p.path}`,
          text: p.name,
          onclick: () => void Bridge.launchAgent(spec.agent, p.path, false),
        }),
      );
    }
    card.append(row);
  } else {
    card.append(h("div", { class: "int-sub", text: "Elige un proyecto para empezar" }));
  }
  const actions = h("div", { class: "int-actions" },
    h("button", { class: "link-btn", style: `color:${task.color}d9`, text: `Abrir ${task.name}`, onclick: () => void Bridge.launchAgent(spec.agent, null, false) }),
  );
  if (spec.resume && projects[0]) {
    actions.append(
      h("button", { class: "link-btn", style: `color:${task.color}d9`, text: "Continuar", title: `${spec.agent} --continue en ${projects[0].name}`, onclick: () => void Bridge.launchAgent(spec.agent, projects[0].path, true) }),
    );
  }
  if (!connected) {
    actions.append(h("button", { class: "link-btn", style: "color:#8e939c", text: "Conectar…", onclick: openSettings }));
  }
  card.append(actions);
  return card;
}

/**
 * VS Code on its own: your projects, whether Claude Code is running inside it,
 * and whether its terminal reports long commands.
 */
function vscodeCard(task: AgentTask, openSettings: () => void): HTMLElement {
  const connected = State.integrations[task.id]?.configured ?? false;
  const claude = State.tasks.find((t) => t.id === "integration_claude");
  const claudeHere = !!claude?.viaVscode && claude.state !== "idle";
  const card = h(
    "div",
    { class: "int-card" },
    header(task.color, "VS Code", claudeHere ? "Claude Code corre aquí" : connected ? "Terminal conectada" : "Proyectos"),
  );

  if (State.vscodeProjects.length > 0) {
    card.append(projectLinks(State.vscodeProjects, task.color));
  } else {
    card.append(h("div", { class: "int-sub", text: "No hay proyectos recientes" }));
  }

  const actions = h("div", { class: "int-actions" });
  actions.append(
    h("button", {
      class: "link-btn",
      style: `color:${task.color}d9`,
      text: "Abrir VS Code",
      onclick: () => void Bridge.openInVSCode(null),
    }),
  );
  if (!connected) {
    actions.append(
      h("button", { class: "link-btn", style: "color:#8e939c", text: "Conectar terminal…", onclick: openSettings }),
    );
  }
  card.append(actions);
  return card;
}

// ── Vercel ────────────────────────────────────────────────────────────────────

function vercelCard(onDetail: () => void): HTMLElement {
  const deployments = arr("integration_vercel", "deployments");
  const rows = h("div", { class: "int-rows" });
  deployments.slice(0, 3).forEach((d, i) => {
    const accent = d.state === "READY" ? "#22C55E" : "#F4505E";
    const name = h("span", { class: "int-name", text: String(d.projectName ?? "") });
    const ago = h("span", { class: "int-ago", text: timeAgo(d.createdAt) });
    if (i === 0) {
      const more = h(
        "button",
        { class: "int-more", title: "Detalles", onclick: onDetail },
        svg(ICONS.ellipsis, 8),
      );
      rows.append(listRow(accent, true, name, ago, more));
    } else {
      rows.append(listRow(accent, false, name, ago));
    }
  });
  return h("div", { class: "int-card" }, header("#7C5CFF", "Vercel", "Despliegues"), rows);
}

function vercelDetail(onBack: () => void): HTMLElement {
  const d = arr("integration_vercel", "deployments")[0] ?? {};
  const success = d.state === "READY";
  const accent = success ? "#22C55E" : "#F4505E";
  const status = success ? "Listo" : d.state === "CANCELED" ? "Cancelado" : "Error";
  const body = h("div", { class: "int-detail-body" });
  if (d.commitMessage) body.append(h("div", { class: "int-commit", text: String(d.commitMessage) }));
  const meta = h("div", { class: "int-meta" });
  if (d.branch) meta.append(h("span", { text: String(d.branch) }));
  meta.append(h("span", { text: ((t) => (t === "ahora" ? t : `hace ${t}`))(timeAgo(d.createdAt)) }));
  body.append(meta);
  if (d.url) {
    body.append(
      h("button", {
        class: "int-link",
        text: String(d.url),
        onclick: () => void Bridge.openUrl(`https://${d.url}`),
      }),
    );
  }
  return h(
    "div",
    { class: "int-card detail" },
    h(
      "div",
      { class: "int-detail-head" },
      h("button", { class: "int-back", onclick: onBack }, svg(ICONS.chevronLeft, 10, { stroke: 2.4 })),
      dot(accent, 6),
      h("b", { text: String(d.projectName ?? "Despliegue") }),
      h("span", { class: "int-badge", style: `color:${accent};background:${accent}24`, text: status }),
    ),
    body,
  );
}

// ── Resend ────────────────────────────────────────────────────────────────────

function resendCard(): HTMLElement {
  const emails = arr("integration_resend", "emails");
  const total = get("integration_resend").total;
  const extra =
    total != null
      ? h("span", { class: "int-total" }, h("i", { class: "pulse" }), h("span", { text: String(total) }))
      : undefined;
  const rows = h("div", { class: "int-rows" });
  emails.slice(0, 3).forEach((e, i) => {
    const delivered = e.lastEvent === "delivered";
    const accent = delivered ? "#22C55E" : "#F4505E";
    const to = Array.isArray(e.to) ? String(e.to[0] ?? "?") : "?";
    const short = to.split("@")[0];
    const cells: Node[] = [
      h("span", { class: "int-name", text: short }),
      h("span", { class: "int-ago", text: timeAgo(e.createdAt) }),
    ];
    if (i === 0 && e.subject) cells.push(h("span", { class: "int-sub", text: String(e.subject) }));
    rows.append(listRow(accent, i === 0, ...cells));
  });
  return h("div", { class: "int-card" }, header("#22C55E", "Resend", "Correos", extra), rows);
}

// ── GitHub ────────────────────────────────────────────────────────────────────

function statRow(icon: string, color: string, label: string, value: string): HTMLElement {
  return h(
    "div",
    { class: "int-stat" },
    h("i", { class: "int-stat-icon", style: `color:${color}` }, svg(icon, 10)),
    h("span", { class: "int-stat-label", text: label }),
    h("span", { class: "int-stat-value", text: value }),
  );
}

/** One pull request, as the Rust poller boils it down (integrations.rs, parse_pulse). */
interface PrItem {
  number: number;
  title: string;
  url: string;
  repo: string;
  isDraft: boolean;
  reviewDecision: string;
  ci: "success" | "failure" | "pending" | "unknown";
  author: string;
  isCopilot: boolean;
  copilotReviewed: boolean;
}

interface Pulse {
  mine: PrItem[];
  toReview: PrItem[];
  copilot: PrItem[];
  copilotReviewedMine: number;
}

type GithubSection = "review" | "mine" | "copilot";

/** Which list the detail view shows; set by the row that was clicked. */
let githubSection: GithubSection = "review";

const COPILOT_COLOR = "#C084FC";
const GITHUB_RED = "#F4505E";

function pulseOf(): Pulse | null {
  const p = get("integration_github").pulse;
  return p && typeof p === "object" ? (p as Pulse) : null;
}

function ciColor(ci: PrItem["ci"]): string {
  switch (ci) {
    case "success": return "#22C55E";
    case "failure": return "#F4505E";
    case "pending": return "#F5A524";
    default: return "#6B7079";
  }
}

/** The colour of a list of PRs at a glance: red if any CI fails, amber if one runs. */
function worstCi(prs: PrItem[]): string {
  if (prs.some((p) => p.ci === "failure")) return ciColor("failure");
  if (prs.some((p) => p.ci === "pending")) return ciColor("pending");
  if (prs.length > 0) return ciColor("success");
  return "#4B5563";
}

const GITHUB_SECTIONS: Record<GithubSection, { title: string; color: (p: Pulse) => string; url: string }> = {
  review: {
    title: "Revisiones pedidas",
    color: (p) => (p.toReview.length > 0 ? "#F5A524" : "#4B5563"),
    url: "https://github.com/pulls/review-requested",
  },
  mine: { title: "Mis pull requests", color: (p) => worstCi(p.mine), url: "https://github.com/pulls" },
  copilot: {
    title: "Copilot",
    color: (p) => (p.copilot.length > 0 || p.copilotReviewedMine > 0 ? COPILOT_COLOR : "#4B5563"),
    url: "https://github.com/pulls/assigned",
  },
};

function listOf(p: Pulse, section: GithubSection): PrItem[] {
  return section === "review" ? p.toReview : section === "mine" ? p.mine : p.copilot;
}

function githubCard(onDetail: () => void): HTMLElement {
  const d = get("integration_github");
  const stars = Number(d.totalStars ?? 0);
  const repos = Number(d.totalRepos ?? 0);
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const pulse = pulseOf();
  const kind = `& Copilot · ★ ${fmt(stars)}`;

  if (!pulse) {
    // Repository stats still work without pull request access: say why the rest is missing.
    const why = typeof d.pulseError === "string" ? d.pulseError : "Cargando pull requests…";
    return h(
      "div",
      { class: "int-card" },
      header(GITHUB_RED, "GitHub", kind),
      h("div", { class: "int-stats" }, statRow(ICONS.stack, "#6B7079", "Repositorios", String(repos))),
      h("div", { class: "int-sub", text: why }),
    );
  }

  const row = (section: GithubSection, label: string, count: number) =>
    h(
      "button",
      {
        class: "int-row gh-row",
        title: GITHUB_SECTIONS[section].title,
        onclick: () => {
          githubSection = section;
          onDetail();
        },
      },
      dot(GITHUB_SECTIONS[section].color(pulse), 5),
      h("span", { class: "int-name", text: label }),
      h("span", { class: "int-amount", style: count > 0 ? "color:#e8e9ec" : "color:#6B7079", text: String(count) }),
    );

  const copilotLabel =
    pulse.copilotReviewedMine > 0 ? `Copilot · revisó ${pulse.copilotReviewedMine} tuyos` : "Pull requests de Copilot";
  return h(
    "div",
    { class: "int-card" },
    header(GITHUB_RED, "GitHub", kind),
    h(
      "div",
      { class: "int-rows tight" },
      row("review", "Revisiones pedidas", pulse.toReview.length),
      row("mine", "Mis pull requests", pulse.mine.length),
      row("copilot", copilotLabel, pulse.copilot.length),
    ),
  );
}

/** The list behind a row: up to three pull requests, each opening on GitHub. */
function githubDetail(onBack: () => void): HTMLElement {
  const pulse = pulseOf();
  const section = GITHUB_SECTIONS[githubSection];
  const prs = pulse ? listOf(pulse, githubSection) : [];
  const color = pulse ? section.color(pulse) : "#4B5563";

  const rows = h("div", { class: "int-rows tight" });
  for (const p of prs.slice(0, 3)) {
    const repo = p.repo.split("/").pop() ?? p.repo;
    rows.append(
      h(
        "button",
        {
          class: "int-row gh-pr",
          title: `${p.repo}#${p.number} · ${p.title}${p.isDraft ? " (borrador)" : ""}`,
          onclick: () => void Bridge.openUrl(p.url),
        },
        dot(ciColor(p.ci), 5),
        h("span", { class: "int-name", text: p.isDraft ? `Borrador · ${p.title}` : p.title }),
        // Copilot's own work, and mine that Copilot reviewed, carry its colour.
        p.isCopilot || p.copilotReviewed ? dot(COPILOT_COLOR, 4) : "",
        h("span", { class: "int-ago", text: repo }),
      ),
    );
  }
  if (prs.length === 0) rows.append(h("div", { class: "int-empty", text: "Nada por aquí" }));
  else if (prs.length > 3) {
    rows.append(
      h("button", {
        class: "link-btn",
        style: `color:${color}d9;text-align:left;padding:2px 8px`,
        text: `${prs.length - 3} más en GitHub`,
        onclick: () => void Bridge.openUrl(section.url),
      }),
    );
  }

  return h(
    "div",
    { class: "int-card detail" },
    h(
      "div",
      { class: "int-detail-head" },
      h("button", { class: "int-back", onclick: onBack }, svg(ICONS.chevronLeft, 10, { stroke: 2.4 })),
      dot(color, 6),
      h("b", { text: section.title }),
      h("span", { class: "int-badge", style: `color:${color};background:${color}24`, text: String(prs.length) }),
    ),
    rows,
  );
}

// ── Stripe ────────────────────────────────────────────────────────────────────

function stripeCard(): HTMLElement {
  const d = get("integration_stripe");
  const balance = (Number(d.balance ?? 0) / 100).toFixed(2);
  const currency = String(d.currency ?? "eur").toUpperCase();
  const rows = h("div", { class: "int-rows tight" });
  for (const p of arr("integration_stripe", "payments")) {
    const success = p.status === "succeeded";
    const accent = success ? "#22C55E" : "#F4505E";
    rows.append(
      h(
        "div",
        { class: "int-row" },
        dot(accent, 5),
        h("span", { class: "int-name", text: String(p.description ?? "Pago") }),
        h("span", {
          class: "int-amount",
          style: "color:#22c55e",
          text: `+${(Number(p.amount ?? 0) / 100).toFixed(2)}`,
        }),
        h("span", { class: "int-ago", text: timeAgo(p.createdAt) }),
      ),
    );
  }
  return h(
    "div",
    { class: "int-card" },
    header("#0570DE", "Stripe", "Pagos"),
    h("div", { class: "int-balance" }, h("span", { text: balance }), h("i", { text: currency })),
    rows,
  );
}

// ── Notion ────────────────────────────────────────────────────────────────────

function notionCard(): HTMLElement {
  const rows = h("div", { class: "int-rows tight" });
  for (const p of arr("integration_notion", "pages").slice(0, 3)) {
    rows.append(
      h(
        "button",
        {
          class: "int-page",
          onclick: () => {
            if (typeof p.url === "string") void Bridge.openUrl(p.url);
          },
        },
        p.emoji
          ? h("span", { class: "int-emoji", text: String(p.emoji) })
          : h("i", { class: "int-emoji" }, svg(ICONS.doc, 9)),
        h("span", { class: "int-name", text: String(p.title ?? "Sin título") }),
        h("span", { class: "int-ago", text: timeAgo(p.lastEditedAt) }),
      ),
    );
  }
  return h("div", { class: "int-card" }, header("#E8E8E8", "Notion", "Recientes"), rows);
}

// ── Cal.com ───────────────────────────────────────────────────────────────────

function calcomCard(): HTMLElement {
  const bookings = arr("integration_calcom", "bookings")
    .slice()
    .sort((a, b) => new Date(String(a.start)).getTime() - new Date(String(b.start)).getTime());
  const rows = h("div", { class: "int-rows tight" });
  if (bookings.length === 0) {
    rows.append(h("div", { class: "int-empty", text: "No hay llamadas programadas" }));
  }
  for (const b of bookings.slice(0, 3)) {
    const when = new Date(String(b.start));
    const day = when.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" });
    const time = when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    rows.append(
      h(
        "div",
        { class: "int-row" },
        dot("#C9956A", 4),
        h("span", { class: "int-time", text: `${day} ${time}` }),
        h("span", { class: "int-name", text: String(b.title ?? "Reunión") }),
      ),
    );
  }
  return h("div", { class: "int-card" }, header("#C9956A", "Cal.com", "Agenda"), rows);
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

export interface IntegrationCardHooks {
  detailOpen: boolean;
  openDetail(): void;
  closeDetail(): void;
  openSettings(): void;
}

/** True when this integration has data worth showing instead of the idle card. */
export function hasIntegrationData(id: string): boolean {
  const info = State.integrations[id];
  if (!info || info.error) return false;
  switch (id) {
    case "integration_vercel":
      return arr(id, "deployments").length > 0;
    case "integration_resend":
      return arr(id, "emails").length > 0;
    case "integration_github":
      return get(id).totalRepos != null;
    case "integration_stripe":
      return info.loaded;
    case "integration_notion":
      return arr(id, "pages").length > 0;
    case "integration_calcom":
      return info.loaded;
    default:
      return false;
  }
}

export function renderIntegrationCard(task: AgentTask, hooks: IntegrationCardHooks): HTMLElement {
  // Claude Code and VS Code each have a card of their own, whatever their state.
  if (task.id === "integration_claude") return claudeCard(task, hooks.openSettings);
  if (task.id === "agent_vscode") return vscodeCard(task, hooks.openSettings);
  if (AGENT_LAUNCH[task.id]) return agentCard(task, hooks.openSettings);
  if (task.id === "integration_github" && hasIntegrationData(task.id)) {
    return hooks.detailOpen ? githubDetail(hooks.closeDetail) : githubCard(hooks.openDetail);
  }
  if (task.id === "integration_vercel" && hasIntegrationData(task.id)) {
    return hooks.detailOpen ? vercelDetail(hooks.closeDetail) : vercelCard(hooks.openDetail);
  }
  if (!hasIntegrationData(task.id)) return idleCard(task, hooks.openSettings);

  switch (task.id) {
    case "integration_resend":
      return resendCard();
    case "integration_stripe":
      return stripeCard();
    case "integration_notion":
      return notionCard();
    case "integration_calcom":
      return calcomCard();
    default:
      return idleCard(task, hooks.openSettings);
  }
}

export { clear };
