import { Stack } from "expo-router";

import { useApp } from "../../app-context";
import { colors } from "../../theme";

export default function ComputersLayout() {
  const { t } = useApp();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.ink,
        headerTitleStyle: { fontWeight: "700", fontSize: 17 },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: t("PCs") }} />
      <Stack.Screen name="[id]" options={{ title: "" }} />
    </Stack>
  );
}
