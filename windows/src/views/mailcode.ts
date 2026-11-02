// The code card: a short-lived island view with one verification code, big
// and easy to read, and a copy button. Opened by island/hooks.ts on the
// "mail-code" event; closes itself after a timeout or on click, same shape
// as the approval/question cards' own timeout (see hooks.ts).

import { h } from "./dom.js";
import { State } from "../core/state.js";
import { t } from "../core/i18n.js";
import type { ViewActions, ViewHost } from "./views";

/** "4821" -> "48 21", "90214" -> "90 21 4". Purely cosmetic grouping. */
export function codeForDisplay(code: string): string {
  if (!code) return "";
  const pairs: string[] = [];
  for (let i = 0; i < code.length; i += 2) pairs.push(code.slice(i, i + 2));
  return pairs.join(" ");
}

export function buildMailCodeView(actions: Pick<ViewActions, "setView">): ViewHost {
  const codeEl = h("div", { class: "mailcode-digits" });
  const subjectEl = h("div", { class: "mailcode-subject" });
  const status = h("span", { class: "mailcode-status" });
  const copyBtn = h("button", { class: "primary mailcode-copy", text: t("Copiar") });
  const el = h(
    "div",
    { class: "view" },
    h("div", { class: "int-card mailcode-card" }, codeEl, subjectEl, h("div", { class: "mailcode-actions" }, copyBtn, status)),
  );

  function close() {
    State.pendingMailCode = null;
    actions.setView(State.defaultView());
  }

  copyBtn.addEventListener("click", () => {
    const code = State.pendingMailCode?.code ?? "";
    void navigator.clipboard.writeText(code).then(
      () => {
        status.textContent = t("Copiado");
        window.setTimeout(close, 900);
      },
      () => {
        status.textContent = t("No se pudo copiar");
      },
    );
  });

  // Keyed on the code: two different codes are always a fresh arrival, the
  // same code arriving twice is rare enough not to special-case.
  let shownCode = "";

  return {
    el,
    sync() {
      const pending = State.pendingMailCode;
      if (!pending) return;
      if (shownCode !== pending.code) {
        shownCode = pending.code;
        status.textContent = "";
      }
      codeEl.textContent = codeForDisplay(pending.code);
      subjectEl.textContent = pending.subject;
    },
  };
}
