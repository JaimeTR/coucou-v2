// Mochi's voice: the system's own text-to-speech (the voices Windows ships,
// through the browser engine's speech synthesis). Nothing leaves the PC and no
// key is needed. It speaks in the interface language, with the best voice found.

import { uiLanguage } from "./i18n.js";

const synth: SpeechSynthesis | null = typeof speechSynthesis === "undefined" ? null : speechSynthesis;

export function voiceAvailable(): boolean {
  return synth != null;
}

/** The nicest voice for a language: "Natural"/online ones first, then any local one. */
export function pickVoice(voices: ReadonlyArray<{ lang: string; name: string }>, lang: "es" | "en") {
  const mine = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
  const rank = (v: { name: string }) => (/natural/i.test(v.name) ? 0 : /online/i.test(v.name) ? 1 : 2);
  return [...mine].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** Text as it should be spoken: no markdown, no code blocks, not too long. */
export function speakable(text: string, max = 600): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[*_#>~]+/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > max / 2 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

let speaking = false;

export function stopSpeaking() {
  synth?.cancel();
  speaking = false;
}

export function isSpeaking(): boolean {
  return speaking;
}

/** Says `text` aloud, replacing whatever was being said. Returns false when it cannot. */
export function speak(text: string, onEnd?: () => void): boolean {
  const said = speakable(text);
  if (!synth || !said) return false;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(said);
  const lang = uiLanguage();
  const voice = pickVoice(synth.getVoices(), lang);
  if (voice) utterance.voice = voice as SpeechSynthesisVoice;
  utterance.lang = voice?.lang ?? (lang === "es" ? "es-ES" : "en-US");
  utterance.rate = 1.02;
  utterance.onend = utterance.onerror = () => {
    speaking = false;
    onEnd?.();
  };
  speaking = true;
  synth.speak(utterance);
  return true;
}
