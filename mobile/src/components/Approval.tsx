// The permission a PC is waiting on: the tool, the command, and Allow / Deny.
// Shared by the PCs list and a PC's own page.

import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { useApp } from "../app-context";
import type { Computer } from "../logic/link";
import { colors, radius, space, tint, type } from "../theme";
import { Button, Chip } from "./ui";

export function Approval({ pc, decide, sent, full }: {
  pc: Computer;
  decide: (pc: Computer, d: "allow" | "deny") => void;
  sent: string | null;
  /** On the PC's own page the whole command shows; in the list, a few lines. */
  full?: boolean;
}) {
  const { t } = useApp();
  const approval = pc.approval;
  if (!approval) return null;
  return (
    <View style={styles.box}>
      <View style={styles.row}>
        <Ionicons name="shield-half-outline" size={18} color={colors.amber} />
        <Text style={[type.title, { color: colors.amber, flex: 1 }]}>{t("Pide permiso")}</Text>
        <Chip label={approval.tool} color={colors.amber} />
      </View>
      <View style={styles.code}>
        <Text style={type.mono} numberOfLines={full ? undefined : 6} selectable>{approval.command}</Text>
      </View>
      {sent === approval.requestId ? (
        <View style={styles.row}>
          <Ionicons name="checkmark-circle" size={18} color={colors.green} />
          <Text style={[type.caption, { color: colors.green }]}>{t("Enviado. Esperando a tu PC…")}</Text>
        </View>
      ) : (
        <View style={styles.row}>
          <Button variant="danger" icon="close" label={t("Denegar")} style={{ flex: 1 }} onPress={() => decide(pc, "deny")} />
          <Button variant="primary" icon="checkmark" label={t("Permitir")} style={{ flex: 1 }} onPress={() => decide(pc, "allow")} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  box: { gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: tint(colors.amber, 0.08), borderWidth: 1, borderColor: tint(colors.amber, 0.3) },
  code: { backgroundColor: colors.inset, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, padding: space.md },
});
