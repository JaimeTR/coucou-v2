import { Ionicons } from "@expo/vector-icons";
import { Link } from "expo-router";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { useApp } from "../app-context";
import { Mochi } from "../components/Mochi";
import { Card, Chip, Dot, EmptyState, haptic, Screen } from "../components/ui";
import { attention, type Pr } from "../logic/github";
import { agoEs, partOfDayEs } from "../logic/translate";
import { ciColor, colors, space, type } from "../theme";

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
  const open = (url: string) => void Linking.openURL(url);

  const hello = settings.name.trim() ? t(`Hola ${settings.name.trim()}`) : t("Hola");
  const need = pulse ? attention(pulse) : null;
  const parts: string[] = [];
  if (need && need.reviews > 0) parts.push(t(need.reviews === 1 ? `${need.reviews} revisión pedida` : `${need.reviews} revisiones pedidas`));
  if (need && need.failing > 0) parts.push(t(`${need.failing} CI fallando`));
  if (need && need.copilot > 0) parts.push(t(need.copilot === 1 ? `${need.copilot} PR de Copilot` : `${need.copilot} PRs de Copilot`));
  const empty = !hasGithub && settings.apps.length === 0;

  return (
    <Screen onRefresh={() => void refresh()}>
      <View style={styles.hero}>
        <Mochi size={84} mood={parts.length > 0 ? "alert" : "idle"} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type.largeTitle}>{hello}</Text>
          <Text style={type.caption}>{t(partOfDayEs(new Date().getHours()))}</Text>
          <Text style={[type.caption, { marginTop: 4, color: parts.length > 0 ? colors.ink2 : colors.dim }]}>
            {parts.length > 0 ? parts.join(" · ") : t("Todo tranquilo por aquí.")}
          </Text>
        </View>
      </View>

      {empty && (
        <EmptyState icon="sparkles-outline" title={t("Nada que mostrar aún")} text={t("Conecta GitHub o añade una app en Ajustes para ver aquí lo que te necesita.")}>
          <Link href="/settings" asChild>
            <Pressable style={styles.link} onPress={() => haptic.tap()}>
              <Text style={styles.linkText}>{t("Ir a Ajustes")}</Text>
            </Pressable>
          </Link>
        </EmptyState>
      )}

      {hasGithub && (
        <Card>
          <View style={styles.row}>
            <Ionicons name="logo-github" size={18} color={colors.ink} />
            <Text style={type.title}>{t("GitHub")}</Text>
          </View>
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
      )}

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
  prRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 8 },
  value: { color: colors.ink, fontSize: 32, fontWeight: "700", letterSpacing: -0.5 },
  link: { marginTop: space.sm, paddingHorizontal: 16, paddingVertical: 10 },
  linkText: { color: "#8AB4F8", fontSize: 15, fontWeight: "600" },
});
