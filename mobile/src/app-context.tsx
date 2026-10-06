// The app's shared state: settings, the language, and the live readings (GitHub
// and your own apps), refreshed while the app is open. A phone suspends apps in
// the background, so nothing runs there: the readings catch up when you return.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, Platform } from "react-native";

import { readOnce, type CustomApp } from "./logic/custom";
import { fetchPulse, type Pulse } from "./logic/github";
import { resolveLanguage, toEnglish, type Language } from "./logic/translate";
import { appTokenKey, DEFAULT_SETTINGS, getSecret, GITHUB_TOKEN, loadSettings, saveSettings, type Settings } from "./store";

export interface Reading {
  value?: string;
  error?: string;
  at?: number;
}

interface Ctx {
  ready: boolean;
  settings: Settings;
  update(patch: Partial<Settings>): void;
  lang: "es" | "en";
  /** The Spanish source string, in the chosen language. */
  t(es: string): string;
  hasGithub: boolean;
  pulse: Pulse | null;
  pulseError: string | null;
  readings: Record<string, Reading>;
  /** Looks again now (GitHub and every app). */
  refresh(): Promise<void>;
  /** The token was saved or removed in Settings. */
  tokenChanged(): void;
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp outside AppProvider");
  return ctx;
}

const fetcher = (url: string, init?: Record<string, unknown>) => fetch(url, init as RequestInit);

const systemLanguage = () =>
  (Platform.OS === "web" ? globalThis.navigator?.language : Intl.DateTimeFormat().resolvedOptions().locale) ?? "en";

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [hasGithub, setHasGithub] = useState(false);
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [pulseError, setPulseError] = useState<string | null>(null);
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  const [tokenVersion, setTokenVersion] = useState(0);

  useEffect(() => {
    void loadSettings().then((s) => {
      setSettings(s);
      setReady(true);
    });
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void saveSettings(next);
      return next;
    });
  }, []);

  const lang = resolveLanguage(settings.language as Language, systemLanguage());
  const t = useCallback((es: string) => (lang === "en" ? toEnglish(es) : es), [lang]);

  // ── GitHub ──────────────────────────────────────────────────────────────────
  const pollGithub = useCallback(async () => {
    const token = await getSecret(GITHUB_TOKEN);
    setHasGithub(!!token);
    if (!token) {
      setPulse(null);
      setPulseError(null);
      return;
    }
    try {
      setPulse(await fetchPulse(token, fetcher));
      setPulseError(null);
    } catch (err) {
      setPulseError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // ── Your own apps ───────────────────────────────────────────────────────────
  const pollApp = useCallback(async (app: CustomApp) => {
    try {
      const value = await readOnce(app, await getSecret(appTokenKey(app.id)), fetcher);
      setReadings((r) => ({ ...r, [app.id]: { value, at: Date.now() } }));
    } catch (err) {
      setReadings((r) => ({ ...r, [app.id]: { error: err instanceof Error ? err.message : String(err), at: Date.now() } }));
    }
  }, []);

  const appsKey = JSON.stringify(settings.apps);
  const appsRef = useRef(settings.apps);
  appsRef.current = settings.apps;

  const refresh = useCallback(async () => {
    await Promise.all([pollGithub(), ...appsRef.current.map(pollApp)]);
  }, [pollGithub, pollApp]);

  useEffect(() => {
    if (!ready) return;
    void pollGithub();
    const id = setInterval(() => AppState.currentState === "active" && void pollGithub(), 300_000);
    return () => clearInterval(id);
  }, [ready, tokenVersion, pollGithub]);

  useEffect(() => {
    if (!ready) return;
    const timers = appsRef.current.map((app) => {
      void pollApp(app);
      return setInterval(() => AppState.currentState === "active" && void pollApp(app), app.every * 1000);
    });
    return () => timers.forEach(clearInterval);
    // appsKey changes when an app is added, removed or edited
  }, [ready, appsKey, pollApp]);

  // Back from the background: catch up at once.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "active" && ready && void refresh());
    return () => sub.remove();
  }, [ready, refresh]);

  const value = useMemo<Ctx>(
    () => ({
      ready,
      settings,
      update,
      lang,
      t,
      hasGithub,
      pulse,
      pulseError,
      readings,
      refresh,
      tokenChanged: () => setTokenVersion((v) => v + 1),
    }),
    [ready, settings, update, lang, t, hasGithub, pulse, pulseError, readings, refresh],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
