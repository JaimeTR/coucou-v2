// The WhatsApp card shown in the island — a DOM port of the Mac's WhatsAppCardView.
//
// One row per conversation (initials, name, last message, unread count). Click a row to open
// its last ten messages and a reply field. Enter sends; Shift+Enter new line; Esc goes back.
// Nothing is sent without the user's own Enter or click.

import { h, svg, clear, dot } from "./dom";
import { ICONS } from "./icons";
import { Bridge } from "../core/bridge";
import { State } from "../core/state";
import {
  WHATSAPP_GREEN,
  type WhatsAppConversation,
  type WhatsAppIslandView,
} from "../core/whatsapp";
import { language, t, tl } from "../core/translate";
import { onEvent } from "../core/bridge";

export interface WhatsAppCardHost {
  openSettings(): void;
  keyboard(on: boolean): void;
  holdOpen(on: boolean): void;
}

export interface WhatsAppCard {
  el: HTMLElement;
  sync(view: WhatsAppIslandView): void;
}

function avatar(name: string, _isGroup: boolean, size = 16): HTMLElement {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2) || "#";
  const el = h("span", { class: "wa-avatar", style: `width:${size}px;height:${size}px;font-size:${size * 0.42}px` });
  el.textContent = letters;
  return el;
}

function bubble(m: { fromMe: boolean; senderName?: string; text?: string; media?: string }): HTMLElement {
  const box = h("div", { class: `wa-bubble${m.fromMe ? " mine" : ""}` });
  if (!m.fromMe && m.senderName) box.append(h("div", { class: "wa-sender", text: m.senderName }));
  if (m.media) box.append(h("div", { class: "wa-media", text: t(m.media) }));
  if (m.text) box.append(h("div", { class: "wa-text", text: m.text }));
  return h("div", { class: `${m.fromMe ? "wa-line mine" : "wa-line"}` }, box);
}

  let openChat: string | null = null;
  let listKey = "";

  function row(c: WhatsAppConversation): HTMLElement {
    const r = h("div", { class: "int-row wa-row" });
    r.append(avatar(c.name, false));
    r.append(h("b", { text: c.name }));
    if (c.unread > 0) r.append(h("span", { class: "wa-count", text: c.unread > 99 ? "99+" : String(c.unread) }));
    r.append(h("span", { class: "int-sub wa-preview", text: t("No hay mensajes nuevos") }));
    r.addEventListener("click", () => open(c.id));
    return r;
  }

  function open(id: string) {
    openChat = id;
    sync();
  }

  function close() {
    openChat = null;
    field.value = "";
    sync();
  }

  function syncSendButton() {
    sendBtn.disabled = field.value.trim().length === 0;
  }

  field.addEventListener("input", () => {
    syncSendButton();
    host.holdOpen(field.value.length > 0);
  });

  field.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = field.value.trim();
      if (text && openChat) {
        void Bridge.whatsappSend(openChat, text);
        field.value = "";
        syncSendButton();
        host.holdOpen(false);
      }
    }
  });

  sendBtn.addEventListener("click", () => {
    const text = field.value.trim();
    if (text && openChat) {
      void Bridge.whatsappSend(openChat, text);
      field.value = "";
      syncSendButton();
      host.holdOpen(false);
    }
  });

  back.addEventListener("click", close);

  function syncList(view: WhatsAppIslandView) {
    unreadTag.textContent = view.unread > 0 ? t("{0} no leídos", { 0: view.unread }) : "";
    unreadTag.style.display = view.unread > 0 ? "" : "none";
    clear(listBody);
    if (view.link.state === "off") {
      listBody.append(
        h("div", { class: "int-status" }, dot("#8C8C8C", 5), h("span", { class: "wa-status-text", text: t("Desactivado") })),
        h("div", { class: "int-actions" }, h("button", {
          class: "link-btn wa-settings", text: t("Ajustes…"), onclick: () => host.openSettings(),
        })),
      );
    } else if (view.conversations.length === 0) {
      listBody.append(h("div", { class: "wa-empty", text: t("No hay mensajes nuevos") }));
    } else {
      listBody.append(h("div", { class: "int-rows wa-rows" }, ...view.conversations.map(row)));
    }
  }

  function syncConversation(view: WhatsAppIslandView) {
    const c = view.conversations.find((x) => x.id === openChat);
    if (!c) { close(); return; }
    convoAvatar.append(avatar(c.name, false));
    convoName.textContent = c.name;
    clear(messages);
    messages.append(h("div", { class: "wa-line wa-system", text: t("Esperando mensajes…") }));
    field.placeholder = t("Responder…  (Shift+Enter: nueva línea)");
    note.textContent = "";
    syncSendButton();
    messages.scrollTop = messages.scrollHeight;
  }

  function sync(view: WhatsAppIslandView) {
    const key = [language(), view.link.state, view.unread, ...view.conversations.map((c) => `${c.id}|${c.unread}`)].join("~");
    if (key === listKey && openChat === null) return;
    listKey = key;
    listView.style.display = openChat ? "none" : "";
    convoView.style.display = openChat ? "" : "none";
    if (openChat) syncConversation(view);
    else syncList(view);
  }

  onEvent("whatsapp", (view: WhatsAppIslandView) => {
    sync(view);
  });

  return { el, sync };
}
export function buildWhatsAppCard(host: WhatsAppCardHost): WhatsAppCard {
  const unreadTag = h("span", { class: "wa-unread" });
  const head = h("div", { class: "int-head" }, dot(WHATSAPP_GREEN, 7), h("b", { text: "WhatsApp" }), unreadTag);
  const listBody = h("div", {});
  const listView = h("div", { class: "wa-list" }, head, listBody);

  const back = h("button", { class: "int-back wa-back", title: tl("Back") }, svg(ICONS.chevronLeft, 10, { stroke: 2.4 }));
  const convoAvatar = h("span", {});
  const convoName = h("b", { class: "wa-name" });
  const convoHead = h("div", { class: "wa-head" }, back, convoAvatar, convoName);
  const messages = h("div", { class: "wa-messages" });
  const field = h("textarea", { class: "wa-field", rows: "1", spellcheck: "true" }) as HTMLTextAreaElement;
  const sendBtn = h("button", { class: "wa-send", title: tl("Send") }, svg(ICONS.arrowUp, 12, { fill: "#0B0C0E" }));
  const reply = h("div", { class: "wa-reply" }, field, sendBtn);
  const note = h("div", { class: "wa-note" });
  const convoView = h("div", { class: "wa-convo" }, convoHead, messages, reply, note);

  const el = h("div", { class: "int-card wa-card" }, listView, convoView);