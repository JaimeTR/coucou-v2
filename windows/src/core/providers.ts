// The AIs that can answer the chat, for the switch above the chat box. The full
// setup (keys, models, tests) is Settings → Chat provider.

import type { Settings } from "./state";

export interface ChatProviderInfo {
  id: Settings["chatProvider"];
  /** As shown on the switch. */
  name: string;
  /** Credential Manager entry; null when it works without a key. */
  key: string | null;
  /** The model it will use. */
  model: (s: Settings) => string;
}

export const CHAT_PROVIDERS: readonly ChatProviderInfo[] = [
  { id: "anthropic", name: "Claude", key: "anthropic-api-key", model: (s) => s.model },
  { id: "devmark", name: "DEVMARK AI", key: "devmark-api-key", model: (s) => s.devmarkModel },
  { id: "gemini", name: "Gemini", key: "gemini-api-key", model: (s) => s.geminiModel },
  { id: "groq", name: "Groq", key: "groq-api-key", model: (s) => s.groqModel },
  { id: "openai", name: "OpenAI", key: "openai-api-key", model: (s) => s.openaiModel },
  { id: "openrouter", name: "OpenRouter", key: "openrouter-api-key", model: (s) => s.openrouterModel },
  { id: "local", name: "Modelo local", key: null, model: (s) => s.localModel },
];

/** The provider that comes after `current` among the ones that can answer (a key is saved, or none is needed). */
export function nextProvider(
  current: Settings["chatProvider"],
  usable: ReadonlySet<Settings["chatProvider"]>,
): Settings["chatProvider"] {
  const ids = CHAT_PROVIDERS.map((p) => p.id);
  const at = ids.indexOf(current);
  for (let step = 1; step <= ids.length; step++) {
    const id = ids[(at + step) % ids.length];
    if (usable.has(id)) return id;
  }
  return current;
}

/** "Claude · claude-sonnet-5-5", or just the name when no model is set. */
export function providerLabel(s: Settings): string {
  const p = CHAT_PROVIDERS.find((x) => x.id === s.chatProvider) ?? CHAT_PROVIDERS[0];
  const model = p.model(s);
  return model ? `${p.name} · ${model}` : p.name;
}
