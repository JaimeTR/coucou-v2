// Mochi's voice: the system's own text-to-speech (the voices Windows ships,
// through the browser engine's speech synthesis). Nothing leaves the PC and no
// key is needed. It speaks in the interface language, with the best voice found.

import { Bridge } from "./bridge";
import { State } from "./state";
import { uiLanguage } from "./i18n";
import { pickVoice, speakable } from "./voiceText";

export { speakable };

const synth: SpeechSynthesis | null = typeof speechSynthesis === "undefined" ? null : speechSynthesis;

export function voiceAvailable(): boolean {
  return synth != null;
}

let speaking = false;

export function stopSpeaking() {
  synth?.cancel();
  stopPlayer();
  speaking = false;
}

export function isSpeaking(): boolean {
  return speaking;
}

let player: HTMLAudioElement | null = null;

function stopPlayer() {
  if (player) {
    player.pause();
    player = null;
  }
}

/** Says `text` with the voices Windows has. */
function speakSystem(said: string, onEnd?: () => void): boolean {
  if (!synth) return false;
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

/** Says `said` with ElevenLabs; if that fails, with the system voice, so Mochi is never mute. */
function speakEleven(said: string, onEnd?: () => void): boolean {
  speaking = true;
  void Bridge.voiceSpeak(said).then(
    (mp3) => {
      if (!speaking) return; // stopped while it was being made
      stopPlayer();
      // The page's security policy allows blob: media, not data: ones.
      const bytes = Uint8Array.from(atob(mp3), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
      player = new Audio(url);
      player.onended = player.onerror = () => {
        URL.revokeObjectURL(url);
        speaking = false;
        player = null;
        onEnd?.();
      };
      void player.play().catch(() => {
        speaking = false;
        onEnd?.();
      });
    },
    (err) => {
      console.error("[coucou] ElevenLabs", err);
      speaking = false;
      speakSystem(said, onEnd);
    },
  );
  return true;
}

/** Says `text` aloud, replacing whatever was being said. Returns false when it cannot. */
export function speak(text: string, onEnd?: () => void): boolean {
  const said = speakable(text);
  if (!said) return false;
  stopSpeaking();
  return State.settings.voiceEngine === "elevenlabs" ? speakEleven(said, onEnd) : speakSystem(said, onEnd);
}
