import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { useApp } from "../app-context";
import { Mochi } from "../components/Mochi";
import { attention, type Pr } from "../logic/github";
import { agoEs, partOfDayEs } from "../logic/translate";
import { ciColor, colors } from "../theme";

function Dot({ color }: { color: string }) {
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

function PrRow({ pr, onOpen }: { pr: Pr; onOpen: (url: string) => void }) {
  const { t } = useApp();
  return (
    <Pressable style={styles.prRow} onPress={() => onOpen(pr.url)}>
      <Dot color={ciColor(pr.ci)} />
      <View style={{ flex: 1 }}>
        <Text style={styles.prTitle} numberOfLines={1}>
          {pr.title}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {pr.repo}#{pr.number}
          {pr.isDraft ? ` · ${t("Borrador")}` : ""}
        </Text>
      </View>
    </Pressable>
  );
}

function Section({ title, color, prs, open }: { title: string; color: string; prs: Pr[]; open: (u: string) => void }) {
  const { t } = useApp();
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.row}>
        <Dot color={color} />
        <Text style={styles.sectionTitle}>{t(title)}</Text>
        <Text style={styles.count}>{prs.length}</Text>
      </View>
      {prs.length === 0 ? <Text style={styles.sub}>{t("Nada por aquí")}</Text> : prs.slice(0, 3).map((p) => <PrRow key={p.url} pr={p} onOpen={open} />)}
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
    <ScrollView
      contentContainerStyle={styles.page}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refresh()} tintColor={colors.dim} />}
    >
      <View style={styles.hero}>
        <Mochi size={92} mood={parts.length > 0 ? "alert" : "idle"} />
        <View style={{ flex: 1 }}>
          <Text style={styles.hello}>{hello}</Text>
          <Text style={styles.sub}>{t(partOfDayEs(new Date().getHours()))}</Text>
          <Text style={[styles.sub, { marginTop: 6, color: parts.length > 0 ? colors.ink2 : colors.dim }]}>
            {parts.length > 0 ? parts.join(" · ") : t("Todo tranquilo por aquí.")}
          </Text>
        </View>
      </View>

      {empty && <Text style={styles.empty}>{t("Conecta GitHub o añade una app en Ajustes para ver aquí lo que te necesita.")}</Text>}

      {hasGithub && (
        <View style={styles.card}>
          <View style={styles.row}>
            <Dot color={colors.github} />
            <Text style={styles.cardTitle}>{t("GitHub")}</Text>
          </View>
          {pulseError ? (
            <Text style={[styles.sub, { color: colors.red }]}>{t(pulseError)}</Text>
          ) : pulse ? (
            <View style={{ gap: 12 }}>
              <Section title="Revisiones pedidas" color={colors.amber} prs={pulse.toReview} open={open} />
              <Section title="Mis pull requests" color={colors.github} prs={pulse.mine} open={open} />
              <Section title="Copilot" color={colors.copilot} prs={pulse.copilot} open={open} />
            </View>
          ) : (
            <Text style={styles.sub}>{t("Cargando…")}</Text>
          )}
        </View>
      )}

      {settings.apps.map((app) => {
        const reading = readings[app.id];
        return (
          <Pressable key={app.id} style={styles.card} onPress={() => app.openUrl && open(app.openUrl)}>
            <View style={styles.row}>
              <Dot color={app.color} />
              <Text style={styles.cardTitle}>{app.name}</Text>
            </View>
            {reading?.error ? (
              <Text style={[styles.sub, { color: colors.red }]}>{t(reading.error)}</Text>
            ) : reading?.value != null ? (
              <Text style={styles.value}>{reading.value}</Text>
            ) : (
              <Text style={styles.sub}>{t("Esperando la primera lectura…")}</Text>
            )}
            {reading?.at ? <Text style={styles.sub}>{t(agoEs(new Date(reading.at).toISOString(), Date.now()))}</Text> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 14 },
  hero: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 6 },
  hello: { color: colors.ink, fontSize: 24, fontWeight: "700" },
  sub: { color: colors.dim, fontSize: 13 },
  empty: { color: colors.dim, fontSize: 14, lineHeight: 20 },
  card: { backgroundColor: colors.card, borderRadius: 18, padding: 16, gap: 10, borderWidth: 1, borderColor: colors.line },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: "600" },
  sectionTitle: { color: colors.ink2, fontSize: 13, fontWeight: "600", flex: 1 },
  count: { color: colors.dim, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  prRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  prTitle: { color: colors.ink, fontSize: 14 },
  value: { color: colors.ink, fontSize: 28, fontWeight: "700" },
});
