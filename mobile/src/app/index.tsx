// Today: what needs you, at a glance. Your computers first (permissions waiting,
// agents working), then GitHub and your own apps. Whatever is not set up yet
// shows as a step to take, so this screen is never an empty page.

import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { ComponentProps } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { useApp } from "../app-context";
import { Mochi } from "../components/Mochi";
import { Card, Chip, Dot, haptic, Overline, Screen } from "../components/ui";
import { attention, type Pr } from "../logic/github";
import { isOnline } from "../logic/presence";
import { agoEs, partOfDayEs } from "../logic/translate";
import { usePcs } from "../pcs";
import { ciColor, colors, radius, space, tint, type } from "../theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

function Step({ icon, title, text, onPress }: { icon: IconName; title: string; text: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [styles.step, pressed && { opacity: 0.6 }]}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
    >
      <View style={styles.stepIcon}>
        <Ionicons name={icon} size={20} color={colors.ink} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type.title}>{title}</Text>
        <Text style={type.caption}>{text}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.dim} />
    </Pressable>
  );
}

function PrRow({ pr, onOpen }: { pr: Pr; onOpen: (url: string) => void }) {
  const { t } = useApp();
  return (
    <Pressable
      style={({ pressed }) => [styles.prRow, pressed && { opacity: 0.6 }]}
      onPress={() => {
        haptic.tap();
        onOpen(pr.url);
      }}
    >
      <Dot color={ciColor(pr.ci)} size={8} />
      <View style={{ flex: 1 }}>
        <Text style={type.body} numberOfLines={1}>{pr.title}</Text>
        <Text style={type.caption} numberOfLines={1}>
          {pr.repo}#{pr.number}
          {pr.isDraft ? ` · ${t("Borrador")}` : ""}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.dim} />
    </Pressable>
  );
}

function Section({ title, color, prs, open }: { title: string; color: string; prs: Pr[]; open: (u: string) => void }) {
  const { t } = useApp();
  return (
    <View style={{ gap: 2 }}>
      <View style={styles.row}>
        <Text style={[type.caption, { color: colors.ink2, fontWeight: "600", flex: 1 }]}>{t(title)}</Text>
        <Chip label={`${prs.length}`} color={prs.length > 0 ? color : colors.dim} />
      </View>
      {prs.length === 0 ? <Text style={type.caption}>{t("Nada por aquí")}</Text> : prs.slice(0, 3).map((p) => <PrRow key={p.url} pr={p} onOpen={open} />)}
    </View>
  );
}

export default function Today() {
  const { t, settings, hasGithub, pulse, pulseError, readings, refresh } = useApp();
  const pcs = usePcs();
  const open = (url: string) => void Linking.openURL(url);
  const goPc = (id: string) => router.push({ pathname: "/computers/[id]", params: { id } });

  const hello = settings.name.trim() ? t(`Hola ${settings.name.trim()}`) : t("Hola");
  const need = pulse ? attention(pulse) : null;

  const waiting = pcs.computers.filter((c) => c.approval);
  const working = pcs.computers.reduce((n, c) => n + c.tasks.length, 0);
  const parts: string[] = [];
  if (waiting.length > 0) parts.push(waiting.length === 1 ? t("1 permiso esperando") : `${waiting.length} ${t("permisos esperando")}`);
  if (need && need.reviews > 0) parts.push(t(need.reviews === 1 ? `${need.reviews} revisión pedida` : `${need.reviews} revisiones pedidas`));
  if (need && need.failing > 0) parts.push(t(`${need.failing} CI fallando`));
  if (need && need.copilot > 0) parts.push(t(need.copilot === 1 ? `${need.copilot} PR de Copilot` : `${need.copilot} PRs de Copilot`));

  // What is not set up yet, as steps.
  const steps: React.ReactNode[] = [];
  if (pcs.loaded && !pcs.linked)
    steps.push(<Step key="pc" icon="qr-code-outline" title={t("Conecta tu PC")} text={t("Escanea su QR para ver tus agentes y permitir comandos desde aquí.")} onPress={() => router.push("/computers")} />);
  if (pcs.linked && !settings.pushOn)
    steps.push(<Step key="push" icon="notifications-outline" title={t("Activa los avisos")} text={t("Te avisamos cuando un PC pide permiso, aunque la app esté cerrada.")} onPress={() => router.push("/computers")} />);
  if (!hasGithub)
    steps.push(<Step key="gh" icon="logo-github" title={t("Conecta GitHub")} text={t("Revisiones pedidas, CI y pull requests de Copilot en un vistazo.")} onPress={() => router.push("/settings")} />);
  if (settings.apps.length === 0)
    steps.push(<Step key="app" icon="add-circle-outline" title={t("Añade tu primera app")} text={t("Muestra un número de tu propio servicio (ventas, usuarios, lo que quieras).")} onPress={() => router.push("/settings")} />);

  return (
    <Screen
      onRefresh={() => {
        void refresh();
        void pcs.refresh();
      }}
    >
      <View style={styles.hero}>
        <Mochi size={84} mood={parts.length > 0 ? "alert" : "idle"} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type.largeTitle}>{hello}</Text>
          <Text style={type.caption}>{t(partOfDayEs(new Date().getHours()))}</Text>
          <Text style={[type.caption, { marginTop: 4, color: parts.length > 0 ? colors.amber : colors.dim }]}>
            {parts.length > 0 ? parts.join(" · ") : t("Todo tranquilo por aquí.")}
          </Text>
        </View>
      </View>

      {pcs.linked ? (
        <>
          <Overline>{t("Tus PCs")}</Overline>
          <Card tone={waiting.length > 0 ? "warn" : undefined}>
            {pcs.computers.length === 0 ? (
              <Text style={type.caption}>{pcs.error ? t("Sin conexión con tu servidor") : t("Ningún PC ha reportado todavía. Abre Coucou en tu PC con la sincronización activa.")}</Text>
            ) : (
              <>
                <Text style={type.caption}>
                  {working > 0 ? (working === 1 ? t("1 agente trabajando") : `${working} ${t("agentes trabajando")}`) : t("Ningún agente trabajando.")}
                </Text>
                {pcs.computers.map((pc) => {
                  const online = isOnline(pc.at);
                  return (
                    <Pressable
                      key={pc.id}
                      style={({ pressed }) => [styles.pcRow, pressed && { opacity: 0.6 }]}
                      onPress={() => {
                        haptic.tap();
                        goPc(pc.id);
                      }}
                    >
                      <Dot color={pc.approval ? colors.amber : online ? colors.green : colors.dim} size={9} live={!!pc.approval} />
                      <View style={{ flex: 1 }}>
                        <Text style={type.body} numberOfLines={1}>{pc.name}</Text>
                        <Text style={type.caption} numberOfLines={1}>
                          {pc.approval ? `${t("Pide permiso")} · ${pc.approval.tool}` : pc.tasks[0] ? `${pc.tasks[0].name}${pc.tasks[0].step ? ` · ${pc.tasks[0].step}` : ""}` : online ? t("En línea") : t("Sin conexión")}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.dim} />
                    </Pressable>
                  );
                })}
              </>
            )}
          </Card>
        </>
      ) : null}

      {steps.length > 0 ? (
        <>
          <Overline>{t("Para empezar")}</Overline>
          <Card style={{ paddingVertical: space.sm }}>{steps}</Card>
        </>
      ) : null}

      {hasGithub && (
        <>
          <Overline>{t("GitHub")}</Overline>
          <Card>
            {pulseError ? (
              <Text style={[type.caption, { color: colors.red }]}>{t(pulseError)}</Text>
            ) : pulse ? (
              <View style={{ gap: space.lg }}>
                <Section title="Revisiones pedidas" color={colors.amber} prs={pulse.toReview} open={open} />
                <Section title="Mis pull requests" color={colors.github} prs={pulse.mine} open={open} />
                <Section title="Copilot" color={colors.copilot} prs={pulse.copilot} open={open} />
              </View>
            ) : (
              <Text style={type.caption}>{t("Cargando…")}</Text>
            )}
          </Card>
        </>
      )}

      {settings.apps.length > 0 ? <Overline>{t("Mis apps")}</Overline> : null}
      {settings.apps.map((app) => {
        const reading = readings[app.id];
        return (
          <Pressable
            key={app.id}
            onPress={() => {
              if (!app.openUrl) return;
              haptic.tap();
              open(app.openUrl);
            }}
          >
            <Card>
              <View style={styles.row}>
                <Dot color={app.color} size={9} />
                <Text style={[type.title, { flex: 1 }]}>{app.name}</Text>
                {reading?.at ? <Text style={type.caption}>{t(agoEs(new Date(reading.at).toISOString(), Date.now()))}</Text> : null}
              </View>
              {reading?.error ? (
                <Text style={[type.caption, { color: colors.red }]}>{t(reading.error)}</Text>
              ) : reading?.value != null ? (
                <Text style={styles.value}>{reading.value}</Text>
              ) : (
                <Text style={type.caption}>{t("Esperando la primera lectura…")}</Text>
              )}
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "center", gap: space.md },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  pcRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 8 },
  prRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 8 },
  value: { color: colors.ink, fontSize: 32, fontWeight: "700", letterSpacing: -0.5 },
  step: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  stepIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: tint(colors.accent, 0.14), alignItems: "center", justifyContent: "center" },
});
