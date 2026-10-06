import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { useApp } from "../app-context";
import { CUSTOM_LIMIT, readOnce, type CustomApp } from "../logic/custom";
import type { Language } from "../logic/translate";
import { appTokenKey, clearSecret, getSecret, GITHUB_TOKEN, setSecret } from "../store";
import { colors } from "../theme";

const random = (n: number, alphabet: string) =>
  Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");

function Button({ label, onPress, danger, primary }: { label: string; onPress: () => void; danger?: boolean; primary?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.button, primary && styles.primary, danger && styles.danger]}>
      <Text style={[styles.buttonText, primary && { color: colors.bg }, danger && { color: colors.red }]}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, value, onChange, placeholder, secure, keyboard }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secure?: boolean;
  keyboard?: "default" | "url" | "numeric";
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.dim}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboard ?? "default"}
      />
    </View>
  );
}

function GithubSection() {
  const { t, hasGithub, tokenChanged } = useApp();
  const [token, setToken] = useState("");
  const [note, setNote] = useState("");

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t("Token de GitHub")}</Text>
      <Text style={styles.hint}>{t("Pega aquí tu token de GitHub (acceso de lectura a pull requests). Se guarda cifrado en este teléfono y solo se envía a GitHub.")}</Text>
      <Text style={styles.hint}>{hasGithub ? t("Hay un token guardado.") : t("Aún no hay token.")}</Text>
      <Field label={t("Token")} value={token} onChange={setToken} secure placeholder="ghp_…" />
      <View style={styles.buttons}>
        <Button
          primary
          label={t("Guardar")}
          onPress={async () => {
            if (!token.trim()) return;
            await setSecret(GITHUB_TOKEN, token.trim());
            setToken("");
            setNote("Guardado.");
            tokenChanged();
          }}
        />
        {hasGithub && (
          <Button
            danger
            label={t("Quitar")}
            onPress={async () => {
              await clearSecret(GITHUB_TOKEN);
              setNote("Quitado.");
              tokenChanged();
            }}
          />
        )}
      </View>
      <Pressable onPress={() => void Linking.openURL("https://github.com/settings/tokens/new?description=Coucou&scopes=repo")}>
        <Text style={styles.link}>{t("Crear un token en GitHub")}</Text>
      </Pressable>
      {note ? <Text style={styles.ok}>{t(note)}</Text> : null}
    </View>
  );
}

function AppEditor({ app, onChange, onRemove }: { app: CustomApp; onChange: (a: CustomApp) => void; onRemove: () => void }) {
  const { t } = useApp();
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void getSecret(appTokenKey(app.id)).then((v) => setHasToken(!!v));
  }, [app.id]);

  return (
    <View style={styles.card}>
      <Field label={t("Nombre")} value={app.name} onChange={(v) => onChange({ ...app, name: v.slice(0, 24) })} />
      <Field label={t("Dirección")} value={app.url} onChange={(v) => onChange({ ...app, url: v })} placeholder="https://…" keyboard="url" />
      <Field label={t("Valor a mostrar (ruta con puntos)")} value={app.path} onChange={(v) => onChange({ ...app, path: v })} placeholder="data.open_issues" />
      <Field
        label={t("Cada (segundos)")}
        value={String(app.every)}
        onChange={(v) => onChange({ ...app, every: Number(v.replace(/\D/g, "")) || 30 })}
        keyboard="numeric"
      />
      <Field
        label={`${t("Token")} ${hasToken ? "✓" : ""}`}
        value={token}
        onChange={setToken}
        secure
        placeholder={hasToken ? "••••••••" : t("Token")}
      />
      <Field label={t("Cabecera del token")} value={app.authHeader} onChange={(v) => onChange({ ...app, authHeader: v })} placeholder="Authorization" />
      <Field label={t("Al tocar la tarjeta, abrir")} value={app.openUrl} onChange={(v) => onChange({ ...app, openUrl: v })} placeholder="https://…" keyboard="url" />
      <View style={styles.buttons}>
        <Button
          label={t("Guardar")}
          onPress={async () => {
            if (!token.trim()) return;
            await setSecret(appTokenKey(app.id), token.trim());
            setToken("");
            setHasToken(true);
            setNote({ ok: true, text: "Guardado." });
          }}
        />
        <Button
          label={t("Probar ahora")}
          onPress={async () => {
            try {
              const value = await readOnce(app, await getSecret(appTokenKey(app.id)), (u, i) => fetch(u, i as RequestInit));
              setNote({ ok: true, text: `Leído: ${value}` });
            } catch (err) {
              setNote({ ok: false, text: err instanceof Error ? err.message : String(err) });
            }
          }}
        />
        <Button
          danger
          label={t("Quitar esta app")}
          onPress={async () => {
            await clearSecret(appTokenKey(app.id));
            onRemove();
          }}
        />
      </View>
      {note ? <Text style={note.ok ? styles.ok : styles.err}>{t(note.text)}</Text> : null}
    </View>
  );
}

export default function Settings() {
  const { t, settings, update } = useApp();
  const languages: { id: Language; label: string }[] = [
    { id: "auto", label: t("Automático") },
    { id: "es", label: "Español" },
    { id: "en", label: "English" },
  ];

  const setApp = (id: string, next: CustomApp) => update({ apps: settings.apps.map((a) => (a.id === id ? next : a)) });

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.title}>{t("Idioma")}</Text>
        <View style={styles.segment}>
          {languages.map((l) => (
            <Pressable key={l.id} style={[styles.seg, settings.language === l.id && styles.segOn]} onPress={() => update({ language: l.id })}>
              <Text style={[styles.segText, settings.language === l.id && { color: colors.bg }]}>{l.label}</Text>
            </Pressable>
          ))}
        </View>
        <Field label={t("Tu nombre")} value={settings.name} onChange={(v) => update({ name: v.slice(0, 40) })} />
        <Text style={styles.hint}>{t("Para saludarte en la pantalla de inicio.")}</Text>
      </View>

      <GithubSection />

      <Text style={styles.title}>{t("Mis apps")}</Text>
      <Text style={styles.hint}>{t("Añade tus propios servicios: Coucou consulta una dirección cada cierto tiempo y muestra un valor de su respuesta JSON.")}</Text>
      {settings.apps.map((app) => (
        <AppEditor key={app.id} app={app} onChange={(a) => setApp(app.id, a)} onRemove={() => update({ apps: settings.apps.filter((x) => x.id !== app.id) })} />
      ))}
      {settings.apps.length < CUSTOM_LIMIT ? (
        <Button
          primary
          label={t("Añadir app")}
          onPress={() =>
            update({
              apps: [
                ...settings.apps,
                {
                  id: `custom_${random(8, "abcdefghijklmnopqrstuvwxyz0123456789")}`,
                  name: "Mi app",
                  color: "#2DA8F5",
                  url: "https://",
                  path: "",
                  every: 120,
                  authHeader: "Authorization",
                  openUrl: "",
                },
              ],
            })
          }
        />
      ) : (
        <Text style={styles.hint}>{t(`Máximo ${CUSTOM_LIMIT} apps.`)}</Text>
      )}

      <Text style={[styles.hint, { marginTop: 8 }]}>
        {t("Esta es la versión móvil de Coucou: avisos de tus servicios en el teléfono. Los agentes de tu PC (Claude Code y demás) siguen en la app de escritorio.")}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 14, paddingBottom: 40 },
  card: { backgroundColor: colors.card, borderRadius: 18, padding: 16, gap: 10, borderWidth: 1, borderColor: colors.line },
  title: { color: colors.ink, fontSize: 16, fontWeight: "600" },
  hint: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  label: { color: colors.ink2, fontSize: 12 },
  input: { backgroundColor: colors.bg, color: colors.ink, borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: "rgba(255,255,255,0.06)" },
  primary: { backgroundColor: colors.ink, borderColor: colors.ink },
  danger: { borderColor: "rgba(244,80,94,0.4)" },
  buttonText: { color: colors.ink, fontSize: 14, fontWeight: "500" },
  link: { color: "#8AB4F8", fontSize: 13 },
  ok: { color: colors.green, fontSize: 13 },
  err: { color: colors.red, fontSize: 13 },
  segment: { flexDirection: "row", gap: 6 },
  seg: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 10, borderWidth: 1, borderColor: colors.line },
  segOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  segText: { color: colors.ink, fontSize: 13, fontWeight: "500" },
});
