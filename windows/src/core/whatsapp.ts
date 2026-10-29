// WhatsApp core — types and Bridge calls for the WhatsApp integration.
// Spanish is the source language; English is looked up in core/translate.ts.

export type WhatsAppLinkState =
  | "off"
  | "badUrl"
  | "connecting"
  | "needsQr"
  | "connected"
  | "unreachable"
  | "unauthorized"
  | { failed: { detail: string } };

export type WhatsAppWebhookState =
  | "off"
  | "listening"
  | "registered"
  | { refused: { detail: string } }
  | { portBusy: { port: number } };

export type WhatsAppSendError =
  | "tooLong"
  | "tooFast"
  | "unreachable"
  | "unauthorized"
  | "needsQr"
  | { refused: { detail: string } };

export type WhatsAppTestResult =
  | { connected: { who: string } }
  | { failed: { detail: string } };

export type WhatsAppConversation = {
  id: string;
  name: string;
  unread: number;
  lastActivity: number;
};

export type WhatsAppInstallStep =
  | "idle"
  | "checking"
  | { downloading: { megabytes: number } }
  | "verifying"
  | "installing"
  | { done: { version: string } }
  | { failed: { reason: string } };

export type WhatsAppLinkView = { state: WhatsAppLinkState };
export type WhatsAppWebhookView = { state: WhatsAppWebhookState };
export type WhatsAppIslandView = {
  link: WhatsAppLinkView;
  webhook: WhatsAppWebhookView;
  conversations: WhatsAppConversation[];
  unread: number;
};
export type WhatsAppSettingsView = {
  webhook: WhatsAppWebhookView;
  install: { step: WhatsAppInstallStep };
  defaultUrl: string;
};

export const WHATSAPP_ID = "integration_whatsapp";
export const WHATSAPP_GREEN = "#25D366";

/** Parse "33612345678" or "+33 6 12 34 56 78" → "33612345678@s.whatsapp.net"; "120363@g.us" passes through. */
export function chatFromEntry(entry: string): string | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  if (trimmed.includes("@")) {
    const parts = trimmed.split("@");
    if (parts.length === 2 && parts[0] && parts[1]) return trimmed;
    return null;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 7) return `${digits}@s.whatsapp.net`;
  return null;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2) || "#";
}