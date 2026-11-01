import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { useEffect, type ComponentProps } from "react";
import { Platform, type ColorValue } from "react-native";

import { AppProvider, useApp } from "../app-context";
import { haptic } from "../components/ui";
import { PcsProvider, usePcs } from "../pcs";
import { openPcsOnTap, showNoticesInForeground } from "../push";
import { colors } from "../theme";

// Your computers are what this app is for: it opens there.
export const unstable_settings = { initialRouteName: "computers" };

type IconName = ComponentProps<typeof Ionicons>["name"];

const icon = (on: IconName, off: IconName) =>
  function TabIcon({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) {
    return <Ionicons name={focused ? on : off} color={color} size={size} />;
  };

function Navigation() {
  const { t } = useApp();
  const { computers } = usePcs();
  const waiting = computers.filter((c) => c.approval).length;
  useEffect(() => {
    if (Platform.OS === "web") return;
    showNoticesInForeground();
    return openPcsOnTap();
  }, []);
  return (
    <>
      <StatusBar style="light" />
      <Tabs
        screenListeners={{ tabPress: () => haptic.tap() }}
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.ink,
          headerTitleStyle: { fontWeight: "700", fontSize: 17 },
          headerShadowVisible: false,
          tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.line },
          tabBarActiveTintColor: colors.ink,
          tabBarInactiveTintColor: colors.dim,
          tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
          sceneStyle: { backgroundColor: colors.bg },
        }}
      >
        <Tabs.Screen
          name="computers"
          options={{
            title: t("PCs"),
            headerShown: false,
            tabBarBadge: waiting > 0 ? waiting : undefined,
            tabBarBadgeStyle: { backgroundColor: colors.amber, color: colors.bg },
            tabBarIcon: icon("desktop", "desktop-outline"),
          }}
        />
        <Tabs.Screen name="index" options={{ title: t("Hoy"), tabBarIcon: icon("sparkles", "sparkles-outline") }} />
        <Tabs.Screen name="settings" options={{ title: t("Ajustes"), tabBarIcon: icon("settings", "settings-outline") }} />
      </Tabs>
    </>
  );
}

export default function Layout() {
  return (
    <AppProvider>
      <PcsProvider>
        <Navigation />
      </PcsProvider>
    </AppProvider>
  );
}
