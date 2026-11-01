// The link to your computers, shared by every screen: one poll of the sync
// server (while the app is in front), the decisions you send, this phone's
// alerts, and its own entry in the account's device list.

import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as LocalAuthentication from "expo-local-authentication";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, Platform } from "react-native";

import { useApp } from "./app-context";
import { haptic } from "./components/ui";
import { announcePhone, deriveKeys, fetchDevices, forgetPhone, registerPush, sendDecision, type Computer, type Phone } from "./logic/link";
import { getPushToken } from "./push";
import { clearSecret, getSecret, SYNC_CODE } from "./store";

const fetcher = (url: string, init?: Record<string, unknown>) => fetch(url, init as RequestInit);
const EVERY_MS = 3000;
/** This phone shows up in the account's list this often while the app is open. */
const ANNOUNCE_EVERY_MS = 30_000;

interface Ctx {
  /** The saved code has been read (so "not linked" is real, not "still loading"). */
  loaded: boolean;
  linked: boolean;
  computers: Computer[];
  phones: Phone[];
  /** This phone's own id in `phones`. */
  phoneId: string;
  error: string;
  /** When the server last answered (ms). */
  checked: number | null;
  refresh(): Promise<void>;
  /** A code was saved by the pairing screen. */
  reload(): void;
  sent: string | null;
  decide(pc: Computer, d: "allow" | "deny"): Promise<void>;
  pushNote: string;
  togglePush(): Promise<void>;
  disconnect(): Promise<void>;
}

const PcsCtx = createContext<Ctx | null>(null);

export function usePcs(): Ctx {
  const ctx = useContext(PcsCtx);
  if (!ctx) throw new Error("usePcs outside PcsProvider");
  return ctx;
}

const randomId = () => `phone-${Crypto.getRandomBytes(4).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`;

export function PcsProvider({ children }: { children: ReactNode }) {
  const { t, settings, update, ready } = useApp();
  const [code, setCode] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [computers, setComputers] = useState<Computer[]>([]);
  const [phones, setPhones] = useState<Phone[]>([]);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [checked, setChecked] = useState<number | null>(null);
  const [pushNote, setPushNote] = useState("");
  const lastAnnounce = useRef(0);

  const reload = useCallback(() => {
    void getSecret(SYNC_CODE).then((c) => {
      setCode(c);
      setLoaded(true);
    });
  }, []);
  useEffect(reload, [reload]);

  const keys = useMemo(() => (code ? deriveKeys(code) : null), [code]);
  const server = settings.syncUrl;
  const linked = !!keys && !!server;

  // This phone's name for the account, made once.
  const phoneId = settings.phoneId;
  useEffect(() => {
    if (ready && linked && !phoneId) update({ phoneId: randomId() });
  }, [ready, linked, phoneId, update]);

  const phoneName = Device.deviceName || Device.modelName || (Platform.OS === "ios" ? "iPhone" : "Android");

  const poll = useCallback(async () => {
    if (!keys || !server) return;
    try {
      const all = await fetchDevices(fetcher, server, keys);
      setComputers(all.computers);
      setPhones(all.phones);
      setChecked(Date.now());
      setError("");
      if (phoneId && Date.now() - lastAnnounce.current > ANNOUNCE_EVERY_MS) {
        lastAnnounce.current = Date.now();
        void announcePhone(fetcher, server, keys, phoneId, { name: phoneName, platform: Platform.OS }, Crypto.getRandomBytes(12)).catch(() => {
          lastAnnounce.current = 0;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? t(err.message) : String(err));
    }
  }, [keys, server, phoneId, phoneName, t]);

  // Only while the app is in front: a phone suspends the rest anyway.
  useEffect(() => {
    if (!linked) return;
    void poll();
    const id = setInterval(() => AppState.currentState === "active" && void poll(), EVERY_MS);
    const sub = AppState.addEventListener("change", (s) => s === "active" && void poll());
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [linked, poll]);

  /**
   * Allowing runs a command on a computer: confirm it is you first (Face ID,
   * fingerprint or the phone's passcode). Deny never asks. A phone with no lock
   * at all cannot ask, so it goes through; the switch in Settings turns this off.
   */
  const confirmed = useCallback(async (): Promise<boolean> => {
    if (!settings.requireAuth || Platform.OS === "web") return true;
    try {
      if ((await LocalAuthentication.getEnrolledLevelAsync()) === LocalAuthentication.SecurityLevel.NONE) return true;
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: t("Confirma que eres tú para permitir este comando") });
      return result.success;
    } catch {
      return false;
    }
  }, [settings.requireAuth, t]);

  const decide = useCallback(
    async (pc: Computer, d: "allow" | "deny") => {
      if (!keys || !pc.approval) return;
      if (d === "allow" && !(await confirmed())) return setError(t("No se confirmó tu identidad: no se envió nada."));
      try {
        await sendDecision(fetcher, server, keys, pc.id, pc.approval.requestId, d, Crypto.getRandomBytes(12));
        setSent(pc.approval.requestId);
        setError("");
        if (d === "allow") haptic.success();
        else haptic.warning();
      } catch (err) {
        setError(err instanceof Error ? t(err.message) : String(err));
      }
    },
    [keys, server, confirmed, t],
  );

  // Pings when a PC needs you, even with the app closed.
  const togglePush = useCallback(async () => {
    if (!keys || !server) return;
    setPushNote("");
    try {
      const phone = settings.phoneId || randomId();
      if (settings.pushOn) {
        await registerPush(fetcher, server, keys, phone, null);
        update({ pushOn: false, phoneId: phone });
        return;
      }
      const result = await getPushToken();
      if (!result.ok) return setPushNote(t(result.why));
      await registerPush(fetcher, server, keys, phone, result.token);
      update({ pushOn: true, phoneId: phone });
    } catch (err) {
      setPushNote(err instanceof Error ? t(err.message) : String(err));
    }
  }, [keys, server, settings.phoneId, settings.pushOn, update, t]);

  const disconnect = useCallback(async () => {
    if (keys && server && phoneId) await forgetPhone(fetcher, server, keys, phoneId).catch(() => {});
    await clearSecret(SYNC_CODE);
    update({ syncUrl: "" });
    setCode(null);
    setComputers([]);
    setPhones([]);
    setChecked(null);
    lastAnnounce.current = 0;
  }, [keys, server, phoneId, update]);

  const value: Ctx = {
    loaded,
    linked,
    computers,
    phones,
    phoneId,
    error,
    checked,
    refresh: poll,
    reload,
    sent,
    decide,
    pushNote,
    togglePush,
    disconnect,
  };
  return <PcsCtx.Provider value={value}>{children}</PcsCtx.Provider>;
}
