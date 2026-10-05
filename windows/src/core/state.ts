// App state — mirror of AppState.swift (the parts the island needs).

import type { BotEmoteName, BotStateName, IslandMode, IslandViewName } from "./layout";
import type { EyeShape } from "../mochi/engine";
import type { FileDiff } from "../island/diff";
import type { Rule, RuleDraft } from "../island/rules";

const MAX_DIFFS = 50;

export type AgentSource = "claudeCode" | "n8n" | "agent";
export type PillBadge = "approval" | "finished" | "error";

export interface AgentTask {
  id: string;
  name: string;
  color: string;
  state: BotStateName;
  stepIndex: number;
  steps: string[];
  /** Parallel to `steps`: the live diff behind a step, when it has one. */
  stepDiffs?: (string | null)[];
  /** How many steps this session has appended in total (`steps` keeps the last 20). */
  seq?: number;
  source: AgentSource;
  isIntegration: boolean;
  emote?: BotEmoteName | null;
  miniEye?: EyeShape | null;
  pillBadge?: PillBadge | null;
  sessionCwd?: string | null;
  /** Process chain of the session (nearest first), to find its terminal window. */
  sessionPids?: number[] | null;
}

export interface ApprovalInfo {
  requestId: string;
  sessionId: string;
  tool: string;
  command: string;
  /** What the "Always" button would remember; null when this request cannot be. */
  rule?: RuleDraft | null;
}

/** One question from Claude (AskUserQuestion): 2–4 options, optionally several. */
export interface AskQuestion {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
}

export interface PendingQuestion {
  requestId: string;
  sessionId: string;
  questions: AskQuestion[];
}

/** One rolling window of the Claude plan (`five_hour` or `seven_day`). */
export interface PlanWindow {
  /** 0–100. */
  used: number;
  /** Epoch seconds when the window resets. */
  resetsAt: number | null;
}

export interface PlanUsage {
  fiveHour: PlanWindow | null;
  sevenDay: PlanWindow | null;
  /** performance.now()-independent: Date.now() of the last update. */
  updatedAt: number;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
}

export type PromptContext =
  | { kind: "window"; appName: string; title: string; url?: string }
  | { kind: "file"; name: string; path?: string };

export interface ResultItem {
  label: string;
  detail: string;
  url?: string;
}

export interface SearchResult {
  title: string;
  items: ResultItem[];
  note?: string;
}

const task = (
  id: string, name: string, color: string, source: AgentSource,
): AgentTask => ({
  id, name, color, state: "idle", stepIndex: 0, steps: [], source, isIntegration: true,
});

/** AgentTask.integrationAgents — same ids, names and colours as macOS. */
export const INTEGRATION_AGENTS: AgentTask[] = [
  // The pill for Claude Code sessions. (The original app labels it "VS Code";
  // v2 says what it is. The id is a stable contract and does not change.)
  task("integration_claude", "Claude Code", "#F5F6F8", "claudeCode"),
  task("integration_resend", "Resend", "#22C55E", "n8n"),
  task("integration_n8n", "n8n", "#F29B38", "n8n"),
  task("integration_vercel", "Vercel", "#7C5CFF", "n8n"),
  task("integration_github", "GitHub", "#F4505E", "n8n"),
  task("integration_notion", "Notion", "#8C8C8C", "n8n"),
  task("integration_calcom", "Cal.com", "#C9956A", "n8n"),
  task("integration_stripe", "Stripe", "#0570DE", "n8n"),
  // Other agents next to Claude Code. Their ids are the contract the relay's
  // `--agent <name>` produces (agent_<name>); the colours follow the Mac catalog.
  task("agent_gemini", "Gemini CLI", "#8AB4F8", "agent"),
  task("agent_opencode", "OpenCode", "#FACC15", "agent"),
  task("agent_terminal", "Terminal", "#F472B6", "agent"),
];

export const TOGGLEABLE_INTEGRATION_IDS = [
  "integration_resend", "integration_n8n", "integration_vercel", "integration_github",
  "integration_notion", "integration_calcom", "integration_stripe",
  "agent_gemini", "agent_opencode", "agent_terminal",
];

/** The agents that have a pill of their own to switch on in Settings. */
export const KNOWN_AGENT_IDS = ["agent_gemini", "agent_opencode", "agent_terminal"];

/** What an integration poller last reported. */
export interface IntegrationInfo {
  data: Record<string, unknown>;
  error: string | null;
  loaded: boolean;
  configured: boolean;
}

export interface Settings {
  soundEnabled: boolean;
  soundVolume: number;
  autoCloseInterval: number;
  absenceInterval: number;
  activeIntegrations: string[];
  screen: "primary" | "cursor";
  autostart: boolean;
  hooksInstalled: boolean;
  /** Claude model used by the chat. */
  model: string;
  /** The name Mochi greets you by; empty means the one detected on this PC. */
  userName: string;
  /** Say hello (with your name) when Coucou starts. */
  greetingEnabled: boolean;
  /** `{name}` is replaced by your name. */
  greetingTemplate: string;
  greetingLanguage: "auto" | "es" | "en";
  /** Who answers the chat: Claude, or the company's DEVMARK AI. */
  chatProvider: "anthropic" | "devmark";
  /** Model asked of DEVMARK AI, and the longest reply it may write. */
  devmarkModel: string;
  devmarkMaxTokens: number;
  /** Show the plan usage pill in the island's header. */
  planGauge: boolean;
  nativeNotifications: boolean;
  globalShortcuts: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  soundVolume: 0.12,
  autoCloseInterval: 15,
  absenceInterval: 180,
  activeIntegrations: ["integration_github"],
  screen: "primary",
  autostart: false,
  hooksInstalled: false,
  model: "claude-opus-5",
  userName: "",
  greetingEnabled: true,
  greetingTemplate: "Hola {name}",
  greetingLanguage: "auto",
  chatProvider: "anthropic",
  devmarkModel: "llama3.2:1b",
  devmarkMaxTokens: 400,
  planGauge: false,
  nativeNotifications: true,
  globalShortcuts: true,
};

type Listener = () => void;

class AppState {
  mode: IslandMode = "hidden";
  view: IslandViewName = "overview";

  tasks: AgentTask[] = [];
  focusId: string | null = null;

  stateOverride: BotStateName | null = null;

  /** Cursor in logical screen pixels, origin top-left (like AppState.mousePosition). */
  mouse = { x: 0, y: 0 };
  /** Cursor relative to the island's top-left corner. */
  mouseInIsland = { x: 0, y: 0 };

  isPinned = false;
  paused = false;

  uploadProgress = 0;
  uploadDuration = 2.4;
  fileDragOver = false;

  promptContext: PromptContext | null = null;
  droppedFile: { name: string; path: string } | null = null;
  noteMessage: string | null = null;
  searchResult: SearchResult | null = null;
  chatHistory: ChatMessage[] = [];
  pendingApproval: ApprovalInfo | null = null;
  pendingQuestion: PendingQuestion | null = null;

  /** Plan usage from the statusLine relay; null until Claude Code reports it. */
  plan: PlanUsage | null = null;
  /** The header pill was clicked: the plan card replaces the current one. */
  showingPlanDetail = false;

  /** The account's name as detected by Rust, used when no name is set. */
  detectedName = "";

  /** The "Always allow" rules, as stored by Rust. */
  rules: Rule[] = [];

  /** Live diffs, newest last. See island/diff.ts. */
  diffs = new Map<string, FileDiff>();
  openDiffId: string | null = null;

  integrations: Record<string, IntegrationInfo> = {};

  lastActivity = performance.now();

  settings: Settings = { ...DEFAULT_SETTINGS };

  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Marks the UI dirty; the island re-renders on the next frame. */
  notify() {
    for (const fn of this.listeners) fn();
  }

  get focusTask(): AgentTask | null {
    return this.tasks.find((t) => t.id === this.focusId) ?? this.tasks[0] ?? null;
  }

  get effectiveState(): BotStateName {
    return this.stateOverride ?? this.focusTask?.state ?? "idle";
  }

  get otherTasks(): AgentTask[] {
    return this.tasks.filter((t) => t.id !== this.focusId);
  }

  setFocus(id: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    this.focusId = id;
    t.pillBadge = null;
    this.notify();
  }

  updateTask(id: string, state: BotStateName) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.state = state;
    this.notify();
  }

  appendStep(id: string, step: string, diffId: string | null = null) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    const diffs = (t.stepDiffs ??= []);
    // Keep the parallel array the same length as `steps` before touching either.
    while (diffs.length < t.steps.length) diffs.push(null);
    t.steps.push(step);
    diffs.push(diffId);
    t.seq = (t.seq ?? t.steps.length - 1) + 1;
    if (t.steps.length > 20) {
      t.steps.shift();
      diffs.shift();
    }
    t.stepIndex = t.steps.length - 1;
    this.notify();
  }

  /**
   * The edit finished: the step that announced it now carries its +N −M and the
   * diff behind it. Falls back to a new step when the announcing one is gone.
   */
  finishEditStep(id: string, announced: string, step: string, diffId: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    const at = t.steps.lastIndexOf(announced);
    if (at < 0) {
      this.appendStep(id, step, diffId);
      return;
    }
    const diffs = (t.stepDiffs ??= []);
    while (diffs.length < t.steps.length) diffs.push(null);
    t.steps[at] = step;
    diffs[at] = diffId;
    this.notify();
  }

  /** Newest 50 diffs per app run; the rest are forgotten, as on the Mac. */
  addDiff(diff: FileDiff) {
    this.diffs.set(diff.id, diff);
    while (this.diffs.size > MAX_DIFFS) {
      const oldest = this.diffs.keys().next().value;
      if (oldest === undefined) break;
      this.diffs.delete(oldest);
    }
  }

  clearDiffs() {
    this.diffs.clear();
    this.openDiffId = null;
    for (const t of this.tasks) t.stepDiffs = [];
  }

  setPillBadge(id: string, badge: PillBadge | null) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.pillBadge = badge;
    this.notify();
  }

  /** loadIntegrationTasks() — VS Code always on, the rest opt-in (max 4). */
  loadIntegrationTasks() {
    for (const proto of INTEGRATION_AGENTS) {
      const shouldLoad =
        proto.id === "integration_claude" || this.settings.activeIntegrations.includes(proto.id);
      const idx = this.tasks.findIndex((t) => t.id === proto.id);
      if (shouldLoad && idx < 0) this.tasks.push({ ...proto, steps: [] });
      if (!shouldLoad && idx >= 0) this.tasks.splice(idx, 1);
    }
    // Order: integration_claude first, then agent_* pills (visible in slice(0,4)),
    // then other integrations in declaration order.
    const order = INTEGRATION_AGENTS.map((t) => t.id);
    this.tasks.sort((a, b) => {
      const isAgentA = a.id.startsWith("agent_");
      const isAgentB = b.id.startsWith("agent_");
      // integration_claude always first
      if (a.id === "integration_claude") return -1;
      if (b.id === "integration_claude") return 1;
      // agent_* before other integrations; preserve insertion order among themselves
      if (isAgentA && !isAgentB) return -1;
      if (isAgentB && !isAgentA) return 1;
      if (isAgentA && isAgentB) return 0;
      // both known integrations → declaration order
      return order.indexOf(a.id) - order.indexOf(b.id);
    });
    if (!this.focusId) this.focusId = "integration_claude";
    this.notify();
  }

  removeTask(id: string) {
    const idx = this.tasks.findIndex((t) => t.id === id);
    if (idx < 0) return;
    this.tasks.splice(idx, 1);
    if (this.focusId === id) this.focusId = this.tasks[0]?.id ?? "integration_claude";
    this.notify();
  }

  /**
   * An agent pill the person switched on stays for good, idle between sessions;
   * any other agent (an unknown name, or one switched off) comes and goes with
   * its session.
   */
  isPinnedAgent(id: string): boolean {
    return KNOWN_AGENT_IDS.includes(id) && this.settings.activeIntegrations.includes(id);
  }

  /** Creates a dynamic agent_ pill on first event; no-ops if it already exists.
   *  Inserted right after integration_claude so it appears in the visible slice(0,4). */
  upsertExternalAgent(id: string, name: string, color: string) {
    if (this.tasks.some((t) => t.id === id)) return;
    const at = this.tasks.findIndex((t) => t.id === "integration_claude") + 1;
    this.tasks.splice(at, 0, {
      id, name, color,
      state: "idle", stepIndex: 0, steps: [],
      source: "agent", isIntegration: false,
    });
    if (!this.focusId) this.focusId = id;
    this.notify();
  }

  toggleIntegration(id: string) {
    if (id === "integration_claude") return;
    const active = this.settings.activeIntegrations;
    if (active.includes(id)) {
      this.settings.activeIntegrations = active.filter((x) => x !== id);
      if (this.focusId === id) this.focusId = "integration_claude";
    } else {
      if (active.length >= 4) return;
      this.settings.activeIntegrations = [...active, id];
    }
    this.loadIntegrationTasks();
  }

  defaultView(): IslandViewName {
    return this.tasks.length === 0 ? "empty" : "overview";
  }
}

export const State = new AppState();
