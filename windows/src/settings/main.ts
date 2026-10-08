// Settings window — the place where anything that writes to disk is confirmed.
// Stage 2 covers the Claude Code hooks and the general preferences; API keys and
// integrations land here too in a later stage.

import "./settings.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Bridge, IS_TAURI, onEvent, type AgentStatus, type DetectedTool, type HookStatus, type UpdateInfo } from "../core/bridge";
import { applyLanguage } from "../core/i18n";
import { speak, stopSpeaking } from "../core/voice";
import { State } from "../core/state";
import { captureAccelerator } from "../core/accelerator";
import { greetingLines } from "../island/greetingText";
import { CUSTOM_PILL_LIMIT, DEFAULT_SETTINGS, WEBHOOK_PORT, type CustomPill, type Settings } from "../core/state";
import { h, clear, svg } from "../views/dom";
import { ICONS } from "../views/icons";
import { pairingQr } from "./qr";
import { isOutfit, OUTFIT_NAMES, OUTFITS } from "../mochi/outfits";
import { TOPIC_NAMES, TOPICS } from "../pet/phrases";
import { MODE_CHOICES, MODE_NAMES } from "../core/modes";

/** A paw: the pet. */
const PET_ICON = "M12 12.5c-2.6 0-5.2 1.7-5.2 4.2 0 1.6 1.2 2.7 2.7 2.7 1 0 1.6-.5 2.5-.5s1.5.5 2.5.5c1.5 0 2.7-1.1 2.7-2.7 0-2.5-2.600-4.200-5.200-4.200zM5.800 6.800a1.800 2.300 0 1 0 0 4.600 1.800 2.300 0 1 0 0-4.600zM9.600 3.600a1.800 2.400 0 1 0 0 4.800 1.800 2.400 0 1 0 0-4.800zM14.400 3.600a1.800 2.400 0 1 0 0 4.800 1.800 2.400 0 1 0 0-4.800zM18.200 6.800a1.800 2.300 0 1 0 0 4.600 1.800 2.300 0 1 0 0-4.600z";

/** Two arrows chasing each other: sync. */
const SYNC_ICON = "M12 4.5a7.5 7.5 0 0 1 6.7 4.1H16v2h6V4.6h-2v2.3A9.5 9.5 0 0 0 2.6 11h2a7.5 7.5 0 0 1 7.4-6.5zM19.4 13a7.5 7.5 0 0 1-14.1 2.4H8v-2H2v6h2v-2.3A9.5 9.5 0 0 0 21.4 13h-2z";
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

/**
 * One setting: its name and a line of explanation on the left, the control on
 * the right (stacked on a narrow window).
 */
function field(label: string, hint: string | HTMLElement, ...controls: (HTMLElement | string)[]): HTMLElement {
  const text = h("div", { class: "field-text" }, h("div", { class: "field-label", text: label }));
  if (hint) text.append(typeof hint === "string" ? h("div", { class: "field-hint", text: hint }) : h("div", { class: "field-hint" }, hint));
  return h("div", { class: "field" }, text, h("div", { class: "field-ctrl" }, ...controls));
}

/** Settings that belong together, in one rounded box with a small heading. */
function group(title: string, ...children: (HTMLElement | string)[]): HTMLElement {
  return h("div", { class: "group-wrap" },
    title ? h("div", { class: "group-title", text: title }) : "",
    h("div", { class: "group" }, ...children),
  );
}

/**
 * Turns an older `.row` (a label, its controls, a hint span) into a `.field`
 * in place, so code that kept a reference to the row (to hide it, say) still
 * works. Rows without a label become a right-aligned button row.
 */
function upgradeRows(scope: HTMLElement) {
  for (const row of Array.from(scope.querySelectorAll<HTMLElement>(".row:not(.check-item)"))) {
    const first = row.firstElementChild;
    if (!(first instanceof HTMLLabelElement)) {
      row.classList.replace("row", "button-row");
      continue;
    }
    const text = h("div", { class: "field-text" });
    first.classList.add("field-label");
    text.append(first);
    const ctrl = h("div", { class: "field-ctrl" });
    for (const child of Array.from(row.childNodes)) {
      if (child instanceof HTMLElement && child.classList.contains("hint")) {
        child.classList.replace("hint", "field-hint");
        text.append(child);
      } else {
        ctrl.append(child);
      }
    }
    row.classList.replace("row", "field");
    row.replaceChildren(text, ctrl);
    // A note written as its own line right under the row belongs to it.
    const next = row.nextElementSibling;
    if (next instanceof HTMLDivElement && next.className === "hint") {
      next.className = "field-hint";
      text.append(next);
    }
  }
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
    h("div", { class: "row check-item" },
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
          ? "Hooks de una versión anterior: actualízalos en la sección Claude Code."
          : "Las sesiones, los permisos y las preguntas aparecen en la isla."
        : claudeFound
          ? "Claude Code está en este PC, pero Coucou aún no está conectado: usa “Instalar hooks…” en la sección Claude Code."
          : "Instala los hooks (en Claude Code) para ver tus sesiones en la isla.",
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
            : `Encontrado en este PC pero sin conectar: usa “Conectar…” en Agentes.`,
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
      `Chat con ${chatProviderInfo(settings.chatProvider).name}`,
      hasProviderKey
        ? chatProviderInfo(settings.chatProvider).keyless
          ? "Corre en tu equipo: no necesita clave. “Probar conexión” (Chat e IA) comprueba que el programa esté abierto."
          : "Clave guardada en el Administrador de credenciales de Windows."
        : settings.chatProvider !== "anthropic"
          ? "Pega tu clave en Proveedor de chat."
          : "Pega tu clave de la API de Anthropic en Claude, o elige otro proveedor (DEVMARK AI, Gemini, Groq) en Proveedor de chat.",
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
    id: "copilot", color: "#818CF8",
    what: "Crea ~/.copilot/hooks/coucou.json con los eventos de Copilot CLI. Los permisos se siguen respondiendo en su terminal.",
    missing: "No se encontró Copilot CLI en este PC. Aun así puedes conectarlo para cuando lo instales.",
  },
  {
    id: "muse", color: "#38BDF8",
    what: "Añade los hooks de Coucou a ~/.config/muse/settings.json, sin tocar lo demás.",
    missing: "No se encontró Muse Code en este PC. Aun así puedes conectarlo para cuando lo instales.",
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
  const note = h("p", { class: "lead" });
  const list = h("div", { style: "display:flex;flex-direction:column;gap:14px" });
  const statuses = new Map(initial.map((s) => [s.id, s]));
  const NAMES: Record<string, string> = {
    gemini: "Gemini CLI", opencode: "OpenCode", copilot: "Copilot CLI", muse: "Muse Code", vscode: "VS Code",
  };

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
    const head = field("", h("span", { class: "with-dot" }, statusDot(connected), h("span", { text: connected ? "Conectado" : "Sin conectar" })), sw);
    head.querySelector(".field-label")?.replaceChildren(
      h("span", { class: "service-name" }, h("i", { class: "dot", style: `background:${def.color}` }), h("span", { text: status?.name ?? NAMES[def.id] ?? def.id })),
    );
    box.append(head, h("div", { class: "group-note", text: def.what }));
    if (status && !status.detected && def.missing) box.append(h("div", { class: "group-note", text: def.missing }));

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
    const box = h("div", { class: "group" });
    list.append(box);
    drawAgent(def, box);
  }
  updateNote();
  return h("section", { class: "plain" }, note, list);
}

// ── Your own apps ─────────────────────────────────────────────────────────────

const randomText = (bytes: number, alphabet: string) => {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (v) => alphabet[v % alphabet.length]).join("");
};

const tokenKey = (id: string) => `custom-${id.replace(/^custom_/, "")}-token`;
const hookUrl = (p: CustomPill) => `http://127.0.0.1:${WEBHOOK_PORT}/hook/${p.hookToken}`;

function newPill(): CustomPill {
  return {
    id: `custom_${randomText(8, "abcdefghijklmnopqrstuvwxyz0123456789")}`,
    name: "Mi app",
    color: "#2DA8F5",
    kind: "webhook",
    hookToken: randomText(32, "abcdef0123456789"),
    pollUrl: "",
    pollPath: "",
    pollEvery: 120,
    authHeader: "Authorization",
    openUrl: "",
  };
}

function customSection(): HTMLElement {
  const list = h("div", { style: "display:flex;flex-direction:column;gap:18px" });
  const addBtn = h("button", { class: "primary", text: "Añadir app" });

  const field = (label: string, input: HTMLElement, hint?: string) =>
    h("div", { class: "row" }, h("label", { text: label }), input, hint ? h("span", { class: "hint", text: hint }) : h("span"));

  function draw() {
    clear(list);
    for (const pill of settings.customPills) list.append(card(pill));
    addBtn.style.display = settings.customPills.length >= CUSTOM_PILL_LIMIT ? "none" : "";
  }

  function card(pill: CustomPill): HTMLElement {
    const feedback = h("div", {});
    const text = (value: string, placeholder: string, on: (v: string) => void, type = "text") => {
      const el = h("input", { type, value, placeholder, spellcheck: "false", style: "flex:1 1 auto;min-width:0" }) as HTMLInputElement;
      el.addEventListener("change", () => { on(el.value.trim()); void save(); });
      return el;
    };

    const name = text(pill.name, "Nombre", (v) => (pill.name = v.slice(0, 24) || "Mi app"));
    const color = h("input", { type: "color", value: pill.color }) as HTMLInputElement;
    color.addEventListener("change", () => { pill.color = color.value; void save(); });
    const kind = h("select", {}) as HTMLSelectElement;
    kind.append(
      h("option", { value: "webhook", text: "Recibe avisos de otro programa (webhook)" }),
      h("option", { value: "poll", text: "Consulta una dirección cada cierto tiempo (URL)" }),
    );
    kind.value = pill.kind;
    kind.addEventListener("change", () => { pill.kind = kind.value as CustomPill["kind"]; void save(); drawBody(); });

    const body = h("div", { style: "display:flex;flex-direction:column;gap:10px" });

    function drawBody() {
      clear(body);
      clear(feedback);
      if (pill.kind === "webhook") {
        const url = h("input", { type: "text", value: hookUrl(pill), readonly: "true", style: "flex:1 1 auto;min-width:0" }) as HTMLInputElement;
        url.addEventListener("focus", () => url.select());
        body.append(
          h("div", { class: "hint", text: "Cualquier programa tuyo (un script, n8n, una acción de GitHub…) puede avisar a Mochi con un POST a esta dirección. Solo funciona desde este PC, y el secreto va en la propia dirección: no la compartas." }),
          h("div", { class: "row" }, h("label", { text: "Dirección" }), url, h("button", { text: "Copiar", onclick: () => void navigator.clipboard?.writeText(url.value) })),
          h("div", { class: "hint", text: `Ejemplo:  curl -X POST ${hookUrl(pill)} -d '{"title":"Deploy listo","detail":"v1.2","status":"success"}'   (status: success, error o info)` }),
        );
      } else {
        const secret = h("input", { type: "password", placeholder: "Token (opcional)", autocomplete: "off", style: "flex:1 1 auto;min-width:0" }) as HTMLInputElement;
        const saveToken = h("button", { text: "Guardar token" });
        saveToken.addEventListener("click", async () => {
          if (!secret.value.trim()) return;
          clear(feedback);
          try {
            await Bridge.secretSet(tokenKey(pill.id), secret.value.trim());
            secret.value = "";
            feedback.append(h("div", { class: "notice ok", text: "Guardado en el Administrador de credenciales de Windows." }));
          } catch (err) {
            feedback.append(h("div", { class: "notice err", text: `No se pudo guardar: ${String(err)}` }));
          }
        });
        const every = text(String(pill.pollEvery), "120", (v) => (pill.pollEvery = Math.max(30, Number(v) || 120)));
        body.append(
          field("Dirección", text(pill.pollUrl, "https://…", (v) => (pill.pollUrl = v)), "debe empezar por http:// o https://"),
          field("Valor a mostrar", text(pill.pollPath, "data.issues_abiertos", (v) => (pill.pollPath = v)), "ruta dentro del JSON, separada por puntos; vacío = toda la respuesta"),
          h("div", { class: "row" }, h("label", { text: "Cada" }), every, h("span", { class: "hint", text: "segundos (mínimo 30)" })),
          h("div", { class: "row" }, h("label", { text: "Token" }), secret, saveToken),
          field("Cabecera del token", text(pill.authHeader, "Authorization", (v) => (pill.authHeader = v || "Authorization")), "Authorization usa «Bearer …» solo"),
          h("div", { class: "hint", text: "Un cambio en el valor se avisa como un evento; la primera lectura no." }),
        );
      }
      body.append(field("Al hacer clic en ↗", text(pill.openUrl, "https://… (opcional)", (v) => (pill.openUrl = v)), "abre esta dirección"));
      const test = h("button", { text: pill.kind === "webhook" ? "Enviar aviso de prueba" : "Probar ahora" });
      test.addEventListener("click", async () => {
        clear(feedback);
        test.disabled = true;
        try {
          await save(); // the island needs the pill before it can test it
          const result = await Bridge.customTest(pill.id);
          feedback.append(h("div", { class: "notice ok", text: pill.kind === "poll" ? `Leído: ${result}` : result }));
        } catch (err) {
          feedback.append(h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }));
        } finally {
          test.disabled = false;
        }
      });
      const remove = h("button", { class: "danger", text: "Quitar esta app" });
      remove.addEventListener("click", async () => {
        settings.customPills = settings.customPills.filter((p) => p.id !== pill.id);
        try { await Bridge.secretClear(tokenKey(pill.id)); } catch { /* nothing was saved */ }
        void save();
        draw();
      });
      body.append(h("div", { class: "row" }, test, remove), feedback);
    }
    drawBody();

    return h("div", { class: "notice", style: "display:flex;flex-direction:column;gap:10px" },
      h("div", { class: "row" }, h("label", { text: "Nombre" }), name, color),
      h("div", { class: "row" }, h("label", { text: "Cómo se entera" }), kind),
      body,
    );
  }

  addBtn.addEventListener("click", () => {
    if (settings.customPills.length >= CUSTOM_PILL_LIMIT) return;
    settings.customPills = [...settings.customPills, newPill()];
    void save();
    draw();
  });
  draw();

  return h("section", {},
    h("h2", {}, h("span", { text: "Mis apps" })),
    h("div", { class: "hint", text: `Añade tus propios programas y servicios a la isla: cada uno tiene su pill, su tarjeta y sus avisos. Hasta ${CUSTOM_PILL_LIMIT}.` }),
    list,
    h("div", { class: "row" }, addBtn),
  );
}

// ── Voice ─────────────────────────────────────────────────────────────────────

function voiceSection(present: Record<string, boolean>): HTMLElement {
  const engine = h("select", {}) as HTMLSelectElement;
  engine.append(
    h("option", { value: "system", text: "Voz de Windows (gratis, sin conexión)" }),
    h("option", { value: "elevenlabs", text: "ElevenLabs (voz natural o personalizada)" }),
  );
  engine.value = settings.voiceEngine;

  // ElevenLabs: key, voice, model.
  const keyField = h("input", { type: "password", placeholder: "sk_…", autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
  const keyState = h("span");
  const saveKey = h("button", { class: "primary", text: "Guardar" });
  const clearKey = h("button", { class: "danger", text: "Quitar" });
  const feedback = h("div", {});

  const voice = h("select", {}) as HTMLSelectElement;
  const voiceId = h("input", { type: "text", value: settings.elevenVoice, spellcheck: "false", placeholder: "ID de la voz" }) as HTMLInputElement;
  const model = h("select", {}) as HTMLSelectElement;
  model.append(
    h("option", { value: "eleven_multilingual_v2", text: "Multilingual v2 (la más natural)" }),
    h("option", { value: "eleven_flash_v2_5", text: "Flash v2.5 (la más rápida y barata)" }),
    h("option", { value: "eleven_turbo_v2_5", text: "Turbo v2.5 (equilibrada)" }),
  );
  model.value = settings.elevenModel;

  const eleven = group("ElevenLabs",
    h("div", { class: "group-note", text: "Voces muy naturales, o una tuya, creadas en elevenlabs.io. Cada frase gasta caracteres de tu plan; las frases repetidas no se cobran dos veces." }),
    field("Clave API", keyState, keyField, saveKey, clearKey),
    field("¿No tienes clave?", "Developers → API Keys en tu cuenta de ElevenLabs.",
      h("button", { text: "Conseguir una clave", onclick: () => void Bridge.openUrl("https://elevenlabs.io/app/settings/api-keys") })),
    field("Voz", "Una de tu lista.", voice, h("button", { text: "Cargar mis voces", onclick: () => void loadVoices() })),
    field("ID de la voz", "O pega el de una voz tuya (Voces → ⋯ → Copiar ID).", voiceId),
    field("Modelo", "", model),
    feedback,
  );

  async function refreshKey() {
    const has = (await Bridge.secretPresent("elevenlabs-api-key")) ?? false;
    present["elevenlabs-api-key"] = has;
    keyState.textContent = has ? "Guardada en el Administrador de credenciales de Windows." : "Aún no hay clave.";
    keyField.placeholder = has ? "••••••••••••  (guardada)" : "sk_…";
    clearKey.style.display = has ? "" : "none";
  }
  saveKey.addEventListener("click", async () => {
    const value = keyField.value.trim();
    if (!value) return;
    clear(feedback);
    try {
      await Bridge.secretSet("elevenlabs-api-key", value);
      keyField.value = "";
      await refreshKey();
      void loadVoices();
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: `No se pudo guardar: ${String(err)}` }));
    }
  });
  clearKey.addEventListener("click", async () => {
    await Bridge.secretClear("elevenlabs-api-key");
    await refreshKey();
  });

  async function loadVoices() {
    clear(feedback);
    try {
      const list = (await Bridge.voiceList()) ?? [];
      voice.replaceChildren(
        ...list.map((v) => h("option", { value: v.id, text: v.category ? `${v.name} · ${v.category}` : v.name })),
      );
      if (list.some((v) => v.id === settings.elevenVoice)) voice.value = settings.elevenVoice;
      else if (list[0]) chooseVoice(list[0].id);
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }));
    }
  }
  function chooseVoice(id: string) {
    settings.elevenVoice = id;
    voiceId.value = id;
    void save();
  }
  voice.addEventListener("change", () => chooseVoice(voice.value));
  voiceId.addEventListener("change", () => chooseVoice(voiceId.value.trim()));
  model.addEventListener("change", () => {
    settings.elevenModel = model.value;
    void save();
  });

  const test = h("button", { text: "Probar voz" });
  test.addEventListener("click", () => {
    clear(feedback);
    State.settings = { ...State.settings, ...settings };
    stopSpeaking();
    const phrase = settings.language === "en" || (settings.language === "auto" && !navigator.language.startsWith("es"))
      ? "Hi! I'm Mochi. This is how I sound."
      : "¡Hola! Soy Mochi. Así es como sueno.";
    speak(phrase);
  });

  function syncEngine() {
    eleven.style.display = settings.voiceEngine === "elevenlabs" ? "" : "none";
  }
  engine.addEventListener("change", () => {
    settings.voiceEngine = engine.value as Settings["voiceEngine"];
    void save();
    syncEngine();
    if (settings.voiceEngine === "elevenlabs" && present["elevenlabs-api-key"]) void loadVoices();
  });
  syncEngine();
  void refreshKey().then(() => {
    if (settings.voiceEngine === "elevenlabs" && present["elevenlabs-api-key"]) void loadVoices();
  });

  // What Mochi says on its own, once its voice is on.
  const options = [
    field("Dice la bienvenida", "Tu nombre y el momento del día al iniciar.",
      toggle(settings.voiceGreeting, (v) => { settings.voiceGreeting = v; void save(); })),
    field("Avisa de los agentes", "Sesión terminada, permisos, preguntas y errores de Claude Code y los demás agentes.",
      toggle(settings.voiceEvents, (v) => { settings.voiceEvents = v; void save(); })),
    field("Dice lo que siente", "Cuando le haces clic, se marea o le das cariño.",
      toggle(settings.voiceEmotions, (v) => { settings.voiceEmotions = v; void save(); })),
    field("Lee las respuestas del chat", "Solo la primera frase o dos; con ElevenLabs gastan crédito.",
      toggle(settings.voiceReplies, (v) => { settings.voiceReplies = v; void save(); })),
  ];
  const showOptions = (on: boolean) => options.forEach((o) => (o.style.display = on ? "" : "none"));
  showOptions(settings.voiceEnabled);

  // Listening: the wake phrase, and the shortcut that pauses it.
  const groqNote = h("span");
  void Bridge.secretPresent("groq-api-key").then((has) => {
    groqNote.textContent = has
      ? "Usa Whisper de Groq con la clave que ya guardaste."
      : "Necesita una clave de Groq (Chat e IA → Groq).";
  });

  return h("section", { class: "plain" },
    h("p", { class: "lead", text: "Mochi puede hablarte y escucharte. Todo es opcional y está apagado hasta que lo enciendas." }),
    group("Quién habla",
      field("Voz de Mochi", "Windows: gratis y sin conexión. ElevenLabs: natural o tu propia voz.", engine, test),
    ),
    eleven,
    group("Qué dice Mochi",
      field("Mochi habla", "Sin esto no dice nada por sí solo.",
        toggle(settings.voiceEnabled, (v) => {
          settings.voiceEnabled = v;
          if (v && !settings.voiceGreeting && !settings.voiceEvents) {
            // First time: start with the useful ones; replies stay off (they can be long and cost credit).
            settings.voiceGreeting = true;
            settings.voiceEvents = true;
            settings.voiceEmotions = true;
          }
          void save();
          showOptions(v);
          if (v) {
            State.settings = { ...State.settings, ...settings };
            speak(settings.userName.trim() ? `Hola ${settings.userName.trim()}` : "Hola");
          }
        })),
      ...options,
      h("div", { class: "group-note", text: "«Oye Mochi» también habla cuando la voz está encendida. Cada respuesta del chat tiene un botón de altavoz con la voz gratis de Windows." }),
    ),
    group("Escuchar",
      field("Escuchar «Oye Mochi»", groqNote,
        toggle(settings.wakeWord, (v) => { settings.wakeWord = v; void save(); })),
      h("div", { class: "notice warn", text: "Mientras está encendido, el micrófono está abierto y cada frase se envía a Groq para entenderla (no se guarda nada). Apágalo aquí, con el micrófono de la isla o con el atajo." }),
      shortcutRow("listen", "Encender o pausar la escucha", "Ctrl+Alt+M", () => settings.listenShortcut, (a) => (settings.listenShortcut = a)),
      h("div", { class: "group-note", text: "En el chat también hay un botón de micrófono para dictar una sola pregunta, sin «Oye Mochi»." }),
    ),
  );
}

// ── Personalization ───────────────────────────────────────────────────────────

/** Settings → Mascota: when Mochi the pet comes, what it says, and the person's own phrases. */
function petSection(): HTMLElement {
  const areas = TOPICS.map((topic) => {
    const info = TOPIC_NAMES[topic];
    const box = h("textarea", {
      rows: "3",
      spellcheck: "true",
      placeholder: "Una frase por línea. Puedes usar {name}, {friend} y {minutes}.",
    }) as HTMLTextAreaElement;
    box.value = (settings.petPhrases[topic] ?? []).join("\n");
    box.addEventListener("change", () => {
      const lines = box.value.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 20);
      if (lines.length) settings.petPhrases = { ...settings.petPhrases, [topic]: lines };
      else {
        const { [topic]: _gone, ...rest } = settings.petPhrases;
        settings.petPhrases = rest;
      }
      void save();
    });
    return field(info.label, info.hint, box);
  });
  const friend = h("input", { type: "text", value: settings.petFriend, maxlength: "24", placeholder: "Sven", spellcheck: "false" }) as HTMLInputElement;
  friend.addEventListener("change", () => {
    settings.petFriend = friend.value.trim();
    void save();
  });
  const now = h("button", { text: "Que aparezca ya", onclick: () => void Bridge.petVisitNow() });
  return h("section", { class: "plain" },
    h("p", { class: "lead", text: "Mochi se asoma por los bordes de la pantalla, te saluda, te anima y hace travesuras según lo que estés haciendo: trabajando con un agente, escuchando música, viendo un vídeo, de madrugada…" }),
    group("Cuándo viene",
      field("Mochi travieso", "De vez en cuando se asoma por un borde, hace una travesura y se esconde. Si le haces clic se enfada; si te acercas, a veces se asusta. No aparece sobre juegos, vídeos a pantalla completa ni con Coucou en pausa.",
        toggle(settings.petEnabled, (v) => { settings.petEnabled = v; void save(); })),
      field("Cada cuánto", "Cuando algo termina o falla viene antes, si hace un rato que no se asoma.", petFrequencySelect(), now),
    ),
    group("Qué dice",
      field("Habla en un globo", "Frases que encajan con el momento.", toggle(settings.petSpeech, (v) => { settings.petSpeech = v; void save(); })),
      field("Habla en voz alta", "Necesita «Mochi habla» activado en Voz. Con un vídeo en marcha nunca habla en voz alta.", toggle(settings.voicePet, (v) => { settings.voicePet = v; void save(); })),
      field("Su amigo", "Un nombre que puede salir: «sigue trabajando para la comida de Sven». Vacío: no se nombra a nadie.", friend),
      field("Solo mis frases", "Si está activo, usa únicamente las que escribas abajo (en los temas donde no escribas ninguna usa las suyas).", toggle(settings.petOnlyMine, (v) => { settings.petOnlyMine = v; void save(); })),
    ),
    group("Tus frases", h("div", { class: "group-note", text: "Escribe las tuyas, una por línea; se mezclan con las de Mochi. {name} es tu nombre, {friend} su amigo y {minutes} los minutos que llevas trabajando. En voz alta se leen con la voz que elegiste." }), ...areas),
  );
}

function petFrequencySelect(): HTMLSelectElement {
  const select = h("select", {}) as HTMLSelectElement;
  select.append(
    h("option", { value: "rare", text: "Rara vez (cada 25–50 min)" }),
    h("option", { value: "normal", text: "A veces (cada 8–20 min)" }),
    h("option", { value: "often", text: "A menudo (cada 3–8 min)" }),
  );
  select.value = settings.petFrequency;
  select.addEventListener("change", () => {
    settings.petFrequency = select.value as Settings["petFrequency"];
    void save();
  });
  return select;
}

function outfitSelect(): HTMLSelectElement {
  const select = h("select", {}) as HTMLSelectElement;
  for (const id of OUTFITS) select.append(h("option", { value: id, text: OUTFIT_NAMES[id] }));
  select.value = isOutfit(settings.mochiOutfit) ? settings.mochiOutfit : "auto";
  select.addEventListener("change", () => {
    settings.mochiOutfit = select.value;
    void save();
  });
  return select;
}

function personalSection(detectedName: string): HTMLElement {
  const preview = h("div", { class: "notice ok" });
  const refresh = () => {
    const lines = greetingLines({
      name: settings.userName.trim() || detectedName,
      template: settings.greetingTemplate,
      language: settings.language,
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
  language.value = settings.language;
  language.addEventListener("change", () => {
    settings.language = language.value as Settings["language"];
    void save();
    applyLanguage(settings.language);
    refresh();
  });

  // Which pill opens first: Claude Code, or any of the ones that are switched on.
  const startPill = h("select", {}) as HTMLSelectElement;
  const names: Record<string, string> = {
    integration_claude: "Claude Code", integration_github: "GitHub",
    integration_vercel: "Vercel", integration_resend: "Resend", integration_notion: "Notion",
    integration_calcom: "Cal.com", integration_stripe: "Stripe", integration_system: "Modo",
    agent_gemini: "Gemini CLI", agent_opencode: "OpenCode", agent_copilot: "Copilot CLI", agent_muse: "Muse Code", agent_vscode: "VS Code",
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
    h("div", { class: "row" }, h("label", { text: "Idioma de la interfaz" }), language),
    h("div", { class: "row" },
      h("label", { text: "Pill inicial" }),
      startPill,
    ),
    h("div", { class: "hint", text: "El pill que se muestra primero al abrir la isla." }),
    h("div", { class: "row" },
      h("label", { text: "Lo último y pendientes" }),
      toggle(settings.greetingPicker, (v) => { settings.greetingPicker = v; void save(); }),
      h("span", { class: "hint", text: "en la bienvenida: tu último proyecto y lo que espera (revisiones, CI)" }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Atuendo de Mochi" }),
      outfitSelect(),
      h("span", { class: "hint", text: "Automático: gorro de Papá Noel en diciembre, sombrero de bruja en octubre, orejas de conejo en Pascua, gafas de sol en verano, gorro de fiesta en Año Nuevo." }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Baila con la música" }),
      toggle(settings.musicDance, (v) => { settings.musicDance = v; void save(); }),
      h("span", { class: "hint", text: "Mochi baila mientras suena algo (Spotify, el navegador…). Solo mira si suena, nunca guarda ni envía qué." }),
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

// ── Chat provider ─────────────────────────────────────────────────────────────

/** An AI that can answer the chat besides Claude. */
interface ProviderDef {
  id: "devmark" | "gemini" | "groq" | "local";
  /** As it reads in the drop-down. */
  name: string;
  /** Credential Manager entry for its key. */
  keyName: string;
  keyPlaceholder: string;
  modelSetting: "devmarkModel" | "geminiModel" | "groqModel" | "localModel";
  /** Runs on your own computer: an address instead of a key (the key is optional). */
  local?: boolean;
  modelDefault: string;
  intro: string;
  /** Where a person gets a key. */
  getKeyUrl?: string;
}

const PROVIDERS: ProviderDef[] = [
  {
    id: "devmark", name: "DEVMARK AI (privada)", keyName: "devmark-api-key", keyPlaceholder: "dmk_live_…",
    modelSetting: "devmarkModel", modelDefault: "llama3.2:1b",
    intro: "IA privada de la empresa (compatible con OpenAI, https://ai.devmarkpe.com). Solo lee texto, responde un mensaje a la vez y la primera respuesta puede tardar.",
  },
  {
    id: "gemini", name: "Gemini (Google)", keyName: "gemini-api-key", keyPlaceholder: "AIza…",
    modelSetting: "geminiModel", modelDefault: "gemini-3.8-flash",
    intro: "Gemini, de Google AI Studio. Lee texto y código. La clave se crea gratis en Google AI Studio. Si un modelo no existe, “Probar conexión” muestra los que tu clave puede usar.",
    getKeyUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "groq", name: "Groq", keyName: "groq-api-key", keyPlaceholder: "gsk_…",
    modelSetting: "groqModel", modelDefault: "llama-3.3-70b-versatile",
    intro: "Groq: respuestas muy rápidas con modelos abiertos (Llama y otros). Lee texto y código. Crea una clave en la consola de Groq; “Probar conexión” muestra los modelos disponibles.",
    getKeyUrl: "https://console.groq.com/keys",
  },
  {
    id: "local", name: "Modelo local (Ollama, LM Studio)", keyName: "local-api-key", keyPlaceholder: "solo si tu servidor la pide",
    modelSetting: "localModel", modelDefault: "llama3.2", local: true,
    intro: "Un modelo que corre en tu propio equipo, con Ollama o LM Studio: sin clave, gratis y nada sale de tu red. Abre el programa, descarga un modelo y enciende su servidor; luego “Probar conexión” muestra los modelos que tiene.",
  },
];

/** Where each local program listens by default. */
const LOCAL_PRESETS: { name: string; url: string; model: string }[] = [
  { name: "Ollama", url: "http://127.0.0.1:11434/v1", model: "llama3.2" },
  { name: "LM Studio", url: "http://127.0.0.1:1234/v1", model: "" },
];

/** Name and key of whoever answers the chat now, for the setup checklist. */
function chatProviderInfo(id: Settings["chatProvider"]): { name: string; keyName: string; keyless: boolean } {
  const p = PROVIDERS.find((x) => x.id === id);
  return p
    ? { name: p.name.replace(/ \(.*\)$/, ""), keyName: p.keyName, keyless: !!p.local }
    : { name: "Claude", keyName: "anthropic-api-key", keyless: false };
}

/** Which AI answers the chat, and the key, model and test of each one. */
function providerSection(present: Record<string, boolean>): HTMLElement {
  const provider = h("select", {}) as HTMLSelectElement;
  provider.append(h("option", { value: "anthropic", text: "Claude (Anthropic)" }));
  for (const def of PROVIDERS) provider.append(h("option", { value: def.id, text: def.name }));
  provider.value = settings.chatProvider;

  const dot = statusDot(false);
  const blocks = new Map<string, HTMLElement>();

  function buildBlock(def: ProviderDef): HTMLElement {
    const state = h("span", { class: "hint" });
    const field = h("input", {
      type: "password",
      placeholder: def.keyPlaceholder,
      style: "flex:1 1 auto;min-width:0",
      autocomplete: "off",
      spellcheck: "false",
    }) as HTMLInputElement;
    const saveBtn = h("button", { class: "primary", text: "Guardar clave" });
    const clearBtn = h("button", { class: "danger", text: "Quitar" });
    const feedback = h("div", {});

    const model = h("input", {
      type: "text",
      value: settings[def.modelSetting],
      placeholder: def.modelDefault,
      style: "flex:1 1 auto;min-width:0",
      spellcheck: "false",
    }) as HTMLInputElement;
    model.addEventListener("change", () => {
      settings[def.modelSetting] = model.value.trim() || def.modelDefault;
      model.value = settings[def.modelSetting];
      void save();
    });

    async function refresh() {
      const has = (await Bridge.secretPresent(def.keyName)) ?? false;
      present[def.keyName] = has;
      state.textContent = has
        ? "Clave guardada en el Administrador de credenciales de Windows."
        : def.local ? "No hace falta clave." : "Aún no hay clave: pega la que te dieron.";
      field.placeholder = has ? "••••••••••••  (guardada)" : def.keyPlaceholder;
      clearBtn.style.display = has ? "" : "none";
      // A model on your own computer is ready without a key.
      if (provider.value === def.id) dot.style.background = has || def.local ? "#22c55e" : "#f4505e";
    }

    saveBtn.addEventListener("click", async () => {
      const value = field.value.trim();
      if (!value) return;
      clear(feedback);
      try {
        await Bridge.secretSet(def.keyName, value);
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
        await Bridge.secretClear(def.keyName);
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
        const result = await Bridge.providerTest(def.id);
        feedback.append(h("div", { class: result.ok ? "notice ok" : "notice warn", text: result.message }));
      } catch (err) {
        feedback.append(h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }));
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = "Probar conexión";
      }
    });

    const rows: Node[] = [
      h("div", { class: "hint", text: def.intro }),
      state,
    ];
    if (def.local) {
      const url = h("input", {
        type: "text", value: settings.localUrl, placeholder: "http://127.0.0.1:11434/v1", spellcheck: "false",
      }) as HTMLInputElement;
      url.addEventListener("change", () => {
        settings.localUrl = url.value.trim() || LOCAL_PRESETS[0].url;
        url.value = settings.localUrl;
        void save();
      });
      const presets = LOCAL_PRESETS.map((p) =>
        h("button", { text: p.name, onclick: () => {
          settings.localUrl = p.url;
          url.value = p.url;
          if (p.model) {
            settings.localModel = p.model;
            model.value = p.model;
          }
          void save();
        } }),
      );
      rows.push(
        h("div", { class: "row" }, h("label", { text: "Dirección" }), url),
        h("div", { class: "row" }, h("label", { text: "Usar los valores de" }), ...presets),
        h("div", { class: "row" }, h("label", { text: "Clave (opcional)" }), field, saveBtn, clearBtn),
      );
    } else {
      rows.push(h("div", { class: "row" }, h("label", { text: "Clave API" }), field, saveBtn, clearBtn));
    }
    if (def.getKeyUrl) {
      rows.push(
        h("div", { class: "row" },
          h("button", { text: "Conseguir una clave", onclick: () => void Bridge.openUrl(def.getKeyUrl!) }),
        ),
      );
    }
    rows.push(h("div", { class: "row" }, h("label", { text: "Modelo" }), model));

    // DEVMARK AI's replies are kept short on purpose: the model runs on a CPU.
    if (def.id === "devmark") {
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
      rows.push(
        h("div", { class: "row" },
          h("label", { text: "Respuesta máx." }),
          tokens,
          h("span", { class: "hint", text: "tokens: más corto es más rápido" }),
        ),
      );
    }
    rows.push(h("div", { class: "row" }, testBtn), feedback);

    const block = h("div", { style: "display:flex;flex-direction:column;gap:12px" }, ...rows);
    (block as HTMLElement & { refresh?: () => Promise<void> }).refresh = refresh;
    void refresh();
    return block;
  }

  const section = h(
    "section",
    {},
    h("h2", {}, dot, h("span", { text: "Proveedor de chat" })),
    h("div", { class: "hint", text: "Quién responde cuando le preguntas algo a Mochi. Al cambiarlo empieza una conversación nueva." }),
    h("div", { class: "row" }, h("label", { text: "Responde con" }), provider),
  );
  for (const def of PROVIDERS) {
    const block = buildBlock(def);
    blocks.set(def.id, block);
    section.append(block);
  }

  // Only the chosen provider's settings are shown; Claude's live in its own section below.
  const show = () => {
    for (const [id, block] of blocks) block.style.display = provider.value === id ? "" : "none";
    const def = PROVIDERS.find((p) => p.id === provider.value);
    dot.style.display = def ? "" : "none";
    if (def) dot.style.background = present[def.keyName] || def.local ? "#22c55e" : "#f4505e";
  };
  provider.addEventListener("change", () => {
    settings.chatProvider = provider.value as Settings["chatProvider"];
    show();
    void save();
  });
  show();
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
  { id: "integration_system", name: "Modo", color: "#A78BFA", fields: [] },
  { id: "integration_stripe", name: "Stripe", color: "#0570DE",
    fields: [{ key: "stripe-api-key", label: "Clave secreta", placeholder: "sk_live_…", secret: true }] },
  { id: "integration_github", name: "GitHub", color: "#F4505E",
    fields: [{ key: "github-token", label: "Token", placeholder: "ghp_…", secret: true }] },
  { id: "integration_vercel", name: "Vercel", color: "#7C5CFF",
    fields: [{ key: "vercel-token", label: "Token", placeholder: "…", secret: true }] },
  { id: "integration_resend", name: "Resend", color: "#22C55E",
    fields: [{ key: "resend-api-key", label: "Clave API", placeholder: "re_…", secret: true }] },
  { id: "integration_notion", name: "Notion", color: "#8C8C8C",
    fields: [{ key: "notion-api-key", label: "Token de integración", placeholder: "ntn_…", secret: true }] },
  { id: "integration_calcom", name: "Cal.com", color: "#C9956A",
    fields: [{ key: "calcom-api-key", label: "Clave API", placeholder: "cal_…", secret: true }] },
];

const MAX_ACTIVE = 4;

function integrationsSection(present: Record<string, boolean>): HTMLElement {
  const note = h("p", { class: "lead" });
  const cards: HTMLElement[] = [];

  function updateNote() {
    const used = settings.activeIntegrations.length;
    note.textContent = `Elige hasta ${MAX_ACTIVE} pills para mostrar junto a Mochi (${used}/${MAX_ACTIVE} en uso). Las claves se guardan en el Administrador de credenciales de Windows, nunca en disco.`;
  }

  for (const def of INTEGRATIONS) {
    const active = settings.activeIntegrations.includes(def.id);
    const sw = h("button", { class: active ? "switch on" : "switch", "aria-label": `Mostrar ${def.name}` });
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

    const keyFields = def.fields.map((f) => {
      const input = h("input", {
        type: f.secret ? "password" : "text",
        placeholder: present[f.key] ? "••••••••  (guardada)" : f.placeholder,
        autocomplete: "off",
        spellcheck: "false",
      }) as HTMLInputElement;
      const state = h("span", { text: present[f.key] ? "Guardada." : "Sin guardar." });
      const saveBtn = h("button", { text: "Guardar" });
      const dotEl = statusDot(present[f.key] ?? false);
      saveBtn.addEventListener("click", async () => {
        const value = input.value.trim();
        try {
          await Bridge.secretSet(f.key, value);
          present[f.key] = value.length > 0;
          input.value = "";
          input.placeholder = value ? "••••••••  (guardada)" : f.placeholder;
          dotEl.style.background = value ? "#22c55e" : "#f4505e";
          state.textContent = value ? "Guardada." : "Sin guardar.";
        } catch {
          dotEl.style.background = "#f5a524";
          state.textContent = "No se pudo guardar.";
        }
      });
      const label = h("span", { class: "with-dot" }, dotEl, h("span", { text: f.label }));
      const row = field("", state, input, saveBtn);
      row.querySelector(".field-label")?.replaceChildren(label);
      return row;
    });

    cards.push(group("",
      field("", "Mostrar su pill junto a Mochi.", sw),
      ...keyFields,
    ));
    const title = cards[cards.length - 1].querySelector(".field-label");
    title?.replaceChildren(h("span", { class: "service-name" }, h("i", { class: "dot", style: `background:${def.color}` }), h("span", { text: def.name })));
  }

  updateNote();
  return h("section", { class: "plain" }, note, ...cards);
}

// ── General section ───────────────────────────────────────────────────────────

/** Settings → General: how new versions arrive, and a button to look now. */
function updatesRow(): HTMLElement {
  const mode = h("select", {}) as HTMLSelectElement;
  mode.append(
    h("option", { value: "auto", text: "Automáticas" }),
    h("option", { value: "notify", text: "Solo avisar" }),
    h("option", { value: "off", text: "Desactivadas" }),
  );
  mode.value = settings.updates;
  mode.addEventListener("change", () => {
    settings.updates = mode.value as Settings["updates"];
    void save();
  });
  const note = h("div");
  const say = (ok: boolean, text: string) => {
    clear(note);
    note.append(h("div", { class: `notice ${ok ? "ok" : "err"}`, text }));
  };
  const install = (version: string) =>
    h("button", { class: "primary", text: `Instalar ${version} y reiniciar`, onclick: async () => {
      say(true, "Descargando… Coucou se reiniciará solo.");
      try { await Bridge.updateInstall(); } catch (e) { say(false, String(e).replace(/^Error:\s*/, "")); }
    } });
  const look = h("button", { text: "Buscar ahora", onclick: async () => {
    try {
      const found = await Bridge.updateCheck();
      if (!found) return say(true, `Tienes la última versión (${version}).`);
      say(true, `Hay una versión nueva: ${found.version}.`);
      note.append(install(found.version));
    } catch (e) { say(false, String(e).replace(/^Error:\s*/, "")); }
  } });
  void onEvent<UpdateInfo>("update-available", (u) => {
    say(true, `Hay una versión nueva: ${u.version}.`);
    note.append(install(u.version));
  });
  return h("div", { class: "field-group" },
    h("div", { class: "row" }, h("label", { text: "Actualizaciones" }), mode, look),
    h("div", { class: "hint", text: "Automáticas: Coucou se actualiza solo cuando no hay ninguna sesión trabajando ni un permiso esperando. Las versiones vienen firmadas desde GitHub." }),
    note,
  );
}

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

  const position = h("select", {}) as HTMLSelectElement;
  position.append(
    h("option", { value: "fixed", text: "Fija arriba al centro" }),
    h("option", { value: "free", text: "Libre (arrástrala)" }),
  );
  position.value = settings.islandPosition;
  position.addEventListener("change", () => {
    settings.islandPosition = position.value as Settings["islandPosition"];
    void save();
  });
  const resetPosition = h("button", { text: "Volver arriba al centro", onclick: () => void Bridge.resetIslandPosition() });

  const modeSel = h("select", {}) as HTMLSelectElement;
  for (const c of MODE_CHOICES) modeSel.append(h("option", { value: c, text: MODE_NAMES[c] }));
  modeSel.value = settings.workMode;
  modeSel.addEventListener("change", () => {
    settings.workMode = modeSel.value as Settings["workMode"];
    void save();
  });
  const games = h("textarea", {
    rows: "3", spellcheck: "false", placeholder: "mijuego.exe, otro.exe",
    style: "width:100%",
  }) as HTMLTextAreaElement;
  games.value = settings.gamePrograms.join(", ");
  games.addEventListener("change", () => {
    settings.gamePrograms = games.value.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    void save();
  });
  const modesGroup = group("Modos",
    field("Modo", "Automático detecta lo que haces. En Juego, Reunión o Vídeo la isla y la mascota se esconden, no suena nada y los permisos vuelven a la terminal: nunca estorba ni cierra tu juego.", modeSel),
    field("Detectar reuniones", "Si otro programa usa el micrófono o la cámara, es una reunión: silencio total.", toggle(settings.detectMeetings, (v) => { settings.detectMeetings = v; void save(); })),
    field("Ánimo en los juegos", "La mascota te anima solo con la voz mientras juegas; sin ventana ni sonidos.", toggle(settings.petGameCheer, (v) => { settings.petGameCheer = v; void save(); })),
    field("Otros juegos", "Programas que cuentan como juego, separados por comas. Coucou ya conoce los comunes y los de Steam.", games),
  );

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "General" })),
    modesGroup,
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
      h("label", { text: "Posición de la isla" }),
      position,
      resetPosition,
    ),
    h("div", { class: "hint", text: "En modo libre arrastra la isla a donde quieras: se queda ahí, redondeada, y no se esconde sola. Si la sueltas junto al borde de arriba o de abajo se pega a él; junto al izquierdo o el derecho se pega en vertical y se abre desde ese lado." }),
    h("div", { class: "row" },
      h("label", { text: "Iniciar con Windows" }),
      toggle(settings.autostart, (v) => { settings.autostart = v; void save(); }),
    ),
    updatesRow(),
    h("div", { class: "row" },
      h("label", { text: "Notificaciones de Windows" }),
      toggle(settings.nativeNotifications, (v) => { settings.nativeNotifications = v; void save(); }),
      h("span", { class: "hint", text: "un aviso cuando Claude te necesita o termina con la isla cerrada" }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Atajos globales" }),
      toggle(settings.globalShortcuts, (v) => { settings.globalShortcuts = v; void save(); }),
      h("span", { class: "hint", text: "Ctrl+Alt+Y permitir · Ctrl+Alt+N denegar (solo mientras hay una petición)" }),
    ),
    shortcutRow("toggle", "Abrir Coucou con", "Ctrl+Alt+C", () => settings.toggleShortcut, (a) => (settings.toggleShortcut = a)),
  );
}

/** "Abrir Coucou con": click, then press the keys you want (Esc cancels). */
function shortcutRow(
  which: "toggle" | "listen",
  label: string,
  fallback: string,
  current: () => string,
  assign: (accel: string) => void,
): HTMLElement {
  const button = h("button", { class: "btn secondary", style: "min-width:150px" }) as HTMLButtonElement;
  const note = h("span", { class: "hint" });
  const reset = h("button", { class: "link-btn", text: "Restablecer" });
  let capturing = false;

  const show = () => {
    button.textContent = capturing ? "Pulsa las teclas…" : current();
    reset.style.display = current() === fallback ? "none" : "";
  };
  const apply = async (accel: string) => {
    try {
      assign(await Bridge.setShortcut(which, accel));
      note.textContent = "Listo: ya abre y cierra la isla desde cualquier programa.";
    } catch (err) {
      note.textContent = String(err).replace(/^Error:\s*/, "");
    }
    show();
  };
  const onKey = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const got = captureAccelerator(e);
    if (got.kind === "wait") return;
    stop();
    if (got.kind === "ok") void apply(got.accel);
    else if (got.kind === "error") note.textContent = got.message;
  };
  const stop = () => {
    capturing = false;
    window.removeEventListener("keydown", onKey, true);
    show();
  };
  button.addEventListener("click", () => {
    if (capturing) return stop();
    capturing = true;
    note.textContent = "Una tecla F, o Ctrl, Alt o Shift con otra tecla. Esc cancela.";
    window.addEventListener("keydown", onKey, true);
    show();
  });
  button.addEventListener("blur", () => capturing && stop());
  reset.addEventListener("click", () => void apply(fallback));
  show();
  void onEvent<Settings>("settings-changed", () => show());
  return h("div", { class: "row" }, h("label", { text: label }), button, reset, note);
}

// ── Sync between your computers ───────────────────────────────────────────────

function syncSection(): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:10px" });
  const feedback = h("div");
  const say = (ok: boolean, text: string) => {
    clear(feedback);
    feedback.append(h("div", { class: `notice ${ok ? "ok" : "err"}`, text }));
  };
  const err = (e: unknown) => String(e).replace(/^Error:\s*/, "");

  const render = async () => {
    clear(body);
    const st = await Bridge.syncStatus();
    if (st?.connected) {
      const codeBox = h("div", { class: "hint" });
      body.append(
        h("div", { class: "row" }, statusDot(true), h("span", { text: `Conectado a ${st.url} como ${st.device}` })),
        h("div", { class: "row" },
          h("button", { text: "Sincronizar ahora", onclick: async () => {
            try { say(true, (await Bridge.syncNow()) ? "Ajustes recibidos de otro equipo." : "Ya estaba al día."); }
            catch (e) { say(false, err(e)); }
          } }),
          h("button", { text: "Mostrar código", onclick: async () => {
            clear(codeBox);
            codeBox.append(
              h("code", { text: (await Bridge.syncCode()) ?? "" }),
              h("div", { text: "Pégalo en tu otro PC (Ajustes → Sincronización → Unir). Quien tenga este código ve tus ajustes: no lo compartas." }),
            );
          } }),
          h("button", { text: "Mostrar QR para el teléfono", onclick: async () => {
            clear(codeBox);
            const code = await Bridge.syncCode();
            if (!code || !st.url) return;
            codeBox.append(
              pairingQr(st.url, code),
              h("div", { text: "En la app del teléfono: pestaña PCs → Escanear el QR. Quien lo vea puede leer tus ajustes: ciérralo cuando termines." }),
              h("button", { text: "Ocultar", onclick: () => clear(codeBox) }),
            );
          } }),
          h("button", { class: "danger", text: "Desconectar este equipo", onclick: async () => {
            await Bridge.syncDisconnect();
            void render();
          } }),
        ),
        codeBox,
      );
      return;
    }
    const url = h("input", { type: "url", placeholder: "https://coucou-sync.<tu-cuenta>.workers.dev", value: settings.syncUrl }) as HTMLInputElement;
    url.style.width = "100%";
    const code = h("input", { type: "text", placeholder: "código de tu otro equipo (64 caracteres)" }) as HTMLInputElement;
    code.style.width = "100%";
    body.append(
      h("div", { class: "row" }, h("label", { text: "Servidor" }), url),
      h("div", { class: "row" },
        h("button", { text: "Crear cuenta en este equipo", onclick: async () => {
          try {
            const made = await Bridge.syncConnect(url.value, null);
            await render();
            say(true, `Cuenta creada. Tu código: ${made}`);
          } catch (e) { say(false, err(e)); }
        } }),
      ),
      h("div", { class: "row" }, h("label", { text: "o unir con código" }), code,
        h("button", { text: "Unir", onclick: async () => {
          try {
            await Bridge.syncConnect(url.value, code.value);
            await render();
            say(true, "Unido: los ajustes de tu otro equipo ya están aquí.");
          } catch (e) { say(false, err(e)); }
        } }),
      ),
    );
  };
  void render();

  return h("section", {},
    h("h2", {}, h("span", { text: "Sincronización" })),
    h("div", { class: "hint", text: "Tus ajustes (nombre, voz, idioma, pills, Mis apps, reglas) siguen a tus otros PCs a través de tu propio servidor de Cloudflare. Se cifran aquí antes de salir: el servidor no puede leerlos. Las claves API, la pantalla, la posición de la isla y el inicio con Windows no se sincronizan." }),
    body,
    feedback,
  );
}

// ── Boot ──────────────────────────────────────────────────────────────────────

/** The page's own title bar: the system one is off (white on a dark window). */
function wireTitlebar() {
  const mac = /Mac/i.test(navigator.platform);
  document.body.classList.toggle("mac", mac);
  if (!IS_TAURI) return;
  const win = getCurrentWindow();
  document.getElementById("tb-min")?.addEventListener("click", () => void win.minimize());
  document.getElementById("tb-max")?.addEventListener("click", () => void win.toggleMaximize());
  document.getElementById("tb-close")?.addEventListener("click", () => void win.close());
}

async function main() {
  wireTitlebar();
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
    "resend-api-key", "notion-api-key", "calcom-api-key",
    "devmark-api-key", "gemini-api-key", "groq-api-key",
  ];
  const present: Record<string, boolean> = {};
  for (const k of keys) present[k] = (await Bridge.secretPresent(k)) ?? false;

  const tools = (await Bridge.detectTools()) ?? [];
  const agents = (await Bridge.agentsStatus()) ?? [];
  const providerKey = chatProviderInfo(settings.chatProvider).keyName;
  const hasProviderKey = chatProviderInfo(settings.chatProvider).keyless || ((await Bridge.secretPresent(providerKey)) ?? false);

  // One category at a time, picked in the sidebar. Every section is built once
  // and only moved in and out, so a half-typed field survives a switch.
  const groups: { id: string; label: string; icon: string; sections: HTMLElement[] }[] = [
    { id: "start", label: "Inicio", icon: ICONS.house, sections: [setupSection(status, present, hasProviderKey, tools, detectedName, agents)] },
    { id: "personal", label: "Personalización", icon: ICONS.star, sections: [personalSection(detectedName)] },
    { id: "pet", label: "Mascota", icon: PET_ICON, sections: [petSection()] },
    { id: "voice", label: "Voz", icon: ICONS.speakerOn, sections: [voiceSection(present)] },
    { id: "claude", label: "Claude Code", icon: ICONS.doc, sections: [claudeSection(status), planSection(status), rulesSection((await Bridge.rulesList()) ?? [])] },
    { id: "agents", label: "Agentes", icon: ICONS.stack, sections: [agentsSection(agents)] },
    { id: "chat", label: "Chat e IA", icon: ICONS.bubble, sections: [providerSection(present), apiSection(hasKey)] },
    { id: "integrations", label: "Integraciones", icon: ICONS.arrowUpRight, sections: [integrationsSection(present), customSection()] },
    { id: "sync", label: "Sincronización", icon: SYNC_ICON, sections: [syncSection()] },
    { id: "general", label: "General", icon: ICONS.gear, sections: [generalSection()] },
  ];
  const content = h("main", { class: "content" });
  const buttons = new Map<string, HTMLElement>();
  const show = (id: string) => {
    const group = groups.find((g) => g.id === id) ?? groups[0];
    clear(content);
    content.append(h("h1", { text: group.label }), ...group.sections);
    // A section named like its category would say it twice.
    for (const section of group.sections) {
      const title = section.querySelector<HTMLElement>(":scope > h2");
      if (title) title.style.display = title.textContent?.trim() === group.label ? "none" : "";
    }
    content.scrollTop = 0;
    buttons.forEach((b, key) => b.classList.toggle("on", key === group.id));
    try { localStorage.setItem("coucou.settingsTab", group.id); } catch { /* storage blocked */ }
  };
  const nav = h("nav", { class: "side" },
    h("div", { class: "brand" }, h("span", { text: "Coucou" }), h("span", { class: "version", text: version })),
    ...groups.map((g) => {
      const b = h("button", { class: "nav-item", title: g.label, onclick: () => show(g.id) }, svg(g.icon, 16), h("span", { text: g.label }));
      buttons.set(g.id, b);
      return b;
    }),
    h("div", { class: "spacer" }),
    h("div", { class: "hint side-note", text: "Sin telemetría. Las peticiones de red solo van a los servicios que tú configures." }),
  );
  clear(root);
  root.classList.add("two-pane");
  root.append(nav, content);
  // Every "label + controls + note" row, now and whenever a section redraws,
  // takes the same shape as field(): name and note on the left, controls right.
  for (const g of groups) g.sections.forEach(upgradeRows);
  new MutationObserver(() => upgradeRows(content)).observe(content, { childList: true, subtree: true });
  let last = "start";
  try { last = localStorage.getItem("coucou.settingsTab") ?? "start"; } catch { /* storage blocked */ }
  // Browser preview only: settings.html#voice opens that category (for checking each one).
  if (!IS_TAURI && location.hash) last = location.hash.slice(1);
  show(last);

  void onEvent<Settings>("settings-changed", (s) => {
    settings = { ...settings, ...s };
    applyLanguage(settings.language);
  });
  applyLanguage(settings.language);
}

void main();
