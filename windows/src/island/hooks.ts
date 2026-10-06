// Claude Code hook events → island state.
// Port of HookServer.processEvent / processPermissionRequest from the macOS app.
// Difference from macOS: no terminal filter. On Windows the hook fires from any
// terminal (Windows Terminal, VS Code, PowerShell…) and all of them are handled.

import { Bridge, onEvent } from "../core/bridge";
import { Sound } from "../core/sound";
import { applyLanguage, t } from "../core/i18n";
import { speakAuto } from "../core/voice";
import { State, type AskQuestion, type PlanUsage, type PlanWindow } from "../core/state";
import { computeDiff, diffStepLabel } from "./diff";
import { matchRule, ruleFor } from "./rules";
import type { Island } from "./island";

const CLAUDE_ID = "integration_claude";

/** Clears the approval card if no decision was made before the hook gave up. */
let pendingTimeout: number | null = null;
/** Same, for a question from Claude (the relay waits 128 s, the app 125 s). */
let questionTimeout: number | null = null;
/** Diffs are forgotten after an hour without activity. */
let diffExpiry: number | null = null;
const DIFF_IDLE_MS = 60 * 60 * 1000;

interface HookPayload {
  hook_event_name?: string;
  /** Set by `coucou-hook --ask` on an AskUserQuestion: the relay is waiting. */
  coucou_ask?: boolean;
  request_id?: string;
  session_id?: string;
  cwd?: string;
  message?: string;
  /** UserPromptSubmit carries `prompt`; `message` belongs to Notification/Stop. */
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  /** Optional agent tag: lowercase, digits and hyphens, ≤ 24 chars. */
  coucou_agent?: string;
  /** The relay's parent chain, nearest first: how to find the terminal window. */
  ancestor_pids?: unknown;
  /** Set by the relay from the environment: "vscode" inside VS Code's terminal. */
  term_program?: string;
  vscode_pid?: string;
}

/** A short list of process ids, or null. It comes from outside: check it. */
function validPids(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 16) return null;
  return raw.every((p) => Number.isInteger(p) && p > 0) ? (raw as number[]) : null;
}

/** Same rule as HookServer.validateAgent on macOS. "claude" is reserved. */
function validateAgent(raw: string | undefined): string | null {
  if (!raw || raw.length > 24 || raw === "claude") return null;
  if (!/^[a-z0-9-]+$/.test(raw)) return null;
  return raw;
}

const FALLBACK_COLORS = ["#22C55E", "#EAB308", "#60A5FA", "#E879F9"];

function agentColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  }
  return FALLBACK_COLORS[Math.abs(h) % FALLBACK_COLORS.length];
}

const PROJECT_ALIASES: Record<string, string> = {
  "notch-buddy": "Notch Buddy",
  notchbuddy: "Notch Buddy",
  notch_buddy: "Notch Buddy",
};

function aliasProjectName(name: string): string {
  return PROJECT_ALIASES[name.toLowerCase()] ?? name;
}

function lastPathComponent(p: string): string {
  const cleaned = p.replace(/[\\/]+$/, "");
  const idx = Math.max(cleaned.lastIndexOf("\\"), cleaned.lastIndexOf("/"));
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

/** frenchStep() — same labels as the macOS app. */
const TOOL_LABELS: Record<string, string> = {
  Bash: "Ejecuta",
  Read: "Lee",
  Write: "Escribe",
  Edit: "Modifica",
  Glob: "Busca",
  Grep: "Busca texto",
  WebSearch: "Busca en la web",
  WebFetch: "Descarga",
  TodoWrite: "Tareas",
  Task: "Agente",
  LS: "Lista",
  MultiEdit: "Modifica",
  NotebookEdit: "Notebook",
  PowerShell: "Ejecuta",
};

function stepLabel(tool: string, input: Record<string, unknown>): string {
  const label = TOOL_LABELS[tool] ?? tool;
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : null);
  const cmd = str("command");
  if (cmd) return `${label} · ${cmd.slice(0, 40)}`;
  const path = str("path");
  if (path) return `${label} · ${lastPathComponent(path)}`;
  const file = str("file_path");
  if (file) return `${label} · ${lastPathComponent(file)}`;
  const query = str("query");
  if (query) return `${label} · ${query.slice(0, 40)}`;
  return label;
}

/**
 * What the Allow button actually authorises. Approving "Write" tells you nothing
 * — approving `Write · C:\…\.env` tells you everything, and the difference is
 * the whole point of approving from the island rather than blind.
 *
 * Ordered by how specific the field is, so an unfamiliar tool still shows
 * whatever identifying string it carries instead of falling back to its name.
 */
const APPROVAL_FIELDS = [
  "command", // Bash, PowerShell
  "file_path", // Write, Edit, MultiEdit, NotebookEdit
  "path", // Read, LS
  "url", // WebFetch
  "query", // WebSearch
  "pattern", // Glob, Grep
  "prompt", // Task
] as const;

function approvalTarget(tool: string, input: Record<string, unknown>): string {
  for (const field of APPROVAL_FIELDS) {
    const value = input[field];
    if (typeof value === "string" && value.trim()) {
      return `${tool} · ${value.trim()}`;
    }
  }
  return tool;
}

/** A Windows toast for something that needs a person, when the setting is on. */
function toast(title: string, body: string) {
  // The title is the short phrase ("Claude Code terminó"); the body can be a command.
  speakAuto("events", t(title));
  if (!State.settings.nativeNotifications) return;
  void Bridge.notify(t(title), t(body));
}

function upsert(projectName: string, cwd: string) {
  const t = State.tasks.find((x) => x.id === CLAUDE_ID);
  if (!t) return;
  t.name = projectName;
  if (cwd) t.sessionCwd = cwd;
}

function clearSession() {
  const t = State.tasks.find((x) => x.id === CLAUDE_ID);
  if (!t) return;
  t.steps = [];
  t.stepDiffs = [];
  t.seq = 0;
  t.stepIndex = 0;
  t.name = "Claude Code";
  t.pillBadge = null;
  t.sessionPids = null;
  State.clearDiffs();
}

/** The edit tools whose PostToolUse carries what changed. */
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write"]);

/** A PostToolUse for an edit: compute the diff and put its tally on the step. */
function recordDiff(agentId: string, tool: string, input: Record<string, unknown>) {
  const diff = computeDiff(tool, input);
  if (!diff) return;
  State.addDiff(diff);
  // The same text PreToolUse announced the step with, so it can be found again.
  const announced = stepLabel(tool, input);
  const verb = TOOL_LABELS[tool] ?? tool;
  State.finishEditStep(agentId, announced, diffStepLabel(verb, diff), diff.id);
  if (diffExpiry != null) window.clearTimeout(diffExpiry);
  diffExpiry = window.setTimeout(() => {
    diffExpiry = null;
    State.clearDiffs();
    State.notify();
  }, DIFF_IDLE_MS);
}

// ── Plan usage (statusLine relay) ─────────────────────────────────────────────

interface StatuslinePayload {
  rate_limits?: Record<string, { used_percentage?: unknown; resets_at?: unknown } | undefined>;
}

/** Out-of-range values are ignored, as the spec says: 0–100 only. */
function planWindow(raw: { used_percentage?: unknown; resets_at?: unknown } | undefined): PlanWindow | null {
  if (!raw || typeof raw.used_percentage !== "number") return null;
  const used = raw.used_percentage;
  if (!Number.isFinite(used) || used < 0 || used > 100) return null;
  const resetsAt = typeof raw.resets_at === "number" && Number.isFinite(raw.resets_at) ? raw.resets_at : null;
  return { used, resetsAt };
}

function handleStatusline(payload: StatuslinePayload) {
  const limits = payload.rate_limits;
  // No `rate_limits` (a plan without limits, or the first reply of a session):
  // keep what we had rather than blanking the gauge.
  if (!limits) return;
  const fiveHour = planWindow(limits.five_hour);
  const sevenDay = planWindow(limits.seven_day);
  if (!fiveHour && !sevenDay) return;
  const next: PlanUsage = { fiveHour, sevenDay, updatedAt: Date.now() };
  State.plan = next;
  State.notify();
}

// ── Questions from Claude (AskUserQuestion) ───────────────────────────────────

/** 1–4 questions, each with 2–4 options; anything else goes back to the terminal. */
export function parseQuestions(input: Record<string, unknown> | undefined): AskQuestion[] | null {
  const raw = input?.questions;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 4) return null;
  const out: AskQuestion[] = [];
  for (const q of raw) {
    const o = (q ?? {}) as Record<string, unknown>;
    if (typeof o.question !== "string" || !o.question.trim()) return null;
    if (!Array.isArray(o.options) || o.options.length < 1 || o.options.length > 4) return null;
    const options: AskQuestion["options"] = [];
    for (const opt of o.options) {
      const p = (opt ?? {}) as Record<string, unknown>;
      if (typeof p.label !== "string" || !p.label.trim()) return null;
      options.push({
        label: p.label,
        description: typeof p.description === "string" ? p.description : "",
      });
    }
    out.push({
      question: o.question,
      header: typeof o.header === "string" ? o.header : "",
      options,
      multiSelect: o.multiSelect === true,
    });
  }
  return out;
}

export function registerHookHandlers(island: Island) {
  void onEvent<HookPayload>("hook", (payload) => handleHook(island, payload));
  void onEvent<StatuslinePayload>("statusline", (payload) => handleStatusline(payload));
  // `npm run dev` in a plain browser has no relay: let the page replay events by
  // hand (window.__coucou.hook({...})). Vite drops this from the real build.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__coucou = {
      State,
      island,
      hook: (p: HookPayload) => handleHook(island, p),
      statusline: (p: StatuslinePayload) => handleStatusline(p),
      language: (l: "auto" | "es" | "en") => applyLanguage(l),
    };
  }
}

function handleHook(island: Island, payload: HookPayload) {
  if (State.paused) {
    // Silence here used to cost Claude Code nearly two minutes: the relay waited
    // for a decision from an island that had already decided not to look. Say so,
    // and the terminal takes the question immediately.
    if (payload.request_id) void Bridge.approvalDecline(payload.request_id);
    return;
  }

  const name = payload.hook_event_name ?? "";
  const cwd = payload.cwd ?? "";
  const raw = lastPathComponent(cwd);
  const projectName = aliasProjectName(raw || "Session");

  // Route to the right pill. Valid coucou_agent → dynamic "agent_<name>" pill.
  // "claude" is reserved; absent or invalid → Claude Code pill unchanged.
  const validAgent = validateAgent(payload.coucou_agent);
  const agentId = validAgent ? `agent_${validAgent}` : CLAUDE_ID;
  const isExternalAgent = validAgent !== null;

  const focused = State.focusId === agentId;

  // Remember where this session's terminal is, so "Open terminal" can bring the
  // right window forward (for Claude Code and for the other agents alike).
  const pids = validPids(payload.ancestor_pids);
  const owner = State.tasks.find((x) => x.id === agentId);
  if (pids && owner) owner.sessionPids = pids;
  // Is this session running inside VS Code? The VS Code pill says so.
  if (owner && (payload.term_program !== undefined || payload.vscode_pid !== undefined)) {
    owner.viaVscode = payload.term_program === "vscode" || !!payload.vscode_pid;
  }

  /** Alerts force the island open; work events only reveal the compact island. */
  const surface = (view: Parameters<Island["alert"]>[0], isAlert: boolean) => {
    if (State.mode === "expanded") {
      if (isAlert) island.setView(view);
    } else if (isAlert) {
      island.alert(view);
    } else if (State.mode === "hidden") {
      island.reveal();
    }
  };

  /** Ensure the agent pill exists (no-op for Claude Code). */
  const ensurePill = () => {
    if (isExternalAgent) {
      State.upsertExternalAgent(agentId, validAgent!, agentColor(validAgent!));
      const t = State.tasks.find((x) => x.id === agentId);
      if (t && cwd) t.sessionCwd = cwd;
    } else {
      upsert(projectName, cwd);
    }
  };

  /** The pill goes back to rest: it stays for a pinned agent, goes for the rest. */
  const settle = () => {
    if (isExternalAgent && !State.isPinnedAgent(agentId)) {
      State.removeTask(agentId);
      return;
    }
    State.updateTask(agentId, "idle");
    State.setPillBadge(agentId, null);
    // VS Code's pill goes back to its projects once a reported command is old news.
    if (agentId === "agent_vscode") {
      const t = State.tasks.find((x) => x.id === agentId);
      if (t) {
        t.steps = [];
        t.stepDiffs = [];
        t.seq = 0;
        t.stepIndex = 0;
      }
    }
  };

  switch (name) {
    case "SessionStart":
      ensurePill();
      surface("overview", false);
      Sound.play("work");
      break;

    case "UserPromptSubmit": {
      ensurePill();
      State.updateTask(agentId, "thinking");
      // The field is `prompt`; reading `message` meant this step was always blank.
      const asked = payload.prompt ?? payload.message;
      if (asked) State.appendStep(agentId, asked.slice(0, 60));
      surface("overview", false);
      break;
    }

    case "PreToolUse": {
      const tool = payload.tool_name ?? "Tool";
      if (tool === "AskUserQuestion") {
        // The tagged copy is the relay waiting for an answer. The plain copy,
        // from the general hook, is ignored: a question is not "working".
        if (payload.coucou_ask) {
          handleQuestion(island, payload, projectName, cwd, isExternalAgent);
          return;
        }
        break;
      }
      ensurePill();
      State.updateTask(agentId, "working");
      State.appendStep(agentId, stepLabel(tool, payload.tool_input ?? {}));
      surface("overview", false);
      break;
    }

    case "PostToolUse":
      State.updateTask(agentId, "working");
      if (payload.tool_name && EDIT_TOOLS.has(payload.tool_name)) {
        recordDiff(agentId, payload.tool_name, payload.tool_input ?? {});
      }
      break;

    case "PostToolUseFailure":
      State.updateTask(agentId, "working");
      State.appendStep(agentId, "⚠ falló");
      break;

    case "Notification": {
      const message = payload.message ?? "";
      const lower = message.toLowerCase();
      if (lower.includes("rate limit") || lower.includes("limite d")) {
        State.updateTask(agentId, "ratelimit");
        Sound.play("rate");
      } else if (message.endsWith("?")) {
        State.updateTask(agentId, "question");
        State.appendStep(agentId, message);
      }
      break;
    }

    case "Stop":
      // An agent may report a single "finished" with no session before it (the
      // terminal does): make sure it has a pill to show it on.
      if (isExternalAgent) ensurePill();
      // A toast only when the island is not already open to say it.
      if (State.mode !== "expanded") {
        toast(
          `${isExternalAgent ? State.tasks.find((t) => t.id === agentId)?.name ?? validAgent : "Claude Code"} terminó`,
          payload.message ?? projectName,
        );
      }
      State.updateTask(agentId, "finished");
      if (payload.message) State.appendStep(agentId, payload.message.slice(0, 60));
      Sound.play("finish");
      if (State.focusId === agentId) surface("finished", true);
      else State.setPillBadge(agentId, "finished");
      window.setTimeout(settle, 5200);
      break;

    case "StopFailure":
      if (isExternalAgent) ensurePill();
      if (State.mode !== "expanded") {
        toast(
          `${isExternalAgent ? State.tasks.find((t) => t.id === agentId)?.name ?? validAgent : "Claude Code"} se detuvo por un error`,
          payload.message ?? projectName,
        );
      }
      State.updateTask(agentId, "error");
      if (payload.message) State.appendStep(agentId, payload.message.slice(0, 60));
      Sound.play("error");
      if (State.focusId === agentId) surface("error", true);
      else State.setPillBadge(agentId, "error");
      // An agent's failure is about one run: it does not stay red for ever.
      if (isExternalAgent) {
        window.setTimeout(() => {
          const t = State.tasks.find((x) => x.id === agentId);
          if (t?.state === "error") settle();
        }, 60_000);
      }
      break;

    case "SessionEnd":
      if (isExternalAgent) {
        if (State.isPinnedAgent(agentId)) {
          State.updateTask(agentId, "idle");
          const t = State.tasks.find((x) => x.id === agentId);
          if (t) {
            t.steps = [];
            t.stepDiffs = [];
            t.seq = 0;
            t.stepIndex = 0;
            t.pillBadge = null;
          }
        } else {
          State.removeTask(agentId);
        }
      } else {
        State.updateTask(agentId, "idle");
        clearSession();
      }
      break;

    case "SubagentStart":
      State.appendStep(agentId, "+ subagente");
      break;

    case "SubagentStop":
      State.appendStep(agentId, "• subagente listo");
      break;

    case "PermissionRequest": {
      // External agents do not get an approval card — showing one would look like
      // a Claude Code request. Decline immediately so the agent re-asks in its
      // terminal. Approval support for other agents will come with Codex support.
      if (isExternalAgent) {
        if (payload.request_id) void Bridge.approvalDecline(payload.request_id);
        break;
      }

      const requestId = payload.request_id ?? "";
      // Older Claude Code sends a question as a permission request. The island
      // answers questions from the dedicated hook, so this one goes back at once.
      if (payload.tool_name === "AskUserQuestion") {
        if (requestId) void Bridge.approvalDecline(requestId);
        break;
      }
      const tool = payload.tool_name ?? "Tool";
      const input = payload.tool_input ?? {};

      // A rule the person made with "Always" covers this exact kind of request:
      // answer it without a card. It is never silent — the step shows in the
      // ticker and the log keeps the rule's id — and removing the rule in
      // Settings puts the question back on the card.
      const covered = requestId ? matchRule(State.rules, tool, input, cwd) : undefined;
      if (covered) {
        void Bridge.log(`auto-allowed ${tool} by rule ${covered.id} (${covered.label})`);
        void Bridge.approvalDecision(requestId, "allow");
        upsert(projectName, cwd);
        State.appendStep(CLAUDE_ID, `✓ Permitido siempre · ${covered.label}`);
        break;
      }

      // One card, one request. A second one must never quietly replace the first
      // — that would leave a human staring at request B while request A waits for
      // a decision nobody can give. Hand it straight back to the terminal.
      if (
        (State.pendingApproval && State.pendingApproval.requestId !== requestId) ||
        State.pendingQuestion
      ) {
        if (requestId) void Bridge.approvalDecline(requestId);
        break;
      }
      upsert(projectName, cwd);
      if (pendingTimeout != null) window.clearTimeout(pendingTimeout);
      State.pendingApproval = {
        requestId,
        sessionId: payload.session_id ?? "",
        tool,
        command: approvalTarget(tool, input),
        rule: ruleFor(tool, input, cwd),
      };
      // The relay's short ack window closes in 800 ms; everything below this
      // line is synchronous, so the card really is up by the time it lands.
      if (requestId) void Bridge.approvalAck(requestId);
      void Bridge.setDecisionShortcuts(true);
      toast("Claude Code pide permiso", State.pendingApproval.command);
      State.updateTask(CLAUDE_ID, "approval");
      State.isPinned = true;
      Sound.play("approval");
      if (focused) {
        island.alert("approval");
      } else {
        // Another agent holds the view, so the card would yank it away. The badge
        // is the signal instead — but it has to be on screen for that to mean
        // anything, hence the reveal. We just told the relay a human can act.
        State.setPillBadge(CLAUDE_ID, "approval");
        island.reveal();
      }
      // Coucou answers within 108 s or not at all; after that the terminal has
      // taken over and the card would be lying.
      pendingTimeout = window.setTimeout(() => {
        pendingTimeout = null;
        if (!State.pendingApproval) return;
        void Bridge.setDecisionShortcuts(false);
        State.pendingApproval = null;
        State.isPinned = false;
        island.dropPin();
        State.updateTask(CLAUDE_ID, "working");
        State.setPillBadge(CLAUDE_ID, null);
        if (State.view === "approval") island.setView(State.defaultView());
        State.notify();
      }, 110_000);
      break;
    }

    default:
      break;
  }
  State.notify();
}

/**
 * Claude is asking a question and `coucou-hook --ask` is waiting for the answer.
 * Same discipline as an approval: one card at a time, the relay told whether a
 * person can really act on it, and a fall-back to the terminal in every doubt.
 */
function handleQuestion(
  island: Island,
  payload: HookPayload,
  projectName: string,
  cwd: string,
  isExternalAgent: boolean,
) {
  const requestId = payload.request_id ?? "";
  const questions = parseQuestions(payload.tool_input);
  // Other agents get no card, as for approvals; unparsable questions and a card
  // already up go straight back to the terminal.
  if (isExternalAgent || !questions || !requestId || State.pendingQuestion || State.pendingApproval) {
    if (requestId) void Bridge.approvalDecline(requestId);
    return;
  }

  upsert(projectName, cwd);
  if (questionTimeout != null) window.clearTimeout(questionTimeout);
  State.pendingQuestion = { requestId, sessionId: payload.session_id ?? "", questions };
  void Bridge.approvalAck(requestId);
  toast("Claude Code tiene una pregunta", questions[0].question);
  State.updateTask(CLAUDE_ID, "question");
  State.isPinned = true;
  Sound.play("question");
  if (State.focusId === CLAUDE_ID) {
    island.alert("question");
  } else {
    State.setPillBadge(CLAUDE_ID, "approval");
    island.reveal();
  }
  questionTimeout = window.setTimeout(() => {
    questionTimeout = null;
    if (!State.pendingQuestion) return;
    State.pendingQuestion = null;
    State.isPinned = false;
    island.dropPin();
    State.updateTask(CLAUDE_ID, "working");
    State.setPillBadge(CLAUDE_ID, null);
    if (State.view === "question") island.setView(State.defaultView());
    State.notify();
  }, 125_000);
  State.notify();
}

/** The island answered (or the person chose the terminal): stop waiting. */
export function endQuestion() {
  if (questionTimeout != null) window.clearTimeout(questionTimeout);
  questionTimeout = null;
}
