// Entry point: boot the bridge, wire the island, start the greeting.

import { startRemote } from "./island/remote";
import "./style.css";
import { Bridge, IS_TAURI, onEvent } from "./core/bridge";
import { Sound } from "./core/sound";
import { State, type Settings } from "./core/state";
import { applyLanguage, uiLanguage } from "./core/i18n";
import { Island } from "./island/island";
import { registerHookHandlers } from "./island/hooks";
import { registerIntegrationHandlers, refreshConfigured } from "./island/integrations";
import type { Rule } from "./island/rules";

async function main() {
  const root = document.getElementById("root");
  if (!root) return;

  void Sound.preload();

  const island = new Island(root);

  const boot = await Bridge.boot();
  if (boot) {
    State.settings = { ...State.settings, ...boot.settings };
    State.detectedName = boot.detectedName ?? "";
  }
  island.applySettings();
  island.syncListening();
  applyLanguage(State.settings.language);
  void Bridge.setUiLanguage(uiLanguage());
  State.loadIntegrationTasks();
  State.applyStartPill();
  if (boot && !boot.cursorPoll) island.followPageCursor();

  await onEvent<{ x: number; y: number }>("cursor", ({ x, y }) => island.onCursor(x, y));

  /** Pause has to reach Rust too, or the pollers keep calling out. */
  const setPaused = (on: boolean) => {
    if (State.paused === on) return;
    State.paused = on;
    void Bridge.setPaused(on);
  };

  await onEvent<string>("tray", (what) => {
    switch (what) {
      case "settings":
        setPaused(false);
        island.alert("settings");
        break;
      case "open":
        setPaused(false);
        island.alert(State.defaultView());
        break;
      case "pause":
        setPaused(!State.paused);
        if (State.paused) island.fsm.forceHidden();
        else island.reveal();
        break;
    }
  });

  await onEvent<null>("screen-changed", () => void Bridge.reposition());

  // The phone link (Settings → Sincronización): sessions up, Allow / Deny down.
  startRemote(island, boot?.computerName ?? "PC");

  // Global shortcuts (Ctrl+Alt+Y / N / C), pressed in any other window.
  await onEvent<string>("shortcut", (name) => {
    if (name === "allow" || name === "deny") {
      island.decideApproval(name);
    } else if (name === "listen") {
      island.toggleListening();
    } else if (name === "toggle") {
      setPaused(false);
      island.toggleFromShortcut();
    }
  });

  // The settings window writes preferences; apply them here without a restart.
  await onEvent<Settings>("settings-changed", (s) => {
    // A different AI answers from here on: the old conversation means nothing to it.
    if (s.chatProvider !== State.settings.chatProvider) {
      State.chatHistory = [];
      void Bridge.chatReset();
    }
    const startChanged = s.startPill !== State.settings.startPill;
    const listeningChanged = s.wakeWord !== State.settings.wakeWord;
    State.settings = { ...State.settings, ...s };
    island.applySettings();
    if (listeningChanged) island.syncListening();
    applyLanguage(State.settings.language);
    void Bridge.setUiLanguage(uiLanguage());
    State.loadIntegrationTasks();
    // A new "first pill" applies right away when the island is not open on something else.
    if (startChanged && State.mode !== "expanded") State.applyStartPill();
    void refreshConfigured();
  });

  // The "Always allow" rules: loaded once, then kept in step with Settings.
  State.rules = (await Bridge.rulesList()) ?? [];
  await onEvent<Rule[]>("rules-changed", (rules) => {
    State.rules = rules;
  });

  registerHookHandlers(island);
  registerIntegrationHandlers(island);

  island.launch();

  // In a plain browser there is no wake strip behind the cursor: make the whole
  // page wake the island so the visuals can be checked with `npm run dev`.
  if (!IS_TAURI) {
    document.addEventListener("click", () => Sound.resume(), { once: true });
  }
}

void main();
