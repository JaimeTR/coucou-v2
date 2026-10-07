// Your computers: what their agents are doing, and the permission waiting on
// one of them, with Allow / Deny. Through your own sync server (sync/), end to
// end encrypted. It only looks while this screen is open and the app is in front.

import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import * as LocalAuthentication from "expo-local-authentication";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { useApp } from "../app-context";
import { deriveKeys, fetchComputers, fetchSharedSettings, isServerUrl, parsePairing, registerPush, sendDecision, type Computer } from "../logic/link";
import { getPushToken } from "../push";
import { clearSecret, getSecret, setSecret, SYNC_CODE } from "../store";
import { colors } from "../theme";

const fetcher = (url: string, init?: Record<string, unknown>) => fetch(url, init as RequestInit);
const EVERY_MS = 3000;

function ago(at: number, t: (es: string) => string): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return t("ahora");
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3600)} h`;
}

function Pair({ onPaired }: { onPaired: () => void }) {
  const { t, settings, update } = useApp();
  const [server, setServer] = useState(settings.syncUrl);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const connect = async (serverText = server, codeText = code) => {
    const keys = deriveKeys(codeText);
    if (!keys) return setError(t("El código debe tener 64 caracteres (0-9, a-f), con o sin guiones."));
    if (!isServerUrl(serverText)) return setError(t("La dirección del servidor debe empezar por https://"));
    setBusy(true);
    setError("");
    try {
      // Reading the shared settings proves the code and the server are right,
      // and brings your name and language from the PC.
      const shared = await fetchSharedSettings(fetcher, serverText.trim(), keys);
      await setSecret(SYNC_CODE, codeText.trim());
      const patch: Partial<typeof settings> = { syncUrl: serverText.trim() };
      if (typeof shared?.userName === "string" && shared.userName && !settings.name) patch.name = shared.userName.slice(0, 40);
      if (shared?.language === "es" || shared?.language === "en") patch.language = shared.language;
      update(patch);
      onPaired();
    } catch (err) {
      setError(err instanceof Error ? t(err.message) : String(err));
    } finally {
      setBusy(false);
    }
  };

  // The PC's QR carries both the address and the code.
  const onScanned = ({ data }: { data: string }) => {
    const pairing = parsePairing(data);
    if (!pairing) return; // not ours: keep looking, a stray QR must not interrupt
    setScanning(false);
    setServer(pairing.server);
    setCode(pairing.code);
    void connect(pairing.server, pairing.code);
  };

  if (scanning) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{t("Apunta al QR de tu PC")}</Text>
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={onScanned}
        />
        <Pressable style={styles.button} onPress={() => setScanning(false)}>
          <Text style={styles.buttonText}>{t("Cancelar")}</Text>
        </Pressable>
        {error ? <Text style={styles.err}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t("Conecta tus PCs")}</Text>
      {Platform.OS !== "web" ? (
        <Pressable
          style={[styles.button, styles.primary]}
          onPress={async () => {
            if (!permission?.granted && !(await requestPermission()).granted) {
              return setError(t("Sin permiso de cámara no se puede leer el QR. Puedes escribir el código a mano."));
            }
            setError("");
            setScanning(true);
          }}
        >
          <Text style={[styles.buttonText, { color: colors.bg }]}>{t("Escanear el QR de mi PC")}</Text>
        </Pressable>
      ) : null}
      <Text style={styles.hint}>
        {t("En Coucou de tu PC: Ajustes → Sincronización → Mostrar código. Pega aquí esa dirección y ese código. Todo va cifrado: tu servidor no puede leerlo.")}
      </Text>
      <Text style={styles.label}>{t("Servidor")}</Text>
      <TextInput style={styles.input} value={server} onChangeText={setServer} placeholder="https://coucou-sync.….workers.dev"
        placeholderTextColor={colors.dim} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      <Text style={styles.label}>{t("Código")}</Text>
      <TextInput style={styles.input} value={code} onChangeText={setCode} placeholder="xxxxxxxx-xxxxxxxx-…"
        placeholderTextColor={colors.dim} autoCapitalize="none" autoCorrect={false} secureTextEntry />
      <Pressable style={[styles.button, styles.primary]} onPress={() => void connect()} disabled={busy}>
        <Text style={[styles.buttonText, { color: colors.bg }]}>{busy ? t("Conectando…") : t("Conectar")}</Text>
      </Pressable>
      {error ? <Text style={styles.err}>{error}</Text> : null}
    </View>
  );
}

function ComputerCard({ pc, decide, sent }: {
  pc: Computer;
  decide: (pc: Computer, d: "allow" | "deny") => void;
  sent: string | null;
}) {
  const { t } = useApp();
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>{pc.name}</Text>
        <Text style={styles.hint}>{ago(pc.at, t)}</Text>
      </View>
      {pc.tasks.length === 0 ? <Text style={styles.hint}>{t("Ningún agente trabajando.")}</Text> : null}
      {pc.tasks.map((task) => (
        <View key={task.id} style={styles.task}>
          <View style={[styles.dot, { backgroundColor: task.color }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.taskName}>
              {task.name}
              {task.project ? <Text style={styles.hint}>{`  ·  ${task.project}`}</Text> : null}
            </Text>
            {task.step ? <Text style={styles.hint} numberOfLines={2}>{task.step}</Text> : null}
          </View>
        </View>
      ))}
      {pc.approval ? (
        <View style={styles.approval}>
          <Text style={styles.label}>{t("Pide permiso")} · {pc.approval.tool}</Text>
          <Text style={styles.command} numberOfLines={6}>{pc.approval.command}</Text>
          {sent === pc.approval.requestId ? (
            <Text style={styles.hint}>{t("Enviado. Esperando a tu PC…")}</Text>
          ) : (
            <View style={styles.buttons}>
              <Pressable style={[styles.button, styles.danger, { flex: 1 }]} onPress={() => decide(pc, "deny")}>
                <Text style={[styles.buttonText, { color: colors.red }]}>{t("Denegar")}</Text>
              </Pressable>
              <Pressable style={[styles.button, styles.primary, { flex: 1 }]} onPress={() => decide(pc, "allow")}>
                <Text style={[styles.buttonText, { color: colors.bg }]}>{t("Permitir")}</Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

export default function Computers() {
  const { t, settings, update } = useApp();
  const [code, setCode] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [computers, setComputers] = useState<Computer[]>([]);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<string | null>(null);

  const loadCode = useCallback(() => {
    void getSecret(SYNC_CODE).then((c) => {
      setCode(c);
      setLoaded(true);
    });
  }, []);
  useEffect(loadCode, [loadCode]);

  const keys = code ? deriveKeys(code) : null;
  const server = settings.syncUrl;

  const poll = useCallback(async () => {
    if (!keys || !server) return;
    try {
      setComputers(await fetchComputers(fetcher, server, keys));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? t(err.message) : String(err));
    }
    // keys is derived from code; code is the real dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, server, t]);

  // Only while the screen is open and the app in front: a phone suspends the rest anyway.
  useFocusEffect(
    useCallback(() => {
      void poll();
      const id = setInterval(() => AppState.currentState === "active" && void poll(), EVERY_MS);
      return () => clearInterval(id);
    }, [poll]),
  );

  /**
   * Allowing runs a command on a computer: confirm it is you first (Face ID,
   * fingerprint or the phone's passcode). Deny never asks. A phone with no lock
   * at all cannot ask, so it goes through; the switch in Settings turns this off.
   */
  const confirmed = async (): Promise<boolean> => {
    if (!settings.requireAuth || Platform.OS === "web") return true;
    try {
      if ((await LocalAuthentication.getEnrolledLevelAsync()) === LocalAuthentication.SecurityLevel.NONE) return true;
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: t("Confirma que eres tú para permitir este comando") });
      return result.success;
    } catch {
      return false;
    }
  };

  const decide = async (pc: Computer, d: "allow" | "deny") => {
    if (!keys || !pc.approval) return;
    if (d === "allow" && !(await confirmed())) return setError(t("No se confirmó tu identidad: no se envió nada."));
    try {
      await sendDecision(fetcher, server, keys, pc.id, pc.approval.requestId, d, Crypto.getRandomBytes(12));
      setSent(pc.approval.requestId);
    } catch (err) {
      setError(err instanceof Error ? t(err.message) : String(err));
    }
  };

  // Pings when a PC needs you, even with the app closed.
  const [pushNote, setPushNote] = useState("");
  const togglePush = async () => {
    if (!keys || !server) return;
    setPushNote("");
    try {
      const phone = settings.phoneId || `phone-${Crypto.getRandomBytes(4).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`;
      if (settings.pushOn) {
        await registerPush(fetcher, server, keys, phone, null);
        update({ pushOn: false, phoneId: phone });
        return;
      }
      const result = await getPushToken();
      if (!result.ok) return setPushNote(result.why);
      await registerPush(fetcher, server, keys, phone, result.token);
      update({ pushOn: true, phoneId: phone });
    } catch (err) {
      setPushNote(err instanceof Error ? t(err.message) : String(err));
    }
  };

  if (!loaded) return null;
  if (!keys || !server) {
    return (
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Pair onPaired={loadCode} />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {computers.length === 0 && !error ? (
        <Text style={styles.hint}>{t("Ningún PC ha reportado todavía. Abre Coucou en tu PC con la sincronización activa.")}</Text>
      ) : null}
      {computers.map((pc) => (
        <ComputerCard key={pc.id} pc={pc} decide={decide} sent={sent} />
      ))}
      {error ? <Text style={styles.err}>{error}</Text> : null}
      {Platform.OS !== "web" ? (
        <View style={styles.card}>
          <Text style={styles.title}>{t("Avisos en este teléfono")}</Text>
          <Text style={styles.hint}>
            {t("Te avisa cuando un PC pide permiso o hace una pregunta, aunque la app esté cerrada. El aviso nunca incluye el comando: solo el nombre del PC.")}
          </Text>
          <Pressable style={[styles.button, settings.pushOn ? styles.danger : styles.primary, { alignSelf: "flex-start" }]} onPress={togglePush}>
            <Text style={[styles.buttonText, { color: settings.pushOn ? colors.red : colors.bg }]}>
              {settings.pushOn ? t("Desactivar avisos") : t("Activar avisos")}
            </Text>
          </Pressable>
          {pushNote ? <Text style={styles.err}>{pushNote}</Text> : null}
        </View>
      ) : null}
      <Pressable
        style={[styles.button, styles.danger, { alignSelf: "flex-start" }]}
        onPress={async () => {
          await clearSecret(SYNC_CODE);
          update({ syncUrl: "" });
          setCode(null);
          setComputers([]);
        }}
      >
        <Text style={[styles.buttonText, { color: colors.red }]}>{t("Desconectar este teléfono")}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 14, paddingBottom: 40 },
  card: { backgroundColor: colors.card, borderRadius: 18, padding: 16, gap: 10, borderWidth: 1, borderColor: colors.line },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: colors.ink, fontSize: 16, fontWeight: "600" },
  hint: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  label: { color: colors.ink2, fontSize: 12 },
  input: { backgroundColor: colors.bg, color: colors.ink, borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  task: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  taskName: { color: colors.ink, fontSize: 14, fontWeight: "500" },
  approval: { gap: 8, padding: 12, borderRadius: 14, backgroundColor: "rgba(245,165,36,0.08)", borderWidth: 1, borderColor: "rgba(245,165,36,0.35)" },
  command: { color: colors.ink, fontFamily: "Courier", fontSize: 13 },
  buttons: { flexDirection: "row", gap: 8 },
  button: { paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center" },
  primary: { backgroundColor: colors.ink, borderColor: colors.ink },
  danger: { borderColor: "rgba(244,80,94,0.4)" },
  buttonText: { color: colors.ink, fontSize: 15, fontWeight: "600" },
  err: { color: colors.red, fontSize: 13 },
  camera: { width: "100%", aspectRatio: 1, borderRadius: 14, overflow: "hidden" },
});
