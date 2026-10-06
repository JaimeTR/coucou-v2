// Thin wrapper over the Tauri commands/events. Every call is a no-op when the
// page is opened in a plain browser, so the island can be iterated on with
// `npm run dev` alone.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { ProjectInfo, Settings } from "./state";
import type { Rule, RuleDraft } from "../island/rules";

export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!IS_TAURI) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    console.error(`[coucou] ${cmd} failed`, err);
    return null;
  }
}

export interface BootInfo {
  settings: Settings;
  /** Logical screen rect of the monitor the island lives on. */
  screen: { x: number; y: number; width: number; height: number; scale: number };
  version: string;
  hookPath: string;
  /** False where the OS has no global cursor (Wayland): see Island.followPageCursor. */
  cursorPoll: boolean;
  /** The name found for this account (display name, else git identity). */
  detectedName: string;
}

export interface AgentStatus {
  /** "gemini", "opencode" or "terminal". */
  id: string;
  name: string;
  /** The tool is on this computer. */
  detected: boolean;
  /** Coucou's part is in place. */
  installed: boolean;
  /** What would be changed. */
  target: string;
}

export interface DetectedTool {
  id: string;
  name: string;
  found: boolean;
}

export const Bridge = {
  boot: () => call<BootInfo>("boot"),

  /** Recent projects (paths only, read-only) for the Claude Code and VS Code cards. */
  claudeProjects: () => call<ProjectInfo[]>("claude_projects"),
  vscodeProjects: () => call<ProjectInfo[]>("vscode_projects"),

  /** Which of the tools Coucou knows are installed on this computer. */
  detectTools: () => call<DetectedTool[]>("detect_tools"),

  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),

  /** Shrink the window down to the invisible wake strip (hidden) or back to full. */
  setCollapsed: (collapsed: boolean) => call<void>("set_collapsed", { collapsed }),

  /**
   * Pushes the island shape in window coordinates. Rust flips click-through from
   * its own cursor poll, so the flag is never a frame behind a click.
   */
  setIslandRect: (x: number, y: number, width: number, height: number) =>
    call<void>("set_island_rect", { x, y, width, height }),

  /** Give the window keyboard focus (chat field) and take it away again. */
  focusWindow: (focused: boolean) => call<void>("focus_window", { focused }),

  reposition: () => call<void>("reposition"),

  openUrl: (url: string) => call<void>("open_url", { url }),

  /** "Open terminal" → opens the folder in VS Code when `code` is on PATH. */
  openInVSCode: (path: string | null) => call<boolean>("open_in_vscode", { path }),
  openAgentApp: (agent: "opencode" | "gemini" | "antigravity" | "antigravity-ide") => call<boolean>("open_agent_app", { agent }),
  setUiLanguage: (lang: "es" | "en") => call<void>("set_ui_language", { lang }),
  launchAgent: (agent: "claude" | "opencode" | "gemini" | "agy", path: string | null, resume: boolean) =>
    call<boolean>("launch_agent", { agent, path, resume }),

  // ── "Always allow" rules ──────────────────────────────────────────────────
  rulesList: () => call<Rule[]>("rules_list"),
  /** Only from the "Always" button: the person's own, explicit click. */
  rulesAdd: (draft: RuleDraft) => callOrThrow<Rule>("rules_add", { ...draft }),
  rulesRemove: (id: string) => callOrThrow<void>("rules_remove", { id }),

  // ── Other agents (Gemini CLI, OpenCode, your terminal) ────────────────────
  agentsStatus: () => call<AgentStatus[]>("agents_status"),
  /** The diff to look at before anything is written; `install: false` previews removal. */
  agentsPreview: (id: string, install: boolean) => callOrThrow<HookPreview>("agents_preview", { id, install }),
  /** Writes it — only after an explicit click, and only if nothing changed since the preview. */
  agentsApply: (id: string, install: boolean, fingerprint: string) =>
    callOrThrow<string>("agents_apply", { id, install, fingerprint }),

  /** Ctrl+Alt+Y / N are registered only while a permission card is up. */
  setDecisionShortcuts: (active: boolean) => call<void>("set_decision_shortcuts", { active }),

  /** A Windows toast; Rust checks the setting and keeps the text short. */
  notify: (title: string, body: string) => call<void>("notify", { title, body }),

  /** Brings forward the terminal window a session runs in; false if none was found. */
  focusTerminal: (pids: number[]) => call<boolean>("focus_terminal", { pids }),

  /** The ↗ on the diff card: opens one edited file in VS Code, at its path. */
  openFile: (path: string) => call<boolean>("open_file_in_vscode", { path }),

  quit: () => call<void>("quit_app"),

  openSettingsWindow: () => call<void>("open_settings_window"),

  /** Writes to %LOCALAPPDATA%\Coucou\coucou.log, next to the Rust lines. */
  log: (message: string) => call<void>("log_line", { message }),

  // ── Claude Code hooks ─────────────────────────────────────────────────────
  hooksStatus: () => call<HookStatus>("hooks_status"),
  /** Diff to show before anything is written. `install: false` previews removal. */
  hooksPreview: (install: boolean) => callOrThrow<HookPreview>("hooks_preview", { install }),
  /**
   * Writes ~/.claude/settings.json — only ever after an explicit click, and only
   * when the file still matches the preview the user looked at.
   */
  hooksApply: (install: boolean, fingerprint: string) =>
    callOrThrow<string>("hooks_apply", { install, fingerprint }),

  /** Plan usage relay (statusLine): same diff-then-click flow as the hooks. */
  statuslinePreview: (install: boolean) =>
    callOrThrow<HookPreview>("statusline_preview", { install }),
  statuslineApply: (install: boolean, fingerprint: string) =>
    callOrThrow<string>("statusline_apply", { install, fingerprint }),

  /** Answer to a question from Claude: the answers, or null for "reply in the terminal". */
  questionAnswer: (requestId: string, answers: Record<string, string | string[]> | null) =>
    call<void>("question_answer", {
      requestId,
      reply: answers ? JSON.stringify({ decision: "answer", answers }) : "ask",
    }),

  approvalDecision: (requestId: string, decision: "allow" | "deny") =>
    call<void>("approval_decision", { requestId, decision }),
  /** "The card is up" — until this lands the relay only waits a moment. */
  approvalAck: (requestId: string) => call<void>("approval_ack", { requestId }),
  /** "Nobody can act on this" — Claude Code asks in the terminal right away. */
  approvalDecline: (requestId: string) => call<void>("approval_decline", { requestId }),

  // ── Chat, files, secrets ──────────────────────────────────────────────────
  /** One chat turn. The API key and any file bytes never leave Rust. */
  chatSend: (query: string, context: ChatContext | null) =>
    callOrThrow<{ text: string }>("chat_send", { query, context }),
  chatReset: () => call<void>("chat_reset"),
  /** Settings → Chat provider → Test connection (devmark, gemini or groq). Generates nothing. */
  providerTest: (id: string) => callOrThrow<{ ok: boolean; message: string }>("provider_test", { id }),
  /** Copies a dropped file into the inbox. */
  ingestFile: (path: string) => callOrThrow<DroppedFile>("ingest_file", { path }),
  /** Only ever tells you whether a key exists — never its value. */
  secretPresent: (key: string) => call<boolean>("secret_present", { key }),
  secretSet: (key: string, value: string) => callOrThrow<void>("secret_set", { key, value }),
  secretClear: (key: string) => callOrThrow<void>("secret_clear", { key }),

  // ── Integrations ──────────────────────────────────────────────────────────
  refreshIntegration: (id: string) => call<void>("refresh_integration", { id }),

  /** Tray → Pause. Stops the integration pollers, not just the island. */
  setPaused: (paused: boolean) => call<void>("set_paused", { paused }),
};

export interface IntegrationUpdate {
  id: string;
  data: Record<string, unknown>;
  error: string | null;
  event: { success: boolean; label: string; detail: string | null } | null;
}

export type ChatContext =
  | { kind: "file"; name: string; path: string }
  | { kind: "window"; appName: string; title: string; url?: string };

export interface DroppedFile {
  name: string;
  path: string;
  size: number;
}

export interface HookStatus {
  installed: boolean;
  /** Hooks from an older build: the one that answers Claude's questions is missing. */
  outdated: boolean;
  statuslineInstalled: boolean;
  settingsPath: string;
  hookPath: string;
  hookReady: boolean;
}

export interface HookPreview {
  diff: string;
  backup: string;
  settingsPath: string;
  /** Hand back to hooksApply so only the reviewed diff is ever written. */
  fingerprint: string;
}

/** Same as `call`, but surfaces the error so the UI can show what went wrong. */
async function callOrThrow<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI) throw new Error("no se está ejecutando dentro de Coucou");
  return invoke<T>(cmd, args);
}

export type BridgeEvent =
  | { name: "cursor"; payload: { x: number; y: number } }
  | { name: "tray"; payload: string }
  | { name: "hook"; payload: Record<string, unknown> }
  | { name: "screen-changed"; payload: null };

export interface DragDropPayload {
  type: "enter" | "over" | "drop" | "leave";
  paths?: string[];
}

/** Files dragged onto the island. Only reaches us when the window takes the mouse. */
export async function onDragDrop(handler: (e: DragDropPayload) => void) {
  if (!IS_TAURI) return () => {};
  return getCurrentWebview().onDragDropEvent((event) => {
    handler(event.payload as DragDropPayload);
  });
}

export async function onEvent<T>(name: string, handler: (payload: T) => void) {
  if (!IS_TAURI) return () => {};
  return listen<T>(name, (e) => handler(e.payload));
}
