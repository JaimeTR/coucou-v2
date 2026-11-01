// The Mail (Thunderbird) card: an inbox list, a search box, and a reader —
// read-only, local only. All the parsing happens in Rust (src-tauri/src/mail/);
// this file only renders what mail_list/mail_search/mail_read return.

import { h, svg, clear } from "./dom.js";
import { ICONS } from "./icons.js";
import { Bridge, onEvent } from "../core/bridge.js";
import { t } from "../core/i18n.js";
import type { MailMessageInfo } from "../core/mail";

export interface MailCardHost {
  openSettings(): void;
}

export interface MailCard {
  el: HTMLElement;
  sync(): void;
}

/** "14 mar" for a date this year, "14 mar 2019" otherwise. Never throws. */
export function shortDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const thisYear = new Date().getFullYear();
  const base = `${d.getDate()} ${months[d.getMonth()]}`;
  return d.getFullYear() === thisYear ? base : `${base} ${d.getFullYear()}`;
}

/** Collapses whitespace to single spaces and cuts to `max` characters with an ellipsis. */
export function oneLine(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const CODE_TRIGGER_WORDS = ["código", "codigo", "code", "verification", "verifica", "otp", "one-time", "one time", "security code", "clave de acceso"];

/**
 * HTML-escapes `text`, then wraps the first 4-8 digit run that sits within 40
 * characters of a trigger word in `<mark>`. Purely cosmetic — the authoritative
 * detection that decides whether to raise the code card lives in Rust
 * (`src-tauri/src/mail/otp.rs`); this is the same rule re-applied client-side
 * so the reader can highlight the match inline, nothing more.
 */
export function highlightCode(text: string): string {
  const escaped = escapeHtml(text);
  const lower = escaped.toLowerCase();
  const digitRun = /\d[\d\s-]{2,9}\d|\d{3,7}/g;
  let match: RegExpExecArray | null;
  while ((match = digitRun.exec(escaped))) {
    const digits = match[0].replace(/[\s-]/g, "");
    if (digits.length < 4 || digits.length > 8) continue;
    const windowStart = Math.max(0, match.index - 40);
    const windowEnd = Math.min(lower.length, match.index + match[0].length + 40);
    const window = lower.slice(windowStart, windowEnd);
    if (CODE_TRIGGER_WORDS.some((w) => window.includes(w))) {
      return escaped.slice(0, match.index) + `<mark>${digits}</mark>` + escaped.slice(match.index + match[0].length);
    }
  }
  return escaped;
}

export function buildMailCard(host: MailCardHost): MailCard {
  let openMessage: MailMessageInfo | null = null;
  let query = "";

  const searchField = h("input", { class: "mail-search", type: "search", placeholder: t("Buscar correo…"), spellcheck: "false" }) as HTMLInputElement;
  const listBody = h("div", { class: "int-rows mail-rows" });
  const listView = h("div", { class: "mail-list" }, searchField, listBody);

  const back = h("button", { class: "int-back mail-back", title: t("Back") }, svg(ICONS.chevronLeft, 10, { stroke: 2.4 }));
  const readerSubject = h("b", { class: "mail-subject" });
  const readerFrom = h("span", { class: "mail-from" });
  const readerHead = h("div", { class: "mail-head" }, back, h("div", {}, readerSubject, readerFrom));
  const readerBody = h("div", { class: "mail-body" });
  const readerView = h("div", { class: "mail-reader" }, readerHead, readerBody);

  const el = h("div", { class: "int-card mail-card" }, listView, readerView);

  function close() {
    openMessage = null;
    render();
  }
  back.addEventListener("click", close);

  async function openAt(m: MailMessageInfo) {
    openMessage = m;
    readerSubject.textContent = m.subject || t("(sin asunto)");
    readerFrom.textContent = m.from;
    clear(readerBody);
    readerBody.append(h("div", { class: "mail-loading", text: t("Cargando…") }));
    render();
    try {
      const body = await Bridge.mailRead(m.account, m.folder, m.offset, m.len);
      clear(readerBody);
      const textEl = h("div", { class: "mail-text" });
      // highlightCode HTML-escapes the body itself before wrapping any match in
      // <mark> — innerHTML here is safe because nothing but that function's own
      // escaping ever reaches it (never set from unescaped user/mail content).
      textEl.innerHTML = highlightCode(body ?? "");
      readerBody.append(textEl);
    } catch (err) {
      clear(readerBody);
      readerBody.append(h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }));
    }
  }

  function row(m: MailMessageInfo): HTMLElement {
    const r = h(
      "div",
      { class: "int-row mail-row", onclick: () => void openAt(m) },
      h("div", { class: "mail-row-top" }, h("b", { text: m.from || t("(desconocido)") }), h("span", { class: "mail-date", text: shortDate(m.dateRfc3339) })),
      h("div", { class: "int-sub mail-row-subject", text: oneLine(m.subject || t("(sin asunto)"), 70) }),
    );
    return r;
  }

  async function reload() {
    clear(listBody);
    try {
      if (query.trim()) {
        const messages = (await Bridge.mailSearch(query.trim())) ?? [];
        showMessages(messages, t("No hay resultados"));
        return;
      }
      const accounts = (await Bridge.mailAccounts()) ?? [];
      if (accounts.length === 0) {
        listBody.append(
          h("div", { class: "int-status" }, h("span", { class: "mail-status-text", text: t("Sin cuentas configuradas") })),
          h("div", { class: "int-actions" }, h("button", { class: "link-btn mail-settings", text: t("Ajustes…"), onclick: () => host.openSettings() })),
        );
        return;
      }
      const all: MailMessageInfo[] = [];
      for (const a of accounts) {
        for (const f of a.folders) all.push(...((await Bridge.mailList(a.id, f)) ?? []));
      }
      showMessages(all.sort((x, y) => y.dateRfc3339.localeCompare(x.dateRfc3339)), t("No hay correo"));
    } catch (err) {
      listBody.append(h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }));
    }
  }

  function showMessages(messages: MailMessageInfo[], emptyText: string) {
    if (messages.length === 0) {
      listBody.append(h("div", { class: "mail-empty", text: emptyText }));
    } else {
      for (const m of messages) listBody.append(row(m));
    }
  }

  let searchDebounce: number | null = null;
  searchField.addEventListener("input", () => {
    query = searchField.value;
    if (searchDebounce != null) window.clearTimeout(searchDebounce);
    searchDebounce = window.setTimeout(() => void reload(), 250);
  });

  function render() {
    listView.style.display = openMessage ? "none" : "";
    readerView.style.display = openMessage ? "" : "none";
  }
  render();

  onEvent("mail", () => void reload());
  void reload();

  return { el, sync: render };
}
