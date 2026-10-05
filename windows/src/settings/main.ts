// Settings window — the place where anything that writes to disk is confirmed.
// Stage 2 covers the Claude Code hooks and the general preferences; API keys and
// integrations land here too in a later stage.

import "./settings.css";
import { Bridge, onEvent, type AgentStatus, type DetectedTool, type HookStatus } from "../core/bridge";
import { greetingLines } from "../island/greetingText";
import { DEFAULT_SETTINGS, type Settings } from "../core/state";
import { h, clear } from "../views/dom";
import type { Rule } from "../island/rules";

let settings: Settings = { ...DEFAULT_SETTINGS };
let version = "";
let detectedName = "";

const root = document.getElementById("settings-root")!;

async function save() {
  await Bridge.saveSettings(settings);
}

// ── Reusable bits ─────────────────────────────────────────────────────────────

function toggle(on: boolean, onChange: (v: boolean) => void): HTMLElement {
  const el = h("button", { class: on ? "switch on" : "switch", "aria-pressed": on });
  el.addEventListener("click", () => {
    const next = !el.classList.contains("on");
    el.classList.toggle("on", next);
    onChange(next);
  });
  return el;
}

function statusDot(ok: boolean): HTMLElement {
  return h("i", { class: "dot", style: `background:${ok ? "#22c55e" : "#f4505e"}` });
}

function renderDiff(text: string): HTMLElement {
  const box = h("div", { class: "diff" });
  for (const line of text.split("\n")) {
    const cls = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
    box.append(h("div", { class: cls, text: line }));
  }
  return box;
}

// ── Setup checklist ───────────────────────────────────────────────────────────

/**
 * The first thing in the window: what is connected, what is not, and what to do
 * about it — for the programs that are really installed on this computer.
 */
function setupSection(
  status: HookStatus,
  present: Record<string, boolean>,
  hasProviderKey: boolean,
  tools: DetectedTool[],
  detectedName: string,
  agents: AgentStatus[],
): HTMLElement {
  const list = h("div", { style: "display:flex;flex-direction:column;gap:9px" });
  const found = (id: string) => tools.some((t) => t.id === id && t.found);

  const item = (ok: boolean, title: string, hint: string, action?: HTMLElement) =>
    h("div", { class: "row", style: "align-items:flex-start;gap:9px" },
      statusDot(ok),
      h("div", { style: "flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px" },
        h("span", { style: "font-size:12.5px", text: title }),
        h("span", { class: "hint", text: hint }),
      ),
      action ?? "",
    );

  const claudeFound = found("claude");
  list.append(
    item(
      status.installed && !status.outdated,
      "Claude Code connected",
      status.installed
        ? status.outdated
          ? "Hooks from an older version — update them in the Claude Code section below."
          : "Sessions, permissions and questions show up in the island."
        : claudeFound
          ? "Claude Code is on this PC but Coucou isn't hooked in yet: use “Install hooks…” in the Claude Code section below."
          : "Install the hooks (Claude Code section below) to see your sessions in the island.",
    ),
    // The other agents: only the ones that are on this PC (the terminal always is).
    ...agents
      .filter((a) => a.detected || a.installed)
      .map((a) =>
        item(
          a.installed,
          a.name,
          a.installed
            ? "Connected — it has its own pill."
            : `Found on this PC but not connected: use “Connect…” under Agents below.`,
        ),
      ),
    item(
      present["github-token"] ?? false,
      "GitHub",
      present["github-token"]
        ? "Token saved — your pull requests and CI show up in the GitHub pill."
        : "Create a token (read access to pull requests and commit statuses), then paste it under Integrations → GitHub.",
      present["github-token"]
        ? undefined
        : h("button", {
            text: "Create token",
            onclick: () => void Bridge.openUrl("https://github.com/settings/personal-access-tokens/new"),
          }),
    ),
    item(
      hasProviderKey,
      settings.chatProvider === "devmark" ? "Chat with DEVMARK AI" : "Chat with Claude",
      hasProviderKey
        ? "Key saved in the Windows Credential Manager."
        : settings.chatProvider === "devmark"
          ? "Paste your dmk_… key under Chat provider."
          : "Paste your Anthropic API key under Claude, or pick DEVMARK AI under Chat provider.",
    ),
    item(
      !!(settings.userName.trim() || detectedName),
      "Your name",
      settings.userName.trim()
        ? `Mochi greets you as “${settings.userName.trim()}”.`
        : detectedName
          ? `Detected “${detectedName}”. You can change it under Personalization.`
          : "Set it under Personalization so Mochi can greet you.",
    ),
    item(
      status.statuslineInstalled,
      "Plan usage (optional)",
      status.statuslineInstalled
        ? "The relay is installed."
        : "Install the relay under Plan usage to see how much of your Claude plan is left.",
    ),
  );

  const chips = h("div", { style: "display:flex;flex-wrap:wrap;gap:6px" });
  for (const tool of tools) {
    chips.append(h("span", {
      class: "hint",
      style: `padding:3px 9px;border-radius:999px;border:1px solid rgba(255,255,255,0.12);${tool.found ? "color:#d8dbe0" : "opacity:0.45;text-decoration:line-through"}`,
      text: tool.name,
    }));
  }

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Setup" })),
    h("div", { class: "hint", text: "What is ready and what is left, for the programs on this computer." }),
    list,
    h("div", { class: "hint", text: "Detected on this PC" }),
    chips,
  );
}

// ── Agents: Gemini CLI, OpenCode, your terminal ───────────────────────────────

interface AgentDef {
  /** The id the app uses ("gemini"); its pill is `agent_<id>`. */
  id: string;
  color: string;
  /** What connecting it changes, in plain words. */
  what: string;
  /** Said when the tool itself is not on this PC. */
  missing: string;
}

const AGENTS: AgentDef[] = [
  {
    id: "gemini", color: "#8AB4F8",
    what: "Adds Coucou's hooks to ~/.gemini/settings.json, so Gemini CLI sessions show up in its pill.",
    missing: "Gemini CLI wasn't found on this PC. You can still connect it for when you install it.",
  },
  {
    id: "opencode", color: "#FACC15",
    what: "Adds a small plugin (coucou.js) to ~/.config/opencode/plugins. It needs nothing else.",
    missing: "OpenCode wasn't found on this PC. You can still connect it for when you install it.",
  },
  {
    id: "terminal", color: "#F472B6",
    what: "Adds a block to your PowerShell profile. When a command that took 10 seconds or more finishes, the Terminal pill (and a notification) tells you whether it worked.",
    missing: "",
  },
];

/**
 * Connecting an agent writes to a file of that tool, so it follows the rule used
 * for Claude Code's settings.json: the exact diff, a dated backup, and a write
 * only after a click. Disconnecting removes Coucou's part and nothing else.
 */
function agentsSection(initial: AgentStatus[]): HTMLElement {
  const note = h("div", { class: "hint" });
  const list = h("div", { style: "display:flex;flex-direction:column;gap:18px" });
  const statuses = new Map(initial.map((s) => [s.id, s]));

  function updateNote() {
    const used = settings.activeIntegrations.length;
    note.textContent = `Each agent gets its own pill next to Mochi (${used}/${MAX_ACTIVE} pills in use). Connecting one changes a file of that tool, with a preview first.`;
  }

  function drawAgent(def: AgentDef, box: HTMLElement) {
    const status = statuses.get(def.id);
    const pillId = `agent_${def.id}`;
    clear(box);

    const sw = h("button", { class: settings.activeIntegrations.includes(pillId) ? "switch on" : "switch" });
    sw.addEventListener("click", () => {
      const on = settings.activeIntegrations.includes(pillId);
      if (on) {
        settings.activeIntegrations = settings.activeIntegrations.filter((x) => x !== pillId);
      } else {
        if (settings.activeIntegrations.length >= MAX_ACTIVE) return;
        settings.activeIntegrations = [...settings.activeIntegrations, pillId];
      }
      sw.classList.toggle("on", !on);
      updateNote();
      void save();
    });

    const connected = status?.installed ?? false;
    box.append(
      h("div", { class: "row" },
        sw,
        h("i", { class: "dot", style: `background:${def.color}` }),
        h("span", { style: "font-size:12.5px;min-width:140px", text: status?.name ?? def.id }),
        statusDot(connected),
        h("span", { class: "hint", text: connected ? "Connected" : "Not connected" }),
      ),
      h("div", { class: "hint", text: def.what }),
    );
    if (status && !status.detected && def.missing) box.append(h("div", { class: "hint", text: def.missing }));

    const actions = h("div", { class: "row" });
    actions.append(h("button", {
      class: "primary",
      text: connected ? "Reconnect…" : "Connect…",
      onclick: () => preview(def, box, true),
    }));
    if (connected) {
      actions.append(h("button", { class: "danger", text: "Disconnect…", onclick: () => preview(def, box, false) }));
    }
    box.append(actions);
  }

  async function preview(def: AgentDef, box: HTMLElement, install: boolean) {
    let plan;
    try {
      plan = await Bridge.agentsPreview(def.id, install);
    } catch (err) {
      // A file we cannot read, or one that is not ours, stops here untouched.
      clear(box);
      box.append(
        h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }),
        h("div", { class: "row" }, h("button", { text: "Back", onclick: () => drawAgent(def, box) })),
      );
      return;
    }
    clear(box);
    box.append(
      h("div", {
        class: "hint",
        text: install
          ? "This is exactly what will change. Everything else in those files is left untouched."
          : "This removes Coucou's part only. Everything else in those files is left untouched.",
      }),
      renderDiff(plan.diff),
      h("div", { class: "row" }, h("span", { class: "path", text: `Backup → ${plan.backup}` })),
    );
    const confirm = h("button", {
      class: install ? "primary" : "danger",
      text: install ? "Back up and write" : "Back up and remove",
    });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        await Bridge.agentsApply(def.id, install, plan.fingerprint);
        const fresh = await Bridge.agentsStatus();
        for (const s of fresh ?? []) statuses.set(s.id, s);
        clear(box);
        box.append(h("div", {
          class: "notice ok",
          text: install
            ? "Connected. Start a new session in that tool to see it in its pill."
            : "Disconnected.",
        }));
        window.setTimeout(() => drawAgent(def, box), 2600);
      } catch (err) {
        confirm.disabled = false;
        box.append(h("div", { class: "notice err", text: `Could not write: ${String(err).replace(/^Error:\s*/, "")}` }));
      }
    });
    box.append(h("div", { class: "row" }, confirm, h("button", {
      text: "Cancel",
      onclick: () => drawAgent(def, box),
    })));
  }

  for (const def of AGENTS) {
    const box = h("div", { style: "display:flex;flex-direction:column;gap:8px" });
    list.append(box);
    drawAgent(def, box);
  }
  updateNote();
  return h("section", {}, h("h2", {}, h("span", { text: "Agents" })), note, list);
}

// ── Personalization ───────────────────────────────────────────────────────────

function personalSection(detectedName: string): HTMLElement {
  const preview = h("div", { class: "notice ok" });
  const refresh = () => {
    const lines = greetingLines({
      name: settings.userName.trim() || detectedName,
      template: settings.greetingTemplate,
      language: settings.greetingLanguage,
      now: new Date(),
      systemLanguage: navigator.language || "en",
    });
    preview.textContent = `${lines.title} — ${lines.sub}`;
  };

  const name = h("input", {
    type: "text",
    value: settings.userName,
    placeholder: detectedName || "Your name",
    style: "flex:1 1 auto;min-width:0",
    spellcheck: "false",
  }) as HTMLInputElement;
  name.addEventListener("change", () => {
    settings.userName = name.value.trim();
    void save();
    refresh();
  });
  const useDetected = h("button", {
    text: "Use detected",
    title: detectedName ? `“${detectedName}”` : "No name could be detected",
    onclick: () => {
      name.value = "";
      settings.userName = "";
      void save();
      refresh();
    },
  });
  if (!detectedName) (useDetected as HTMLButtonElement).disabled = true;

  const template = h("input", {
    type: "text",
    value: settings.greetingTemplate,
    placeholder: "Hola {name}",
    style: "flex:1 1 auto;min-width:0",
    spellcheck: "false",
  }) as HTMLInputElement;
  template.addEventListener("change", () => {
    settings.greetingTemplate = template.value.trim() || "Hola {name}";
    template.value = settings.greetingTemplate;
    void save();
    refresh();
  });

  const language = h("select", {}) as HTMLSelectElement;
  language.append(
    h("option", { value: "auto", text: "Automatic (system language)" }),
    h("option", { value: "es", text: "Español" }),
    h("option", { value: "en", text: "English" }),
  );
  language.value = settings.greetingLanguage;
  language.addEventListener("change", () => {
    settings.greetingLanguage = language.value as Settings["greetingLanguage"];
    void save();
    refresh();
  });

  refresh();
  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Personalization" })),
    h("div", { class: "hint", text: "When Coucou starts, Mochi says hello by name, with the time of day and today's date." }),
    h("div", { class: "row" },
      h("label", { text: "Say hello" }),
      toggle(settings.greetingEnabled, (v) => { settings.greetingEnabled = v; void save(); refresh(); }),
    ),
    h("div", { class: "row" }, h("label", { text: "Your name" }), name, useDetected),
    h("div", { class: "row" }, h("label", { text: "Greeting" }), template),
    h("div", { class: "hint", text: "{name} is replaced by your name. Example: ¡Hola {name}, bienvenido!" }),
    h("div", { class: "row" }, h("label", { text: "Language" }), language),
    preview,
  );
}

// ── Claude Code section ───────────────────────────────────────────────────────

function claudeSection(status: HookStatus): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const section = h(
    "section",
    {},
    h("h2", {}, statusDot(status.installed), h("span", { text: "Claude Code" })),
    body,
  );

  const rebuild = async () => {
    const fresh = await Bridge.hooksStatus();
    if (fresh) Object.assign(status, fresh);
    clear(body);
    draw();
    const head = section.querySelector("h2")!;
    clear(head);
    head.append(statusDot(status.installed), h("span", { text: "Claude Code" }));
  };

  function draw() {
    body.append(
      h("div", {
        class: "hint",
        text: status.installed
          ? "Coucou is hooked into your Claude Code sessions. Tool calls, questions and permission requests show up in the island, and you can answer them there."
          : "Install the hooks to see your Claude Code sessions in the island and approve permissions without leaving what you are doing.",
      }),
      h("div", { class: "row" },
        h("label", { text: "settings.json" }),
        h("span", { class: "path", text: status.settingsPath }),
      ),
      h("div", { class: "row" },
        h("label", { text: "Relay" }),
        h("span", { class: "path", text: status.hookPath }),
        statusDot(status.hookReady),
      ),
    );

    if (!status.hookReady) {
      body.append(h("div", {
        class: "notice warn",
        text: "coucou-hook.exe is not in place yet. Restart Coucou; if it still fails, build it with `cargo build -p coucou-hook`.",
      }));
    }

    // Hooks written by an older build lack the one that answers Claude's questions.
    if (status.installed && status.outdated) {
      body.append(h("div", {
        class: "notice warn",
        text: "Hooks outdated — update them to answer Claude's questions from the island.",
      }));
    }

    const actions = h("div", { class: "row" });
    const install = h("button", {
      class: "primary",
      text: !status.installed ? "Install hooks…" : status.outdated ? "Update hooks…" : "Reinstall hooks…",
      onclick: () => showPreview(true),
    });
    // Writing hook commands that point at a relay which isn't there would give
    // every Claude Code session a broken hook and nothing to show for it.
    if (!status.hookReady) {
      install.disabled = true;
      install.title = "The relay isn't installed yet.";
    }
    actions.append(install);
    if (status.installed) {
      actions.append(h("button", {
        class: "danger",
        text: "Uninstall hooks…",
        onclick: () => showPreview(false),
      }));
    }
    body.append(actions);
  }

  async function showPreview(install: boolean) {
    let preview;
    try {
      preview = await Bridge.hooksPreview(install);
    } catch (err) {
      // An unreadable or invalid settings.json stops here rather than being
      // treated as empty and written over.
      clear(body);
      body.append(
        h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }),
        h("div", { class: "row" }, h("button", {
          text: "Back",
          onclick: () => { clear(body); draw(); },
        })),
      );
      return;
    }
    if (!preview) return;
    clear(body);
    body.append(
      h("div", {
        class: "hint",
        text: install
          ? "This is exactly what will change in your settings.json. Your own hooks are left untouched."
          : "This removes Coucou's entries only. Your own hooks are left untouched.",
      }),
      renderDiff(preview.diff),
      h("div", { class: "row" },
        h("span", { class: "path", text: `Backup → ${preview.backup}` }),
      ),
    );
    const confirm = h("button", {
      class: install ? "primary" : "danger",
      text: install ? "Back up and write" : "Back up and remove",
    });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        const backup = await Bridge.hooksApply(install, preview.fingerprint);
        clear(body);
        body.append(h("div", {
          class: "notice ok",
          text: `Done. Previous settings saved as ${backup}. Open a new Claude Code session to pick the hooks up.`,
        }));
        window.setTimeout(() => void rebuild(), 2600);
      } catch (err) {
        confirm.disabled = false;
        body.append(h("div", { class: "notice err", text: `Could not write: ${String(err)}` }));
      }
    });
    body.append(h("div", { class: "row" }, confirm, h("button", {
      text: "Cancel",
      onclick: () => { clear(body); draw(); },
    })));
  }

  draw();
  return section;
}

// ── Plan usage section ────────────────────────────────────────────────────────

/**
 * The gauge needs a statusLine relay in ~/.claude/settings.json, so it goes
 * through the same rule as the hooks: the exact diff, the dated backup, and a
 * write only after a click. An existing statusLine of yours is kept and still
 * runs; uninstalling puts it back untouched.
 */
function planSection(status: HookStatus): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const section = h("section", {}, h("h2", {}, h("span", { text: "Plan usage" })), body);

  const rebuild = async () => {
    const fresh = await Bridge.hooksStatus();
    if (fresh) Object.assign(status, fresh);
    clear(body);
    draw();
  };

  function draw() {
    const installed = status.statuslineInstalled;
    const show = toggle(settings.planGauge, (v) => {
      settings.planGauge = v;
      void save();
      // Turning it on without the relay would show nothing: offer to install it.
      if (v && !status.statuslineInstalled) void showPreview(true);
    });
    body.append(
      h("div", {
        class: "hint",
        text: "A small pill in the island's header with how much of your Claude plan you have used (5-hour and 7-day windows). Claude Code only reports it on Pro and Max plans.",
      }),
      h("div", { class: "row" }, h("label", { text: "Show in the island" }), show),
      h("div", { class: "row" },
        h("label", { text: "Relay" }),
        h("span", { class: "hint", text: installed ? "Installed" : "Not installed" }),
        statusDot(installed),
      ),
    );
    const actions = h("div", { class: "row" });
    actions.append(h("button", {
      class: "primary",
      text: installed ? "Reinstall relay…" : "Install relay…",
      onclick: () => showPreview(true),
    }));
    if (installed) {
      actions.append(h("button", {
        class: "danger",
        text: "Uninstall relay…",
        onclick: () => showPreview(false),
      }));
    }
    body.append(actions);
  }

  async function showPreview(install: boolean) {
    let preview;
    try {
      preview = await Bridge.statuslinePreview(install);
    } catch (err) {
      clear(body);
      body.append(
        h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }),
        h("div", { class: "row" }, h("button", { text: "Back", onclick: () => { clear(body); draw(); } })),
      );
      return;
    }
    clear(body);
    body.append(
      h("div", {
        class: "hint",
        text: install
          ? "This is exactly what will change in your settings.json. If you already have a status line, it keeps running exactly as before."
          : "This removes Coucou's status line relay and puts yours back, if you had one.",
      }),
      renderDiff(preview.diff),
      h("div", { class: "row" }, h("span", { class: "path", text: `Backup → ${preview.backup}` })),
    );
    const confirm = h("button", {
      class: install ? "primary" : "danger",
      text: install ? "Back up and write" : "Back up and remove",
    });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        const backup = await Bridge.statuslineApply(install, preview.fingerprint);
        clear(body);
        body.append(h("div", {
          class: "notice ok",
          text: `Done. Previous settings saved as ${backup}. The gauge appears after the next reply in a Claude Code session.`,
        }));
        window.setTimeout(() => void rebuild(), 2600);
      } catch (err) {
        confirm.disabled = false;
        body.append(h("div", { class: "notice err", text: `Could not write: ${String(err)}` }));
      }
    });
    body.append(h("div", { class: "row" }, confirm, h("button", {
      text: "Cancel",
      onclick: () => { clear(body); draw(); },
    })));
  }

  draw();
  return section;
}

// ── Always allowed section ────────────────────────────────────────────────────

/**
 * What "Always" on a permission card has remembered. Each rule is for one
 * project and one kind of request; removing it puts the question back on the
 * card the next time. Nothing here can add a rule — only the card can.
 */
function rulesSection(initial: Rule[]): HTMLElement {
  const list = h("div", { style: "display:flex;flex-direction:column;gap:8px" });
  const section = h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Always allowed" })),
    h("div", {
      class: "hint",
      text: "Requests you chose to always allow with the “Always” button. They are answered without asking, and each one shows in the island's ticker. Remove one to be asked again.",
    }),
    list,
  );

  function draw(rules: Rule[]) {
    clear(list);
    if (rules.length === 0) {
      list.append(h("div", { class: "hint", text: "Nothing yet." }));
      return;
    }
    for (const rule of rules) {
      const project = rule.project.split("/").filter(Boolean).pop() ?? rule.project;
      const remove = h("button", { class: "danger", text: "Remove" });
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try {
          await Bridge.rulesRemove(rule.id);
        } catch (err) {
          remove.disabled = false;
          list.append(h("div", { class: "notice err", text: `Could not remove: ${String(err)}` }));
        }
      });
      list.append(
        h("div", { class: "row" },
          h("span", { style: "flex:1 1 auto;min-width:0;font-size:12.5px", text: rule.label }),
          h("span", { class: "hint", title: rule.project, text: project }),
          remove,
        ),
      );
    }
  }

  draw(initial);
  void onEvent<Rule[]>("rules-changed", draw);
  return section;
}

// ── Chat provider + DEVMARK AI ────────────────────────────────────────────────

/** Which AI answers the chat, and the settings of the company's DEVMARK AI. */
function providerSection(hasKey: boolean): HTMLElement {
  const provider = h("select", {}) as HTMLSelectElement;
  provider.append(
    h("option", { value: "anthropic", text: "Claude (Anthropic)" }),
    h("option", { value: "devmark", text: "DEVMARK AI (private)" }),
  );
  provider.value = settings.chatProvider;

  // ── DEVMARK AI ──
  const dot = statusDot(hasKey);
  const state = h("span", { class: "hint" });
  const field = h("input", {
    type: "password",
    placeholder: "dmk_live_…",
    style: "flex:1 1 auto;min-width:0",
    autocomplete: "off",
    spellcheck: "false",
  }) as HTMLInputElement;
  const saveBtn = h("button", { class: "primary", text: "Save key" });
  const clearBtn = h("button", { class: "danger", text: "Remove" });
  const feedback = h("div", {});

  const model = h("input", {
    type: "text",
    value: settings.devmarkModel,
    placeholder: "llama3.2:1b",
    style: "flex:1 1 auto;min-width:0",
    spellcheck: "false",
  }) as HTMLInputElement;
  model.addEventListener("change", () => {
    settings.devmarkModel = model.value.trim() || "llama3.2:1b";
    model.value = settings.devmarkModel;
    void save();
  });

  const tokens = h("input", {
    type: "number", min: "50", max: "2000", step: "50",
    value: String(settings.devmarkMaxTokens),
    style: "width:88px",
  }) as HTMLInputElement;
  tokens.addEventListener("change", () => {
    settings.devmarkMaxTokens = Math.max(50, Math.min(2000, Math.round(Number(tokens.value)) || 400));
    tokens.value = String(settings.devmarkMaxTokens);
    void save();
  });

  async function refresh() {
    const present = (await Bridge.secretPresent("devmark-api-key")) ?? false;
    dot.style.background = present ? "#22c55e" : "#f4505e";
    state.textContent = present
      ? "Key saved in the Windows Credential Manager."
      : "No key yet — paste the dmk_… key you were given.";
    field.placeholder = present ? "••••••••••••  (stored)" : "dmk_live_…";
    clearBtn.style.display = present ? "" : "none";
  }

  saveBtn.addEventListener("click", async () => {
    const value = field.value.trim();
    if (!value) return;
    clear(feedback);
    try {
      await Bridge.secretSet("devmark-api-key", value);
      field.value = "";
      feedback.append(h("div", { class: "notice ok", text: "Saved. It never touches disk or the page." }));
      await refresh();
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: `Could not save: ${String(err)}` }));
    }
  });
  clearBtn.addEventListener("click", async () => {
    clear(feedback);
    try {
      await Bridge.secretClear("devmark-api-key");
      feedback.append(h("div", { class: "notice ok", text: "Key removed." }));
      await refresh();
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: `Could not remove: ${String(err)}` }));
    }
  });

  const testBtn = h("button", { text: "Test connection" });
  testBtn.addEventListener("click", async () => {
    clear(feedback);
    testBtn.disabled = true;
    testBtn.textContent = "Testing…";
    try {
      const result = await Bridge.devmarkTest();
      feedback.append(h("div", { class: result.ok ? "notice ok" : "notice warn", text: result.message }));
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }));
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = "Test connection";
    }
  });

  const devmark = h(
    "div",
    { style: "display:flex;flex-direction:column;gap:12px" },
    h("div", { class: "hint", text: "Private AI of the company (OpenAI-compatible, https://ai.devmarkpe.com). It reads text only, answers one message at a time, and can take a while on the first reply." }),
    state,
    h("div", { class: "row" }, h("label", { text: "API key" }), field, saveBtn, clearBtn),
    h("div", { class: "row" }, h("label", { text: "Model" }), model),
    h("div", { class: "row" },
      h("label", { text: "Max reply" }),
      tokens,
      h("span", { class: "hint", text: "tokens — shorter is faster" }),
    ),
    h("div", { class: "row" }, testBtn),
    feedback,
  );

  const section = h(
    "section",
    {},
    h("h2", {}, dot, h("span", { text: "Chat provider" })),
    h("div", { class: "hint", text: "Who answers when you ask Mochi something. Changing it starts a new conversation." }),
    h("div", { class: "row" }, h("label", { text: "Answers with" }), provider),
    devmark,
  );

  // The DEVMARK settings only matter while it is the chosen provider.
  const showDevmark = () => {
    devmark.style.display = provider.value === "devmark" ? "" : "none";
    dot.style.display = provider.value === "devmark" ? "" : "none";
  };
  provider.addEventListener("change", () => {
    settings.chatProvider = provider.value as Settings["chatProvider"];
    showDevmark();
    void save();
  });
  showDevmark();
  void refresh();
  return section;
}

// ── Claude API section ────────────────────────────────────────────────────────

const MODELS: [string, string][] = [
  ["claude-opus-5", "Claude Opus 5"],
  ["claude-sonnet-5", "Claude Sonnet 5"],
  ["claude-haiku-4-5", "Claude Haiku 4.5"],
];

function apiSection(hasKey: boolean): HTMLElement {
  const dot = statusDot(hasKey);
  const state = h("span", { class: "hint", text: hasKey ? "Key saved in the Windows Credential Manager." : "No key yet — the chat needs one." });

  const field = h("input", {
    type: "password",
    placeholder: hasKey ? "••••••••••••  (stored)" : "sk-ant-...",
    style: "flex:1 1 auto;min-width:0",
    autocomplete: "off",
    spellcheck: "false",
  }) as HTMLInputElement;

  const saveBtn = h("button", { class: "primary", text: "Save key" });
  const clearBtn = h("button", { class: "danger", text: "Remove" });
  const feedback = h("div", {});

  async function refresh() {
    const present = (await Bridge.secretPresent("anthropic-api-key")) ?? false;
    dot.style.background = present ? "#22c55e" : "#f4505e";
    state.textContent = present
      ? "Key saved in the Windows Credential Manager."
      : "No key yet — the chat needs one.";
    field.placeholder = present ? "••••••••••••  (stored)" : "sk-ant-...";
    clearBtn.style.display = present ? "" : "none";
  }

  saveBtn.addEventListener("click", async () => {
    const value = field.value.trim();
    if (!value) return;
    clear(feedback);
    try {
      await Bridge.secretSet("anthropic-api-key", value);
      field.value = "";
      feedback.append(h("div", { class: "notice ok", text: "Saved. It never touches disk." }));
      await refresh();
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: `Could not save: ${String(err)}` }));
    }
  });

  clearBtn.addEventListener("click", async () => {
    clear(feedback);
    try {
      await Bridge.secretClear("anthropic-api-key");
      feedback.append(h("div", { class: "notice ok", text: "Key removed." }));
      await refresh();
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: `Could not remove: ${String(err)}` }));
    }
  });

  const model = h("select", {}) as HTMLSelectElement;
  for (const [id, label] of MODELS) model.append(h("option", { value: id, text: label }));
  if (!MODELS.some(([id]) => id === settings.model)) {
    model.append(h("option", { value: settings.model, text: settings.model }));
  }
  model.value = settings.model;
  model.addEventListener("change", () => {
    settings.model = model.value;
    void save();
  });

  clearBtn.style.display = hasKey ? "" : "none";

  return h(
    "section",
    {},
    h("h2", {}, dot, h("span", { text: "Claude" })),
    state,
    h("div", { class: "row" }, h("label", { text: "API key" }), field, saveBtn, clearBtn),
    h("div", { class: "row" }, h("label", { text: "Model" }), model),
    feedback,
  );
}

// ── Integrations section ──────────────────────────────────────────────────────

interface IntegrationDef {
  id: string;
  name: string;
  color: string;
  /** Credential Manager keys, in the order they are shown. */
  fields: { key: string; label: string; placeholder: string; secret: boolean }[];
}

const INTEGRATIONS: IntegrationDef[] = [
  { id: "integration_stripe", name: "Stripe", color: "#0570DE",
    fields: [{ key: "stripe-api-key", label: "Secret key", placeholder: "sk_live_…", secret: true }] },
  { id: "integration_github", name: "GitHub", color: "#F4505E",
    fields: [{ key: "github-token", label: "Token", placeholder: "ghp_…", secret: true }] },
  { id: "integration_vercel", name: "Vercel", color: "#7C5CFF",
    fields: [{ key: "vercel-token", label: "Token", placeholder: "…", secret: true }] },
  { id: "integration_n8n", name: "n8n", color: "#F29B38",
    fields: [
      { key: "n8n-url", label: "Instance URL", placeholder: "https://n8n.example.com", secret: false },
      { key: "n8n-api-key", label: "API key", placeholder: "…", secret: true },
    ] },
  { id: "integration_resend", name: "Resend", color: "#22C55E",
    fields: [{ key: "resend-api-key", label: "API key", placeholder: "re_…", secret: true }] },
  { id: "integration_notion", name: "Notion", color: "#8C8C8C",
    fields: [{ key: "notion-api-key", label: "Integration token", placeholder: "ntn_…", secret: true }] },
  { id: "integration_calcom", name: "Cal.com", color: "#C9956A",
    fields: [{ key: "calcom-api-key", label: "API key", placeholder: "cal_…", secret: true }] },
];

const MAX_ACTIVE = 4;

function integrationsSection(present: Record<string, boolean>): HTMLElement {
  const note = h("div", { class: "hint" });
  const list = h("div", { style: "display:flex;flex-direction:column;gap:14px" });

  function updateNote() {
    const used = settings.activeIntegrations.length;
    note.textContent = `Pick up to ${MAX_ACTIVE} pills to show next to Mochi — ${used}/${MAX_ACTIVE} in use. Keys are stored in the Windows Credential Manager, never on disk.`;
  }

  for (const def of INTEGRATIONS) {
    const active = settings.activeIntegrations.includes(def.id);
    const sw = h("button", { class: active ? "switch on" : "switch" });
    sw.addEventListener("click", () => {
      const on = settings.activeIntegrations.includes(def.id);
      if (on) {
        settings.activeIntegrations = settings.activeIntegrations.filter((x) => x !== def.id);
      } else {
        if (settings.activeIntegrations.length >= MAX_ACTIVE) return;
        settings.activeIntegrations = [...settings.activeIntegrations, def.id];
      }
      sw.classList.toggle("on", !on);
      updateNote();
      void save();
    });

    const rows = h("div", { style: "display:flex;flex-direction:column;gap:6px;flex:1 1 auto;min-width:0" });
    for (const field of def.fields) {
      const input = h("input", {
        type: field.secret ? "password" : "text",
        placeholder: present[field.key] ? "••••••••  (stored)" : field.placeholder,
        autocomplete: "off",
        spellcheck: "false",
        style: "flex:1 1 auto;min-width:0",
      }) as HTMLInputElement;
      const saveBtn = h("button", { text: "Save" });
      const dotEl = statusDot(present[field.key] ?? false);
      saveBtn.addEventListener("click", async () => {
        const value = input.value.trim();
        try {
          await Bridge.secretSet(field.key, value);
          present[field.key] = value.length > 0;
          input.value = "";
          input.placeholder = value ? "••••••••  (stored)" : field.placeholder;
          dotEl.style.background = value ? "#22c55e" : "#f4505e";
        } catch {
          dotEl.style.background = "#f5a524";
        }
      });
      rows.append(
        h("div", { class: "row" },
          h("label", { style: "min-width:104px", text: field.label }),
          input, saveBtn, dotEl,
        ),
      );
    }

    list.append(
      h("div", { style: "display:flex;gap:12px;align-items:flex-start" },
        h("div", { style: "display:flex;align-items:center;gap:8px;min-width:132px;padding-top:4px" },
          sw,
          h("i", { class: "dot", style: `background:${def.color}` }),
          h("span", { style: "font-size:12.5px", text: def.name }),
        ),
        rows,
      ),
    );
  }

  updateNote();
  return h("section", {}, h("h2", {}, h("span", { text: "Integrations" })), note, list);
}

// ── General section ───────────────────────────────────────────────────────────

function generalSection(): HTMLElement {
  const volume = h("input", {
    type: "range", min: "0", max: "0.2", step: "0.005",
    value: String(settings.soundVolume),
  }) as HTMLInputElement;
  volume.addEventListener("input", () => {
    settings.soundVolume = Number(volume.value);
    void save();
  });

  const autoClose = h("input", {
    type: "number", min: "5", max: "120", step: "1",
    value: String(Math.round(settings.autoCloseInterval)),
    style: "width:72px",
  }) as HTMLInputElement;
  autoClose.addEventListener("change", () => {
    settings.autoCloseInterval = Math.max(5, Math.min(120, Number(autoClose.value) || 15));
    autoClose.value = String(settings.autoCloseInterval);
    void save();
  });

  const screen = h("select", {}) as HTMLSelectElement;
  screen.append(
    h("option", { value: "primary", text: "Main display" }),
    h("option", { value: "cursor", text: "Display under the cursor" }),
  );
  screen.value = settings.screen;
  screen.addEventListener("change", () => {
    settings.screen = screen.value as Settings["screen"];
    void save();
  });

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "General" })),
    h("div", { class: "row" },
      h("label", { text: "Sound" }),
      toggle(settings.soundEnabled, (v) => { settings.soundEnabled = v; void save(); }),
      volume,
    ),
    h("div", { class: "row" },
      h("label", { text: "Auto-close" }),
      autoClose,
      h("span", { class: "hint", text: "seconds after you leave the island" }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Island lives on" }),
      screen,
    ),
    h("div", { class: "row" },
      h("label", { text: "Launch at startup" }),
      toggle(settings.autostart, (v) => { settings.autostart = v; void save(); }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Windows notifications" }),
      toggle(settings.nativeNotifications, (v) => { settings.nativeNotifications = v; void save(); }),
      h("span", { class: "hint", text: "a toast when Claude needs you or finishes while the island is closed" }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Global shortcuts" }),
      toggle(settings.globalShortcuts, (v) => { settings.globalShortcuts = v; void save(); }),
      h("span", { class: "hint", text: "Ctrl+Alt+Y allow · Ctrl+Alt+N deny (only while a request is up) · Ctrl+Alt+C open or close" }),
    ),
  );
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function main() {
  const boot = await Bridge.boot();
  if (boot) {
    settings = { ...settings, ...boot.settings };
    version = boot.version;
    detectedName = boot.detectedName ?? "";
  }
  const status = (await Bridge.hooksStatus()) ?? {
    installed: false, outdated: false, statuslineInstalled: false,
    settingsPath: "", hookPath: "", hookReady: false,
  };

  const hasKey = (await Bridge.secretPresent("anthropic-api-key")) ?? false;

  const keys = [
    "stripe-api-key", "github-token", "vercel-token",
    "n8n-url", "n8n-api-key", "resend-api-key", "notion-api-key", "calcom-api-key",
  ];
  const present: Record<string, boolean> = {};
  for (const k of keys) present[k] = (await Bridge.secretPresent(k)) ?? false;

  const tools = (await Bridge.detectTools()) ?? [];
  const agents = (await Bridge.agentsStatus()) ?? [];
  const providerKey = settings.chatProvider === "devmark" ? "devmark-api-key" : "anthropic-api-key";
  const hasProviderKey = (await Bridge.secretPresent(providerKey)) ?? false;

  clear(root);
  root.append(
    h("h1", {}, h("span", { text: "Coucou" }), h("span", { class: "version", text: version })),
    setupSection(status, present, hasProviderKey, tools, detectedName, agents),
    personalSection(detectedName),
    claudeSection(status),
    agentsSection(agents),
    planSection(status),
    rulesSection((await Bridge.rulesList()) ?? []),
    providerSection((await Bridge.secretPresent("devmark-api-key")) ?? false),
    apiSection(hasKey),
    integrationsSection(present),
    generalSection(),
    h("div", {
      class: "hint",
      text: "No telemetry. Network requests only go to the services you configure yourself.",
    }),
  );

  void onEvent<Settings>("settings-changed", (s) => {
    settings = { ...settings, ...s };
  });
}

void main();
