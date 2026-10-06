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
      "Claude Code conectado",
      status.installed
        ? status.outdated
          ? "Hooks de una versión anterior: actualízalos en la sección Claude Code, más abajo."
          : "Las sesiones, los permisos y las preguntas aparecen en la isla."
        : claudeFound
          ? "Claude Code está en este PC, pero Coucou aún no está conectado: usa “Instalar hooks…” en la sección Claude Code, más abajo."
          : "Instala los hooks (sección Claude Code, más abajo) para ver tus sesiones en la isla.",
    ),
    // The other agents: only the ones that are on this PC (the terminal always is).
    ...agents
      .filter((a) => a.detected || a.installed)
      .map((a) =>
        item(
          a.installed,
          a.name,
          a.installed
            ? "Conectado: tiene su propio pill."
            : `Encontrado en este PC pero sin conectar: usa “Conectar…” en Agentes, más abajo.`,
        ),
      ),
    item(
      present["github-token"] ?? false,
      "GitHub",
      present["github-token"]
        ? "Token guardado: tus pull requests, revisiones pedidas, CI y el trabajo de GitHub Copilot aparecen en el pill de GitHub."
        : "Crea un token (uno clásico con “repo”, o uno de acceso fino con lectura de pull requests, estados de commits y metadatos) y pégalo en Integraciones → GitHub. El mismo token cubre Copilot.",
      present["github-token"]
        ? undefined
        : h("button", {
            text: "Crear token",
            onclick: () => void Bridge.openUrl("https://github.com/settings/personal-access-tokens/new"),
          }),
    ),
    item(
      hasProviderKey,
      settings.chatProvider === "devmark" ? "Chat con DEVMARK AI" : "Chat con Claude",
      hasProviderKey
        ? "Clave guardada en el Administrador de credenciales de Windows."
        : settings.chatProvider === "devmark"
          ? "Pega tu clave dmk_… en Proveedor de chat."
          : "Pega tu clave de la API de Anthropic en Claude, o elige DEVMARK AI en Proveedor de chat.",
    ),
    item(
      !!(settings.userName.trim() || detectedName),
      "Tu nombre",
      settings.userName.trim()
        ? `Mochi te saluda como “${settings.userName.trim()}”.`
        : detectedName
          ? `Detectado: “${detectedName}”. Puedes cambiarlo en Personalización.`
          : "Indícalo en Personalización para que Mochi pueda saludarte.",
    ),
    item(
      status.statuslineInstalled,
      "Uso del plan (opcional)",
      status.statuslineInstalled
        ? "El relay está instalado."
        : "Instala el relay en Uso del plan para ver cuánto te queda del plan de Claude.",
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
    h("h2", {}, h("span", { text: "Configuración" })),
    h("div", { class: "hint", text: "Qué está listo y qué falta, según los programas de este equipo." }),
    list,
    h("div", { class: "hint", text: "Detectado en este PC" }),
    chips,
  );
}

// ── Agents: Gemini CLI, OpenCode, VS Code ─────────────────────────────────────

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
    what: "Añade los hooks de Coucou a ~/.gemini/settings.json, para que las sesiones de Gemini CLI aparezcan en su pill.",
    missing: "No se encontró Gemini CLI en este PC. Aun así puedes conectarlo para cuando lo instales.",
  },
  {
    id: "opencode", color: "#FACC15",
    what: "Añade un pequeño plugin (coucou.js) a ~/.config/opencode/plugins. No necesita nada más.",
    missing: "No se encontró OpenCode en este PC. Aun así puedes conectarlo para cuando lo instales.",
  },
  {
    id: "vscode", color: "#2DA8F5",
    what: "Su pill muestra tus proyectos recientes y funciona sin conectar nada. Conectarlo añade un bloque a tu perfil de PowerShell que actúa solo dentro de la terminal de VS Code: cuando termina un comando que tardó 10 segundos o más, el pill (y una notificación) te dice si salió bien. Las demás terminales quedan exactamente como están.",
    missing: "No se encontró VS Code en este PC.",
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
    note.textContent = `Cada agente tiene su propio pill junto a Mochi (${used}/${MAX_ACTIVE} pills en uso). Conectar uno modifica un archivo de esa herramienta, con vista previa antes.`;
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
        h("span", { class: "hint", text: connected ? "Conectado" : "Sin conectar" }),
      ),
      h("div", { class: "hint", text: def.what }),
    );
    if (status && !status.detected && def.missing) box.append(h("div", { class: "hint", text: def.missing }));

    const actions = h("div", { class: "row" });
    actions.append(h("button", {
      class: "primary",
      text: connected ? "Reconectar…" : "Conectar…",
      onclick: () => preview(def, box, true),
    }));
    if (connected) {
      actions.append(h("button", { class: "danger", text: "Desconectar…", onclick: () => preview(def, box, false) }));
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
        h("div", { class: "row" }, h("button", { text: "Volver", onclick: () => drawAgent(def, box) })),
      );
      return;
    }
    clear(box);
    box.append(
      h("div", {
        class: "hint",
        text: install
          ? "Esto es exactamente lo que cambiará. Todo lo demás de esos archivos queda intacto."
          : "Esto solo quita la parte de Coucou. Todo lo demás de esos archivos queda intacto.",
      }),
      renderDiff(plan.diff),
      h("div", { class: "row" }, h("span", { class: "path", text: `Copia de seguridad → ${plan.backup}` })),
    );
    const confirm = h("button", {
      class: install ? "primary" : "danger",
      text: install ? "Guardar copia y escribir" : "Guardar copia y quitar",
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
            ? "Conectado. Inicia una sesión nueva en esa herramienta para verla en su pill."
            : "Desconectado.",
        }));
        window.setTimeout(() => drawAgent(def, box), 2600);
      } catch (err) {
        confirm.disabled = false;
        box.append(h("div", { class: "notice err", text: `No se pudo escribir: ${String(err).replace(/^Error:\s*/, "")}` }));
      }
    });
    box.append(h("div", { class: "row" }, confirm, h("button", {
      text: "Cancelar",
      onclick: () => drawAgent(def, box),
    })));
  }

  for (const def of AGENTS) {
    const box = h("div", { style: "display:flex;flex-direction:column;gap:8px" });
    list.append(box);
    drawAgent(def, box);
  }
  updateNote();
  return h("section", {}, h("h2", {}, h("span", { text: "Agentes" })), note, list);
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
    placeholder: detectedName || "Tu nombre",
    style: "flex:1 1 auto;min-width:0",
    spellcheck: "false",
  }) as HTMLInputElement;
  name.addEventListener("change", () => {
    settings.userName = name.value.trim();
    void save();
    refresh();
  });
  const useDetected = h("button", {
    text: "Usar el detectado",
    title: detectedName ? `“${detectedName}”` : "No se pudo detectar ningún nombre",
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
    h("option", { value: "auto", text: "Automático (idioma del sistema)" }),
    h("option", { value: "es", text: "Español" }),
    h("option", { value: "en", text: "English" }),
  );
  language.value = settings.greetingLanguage;
  language.addEventListener("change", () => {
    settings.greetingLanguage = language.value as Settings["greetingLanguage"];
    void save();
    refresh();
  });

  // Which pill opens first: Claude Code, or any of the ones that are switched on.
  const startPill = h("select", {}) as HTMLSelectElement;
  const names: Record<string, string> = {
    integration_claude: "Claude Code", integration_github: "GitHub", integration_n8n: "n8n",
    integration_vercel: "Vercel", integration_resend: "Resend", integration_notion: "Notion",
    integration_calcom: "Cal.com", integration_stripe: "Stripe",
    agent_gemini: "Gemini CLI", agent_opencode: "OpenCode", agent_vscode: "VS Code",
  };
  for (const id of ["integration_claude", ...settings.activeIntegrations]) {
    if (names[id]) startPill.append(h("option", { value: id, text: names[id] }));
  }
  startPill.value = names[settings.startPill] ? settings.startPill : "integration_claude";
  startPill.addEventListener("change", () => {
    settings.startPill = startPill.value;
    void save();
  });

  refresh();
  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Personalización" })),
    h("div", { class: "hint", text: "Al iniciar, Mochi te saluda por tu nombre, con la hora del día y la fecha de hoy." }),
    h("div", { class: "row" },
      h("label", { text: "Saludar" }),
      toggle(settings.greetingEnabled, (v) => { settings.greetingEnabled = v; void save(); refresh(); }),
    ),
    h("div", { class: "row" }, h("label", { text: "Tu nombre" }), name, useDetected),
    h("div", { class: "row" }, h("label", { text: "Saludo" }), template),
    h("div", { class: "hint", text: "{name} se reemplaza por tu nombre. Ejemplo: ¡Hola {name}, bienvenido!" }),
    h("div", { class: "row" }, h("label", { text: "Idioma" }), language),
    h("div", { class: "row" },
      h("label", { text: "Pill inicial" }),
      startPill,
    ),
    h("div", { class: "hint", text: "El pill que se muestra primero al abrir la isla." }),
    h("div", { class: "row" },
      h("label", { text: "Elegir al iniciar" }),
      toggle(settings.greetingPicker, (v) => { settings.greetingPicker = v; void save(); }),
      h("span", { class: "hint", text: "muestra “¿Por dónde empezamos?” en la bienvenida" }),
    ),
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
          ? "Coucou está conectado a tus sesiones de Claude Code. Las herramientas, las preguntas y las peticiones de permiso aparecen en la isla, y puedes responderlas ahí."
          : "Instala los hooks para ver tus sesiones de Claude Code en la isla y aprobar permisos sin dejar lo que estás haciendo.",
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
        text: "coucou-hook.exe aún no está en su sitio. Reinicia Coucou; si sigue fallando, compílalo con `cargo build -p coucou-hook`.",
      }));
    }

    // Hooks written by an older build lack the one that answers Claude's questions.
    if (status.installed && status.outdated) {
      body.append(h("div", {
        class: "notice warn",
        text: "Hooks desactualizados: actualízalos para responder las preguntas de Claude desde la isla.",
      }));
    }

    const actions = h("div", { class: "row" });
    const install = h("button", {
      class: "primary",
      text: !status.installed ? "Instalar hooks…" : status.outdated ? "Actualizar hooks…" : "Reinstalar hooks…",
      onclick: () => showPreview(true),
    });
    // Writing hook commands that point at a relay which isn't there would give
    // every Claude Code session a broken hook and nothing to show for it.
    if (!status.hookReady) {
      install.disabled = true;
      install.title = "El relay aún no está instalado.";
    }
    actions.append(install);
    if (status.installed) {
      actions.append(h("button", {
        class: "danger",
        text: "Desinstalar hooks…",
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
          text: "Volver",
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
          ? "Esto es exactamente lo que cambiará en tu settings.json. Tus propios hooks quedan intactos."
          : "Esto solo quita las entradas de Coucou. Tus propios hooks quedan intactos.",
      }),
      renderDiff(preview.diff),
      h("div", { class: "row" },
        h("span", { class: "path", text: `Copia de seguridad → ${preview.backup}` }),
      ),
    );
    const confirm = h("button", {
      class: install ? "primary" : "danger",
      text: install ? "Guardar copia y escribir" : "Guardar copia y quitar",
    });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        const backup = await Bridge.hooksApply(install, preview.fingerprint);
        clear(body);
        body.append(h("div", {
          class: "notice ok",
          text: `Listo. La configuración anterior quedó guardada como ${backup}. Abre una sesión nueva de Claude Code para que tome los hooks.`,
        }));
        window.setTimeout(() => void rebuild(), 2600);
      } catch (err) {
        confirm.disabled = false;
        body.append(h("div", { class: "notice err", text: `No se pudo escribir: ${String(err)}` }));
      }
    });
    body.append(h("div", { class: "row" }, confirm, h("button", {
      text: "Cancelar",
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
  const section = h("section", {}, h("h2", {}, h("span", { text: "Uso del plan" })), body);

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
        text: "Un pequeño pill en la cabecera de la isla con lo que llevas gastado de tu plan de Claude (ventanas de 5 horas y 7 días). Claude Code solo lo informa en los planes Pro y Max.",
      }),
      h("div", { class: "row" }, h("label", { text: "Mostrar en la isla" }), show),
      h("div", { class: "row" },
        h("label", { text: "Relay" }),
        h("span", { class: "hint", text: installed ? "Instalado" : "Sin instalar" }),
        statusDot(installed),
      ),
    );
    const actions = h("div", { class: "row" });
    actions.append(h("button", {
      class: "primary",
      text: installed ? "Reinstalar relay…" : "Instalar relay…",
      onclick: () => showPreview(true),
    }));
    if (installed) {
      actions.append(h("button", {
        class: "danger",
        text: "Desinstalar relay…",
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
        h("div", { class: "row" }, h("button", { text: "Volver", onclick: () => { clear(body); draw(); } })),
      );
      return;
    }
    clear(body);
    body.append(
      h("div", {
        class: "hint",
        text: install
          ? "Esto es exactamente lo que cambiará en tu settings.json. Si ya tienes una línea de estado, sigue funcionando igual que antes."
          : "Esto quita el relay de línea de estado de Coucou y devuelve la tuya, si tenías una.",
      }),
      renderDiff(preview.diff),
      h("div", { class: "row" }, h("span", { class: "path", text: `Copia de seguridad → ${preview.backup}` })),
    );
    const confirm = h("button", {
      class: install ? "primary" : "danger",
      text: install ? "Guardar copia y escribir" : "Guardar copia y quitar",
    });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        const backup = await Bridge.statuslineApply(install, preview.fingerprint);
        clear(body);
        body.append(h("div", {
          class: "notice ok",
          text: `Listo. La configuración anterior quedó guardada como ${backup}. El medidor aparece tras la siguiente respuesta en una sesión de Claude Code.`,
        }));
        window.setTimeout(() => void rebuild(), 2600);
      } catch (err) {
        confirm.disabled = false;
        body.append(h("div", { class: "notice err", text: `No se pudo escribir: ${String(err)}` }));
      }
    });
    body.append(h("div", { class: "row" }, confirm, h("button", {
      text: "Cancelar",
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
    h("h2", {}, h("span", { text: "Siempre permitido" })),
    h("div", {
      class: "hint",
      text: "Peticiones que elegiste permitir siempre con el botón “Siempre”. Se responden sin preguntar y cada una aparece en el ticker de la isla. Quita una para que vuelva a preguntarte.",
    }),
    list,
  );

  function draw(rules: Rule[]) {
    clear(list);
    if (rules.length === 0) {
      list.append(h("div", { class: "hint", text: "Aún no hay nada." }));
      return;
    }
    for (const rule of rules) {
      const project = rule.project.split("/").filter(Boolean).pop() ?? rule.project;
      const remove = h("button", { class: "danger", text: "Quitar" });
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try {
          await Bridge.rulesRemove(rule.id);
        } catch (err) {
          remove.disabled = false;
          list.append(h("div", { class: "notice err", text: `No se pudo quitar: ${String(err)}` }));
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
    h("option", { value: "devmark", text: "DEVMARK AI (privada)" }),
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
  const saveBtn = h("button", { class: "primary", text: "Guardar clave" });
  const clearBtn = h("button", { class: "danger", text: "Quitar" });
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
      ? "Clave guardada en el Administrador de credenciales de Windows."
      : "Aún no hay clave: pega la clave dmk_… que te dieron.";
    field.placeholder = present ? "••••••••••••  (guardada)" : "dmk_live_…";
    clearBtn.style.display = present ? "" : "none";
  }

  saveBtn.addEventListener("click", async () => {
    const value = field.value.trim();
    if (!value) return;
    clear(feedback);
    try {
      await Bridge.secretSet("devmark-api-key", value);
      field.value = "";
      feedback.append(h("div", { class: "notice ok", text: "Guardada. Nunca toca el disco ni la página." }));
      await refresh();
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: `No se pudo guardar: ${String(err)}` }));
    }
  });
  clearBtn.addEventListener("click", async () => {
    clear(feedback);
    try {
      await Bridge.secretClear("devmark-api-key");
      feedback.append(h("div", { class: "notice ok", text: "Clave eliminada." }));
      await refresh();
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: `No se pudo quitar: ${String(err)}` }));
    }
  });

  const testBtn = h("button", { text: "Probar conexión" });
  testBtn.addEventListener("click", async () => {
    clear(feedback);
    testBtn.disabled = true;
    testBtn.textContent = "Probando…";
    try {
      const result = await Bridge.devmarkTest();
      feedback.append(h("div", { class: result.ok ? "notice ok" : "notice warn", text: result.message }));
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }));
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = "Probar conexión";
    }
  });

  const devmark = h(
    "div",
    { style: "display:flex;flex-direction:column;gap:12px" },
    h("div", { class: "hint", text: "IA privada de la empresa (compatible con OpenAI, https://ai.devmarkpe.com). Solo lee texto, responde un mensaje a la vez y la primera respuesta puede tardar." }),
    state,
    h("div", { class: "row" }, h("label", { text: "Clave API" }), field, saveBtn, clearBtn),
    h("div", { class: "row" }, h("label", { text: "Modelo" }), model),
    h("div", { class: "row" },
      h("label", { text: "Respuesta máx." }),
      tokens,
      h("span", { class: "hint", text: "tokens: más corto es más rápido" }),
    ),
    h("div", { class: "row" }, testBtn),
    feedback,
  );

  const section = h(
    "section",
    {},
    h("h2", {}, dot, h("span", { text: "Proveedor de chat" })),
    h("div", { class: "hint", text: "Quién responde cuando le preguntas algo a Mochi. Al cambiarlo empieza una conversación nueva." }),
    h("div", { class: "row" }, h("label", { text: "Responde con" }), provider),
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
  const state = h("span", { class: "hint", text: hasKey ? "Clave guardada en el Administrador de credenciales de Windows." : "Aún no hay clave: el chat necesita una." });

  const field = h("input", {
    type: "password",
    placeholder: hasKey ? "••••••••••••  (guardada)" : "sk-ant-...",
    style: "flex:1 1 auto;min-width:0",
    autocomplete: "off",
    spellcheck: "false",
  }) as HTMLInputElement;

  const saveBtn = h("button", { class: "primary", text: "Guardar clave" });
  const clearBtn = h("button", { class: "danger", text: "Quitar" });
  const feedback = h("div", {});

  async function refresh() {
    const present = (await Bridge.secretPresent("anthropic-api-key")) ?? false;
    dot.style.background = present ? "#22c55e" : "#f4505e";
    state.textContent = present
      ? "Clave guardada en el Administrador de credenciales de Windows."
      : "Aún no hay clave: el chat necesita una.";
    field.placeholder = present ? "••••••••••••  (guardada)" : "sk-ant-...";
    clearBtn.style.display = present ? "" : "none";
  }

  saveBtn.addEventListener("click", async () => {
    const value = field.value.trim();
    if (!value) return;
    clear(feedback);
    try {
      await Bridge.secretSet("anthropic-api-key", value);
      field.value = "";
      feedback.append(h("div", { class: "notice ok", text: "Guardada. Nunca toca el disco." }));
      await refresh();
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: `No se pudo guardar: ${String(err)}` }));
    }
  });

  clearBtn.addEventListener("click", async () => {
    clear(feedback);
    try {
      await Bridge.secretClear("anthropic-api-key");
      feedback.append(h("div", { class: "notice ok", text: "Clave eliminada." }));
      await refresh();
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: `No se pudo quitar: ${String(err)}` }));
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
    h("div", { class: "row" }, h("label", { text: "Clave API" }), field, saveBtn, clearBtn),
    h("div", { class: "row" }, h("label", { text: "Modelo" }), model),
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
    fields: [{ key: "stripe-api-key", label: "Clave secreta", placeholder: "sk_live_…", secret: true }] },
  { id: "integration_github", name: "GitHub", color: "#F4505E",
    fields: [{ key: "github-token", label: "Token", placeholder: "ghp_…", secret: true }] },
  { id: "integration_vercel", name: "Vercel", color: "#7C5CFF",
    fields: [{ key: "vercel-token", label: "Token", placeholder: "…", secret: true }] },
  { id: "integration_n8n", name: "n8n", color: "#F29B38",
    fields: [
      { key: "n8n-url", label: "URL de la instancia", placeholder: "https://n8n.example.com", secret: false },
      { key: "n8n-api-key", label: "Clave API", placeholder: "…", secret: true },
    ] },
  { id: "integration_resend", name: "Resend", color: "#22C55E",
    fields: [{ key: "resend-api-key", label: "Clave API", placeholder: "re_…", secret: true }] },
  { id: "integration_notion", name: "Notion", color: "#8C8C8C",
    fields: [{ key: "notion-api-key", label: "Token de integración", placeholder: "ntn_…", secret: true }] },
  { id: "integration_calcom", name: "Cal.com", color: "#C9956A",
    fields: [{ key: "calcom-api-key", label: "Clave API", placeholder: "cal_…", secret: true }] },
];

const MAX_ACTIVE = 4;

function integrationsSection(present: Record<string, boolean>): HTMLElement {
  const note = h("div", { class: "hint" });
  const list = h("div", { style: "display:flex;flex-direction:column;gap:14px" });

  function updateNote() {
    const used = settings.activeIntegrations.length;
    note.textContent = `Elige hasta ${MAX_ACTIVE} pills para mostrar junto a Mochi (${used}/${MAX_ACTIVE} en uso). Las claves se guardan en el Administrador de credenciales de Windows, nunca en disco.`;
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
        placeholder: present[field.key] ? "••••••••  (guardada)" : field.placeholder,
        autocomplete: "off",
        spellcheck: "false",
        style: "flex:1 1 auto;min-width:0",
      }) as HTMLInputElement;
      const saveBtn = h("button", { text: "Guardar" });
      const dotEl = statusDot(present[field.key] ?? false);
      saveBtn.addEventListener("click", async () => {
        const value = input.value.trim();
        try {
          await Bridge.secretSet(field.key, value);
          present[field.key] = value.length > 0;
          input.value = "";
          input.placeholder = value ? "••••••••  (guardada)" : field.placeholder;
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
  return h("section", {}, h("h2", {}, h("span", { text: "Integraciones" })), note, list);
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
    h("option", { value: "primary", text: "Pantalla principal" }),
    h("option", { value: "cursor", text: "Pantalla donde está el cursor" }),
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
      h("label", { text: "Sonido" }),
      toggle(settings.soundEnabled, (v) => { settings.soundEnabled = v; void save(); }),
      volume,
    ),
    h("div", { class: "row" },
      h("label", { text: "Cierre automático" }),
      autoClose,
      h("span", { class: "hint", text: "segundos después de que sales de la isla" }),
    ),
    h("div", { class: "row" },
      h("label", { text: "La isla vive en" }),
      screen,
    ),
    h("div", { class: "row" },
      h("label", { text: "Iniciar con Windows" }),
      toggle(settings.autostart, (v) => { settings.autostart = v; void save(); }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Notificaciones de Windows" }),
      toggle(settings.nativeNotifications, (v) => { settings.nativeNotifications = v; void save(); }),
      h("span", { class: "hint", text: "un aviso cuando Claude te necesita o termina con la isla cerrada" }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Atajos globales" }),
      toggle(settings.globalShortcuts, (v) => { settings.globalShortcuts = v; void save(); }),
      h("span", { class: "hint", text: "Ctrl+Alt+Y permitir · Ctrl+Alt+N denegar (solo mientras hay una petición) · Ctrl+Alt+C abrir o cerrar" }),
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
      text: "Sin telemetría. Las peticiones de red solo van a los servicios que tú configures.",
    }),
  );

  void onEvent<Settings>("settings-changed", (s) => {
    settings = { ...settings, ...s };
  });
}

void main();
