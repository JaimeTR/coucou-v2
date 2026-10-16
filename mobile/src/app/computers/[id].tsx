// One computer: what each agent is doing right now, the permission it waits on
// (Allow / Deny), and a way to carry on in the Claude app.

import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams } from "expo-router";
import { Linking, StyleSheet, Text, View } from "react-native";

import { useApp } from "../../app-context";
import { Approval } from "../../components/Approval";
import { Button, Card, Chip, Dot, EmptyState, Overline, Screen } from "../../components/ui";
import type { RemoteTask } from "../../logic/link";
import { ago, isOnline } from "../../logic/presence";
import { usePcs } from "../../pcs";
import { colors, space, type } from "../../theme";

/** Claude's own app first; the web version when it is not installed. */
async function openClaude() {
  try {
    await Linking.openURL("claude://");
  } catch {
    await Linking.openURL("https://claude.ai/code");
  }
}

const sourceLabel = (task: RemoteTask) => (task.source === "agent" ? "Agente" : "Claude Code");

export default function ComputerPage() {
  const { t } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { computers, decide, sent, refresh } = usePcs();
  const pc = computers.find((c) => c.id === id);

  if (!pc) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "" }} />
        <EmptyState icon="desktop-outline" title={t("Este PC ya no aparece")} text={t("Puede haberse desconectado. Vuelve a la lista y abre Coucou en ese PC.")} />
      </Screen>
    );
  }

  const online = isOnline(pc.at);
  // A task from a PC too old to say where it came from is taken for Claude Code.
  const hasClaude = pc.tasks.some((task) => task.source !== "agent");

  return (
    <Screen onRefresh={() => void refresh()}>
      <Stack.Screen options={{ title: pc.name }} />

      <View style={styles.row}>
        <Dot color={online ? colors.green : colors.dim} size={9} live={online} />
        <Text style={type.body}>{online ? t("En línea") : `${t("Visto hace")} ${ago(pc.at, t)}`}</Text>
      </View>

      {pc.approval ? <Approval pc={pc} decide={decide} sent={sent} full /> : null}

      <Overline>{t("Lo que está haciendo")}</Overline>
      {pc.tasks.length === 0 ? (
        <EmptyState icon="moon-outline" title={t("Ningún agente trabajando.")} text={t("Cuando un agente empiece una tarea en este PC, la verás aquí al momento.")} />
      ) : (
        pc.tasks.map((task) => (
          <Card key={task.id}>
            <View style={styles.row}>
              <Dot color={task.color} size={10} live={online} />
              <Text style={[type.title, { flex: 1 }]} numberOfLines={1}>{task.name}</Text>
              <Chip label={sourceLabel(task)} color={task.color} />
            </View>
            {task.project ? (
              <View style={styles.row}>
                <Ionicons name="folder-outline" size={15} color={colors.dim} />
                <Text style={type.caption}>{task.project}</Text>
              </View>
            ) : null}
            {task.step ? <Text style={type.body}>{task.step}</Text> : <Text style={type.caption}>{t("Sin detalle por ahora.")}</Text>}
            {task.state ? <Chip label={task.state} /> : null}
          </Card>
        ))
      )}

      <Overline>{t("Continuar")}</Overline>
      <Card>
        {hasClaude ? (
          <>
            <Text style={type.caption}>{t("Sigue la conversación en la app de Claude de este teléfono.")}</Text>
            <Button variant="secondary" icon="open-outline" label={t("Abrir Claude")} onPress={() => void openClaude()} />
          </>
        ) : null}
        <Text style={type.caption}>
          {t("Desde aquí puedes permitir o denegar. Para dar nuevas instrucciones al agente, hazlo en el PC.")}
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
