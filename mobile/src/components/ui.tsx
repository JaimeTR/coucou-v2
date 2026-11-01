// The app's small kit: cards, buttons, chips, a live dot. Every screen builds
// from these so they all look like one app.

import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { ActivityIndicator, Animated, Easing, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, radius, space, tint, type } from "../theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

/** A short tap of feedback. Never throws: not every device has a motor. */
export const haptic = {
  tap: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
};
function run(fn: () => Promise<void>) {
  if (Platform.OS === "web") return;
  void fn().catch(() => {});
}

export function Screen({ children, onRefresh, refreshing = false }: { children: ReactNode; onRefresh?: () => void; refreshing?: boolean }) {
  return (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.dim} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, tone, style }: { children: ReactNode; tone?: "warn" | "ok"; style?: StyleProp<ViewStyle> }) {
  const toned = tone === "warn" ? { backgroundColor: tint(colors.amber, 0.07), borderColor: tint(colors.amber, 0.4) } : tone === "ok" ? { borderColor: tint(colors.green, 0.4) } : null;
  return <View style={[styles.card, toned, style]}>{children}</View>;
}

export function Overline({ children }: { children: ReactNode }) {
  return <Text style={[type.overline, { paddingHorizontal: space.xs }]}>{children}</Text>;
}

type Variant = "primary" | "secondary" | "danger" | "ghost";

export function Button({ label, onPress, variant = "secondary", icon, loading, disabled, style }: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const ink = variant === "primary" ? colors.bg : variant === "danger" ? colors.red : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || loading}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.button, buttonLook[variant], (disabled || loading) && { opacity: 0.5 }, pressed && { opacity: 0.75, transform: [{ scale: 0.98 }] }, style]}
    >
      {loading ? <ActivityIndicator size="small" color={ink} /> : icon ? <Ionicons name={icon} size={18} color={ink} /> : null}
      <Text style={[styles.buttonText, { color: ink }]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, color = colors.dim, icon }: { label: string; color?: string; icon?: IconName }) {
  return (
    <View style={[styles.chip, { backgroundColor: tint(color, 0.14) }]}>
      {icon ? <Ionicons name={icon} size={12} color={color} /> : null}
      <Text style={[styles.chipText, { color }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

/** A status dot; with `live` it breathes, so "working" reads at a glance. */
export function Dot({ color, size = 10, live }: { color: string; size?: number; live?: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!live) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [live, pulse]);
  return (
    <View style={{ width: size, height: size }}>
      {live ? (
        <Animated.View
          style={{
            position: "absolute",
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }],
          }}
        />
      ) : null}
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

export function EmptyState({ icon, title, text, children }: { icon: IconName; title: string; text?: string; children?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={26} color={colors.dim} />
      </View>
      <Text style={[type.title, { textAlign: "center" }]}>{title}</Text>
      {text ? <Text style={[type.caption, { textAlign: "center", maxWidth: 300 }]}>{text}</Text> : null}
      {children}
    </View>
  );
}

const buttonLook: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: colors.ink, borderColor: colors.ink },
  secondary: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: colors.line },
  danger: { backgroundColor: tint(colors.red, 0.08), borderColor: tint(colors.red, 0.4) },
  ghost: { backgroundColor: "transparent", borderColor: "transparent" },
};

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.lg, paddingBottom: 48 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, gap: space.md, borderWidth: 1, borderColor: colors.line },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 48, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1 },
  buttonText: { fontSize: 16, fontWeight: "600" },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, maxWidth: 200 },
  chipText: { fontSize: 12, fontWeight: "600" },
  empty: { alignItems: "center", gap: space.sm, paddingVertical: 36, paddingHorizontal: space.lg },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", marginBottom: 4 },
});
