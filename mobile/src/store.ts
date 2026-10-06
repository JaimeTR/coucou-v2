// What the phone remembers: preferences in AsyncStorage, tokens in the system's
// secure storage (Keychain on iPhone, Keystore on Android). On the web preview
// (development only) both fall back to localStorage.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { sanitizeApps, type CustomApp } from "./logic/custom";
import type { Language } from "./logic/translate";

export interface Settings {
  name: string;
  language: Language;
  apps: CustomApp[];
}

export const DEFAULT_SETTINGS: Settings = { name: "", language: "auto", apps: [] };

const SETTINGS_KEY = "coucou.settings";

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const saved = JSON.parse(raw) as Partial<Settings>;
    return {
      name: String(saved.name ?? "").slice(0, 40),
      language: saved.language === "es" || saved.language === "en" ? saved.language : "auto",
      apps: sanitizeApps(saved.apps),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, apps: sanitizeApps(settings.apps) }));
}

// ── Secrets ───────────────────────────────────────────────────────────────────

export const GITHUB_TOKEN = "github-token";
export const appTokenKey = (id: string) => `custom-${id.replace(/^custom_/, "")}-token`;

const onWeb = Platform.OS === "web";

export async function getSecret(key: string): Promise<string | null> {
  try {
    if (onWeb) return globalThis.localStorage?.getItem(`coucou.secret.${key}`) ?? null;
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (onWeb) return void globalThis.localStorage?.setItem(`coucou.secret.${key}`, value);
  await SecureStore.setItemAsync(key, value);
}

export async function clearSecret(key: string): Promise<void> {
  try {
    if (onWeb) return void globalThis.localStorage?.removeItem(`coucou.secret.${key}`);
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* nothing was saved */
  }
}
