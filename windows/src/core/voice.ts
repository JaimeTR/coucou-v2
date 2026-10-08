// Mochi's voice: the system's own text-to-speech (the voices Windows ships,
// through the browser engine's speech synthesis). Nothing leaves the PC and no
// key is needed. It speaks in the interface language, with the best voice found.

import { Bridge } from "./bridge";
import { State } from "./state";
import { voiceAllowed } from "./modes";
import { t, uiLanguage } from "./i18n";
import { emotionLine, pickVoice, speakable, type Emotion } from "./voiceText";

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

/** A phrase longer than this never goes to ElevenLabs: it is charged per character. */
const SHORT = 240;

/** What ElevenLabs already said this session, so a repeated phrase costs nothing. */
const spoken = new Map<string, string>();

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
  const cached = spoken.get(said);
  void (cached ? Promise.resolve(cached) : Bridge.voiceSpeak(said).then((mp3) => (spoken.set(said, mp3), mp3))).then(
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
export function speak(text: string, onEnd?: () => void, opts: { free?: boolean } = {}): boolean {
  const said = speakable(text, opts.free ? 600 : SHORT);
  if (!said) return false;
  stopSpeaking();
  // ElevenLabs is for Mochi's own short phrases (the welcome, "Abriendo Claude
  // Code"); anything long goes to the free system voice.
  const premium = State.settings.voiceEngine === "elevenlabs" && !opts.free;
  return premium ? speakEleven(said, onEnd) : speakSystem(said, onEnd);
}

export type Occasion = "greeting" | "events" | "replies" | "assistant" | "pet";

/**
 * Speech Mochi starts by itself. Nothing is said unless voice is switched on, and
 * then only for the kinds that were chosen. Returns whether it is speaking.
 */
export function speakAuto(occasion: Occasion, text: string, onEnd?: () => void): boolean {
  const s = State.settings;
  if (!s.voiceEnabled) return false;
  // Not in a meeting or over a video; in a game only the pet's cheering.
  if (!voiceAllowed(State.workMode, occasion, s.petGameCheer)) return false;
  if (occasion === "greeting" && !s.voiceGreeting) return false;
  if (occasion === "events" && !s.voiceEvents) return false;
  if (occasion === "replies" && !s.voiceReplies) return false;
  if (occasion === "pet" && !s.voicePet) return false;
  return speak(text, onEnd);
}

let lastEmotion = 0;

/**
 * A mood said aloud (slapped, dizzy, loved), when its switch is on. Never
 * talks over something else, and at most once every 3 s so a burst of clicks
 * is one phrase, not a stammer.
 */
export function speakEmotion(kind: Emotion) {
  const s = State.settings;
  if (!s.voiceEnabled || !s.voiceEmotions || speaking) return;
  const now = performance.now();
  if (now - lastEmotion < 3000) return;
  lastEmotion = now;
  speak(t(emotionLine(kind)));
}
