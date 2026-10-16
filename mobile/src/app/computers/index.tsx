// Your computers: what their agents are doing, and the permission waiting on
// one of them, with Allow / Deny. A tap on a computer opens its own page. Through
// your own sync server (sync/), end to end encrypted.

import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useApp } from "../../app-context";
import { Approval } from "../../components/Approval";
import { Mochi } from "../../components/Mochi";
import { Button, Card, Chip, Dot, EmptyState, haptic, Overline, Screen } from "../../components/ui";
import { deriveKeys, fetchSharedSettings, isServerUrl, normalizeServer, parsePairing, type Computer, type Phone } from "../../logic/link";
import { ago, isOnline } from "../../logic/presence";
import { usePcs } from "../../pcs";
import { setSecret, SYNC_CODE } from "../../store";
import { colors, radius, space, type } from "../../theme";

const fetcher = (url: string, init?: Record<string, unknown>) => fetch(url, init as RequestInit);

// ── Pairing ────────────────────────────────────────────────────────────────────

function Pair({ onPaired }: { onPaired: () => void }) {
  const { t, settings, update } = useApp();
  const [server, setServer] = useState(settings.syncUrl);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const connect = async (typed = server, codeText = code) => {
    const keys = deriveKeys(codeText);
    if (!keys) return setError(t("El código debe tener 64 caracteres (0-9, a-f), con o sin guiones."));
    // A host without "https://", a trailing slash: fixed for you.
    const serverText = normalizeServer(typed);
    if (!serverText) return setError(t("Escribe la dirección de tu servidor: la que imprime wrangler deploy, como https://coucou-sync.<tu-cuenta>.workers.dev."));
    if (!isServerUrl(serverText)) return setError(t("La dirección del servidor debe empezar por https://"));
    if (serverText !== typed.trim()) setServer(serverText);
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
      haptic.success();
      onPaired();
    } catch (err) {
      haptic.warning();
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
      <Card>
        <Text style={type.title}>{t("Apunta al QR de tu PC")}</Text>
        <View style={styles.cameraFrame}>
          <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={onScanned} />
          <View pointerEvents="none" style={styles.viewfinder} />
        </View>
        <Button label={t("Cancelar")} onPress={() => setScanning(false)} />
        {error ? <Text style={styles.err}>{error}</Text> : null}
      </Card>
    );
  }

  return (
    <>
      <View style={styles.hero}>
        <Mochi size={110} mood="happy" />
        <Text style={type.largeTitle}>{t("Conecta tus PCs")}</Text>
        <Text style={[type.caption, { textAlign: "center", maxWidth: 320 }]}>
          {t("Mira qué hacen tus agentes y permite o deniega sus comandos desde aquí. Todo va cifrado: tu servidor no puede leerlo.")}
        </Text>
      </View>

      {Platform.OS !== "web" ? (
        <Button
          variant="primary"
          icon="qr-code-outline"
          label={t("Escanear el QR de mi PC")}
          onPress={async () => {
            if (!permission?.granted && !(await requestPermission()).granted) {
              return setError(t("Sin permiso de cámara no se puede leer el QR. Puedes escribir el código a mano."));
            }
            setError("");
            setScanning(true);
          }}
        />
      ) : null}
      <Text style={[type.caption, { textAlign: "center" }]}>{t("En Coucou de tu PC: Ajustes → Sincronización → Mostrar código.")}</Text>

      {manual || Platform.OS === "web" ? (
        <Card>
          <Text style={styles.label}>{t("Servidor")}</Text>
          <TextInput style={styles.input} value={server} onChangeText={setServer} placeholder="https://coucou-sync.….workers.dev"
            placeholderTextColor={colors.dim} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          <Text style={styles.label}>{t("Código")}</Text>
          <TextInput style={styles.input} value={code} onChangeText={setCode} placeholder="xxxxxxxx-xxxxxxxx-…"
            placeholderTextColor={colors.dim} autoCapitalize="none" autoCorrect={false} secureTextEntry />
          <Button variant="secondary" label={t("Conectar")} loading={busy} onPress={() => void connect()} />
        </Card>
      ) : (
        <Button variant="ghost" label={t("Escribir el código a mano")} onPress={() => setManual(true)} />
      )}
      {error ? <Text style={[styles.err, { textAlign: "center" }]}>{error}</Text> : null}
    </>
  );
}

// ── A computer ─────────────────────────────────────────────────────────────────

function ComputerCard({ pc }: { pc: Computer }) {
  const { t } = useApp();
  const { decide, sent } = usePcs();
  const online = isOnline(pc.at);
  return (
    <Card tone={pc.approval ? "warn" : undefined}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={pc.name}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
        onPress={() => {
          haptic.tap();
          router.push({ pathname: "/computers/[id]", params: { id: pc.id } });
        }}
      >
        <View style={styles.pcIcon}>
          <Ionicons name="desktop-outline" size={20} color={online ? colors.ink : colors.dim} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={type.title} numberOfLines={1}>{pc.name}</Text>
          <View style={[styles.row, { gap: 6 }]}>
            <Dot color={online ? colors.green : colors.dim} size={7} />
            <Text style={type.caption}>{online ? t("En línea") : `${t("Visto hace")} ${ago(pc.at, t)}`}</Text>
          </View>
        </View>
        {pc.tasks.length > 0 ? <Chip label={`${pc.tasks.length}`} color={colors.accent} icon="flash" /> : null}
        <Ionicons name="chevron-forward" size={18} color={colors.dim} />
      </Pressable>

      {pc.tasks.length === 0 ? (
        <Text style={type.caption}>{t("Ningún agente trabajando.")}</Text>
      ) : (
        <View style={styles.tasks}>
          {pc.tasks.map((task) => (
            <View key={task.id} style={styles.task}>
              <View style={{ paddingTop: 5 }}>
                <Dot color={task.color} size={9} live={online} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={[styles.row, { flexWrap: "wrap", gap: 6 }]}>
                  <Text style={styles.taskName}>{task.name}</Text>
                  {task.project ? <Chip label={task.project} /> : null}
                </View>
                {task.step ? <Text style={type.caption} numberOfLines={2}>{task.step}</Text> : null}
              </View>
            </View>
          ))}
        </View>
      )}

      <Approval pc={pc} decide={decide} sent={sent} />
    </Card>
  );
}

// ── The phones on the account ──────────────────────────────────────────────────

function PhoneRow({ phone, mine }: { phone: Phone; mine: boolean }) {
  const { t } = useApp();
  const online = isOnline(phone.at);
  return (
    <View style={styles.row}>
      <View style={styles.pcIcon}>
        <Ionicons name="phone-portrait-outline" size={20} color={online ? colors.ink : colors.dim} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={type.title} numberOfLines={1}>{phone.name}</Text>
        <View style={[styles.row, { gap: 6 }]}>
          <Dot color={online ? colors.green : colors.dim} size={7} />
          <Text style={type.caption}>{online ? t("En línea") : `${t("Visto hace")} ${ago(phone.at, t)}`}</Text>
        </View>
      </View>
      {mine ? <Chip label={t("Este teléfono")} color={colors.accent} /> : null}
    </View>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function Computers() {
  const { t, settings } = useApp();
  const pcs = usePcs();
  const [refreshing, setRefreshing] = useState(false);

  // Whoever needs you comes first.
  const sorted = useMemo(
    () => [...pcs.computers].sort((a, b) => Number(!!b.approval) - Number(!!a.approval) || b.at - a.at),
    [pcs.computers],
  );
  const waiting = pcs.computers.filter((c) => c.approval).length;
  const working = pcs.computers.reduce((n, c) => n + c.tasks.length, 0);

  const askDisconnect = () => {
    if (Platform.OS === "web") return void pcs.disconnect();
    Alert.alert(t("Desconectar este teléfono"), t("Dejarás de ver tus PCs hasta que vuelvas a enlazarlo con el QR."), [
      { text: t("Cancelar"), style: "cancel" },
      { text: t("Desconectar"), style: "destructive", onPress: () => void pcs.disconnect() },
    ]);
  };

  if (!pcs.loaded) return null;
  if (!pcs.linked) {
    return (
      <Screen>
        <Pair onPaired={pcs.reload} />
      </Screen>
    );
  }

  const summary =
    waiting > 0
      ? waiting === 1 ? t("1 PC te necesita") : `${waiting} ${t("PCs te necesitan")}`
      : working > 0
        ? working === 1 ? t("1 agente trabajando") : `${working} ${t("agentes trabajando")}`
        : t("Todo tranquilo");

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void pcs.refresh().finally(() => setRefreshing(false));
      }}
    >
      <View style={styles.summary}>
        <Mochi size={64} mood={waiting > 0 ? "alert" : "idle"} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type.largeTitle}>{summary}</Text>
          <View style={[styles.row, { gap: 6 }]}>
            <Dot color={pcs.error ? colors.red : colors.green} size={7} live={!pcs.error} />
            <Text style={type.caption}>
              {pcs.error ? t("Sin conexión con tu servidor") : pcs.checked ? `${t("En vivo")} · ${t("actualizado")} ${ago(pcs.checked, t)}` : t("Conectando…")}
            </Text>
          </View>
        </View>
      </View>

      {pcs.error ? (
        <Card tone="warn">
          <Text style={styles.err}>{pcs.error}</Text>
        </Card>
      ) : null}

      {sorted.length === 0 && !pcs.error ? (
        <EmptyState
          icon="desktop-outline"
          title={t("Ningún PC todavía")}
          text={t("Ningún PC ha reportado todavía. Abre Coucou en tu PC con la sincronización activa.")}
        />
      ) : null}

      {sorted.map((pc) => (
        <ComputerCard key={pc.id} pc={pc} />
      ))}

      {pcs.phones.length > 0 ? (
        <>
          <Overline>{t("Teléfonos conectados")}</Overline>
          <Card>
            {pcs.phones.map((p) => (
              <PhoneRow key={p.id} phone={p} mine={p.id === pcs.phoneId} />
            ))}
          </Card>
        </>
      ) : null}

      {Platform.OS !== "web" ? (
        <>
          <Overline>{t("Avisos")}</Overline>
          <Card>
            <View style={styles.row}>
              <Ionicons name={settings.pushOn ? "notifications" : "notifications-outline"} size={20} color={settings.pushOn ? colors.green : colors.dim} />
              <Text style={[type.title, { flex: 1 }]}>{t("Avisos en este teléfono")}</Text>
            </View>
            <Text style={type.caption}>
              {t("Te avisa cuando un PC pide permiso o hace una pregunta, aunque la app esté cerrada. El aviso nunca incluye el comando: solo el nombre del PC.")}
            </Text>
            <Button variant={settings.pushOn ? "danger" : "secondary"} label={settings.pushOn ? t("Desactivar avisos") : t("Activar avisos")} onPress={pcs.togglePush} />
            {pcs.pushNote ? <Text style={styles.err}>{pcs.pushNote}</Text> : null}
          </Card>
        </>
      ) : null}

      <Button variant="ghost" icon="log-out-outline" label={t("Desconectar este teléfono")} onPress={askDisconnect} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  hero: { alignItems: "center", gap: space.sm, paddingTop: space.lg },
  summary: { flexDirection: "row", alignItems: "center", gap: space.md },
  pcIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.inset, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  tasks: { gap: space.md },
  task: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  taskName: { color: colors.ink, fontSize: 15, fontWeight: "600" },
  label: { color: colors.ink2, fontSize: 12 },
  input: { backgroundColor: colors.bg, color: colors.ink, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15 },
  err: { color: colors.red, fontSize: 13, lineHeight: 18 },
  cameraFrame: { width: "100%", aspectRatio: 1, borderRadius: radius.md, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: colors.inset },
  viewfinder: { width: "62%", aspectRatio: 1, borderRadius: radius.md, borderWidth: 2, borderColor: "rgba(255,255,255,0.7)" },
});
